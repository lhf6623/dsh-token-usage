/**
 * dsh-token-usage — Host half.
 *
 * Token counts only: no prices, no currency, no network egress. The point is to
 * answer "how many tokens did each API actually burn, per hour / day / month"
 * from data the Harness already recorded.
 *
 * Data source: `ctx.sessionQuery` (the official live-preferred session corpus
 * reader). Using it — rather than decompressing the `session.jsonl.zstd` files by
 * hand — matters for two reasons:
 *   1. A session directory may hold several version files (`session.jsonl.zstd`,
 *      `session.v3.jsonl.zstd`, `session.v4.jsonl.zstd`). Reading the directory
 *      directly would count the same response two or three times.
 *   2. `readSession` returns the *logical* log plus `inheritedEventCount`, which
 *      marks the prefix a forked/subagent session inherited from its parent. Only
 *      events at or after that offset are this session's own usage.
 *
 * Only `assistant/message` events carry `data.usage`, and only those also carry
 * `data.message.source = { kind: 'model', provider, model }`, so the
 * provider/model attribution comes from the same record as the counts.
 *
 * Range model: the Client sends an explicit `from`/`to` epoch window, because
 * "today", "yesterday", "this month" and "last month" are CALENDAR boundaries in
 * the viewer's own wall clock. The Host must not guess a calendar from a day
 * count — it only applies the given window and buckets it.
 *
 * Perf shape: reading a session log is the expensive part, so the flat record
 * list is cached and every request re-buckets it in memory. Changing the range,
 * the granularity, or the API filter costs no log reads at all.
 *
 * Exposed to the Client half over one loopback route:
 *
 *   GET /_dsh/dsh-token-usage/usage
 *       ?from=MS           (optional epoch ms; defaults to `to - days`)
 *       &to=MS             (optional epoch ms; defaults to now)
 *       &days=N            (legacy fallback when `from` is absent)
 *       &bucket=hour|day|month
 *       &tzOffset=MINUTES  (minutes east of UTC)
 *       &sessionId=ID      (optional: scope to one session AND its descendants)
 *       &refresh=1         (optional: bypass the record cache)
 */

export const name = 'dsh-token-usage'

export const inject = ['sessionQuery']

const ROUTE_PREFIX = '/_dsh/dsh-token-usage'
const LOG_PREFIX = '[dsh-token-usage]'

const BUCKETS = new Set(['hour', 'day', 'month'])

/** Flat-record cache lifetime; longer than the old payload cache because
 *  range/granularity switches no longer invalidate it. */
const RECORDS_TTL_MS = 60_000

/** Bound on scanned sessions so a large corpus cannot stall one request. */
const MAX_SESSIONS = 500

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Bucket-count caps. These are the hard stop that keeps one request bounded;
 * `effectiveBucket` downgrades granularity before they are ever reached,
 * so they only guard a caller that asks for something absurd.
 */
const HOUR_CAP = 24 * 9     // 9 days of hours
const DAY_CAP = 400        // ~13 months of days
const MONTH_CAP = 120      // 10 years of months

/**
 * Longest window a given granularity is allowed to cover. Hourly data stays
 * within 9 days because a line chart with 700+ points per series is ink soup,
 * not a trend; longer windows keep the shape at day granularity instead.
 */
const HOUR_MAX_SPAN = 8 * DAY_MS
const DAY_MAX_SPAN = 400 * DAY_MS

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** Bucket key for one instant in the viewer's wall clock. */
function bucketKey(ts, bucket, tzOffset) {
  const d = new Date(ts + tzOffset * 60_000)
  const y = d.getUTCFullYear()
  const mo = pad2(d.getUTCMonth() + 1)
  if (bucket === 'month') return y + '-' + mo
  const day = pad2(d.getUTCDate())
  if (bucket === 'day') return y + '-' + mo + '-' + day
  return y + '-' + mo + '-' + day + ' ' + pad2(d.getUTCHours())
}

/**
 * Downgrade granularity so one window never explodes the bucket count.
 * A 365-day custom range asked for in hours becomes days; a multi-year range
 * becomes months. The response reports the bucket it actually used.
 */
function effectiveBucket(from, to, requested) {
  const span = Math.max(0, to - from)
  if (requested === 'month') return 'month'
  if (requested === 'hour') {
    if (span <= HOUR_MAX_SPAN) return 'hour'
    return span <= DAY_MAX_SPAN ? 'day' : 'month'
  }
  return span <= DAY_MAX_SPAN ? 'day' : 'month'
}

/** Every bucket key spanning [from, to], so real gaps render as explicit zeros. */
function enumerateKeys(from, to, bucket, tzOffset) {
  const keys = []
  const seen = new Set()
  const push = (k) => {
    if (!seen.has(k)) { seen.add(k); keys.push(k) }
  }
  if (bucket === 'month') {
    const a = new Date(from + tzOffset * 60_000)
    let y = a.getUTCFullYear()
    let m = a.getUTCMonth()
    const end = new Date(to + tzOffset * 60_000)
    let guard = 0
    while ((y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) && guard++ < MONTH_CAP) {
      push(y + '-' + pad2(m + 1))
      if (++m > 11) { m = 0; y++ }
    }
    return keys
  }
  const step = bucket === 'hour' ? HOUR_MS : DAY_MS
  const cap = bucket === 'hour' ? HOUR_CAP : DAY_CAP
  const shifted = from + tzOffset * 60_000
  const aligned = Math.floor(shifted / step) * step - tzOffset * 60_000
  for (let t = aligned; t <= to && keys.length < cap; t += step) push(bucketKey(t, bucket, tzOffset))
  return keys
}

function zeroCounts() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
}

function addInto(target, r) {
  target.input += r.input
  target.output += r.output
  target.cacheRead += r.cacheRead
  target.cacheWrite += r.cacheWrite
  target.calls += 1
}

function withTotal(obj) {
  return Object.assign({}, obj, {
    total: obj.input + obj.output + obj.cacheRead + obj.cacheWrite,
    cache: obj.cacheRead + obj.cacheWrite,
  })
}

/** One `assistant/message` record's usage, or null when it carries none. */
function usageOf(event) {
  const data = event && event.data
  if (!data || !data.usage) return null
  const usage = data.usage
  const source = (data.message && data.message.source) || {}
  return {
    ts: typeof event.time === 'number' ? event.time : 0,
    provider: source.provider || '(unknown)',
    model: source.model || '(unknown)',
    input: usage.inputTokens || 0,
    output: usage.outputTokens || 0,
    cacheRead: usage.cacheReadTokens || 0,
    cacheWrite: usage.cacheWriteTokens || 0,
    reasoning: usage.reasoningTokens || 0,
  }
}

/** Session id plus every descendant (subagent / fork) found in the corpus. */
function collectLineage(source, sessionId) {
  const ids = new Set([sessionId])
  const queue = [sessionId]
  while (queue.length) {
    const current = queue.shift()
    const kids = source.childrenOf.get(current)
    if (!kids) continue
    for (const kid of kids) {
      if (ids.has(kid)) continue
      ids.add(kid)
      queue.push(kid)
    }
  }
  return ids
}

export function apply(ctx, config) {
  const log = (...args) => console.log(LOG_PREFIX, ...args)

  // Flat usage records from every session, shared by all requests.
  let recordsCache = null // { at, records, scan, bySession, childrenOf }
  let inflight = null

  async function readAll() {
    const query = ctx.sessionQuery
    if (!query || typeof query.listSessions !== 'function') {
      throw new Error('sessionQuery service is unavailable')
    }

    let sessions = []
    try {
      sessions = await query.listSessions()
    } catch (err) {
      log('listSessions failed:', String((err && err.message) || err))
      sessions = []
    }
    const listed = Array.isArray(sessions) ? sessions.length : 0

    const records = []
    const bySession = new Map()
    const childrenOf = new Map()
    let scanned = 0
    let failed = 0

    for (const record of Array.isArray(sessions) ? sessions.slice(0, MAX_SESSIONS) : []) {
      // SessionRecord = { header, live, persisted }: the id lives on the header.
      const header = record && record.header
      const id = header && header.id
      if (!id) continue
      const parent = header && header.parentSession
      if (parent) {
        const kids = childrenOf.get(parent)
        if (kids) kids.push(id)
        else childrenOf.set(parent, [id])
      }
      let snapshot
      try {
        snapshot = await query.readSession(id)
      } catch (err) {
        failed++
        continue
      }
      if (!snapshot || !Array.isArray(snapshot.events)) { failed++; continue }
      scanned++

      // Forked/subagent sessions replay their parent's prefix in their own log;
      // everything before this offset was already counted in the parent session.
      const inherited = Number(snapshot.inheritedEventCount) || 0
      const events = snapshot.events
      const own = []
      for (let i = inherited; i < events.length; i++) {
        const ev = events[i]
        if (!ev || ev.type !== 'assistant/message') continue
        const r = usageOf(ev)
        if (!r) continue
        r.sessionId = id
        own.push(r)
        records.push(r)
      }
      bySession.set(id, own)
    }

    return {
      at: Date.now(),
      records,
      bySession,
      childrenOf,
      scan: { listed, scanned, failed, truncated: listed > MAX_SESSIONS },
    }
  }

  function getRecords(force) {
    if (!force && recordsCache && Date.now() - recordsCache.at < RECORDS_TTL_MS) {
      return Promise.resolve(recordsCache)
    }
    if (inflight) return inflight
    inflight = readAll().then((fresh) => {
      recordsCache = fresh
      return fresh
    }).finally(() => { inflight = null })
    return inflight
  }

  function buildPayload(source, bucket, from, to, tzOffset, sessionId) {
    const started = Date.now()
    const now = Date.now()

    // A session scope covers the session itself AND everything forked from it:
    // subagent children are separate logical sessions with their own ids.
    let pool = source.records
    if (sessionId) {
      const ids = collectLineage(source, sessionId)
      const scoped = []
      for (const r of source.records) if (ids.has(r.sessionId)) scoped.push(r)
      pool = scoped
    }
    const records = []
    for (const r of pool) if (r.ts >= from && r.ts <= to) records.push(r)

    // Re-bucket in memory.
    const buckets = new Map()
    const providers = new Map()
    const combos = new Map()
    const totals = zeroCounts()
    let first = Infinity
    let last = -Infinity
    let reasoning = 0

    for (const r of records) {
      const key = bucketKey(r.ts, bucket, tzOffset)
      const sk = r.provider + '\u0000' + r.model

      let b = buckets.get(key)
      if (!b) { b = Object.assign({ key }, zeroCounts(), { series: new Map() }); buckets.set(key, b) }
      let s = b.series.get(sk)
      if (!s) { s = Object.assign({ provider: r.provider, model: r.model }, zeroCounts()); b.series.set(sk, s) }
      let p = providers.get(r.provider)
      if (!p) { p = Object.assign({ provider: r.provider }, zeroCounts()); providers.set(r.provider, p) }
      let c = combos.get(sk)
      if (!c) { c = Object.assign({ provider: r.provider, model: r.model }, zeroCounts()); combos.set(sk, c) }

      addInto(b, r)
      addInto(s, r)
      addInto(p, r)
      addInto(c, r)
      addInto(totals, r)
      reasoning += r.reasoning
      if (r.ts < first) first = r.ts
      if (r.ts > last) last = r.ts
    }

    const hasData = records.length > 0
    const keys = enumerateKeys(from, to, bucket, tzOffset)

    const combosOut = [...combos.values()].map(withTotal).sort((a, b) => b.total - a.total)

    // Per-bucket detail points at the roster by index instead of repeating a
    // provider/model pair in every bucket: with 35 APIs over a few hundred
    // buckets the strings alone used to outweigh the actual numbers.
    const comboIndex = new Map()
    combosOut.forEach((c, i) => { comboIndex.set(c.provider + '\u0000' + c.model, i) })

    const seriesOut = keys.map((key) => {
      const b = buckets.get(key)
      if (!b) return Object.assign({ key }, zeroCounts(), { total: 0, cache: 0, series: [] })
      const series = [...b.series.entries()]
        .map(([sk, s]) => [comboIndex.get(sk), s.input, s.output, s.cacheRead, s.cacheWrite, s.calls])
        .sort((x, y) => x[0] - y[0])
      const agg = withTotal(b)
      return {
        key,
        input: agg.input, output: agg.output, cacheRead: agg.cacheRead, cacheWrite: agg.cacheWrite,
        calls: agg.calls, total: agg.total, cache: agg.cache, series,
      }
    })

    return {
      ok: true,
      bucket,
      from,
      to,
      tzOffset,
      sessionId: sessionId || null,
      generatedAt: now,
      tookMs: Date.now() - started,
      scan: source.scan,
      cachedAt: source.at,
      count: records.length,
      apiCount: combosOut.length,
      totals: Object.assign(withTotal(totals), {
        reasoning,
        firstAt: hasData ? first : null,
        lastAt: hasData ? last : null,
      }),
      providers: [...providers.values()].map(withTotal).sort((a, b) => b.total - a.total),
      combos: combosOut,
      buckets: seriesOut,
      truncated: records.length > 0 && keys.length > 0
        && (keys[keys.length - 1] < bucketKey(to, bucket, tzOffset)),
    }
  }

  function respond(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    })
    res.end(text)
  }

  // Desktop validates the app origin before forwarding and strips renderer
  // Origin/Host headers, so `connection.requestRejection` is the only correct
  // boundary for both the Web and Desktop transports.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          let method = ''
          try {
            const rejection = webCtx.connection.requestRejection(req)
            if (rejection !== undefined) {
              respond(res, rejection, { ok: false, error: 'request rejected' })
              return
            }
            const url = new URL(req.url || '/', 'http://localhost')
            if (!url.pathname.startsWith(ROUTE_PREFIX + '/')) {
              respond(res, 404, { ok: false, error: 'not found' })
              return
            }
            method = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1))
            if (method !== 'usage') {
              respond(res, 404, { ok: false, error: 'unknown method' })
              return
            }
            if (req.method !== 'GET') {
              respond(res, 405, { ok: false, error: 'usage requires GET' })
              return
            }

            const sp = url.searchParams
            const now = Date.now()

            const toRaw = Number(sp.get('to'))
            const to = Number.isFinite(toRaw) && toRaw > 0
              ? Math.min(Math.round(toRaw), now + 60_000)
              : now

            const fromRaw = Number(sp.get('from'))
            let from
            if (Number.isFinite(fromRaw) && fromRaw >= 0 && sp.get('from') !== null) {
              from = Math.round(fromRaw)
            } else {
              const daysRaw = Number(sp.get('days'))
              const days = Number.isFinite(daysRaw) && daysRaw >= 0 ? Math.min(Math.floor(daysRaw), 3650) : 30
              from = days > 0 ? to - days * DAY_MS : 0
            }
            if (from > to) from = to

            const tzRaw = Number(sp.get('tzOffset'))
            const tzOffset = Number.isFinite(tzRaw) ? Math.max(-840, Math.min(840, Math.round(tzRaw))) : 0
            const sessionId = sp.get('sessionId') || ''
            const refresh = sp.get('refresh') === '1'
            const requested = BUCKETS.has(sp.get('bucket')) ? sp.get('bucket') : 'day'
            const bucket = effectiveBucket(from, to, requested)

            const source = await getRecords(refresh)
            respond(res, 200, buildPayload(source, bucket, from, to, tzOffset, sessionId))
          } catch (err) {
            log('route failed:', method, String((err && err.stack) || err))
            if (!res.headersSent) respond(res, 500, { ok: false, error: String((err && err.message) || err) })
            else res.destroy(err)
          }
        },
      })
      return () => dispose()
    }, 'dsh-token-usage: web route')
  })

  log('ready at', ROUTE_PREFIX + '/usage')
}
