'use strict'

// A tiny hooks runtime: enough of React to invoke function components, run
// their effects, and re-render when state settles. It is not a reconciler and
// deliberately does not try to be one.
let current = null
const pending = []
let dirty = false

function makeInstance() { return { hooks: [], index: 0, cleanups: {} } }

const React = {
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    const p = Object.assign({}, props || {})
    if (children.length === 1) p.children = children[0]
    else if (children.length > 1) p.children = children
    if (typeof type === 'function') {
      const prev = current
      const inst = type.__inst || (type.__inst = makeInstance())
      current = inst
      inst.index = 0
      try { return type(p) } finally { current = prev }
    }
    return { type: type, props: p }
  },
  useState(initial) {
    const inst = current
    const i = inst.index++
    if (!(i in inst.hooks)) inst.hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
    const cell = inst.hooks[i]
    return [cell.value, function set(next) {
      const v = typeof next === 'function' ? next(cell.value) : next
      if (!Object.is(v, cell.value)) { cell.value = v; dirty = true }
    }]
  },
  useMemo(fn, deps) {
    const inst = current
    const i = inst.index++
    const prev = inst.hooks[i]
    if (prev && sameDeps(prev.deps, deps)) return prev.value
    const value = fn()
    inst.hooks[i] = { value: value, deps: deps }
    return value
  },
  useRef(initial) {
    const inst = current
    const i = inst.index++
    if (!(i in inst.hooks)) inst.hooks[i] = { current: initial }
    return inst.hooks[i]
  },
  useEffect(fn, deps) {
    const inst = current
    const i = inst.index++
    const prev = inst.hooks[i]
    if (prev && sameDeps(prev.deps, deps)) return
    inst.hooks[i] = { deps: deps, fn: fn }
    pending.push({ inst: inst, i: i, fn: fn })
  },
}

function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let k = 0; k < a.length; k++) if (!Object.is(a[k], b[k])) return false
  return true
}

async function runEffects() {
  const batch = pending.splice(0)
  for (const item of batch) {
    const cleanup = item.inst.cleanups[item.i]
    if (typeof cleanup === 'function') { try { cleanup() } catch (err) { /* ignore */ } }
    const next = await item.fn()
    item.inst.cleanups[item.i] = next
  }
}

/** Render until no state changes or effects are left pending. */
async function renderRoot(build) {
  let tree = null
  for (let pass = 0; pass < 12; pass++) {
    dirty = false
    pending.length = 0
    current = null
    tree = build()
    await runEffects()
    await new Promise(function (resolve) { setTimeout(resolve, 25) })
    await runEffects()
    if (!dirty && pending.length === 0) break
  }
  return tree
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node.props) return textOf(node.props.children)
  return ''
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(function (n) { walk(n, visit) }); return }
  visit(node)
  if (node.props) walk(node.props.children, visit)
}

/** Count elements of a tag/type in a rendered tree. */
function countType(node, type) {
  let n = 0
  walk(node, function (el) { if (el.type === type) n++ })
  return n
}

module.exports = { React: React, renderRoot: renderRoot, textOf: textOf, walk: walk, countType: countType }
