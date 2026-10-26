'use strict'
// Regenerate docs/screenshot.png from the REAL components.
//
// This renders the actual client bundle through the Node test harness, feeds
// it the actual host payload built from this machine's sessions, serializes the
// result to static HTML, then screenshots it with headless Chrome. The point is
// that the screenshot cannot drift from the shipped UI: there is no mock markup
// anywhere in the pipeline.
//
//   node docs/make-screenshot.cjs
const nodeFs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const os = require('node:os')

const REPO = path.resolve(__dirname, '..')
const harness = require(path.join(REPO, 'test', 'harness.cjs'))
const React = harness.React

const SESSIONS_ROOT = path.join(os.homedir(), '.dsh', 'sessions')
const DAY = 86400000
const OUT_HTML = path.join(__dirname, 'preview.html')
const OUT_PNG = path.join(__dirname, 'screenshot.png')

function newestLog(dir) {
  const files = nodeFs.readdirSync(dir).filter(function (f) {
    return /^session(\.v\d+)?\.jsonl\.zstd$/.test(f)
  })
  let best = null
  let bestV = -1
  for (const f of files) {
    const m = /^session(?:\.v(\d+))?\.jsonl\.zstd$/.exec(f)
    const v = m[1] ? Number(m[1]) : 0
    if (v > bestV) { bestV = v; best = f }
  }
  return best ? path.join(dir, best) : null
}

function loadCorpus() {
  const sessions = []
  const logs = new Map()
  if (!nodeFs.existsSync(SESSIONS_ROOT)) return { sessions, logs }
  for (const w of nodeFs.readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!w.isDirectory()) continue
    const wsDir = path.join(SESSIONS_ROOT, w.name)
    for (const e of nodeFs.readdirSync(wsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = path.join(wsDir, e.name)
      const file = newestLog(dir)
      if (!file) continue
      let events
      try {
        events = zlib.zstdDecompressSync(nodeFs.readFileSync(file)).toString('utf8')
          .split('\n').filter(Boolean)
          .map(function (l) { try { return JSON.parse(l) } catch (err) { return null } })
          .filter(Boolean)
      } catch (err) { continue }
      const id = path.basename(dir).replace(/^session-/, '')
      sessions.push({ header: { id: id }, live: false, persisted: true })
      logs.set(id, { inheritedEventCount: 0, events: events })
    }
  }
  return { sessions, logs }
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'circle', 'line', 'path', 'rect'])

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string') return esc(node)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(serialize).join('')
  if (!node || !node.props) return ''
  const type = node.type
  const props = node.props
  if (typeof type === 'function') return serialize(type(props))
  const attrs = []
  for (const k of Object.keys(props)) {
    const v = props[k]
    if (k === 'children' || v === undefined || v === null || v === false) continue
    if (/^on[A-Z]/.test(k) || k === 'ref') continue
    if (k === 'style' && v && typeof v === 'object') {
      const css = Object.keys(v).map(function (s) {
        return s.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase() }) + ':' + v[s]
      }).join(';')
      attrs.push('style="' + esc(css) + '"')
      continue
    }
    if (k === 'className') { attrs.push('class="' + esc(v) + '"'); continue }
    attrs.push(esc(k) + '="' + esc(String(v)) + '"')
  }
  const open = '<' + type + (attrs.length ? ' ' + attrs.join(' ') : '')
  if (VOID.has(type)) return open + ' />'
  return open + '>' + serialize(props.children) + '</' + type + '>'
}

async function main() {
  const corpus = loadCorpus()
  console.log('sessions:', corpus.sessions.length)
  if (corpus.sessions.length === 0) throw new Error('no sessions found at ' + SESSIONS_ROOT)

  const host = await import('file://' + path.join(REPO, 'index.js').replace(/\\/g, '/'))
  let handler = null
  host.apply({
    sessionQuery: {
      async listSessions() { return corpus.sessions },
      async readSession(id) { return corpus.logs.get(id) },
    },
    effect(f) { f(); return function () {} },
    inject(d, f) {
      f({
        effect(g) { g() },
        webServer: { register(r) { handler = r.handler; return function () {} } },
        connection: { requestRejection() { return undefined } },
      })
    },
  }, {})
  await new Promise(function (r) { setTimeout(r, 50) })

  global.fetch = function (url) {
    const qs = String(url).split('?')[1] || ''
    return new Promise(function (resolve, reject) {
      handler({ url: '/_dsh/dsh-token-usage/usage?' + qs, method: 'GET' }, {
        headersSent: false,
        writeHead(s) { this.status = s },
        end(b) { resolve({ ok: true, status: 200, json: async function () { return JSON.parse(b) } }) },
        destroy(e) { reject(e) },
      })
    })
  }

  let cssText = ''
  global.document = {
    head: { appendChild() {}, removeChild() {} },
    querySelector() { return null },
    createElement() {
      const el = { tagName: 'style', dataset: {}, textContent: '' }
      Object.defineProperty(el, 'textContent', {
        get() { return cssText },
        set(v) { cssText = v },
      })
      return el
    },
  }
  global.window = { addEventListener() {}, removeEventListener() {} }

  const src = nodeFs.readFileSync(path.join(REPO, 'client.js'), 'utf8')
  let factory = null
  global.window.__ModuleLoader__ = { load(def) { factory = def.factory } }
  new Function('window', src)(global.window)
  const api = factory(function (n) {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })

  const dicts = {}
  const locale = {
    register(ns, lc, d) { dicts[ns + ':' + lc] = d; return function () {} },
    bind(ns) {
      return function (key, args) {
        let t = (dicts[ns + ':zh'] || {})[key] || key
        if (args) {
          t = String(t).replace(/\{(\w+)\}/g, function (m, n) {
            return args[n] === undefined ? m : String(args[n])
          })
        }
        return t
      }
    },
  }
  let view = null
  const slots = {
    inject(n, f) { f() },
    register(o, C) { view = { options: o, Component: C }; return function () {} },
  }
  api.apply({
    get(n) { return n === 'locale' ? locale : (n === 'slots' ? slots : undefined) },
    slots: slots,
    locale: locale,
    effect(f) { f(); return function () {} },
  })

  const tree = await harness.renderRoot(function () {
    return React.createElement(view.Component, { sessionId: 'preview' })
  })

  const page = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<title>dsh-token-usage</title>\n<style>\n' +
    ':root{--dsw-alias-label-primary:#e8eaed;--dsw-alias-label-secondary:#9aa0a6;' +
    '--dsw-alias-bg-base:#1b1c1e;--dsw-alias-bg-layer-1:#232427;--dsw-alias-bg-layer-2:#2c2e31;' +
    '--dsw-alias-border-l1:#3a3d41;--dsw-alias-border-l2:#2f3236;--dsw-alias-brand-primary:#4d6bfe;}\n' +
    'html,body{margin:0;padding:0;background:#1b1c1e;}\n' +
    'body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;}\n' +
    '#root{width:1060px;box-sizing:border-box;}\n' + cssText + '\n</style>\n</head>\n<body>\n' +
    '<div id="root">' + serialize(tree) + '</div>\n</body>\n</html>\n'

  nodeFs.writeFileSync(OUT_HTML, page, 'utf8')
  console.log('wrote', OUT_HTML, '(' + page.length + ' bytes)')
}

// Screenshot with headless Chrome, sized to the rendered content.
//
// The page height is measured, not guessed: a hardcoded window either clips the
// breakdown table or leaves a strip of dead background at the bottom. Chrome's
// --dump-dom is used as a measuring pass so no extra dependency is needed.
function findChrome() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]
  for (const c of candidates) if (nodeFs.existsSync(c)) return c
  return null
}

async function measureAndShoot() {
  const chrome = findChrome()
  if (!chrome) {
    console.log('no Chrome/Edge found; open this file and screenshot it yourself:')
    console.log('  file:///' + OUT_HTML.replace(/\\/g, '/'))
    return
  }
  const { execFileSync } = require('node:child_process')
  const WIDTH = 1060

  // Measuring pass: report the lowest painted edge in the document title.
  //
  // The root box is the wrong thing to measure — it carries trailing padding
  // and stretches with the viewport, so sizing the window to it leaves a dead
  // strip at the bottom. Instead take the maximum bottom edge over every
  // element, measured in a deliberately tall window so no element is clipped
  // or squeezed while being measured.
  const probe = OUT_HTML.replace('</body>', '<script>window.addEventListener("load",function(){' +
    'var all=document.querySelectorAll("*");var d=0;' +
    'for(var i=0;i<all.length;i++){' +
    'var b=all[i].getBoundingClientRect().bottom;if(b>d)d=b}' +
    'document.title="H:"+Math.ceil(d)})</script></body>')
  const probePath = OUT_HTML.replace(/\.html$/, '.probe.html')
  nodeFs.writeFileSync(probePath, probe, 'utf8')
  let height = 800
  try {
    const dom = execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--window-size=' + WIDTH + ',3000',
      '--virtual-time-budget=4000', '--dump-dom',
      'file:///' + probePath.replace(/\\/g, '/'),
    ], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
    const m = /<title>H:(\d+)<\/title>/.exec(dom)
    if (m) height = Number(m[1])
  } catch (err) {
    console.log('measure pass failed, falling back to', height, 'px:', err.message)
  } finally {
    try { nodeFs.unlinkSync(probePath) } catch (err) {}
  }

  // Two CSS px of slack: fractional layout heights otherwise shave the last row.
  const windowSize = WIDTH + ',' + (height + 2)
  console.log('screenshot at', windowSize, '(content', height, 'px)')
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    '--window-size=' + windowSize,
    '--screenshot=' + OUT_PNG,
    '--virtual-time-budget=3000',
    'file:///' + OUT_HTML.replace(/\\/g, '/'),
  ], { maxBuffer: 64 * 1024 * 1024 })
  console.log('wrote', OUT_PNG, '(' + nodeFs.statSync(OUT_PNG).size + ' bytes)')
}

main().then(measureAndShoot).catch(function (e) { console.error('FAILED:', e.message); process.exit(1) })

