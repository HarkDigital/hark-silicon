import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, S, chipPackage } from '../../kit/silicon'
import { logoShapes } from '../../logo/logo'
import { rng } from '../../core/math'
import { Bus, type LaneDef } from './bus'
import { SilkAtlas } from './silk'
import { screenMaterial, type ScreenUniforms } from './screen'
import { createVeil, dofUniforms, type DofUniforms } from './dof'

/*
 * THE MOTHERBOARD (work). Units: 1 = 1 cm, board in XZ, y up, front = +z.
 *
 *   U1 (the Hark chip, a BGA) sits at the left. A 39-lane bus leaves it to
 *   the right and runs along the front of six DISPLAY MODULES (16 cm apart);
 *   at each module five lanes peel off in a 45° fan into its FPC connector
 *   and the rest of the bus steps up to stay tight to the row. The last nine
 *   lanes fan out to a column of nine small chips, silkscreened with the
 *   names of the other projects.
 *
 *   A display module: a thin black metal frame on four brass standoffs,
 *   glossy cover glass over a black print border, an amber polyimide flex
 *   cable curling down into a ZIF connector, a driver IC, decoupling caps
 *   and a status LED.
 */

export const NF = 6
export const NR = 9
export const PITCH_X = 19
export const modX = (k: number) => k * PITCH_X
/** display module: outer size, frame thickness, standoff lift, centre z, active area */
export const DISP = { w: 8.44, d: 5.44, t: 0.3, lift: 0.55, z: -1.0, aw: 8.0, ad: 5.0 }
export const DISP_TOP = DISP.lift + DISP.t
export const CONN_Z = 3.35
const BUS_PER = 5
export const BUS = { z0: 5.2, pitch: 0.125, per: BUS_PER }
export const U1 = { x: -16, z: 7.575, w: 5.4 }
/** U1 is a QFP: body, leads per side and their pitch (kit chipPackage rule), lead-tip reach */
const U1_BODY = 5.0
const U1_PINS = NF * BUS_PER + NR
const U1_PITCH = Math.min((U1_BODY * 0.8) / U1_PINS, 0.13)
const U1_TIP = U1_BODY / 2 + 0.17
const u1Lead = (i: number) => -((U1_PINS - 1) * U1_PITCH) / 2 + i * U1_PITCH
/** where the last nine lanes start to fan out, and the column of nine chips */
export const FAN_X = (NF - 1) * PITCH_X + 11
export const NINE = { x: (NF - 1) * PITCH_X + 27, z0: -5, pitch: 2.5 }
export const nineZ = (j: number) => NINE.z0 + NINE.pitch * j
export const BOARD = { x0: -30, x1: NINE.x + 16, z0: -7.2, z1: 18, t: 0.16 }
/** status LEDs: 0..5 modules, 6..14 the nine chips, 15 power */
export const LED_PWR = 15

const v3 = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z)
const UP = new THREE.Vector3(0, 1, 0)
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/* ------------------------------------------------------------------ lanes */

function buildLanes(): LaneDef[] {
  const lanes: LaneDef[] = []
  const P = BUS.pitch
  const zc = CONN_Z + 0.55
  const ze = zc + 0.5
  const jog = (pts: THREE.Vector3[], z: number, upto: number) => {
    for (let k = 0; k < upto; k++) {
      const xj = modX(k) + 1.4
      pts.push(v3(xj, z))
      z -= BUS.per * P
      pts.push(v3(xj + BUS.per * P, z))
    }
    return z
  }
  // every bus lane leaves a lead on U1's right side and eases out to the bus pitch
  const start = (n: number) => {
    const zs = U1.z + u1Lead(n)
    const zb = BUS.z0 + n * P
    const x0 = U1.x + U1_TIP - 0.08
    return [v3(x0, zs), v3(x0 + 0.3, zs), v3(x0 + 0.3 + Math.abs(zb - zs), zb)]
  }
  for (let g = 0; g < NF; g++) {
    for (let i = 0; i < BUS.per; i++) {
      const n = g * BUS.per + i
      const pts = start(n)
      const z = jog(pts, BUS.z0 + n * P, g)
      const p = modX(g) + (i - 2) * 0.3
      const dz = z - ze
      pts.push(v3(p - dz, z), v3(p, ze), v3(p, zc))
      lanes.push({ pts, group: g, lane: i })
    }
  }
  for (let i = 0; i < NR; i++) {
    const n = NF * BUS.per + i
    const pts = start(n)
    const z = jog(pts, BUS.z0 + n * P, NF)
    const zt = nineZ(i)
    const up = zt < z
    const xt = FAN_X + 0.4 * (up ? i : NR - 1 - i)
    const dz = Math.abs(zt - z)
    pts.push(v3(xt, z), v3(xt + dz, zt), v3(NINE.x - 0.86, zt))
    lanes.push({ pts, group: 6, lane: i })
  }
  // misc (ambient only): U1 → flash U2, three differential pairs along the front
  for (let i = 0; i < 6; i++) {
    const xl = U1.x + u1Lead(16 + i)
    const xp = U1.x - 0.625 + i * 0.25
    const zk = U1.z - U1_TIP - 0.35
    lanes.push({ pts: [v3(xl, U1.z - U1_TIP + 0.08), v3(xl, zk), v3(xp, zk - Math.abs(xp - xl)), v3(xp, -0.72)], group: 7, lane: i })
  }
  for (let j = 0; j < 3; j++) {
    for (const off of [0, U1_PITCH]) {
      const xs = U1.x + u1Lead(29 + 3 * j) + off
      const zr = 14.0 + j * 0.55 + off
      const xe = 34 + j * 22
      lanes.push({ pts: [v3(xs, U1.z + U1_TIP - 0.08), v3(xs, zr - 0.8), v3(xs + 0.8, zr), v3(xe, zr), v3(xe + 0.6, zr + 0.6)], group: 7, lane: 0 })
    }
  }
  // per module: driver IC → display edge, regulator → caps
  for (let k = 0; k < NF; k++) {
    const x = modX(k)
    for (let i = 0; i < 4; i++) {
      const lx = x + 3.05 + i * 0.22
      lanes.push({ pts: [v3(lx, 2.95), v3(lx, 2.2), v3(lx - 0.5, 1.7)], group: 7, lane: 0 })
    }
  }
  return lanes
}

/* ------------------------------------------------------------------ parts bin */

let _tin: THREE.MeshStandardMaterial | null = null
/** satin tin for leads and pads (the kit's is mirror-bright; at macro range it blows out) */
const tin = () => (_tin ??= new THREE.MeshStandardMaterial({ color: '#aeb4bc', roughness: 0.44, metalness: 1 }))

type BinName = 'tan' | 'black' | 'tin' | 'gold' | 'epoxy' | 'ind' | 'plastic' | 'beige'

/** Instanced little parts: every box on the board goes into one of a few bins. */
class Parts {
  bins: Record<BinName, THREE.Matrix4[]> = { tan: [], black: [], tin: [], gold: [], epoxy: [], ind: [], plastic: [], beige: [] }
  cans: THREE.Matrix4[] = []
  vias: THREE.Matrix4[] = []

  box(bin: BinName, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot = 0) {
    _q.setFromAxisAngle(UP, rot)
    this.bins[bin].push(new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)))
  }

  /** a two-terminal chip part (0402 / 0603 cap or resistor) with gold pads peeking out */
  chip2(x: number, z: number, rot = 0, size: 402 | 603 = 402, kind: 'cap' | 'res' = 'cap') {
    const L = size === 402 ? 0.1 : 0.16
    const Wd = size === 402 ? 0.05 : 0.08
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const at = (u: number) => [x + u * c, z - u * s] as const
    this.box(kind === 'cap' ? 'tan' : 'black', x, 0.003, z, L * 0.9, Wd * 0.96, Wd, rot)
    for (const e of [-1, 1]) {
      const [ex, ez] = at(e * (L / 2 - L * 0.1))
      this.box('tin', ex, 0.003, ez, L * 0.22, Wd * 1.0, Wd * 1.04, rot)
      const [px, pz] = at(e * (L / 2 - L * 0.06))
      this.box('gold', px, 0, pz, L * 0.42, 0.004, Wd * 1.3, rot)
    }
  }

  /** a QFN/QFP-ish IC: epoxy body + tin pads round the edge */
  ic(x: number, z: number, w: number, d: number, h: number, pins: number, rot = 0) {
    this.box('epoxy', x, 0.004, z, w, h, d, rot)
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    for (let side = 0; side < 4; side++) {
      const alongX = side % 2 === 0
      const half = alongX ? d / 2 : w / 2
      const span = alongX ? w : d
      const n = pins
      const pitch = (span * 0.8) / n
      for (let i = 0; i < n; i++) {
        const t = -((n - 1) * pitch) / 2 + i * pitch
        const sgn = side < 2 ? 1 : -1
        const lx = alongX ? t : sgn * (half + 0.02)
        const lz = alongX ? sgn * (half + 0.02) : t
        const wx = x + lx * c + lz * s
        const wz = z - lx * s + lz * c
        this.box('tin', wx, 0, wz, alongX ? pitch * 0.5 : 0.09, 0.02, alongX ? 0.09 : pitch * 0.5, rot)
      }
    }
  }

  /** SOT-23 style regulator: a small black body with three gull-wing legs */
  sot(x: number, z: number, rot = 0, big = false) {
    const k = big ? 2.2 : 1
    this.box('plastic', x, 0.012, z, 0.29 * k, 0.1 * k, 0.16 * k, rot)
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const legs: [number, number][] = [
      [-0.095 * k, 0.12 * k],
      [0.095 * k, 0.12 * k],
      [0, -0.12 * k],
    ]
    for (const [u, w] of legs) this.box('tin', x + u * c + w * s, 0, z - u * s + w * c, 0.04 * k, 0.02, 0.1 * k, rot)
    if (big) this.box('tin', x - 0.0 * c - 0.2 * k * s, 0, z + 0.2 * k * c, 0.3 * k, 0.03, 0.12 * k, rot)
  }

  inductor(x: number, z: number, size = 0.42) {
    this.box('ind', x, 0.004, z, size, size * 0.45, size)
    this.box('tin', x - size * 0.5, 0, z, 0.06, 0.03, size * 0.8)
    this.box('tin', x + size * 0.5, 0, z, 0.06, 0.03, size * 0.8)
  }

  /** aluminium polymer capacitor: a can on a black base */
  can(x: number, z: number, r = 0.32, h = 0.72) {
    this.cans.push(new THREE.Matrix4().compose(_p.set(x, 0.06, z), _q.identity(), _s.set(r, h, r)))
    this.box('plastic', x, 0, z, r * 2.15, 0.06, r * 2.15)
  }

  /** a 2-row pin header: black plastic body, gold square posts */
  header(x: number, z: number, cols: number) {
    const p = 0.254
    this.box('plastic', x, 0, z, 2 * p, 0.25, cols * p)
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < cols; c++) this.box('gold', x + (r - 0.5) * p, 0.02, z + (c - (cols - 1) / 2) * p, 0.064, 0.84, 0.064)
  }

  crystal(x: number, z: number, rot = 0) {
    this.box('plastic', x, 0, z, 1.15, 0.05, 0.5, rot)
    this.box('ind', x, 0.05, z, 1.05, 0.3, 0.44, rot)
  }

  via(x: number, z: number) {
    this.vias.push(new THREE.Matrix4().makeTranslation(x, 0.0025, z))
  }

  build(): THREE.Group {
    const g = new THREE.Group()
    const unit = new THREE.BoxGeometry(1, 1, 1)
    unit.translate(0, 0.5, 0)
    const mats: Record<BinName, THREE.Material> = {
      tan: new THREE.MeshStandardMaterial({ color: '#8a7050', roughness: 0.55 }),
      black: new THREE.MeshStandardMaterial({ color: '#121314', roughness: 0.5 }),
      tin: tin(),
      gold: MAT.gold(),
      epoxy: MAT.epoxy(),
      ind: new THREE.MeshStandardMaterial({ color: '#2c2d30', roughness: 0.78 }),
      plastic: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.45 }),
      beige: new THREE.MeshStandardMaterial({ color: '#b9ab8c', roughness: 0.6 }),
    }
    for (const k of Object.keys(this.bins) as BinName[]) {
      const list = this.bins[k]
      if (!list.length) continue
      const im = new THREE.InstancedMesh(unit, mats[k], list.length)
      list.forEach((m, i) => im.setMatrixAt(i, m))
      im.computeBoundingSphere()
      g.add(im)
    }
    if (this.cans.length) {
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 1)
      cyl.translate(0, 0.5, 0)
      const im = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: '#aab0b8', roughness: 0.38, metalness: 1 }), this.cans.length)
      this.cans.forEach((m, i) => im.setMatrixAt(i, m))
      im.computeBoundingSphere()
      g.add(im)
    }
    if (this.vias.length) {
      const ring = new THREE.RingGeometry(0.02, 0.043, 12)
      ring.rotateX(-Math.PI / 2)
      const im = new THREE.InstancedMesh(ring, MAT.gold(), this.vias.length)
      this.vias.forEach((m, i) => im.setMatrixAt(i, m))
      im.computeBoundingSphere()
      g.add(im)
    }
    return g
  }
}

/* ------------------------------------------------------------------ textures */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

/** subtle copper pours under the black mask (slightly lighter planes with clearances) */
function pourTexture(mobile: boolean) {
  const W = mobile ? 1024 : 2048
  const bw = BOARD.x1 - BOARD.x0
  const bd = BOARD.z1 - BOARD.z0
  const H = Math.round((W * bd) / bw)
  const s = W / bw
  const { c, g } = canvas(W, H)
  const X = (x: number) => (x - BOARD.x0) * s
  const Z = (z: number) => (z - BOARD.z0) * s
  g.fillStyle = '#08090b'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#0b0d10'
  const pour = (x0: number, z0: number, x1: number, z1: number) => g.fillRect(X(x0), Z(z0), (x1 - x0) * s, (z1 - z0) * s)
  pour(BOARD.x0 + 0.6, BOARD.z0 + 0.6, BOARD.x1 - 0.6, 4.55)
  pour(BOARD.x0 + 0.6, 10.55, BOARD.x1 - 0.6, BOARD.z1 - 0.6)
  // clearances around the connectors, fans, U1 and the nine
  g.fillStyle = '#08090b'
  for (let k = 0; k < NF; k++) g.fillRect(X(modX(k) - 2.4), Z(2.6), 4.8 * s, 2.2 * s)
  g.fillRect(X(U1.x - 3.4), Z(U1.z - 3.4), 6.8 * s, 6.8 * s)
  g.fillRect(X(FAN_X - 1), Z(-6.2), 32 * s, 23 * s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** tileable 'orange peel' normal map for the solder mask's clear coat */
function peelNormal() {
  const N = 128
  const r = rng(11)
  const G = 32
  const grid = Array.from({ length: G * G }, () => r())
  const hAt = (x: number, y: number) => {
    const gx = (x / N) * G
    const gy = (y / N) * G
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const at = (i: number, j: number) => grid[((j + G) % G) * G + ((i + G) % G)]
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
    return a + (b - a) * sy
  }
  const { c, g } = canvas(N, N)
  const img = g.createImageData(N, N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = hAt(x + 1, y) - hAt(x - 1, y)
      const dy = hAt(x, y + 1) - hAt(x, y - 1)
      const nx = -dx * 3
      const ny = -dy * 3
      const l = Math.hypot(nx, ny, 1)
      const i = (y * N + x) * 4
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set((BOARD.x1 - BOARD.x0) / 0.7, (BOARD.z1 - BOARD.z0) / 0.7)
  return t
}

/** amber polyimide flex: copper lines along it, a stiffener and gold fingers at the connector end */
function fpcTexture() {
  const { c, g } = canvas(256, 512)
  g.fillStyle = '#8a4716'
  g.fillRect(0, 0, 256, 512)
  // coverlay sheen variation
  const gr = g.createLinearGradient(0, 0, 256, 0)
  gr.addColorStop(0, 'rgba(255,190,110,0.10)')
  gr.addColorStop(0.5, 'rgba(0,0,0,0)')
  gr.addColorStop(1, 'rgba(255,190,110,0.08)')
  g.fillStyle = gr
  g.fillRect(0, 0, 256, 512)
  g.fillStyle = 'rgba(196,124,60,0.8)'
  for (let x = 14; x < 244; x += 11) g.fillRect(x, 72, 4, 440)
  // stiffener + exposed gold fingers at the connector end (v = 1 = canvas top)
  g.fillStyle = '#6b3810'
  g.fillRect(0, 0, 256, 72)
  g.fillStyle = '#e0b35c'
  for (let x = 14; x < 244; x += 11) g.fillRect(x - 1, 0, 6, 42)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** soft rounded-rect contact shadow (alpha) */
function shadowTexture() {
  const { c, g } = canvas(128, 128)
  const img = g.createImageData(128, 128)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const u = Math.abs(x / 127 - 0.5) * 2
      const v = Math.abs(y / 127 - 0.5) * 2
      const d = Math.max(0, Math.hypot(Math.max(0, u - 0.55), Math.max(0, v - 0.55)) / 0.45)
      const a = Math.max(0, 1 - d)
      const i = (y * 128 + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * a * (3 - 2 * a) * 255)
    }
  }
  g.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(c)
}

/** radial glow for LED light spill on the mask */
function glowTexture() {
  const { c, g } = canvas(128, 128)
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.18, 'rgba(255,255,255,0.45)')
  gr.addColorStop(0.5, 'rgba(255,255,255,0.1)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, -size)
  g.beginPath()
  for (const s of logoShapes()) {
    s.getPoints(40).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    for (const h of s.holes) {
      h.getPoints(20).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
  }
  g.fill('evenodd')
  g.restore()
}

/** laser-etched tops for the nine chips: a 3×3 atlas */
function nineTopTexture() {
  const N = 768
  const cell = N / 3
  const { c, g } = canvas(N, N)
  for (let j = 0; j < 9; j++) {
    const x0 = (j % 3) * cell
    const y0 = Math.floor(j / 3) * cell
    g.fillStyle = '#17191c'
    g.fillRect(x0, y0, cell, cell)
    g.fillStyle = 'rgba(186,192,200,0.5)'
    drawMark(g, x0 + cell / 2, y0 + cell * 0.42, cell * 0.36)
    g.font = `500 ${Math.round(cell * 0.12)}px 'Martian Mono Variable', ui-monospace, monospace`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(`HK-${String(NF + j + 1).padStart(2, '0')}`, x0 + cell / 2, y0 + cell * 0.8)
    g.beginPath()
    g.arc(x0 + cell * 0.13, y0 + cell * 0.13, cell * 0.035, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/* ------------------------------------------------------------------ geometry helpers */

/** the flex cable: a ribbon along a cubic bezier in the module's YZ plane */
function fpcGeometry(x: number, width: number): THREE.BufferGeometry {
  const y0 = DISP.lift + 0.04
  const zEdge = DISP.z + DISP.d / 2
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, y0, zEdge - 0.5),
    new THREE.Vector3(0, y0 - 0.02, zEdge + 0.7),
    new THREE.Vector3(0, 0.16, CONN_Z - 1.1),
    new THREE.Vector3(0, 0.12, CONN_Z - 0.05),
  )
  const n = 28
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = curve.getPoint(t)
    pos.push(x - width / 2, p.y, p.z, x + width / 2, p.y, p.z)
    uv.push(0, t, 1, t)
    if (i < n) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** gull-wing lead (points +x), for the nine chips */
function gullWing(pitch: number) {
  const t = 0.016
  const a = new THREE.BoxGeometry(0.1, t, pitch * 0.5)
  a.translate(0.05, 0.1, 0)
  const b = new THREE.BoxGeometry(t, 0.1, pitch * 0.5)
  b.translate(0.1, 0.05, 0)
  const c = new THREE.BoxGeometry(0.09, t, pitch * 0.5)
  c.translate(0.14, 0.008, 0)
  return mergeGeometries([a, b, c])!
}

/* ------------------------------------------------------------------ the board */

export interface ModuleHandle {
  x: number
  screen: THREE.Mesh
  u: ScreenUniforms
  mat: THREE.MeshStandardMaterial
}

export interface NineHandle {
  bodies: THREE.InstancedMesh
  tops: THREE.InstancedMesh
  leads: THREE.InstancedMesh
  shadows: THREE.InstancedMesh
  /** lead offsets relative to the chip centre (applied every placement frame) */
  leadLocal: THREE.Matrix4[]
  /** current drop height per chip (to skip redundant matrix writes) */
  y: number[]
}

export interface Board {
  root: THREE.Group
  bus: Bus
  lanes: LaneDef[]
  modules: ModuleHandle[]
  nine: NineHandle
  leds: THREE.InstancedMesh
  ledGlow: THREE.InstancedMesh
  ledPos: THREE.Vector3[]
  /** depth of field (the blur veil); veil is null on phones */
  dof: DofUniforms
  veil: THREE.Mesh | null
  /** for groups: the index of every lane's group-local endpoint (for camera helpers) */
  laneEnd: (group: number, lane: number) => THREE.Vector3
}

export async function buildBoard(opts: { mobile: boolean; dof: boolean; names: string[]; tagline: string; locale: string; yieldFn: () => Promise<void> }): Promise<Board> {
  const root = new THREE.Group()
  const parts = new Parts()
  const silk = new SilkAtlas()
  const r = rng(29)

  /* ---- the PCB itself */
  const bw = BOARD.x1 - BOARD.x0
  const bd = BOARD.z1 - BOARD.z0
  const pcbGeo = new THREE.BoxGeometry(bw, BOARD.t, bd)
  const top = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: pourTexture(opts.mobile),
    roughness: 0.64,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.34,
    clearcoatNormalMap: peelNormal(),
    clearcoatNormalScale: new THREE.Vector2(0.05, 0.05),
  })
  const edge = new THREE.MeshStandardMaterial({ color: '#2b2a22', roughness: 0.85 })
  const pcb = new THREE.Mesh(pcbGeo, [edge, edge, top, edge, edge, edge])
  pcb.position.set((BOARD.x0 + BOARD.x1) / 2, -BOARD.t / 2, (BOARD.z0 + BOARD.z1) / 2)
  root.add(pcb)

  /* ---- lanes */
  const lanes = buildLanes()
  const dof = dofUniforms()
  const bus = new Bus(lanes, { width: 0.05, glow: 0.24, dof })
  root.add(bus.group)
  await opts.yieldFn()

  /* ---- U1: the Hark chip on its substrate */
  const u1 = new THREE.Group()
  // the same Hark chip as the Package chapter, now seated on the board
  const pkg = chipPackage({ w: U1_BODY, h: 0.3, kind: 'qfp', pinsPerSide: U1_PINS, lines: ['HARK-1', 'HK-01 · REV A'], mark: true })
  u1.add(pkg)
  // gold lands under every lead
  for (let side = 0; side < 4; side++) {
    const a = (side * Math.PI) / 2
    const c = Math.cos(a)
    const sn = Math.sin(a)
    for (let i = 0; i < U1_PINS; i++) {
      const lz = u1Lead(i)
      const lx = U1_TIP - 0.06
      parts.box('gold', U1.x + lx * c + lz * sn, 0, U1.z - lx * sn + lz * c, 0.2, 0.004, U1_PITCH * 0.55, a)
    }
  }
  u1.position.set(U1.x, 0, U1.z)
  root.add(u1)
  silk.corners(U1.x - U1.w / 2 - 0.25, U1.z - U1.w / 2 - 0.25, U1.x + U1.w / 2 + 0.25, U1.z + U1.w / 2 + 0.25, 0.8, 0.035)
  silk.tri(U1.x - U1.w / 2 - 0.55, U1.z - U1.w / 2 - 0.15, 0.24, 0)
  silk.text('U1', U1.x - U1.w / 2 - 0.2, U1.z - U1.w / 2 - 0.62, { h: 0.34 })
  // decoupling round U1 (rows on the free sides)
  for (let i = 0; i < 12; i++) {
    if (i < 7) parts.chip2(U1.x - 2.2 + i * 0.4, U1.z + U1.w / 2 + 0.55, Math.PI / 2, 402, i % 3 === 2 ? 'res' : 'cap')
    parts.chip2(U1.x - U1.w / 2 - 0.55, U1.z - 2.2 + i * 0.4, 0, 402, 'cap')
  }
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2
    parts.via(U1.x - U1.w / 2 - 1.0 + Math.cos(a) * 0.15, U1.z - 2.4 + i * 0.19)
  }
  // flash U2 above it, crystal Y1, the power LED
  parts.ic(U1.x, -1.35, 1.9, 1.1, 0.16, 6)
  silk.corners(U1.x - 1.25, -2.15, U1.x + 1.25, -0.55, 0.3, 0.03).text('U2', U1.x - 1.25, -2.55, { h: 0.26 })
  parts.crystal(U1.x - 4.3, U1.z - 1.2, Math.PI / 2)
  silk.rect(U1.x - 4.65, U1.z - 1.95, U1.x - 3.95, U1.z - 0.45, 0.03).text('Y1', U1.x - 4.72, U1.z - 2.3, { h: 0.24 })
  for (let i = 0; i < 4; i++) parts.chip2(U1.x - 5.4, U1.z + 1.0 + i * 0.3, 0, 603, 'cap')
  silk.text('HARK SILICON  HK-MB01  REV A', U1.x + 3.6, 11.5, { h: 0.36, weight: 600 })
  silk.text(opts.tagline.toUpperCase(), U1.x + 3.6, 12.2, { h: 0.28 })
  silk.text(opts.locale.toUpperCase(), U1.x + 3.6, 12.8, { h: 0.2 })
  silk.text('BUS A[0:38]', U1.x + 3.4, 4.72, { h: 0.2 })
  // regulator cluster between U1 and module 1
  parts.can(-9.6, -1.6)
  parts.can(-8.7, -1.6)
  parts.inductor(-9.2, 0.2, 0.62)
  parts.sot(-7.6, 0.2, 0, true)
  for (let i = 0; i < 5; i++) parts.chip2(-10.4 + i * 0.3, 1.4, Math.PI / 2, 603, 'cap')
  silk.text('C31', -10.1, -2.45, { h: 0.2 }).text('L1', -9.55, 0.95, { h: 0.2 }).text('U3', -7.85, 1.0, { h: 0.2 })
  await opts.yieldFn()

  /* ---- display modules */
  const modules: ModuleHandle[] = []
  const frameMat = new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.36, metalness: 0.75 })
  const frames = new THREE.InstancedMesh(new RoundedBoxGeometry(DISP.w, DISP.t, DISP.d, 2, 0.05), frameMat, NF)
  const brass = new THREE.MeshStandardMaterial({ color: '#b79552', roughness: 0.32, metalness: 1 })
  const standoffs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.17, DISP.lift, 6), brass, NF * 4)
  const connBody = new THREE.InstancedMesh(new RoundedBoxGeometry(3.9, 0.2, 0.62, 1, 0.02), new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.5 }), NF)
  const connLatch = new THREE.InstancedMesh(new THREE.BoxGeometry(3.7, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: '#b7a888', roughness: 0.55 }), NF)
  const PINS = 21
  const connPins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.03, 0.26), tin(), NF * PINS)
  const fpcGeos: THREE.BufferGeometry[] = []
  const active = new THREE.Vector2(DISP.aw / DISP.w, DISP.ad / DISP.d)
  for (let k = 0; k < NF; k++) {
    const x = modX(k)
    frames.setMatrixAt(k, _m.makeTranslation(x, DISP.lift + DISP.t / 2, DISP.z))
    let si = 0
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) standoffs.setMatrixAt(k * 4 + si++, _m.makeTranslation(x + sx * (DISP.w / 2 - 0.45), DISP.lift / 2, DISP.z + sz * (DISP.d / 2 - 0.45)))
    const { mat, u } = screenMaterial(active)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(DISP.w - 0.05, DISP.d - 0.05), mat)
    screen.rotation.x = -Math.PI / 2
    screen.position.set(x, DISP_TOP + 0.002, DISP.z)
    root.add(screen)
    modules.push({ x, screen, u, mat })
    fpcGeos.push(fpcGeometry(x, 3.1))
    connBody.setMatrixAt(k, _m.makeTranslation(x, 0.1, CONN_Z))
    connLatch.setMatrixAt(k, _m.makeTranslation(x, 0.21, CONN_Z - 0.2))
    for (let i = 0; i < PINS; i++) connPins.setMatrixAt(k * PINS + i, _m.makeTranslation(x + (i - (PINS - 1) / 2) * 0.15, 0.015, CONN_Z + 0.4))
    // side pins: short stubs to staggered vias
    for (let i = 0; i < PINS; i++) {
      const px = x + (i - (PINS - 1) / 2) * 0.15
      if (Math.abs(px - x) < 0.7) continue
      parts.via(px, CONN_Z + 0.78 + (i % 2) * 0.22)
    }
    // driver IC, decoupling, regulator, status LED
    parts.ic(x + 3.45, 3.35, 1.2, 1.2, 0.09, 7)
    for (let i = 0; i < 5; i++) parts.chip2(x + 4.55, 2.75 + i * 0.3, 0, 402, 'cap')
    parts.chip2(x + 2.35, 3.95, Math.PI / 2, 402, 'res')
    parts.chip2(x + 2.6, 3.95, Math.PI / 2, 402, 'res')
    parts.inductor(x - 4.7, 3.95, 0.5)
    parts.sot(x - 3.35, 3.85, Math.PI / 2)
    for (let i = 0; i < 3; i++) parts.chip2(x - 6.05 + i * 0.28, 4.35, Math.PI / 2, 603, 'cap')
    for (let i = 0; i < 8; i++) parts.via(x + 2.1 + i * 0.32, 4.72)
    // silkscreen: courtyard, refdes, module label
    silk.corners(x - DISP.w / 2 - 0.3, DISP.z - DISP.d / 2 - 0.3, x + DISP.w / 2 + 0.3, DISP.z + DISP.d / 2 + 0.3, 0.9, 0.04)
    silk.text(`DS${k + 1}  MODULE ${String(k + 1).padStart(2, '0')}`, x - DISP.w / 2 - 0.25, 2.4, { h: 0.24, weight: 600 })
    silk.rect(x - 2.1, CONN_Z - 0.45, x + 2.1, CONN_Z + 0.4, 0.03)
    silk.text(`J${k + 1}`, x - 2.1, CONN_Z + 0.78, { h: 0.24 })
    silk.tri(x - 2.35, CONN_Z + 0.4, 0.16, -Math.PI / 2)
    silk.text(`U${k + 4}`, x + 2.85, 2.45, { h: 0.2 })
    silk.text(`LED${k + 1}`, x + 1.55, 2.2, { h: 0.18, align: 'right' })
    silk.text('L2', x - 5.2, 3.45, { h: 0.18 }).text('C8', x - 6.75, 4.35, { h: 0.18 })
    // between this module and the next: a power cluster
    if (k < NF - 1) {
      const gx = x + PITCH_X / 2
      parts.can(gx - 0.5, -2.6)
      parts.can(gx + 0.5, -2.6)
      parts.inductor(gx, -0.8, 0.7)
      parts.sot(gx - 0.1, 0.9, 0, true)
      for (let i = 0; i < 6; i++) parts.chip2(gx - 1.6, -1.8 + i * 0.3, 0, 603, i % 2 ? 'res' : 'cap')
      for (let i = 0; i < 6; i++) parts.chip2(gx + 1.6, -1.8 + i * 0.3, 0, 402, 'cap')
      silk.text(`C${40 + k * 2}`, gx - 1.1, -3.45, { h: 0.2 }).text(`L${k + 3}`, gx + 0.55, -0.2, { h: 0.2 })
      for (let i = 0; i < 10; i++) parts.via(gx - 1.9 + (i % 5) * 0.95, 2.4 + Math.floor(i / 5) * 0.5)
      parts.header(gx + 3.1, -1.4, 6)
      silk.rect(gx + 2.78, -2.3, gx + 3.42, -0.5, 0.025).text(`P${k + 1}`, gx + 2.8, -2.65, { h: 0.2 })
      parts.ic(gx - 3.3, -0.9, 1.5, 1.5, 0.14, 8, Math.PI / 4)
      silk.text(`U${k + 20}`, gx - 4.4, 0.35, { h: 0.2 })
      parts.crystal(gx - 3.3, 1.1)
      for (let i = 0; i < 4; i++) parts.chip2(gx - 4.6 + i * 0.3, -2.6, Math.PI / 2, 402, 'cap')
    }
  }
  root.add(frames, standoffs, connBody, connLatch, connPins)
  const fpc = new THREE.Mesh(mergeGeometries(fpcGeos)!, new THREE.MeshStandardMaterial({ map: fpcTexture(), roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide }))
  fpcGeos.forEach(g => g.dispose())
  root.add(fpc)
  await opts.yieldFn()

  /* ---- the nine chips (placed like a pick-and-place machine) */
  const nineBody = new THREE.InstancedMesh(new RoundedBoxGeometry(1.3, 0.2, 1.3, 1, 0.025), MAT.epoxy(), NR)
  const topGeo = new THREE.PlaneGeometry(1.24, 1.24)
  topGeo.rotateX(-Math.PI / 2)
  const cells = new Float32Array(NR * 2)
  for (let j = 0; j < NR; j++) {
    cells[j * 2] = (j % 3) / 3
    cells[j * 2 + 1] = 1 - (Math.floor(j / 3) + 1) / 3
  }
  topGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2))
  const topMat = new THREE.MeshStandardMaterial({ map: nineTopTexture(), roughness: 0.6 })
  topMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv / 3.0 + aCell;')
  }
  topMat.customProgramCacheKey = () => 'wk-ninetop'
  const nineTops = new THREE.InstancedMesh(topGeo, topMat, NR)
  const LEADS = 5
  const leadGeo = gullWing(0.2)
  const nineLeads = new THREE.InstancedMesh(leadGeo, tin(), NR * LEADS * 4)
  const leadLocal: THREE.Matrix4[] = []
  for (let side = 0; side < 4; side++) {
    _q.setFromAxisAngle(UP, (side * Math.PI) / 2)
    for (let i = 0; i < LEADS; i++) {
      const along = (i - (LEADS - 1) / 2) * 0.2
      const p = new THREE.Vector3(0.63, 0, along).applyQuaternion(_q)
      leadLocal.push(new THREE.Matrix4().compose(p, _q.clone(), new THREE.Vector3(1, 1, 1)))
    }
  }
  const shadowTex = shadowTexture()
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: shadowTex, transparent: true, opacity: 0.85, depthWrite: false })
  const shadowGeo = new THREE.PlaneGeometry(1, 1)
  shadowGeo.rotateX(-Math.PI / 2)
  const nineShadows = new THREE.InstancedMesh(shadowGeo, shadowMat, NR)
  nineShadows.renderOrder = 1
  const nine: NineHandle = { bodies: nineBody, tops: nineTops, leads: nineLeads, shadows: nineShadows, leadLocal, y: new Array(NR).fill(-1) }
  root.add(nineBody, nineTops, nineLeads, nineShadows)
  for (let j = 0; j < NR; j++) {
    const z = nineZ(j)
    // gold land pattern under each (visible while the part is in the air)
    for (let side = 0; side < 4; side++) {
      const a = (side * Math.PI) / 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      for (let i = 0; i < LEADS; i++) {
        const lz = (i - (LEADS - 1) / 2) * 0.2
        parts.box('gold', NINE.x + 0.79 * c + lz * s, 0, z - 0.79 * s + lz * c, 0.22, 0.004, 0.1, a)
      }
    }
    parts.chip2(NINE.x + 0.05, z - 1.0, 0, 402, 'cap')
    parts.chip2(NINE.x + 0.45, z - 1.0, 0, 402, 'cap')
    silk.corners(NINE.x - 0.95, z - 0.95, NINE.x + 0.95, z + 0.95, 0.3, 0.03)
    silk.dot(NINE.x - 1.12, z - 1.12, 0.07)
    const w = (opts.names[j] ?? '').toUpperCase()
    silk.text(`U${String(NF + j + 1).padStart(2, '0')}`, NINE.x + 1.35, z - 0.28, { h: 0.3, weight: 600 })
    silk.text(w, NINE.x + 1.35, z + 0.2, { h: 0.34 })
    parts.via(NINE.x - 1.35, z + 0.6)
    parts.via(NINE.x - 1.35, z - 0.6)
  }
  silk.text(`U${String(NF + 1).padStart(2, '0')}–U${String(NF + NR).padStart(2, '0')}`, NINE.x - 1.0, NINE.z0 - 1.45, { h: 0.3, weight: 600 })
  silk.line(NINE.x - 1.0, NINE.z0 - 1.12, NINE.x + 10.5, NINE.z0 - 1.12, 0.025)

  /* ---- status LEDs + their light spill */
  const ledPos: THREE.Vector3[] = []
  for (let k = 0; k < NF; k++) ledPos.push(new THREE.Vector3(modX(k) + 2.3, 0, 2.55))
  for (let j = 0; j < NR; j++) ledPos.push(new THREE.Vector3(NINE.x - 0.55, 0, nineZ(j) + 1.0))
  ledPos.push(new THREE.Vector3(U1.x + 3.8, 0, U1.z - 3.6))
  silk.text('PWR', U1.x + 4.1, U1.z - 3.62, { h: 0.2 })
  const ledGeo = new THREE.BoxGeometry(0.16, 0.07, 0.08)
  ledGeo.translate(0, 0.035, 0)
  const leds = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), ledPos.length)
  const glowGeo = new THREE.PlaneGeometry(1, 1)
  glowGeo.rotateX(-Math.PI / 2)
  const ledGlow = new THREE.InstancedMesh(
    glowGeo,
    new THREE.MeshBasicMaterial({ color: '#ffffff', map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    ledPos.length,
  )
  ledGlow.renderOrder = 3
  const black = new THREE.Color(0, 0, 0)
  ledPos.forEach((p, i) => {
    parts.box('gold', p.x - 0.07, 0, p.z, 0.06, 0.004, 0.1)
    parts.box('gold', p.x + 0.07, 0, p.z, 0.06, 0.004, 0.1)
    leds.setMatrixAt(i, _m.makeTranslation(p.x, 0.004, p.z))
    leds.setColorAt(i, new THREE.Color(0.05, 0.055, 0.05))
    ledGlow.setMatrixAt(i, _m.compose(_p.set(p.x, 0.01, p.z), _q.identity(), _s.set(1.3, 1, 1.3)))
    ledGlow.setColorAt(i, black)
  })
  root.add(leds, ledGlow)

  /* ---- contact shadows (displays, U1, cans) */
  const shadowList: THREE.Matrix4[] = []
  for (let k = 0; k < NF; k++) shadowList.push(new THREE.Matrix4().compose(_p.set(modX(k), 0.004, DISP.z + 0.15), _q.identity(), _s.set(DISP.w + 1.4, 1, DISP.d + 1.4)))
  shadowList.push(new THREE.Matrix4().compose(_p.set(U1.x, 0.004, U1.z), _q.identity(), _s.set(U1.w + 0.9, 1, U1.w + 0.9)))
  for (const m of parts.cans) {
    const p = new THREE.Vector3().setFromMatrixPosition(m)
    shadowList.push(new THREE.Matrix4().compose(_p.set(p.x + 0.05, 0.004, p.z + 0.05), _q.identity(), _s.set(1.1, 1, 1.1)))
  }
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, shadowList.length)
  shadowList.forEach((m, i) => shadows.setMatrixAt(i, m))
  shadows.renderOrder = 1
  root.add(shadows)

  /* ---- fill: stitching vias along the bus edges, fiducials, test points, mounting holes */
  for (let x = U1.x + 3.2; x < modX(NF - 1) + 4; x += 0.62) parts.via(x, 10.4)
  for (let x = -12; x < modX(NF - 1) + 4; x += 0.9) {
    const k = Math.round(x / PITCH_X)
    if (Math.abs(x - modX(k)) < 6.5) continue
    parts.via(x, 4.45)
  }
  let vi = 0
  while (vi < (opts.mobile ? 160 : 320)) {
    const x = BOARD.x0 + 1 + r() * (bw - 2)
    const z = BOARD.z0 + 1 + r() * (bd - 2)
    const k = Math.round(x / PITCH_X)
    const inDisp = k >= 0 && k < NF && Math.abs(x - modX(k)) < DISP.w / 2 + 0.5 && Math.abs(z - DISP.z) < DISP.d / 2 + 0.6
    const inBus = z > 4.3 && z < 10.6 && x > U1.x - 3 && x < FAN_X + 12
    const inU1 = Math.abs(x - U1.x) < 4 && Math.abs(z - U1.z) < 4
    const inNine = x > NINE.x - 4 && x < NINE.x + 13 && z > -7 && z < 17
    const inSilk = x > U1.x + 3 && x < U1.x + 15 && z > 11 && z < 13.2
    const inPairs = z > 13.6 && z < 16.1 && x < 80
    if (inDisp || inBus || inU1 || inNine || inSilk || inPairs) continue
    parts.via(x, z)
    vi++
  }
  // a few sparse passives on the front strip
  for (let i = 0; i < 40; i++) {
    const x = -4 + r() * (modX(NF - 1) + 8)
    const z = 11.2 + r() * 5.6
    if (z > 13.6 && z < 16.1) continue
    if (x < -2 && z < 13) continue
    parts.chip2(x, z, r() < 0.5 ? 0 : Math.PI / 2, r() < 0.7 ? 402 : 603, r() < 0.6 ? 'cap' : 'res')
  }
  const holes: [number, number][] = [
    [BOARD.x0 + 1.4, BOARD.z0 + 1.4],
    [BOARD.x0 + 1.4, BOARD.z1 - 1.4],
    [BOARD.x1 - 1.4, BOARD.z0 + 1.4],
    [BOARD.x1 - 1.4, BOARD.z1 - 1.4],
    [40, BOARD.z1 - 1.4],
    [8, BOARD.z0 + 1.4],
    [56, BOARD.z0 + 1.4],
  ]
  const ringGeo = new THREE.RingGeometry(0.2, 0.36, 32)
  ringGeo.rotateX(-Math.PI / 2)
  const holeGeo = new THREE.CircleGeometry(0.2, 24)
  holeGeo.rotateX(-Math.PI / 2)
  const rings = new THREE.InstancedMesh(ringGeo, MAT.gold(), holes.length)
  const pits = new THREE.InstancedMesh(holeGeo, new THREE.MeshBasicMaterial({ color: '#010102' }), holes.length)
  holes.forEach(([x, z], i) => {
    rings.setMatrixAt(i, _m.makeTranslation(x, 0.003, z))
    pits.setMatrixAt(i, _m.makeTranslation(x, 0.0035, z))
    for (let a = 0; a < 8; a++) parts.via(x + Math.cos((a / 8) * Math.PI * 2) * 0.55, z + Math.sin((a / 8) * Math.PI * 2) * 0.55)
  })
  root.add(rings, pits)
  const fids: [number, number][] = [
    [U1.x - 6.0, 3.6],
    [-2.4, 16.4],
    [NINE.x - 2.8, -6.2],
    [NINE.x + 12.5, 16.2],
  ]
  const fidRing = new THREE.InstancedMesh(new THREE.CircleGeometry(0.17, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#16191d', roughness: 0.3, metalness: 0.2 }), fids.length)
  const fidDot = new THREE.InstancedMesh(new THREE.CircleGeometry(0.06, 20).rotateX(-Math.PI / 2), MAT.gold(), fids.length)
  fids.forEach(([x, z], i) => {
    fidRing.setMatrixAt(i, _m.makeTranslation(x, 0.0025, z))
    fidDot.setMatrixAt(i, _m.makeTranslation(x, 0.003, z))
  })
  root.add(fidRing, fidDot)
  const tps: [number, number][] = [
    [-6.5, 11.2],
    [12, 11.3],
    [44, 11.3],
    [76, 11.3],
  ]
  tps.forEach(([x, z], i) => {
    parts.box('gold', x, 0, z, 0.22, 0.006, 0.22)
    silk.dot(x, z, 0.2)
    silk.text(`TP${i + 1}`, x + 0.32, z, { h: 0.2 })
  })
  // the dot above is a silk ring — keep the gold pad on top of it
  await opts.yieldFn()

  root.add(parts.build())
  const silkMesh = silk.build()
  root.add(silkMesh)

  const laneEnd = (group: number, lane: number) => {
    const ln = lanes.find(l => l.group === group && l.lane === lane)
    return ln ? ln.pts[ln.pts.length - 1].clone() : new THREE.Vector3()
  }
  const veil = opts.dof ? createVeil(dof, BOARD.x0 - 30, BOARD.z0 - 30, BOARD.x1 + 30, BOARD.z1 + 30, 1.0) : null
  if (veil) root.add(veil)
  return { root, bus, lanes, modules, nine, leds, ledGlow, ledPos, dof, veil, laneEnd }
}

/** place chip j of the nine at drop height y (0 = seated) */
export function placeNine(n: NineHandle, j: number, y: number) {
  if (Math.abs(n.y[j] - y) < 1e-4) return false
  n.y[j] = y
  const z = nineZ(j)
  _m.makeTranslation(NINE.x, 0.03 + y, z)
  n.bodies.setMatrixAt(j, _m)
  n.tops.setMatrixAt(j, new THREE.Matrix4().makeTranslation(NINE.x, 0.03 + y + 0.201, z))
  const base = new THREE.Matrix4().makeTranslation(NINE.x, y, z)
  for (let i = 0; i < n.leadLocal.length; i++) n.leads.setMatrixAt(j * n.leadLocal.length + i, new THREE.Matrix4().multiplyMatrices(base, n.leadLocal[i]))
  const spread = 1.9 + y * 0.9
  n.shadows.setMatrixAt(j, new THREE.Matrix4().compose(_p.set(NINE.x + 0.05, 0.004, z + 0.05), _q.identity(), _s.set(spread, 1, spread)))
  return true
}
