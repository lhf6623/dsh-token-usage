'use strict'
// Guard against the failure mode that produced a chart-less screenshot once:
// assert that docs/screenshot.png really contains four plotted lines.
//
//   node docs/check-screenshot.cjs
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

function decodePNG(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[x] = v & 0xff
    }
  }
  return { width: width, height: height, channels: channels, data: out }
}

// Line colours from client.js METRICS. Three, not four: cacheWrite is dropped
// because DeepSeek never reports it (see NOTES.md §三.14), so asserting its
// presence would fail on every correct build.
const METRICS = {
  input: [0x4c, 0x8d, 0xff],
  cacheRead: [0xf2, 0x99, 0x4a],
  output: [0x22, 0xb0, 0x7d],
}

function near(r, g, b, t) {
  return Math.abs(r - t[0]) < 26 && Math.abs(g - t[1]) < 26 && Math.abs(b - t[2]) < 26
}

const file = process.argv[2] || path.join(__dirname, 'screenshot.png')
const img = decodePNG(fs.readFileSync(file))
const { width, height, channels, data } = img
console.log('image:', width + 'x' + height)

let failed = false
for (const name of Object.keys(METRICS)) {
  const rows = new Set()
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      if (near(data[i], data[i + 1], data[i + 2], METRICS[name])) {
        count++
        rows.add(y)
      }
    }
  }
  // Every metric appears twice: once as the legend swatch, once as a drawn
  // line. A swatch-only metric means the plot silently dropped a series.
  const ok = count > 60 && rows.size > 12
  console.log((ok ? '  ok   ' : '  FAIL ') + name.padEnd(11) + ' pixels=' + String(count).padStart(6) + ' rows=' + rows.size)
  if (!ok) failed = true
}

if (failed) {
  console.error('\nA metric is missing from the screenshot: the chart did not render.')
  process.exit(1)
}
console.log('\nall three lines are present in the screenshot')