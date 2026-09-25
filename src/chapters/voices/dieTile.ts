import * as THREE from 'three'
import { rng } from '../../core/math'

/*
 * The wafer's die: one floorplan, tiled into every cell of the wafer by the
 * wafer shader (so the die under the probe is sampled at full resolution).
 * Drawn to read as a real die shot under a macro lens — not flat blocks:
 *
 *   - an I/O ring: 28 aluminium bond pads a side (the probe needles land on
 *     these — keep in step with wafer.ts TIPS), I/O cells between them, a
 *     double seal ring at the very edge
 *   - the core split into blocks: SRAM banks (fine regular arrays with
 *     decoder strips), standard-cell logic (dense rows of tiny cells),
 *     analog corners (spiral inductors, capacitor arrays), routing channels
 *   - the top-metal power grid laid across everything (paired straps)
 *   - alignment crosses in the core's corners
 *
 * Canvas y down = the die's far edge (−z). Colours are sRGB (decoded by the
 * GPU); the wafer material adds thin-film iridescence and diffraction.
 */

const PADS = 28

type G = CanvasRenderingContext2D

function patternCanvas(w: number, h: number, draw: (g: G) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  return c
}

export function dieTile(size: number, seed = 5): THREE.CanvasTexture {
  const N = size
  const k = N / 1024 // pattern scale
  const rnd = rng(seed)
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!

  // ---- reusable fine patterns ----
  const cell = Math.max(1, Math.round(k))
  // standard cells: rows of tiny rects of varying tone
  const logic = patternCanvas(160 * cell, 120 * cell, p => {
    const r2 = rng(seed + 11)
    const rowH = 5 * cell
    for (let y = 0; y < p.canvas.height; y += rowH) {
      let x = 0
      while (x < p.canvas.width) {
        const w = (1 + Math.floor(r2() * 6)) * cell
        const v = r2()
        p.fillStyle =
          v < 0.5 ? `rgba(150,140,190,${0.08 + r2() * 0.16})` : v < 0.8 ? `rgba(90,150,170,${0.06 + r2() * 0.14})` : `rgba(200,170,120,${0.08 + r2() * 0.14})`
        p.fillRect(x, y, w - (cell > 1 ? cell * 0.5 : 0.5), rowH - cell)
        x += w
      }
      // the row's power rail
      p.fillStyle = 'rgba(210,200,240,0.14)'
      p.fillRect(0, y + rowH - cell, p.canvas.width, cell)
    }
  })
  // SRAM bitcells: a fine regular lattice
  const sram = patternCanvas(6 * cell, 4 * cell, p => {
    p.fillStyle = 'rgba(220,225,255,0.22)'
    p.fillRect(0, 0, 6 * cell, cell)
    p.fillStyle = 'rgba(220,225,255,0.12)'
    p.fillRect(0, 0, cell, 4 * cell)
    p.fillStyle = 'rgba(255,255,255,0.1)'
    p.fillRect(3 * cell, 2 * cell, 2 * cell, cell)
  })
  // routing: parallel wires
  const route = patternCanvas(4, 3 * cell, p => {
    p.fillStyle = 'rgba(190,180,230,0.16)'
    p.fillRect(0, 0, 4, cell)
  })
  const routeV = patternCanvas(3 * cell, 4, p => {
    p.fillStyle = 'rgba(190,180,230,0.14)'
    p.fillRect(0, 0, cell, 4)
  })
  const pat = (c: HTMLCanvasElement) => g.createPattern(c, 'repeat')!
  const fillPat = (c: HTMLCanvasElement, x: number, y: number, w: number, h: number, alpha = 1) => {
    g.save()
    g.globalAlpha = alpha
    g.beginPath()
    g.rect(x, y, w, h)
    g.clip()
    g.translate(Math.floor(rnd() * 97), Math.floor(rnd() * 61))
    g.fillStyle = pat(c)
    g.fillRect(x - 200, y - 200, w + 400, h + 400)
    g.restore()
  }

  // ---- base + routing everywhere (channels read as fine wiring) ----
  g.fillStyle = '#1d1830'
  g.fillRect(0, 0, N, N)
  fillPat(route, 0, 0, N, N, 0.9)

  // ---- I/O ring ----
  const ring = N * 0.06
  g.fillStyle = '#2a2342'
  g.fillRect(0, 0, N, ring)
  g.fillRect(0, N - ring, N, ring)
  g.fillRect(0, 0, ring, N)
  g.fillRect(N - ring, 0, ring, N)
  // I/O cells between the pads: fine vertical strips
  fillPat(routeV, ring, ring * 0.72, N - 2 * ring, ring * 0.28, 1)
  fillPat(routeV, ring, N - ring, N - 2 * ring, ring * 0.28, 1)
  fillPat(route, ring * 0.72, ring, ring * 0.28, N - 2 * ring, 1)
  fillPat(route, N - ring, ring, ring * 0.28, N - 2 * ring, 1)
  // bond pads (aluminium) with a passivation opening edge
  const s = ring * 0.5
  for (let i = 0; i < PADS; i++) {
    const t = ring + ((N - 2 * ring) * (i + 0.5)) / PADS
    for (const [x, y] of [
      [t - s / 2, ring * 0.2],
      [t - s / 2, N - ring * 0.2 - s],
      [ring * 0.2, t - s / 2],
      [N - ring * 0.2 - s, t - s / 2],
    ]) {
      g.fillStyle = '#8c909a'
      g.fillRect(x, y, s, s)
      g.fillStyle = '#c3c7cf'
      g.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76)
    }
  }
  // seal ring: two bright lines at the edge
  g.strokeStyle = 'rgba(200,196,220,0.55)'
  g.lineWidth = Math.max(1, N * 0.002)
  g.strokeRect(N * 0.004, N * 0.004, N * 0.992, N * 0.992)
  g.strokeStyle = 'rgba(200,196,220,0.3)'
  g.strokeRect(N * 0.011, N * 0.011, N * 0.978, N * 0.978)

  // ---- core: recursive split into blocks with routing channels ----
  type Rc = { x: number; y: number; w: number; h: number }
  const c0 = ring * 1.22
  const rects: Rc[] = [{ x: c0, y: c0, w: N - 2 * c0, h: N - 2 * c0 }]
  const want = 17
  while (rects.length < want) {
    rects.sort((a, b) => b.w * b.h - a.w * a.h)
    const r = rects.shift()!
    const vert = r.w > r.h * (0.8 + rnd() * 0.4)
    const f = 0.3 + rnd() * 0.4
    const gap = N * (0.008 + rnd() * 0.008)
    if (vert) {
      const a = r.w * f
      rects.push({ x: r.x, y: r.y, w: a - gap / 2, h: r.h }, { x: r.x + a + gap / 2, y: r.y, w: r.w - a - gap / 2, h: r.h })
    } else {
      const a = r.h * f
      rects.push({ x: r.x, y: r.y, w: r.w, h: a - gap / 2 }, { x: r.x, y: r.y + a + gap / 2, w: r.w, h: r.h - a - gap / 2 })
    }
  }
  rects.sort((a, b) => a.y - b.y || a.x - b.x)
  const SRAM_TONES = ['#2c5064', '#393274', '#4a3c6c', '#25525a', '#3d4a7a']
  const LOGIC_TONES = ['#2b2442', '#302a4c', '#28283f', '#352a45']
  const kinds = [
    'logic',
    'sram',
    'logic',
    'analog',
    'sram',
    'logic',
    'sram',
    'logic',
    'pll',
    'logic',
    'sram',
    'logic',
    'analog',
    'sram',
    'logic',
    'logic',
    'sram',
  ]
  rects.forEach((r, i) => {
    const kind = kinds[i % kinds.length]
    if (kind === 'sram') {
      g.fillStyle = SRAM_TONES[Math.floor(rnd() * SRAM_TONES.length)]
      g.fillRect(r.x, r.y, r.w, r.h)
      // banks with decoder strips between them
      const cols = r.w > r.h ? 2 + Math.floor(rnd() * 2) : 1
      const rows = r.h >= r.w ? 2 + Math.floor(rnd() * 2) : 1
      const dec = N * 0.006
      const bw = (r.w - dec * (cols - 1)) / cols
      const bh = (r.h - dec * (rows - 1)) / rows
      for (let cx = 0; cx < cols; cx++)
        for (let cy = 0; cy < rows; cy++) {
          const x = r.x + cx * (bw + dec)
          const y = r.y + cy * (bh + dec)
          fillPat(sram, x, y, bw, bh, 1)
          g.strokeStyle = 'rgba(230,230,255,0.22)'
          g.lineWidth = Math.max(1, k)
          g.strokeRect(x, y, bw, bh)
        }
      g.fillStyle = 'rgba(40,30,60,0.6)'
      for (let cx = 1; cx < cols; cx++) g.fillRect(r.x + cx * (bw + dec) - dec, r.y, dec, r.h)
      for (let cy = 1; cy < rows; cy++) g.fillRect(r.x, r.y + cy * (bh + dec) - dec, r.w, dec)
      for (let cx = 1; cx < cols; cx++) fillPat(logic, r.x + cx * (bw + dec) - dec, r.y, dec, r.h, 0.9)
    } else if (kind === 'analog' || kind === 'pll') {
      g.fillStyle = kind === 'pll' ? '#2a3a4c' : '#263146'
      g.fillRect(r.x, r.y, r.w, r.h)
      fillPat(logic, r.x, r.y, r.w, r.h, 0.35)
      // spiral inductors in top metal
      const n = kind === 'pll' ? 1 : 2
      for (let j = 0; j < n; j++) {
        const sz = Math.min(r.w / (n + 0.4), r.h) * 0.62
        const cx = r.x + (r.w * (j + 0.5)) / n
        const cy = r.y + r.h * 0.5
        g.strokeStyle = 'rgba(222,178,104,0.75)'
        g.lineWidth = Math.max(1.5, sz * 0.045)
        g.beginPath()
        let h = sz / 2
        const step = sz * 0.085
        g.moveTo(cx - h, cy - h)
        for (let turn = 0; turn < 4 && h > step * 1.5; turn++) {
          g.lineTo(cx + h, cy - h)
          g.lineTo(cx + h, cy + h)
          g.lineTo(cx - h, cy + h)
          g.lineTo(cx - h, cy - h + step)
          g.lineTo(cx - h + step, cy - h + step)
          h -= step
        }
        g.stroke()
      }
      // a capacitor array along one edge
      const ch = r.h * 0.18
      for (let x = r.x + N * 0.004; x < r.x + r.w - N * 0.012; x += N * 0.012) {
        g.fillStyle = 'rgba(160,190,220,0.28)'
        g.fillRect(x, r.y + r.h - ch, N * 0.009, ch - N * 0.004)
      }
    } else {
      g.fillStyle = LOGIC_TONES[Math.floor(rnd() * LOGIC_TONES.length)]
      g.fillRect(r.x, r.y, r.w, r.h)
      fillPat(logic, r.x, r.y, r.w, r.h, 1)
      // a few hard macros inside the sea of gates
      const m = Math.floor(rnd() * 3)
      for (let j = 0; j < m; j++) {
        const w = r.w * (0.15 + rnd() * 0.2)
        const h = r.h * (0.15 + rnd() * 0.2)
        const x = r.x + rnd() * (r.w - w)
        const y = r.y + rnd() * (r.h - h)
        g.fillStyle = 'rgba(60,90,120,0.55)'
        g.fillRect(x, y, w, h)
        fillPat(sram, x, y, w, h, 0.7)
      }
    }
    g.strokeStyle = 'rgba(225,215,255,0.28)'
    g.lineWidth = Math.max(1, k * 1.2)
    g.strokeRect(r.x, r.y, r.w, r.h)
  })

  // ---- the top-metal power grid: paired straps across the core ----
  const pitch = N / 15
  const sw = N * 0.0055
  for (let x = c0 + pitch * 0.5; x < N - c0; x += pitch) {
    for (const [dx, a] of [
      [0, 0.26],
      [sw * 1.9, 0.18],
    ]) {
      g.fillStyle = `rgba(220,176,104,${a})`
      g.fillRect(x + dx, c0 - N * 0.01, sw, N - 2 * c0 + N * 0.02)
    }
  }
  for (let y = c0 + pitch * 0.5; y < N - c0; y += pitch * 2) {
    g.fillStyle = 'rgba(210,170,110,0.12)'
    g.fillRect(c0 - N * 0.01, y, N - 2 * c0 + N * 0.02, sw * 1.4)
  }
  // the core power ring
  g.strokeStyle = 'rgba(222,180,108,0.4)'
  g.lineWidth = N * 0.007
  g.strokeRect(c0 - N * 0.012, c0 - N * 0.012, N - 2 * c0 + N * 0.024, N - 2 * c0 + N * 0.024)

  // ---- alignment crosses in the core corners ----
  g.strokeStyle = 'rgba(235,235,245,0.5)'
  g.lineWidth = Math.max(1, N * 0.0018)
  for (const [x, y] of [
    [c0 - N * 0.025, c0 - N * 0.025],
    [N - c0 + N * 0.025, c0 - N * 0.025],
    [c0 - N * 0.025, N - c0 + N * 0.025],
    [N - c0 + N * 0.025, N - c0 + N * 0.025],
  ]) {
    const a = N * 0.008
    g.beginPath()
    g.moveTo(x - a, y)
    g.lineTo(x + a, y)
    g.moveTo(x, y - a)
    g.lineTo(x, y + a)
    g.stroke()
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
