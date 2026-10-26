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

test('lists every API found in the data', async function () {
  const ctx = await boot()
  const body = text(ctx.tree)
  assert.ok(body.indexOf('deepseek-flash') >= 0)
  assert.ok(body.indexOf('deepseek-v4-pro') >= 0)
  assert.strictEqual(rowCount(ctx.tree), 3, 'header + one row per API')
})

test('legend clicks hide a line without refetching', async function () {
  const ctx = await boot()
  fetchCalls.length = 0
  clickOnce(ctx.tree, function (s) { return s.indexOf('缓存写') === 0 })
  const tree = await harness.renderRoot(ctx.build)
  assert.strictEqual(pathCount(tree), 3, 'one line hidden')
  assert.strictEqual(fetchCalls.length, 0, 'hiding a metric must not refetch')

  clickOnce(tree, function (s) { return s.indexOf('缓存写') === 0 })
  const back = await harness.renderRoot(ctx.build)
  assert.strictEqual(pathCount(back), 4, 'line restored')
})

test('isolating an API is a local filter, not a request', async function () {
  const ctx = await boot()
  fetchCalls.length = 0
  clickOnce(ctx.tree, function (s) { return s.indexOf('deepseek-official / deepseek-v4-pro') === 0 })
  const tree = await harness.renderRoot(ctx.build)
  assert.strictEqual(fetchCalls.length, 0, 'API filtering must not refetch')
  assert.strictEqual(rowCount(tree), 2, 'only the isolated API remains in the table')
  assert.ok(text(tree).indexOf('已选 1 / 2') >= 0)
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
  clickOnce(ctx.tree, function (s) { return s === '小时' })
  const tree = await harness.renderRoot(ctx.build)
  assert.ok(text(tree).indexOf('无法读取 token 用量') >= 0)
  assert.ok(findButton(tree, function (s) { return s === '重试' }), 'retry button shown')
})

test('injects its stylesheet exactly once', async function () {
  const ctx = await boot()
  assert.strictEqual(installedStyles.length, 1)
  assert.ok(installedStyles[0].textContent.indexOf('.tku-root') >= 0)
})
