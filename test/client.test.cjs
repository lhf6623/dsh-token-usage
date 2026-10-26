'use strict'

const test = require('node:test')
const assert = require('node:assert')
const nodeFs = require('node:fs')
const nodePath = require('node:path')
const harness = require('./harness.cjs')

const React = harness.React
const DAY = 86400000
const NOW = Date.now()

function mkEvent(time, provider, model, usage) {
  return {
    type: 'assistant/message',
    time: time,
    data: { usage: usage, message: { source: { kind: 'model', provider: provider, model: model } } },
  }
}

let fetchCalls = []
let failNext = false
let installedStyles = []

function installGlobals() {
  fetchCalls = []
  failNext = false
  installedStyles = []
  const head = {
    appendChild(el) { installedStyles.push(el); el.parentNode = head },
    removeChild(el) { const i = installedStyles.indexOf(el); if (i >= 0) installedStyles.splice(i, 1) },
  }
  global.document = {
    head: head,
    querySelector() { return null },
    createElement(tag) { return { tagName: tag, dataset: {}, textContent: '' } },
  }
  global.window = { addEventListener() {}, removeEventListener() {} }
}

// Wire the client's fetch straight into the real host handler, so the test
// exercises the true request/response contract rather than a stub payload.
async function installFetchBridge() {
  const hostMod = await import('../index.js')
  let handler = null
  const sessionQuery = {
    async listSessions() {
      return [
        { header: { id: 'a' }, live: true, persisted: true },
        { header: { id: 'b', parentSession: 'a' }, live: false, persisted: true },
      ]
    },
    async readSession(id) {
      if (id === 'a') {
        return { inheritedEventCount: 0, events: [
          mkEvent(NOW - 2 * 3600000, 'fan', 'deepseek-flash', { inputTokens: 12000, outputTokens: 3400, cacheReadTokens: 88000, cacheWriteTokens: 2100 }),
          mkEvent(NOW - 1 * DAY, 'fan', 'deepseek-flash', { inputTokens: 9000, outputTokens: 2600, cacheReadTokens: 61000, cacheWriteTokens: 1400 }),
          mkEvent(NOW - 3 * DAY, 'deepseek-official', 'deepseek-v4-pro', { inputTokens: 21000, outputTokens: 7700, cacheReadTokens: 130000, cacheWriteTokens: 5200 }),
        ] }
      }
      return { inheritedEventCount: 0, events: [
        mkEvent(NOW - 5 * 3600000, 'fan', 'deepseek-flash', { inputTokens: 4000, outputTokens: 1200, cacheReadTokens: 22000 }),
      ] }
    },
  }
  hostMod.apply({
    sessionQuery: sessionQuery,
    effect(fn) { fn(); return function () {} },
    inject(deps, fn) {
      fn({
        effect(f) { f() },
        webServer: { register(route) { handler = route.handler; return function () {} } },
        connection: { requestRejection() { return undefined } },
      })
    },
  }, {})
  await new Promise(function (r) { setTimeout(r, 20) })
  assert.ok(handler, 'host route registered')

  global.fetch = function (url) {
    fetchCalls.push(String(url))
    if (failNext) {
      failNext = false
      return Promise.resolve({ ok: false, status: 500, json: async function () { return {} } })
    }
    const qs = String(url).split('?')[1] || ''
    return new Promise(function (resolve, reject) {
      const req = { url: '/_dsh/dsh-token-usage/usage?' + qs, method: 'GET' }
      const res = {
        headersSent: false,
        writeHead(s) { this.status = s; this.headersSent = true },
        end(body) { resolve({ ok: this.status === 200, status: this.status, json: async function () { return JSON.parse(body) } }) },
        destroy(err) { reject(err) },
      }
      handler(req, res)
    })
  }
}

/** Load client.js through the DSH module loader contract and apply it. */
async function loadPlugin() {
  const src = nodeFs.readFileSync(nodePath.join(__dirname, '..', 'client.js'), 'utf8')
  let factory = null
  global.window.__ModuleLoader__ = { load(def) { factory = def.factory } }
  new Function('window', src)(global.window)
  const api = factory(function (name) {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })

  const dicts = {}
  const locale = {
    register(ns, lc, dict) { dicts[ns + ':' + lc] = dict; return function () {} },
    bind(ns) {
      return function (key, args) {
        let text = (dicts[ns + ':zh'] || {})[key] || key
        if (args) {
          text = String(text).replace(/\{(\w+)\}/g, function (m, name) {
            return args[name] === undefined ? m : String(args[name])
          })
        }
        return text
      }
    },
  }

  let registered = null
  const slots = {
    inject(name, fn) { fn() },
    register(options, Component) { registered = { options: options, Component: Component }; return function () {} },
  }

  api.apply({
    get(name) { return name === 'locale' ? locale : (name === 'slots' ? slots : undefined) },
    slots: slots,
    locale: locale,
    effect(fn) { fn(); return function () {} },
  })
  return { api: api, registered: registered, dicts: dicts }
}

function text(node) { return harness.textOf(node).replace(/\s+/g, ' ').trim() }
function pathCount(tree) { return harness.countType(tree, 'path') }

function findButton(tree, pred) {
  let hit = null
  harness.walk(tree, function (el) {
    if (hit || el.type !== 'button') return
    if (pred(text(el))) hit = el
  })
  return hit
}

function clickOnce(tree, pred) {
  const hit = findButton(tree, pred)
  assert.ok(hit, 'button not found; have: ' + text(tree).slice(0, 300))
  hit.props.onClick({ preventDefault() {}, stopPropagation() {} })
}

function rowCount(tree) {
  let n = 0
  harness.walk(tree, function (el) { if (el.type === 'tr') n++ })
  return n
}

async function boot() {
  installGlobals()
  await installFetchBridge()
  const loaded = await loadPlugin()
  const View = loaded.registered.Component
  const build = function () { return React.createElement(View, { sessionId: 'a' }) }
  const tree = await harness.renderRoot(build)
  return { loaded: loaded, build: build, tree: tree }
}

test('registers the conversation view tab after trajectory', async function () {
  installGlobals()
  await installFetchBridge()
  const loaded = await loadPlugin()
  assert.strictEqual(loaded.registered.options.id, 'token-usage')
  assert.strictEqual(loaded.registered.options.order, 20)
  assert.strictEqual(loaded.registered.options.name, 'conversation.view')
  assert.ok(loaded.registered.options.label().length > 0)
})

test('ships both dictionaries under its own namespace', async function () {
  installGlobals()
  await installFetchBridge()
  const loaded = await loadPlugin()
  const zh = loaded.dicts['dsh-token-usage:zh']
  const en = loaded.dicts['dsh-token-usage:en']
  assert.ok(zh && en, 'both locales registered')
  assert.deepStrictEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('renders every metric as one line on a single chart', async function () {
  const ctx = await boot()
  assert.strictEqual(harness.countType(ctx.tree, 'svg'), 1, 'exactly one chart')
  assert.strictEqual(pathCount(ctx.tree), 4, 'four metric lines')
  assert.strictEqual(harness.countType(ctx.tree, 'table'), 1, 'one breakdown table')
})

test('requests a window in epochs with the viewer timezone', async function () {
  const ctx = await boot()
  assert.strictEqual(fetchCalls.length, 1)
  const qs = new URLSearchParams(fetchCalls[0].split('?')[1])
  assert.ok(Number(qs.get('from')) > 0, 'from is an epoch')
  assert.ok(Number(qs.get('to')) > Number(qs.get('from')), 'to is after from')
  assert.strictEqual(qs.get('bucket'), 'day')
  assert.ok(qs.get('tzOffset') !== null, 'tzOffset is sent')
})

test('offers every API found in the data as a choice', async function () {
  const ctx = await boot()
  const body = text(ctx.tree)
  assert.ok(body.indexOf('deepseek-flash') >= 0, 'roster lists the flash model')
  assert.ok(body.indexOf('deepseek-v4-pro') >= 0, 'roster lists the pro model')
})

test('charts exactly one model at a time', async function () {
  const ctx = await boot()
  // The busiest model is preselected, so the chart is never blank on open.
  assert.strictEqual(pathCount(ctx.tree), 4, 'still four metric lines')
  const card = text(ctx.tree)
  assert.ok(card.indexOf('fan') >= 0, 'shows the provider of the selected model')

  const seen = []
  // Rows read "provider + model", so match on the model name anywhere.
  for (const model of ['deepseek-v4-pro', 'deepseek-flash']) {
    clickOnce(ctx.tree, function (s) { return s.indexOf(model) >= 0 })
    ctx.tree = await harness.renderRoot(ctx.build)
    // One pick is active at a time: the chosen row is the only one flagged.
    let on = 0
    harness.walk(ctx.tree, function (el) {
      if (el.type === 'button' && el.props && el.props['data-on'] === 'true') on++
    })
    assert.strictEqual(on, 1, 'exactly one API may be selected')
    seen.push(text(ctx.tree))
  }
  assert.notStrictEqual(seen[0], seen[1], 'switching model changed what is charted')
})

test('the picker distinguishes providers that serve the same model', async function () {
  const ctx = await boot()
  // Two providers, same model name: the rows must not read as duplicates.
  const rows = []
  harness.walk(ctx.tree, function (el) {
    if (el.type === 'button' && el.props && el.props.role === 'radio') {
      const provider = []
      harness.walk(el, function (inner) {
        if (inner.type === 'span' && inner.props && inner.props.className === 'tku-pick-provider') provider.push(text(inner))
      })
      rows.push(provider.join(''))
    }
  })
  assert.ok(rows.length >= 2, 'at least two models offered')
  assert.strictEqual(new Set(rows).size, rows.length, 'every row names a distinct provider')
})

test('picking another model never refetches', async function () {
  const ctx = await boot()
  fetchCalls.length = 0
  clickOnce(ctx.tree, function (s) { return s.indexOf('deepseek-v4-pro') >= 0 })
  await harness.renderRoot(ctx.build)
  assert.strictEqual(fetchCalls.length, 0, 'the roster already travels with the payload')
})

test('the breakdown table describes the selected model only', async function () {
  const ctx = await boot()
  assert.strictEqual(rowCount(ctx.tree), 5, 'header + one row per metric')
  const body = text(ctx.tree)
  for (const label of ['输入', '输出', '缓存读', '缓存写']) {
    assert.ok(body.indexOf(label) >= 0, label + ' listed')
  }
})

test('legend toggles metrics, not models', async function () {
  const ctx = await boot()
  fetchCalls.length = 0
  clickOnce(ctx.tree, function (s) { return s.indexOf('缓存写') === 0 })
  const tree = await harness.renderRoot(ctx.build)
  assert.strictEqual(pathCount(tree), 3, 'one metric hidden')
  assert.strictEqual(fetchCalls.length, 0, 'hiding a metric must not refetch')

  clickOnce(tree, function (s) { return s.indexOf('缓存写') === 0 })
  const back = await harness.renderRoot(ctx.build)
  assert.strictEqual(pathCount(back), 4, 'line restored')
})

test('every time preset moves the window and refetches once', async function () {
  const ctx = await boot()
  for (const label of ['今天', '昨天', '近 7 天', '近 30 天', '本月', '上月']) {
    fetchCalls.length = 0
    clickOnce(ctx.tree, function (s) { return s === label })
    ctx.tree = await harness.renderRoot(ctx.build)
    assert.strictEqual(fetchCalls.length, 1, label + ' should refetch exactly once')
    const qs = new URLSearchParams(fetchCalls[0].split('?')[1])
    assert.ok(Number(qs.get('to')) > Number(qs.get('from')), label + ' produced an inverted window')
  }
})

test('granularity follows the range instead of being a control', async function () {
  const ctx = await boot()
  // There is no granularity control on screen any more.
  const body = text(ctx.tree)
  assert.ok(body.indexOf('粒度') < 0, 'no granularity control')
  assert.ok(findButton(ctx.tree, function (s) { return s === '小时' }) === null, 'no hour button')

  // A single day is read by the hour; anything longer by the day.
  for (const [label, expected] of [['今天', 'hour'], ['昨天', 'hour'], ['近 7 天', 'day'], ['近 30 天', 'day'], ['本月', 'day'], ['上月', 'day']]) {
    fetchCalls.length = 0
    clickOnce(ctx.tree, function (s) { return s === label })
    ctx.tree = await harness.renderRoot(ctx.build)
    const qs = new URLSearchParams(fetchCalls[0].split('?')[1])
    assert.strictEqual(qs.get('bucket'), expected, label + ' should be charted by ' + expected)
  }
})

test('custom range exposes two date inputs and the cap hint', async function () {
  const ctx = await boot()
  clickOnce(ctx.tree, function (s) { return s === '自定义' })
  const tree = await harness.renderRoot(ctx.build)
  let dates = 0
  harness.walk(tree, function (el) { if (el.props && el.props.type === 'date') dates++ })
  assert.strictEqual(dates, 2)
  assert.ok(text(tree).indexOf('最长 365 天') >= 0)
})

test('switching scope asks for the session lineage', async function () {
  const ctx = await boot()
  fetchCalls.length = 0
  clickOnce(ctx.tree, function (s) { return s === '本会话' })
  await harness.renderRoot(ctx.build)
  const qs = new URLSearchParams(fetchCalls[0].split('?')[1])
  assert.strictEqual(qs.get('sessionId'), 'a')
  assert.ok(text(await harness.renderRoot(ctx.build)).indexOf('派生会话') >= 0)
})

test('a failed request shows an error state with a retry button', async function () {
  const ctx = await boot()
  failNext = true
  clickOnce(ctx.tree, function (s) { return s === '近 7 天' })
  const tree = await harness.renderRoot(ctx.build)
  assert.ok(text(tree).indexOf('无法读取 token 用量') >= 0)
  assert.ok(findButton(tree, function (s) { return s === '重试' }), 'retry button shown')
})

test('injects its stylesheet exactly once', async function () {
  const ctx = await boot()
  assert.strictEqual(installedStyles.length, 1)
  assert.ok(installedStyles[0].textContent.indexOf('.tku-root') >= 0)
})
