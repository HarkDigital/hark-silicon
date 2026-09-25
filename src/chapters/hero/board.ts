import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, S, Traces, chipPackage, silk } from '../../kit/silicon'
import { logoShapes } from '../../logo/logo'
import { rng } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { Bokeh, type BokehSource, dofTree, withDof, withDofRaw } from './dof'

/*
 * The hero set: the Hark chip (U1, a 96-lead QFP with the mark laser-etched)
 * soldered at the centre of a matte-black board. Units: 1 = 1 cm, board in
 * XZ (y up), front (+z) toward the camera.
 *
 *   U1 fan-out: every lead has a gold pad and a solder fillet; its trace runs
 *   out, jogs 45° (outer leads first, so neighbours never cross) to a 2.4 mm
 *   bus pitch, then follows its bus: straight off into the dark, a 45° step,
 *   or down a via. Paths are stored far-end first so the signal pulses race
 *   IN toward the chip.
 *
 *   Around it: decoupling caps on the corner diagonals, D1 (the status LED),
 *   Y1 (100 MHz crystal), U2 (1.8 V regulator), series resistors across the
 *   front and back buses, fiducials, test points, via stitching, scattered
 *   passives, two far ICs, silkscreen labels and the board name.
 */

const CHIP_W = 2.4
const CHIP_H = 0.16
const PINS = 24
const PITCH = Math.min((CHIP_W * 0.8) / PINS, 0.13)
const HALF = CHIP_W / 2
/** chip lifted onto its pads */
const LIFT = 0.004
export const LID_Y = LIFT + 0.05 + CHIP_H
const PAD_IN = HALF + 0.06
const PAD_OUT = HALF + 0.3
/** fanned bus pitch */
const SP = 0.24
const FAN_BASE = 0.25
const DELTA = SP * Math.SQRT2 - PITCH
/** where every U1 trace is straight and parallel */
const XF = 5.0
const T45 = Math.tan(Math.PI / 8)
const TRACE_Y = 0.0025
const TRACE_W = 0.038

export interface HeroSet {
  root: THREE.Group
  traces: Traces
  maxLen: number
  bokeh: Bokeh
  /** the room far behind the board (drawn before the board, which fades over it) */
  bokehFar: Bokeh
  /** bokeh indices + base power of the LEDs */
  leds: { idx: number; power: number; emit: THREE.MeshBasicMaterial; lens: THREE.MeshStandardMaterial; spill: THREE.MeshBasicMaterial }[]
  lidMat: THREE.MeshStandardMaterial
  /** world points the probe callouts pin to */
  pins: { u1: THREE.Vector3; vdd: THREE.Vector3; clk: THREE.Vector3 }
}

type P2 = [number, number]

/** side frames: outward (o) and lateral (l) unit vectors in board XZ */
const SIDES: { o: P2; l: P2 }[] = [
  { o: [1, 0], l: [0, 1] }, // +x (right)
  { o: [0, 1], l: [-1, 0] }, // +z (front)
  { o: [-1, 0], l: [0, -1] }, // -x (left)
  { o: [0, -1], l: [1, 0] }, // -z (back)
]
const toBoard = (s: number, u: number, v: number): P2 => [SIDES[s].o[0] * u + SIDES[s].l[0] * v, SIDES[s].o[1] * u + SIDES[s].l[1] * v]

interface Bus {
  k0: number
  k1: number
  /** segment lengths after XF, and the 45° turns between them (+1 toward +lateral) */
  segs: number[]
  turns?: number[]
  via?: boolean
  stagger?: number
}

/** per side: how the 24 fanned traces continue (k = lead index, low → -lateral) */
const BUSES: Bus[][] = [
  [
    { k0: 0, k1: 5, segs: [2.6, 1.6, 16], turns: [-1, 1] },
    { k0: 6, k1: 11, segs: [0.62], via: true, stagger: 0.34 },
    { k0: 12, k1: 17, segs: [19] },
    { k0: 18, k1: 23, segs: [3.4, 2.2, 15], turns: [1, -1] },
  ],
  [
    { k0: 0, k1: 7, segs: [2.2, 1.2, 14], turns: [-1, 1] },
    { k0: 8, k1: 15, segs: [16] },
    { k0: 16, k1: 23, segs: [2.2, 1.2, 14], turns: [1, -1] },
  ],
  [
    { k0: 0, k1: 3, segs: [0.5], via: true, stagger: 0.36 },
    { k0: 4, k1: 11, segs: [3, 2.4, 15], turns: [-1, 1] },
    { k0: 12, k1: 19, segs: [18] },
    { k0: 20, k1: 23, segs: [0.5], via: true, stagger: 0.36 },
  ],
  [
    { k0: 0, k1: 11, segs: [22] },
    { k0: 12, k1: 17, segs: [2.8, 1.8, 16], turns: [1, -1] },
    { k0: 18, k1: 23, segs: [1.4], via: true, stagger: 0.3 },
  ],
]

/** local (u, v) polyline for lead k of a side, through its bus program */
function leadPath(k: number, bus: Bus): { pts: P2[]; end: P2 } {
  const c = k - (PINS - 1) / 2
  const v0 = c * PITCH
  const v1 = c * SP
  const s1 = FAN_BASE + ((PINS - 1) / 2 - Math.abs(c)) * DELTA
  const ua = PAD_OUT + s1
  const ub = ua + Math.abs(v1 - v0)
  const pts: P2[] = [
    [PAD_OUT - 0.06, v0],
    [ua, v0],
    [ub, v1],
    [XF, v1],
  ]
  // bus program: mitred 45° turns keep the bus pitch constant
  const mid = ((bus.k0 + bus.k1) / 2 - (PINS - 1) / 2) * SP
  const o = v1 - mid
  const turns = bus.turns ?? []
  let h = 0
  let x = XF
  let y = v1
  bus.segs.forEach((L, i) => {
    const tIn = i > 0 ? turns[i - 1] : 0
    const tOut = i < bus.segs.length - 1 ? turns[i] : 0
    let len = L - o * T45 * (tIn + tOut)
    if (i === bus.segs.length - 1 && bus.via) len += ((k - bus.k0) % 3) * (bus.stagger ?? 0.3)
    x += Math.cos(h) * len
    y += Math.sin(h) * len
    pts.push([x, y])
    if (tOut) h += (tOut * Math.PI) / 4
  })
  return { pts, end: [x, y] }
}

/** a free-standing bus (background routing): n traces from `start`, heading `h` (radians) */
function freeBus(start: P2, h: number, n: number, segs: number[], turns: number[], sp = 0.2): P2[][] {
  const out: P2[][] = []
  const nx = -Math.sin(h)
  const nz = Math.cos(h)
  for (let j = 0; j < n; j++) {
    const o = (j - (n - 1) / 2) * sp
    let x = start[0] + nx * o
    let z = start[1] + nz * o
    let hh = h
    const pts: P2[] = [[x, z]]
    segs.forEach((L, i) => {
      const tIn = i > 0 ? turns[i - 1] : 0
      const tOut = i < segs.length - 1 ? turns[i] : 0
      const len = L - o * T45 * (tIn + tOut)
      x += Math.cos(hh) * len
      z += Math.sin(hh) * len
      pts.push([x, z])
      if (tOut) hh += (tOut * Math.PI) / 4
    })
    out.push(pts)
  }
  return out
}

/* ------------------------------------------------------------ geometry bits */

/** a ramp (triangular prism): height h0 at x0 → h1 at x1, width w along z */
function wedge(x0: number, x1: number, h0: number, h1: number, w: number): THREE.BufferGeometry {
  const z = w / 2
  const v = [
    [x0, 0, -z], [x1, 0, -z], [x1, h1, -z], [x0, h0, -z],
    [x0, 0, z], [x1, 0, z], [x1, h1, z], [x0, h0, z],
  ]
  const f = [
    [0, 2, 1], [0, 3, 2], // back
    [4, 5, 6], [4, 6, 7], // front
    [3, 7, 6], [3, 6, 2], // slope
    [0, 1, 5], [0, 5, 4], // bottom
    [0, 4, 7], [0, 7, 3], // x0 end
    [1, 2, 6], [1, 6, 5], // x1 end
  ]
  const pos: number[] = []
  for (const t of f) for (const i of t) pos.push(...v[i])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/** gull-wing lead pointing +x from x = 0 (body edge) at height hy, foot on y = 0 */
function gullLead(reach: number, w: number, hy: number, t = 0.018): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(reach * 0.45, t, w)
  a.translate(reach * 0.225, hy, 0)
  const b = new THREE.BoxGeometry(t, hy, w)
  b.translate(reach * 0.45, hy / 2, 0)
  const c = new THREE.BoxGeometry(reach * 0.55, t, w)
  c.translate(reach * 0.45 + reach * 0.275, t / 2, 0)
  const g = mergeGeometries([a, b, c])!
  a.dispose()
  b.dispose()
  c.dispose()
  return g
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, -size)
  g.beginPath()
  for (const s of logoShapes()) {
    s.getPoints(64).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    for (const hole of s.holes) {
      hole.getPoints(32).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
  }
  g.restore()
}

const MONO = "'Martian Mono Variable', ui-monospace, monospace"
const GROT = "'Space Grotesk Variable', system-ui, sans-serif"

type RGB = readonly [number, number, number]
/** a speck: colour + alpha, blended over the base */
type Speck = readonly [number, number, number, number]

/** one lid layer: the base tile, then flat fills for the moulding marks and the etch */
interface LidLayer {
  base: RGB
  speck: (r: number) => Speck
  etch: string
  /** the laser raster (every other row blended over the etch), or none */
  raster: string | null
  dimple: string
  eject: string
}

/**
 * EDM mould texture as one seamless T² tile: 1–2 px specks alpha-blended over
 * the base with typed-array writes (one putImageData). Every layer uses the
 * same seed, so a speck sits at the same spot in the albedo, roughness and
 * bump — a pit that is darker is also rougher.
 */
function speckTile(base: RGB, speck: (r: number) => Speck, T = 256): HTMLCanvasElement {
  const { c, g } = canvas(T, T)
  const img = g.createImageData(T, T)
  const d = img.data
  for (let i = 0; i < T * T * 4; i += 4) {
    d[i] = base[0]
    d[i + 1] = base[1]
    d[i + 2] = base[2]
    d[i + 3] = 255
  }
  const R = rng(11)
  const n = Math.round(T * T * 0.035)
  for (let k = 0; k < n; k++) {
    const [r, gg, b, a] = speck(R())
    const s = R() < 0.8 ? 1 : 2
    const x0 = Math.floor(R() * T)
    const y0 = Math.floor(R() * T)
    for (let dy = 0; dy < s; dy++)
      for (let dx = 0; dx < s; dx++) {
        // wraps, so the tile repeats without a seam
        const i = (((y0 + dy) % T) * T + ((x0 + dx) % T)) * 4
        d[i] += (r - d[i]) * a
        d[i + 1] += (gg - d[i + 1]) * a
        d[i + 2] += (b - d[i + 2]) * a
      }
  }
  g.putImageData(img, 0, 0)
  return c
}

/** the etch fill: flat, or with the laser's raster rows (a tiny repeating pattern) */
function etchFill(g: CanvasRenderingContext2D, etch: string, raster: string | null, period: number): string | CanvasPattern {
  if (!raster) return etch
  const { c, g: p } = canvas(1, period)
  p.fillStyle = etch
  p.fillRect(0, 0, 1, period)
  p.fillStyle = raster
  p.fillRect(0, period - 1, 1, 1)
  return g.createPattern(c, 'repeat') ?? etch
}

/**
 * Paint one lid layer at N²: the speck tile as a pattern, the ejector-pin marks
 * and the pin-1 dimple, then the laser etch (mark + lines) filled directly —
 * no per-speck draws and no mask canvas.
 */
function paintLid(g: CanvasRenderingContext2D, N: number, L: LidLayer, tile: HTMLCanvasElement) {
  g.globalCompositeOperation = 'source-over'
  g.fillStyle = g.createPattern(tile, 'repeat') ?? `rgb(${L.base.join(',')})`
  g.fillRect(0, 0, N, N)
  // ejector-pin marks (shallow polished circles) and the pin-1 dimple
  g.fillStyle = L.eject
  for (const [x, y] of [[0.86, 0.14], [0.14, 0.86], [0.86, 0.86]] as P2[]) {
    g.beginPath()
    g.arc(x * N, y * N, N * 0.045, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = L.dimple
  g.beginPath()
  g.arc(0.1 * N, 0.1 * N, N * 0.032, 0, Math.PI * 2)
  g.fill()
  // the laser etch
  g.fillStyle = etchFill(g, L.etch, L.raster, N >= 2048 ? 3 : 2)
  drawMark(g, N * 0.5, N * 0.38, N * 0.4)
  g.fill('evenodd')
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.font = `600 ${Math.round(N * 0.084)}px ${GROT}`
  g.fillText('HARK-1', N * 0.5, N * 0.71)
  g.font = `500 ${Math.round(N * 0.04)}px ${MONO}`
  g.fillText('MAKE THE INTERNET LISTEN', N * 0.5, N * 0.786)
  g.font = `500 ${Math.round(N * 0.032)}px ${MONO}`
  g.fillText('HK-0N  ·  REV A  ·  PHL', N * 0.5, N * 0.842)
}

/* the three layers of the lid. Albedo: dark satin compound, light-grey etch */
const LID_ALBEDO: LidLayer = {
  base: [20, 22, 25],
  speck: r => (r < 0.5 ? [40, 43, 48, 0.35 + r * 0.3] : [8, 9, 11, 0.35 + r * 0.3]),
  etch: '#b9bdc2',
  raster: 'rgba(70,74,80,0.35)',
  dimple: '#0d0e10',
  eject: '#18191c',
}
/* roughness: the etch is matte (laser-frosted), the compound a satin */
const LID_ROUGH: LidLayer = {
  base: [138, 138, 138],
  speck: r => (r < 0.5 ? [170, 170, 170, 0.5] : [110, 110, 110, 0.5]),
  etch: '#e6e6e6',
  raster: 'rgba(200,200,200,0.6)',
  dimple: '#3a3a3a',
  eject: '#5c5c5c',
}
/* bump: the etch is recessed, so its edges catch a grazing key */
const LID_BUMP: LidLayer = {
  base: [255, 255, 255],
  speck: () => [236, 236, 236, 0.6],
  etch: '#8c8c8c',
  raster: null,
  dimple: '#404040',
  eject: '#e8e8e8',
}

/**
 * The lid of U1: laser-etched mark and lines on EDM-textured mould compound.
 * Two textures: the albedo (also the emissive map, so the etch keeps a faint
 * self-luminance), and roughness + bump packed into one (three reads the bump
 * from R and roughness from G). Returns a redraw for when the etch fonts land.
 * Once the final paint is on the GPU the canvases are released (a lost context
 * reloads the page, so they are never needed again).
 */
function lidMaterial(size: number, packSize: number, final: boolean): { material: THREE.MeshStandardMaterial; redraw: () => void } {
  const albedo = canvas(size, size)
  const packed = canvas(packSize, packSize)
  const tiles = { a: speckTile(LID_ALBEDO.base, LID_ALBEDO.speck), r: speckTile(LID_ROUGH.base, LID_ROUGH.speck), b: speckTile(LID_BUMP.base, LID_BUMP.speck) }
  const draw = () => {
    paintLid(albedo.g, size, LID_ALBEDO, tiles.a)
    // pack: bump → red, roughness → green (each painted grey, then multiplied into
    // its channel; the two are added)
    const N = packSize
    const p = packed.g
    paintLid(p, N, LID_BUMP, tiles.b)
    p.globalCompositeOperation = 'multiply'
    p.fillStyle = '#ff0000'
    p.fillRect(0, 0, N, N)
    const tmp = canvas(N, N)
    paintLid(tmp.g, N, LID_ROUGH, tiles.r)
    tmp.g.globalCompositeOperation = 'multiply'
    tmp.g.fillStyle = '#00ff00'
    tmp.g.fillRect(0, 0, N, N)
    p.globalCompositeOperation = 'lighter'
    p.drawImage(tmp.c, 0, 0)
    p.globalCompositeOperation = 'source-over'
    // release the scratch canvas's backing store now, not at the next GC
    tmp.c.width = tmp.c.height = 0
  }
  draw()
  const map = new THREE.CanvasTexture(albedo.c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const pack = new THREE.CanvasTexture(packed.c)
  pack.anisotropy = 8
  // the etch reads as light-grey laser marking under any light: a faint self-luminance
  // through the albedo (the dark mould compound stays dark)
  const material = new THREE.MeshStandardMaterial({ map, roughnessMap: pack, bumpMap: pack, bumpScale: 1.4, roughness: 1, metalness: 0, emissiveMap: map, emissive: new THREE.Color('#6a6e74') })
  const release = (t: THREE.Texture) => {
    if (!final) return
    const c = t.image as HTMLCanvasElement
    c.width = c.height = 1
    t.onUpdate = null
  }
  map.onUpdate = release
  pack.onUpdate = release
  const redraw = () => {
    final = true
    draw()
    map.needsUpdate = pack.needsUpdate = true
  }
  return { material, redraw }
}

/** small canvas texture with text (crystal lid stamp, etc.) */
function stampTex(lines: string[], w: number, h: number, fg: string, bg: string): THREE.CanvasTexture {
  const { c, g } = canvas(w, h)
  const draw = () => {
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.fillStyle = fg
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `500 ${Math.round(h * 0.2)}px ${MONO}`
    lines.forEach((l, i) => g.fillText(l, w / 2, h * (0.5 + (i - (lines.length - 1) / 2) * 0.28)))
  }
  draw()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  document.fonts?.load(`500 20px ${MONO}`).then(() => {
    draw()
    t.needsUpdate = true
  }).catch(() => {})
  return t
}

/** soft square contact shadow (alpha) */
function shadowTex(): THREE.CanvasTexture {
  const N = 128
  const { c, g } = canvas(N, N)
  const img = g.createImageData(N, N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - N / 2) / (N / 2) - 0.55) / 0.45
      const dy = Math.max(0, Math.abs(y + 0.5 - N / 2) / (N / 2) - 0.55) / 0.45
      const d = Math.min(1, Math.hypot(dx, dy))
      // alphaMap reads the green channel: encode the falloff as grey, opaque
      const a = Math.round(Math.pow(1 - d, 2) * 255)
      const i = (y * N + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(c)
}

/** round radial glow (alpha falloff), for LED spill */
function glowTex(): THREE.CanvasTexture {
  const N = 128
  const { c, g } = canvas(N, N)
  // grey on black (alphaMap reads the green channel)
  g.fillStyle = '#000'
  g.fillRect(0, 0, N, N)
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  gr.addColorStop(0, '#ffffff')
  gr.addColorStop(0.2, '#6a6a6a')
  gr.addColorStop(0.55, '#141414')
  gr.addColorStop(1, '#000000')
  g.fillStyle = gr
  g.fillRect(0, 0, N, N)
  return new THREE.CanvasTexture(c)
}

/* ------------------------------------------------------------ passives */

type PassiveKind = 'r0402' | 'c0402' | 'c0603' | 'r0603' | 'c0805'
const PASSIVE: Record<PassiveKind, { l: number; w: number; h: number; color: string }> = {
  r0402: { l: 0.1, w: 0.05, h: 0.035, color: '#1b1c1f' },
  c0402: { l: 0.1, w: 0.05, h: 0.05, color: '#9a8266' },
  r0603: { l: 0.16, w: 0.08, h: 0.045, color: '#1b1c1f' },
  c0603: { l: 0.16, w: 0.08, h: 0.08, color: '#a08769' },
  c0805: { l: 0.2, w: 0.125, h: 0.1, color: '#a58c6d' },
}
interface Passive {
  x: number
  z: number
  rot: number
  kind: PassiveKind
}

/* ------------------------------------------------------------ build */

export async function buildHero(mobile: boolean): Promise<HeroSet> {
  const root = new THREE.Group()
  const R = rng(20160)
  const glints: BokehSource[] = []
  // the lid's etch faces: asked for now (they're usually in by the time the lid is painted)
  const fonts = document.fonts
  const fontsIn = fonts ? Promise.all([fonts.load(`600 40px ${GROT}`), fonts.load(`500 40px ${MONO}`)]).then(() => true, () => true) : Promise.resolve(true)
  let fontsReady = !fonts
  void fontsIn.then(() => (fontsReady = true))

  // ---- materials (chapter-owned; DOF-patched)
  // matte black solder mask: a broad, dim satin sheen. Out of focus it fades to
  // transparent, so the far board melts into the world's bokeh backdrop (no horizon seam)
  const maskMat = withDof(
    // no depth write: nothing sits below the board, and its faded far field must never
    // hide the far bokeh drawn before it
    new THREE.MeshStandardMaterial({ color: S.mask, roughness: 0.68, metalness: 0, transparent: true, depthWrite: false }),
    'alpha',
  )
  const goldMat = withDof(MAT.gold().clone())
  goldMat.roughness = 0.26
  const tinMat = withDof(MAT.tin().clone())
  tinMat.roughness = 0.34
  const solderMat = withDof(new THREE.MeshStandardMaterial({ color: '#c4c9cf', roughness: 0.32, metalness: 1 }))
  const epoxyMat = withDof(MAT.epoxy().clone())
  // silkscreen ink is lit like everything else (matte white, not self-lit)
  const silkMat = withDof(new THREE.MeshStandardMaterial({ color: '#e4e6e1', roughness: 0.75, metalness: 0 }))
  /** a kit silk() label, re-materialled as lit matte ink */
  const ink = (m: THREE.Mesh) => {
    const old = m.material as THREE.MeshBasicMaterial
    m.material = withDof(new THREE.MeshStandardMaterial({ map: old.map, color: '#e4e6e1', roughness: 0.75, metalness: 0, transparent: true, depthWrite: false }), 'alpha')
    old.dispose()
    return m
  }
  const ceramicMat = withDof(MAT.ceramic().clone())
  const shadowMat = withDof(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex(), transparent: true, opacity: 0.85, depthWrite: false }), 'alpha')
  // an InstancedMesh never shares a material with a plain Mesh (three would re-resolve
  // the program on every alternation): instanced twins of the shared ones
  const twin = <M extends THREE.Material>(m: M): M => withDof(m.clone() as M)
  const goldMatI = twin(goldMat)
  const shadowMatI = twin(shadowMat)

  // ---- the board: a big matte-black plane (edges live far off in the dark)
  const board = new THREE.Mesh(new THREE.PlaneGeometry(60, 46), maskMat)
  board.rotation.x = -Math.PI / 2
  // first in the transparent pass (under the silkscreen and shadows)
  board.renderOrder = -1
  root.add(board)

  // ---- U1: the Hark chip (the kit body + leads; the etched lid is ours, painted last)
  const chip = chipPackage({ w: CHIP_W, h: CHIP_H, kind: 'qfp', pinsPerSide: PINS, top: false })
  chip.position.y = LIFT
  const top = new THREE.Mesh(new THREE.PlaneGeometry(CHIP_W * 0.96, CHIP_W * 0.96).rotateX(-Math.PI / 2))
  top.position.y = LID_Y - LIFT + 0.001
  top.userData.noDof = true
  chip.add(top)
  root.add(chip)
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const chipShadow = new THREE.Mesh(shadowGeo, shadowMat)
  chipShadow.scale.set(CHIP_W * 1.12, 1, CHIP_W * 1.12)
  chipShadow.position.y = 0.0045
  chipShadow.renderOrder = 1
  root.add(chipShadow)

  // U1 pads + solder fillets (one instanced mesh each)
  const padGeo = new THREE.BoxGeometry(PAD_OUT - PAD_IN, 0.004, PITCH * 0.58)
  padGeo.translate((PAD_IN + PAD_OUT) / 2, 0.002, 0)
  const fillGeo = mergeGeometries([wedge(HALF + 0.04, HALF + 0.1, 0.0, 0.05, PITCH * 0.4), wedge(HALF + 0.2, HALF + 0.265, 0.024, 0.0, PITCH * 0.44)])!
  const u1Pads = new THREE.InstancedMesh(padGeo, goldMatI, PINS * 4)
  const u1Fill = new THREE.InstancedMesh(fillGeo, solderMat, PINS * 4)
  {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    const span = PITCH * (PINS - 1)
    let i = 0
    for (let s = 0; s < 4; s++) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (s * Math.PI) / 2)
      for (let k = 0; k < PINS; k++) {
        const p = new THREE.Vector3(0, 0, -span / 2 + k * PITCH).applyQuaternion(q)
        m.compose(p, q, one)
        u1Pads.setMatrixAt(i, m)
        m.compose(p.clone().setY(LIFT * 0.5), q, one)
        u1Fill.setMatrixAt(i, m)
        i++
      }
    }
    // far-row lead glints (behind the lid in the intro shot)
    for (let k = 2; k < PINS; k += 4) glints.push({ p: new THREE.Vector3(-span / 2 + k * PITCH, 0.03, -(HALF + 0.18)), color: '#fff1dc', power: 0.9, glint: 1 })
  }
  root.add(u1Pads, u1Fill)

  // ---- routing
  const paths: THREE.Vector3[][] = []
  const segs: [number, number, number, number][] = [] // for clearance checks
  const viaPts: P2[] = []
  const passives: Passive[] = []
  const addPath = (pts: P2[], reverse = true) => {
    const v = pts.map(([x, z]) => new THREE.Vector3(x, TRACE_Y, z))
    if (reverse) v.reverse()
    paths.push(v)
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]])
  }
  for (let s = 0; s < 4; s++) {
    for (const bus of BUSES[s]) {
      for (let k = bus.k0; k <= bus.k1; k++) {
        const { pts, end } = leadPath(k, bus)
        addPath(pts.map(([u, v]) => toBoard(s, u, v)))
        if (bus.via) viaPts.push(toBoard(s, end[0], end[1]))
        // series resistors across the front and back buses (staggered rows)
        if (s === 1 || s === 3) {
          const c = k - (PINS - 1) / 2
          const u = 5.55 + (k % 2) * 0.34
          const [x, z] = toBoard(s, u, c * SP)
          passives.push({ x, z, rot: s === 1 || s === 3 ? Math.PI / 2 : 0, kind: 'r0402' })
        }
      }
    }
  }
  // background routing: buses crossing the far field, one zone per quadrant so nothing collides
  const bg: { b: P2[][]; both?: boolean }[] = [
    { b: freeBus([6.4, 6.2], 0, 6, [14], []) },
    { b: freeBus([5.2, 8.6], Math.PI / 2, 5, [1.5, 1.4, 10], [-1, 1]) },
    { b: freeBus([-6.6, 6.0], Math.PI, 6, [14], []) },
    { b: freeBus([-5.4, 8.4], Math.PI / 2, 4, [1.4, 1.2, 10], [1, -1]) },
    { b: freeBus([6.4, -8.6], 0, 8, [4, 1.2, 12], [1, -1]) },
    { b: freeBus([8.8, -5.4], -Math.PI / 2, 6, [1.2], []), both: true },
    { b: freeBus([-5.4, -11.0], Math.PI, 5, [15], []) },
    { b: freeBus([-11.2, -4.6], -Math.PI / 2, 5, [4.2], []), both: true },
  ]
  for (const { b, both } of bg) {
    for (const p of b) {
      addPath(p, R() < 0.5)
      viaPts.push(p[0])
      if (both) viaPts.push(p[p.length - 1])
    }
  }

  // parts near U1 (hand placed): decoupling caps on the corner diagonals
  const dec: P2[] = [
    [1.82, 1.82],
    [-1.82, 1.82],
    [-1.82, -1.82],
    [1.82, -1.82],
  ]
  dec.forEach(([x, z], i) => {
    passives.push({ x, z, rot: (i % 2 ? 1 : -1) * (Math.PI / 4), kind: 'c0402' })
    viaPts.push([x * 1.13, z * 1.13])
    viaPts.push([x * 0.9 + Math.sign(x) * 0.02, z * 0.9 + Math.sign(z) * 0.2])
  })
  // short stubs from caps / vias toward the chip corner leads
  addPath([[1.95, 1.95], [2.25, 2.25], [2.25, 2.8]], true)
  viaPts.push([2.25, 2.8])

  // U2 regulator (SOT-223) + C1/C2, front-right
  const u2 = new THREE.Group()
  {
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.65, 0.16, 0.35, 2, 0.02), epoxyMat)
    body.position.y = 0.1
    u2.add(body)
    const small = gullLead(0.16, 0.07, 0.09)
    small.rotateY(-Math.PI / 2)
    const tab = gullLead(0.16, 0.3, 0.09)
    tab.rotateY(Math.PI / 2)
    const legs: THREE.BufferGeometry[] = []
    for (const x of [-0.23, 0, 0.23]) legs.push(small.clone().translate(x, 0.004, 0.175))
    legs.push(tab.clone().translate(0, 0.004, -0.175))
    const leads = new THREE.Mesh(mergeGeometries(legs)!, tinMat)
    u2.add(leads)
    const pads: THREE.BufferGeometry[] = []
    for (const x of [-0.23, 0, 0.23]) pads.push(new THREE.BoxGeometry(0.1, 0.004, 0.2).translate(x, 0.002, 0.3))
    pads.push(new THREE.BoxGeometry(0.36, 0.004, 0.2).translate(0, 0.002, -0.3))
    u2.add(new THREE.Mesh(mergeGeometries(pads)!, goldMat))
    const sh = new THREE.Mesh(shadowGeo, shadowMat)
    sh.scale.set(0.8, 1, 0.5)
    sh.position.y = 0.005
    u2.add(sh)
    const faceMap = stampTex(['HK-PWR', '1V8'], 256, 124, 'rgba(190,196,204,0.9)', '#16181b')
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.24), withDof(new THREE.MeshStandardMaterial({ map: faceMap, emissiveMap: faceMap, emissive: new THREE.Color('#8f939a'), roughness: 0.62 })))
    face.rotation.x = -Math.PI / 2
    face.position.y = 0.181
    u2.add(face)
  }
  u2.position.set(4.3, 0, 4.4)
  u2.rotation.y = Math.PI / 4
  root.add(u2)
  passives.push({ x: 3.55, z: 5.25, rot: Math.PI / 4, kind: 'c0805' }, { x: 5.2, z: 3.65, rot: Math.PI / 4, kind: 'c0805' }, { x: 5.55, z: 5.35, rot: -Math.PI / 4, kind: 'c0603' })
  addPath([[3.55, 5.25], [3.3, 5.5], [3.3, 6.8]], false)
  addPath([[5.2, 3.65], [5.5, 3.35], [6.7, 3.35]], false)
  viaPts.push([3.3, 6.8], [6.7, 3.35], [5.9, 5.7])

  // Y1 crystal (3225, 100 MHz) + load caps, front-left
  const y1 = new THREE.Group()
  {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.25), ceramicMat)
    base.position.y = 0.019
    y1.add(base)
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.05, 0.21, 2, 0.012), withDof(new THREE.MeshStandardMaterial({ color: '#c9cdd2', roughness: 0.2, metalness: 1 })))
    lid.position.y = 0.058
    y1.add(lid)
    const stamp = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.17),
      withDof(new THREE.MeshBasicMaterial({ map: stampTex(['100.000', 'HK 26'], 256, 180, 'rgba(40,44,50,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false })),
    )
    stamp.rotation.x = -Math.PI / 2
    stamp.position.y = 0.0835
    y1.add(stamp)
    const pads: THREE.BufferGeometry[] = []
    for (const [x, z] of [[-0.12, -0.085], [0.12, -0.085], [-0.12, 0.085], [0.12, 0.085]] as P2[]) pads.push(new THREE.BoxGeometry(0.11, 0.004, 0.09).translate(x * 1.1, 0.002, z * 1.12))
    y1.add(new THREE.Mesh(mergeGeometries(pads)!, goldMat))
    const sh = new THREE.Mesh(shadowGeo, shadowMat)
    sh.scale.set(0.42, 1, 0.34)
    sh.position.y = 0.005
    y1.add(sh)
  }
  y1.position.set(-4.2, 0, 4.25)
  y1.rotation.y = -Math.PI / 4
  root.add(y1)
  glints.push({ p: new THREE.Vector3(-4.2, 0.09, 4.25), color: '#eaf2ff', power: 0.8, glint: 1 })
  passives.push({ x: -3.5, z: 4.95, rot: -Math.PI / 4, kind: 'c0402' }, { x: -4.9, z: 3.55, rot: -Math.PI / 4, kind: 'c0402' })
  addPath([[-3.92, 3.97], [-3.3, 3.35], [-3.0, 3.35]], true)
  viaPts.push([-3.0, 3.35])
  addPath([[-4.48, 4.53], [-5.1, 5.15], [-5.1, 6.4]], false)
  viaPts.push([-5.1, 6.4], [-3.25, 5.2], [-5.2, 3.3])

  // D1 status LED + R4, back-left diagonal
  const leds: HeroSet['leds'] = []
  const addLed = (x: number, z: number, rot: number, power: number) => {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.08), withDof(new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.5 })))
    base.position.y = 0.019
    g.add(base)
    const emit = new THREE.MeshBasicMaterial({ color: new THREE.Color(S.signal), toneMapped: false })
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.035), emit)
    die.position.y = 0.045
    die.userData.noDof = true
    g.add(die)
    const lens = new THREE.MeshStandardMaterial({ color: '#dff5ea', roughness: 0.15, transparent: true, opacity: 0.5, emissive: new THREE.Color(S.signal), emissiveIntensity: 0, depthWrite: false })
    const lensMesh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.04, 0.08, 2, 0.012), withDof(lens, 'alpha'))
    lensMesh.position.y = 0.054
    g.add(lensMesh)
    const pads: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.07, 0.004, 0.1).translate(-0.085, 0.002, 0), new THREE.BoxGeometry(0.07, 0.004, 0.1).translate(0.085, 0.002, 0)]
    g.add(new THREE.Mesh(mergeGeometries(pads)!, goldMat))
    const spill = new THREE.MeshBasicMaterial({ color: new THREE.Color(S.signal), alphaMap: glowTex(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), spill)
    sp.position.y = 0.006
    sp.userData.noDof = true
    g.add(sp)
    g.position.set(x, 0, z)
    g.rotation.y = rot
    root.add(g)
    glints.push({ p: new THREE.Vector3(x, 0.05, z), color: S.signal, power: 0, glint: 0 })
    leds.push({ idx: glints.length - 1, power, emit, lens: lensMesh.material as THREE.MeshStandardMaterial, spill })
  }
  addLed(-3.4, -3.4, Math.PI / 4, 1.4)
  passives.push({ x: -3.9, z: -3.9, rot: Math.PI / 4, kind: 'r0402' })
  addPath([[-1.95, -1.95], [-3.28, -3.28]], true)
  addPath([[-4.0, -4.0], [-4.5, -4.5], [-4.5, -5.6]], false)
  viaPts.push([-4.5, -5.6])

  // far ICs (context in the board beat) and a second, far LED
  const u4 = chipPackage({ w: 3.1, h: 0.2, kind: 'bga', lines: ['HK-MEM', 'REV A'], mark: false })
  u4.position.set(-8.2, 0, -7.6)
  root.add(u4)
  const u5 = chipPackage({ w: 0.9, h: 0.09, kind: 'qfn', pinsPerSide: 8, lines: ['HK-IO'], mark: false })
  u5.position.set(9.5, 0, 9.8)
  u5.rotation.y = 0.0
  root.add(u5)
  for (const g of [u4, u5]) {
    const sh = new THREE.Mesh(shadowGeo, shadowMat)
    const b = new THREE.Box3().setFromObject(g)
    sh.scale.set((b.max.x - b.min.x) * 1.1, 1, (b.max.z - b.min.z) * 1.1)
    sh.position.set(g.position.x, 0.005, g.position.z)
    root.add(sh)
  }
  addLed(13.5, -11.5, 0, 1.1)

  // fiducials + test points
  const fidGeo = mergeGeometries([new THREE.CircleGeometry(0.05, 24).rotateX(-Math.PI / 2).translate(0, 0.004, 0)])!
  const fidRing = new THREE.CircleGeometry(0.13, 32).rotateX(-Math.PI / 2).translate(0, 0.0015, 0)
  const bare = withDof(new THREE.MeshStandardMaterial({ color: '#2a2519', roughness: 0.85 }))
  const tpGeo = new THREE.CircleGeometry(0.075, 24).rotateX(-Math.PI / 2).translate(0, 0.004, 0)
  const fidPts: P2[] = [
    [2.55, -2.55],
    [-6.6, 7.4],
    [7.1, -7.3],
  ]
  const tpPts: P2[] = [
    [5.9, 4.65],
    [-5.7, 4.6],
    [-5.2, -4.4],
  ]
  const fidGeos: THREE.BufferGeometry[] = []
  const ringGeos: THREE.BufferGeometry[] = []
  for (const [x, z] of fidPts) {
    fidGeos.push(fidGeo.clone().translate(x, 0, z))
    ringGeos.push(fidRing.clone().translate(x, 0, z))
  }
  for (const [x, z] of tpPts) fidGeos.push(tpGeo.clone().translate(x, 0, z))
  root.add(new THREE.Mesh(mergeGeometries(fidGeos)!, goldMat), new THREE.Mesh(mergeGeometries(ringGeos)!, bare))

  await nextFrame()

  // ---- clearance helpers
  const distToTraces = (x: number, z: number) => {
    let best = 1e9
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax
      const dz = bz - az
      const l2 = dx * dx + dz * dz || 1e-9
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
      const ex = ax + dx * t - x
      const ez = az + dz * t - z
      const d = ex * ex + ez * ez
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }
  const keep: [number, number, number, number][] = [
    [-2.1, -2.1, 2.1, 2.1], // U1
    [3.2, 3.1, 6.2, 6.1], // U2 area
    [-5.4, 3.2, -3.1, 5.6], // Y1 area
    [-4.8, -4.9, -3.0, -3.0], // D1
    [2.9, -6.1, 8.2, -3.0], // board name
    [-10.0, -9.4, -6.4, -5.8], // U4
    [8.8, 9.1, 10.2, 10.5], // U5
    [12.9, -12.1, 14.1, -10.9], // D2
  ]
  const inKeep = (x: number, z: number, pad = 0) => keep.some(([a, b, c, d]) => x > a - pad && x < c + pad && z > b - pad && z < d + pad)
  const nearFid = (x: number, z: number) => [...fidPts, ...tpPts].some(([a, b]) => Math.hypot(a - x, b - z) < 0.35)

  // via stitching: a regular grid in the free field
  const stitch = mobile ? 0.9 : 0.62
  const maxStitch = mobile ? 260 : 620
  let nStitch = 0
  for (let gx = -15; gx <= 15 && nStitch < maxStitch; gx += stitch) {
    for (let gz = -13; gz <= 13 && nStitch < maxStitch; gz += stitch) {
      const r = Math.hypot(gx, gz)
      if (r < 2.4) continue
      // stitch in a few rings/patches, not everywhere
      const zone = Math.sin(gx * 0.33 + 1.3) * Math.cos(gz * 0.29 - 0.4)
      if (zone < 0.15 && r > 3.2) continue
      if (inKeep(gx, gz, 0.25) || nearFid(gx, gz)) continue
      if (distToTraces(gx, gz) < 0.17) continue
      viaPts.push([gx, gz])
      nStitch++
    }
  }
  await nextFrame()

  // scattered passives in the far field
  const kinds: PassiveKind[] = ['c0402', 'r0402', 'c0402', 'r0603', 'c0603', 'c0402']
  const scatter = mobile ? 90 : 200
  let placed = 0
  for (let tries = 0; placed < scatter && tries < scatter * 12; tries++) {
    const x = (R() * 2 - 1) * 16
    const z = (R() * 2 - 1) * 13
    if (Math.abs(x) < 6.6 && Math.abs(z) < 6.6) continue
    if (inKeep(x, z, 0.3) || nearFid(x, z)) continue
    if (distToTraces(x, z) < 0.2) continue
    if (viaPts.some(([a, b]) => Math.abs(a - x) < 0.18 && Math.abs(b - z) < 0.18)) continue
    const kind = kinds[Math.floor(R() * kinds.length)]
    passives.push({ x, z, rot: R() < 0.5 ? 0 : Math.PI / 2, kind })
    placed++
    if (placed % 5 === 0) glints.push({ p: new THREE.Vector3(x, PASSIVE[kind].h, z), color: R() < 0.5 ? '#fff0d8' : '#e8eeff', power: 0.75, glint: 1 })
  }
  // near passives (inside the fan quadrants) — a few 0402s beside U2 / Y1
  passives.push({ x: 2.55, z: 3.65, rot: Math.PI / 2, kind: 'c0402' }, { x: 3.6, z: 2.55 + 0.9, rot: 0, kind: 'r0402' }, { x: -2.6, z: 3.7, rot: Math.PI / 2, kind: 'c0402' })

  // ---- vias (instanced): gold annular ring + dark drill
  {
    const ring = new THREE.RingGeometry(0.018, 0.045, 18).rotateX(-Math.PI / 2)
    const hole = new THREE.CircleGeometry(0.018, 18).rotateX(-Math.PI / 2).translate(0, -0.0005, 0)
    const colorOf = (g: THREE.BufferGeometry, c: number) => {
      const n = g.getAttribute('position').count
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(c), 3))
      return g
    }
    // the inner edge of the ring shades toward the drill (barrel falling away)
    const rc = ring.getAttribute('position')
    const cols: number[] = []
    for (let i = 0; i < rc.count; i++) {
      const r = Math.hypot(rc.getX(i), rc.getZ(i))
      const v = r < 0.02 ? 0.25 : 1
      cols.push(v, v, v)
    }
    ring.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    const via = mergeGeometries([ring, colorOf(hole, 0.02)])!
    via.translate(0, 0.004, 0)
    const viaMat = MAT.gold().clone()
    viaMat.vertexColors = true
    viaMat.roughness = 0.44
    viaMat.transparent = true
    withDof(viaMat, 'alpha')
    const vias = new THREE.InstancedMesh(via, viaMat, viaPts.length)
    const m = new THREE.Matrix4()
    viaPts.forEach(([x, z], i) => {
      m.makeTranslation(x, 0, z)
      vias.setMatrixAt(i, m)
      if (i % 23 === 7 && Math.hypot(x, z) > 5) glints.push({ p: new THREE.Vector3(x, 0.01, z), color: '#ffd9a0', power: 0.55, glint: 1 })
    })
    root.add(vias)
  }

  // ---- passives (instanced): bodies (per-instance colour), tin ends, gold pads, contact shadows
  {
    const n = passives.length
    const bodyGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.12)
    bodyGeo.translate(0, 0.5, 0)
    // these reach far into the defocus: fade to transparent (no dark specks on the horizon)
    const bodyMat = withDof(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, transparent: true }), 'alpha')
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, n)
    const endGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.15)
    endGeo.translate(0, 0.5, 0)
    const endMat = MAT.tin().clone()
    endMat.roughness = 0.34
    endMat.transparent = true
    const ends = new THREE.InstancedMesh(endGeo, withDof(endMat, 'alpha'), n * 2)
    const pgeo = new THREE.BoxGeometry(1, 0.004, 1)
    pgeo.translate(0, 0.002, 0)
    const padMat = MAT.gold().clone()
    padMat.roughness = 0.3
    padMat.transparent = true
    const pads = new THREE.InstancedMesh(pgeo, withDof(padMat, 'alpha'), n * 2)
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMatI, n)
    shadows.renderOrder = 1
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const Y = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    passives.forEach((p, i) => {
      const d = PASSIVE[p.kind]
      q.setFromAxisAngle(Y, p.rot)
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
      m.compose(new THREE.Vector3(p.x, 0.004, p.z), q, new THREE.Vector3(d.l * 0.62, d.h, d.w))
      bodies.setMatrixAt(i, m)
      bodies.setColorAt(i, c.set(d.color))
      for (let e = 0; e < 2; e++) {
        const sg = e ? 1 : -1
        m.compose(new THREE.Vector3(p.x + ax.x * sg * d.l * 0.4, 0.004, p.z + ax.z * sg * d.l * 0.4), q, new THREE.Vector3(d.l * 0.22, d.h * 1.04, d.w * 1.04))
        ends.setMatrixAt(i * 2 + e, m)
        m.compose(new THREE.Vector3(p.x + ax.x * sg * d.l * 0.45, 0, p.z + ax.z * sg * d.l * 0.45), q, new THREE.Vector3(d.l * 0.38, 1, d.w * 1.2))
        pads.setMatrixAt(i * 2 + e, m)
      }
      m.compose(new THREE.Vector3(p.x, 0.0045, p.z), q, new THREE.Vector3(d.l * 1.25, 1, d.w * 1.6))
      shadows.setMatrixAt(i, m)
    })
    root.add(shadows, pads, bodies, ends)
    // resistor glints across the front bus (foreground bokeh in the intro)
    passives.slice(0, 200).forEach((p, i) => {
      if (p.kind === 'r0402' && p.z > 5 && i % 3 === 0) glints.push({ p: new THREE.Vector3(p.x, 0.04, p.z), color: '#fff3e2', power: 0.7, glint: 1 })
    })
  }
  await nextFrame()

  // ---- silkscreen: labels, outlines, board name, the mark
  const labels: [string, number, number, number, number][] = [
    // text, x, z, height, rotation (about y)
    ['U1', -1.95, 1.62, 0.2, 0],
    ['C10', 2.02, 1.5, 0.1, 0],
    ['C11', -2.28, 1.5, 0.1, 0],
    ['C12', -2.28, -1.4, 0.1, 0],
    ['C13', 2.02, -1.4, 0.1, 0],
    ['D1', -4.3, -3.25, 0.13, 0],
    ['STAT', -3.6, -4.55, 0.11, 0],
    ['R4', -4.5, -3.75, 0.11, 0],
    ['U2', 4.62, 5.2, 0.16, 0],
    ['1V8', 3.72, 3.72, 0.12, 0],
    ['C1', 3.0, 5.62, 0.12, 0],
    ['C2', 5.36, 3.24, 0.12, 0],
    ['Y1', -4.95, 4.9, 0.16, 0],
    ['100M', -4.25, 3.55, 0.1, 0],
    ['C7', -3.28, 5.2, 0.11, 0],
    ['C8', -5.42, 3.36, 0.11, 0],
    ['TP1', 6.08, 4.9, 0.1, 0],
    ['TP2', -5.5, 4.85, 0.1, 0],
    ['TP3', -5.45, -4.02, 0.1, 0],
    ['RN1', -2.1, 6.25, 0.12, 0],
    ['RN2', 2.35, -6.6, 0.12, 0],
    ['U4', -9.9, -9.75, 0.22, 0],
    ['U5', 8.85, 10.62, 0.16, 0],
    ['D2', 13.2, -12.0, 0.14, 0],
  ]
  for (const [t, x, z, h, r] of labels) {
    const m = ink(silk(t, { height: h }))
    m.position.set(x, 0.005, z)
    m.rotation.z = r
    root.add(m)
  }
  // board name + part number, back-right quadrant
  {
    const name = ink(silk('HARK DIGITAL · REV A', { height: 0.3, weight: 600 }))
    name.position.set(3.35, 0.005, -3.55)
    root.add(name)
    const pn = ink(silk('HK-0N  ·  VDD 1.8 V  ·  CLK 100 MHz', { height: 0.13 }))
    pn.position.set(3.38, 0.005, -3.12)
    root.add(pn)
    // the Hark mark in silkscreen
    const { c, g } = canvas(256, 256)
    g.fillStyle = '#fff'
    drawMark(g, 128, 128, 200)
    g.fill('evenodd')
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), withDof(new THREE.MeshStandardMaterial({ map: tex, color: '#e4e6e1', roughness: 0.75, transparent: true, depthWrite: false }), 'alpha'))
    mk.position.set(3.9, 0.005, -4.75)
    root.add(mk)
    const rev = ink(silk('MAKE · LISTEN', { height: 0.14 }))
    rev.position.set(4.55, 0.005, -4.7)
    root.add(rev)
  }
  // outlines: U1 corner brackets + pin-1 dot, part boxes
  {
    const lines: THREE.BufferGeometry[] = []
    const W = 0.014
    const seg = (x0: number, z0: number, x1: number, z1: number) => {
      const l = Math.hypot(x1 - x0, z1 - z0)
      const g = new THREE.BoxGeometry(l + W, 0.001, W)
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0))
      g.translate((x0 + x1) / 2, 0.0045, (z0 + z1) / 2)
      lines.push(g)
    }
    const b = 1.62
    const a = 0.34
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as P2[]) {
      seg(sx * b, sz * b, sx * (b - a), sz * b)
      seg(sx * b, sz * b, sx * b, sz * (b - a))
    }
    const box = (cx: number, cz: number, w: number, d: number, rot: number) => {
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      const P = (x: number, z: number): P2 => [cx + x * c + z * s, cz - x * s + z * c]
      const pts = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)]
      for (let i = 0; i < 4; i++) seg(pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1])
    }
    box(4.3, 4.4, 1.02, 0.95, Math.PI / 4)
    box(-4.2, 4.25, 0.52, 0.42, -Math.PI / 4)
    box(-3.4, -3.4, 0.34, 0.2, Math.PI / 4)
    const dot = new THREE.CircleGeometry(0.05, 16).rotateX(-Math.PI / 2).translate(-1.72, 0.0045, -1.72)
    lines.push(dot)
    root.add(new THREE.Mesh(mergeGeometries(lines)!, silkMat))
  }

  // ---- traces: one object for the whole board
  const traces = new Traces(paths, { width: TRACE_W, color: S.signal, base: '#343a42' })
  // copper fades out with the board (transparent pass, drawn after it)
  const copperMat = traces.copper.material as THREE.MeshStandardMaterial
  copperMat.color.set('#2e343c')
  copperMat.roughness = 0.5
  copperMat.metalness = 0.25
  copperMat.transparent = true
  withDof(copperMat, 'alpha')
  withDofRaw(traces.pulses.material as THREE.ShaderMaterial)
  root.add(traces.group)

  // kit parts (U1 body/leads, U4, U5) get DOF-patched clones of their shared materials
  dofTree(chip)
  // U1's leads: satin tin, so a key near the mirror angle spreads into a sheen, not a pinpoint
  chip.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if ((o as THREE.InstancedMesh).isInstancedMesh && m) {
      m.roughness = 0.42
      m.color.set('#b2b7bd')
    }
  })
  // the far ICs stand up off the board: they fade to transparent with it (no dark
  // silhouettes floating over the backdrop)
  for (const g of [u4, u5]) dofTree(g, new Map(), true)

  // the room far behind the board: out-of-focus practicals and reflections (big, faint discs).
  // Drawn before the board (transparent pass, depth-tested against the parts), so the
  // board covers them where it's in focus and fades over them where it isn't.
  const far: BokehSource[] = []
  {
    const B = rng(77)
    const n = mobile ? 9 : 15
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 2.6 + (B() - 0.5) * 0.25 // azimuth spread around -z
      const r = 36 + B() * 34
      const col = B() < 0.25 ? '#3dffa0' : B() < 0.62 ? '#ffe0b0' : '#dde6f5'
      far.push({ p: new THREE.Vector3(Math.sin(a) * r, 0.5 + B() * 7, -Math.cos(a) * r), color: col, power: 1.1 + B() * 1.6, glint: 0 })
    }
  }
  const bokehFar = new Bokeh(far)
  bokehFar.mesh.renderOrder = -2
  root.add(bokehFar.mesh)
  const bokeh = new Bokeh(glints)
  root.add(bokeh.mesh)

  // ---- U1's etched lid, painted last: by now the etch faces are usually in, so it
  // paints once (otherwise it repaints — cheaply — when they land; never waits)
  await nextFrame()
  const lid = lidMaterial(mobile ? 1024 : 2048, 1024, fontsReady)
  const lidMat = withDof(lid.material)
  top.material = lidMat
  if (!fontsReady) void fontsIn.then(() => lid.redraw())

  const maxLen = Math.max(...traces.lengths)
  return {
    root,
    traces,
    maxLen,
    bokeh,
    bokehFar,
    leds,
    lidMat,
    pins: {
      u1: new THREE.Vector3(-0.85, LID_Y, 0.85),
      vdd: new THREE.Vector3(4.3, 0.18, 4.4),
      clk: new THREE.Vector3(-4.2, 0.09, 4.25),
    },
  }
}
