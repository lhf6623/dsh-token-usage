'use strict'

const test = require('node:test')
const assert = require('node:assert')

const HOUR = 3600000
const DAY = 86400000
const NOW = Date.now()

function mkEvent(time, provider, model, usage) {
  return {
    type: 'assistant/message',
    time: time,
    data: { usage: usage, message: { source: { kind: 'model', provider: provider, model: model } } },
  }
}

// A fork replays its parent's prefix into its own log. Those prefix events are
// NOT its usage, so the fixture puts an absurd number there: if the host ever
// counts them the assertions blow up loudly.
const INHERITED_PREFIX = 999999
const corpus = {
  s1: {
    events: [
      { type: 'user/message', time: NOW - 5 * HOUR, data: {} },
      mkEvent(NOW - 4 * HOUR, 'fan', 'deepseek-flash', { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 }),
      mkEvent(NOW - 2 * DAY, 'fan', 'deepseek-flash', { inputTokens: 200, outputTokens: 80 }),
    ],
  },
  s2: {
    // child of s1
    inherited: 1,
    events: [
      mkEvent(NOW - 4 * HOUR, 'fan', 'deepseek-flash', { inputTokens: INHERITED_PREFIX, outputTokens: INHERITED_PREFIX }),
      mkEvent(NOW - 1 * HOUR, 'deepseek-official', 'deepseek-v4-pro', { inputTokens: 300, outputTokens: 120, reasoningTokens: 40 }),
    ],
  },
  s3: {
    events: [
      mkEvent(NOW - 3 * DAY, 'fan', 'deepseek-flash', { inputTokens: 1000, outputTokens: 400, cacheReadTokens: 500 }),
    ],
  },
}

function makeQuery() {
  return {
    async listSessions() {
      return [
        { header: { id: 's1' }, live: true, persisted: true },
        { header: { id: 's2', parentSession: 's1' }, live: false, persisted: true },
        { header: { id: 's3' }, live: false, persisted: true },
      ]
    },
    async readSession(id) {
      const entry = corpus[id]
      if (!entry) throw new Error('unknown session ' + id)
      return { inheritedEventCount: entry.inherited || 0, events: entry.events, session: { id: id } }
    },
  }
}

async function createHost() {
  const mod = await import('../index.js')
  let handler = null
  const ctx = {
    sessionQuery: makeQuery(),
    effect(fn) { fn(); return function () {} },
    inject(deps, fn) {
      fn({
        effect(f) { f() },
        webServer: { register(route) { handler = route.handler; return function () { handler = null } } },
        connection: { requestRejection() { return undefined } },
      })
    },
  }
  mod.apply(ctx, {})
  await new Promise(function (r) { setTimeout(r, 20) })
  assert.ok(handler, 'route must be registered')
  return function call(query) {
    return new Promise(function (resolve, reject) {
      const req = { url: '/_dsh/dsh-token-usage/usage?' + query, method: 'GET' }
      const res = {
        headersSent: false,
        writeHead(status) { this.status = status; this.headersSent = true },
        end(body) { resolve({ status: this.status, body: JSON.parse(body) }) },
        destroy(err) { reject(err) },
      }
      handler(req, res)
    })
  }
}

function windowOf(days) {
  return 'from=' + (NOW - days * DAY) + '&to=' + NOW + '&tzOffset=480'
}

test('aggregates usage and finds every API automatically', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day')
  assert.strictEqual(res.status, 200)
  const body = res.body
  assert.strictEqual(body.ok, true)
  assert.deepStrictEqual(
    body.combos.map(function (c) { return c.provider + '/' + c.model }).sort(),
    ['deepseek-official/deepseek-v4-pro', 'fan/deepseek-flash']
  )
  assert.strictEqual(body.apiCount, 2)
})

test('never counts the fork-inherited prefix', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day')
  assert.ok(JSON.stringify(res.body).indexOf(String(INHERITED_PREFIX)) < 0, 'inherited events leaked into the payload')
  assert.strictEqual(res.body.totals.input, 1600)
  assert.strictEqual(res.body.totals.output, 650)
  assert.strictEqual(res.body.totals.cacheRead, 510)
  assert.strictEqual(res.body.totals.cacheWrite, 5)
  assert.strictEqual(res.body.totals.calls, 4)
  assert.strictEqual(res.body.totals.total, 2765)
})

test('bucket totals add up to the grand total', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day')
  const sum = res.body.buckets.reduce(function (a, b) { return a + b.total }, 0)
  assert.strictEqual(sum, res.body.totals.total)
})

test('zero-fills empty buckets so gaps stay visible', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day')
  assert.ok(res.body.buckets.length >= 8, 'expected a bucket per day')
  const empty = res.body.buckets.filter(function (b) { return b.total === 0 })
  assert.ok(empty.length > 0, 'expected some zero buckets inside a 7 day window')
})

test('session scope rolls up the derived sessions', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day&sessionId=s1')
  // s1 alone is 300 input / 130 output; s2 contributes the remaining 300/120.
  assert.strictEqual(res.body.totals.input, 600)
  assert.strictEqual(res.body.totals.output, 250)
  assert.strictEqual(res.body.totals.calls, 3)
})

test('an unrelated session is excluded from a scoped request', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day&sessionId=s1')
  assert.strictEqual(res.body.combos.length, 2)
  assert.strictEqual(res.body.totals.cacheRead, 10)
})

test('hourly granularity downgrades instead of emitting thousands of points', async function () {
  const call = await createHost()
  const res = await call('from=' + (NOW - 365 * DAY) + '&to=' + NOW + '&bucket=hour&tzOffset=480')
  assert.notStrictEqual(res.body.bucket, 'hour')
  assert.ok(res.body.buckets.length <= 400, 'got ' + res.body.buckets.length + ' points')
})

test('no request can produce an unreadable number of points', async function () {
  const call = await createHost()
  for (const days of [1, 2, 7, 30, 90, 365]) {
    for (const bucket of ['hour', 'day', 'month']) {
      const res = await call(windowOf(days) + '&bucket=' + bucket)
      assert.ok(res.body.buckets.length <= 400,
        days + 'd/' + bucket + ' produced ' + res.body.buckets.length + ' points')
    }
  }
})

test('an empty window is a valid empty payload, not an error', async function () {
  const call = await createHost()
  const res = await call('from=' + (NOW + 40 * DAY) + '&to=' + (NOW + 41 * DAY) + '&bucket=day&tzOffset=480')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.body.ok, true)
  assert.strictEqual(res.body.totals.total, 0)
})

test('reasoning tokens are collected even though the UI does not chart them', async function () {
  const call = await createHost()
  const res = await call(windowOf(7) + '&bucket=day')
  assert.strictEqual(res.body.totals.reasoning, 40)
})

test('the flat-record cache is reused across bucket switches', async function () {
  const call = await createHost()
  const first = await call(windowOf(7) + '&bucket=day')
  const second = await call(windowOf(7) + '&bucket=hour')
  assert.ok(second.body.cachedAt, 'second request should report a cache timestamp')
  assert.ok(first.body.scan.scanned >= first.body.scan.listed - 0)
})
