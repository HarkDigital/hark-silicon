import * as THREE from 'three'
import { logoShapes } from '../../logo/logo'
import { rng } from '../../core/math'

/*
 * The Hark die: a hand-laid floorplan of ELEVEN functional blocks, one per
 * service, drawn as a die shot (standard-cell carpets, SRAM arrays, analog,
 * an inductor, a shield mesh, fuse banks…) on a canvas, plus a small
 * thickness map that gives each block its own thin-film hue under the
 * iridescent silicon material.
 *
 * Canvas units: 0..1, x right, y DOWN (canvas rows). The die mesh maps them
 * to world as x = (u − 0.5)·DIE, z = (v − 0.5)·DIE, so v = 0 is the back
 * edge (far from the camera) and v = 1 the front.
 *
 * Tour order is a serpentine: back row left → right (01–04), middle row
 * right → left (05–07), front row left → right (08–11).
 */

export type Kind = 'cpu' | 'gpu' | 'ecom' | 'cam' | 'pll' | 'npu' | 'isp' | 'fuse' | 'shield' | 'serdes' | 'cache'

export interface Block {
  /** etched block name (decorative die label) */
  code: string
  kind: Kind
  x: number
  y: number
  w: number
  h: number
}

/** die edge length, world units */
export const DIE = 10
/** core area (inside the pad ring), canvas units */
export const CORE0 = 0.085
export const CORE1 = 0.915
/** bond pads per side */
export const PADS = 26
/** pad centre inset from the die edge (canvas units) */
export const PAD_IN = 0.042

export const BLOCKS: Block[] = [
  { code: 'SW_DEV', kind: 'cpu', x: 0.085, y: 0.085, w: 0.25, h: 0.26 },
  { code: 'WEB_UI', kind: 'gpu', x: 0.349, y: 0.085, w: 0.2, h: 0.26 },
  { code: 'ECOM_TX', kind: 'ecom', x: 0.563, y: 0.085, w: 0.17, h: 0.26 },
  { code: 'SEO_GEO', kind: 'cam', x: 0.747, y: 0.085, w: 0.168, h: 0.26 },
  { code: 'SPEED_PLL', kind: 'pll', x: 0.715, y: 0.375, w: 0.2, h: 0.25 },
  { code: 'AI_NPU', kind: 'npu', x: 0.299, y: 0.375, w: 0.402, h: 0.25 },
  { code: 'AERIAL_ISP', kind: 'isp', x: 0.085, y: 0.375, w: 0.2, h: 0.25 },
  { code: 'HACK_FIX', kind: 'fuse', x: 0.085, y: 0.655, w: 0.16, h: 0.26 },
  { code: 'SECURE', kind: 'shield', x: 0.259, y: 0.655, w: 0.22, h: 0.26 },
  { code: 'ADA_A11Y', kind: 'serdes', x: 0.493, y: 0.655, w: 0.17, h: 0.26 },
  { code: 'WP_CORE', kind: 'cache', x: 0.677, y: 0.655, w: 0.238, h: 0.26 },
]

/** the PLL inductor (block 05), canvas units: centre + outer radius */
export const INDUCTOR = { u: 0.775, v: 0.47, r: 0.047, turns: 3 }

/** world position of a canvas point on the die top */
export function uvToWorld(u: number, v: number, y: number, out = new THREE.Vector3()) {
  return out.set((u - 0.5) * DIE, y, (v - 0.5) * DIE)
}

/** centre (canvas units) of pad i on side s: 0 back, 1 right, 2 front, 3 left */
export function padUV(side: number, i: number): [number, number] {
  const t = CORE0 + ((CORE1 - CORE0) * (i + 0.5)) / PADS
  if (side === 0) return [t, PAD_IN]
  if (side === 1) return [1 - PAD_IN, t]
  if (side === 2) return [t, 1 - PAD_IN]
  return [PAD_IN, t]
}

type G = CanvasRenderingContext2D

/* ------------------------------------------------------------------ patterns */

function tile(w: number, h: number, draw: (g: G) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  draw(c.getContext('2d')!)
  return c
}

interface Pats {
  carpet: CanvasPattern
  carpet2: CanvasPattern
  bit: CanvasPattern
  bitWide: CanvasPattern
  match: CanvasPattern
  fill: CanvasPattern
  fuse: CanvasPattern
  mim: CanvasPattern
}

function patterns(g: G, s: number): Pats {
  const R = rng(4)
  // standard-cell carpet: rows of cells of random width, light on transparent
  const carpetTile = (density: number, warm: boolean) =>
    tile(256 * s, 256 * s, t => {
      const rowH = Math.max(2, Math.round(5 * s))
      const W = t.canvas.width
      const H = t.canvas.height
      for (let y = 0; y < H; y += rowH) {
        let x = 0
        while (x < W) {
          const cw = Math.max(1, Math.round((1.5 + R() * 8) * s))
          const a = (0.04 + R() * 0.22) * density
          const hue = warm ? 30 + R() * 30 : 230 + R() * 60
          t.fillStyle = `hsla(${hue.toFixed(0)},${(40 + R() * 40).toFixed(0)}%,${(62 + R() * 30).toFixed(0)}%,${a.toFixed(3)})`
          t.fillRect(x, y, Math.max(1, cw - 1), rowH - (rowH > 2 ? 1 : 0))
          // occasional flop: a brighter, taller cell
          if (R() < 0.02) {
            t.fillStyle = 'rgba(235,225,255,0.22)'
            t.fillRect(x, y, cw * 2, rowH * 2)
          }
          x += cw
        }
        // the power rail between rows
        if (Math.round(y / rowH) % 2 === 0) {
          t.fillStyle = 'rgba(10,8,20,0.28)'
          t.fillRect(0, y + rowH - 1, W, Math.max(1, s))
        }
      }
    })
  const bitTile = (pitch: number) =>
    tile(pitch * s, pitch * s, t => {
      const P = t.canvas.width
      t.fillStyle = 'rgba(210,240,255,0.2)'
      t.fillRect(0, 0, Math.max(1, P * 0.18), P) // bit line
      t.fillStyle = 'rgba(210,240,255,0.12)'
      t.fillRect(0, P * 0.5, P, Math.max(1, P * 0.14)) // word line
      t.fillStyle = 'rgba(255,255,255,0.16)'
      t.fillRect(P * 0.45, P * 0.15, Math.max(1, P * 0.3), Math.max(1, P * 0.25)) // contact
    })
  return {
    carpet: g.createPattern(carpetTile(1, false), 'repeat')!,
    carpet2: g.createPattern(carpetTile(1.25, true), 'repeat')!,
    bit: g.createPattern(bitTile(4), 'repeat')!,
    bitWide: g.createPattern(bitTile(7), 'repeat')!,
    match: g.createPattern(
      tile(12 * s, 6 * s, t => {
        t.fillStyle = 'rgba(255,236,190,0.2)'
        t.fillRect(0, 0, t.canvas.width, Math.max(1, 2 * s))
        t.fillStyle = 'rgba(255,236,190,0.1)'
        t.fillRect(0, 0, Math.max(1, s), t.canvas.height)
      }),
      'repeat',
    )!,
    fill: g.createPattern(
      tile(9 * s, 9 * s, t => {
        t.fillStyle = 'rgba(200,190,230,0.1)'
        t.fillRect(0, 0, Math.max(1, 4 * s), Math.max(1, 4 * s))
      }),
      'repeat',
    )!,
    fuse: g.createPattern(
      tile(10 * s, 8 * s, t => {
        const w = t.canvas.width
        const h = t.canvas.height
        t.fillStyle = 'rgba(245,225,255,0.42)'
        t.beginPath()
        t.moveTo(w * 0.1, h * 0.2)
        t.lineTo(w * 0.45, h * 0.45)
        t.lineTo(w * 0.1, h * 0.7)
        t.closePath()
        t.moveTo(w * 0.9, h * 0.2)
        t.lineTo(w * 0.55, h * 0.45)
        t.lineTo(w * 0.9, h * 0.7)
        t.closePath()
        t.fill()
        t.fillRect(w * 0.1, h * 0.42, w * 0.8, Math.max(1, h * 0.08))
      }),
      'repeat',
    )!,
    mim: g.createPattern(
      tile(14 * s, 14 * s, t => {
        const w = t.canvas.width
        t.fillStyle = 'rgba(230,200,160,0.3)'
        t.fillRect(w * 0.12, w * 0.12, w * 0.76, w * 0.76)
        t.fillStyle = 'rgba(40,25,15,0.35)'
        t.fillRect(w * 0.3, w * 0.3, w * 0.4, w * 0.4)
      }),
      'repeat',
    )!,
  }
}

/* ------------------------------------------------------------------ helpers */

function withPattern(g: G, p: CanvasPattern, x: number, y: number, w: number, h: number, ox = 0, oy = 0) {
  g.save()
  g.translate(Math.round(x + ox), Math.round(y + oy))
  g.fillStyle = p
  g.fillRect(-ox, -oy, w, h)
  g.restore()
}

function frame(g: G, x: number, y: number, w: number, h: number, color: string, lw: number) {
  g.strokeStyle = color
  g.lineWidth = lw
  g.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
}

/** a logic region: base colour + standard-cell carpet */
function logic(g: G, P: Pats, R: () => number, x: number, y: number, w: number, h: number, base: string, warm = false) {
  g.fillStyle = base
  g.fillRect(x, y, w, h)
  withPattern(g, warm ? P.carpet2 : P.carpet, x, y, w, h, R() * 200, R() * 200)
}

/** an SRAM macro: bit-cell array split into banks by decoder spines, sense amps along the bottom */
function sram(g: G, P: Pats, R: () => number, x: number, y: number, w: number, h: number, base: string, s: number, banks = 2, wide = false) {
  g.fillStyle = base
  g.fillRect(x, y, w, h)
  const spine = Math.max(2, 7 * s)
  const sa = Math.max(2, 9 * s)
  const bw = (w - spine * (banks - 1)) / banks
  for (let b = 0; b < banks; b++) {
    const bx = x + b * (bw + spine)
    withPattern(g, wide ? P.bitWide : P.bit, bx, y, bw, h - sa)
    if (b < banks - 1) {
      g.fillStyle = 'rgba(20,16,34,0.55)'
      g.fillRect(bx + bw, y, spine, h)
      withPattern(g, P.carpet, bx + bw, y, spine, h, R() * 50, 0)
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.08)'
  g.fillRect(x, y + h - sa, w, sa)
  withPattern(g, P.carpet2, x, y + h - sa, w, sa)
  frame(g, x, y, w, h, 'rgba(220,235,255,0.28)', Math.max(1, 1.5 * s))
}

/** scattered analog devices with guard rings */
function analog(g: G, R: () => number, x: number, y: number, w: number, h: number, s: number, n = 10) {
  for (let k = 0; k < n; k++) {
    const dw = w * (0.12 + R() * 0.26)
    const dh = h * (0.1 + R() * 0.22)
    const dx = x + R() * (w - dw)
    const dy = y + R() * (h - dh)
    g.fillStyle = `rgba(${(190 + R() * 60).toFixed(0)},${(150 + R() * 50).toFixed(0)},${(110 + R() * 50).toFixed(0)},0.16)`
    g.fillRect(dx, dy, dw, dh)
    // transistor fingers
    const f = 4 + Math.floor(R() * 8)
    g.fillStyle = 'rgba(255,230,190,0.2)'
    for (let i = 0; i < f; i++) g.fillRect(dx + (dw * (i + 0.5)) / f, dy + dh * 0.12, Math.max(1, 1.5 * s), dh * 0.76)
    frame(g, dx - 3 * s, dy - 3 * s, dw + 6 * s, dh + 6 * s, 'rgba(240,210,160,0.3)', Math.max(1, 2 * s))
  }
}

/* ------------------------------------------------------------------ blocks */

function drawBlock(g: G, P: Pats, b: Block, N: number, s: number, R: () => number) {
  const x = b.x * N
  const y = b.y * N
  const w = b.w * N
  const h = b.h * N
  const m = 8 * s // inner margin
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  switch (b.kind) {
    case 'cpu': {
      // core logic, two L1 caches along the top, a register file and an FPU
      logic(g, P, R, x, y, w, h, '#3b3270')
      sram(g, P, R, x + m, y + h * 0.16, w * 0.46 - m, h * 0.3, '#245a6c', s, 2)
      sram(g, P, R, x + w * 0.52, y + h * 0.16, w * 0.48 - m, h * 0.3, '#245a6c', s, 2)
      logic(g, P, R, x + w * 0.56, y + h * 0.56, w * 0.4, h * 0.36, '#4a2f66', true)
      frame(g, x + w * 0.56, y + h * 0.56, w * 0.4, h * 0.36, 'rgba(230,210,255,0.3)', Math.max(1, 1.5 * s))
      sram(g, P, R, x + m, y + h * 0.6, w * 0.2, h * 0.3, '#5b5230', s, 1, true)
      break
    }
    case 'gpu': {
      // a grid of identical shader tiles, each with a small cache strip
      g.fillStyle = '#1e1a33'
      g.fillRect(x, y, w, h)
      const cols = 3
      const rows = 4
      const gap = 6 * s
      const top = h * 0.14
      const tw = (w - gap * (cols + 1)) / cols
      const th = (h - top - gap * (rows + 1)) / rows
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tx = x + gap + c * (tw + gap)
          const ty = y + top + gap + r * (th + gap)
          logic(g, P, R, tx, ty, tw, th, '#352c6a')
          sram(g, P, R, tx, ty, tw, th * 0.26, '#2a6474', s, 1)
          frame(g, tx, ty, tw, th, 'rgba(220,210,255,0.26)', Math.max(1, s))
        }
      }
      break
    }
    case 'ecom': {
      logic(g, P, R, x, y, w, h, '#3a2f68')
      sram(g, P, R, x + m, y + h * 0.18, w - 2 * m, h * 0.22, '#256272', s, 2)
      // hash engine: dense warm logic
      logic(g, P, R, x + m, y + h * 0.5, w * 0.55, h * 0.42, '#5a3a3a', true)
      frame(g, x + m, y + h * 0.5, w * 0.55, h * 0.42, 'rgba(255,220,200,0.3)', Math.max(1, 1.5 * s))
      sram(g, P, R, x + w * 0.65, y + h * 0.5, w * 0.35 - m, h * 0.42, '#5f5530', s, 1, true)
      break
    }
    case 'cam': {
      // content-addressable arrays: match lines, a priority encoder spine
      g.fillStyle = '#5a4c26'
      g.fillRect(x, y, w, h)
      const sp = w * 0.14
      withPattern(g, P.match, x, y + h * 0.14, w - sp, h * 0.4)
      withPattern(g, P.match, x, y + h * 0.58, w - sp, h * 0.4)
      g.fillStyle = 'rgba(20,16,10,0.5)'
      g.fillRect(x, y + h * 0.54, w - sp, h * 0.04)
      logic(g, P, R, x + w - sp, y + h * 0.14, sp, h * 0.86, '#3d3368')
      frame(g, x, y + h * 0.14, w - sp, h * 0.84, 'rgba(255,240,200,0.26)', Math.max(1, 1.5 * s))
      break
    }
    case 'pll': {
      g.fillStyle = '#3d2e25'
      g.fillRect(x, y, w, h)
      analog(g, R, x + w * 0.55, y + h * 0.18, w * 0.42, h * 0.5, s, 6)
      // loop-filter capacitor array
      withPattern(g, P.mim, x + w * 0.06, y + h * 0.7, w * 0.88, h * 0.26)
      frame(g, x + w * 0.06, y + h * 0.7, w * 0.88, h * 0.26, 'rgba(240,210,160,0.34)', Math.max(1, 2 * s))
      // inductor: an octagonal spiral in thick top metal (the 3D coil sits on it)
      const cx = INDUCTOR.u * N
      const cy = INDUCTOR.v * N
      g.fillStyle = 'rgba(20,12,8,0.5)'
      octagon(g, cx, cy, INDUCTOR.r * N * 1.18)
      g.fill()
      g.strokeStyle = 'rgba(214,150,90,0.55)'
      g.lineWidth = INDUCTOR.r * N * 0.1
      spiral(g, cx, cy, INDUCTOR.r * N, INDUCTOR.turns)
      g.stroke()
      frame(g, cx - INDUCTOR.r * N * 1.3, cy - INDUCTOR.r * N * 1.3, INDUCTOR.r * N * 2.6, INDUCTOR.r * N * 2.6, 'rgba(240,210,160,0.3)', Math.max(1, 2 * s))
      break
    }
    case 'npu': {
      // systolic array of MAC tiles, weight buffer on top, activations along the bottom
      g.fillStyle = '#1d1932'
      g.fillRect(x, y, w, h)
      const top = h * 0.14
      sram(g, P, R, x + m, y + top + m * 0.5, w - 2 * m, h * 0.12, '#2a6274', s, 4)
      sram(g, P, R, x + m, y + h - h * 0.13 - m * 0.5, w - 2 * m, h * 0.12, '#5f5431', s, 4)
      const cols = 10
      const rows = 4
      const gx = x + m
      const gy = y + top + h * 0.15
      const gw = w - 2 * m
      const gh = h * 0.56
      const gap = 4 * s
      const tw = (gw - gap * (cols - 1)) / cols
      const th = (gh - gap * (rows - 1)) / rows
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tx = gx + c * (tw + gap)
          const ty = gy + r * (th + gap)
          logic(g, P, R, tx, ty, tw, th, (r + c) % 2 ? '#3a3172' : '#36306a')
          g.fillStyle = '#2b6376'
          g.fillRect(tx + tw * 0.08, ty + th * 0.1, tw * 0.36, th * 0.36)
          withPattern(g, P.bit, tx + tw * 0.08, ty + th * 0.1, tw * 0.36, th * 0.36)
          frame(g, tx, ty, tw, th, 'rgba(220,215,255,0.3)', Math.max(1, s))
        }
      }
      break
    }
    case 'isp': {
      logic(g, P, R, x, y, w, h, '#372f69')
      // line buffers: long thin SRAM strips
      for (let k = 0; k < 4; k++) sram(g, P, R, x + w * 0.22, y + h * (0.18 + k * 0.1), w * 0.74, h * 0.07, '#27606f', s, 3)
      // camera PHY lanes along the left edge
      g.fillStyle = '#44342a'
      g.fillRect(x, y + h * 0.14, w * 0.18, h * 0.84)
      for (let k = 0; k < 5; k++) {
        const ly = y + h * (0.17 + k * 0.16)
        g.fillStyle = 'rgba(230,190,140,0.22)'
        g.fillRect(x + w * 0.02, ly, w * 0.14, h * 0.11)
        frame(g, x + w * 0.02, ly, w * 0.14, h * 0.11, 'rgba(240,210,160,0.34)', Math.max(1, 1.5 * s))
      }
      logic(g, P, R, x + w * 0.22, y + h * 0.6, w * 0.74, h * 0.34, '#4b3168', true)
      break
    }
    case 'fuse': {
      logic(g, P, R, x, y, w, h, '#3a2e62')
      // two eFuse banks (repair) and a BIST controller
      g.fillStyle = '#2f2750'
      g.fillRect(x + m, y + h * 0.16, w - 2 * m, h * 0.32)
      withPattern(g, P.fuse, x + m, y + h * 0.16, w - 2 * m, h * 0.32)
      frame(g, x + m, y + h * 0.16, w - 2 * m, h * 0.32, 'rgba(240,220,255,0.3)', Math.max(1, 1.5 * s))
      g.fillStyle = '#2f2750'
      g.fillRect(x + m, y + h * 0.54, w * 0.5, h * 0.4)
      withPattern(g, P.fuse, x + m, y + h * 0.54, w * 0.5, h * 0.4)
      frame(g, x + m, y + h * 0.54, w * 0.5, h * 0.4, 'rgba(240,220,255,0.3)', Math.max(1, 1.5 * s))
      break
    }
    case 'shield': {
      // a crypto core under an active shield: meandering parallel wires over everything
      logic(g, P, R, x, y, w, h, '#26345a')
      logic(g, P, R, x + w * 0.5, y + h * 0.5, w * 0.44, h * 0.42, '#3a2f66', true)
      const pitch = Math.max(3, 7 * s)
      const lw = Math.max(1, 2.6 * s)
      const x0 = x + 3 * s
      const x1 = x + w - 3 * s
      let k = 0
      for (let yy = y + h * 0.13; yy < y + h - pitch; yy += pitch * 2, k++) {
        g.strokeStyle = k % 2 ? 'rgba(170,205,255,0.5)' : 'rgba(205,190,255,0.42)'
        g.lineWidth = lw
        g.beginPath()
        // a serpentine: across, down, back
        g.moveTo(x0, yy)
        g.lineTo(x1, yy)
        g.lineTo(x1, yy + pitch)
        g.lineTo(x0 + pitch * 0.5, yy + pitch)
        g.stroke()
      }
      break
    }
    case 'serdes': {
      g.fillStyle = '#332a36'
      g.fillRect(x, y, w, h)
      // four lanes: driver, receiver, CDR logic
      const lanes = 4
      const top = h * 0.14
      const lh = (h - top) / lanes
      for (let k = 0; k < lanes; k++) {
        const ly = y + top + k * lh
        g.fillStyle = k % 2 ? '#3c2f2c' : '#43332c'
        g.fillRect(x, ly + 2 * s, w, lh - 4 * s)
        analog(g, R, x + w * 0.04, ly + lh * 0.12, w * 0.46, lh * 0.76, s, 3)
        logic(g, P, R, x + w * 0.56, ly + lh * 0.14, w * 0.4, lh * 0.72, '#3b3066')
        frame(g, x + 2 * s, ly + 2 * s, w - 4 * s, lh - 4 * s, 'rgba(240,210,160,0.3)', Math.max(1, 1.5 * s))
      }
      break
    }
    case 'cache': {
      logic(g, P, R, x, y, w, h, '#3a3170')
      const top = h * 0.14
      const sp = w * 0.12
      const cw = (w - sp - 2 * m) / 2
      const ch = (h - top - 3 * m) / 2
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 2; c++)
          sram(g, P, R, x + m + c * (cw + sp), y + top + m + r * (ch + m), cw, ch, r ? '#2a5f70' : '#5f5530', s, 2, r === 0)
      break
    }
  }
  g.restore()
}

function octagon(g: G, cx: number, cy: number, r: number) {
  g.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4
    const px = cx + Math.cos(a) * r
    const py = cy + Math.sin(a) * r
    if (i) g.lineTo(px, py)
    else g.moveTo(px, py)
  }
  g.closePath()
}

/** octagonal spiral points (canvas or world units, whatever r is in) */
export function spiralPoints(r: number, turns: number): [number, number][] {
  const pts: [number, number][] = []
  const steps = turns * 8
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4
    const rr = r * (1 - (0.62 * i) / steps)
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr])
  }
  return pts
}

function spiral(g: G, cx: number, cy: number, r: number, turns: number) {
  g.beginPath()
  spiralPoints(r, turns).forEach(([px, py], i) => (i ? g.lineTo(cx + px, cy + py) : g.moveTo(cx + px, cy + py)))
}

function drawMark(g: G, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, -size)
  g.beginPath()
  for (const sh of logoShapes()) {
    sh.getPoints(40).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    for (const hole of sh.holes) {
      hole.getPoints(20).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
  }
  g.fill('evenodd')
  g.restore()
}

/* ------------------------------------------------------------------ the die shot */

/** Draw the die map (sRGB colour). N = 2048 on desktop, 1024 on phones. */
export function drawDieMap(N: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const s = N / 2048
  const R = rng(17)
  const P = patterns(g, s)
  const px = (u: number) => u * N

  // dielectric over the whole die
  g.fillStyle = '#1b1730'
  g.fillRect(0, 0, N, N)

  // ---- the pad ring
  g.fillStyle = '#29243f'
  g.fillRect(0, 0, N, px(0.08))
  g.fillRect(0, N - px(0.08), N, px(0.08))
  g.fillRect(0, 0, px(0.08), N)
  g.fillRect(N - px(0.08), 0, px(0.08), N)
  // seal ring at the very edge (two metal lines)
  frame(g, px(0.004), px(0.004), N - px(0.008), N - px(0.008), 'rgba(205,195,170,0.75)', Math.max(1, 5 * s))
  frame(g, px(0.012), px(0.012), N - px(0.024), N - px(0.024), 'rgba(180,170,150,0.45)', Math.max(1, 2.5 * s))
  // power rails inside the pads
  frame(g, px(0.066), px(0.066), N - px(0.132), N - px(0.132), 'rgba(205,172,112,0.55)', px(0.006))
  frame(g, px(0.075), px(0.075), N - px(0.15), N - px(0.15), 'rgba(150,160,190,0.45)', px(0.004))
  // pads, ESD cells between them, straps to the rails
  const ps = px(0.03)
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < PADS; i++) {
      const [u, v] = padUV(side, i)
      const cx = px(u)
      const cy = px(v)
      // ESD / driver cell toward the core
      const horiz = side === 0 || side === 2
      const ew = horiz ? ps * 0.9 : px(0.018)
      const eh = horiz ? px(0.018) : ps * 0.9
      const ex = horiz ? cx - ew / 2 : side === 1 ? cx - ps / 2 - ew - px(0.004) : cx + ps / 2 + px(0.004)
      const ey = horiz ? (side === 0 ? cy + ps / 2 + px(0.004) : cy - ps / 2 - eh - px(0.004)) : cy - eh / 2
      g.fillStyle = '#3a3050'
      g.fillRect(ex, ey, ew, eh)
      withPattern(g, P.carpet2, ex, ey, ew, eh)
      // the pad: aluminium with a passivation opening
      g.fillStyle = '#9fa4b0'
      g.fillRect(cx - ps / 2, cy - ps / 2, ps, ps)
      g.fillStyle = '#cfd3db'
      g.fillRect(cx - ps * 0.4, cy - ps * 0.4, ps * 0.8, ps * 0.8)
      // probe scrub mark
      if (R() < 0.6) {
        g.fillStyle = 'rgba(90,92,104,0.45)'
        g.fillRect(cx - ps * 0.12 + (R() - 0.5) * ps * 0.2, cy - ps * 0.06, ps * 0.24, ps * 0.12)
      }
    }
  }
  // corner marks: alignment crosses, and the Hark mark as die art (front-right corner)
  g.fillStyle = 'rgba(210,200,180,0.55)'
  for (const [u, v] of [
    [0.04, 0.04],
    [0.96, 0.04],
    [0.04, 0.96],
  ]) {
    g.fillRect(px(u) - px(0.012), px(v) - Math.max(1, 1.5 * s), px(0.024), Math.max(2, 3 * s))
    g.fillRect(px(u) - Math.max(1, 1.5 * s), px(v) - px(0.012), Math.max(2, 3 * s), px(0.024))
  }
  g.fillStyle = 'rgba(214,200,170,0.7)'
  drawMark(g, px(0.958), px(0.958), px(0.05))

  // ---- core: routing channels with dummy metal fill
  g.fillStyle = '#211c37'
  g.fillRect(px(CORE0), px(CORE0), px(CORE1 - CORE0), px(CORE1 - CORE0))
  withPattern(g, P.fill, px(CORE0), px(CORE0), px(CORE1 - CORE0), px(CORE1 - CORE0))

  // ---- the eleven blocks
  for (const b of BLOCKS) drawBlock(g, P, b, N, s, R)

  // ---- top-metal power straps over the core
  g.fillStyle = 'rgba(215,190,140,0.07)'
  for (let u = CORE0 + 0.02; u < CORE1; u += 0.036) g.fillRect(px(u), px(CORE0), Math.max(2, 5 * s), px(CORE1 - CORE0))
  g.fillStyle = 'rgba(190,200,230,0.05)'
  for (let v = CORE0 + 0.03; v < CORE1; v += 0.052) g.fillRect(px(CORE0), px(v), px(CORE1 - CORE0), Math.max(2, 4 * s))

  // ---- block boundaries (the shader draws the crisp outline; this is the etched step)
  for (const b of BLOCKS) frame(g, px(b.x), px(b.y), px(b.w), px(b.h), 'rgba(235,225,255,0.3)', Math.max(1, 2 * s))
  return cv
}

/**
 * Thin-film thickness map (read from .g by three's iridescence): every block
 * its own film thickness, so each one shifts to its own hue as the view moves.
 */
export function drawThickness(N: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const R = rng(5)
  const gray = (v: number) => {
    const c = Math.round(Math.max(0, Math.min(1, v)) * 255)
    return `rgb(${c},${c},${c})`
  }
  g.fillStyle = gray(0.46)
  g.fillRect(0, 0, N, N)
  g.fillStyle = gray(0.2)
  g.fillRect(0, 0, N, N * CORE0)
  g.fillRect(0, N * CORE1, N, N * CORE0)
  g.fillRect(0, 0, N * CORE0, N)
  g.fillRect(N * CORE1, 0, N * CORE0, N)
  const film = [0.74, 0.4, 0.6, 0.9, 0.3, 0.66, 0.5, 0.84, 0.36, 0.56, 0.94]
  BLOCKS.forEach((b, i) => {
    g.fillStyle = gray(film[i])
    g.fillRect(b.x * N, b.y * N, b.w * N, b.h * N)
    // a few sub-regions with their own film (macros)
    for (let k = 0; k < 3; k++) {
      g.fillStyle = gray(film[i] + (R() - 0.5) * 0.3)
      g.fillRect((b.x + R() * b.w * 0.6) * N, (b.y + R() * b.h * 0.6) * N, b.w * (0.2 + R() * 0.3) * N, b.h * (0.15 + R() * 0.25) * N)
    }
  })
  // a slow thickness gradient across the whole die (film drift)
  const grd = g.createLinearGradient(0, 0, N, N)
  grd.addColorStop(0, 'rgba(255,255,255,0.1)')
  grd.addColorStop(0.5, 'rgba(0,0,0,0)')
  grd.addColorStop(1, 'rgba(0,0,0,0.12)')
  g.fillStyle = grd
  g.fillRect(0, 0, N, N)
  return cv
}

/** The etched lid of the Hark package: the mark, part lines, the pin-1 dot. */
export function drawLid(N: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const paint = () => {
    g.fillStyle = '#17191c'
    g.fillRect(0, 0, N, N)
    // laser etch: slightly lighter, matte
    g.fillStyle = 'rgba(176,182,190,0.5)'
    drawMark(g, N * 0.5, N * 0.43, N * 0.3)
    g.font = `500 ${Math.round(N * 0.042)}px 'Martian Mono Variable', ui-monospace, monospace`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('HARK  HK-0N', N * 0.5, N * 0.7)
    g.font = `400 ${Math.round(N * 0.03)}px 'Martian Mono Variable', ui-monospace, monospace`
    g.fillText('DIE REV A  ·  PHL', N * 0.5, N * 0.77)
    g.beginPath()
    g.arc(N * 0.1, N * 0.1, N * 0.022, 0, Math.PI * 2)
    g.fill()
  }
  paint()
  document.fonts?.ready.then(() => {
    paint()
    cv.dispatchEvent(new Event('repaint'))
  })
  return cv
}

/**
 * An etched die label: "01 SW_DEV" over the service name in tiny caps.
 * White on transparent (the shader tints it). Returns the canvas and its
 * aspect (w / h).
 */
export function drawLabel(num: string, code: string, name: string, scale = 1): HTMLCanvasElement {
  const big = Math.round(84 * scale)
  const small = Math.round(34 * scale)
  const f1 = `600 ${big}px 'Martian Mono Variable', ui-monospace, monospace`
  const f2 = `500 ${small}px 'Martian Mono Variable', ui-monospace, monospace`
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = f1
  const w1 = probe.measureText(`${num} ${code}`).width + big * 0.9
  probe.font = f2
  const w2 = probe.measureText(name).width
  const pad = Math.round(10 * scale)
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(Math.max(w1, w2) + pad * 2 + big * 0.6)
  cv.height = Math.ceil(big * 1.15 + small * 1.5 + pad * 2)
  const g = cv.getContext('2d')!
  const paint = () => {
    g.clearRect(0, 0, cv.width, cv.height)
    g.fillStyle = '#ffffff'
    g.textBaseline = 'alphabetic'
    // the status pad: a small square in front of the number
    const sq = big * 0.5
    g.fillRect(pad, pad + big * 0.88 - sq * 1.05, sq, sq)
    g.font = f1
    g.fillText(`${num} ${code}`, pad + sq + big * 0.35, pad + big * 0.88)
    g.font = f2
    g.globalAlpha = 0.85
    g.fillText(name, pad + 2 * scale, pad + big * 1.15 + small * 1.05)
    g.globalAlpha = 1
  }
  paint()
  document.fonts?.ready.then(() => {
    paint()
    cv.dispatchEvent(new Event('repaint'))
  })
  return cv
}

/**
 * A tiling micro-structure (standard-cell rows at a much finer pitch than the
 * die map) multiplied into the core, so the silicon stays crisp up close.
 * Grey, mean ≈ 0.5.
 */
export function drawDetail(N: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const R = rng(29)
  g.fillStyle = 'rgb(128,128,128)'
  g.fillRect(0, 0, N, N)
  const rowH = 4
  for (let y = 0; y < N; y += rowH) {
    let x = 0
    while (x < N) {
      const cw = 2 + Math.floor(R() * 8)
      const v = Math.round(70 + R() * 130)
      g.fillStyle = `rgb(${v},${v},${v})`
      g.fillRect(x, y, cw - 1, rowH - 1)
      x += cw
    }
    g.fillStyle = 'rgb(60,60,60)'
    g.fillRect(0, y + rowH - 1, N, 1)
  }
  // a few vertical metal straps
  g.fillStyle = 'rgba(210,210,210,0.35)'
  for (let x = 13; x < N; x += 32) g.fillRect(x, 0, 2, N)
  return cv
}

/**
 * Tangent-space normals for the micro-structure: every cell a shallow raised
 * pad with bevelled edges, so the top metal glints as the studio sweeps.
 */
export function drawDetailNormals(src: HTMLCanvasElement): HTMLCanvasElement {
  const N = src.width
  const sg = src.getContext('2d')!
  const h = sg.getImageData(0, 0, N, N).data
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const out = g.createImageData(N, N)
  const H = (x: number, y: number) => h[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255
  const k = 2.2
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k
      const dy = (H(x, y + 1) - H(x, y - 1)) * k
      const l = Math.hypot(dx, dy, 1)
      const i = (y * N + x) * 4
      out.data[i] = Math.round(((-dx / l) * 0.5 + 0.5) * 255)
      out.data[i + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255)
      out.data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255)
      out.data[i + 3] = 255
    }
  }
  g.putImageData(out, 0, 0)
  return cv
}
