import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, MATI, S, Traces, chipPackage, route, silk } from '../../kit/silicon'
import { rng } from '../../core/math'
import { nextFrame } from '../../core/yield'

/*
 * SURGE — the board section: the power input of the Hark board, shot up close.
 *
 *   J1 (USB-C, at the left board edge) → V1 (a via) → F1 (fuse) → node N
 *   → the Hark chip U1.  At N a TVS diode D1 shunts to a cluster of ground
 *   vias. Behind-left of U1 the secure element U2 sits inside a gold fence:
 *   the footprint of the shield can SH1 (dropped in by the chapter).
 *   Two status LEDs (STAT, WDT) sit in front of U1; passives stand in neat
 *   arrays around the chips the way a real placement does.
 *
 * Units cm, board top at y = 0, front toward +z. Static parts are merged into
 * one mesh per material (tin, gold, bodies, silk, …) and passives are
 * instanced; only things the story animates (fuse body, LED lenses, the can)
 * keep their own materials.
 */

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const v2 = (x: number, z: number) => new THREE.Vector2(x, z)
const Y = new THREE.Vector3(0, 1, 0)

/** Layout (cm) — the chapter frames its camera on these. */
export const P = {
  edge: -4.3,
  j1: v3(-3.94, 0, 0.75),
  v1: v3(-2.78, 0, 0.75),
  f1: v3(-2.2, 0, 0.75),
  n: v3(-1.5, 0, 0.75),
  d1: v3(-1.5, 0, 1.36),
  gnd: v3(-1.5, 0, 2.02),
  u1: v3(0, 0, 0),
  stat: v3(0.24, 0, 1.36),
  wdt: v3(0.7, 0, 1.36),
  /** the secure element and its shield can: behind-left of U1 */
  can: v3(-1.5, 0, -1.75),
  tp1: v3(-2.62, 0, 1.36),
  c1: v3(-2.2, 0, 0.08),
  x1: v3(1.45, 0, -1.35),
  l1: v3(2.12, 0, -0.35),
  u3: v3(3.6, 0, -3.1),
}
export const CAN = { w: 1.24, d: 1.0, h: 0.2 }

/** U1 geometry (kit QFP 1.5 cm, 14 pins a side) */
const U1W = 1.5
const U1N = 14
const U1P = Math.min((U1W * 0.8) / U1N, 0.13)
const U1S = U1P * (U1N - 1)
/** coordinate of pin k (0..13) along a side */
const pinAt = (k: number) => -U1S / 2 + k * U1P

/** Merge bucket: geometries baked with their transforms, one mesh at the end. */
class Bucket {
  geos: THREE.BufferGeometry[] = []
  add(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const x = g.index ? g.toNonIndexed() : g.clone()
    if (m) x.applyMatrix4(m)
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k)
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2))
    if (!x.attributes.normal) x.computeVertexNormals()
    this.geos.push(x)
    g.dispose()
  }
  mesh(mat: THREE.Material): THREE.Mesh | null {
    if (!this.geos.length) return null
    const g = mergeGeometries(this.geos)
    this.geos.forEach(x => x.dispose())
    this.geos = []
    if (!g) return null
    g.computeBoundingSphere()
    return new THREE.Mesh(g, mat)
  }
}

/** A part frame: local (lx, ly, lz, lry) → world matrix. */
function frame(x: number, z: number, ry = 0) {
  const base = new THREE.Matrix4().compose(v3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(Y, ry), v3(1, 1, 1))
  return (lx: number, ly: number, lz: number, lry = 0) =>
    base.clone().multiply(new THREE.Matrix4().compose(v3(lx, ly, lz), new THREE.Quaternion().setFromAxisAngle(Y, lry), v3(1, 1, 1)))
}

/** A solder fillet: a concave meniscus rising from the pad (local +x = outward) to the terminal face. */
function fillet(len: number, h: number, width: number): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.lineTo(len, 0)
  for (let i = 1; i <= 6; i++) {
    const t = i / 6
    s.lineTo(len * (1 - t), h * t * t)
  }
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 1 })
  g.translate(0, 0, -width / 2)
  return g
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const rbox = (w: number, h: number, d: number, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, r)
/** A flat XZ plane (for decals / shadows). */
function plane(w: number, d: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, d)
  g.rotateX(-Math.PI / 2)
  return g
}

/** Soft contact-shadow texture (a blurred rounded rect, computed — no canvas filters on Safari 15). */
function shadowTexture(): THREE.CanvasTexture {
  const N = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const img = g.createImageData(N, N)
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = Math.abs(i + 0.5 - N / 2) / (N / 2)
      const y = Math.abs(j + 0.5 - N / 2) / (N / 2)
      const d = Math.hypot(Math.max(x - 0.42, 0), Math.max(y - 0.42, 0)) / 0.56
      const a = Math.max(0, 1 - d)
      const k = (j * N + i) * 4
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 0
      img.data[k + 3] = Math.round(255 * a * a * (3 - 2 * a))
    }
  g.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(cv)
}

/** Radial glow for additive sprites. */
function glowTexture(): THREE.CanvasTexture {
  const N = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.1, 'rgba(255,255,255,0.7)')
  grd.addColorStop(0.3, 'rgba(255,255,255,0.2)')
  grd.addColorStop(0.65, 'rgba(255,255,255,0.04)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, N, N)
  return new THREE.CanvasTexture(cv)
}

/** Fine solder-mask texture: orange-peel bump (tiled). */
function peelTexture(): THREE.CanvasTexture {
  const N = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, N, N)
  const R = rng(5)
  for (let i = 0; i < 700; i++) {
    const x = R() * N
    const y = R() * N
    const r = 3 + R() * 9
    const v = Math.round(110 + R() * 40)
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, `rgba(${v},${v},${v},0.5)`)
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`)
    g.fillStyle = grd
    // wrapped copies only where a blob crosses an edge, so the tile is seamless
    for (const ox of [-N, 0, N])
      for (const oy of [-N, 0, N]) {
        if ((ox && (x + ox + r < 0 || x + ox - r > N)) || (oy && (y + oy + r < 0 || y + oy - r > N))) continue
        g.save()
        g.translate(ox, oy)
        g.fillRect(x - r, y - r, r * 2, r * 2)
        g.restore()
      }
  }
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export interface Led {
  lens: THREE.MeshBasicMaterial
  glow: THREE.Sprite
  pos: THREE.Vector3
}

export interface Board {
  root: THREE.Group
  mainPath: THREE.Vector3[]
  /** distance along the main path where it meets the clamp node N */
  split: number
  main: Traces
  shunt: Traces
  bus: Traces
  fuse: THREE.MeshStandardMaterial
  stat: Led
  wdt: Led
  /** contact shadow under the can footprint (opacity follows the drop) */
  canShadow: THREE.Mesh
  glowTex: THREE.Texture
}

/** Macro metals: a touch rougher than the kit's so flat pads catch the studio from any angle. */
const GOLD = new THREE.MeshStandardMaterial({ color: '#dcaa4c', roughness: 0.34, metalness: 1 })
const TIN = new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.34, metalness: 1 })
/** instanced twins: an InstancedMesh never shares a material with a plain Mesh (three would re-resolve the program on every draw) */
const GOLD_I = GOLD.clone()
const TIN_I = TIN.clone()

type Kind = 'c' | 'r' | 'c6' | 'r6'
interface Passive {
  x: number
  z: number
  ry: number
  k: Kind
}

/** Instanced 0402/0603 passives on gold pads (bodies, tin terminations, pads). */
function passives(list: Passive[]): THREE.Group {
  const g = new THREE.Group()
  const n = list.length
  const bodyGeo = new THREE.BoxGeometry(0.075, 0.05, 0.05)
  const endGeo = new THREE.BoxGeometry(0.02, 0.052, 0.052)
  const padGeo = new THREE.BoxGeometry(0.05, 0.004, 0.06)
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }), n)
  const ends = new THREE.InstancedMesh(endGeo, TIN_I, n * 2)
  const pads = new THREE.InstancedMesh(padGeo, GOLD_I, n * 2)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const sc = new THREE.Vector3()
  const cCap = new THREE.Color('#5e4630')
  const cCap2 = new THREE.Color('#6b5037')
  const cRes = new THREE.Color('#141518')
  const dir = new THREE.Vector3()
  list.forEach((p, i) => {
    const big = p.k === 'c6' || p.k === 'r6'
    const s = big ? 1.6 : 1
    q.setFromAxisAngle(Y, p.ry)
    sc.set(s, s, s)
    m.compose(v3(p.x, 0.025 * s + 0.002, p.z), q, sc)
    bodies.setMatrixAt(i, m)
    bodies.setColorAt(i, p.k === 'r' || p.k === 'r6' ? cRes : i % 3 ? cCap : cCap2)
    dir.set(0.0475 * s, 0, 0).applyQuaternion(q)
    for (const sg of [-1, 1]) {
      m.compose(v3(p.x + dir.x * sg, 0.026 * s + 0.002, p.z + dir.z * sg), q, sc)
      ends.setMatrixAt(i * 2 + (sg > 0 ? 1 : 0), m)
      m.compose(v3(p.x + dir.x * sg * 1.18, 0.002, p.z + dir.z * sg * 1.18), q, sc)
      pads.setMatrixAt(i * 2 + (sg > 0 ? 1 : 0), m)
    }
  })
  bodies.instanceMatrix.needsUpdate = true
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
  for (const im of [bodies, ends, pads]) im.computeBoundingSphere()
  g.add(pads, bodies, ends)
  return g
}

export async function buildBoard(mobile: boolean): Promise<Board> {
  const root = new THREE.Group()
  root.name = 'shield-board'
  const tin = new Bucket()
  const shell = new Bucket() // J1's stamped steel
  const gold = new Bucket()
  const body = new Bucket() // dark epoxy bodies (TVS, inductor)
  const ceramic = new Bucket() // ceramic capacitor bodies
  const white = new Bucket() // LED bodies, painted bands
  const silkB = new Bucket()
  const hole = new Bucket()
  const bare = new Bucket() // mask openings showing bare laminate
  const shade = new Bucket()

  // ---------------------------------------------------------------- the board
  const W = 44
  const D = 40
  const fr4 = MAT.fr4()
  const peel = peelTexture()
  peel.repeat.set(W * 1.4, D * 1.4)
  const mask = new THREE.MeshPhysicalMaterial({
    color: '#060709',
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.16,
    bumpMap: peel,
    bumpScale: 0.2,
    envMapIntensity: 0.55,
  })
  const slab = new THREE.Mesh(box(W, 0.16, D), [fr4, fr4, mask, fr4, fr4, fr4])
  slab.position.set(P.edge + W / 2, -0.08, -6)
  root.add(slab)
  // inner copper layers glinting in the board edge
  for (const y of [-0.045, -0.115]) {
    const cu = new THREE.Mesh(box(0.002, 0.01, D), MAT.copper())
    cu.position.set(P.edge - 0.001, y, -6)
    root.add(cu)
  }

  // ---------------------------------------------------------------- J1: USB-C receptacle at the edge
  {
    const f = frame(P.j1.x, P.j1.z)
    const L = 0.82
    shell.add(rbox(L, 0.32, 0.9, 0.075), f(0, 0.16, 0))
    // the mouth: a dark rounded opening and the tongue inside
    hole.add(rbox(0.02, 0.25, 0.82, 0.1), f(-L / 2 - 0.004, 0.16, 0))
    body.add(box(0.04, 0.06, 0.56), f(-L / 2 + 0.02, 0.16, 0))
    gold.add(box(0.02, 0.062, 0.5), f(-L / 2 + 0.04, 0.16, 0))
    // seam and a pair of stamped dimples on the top of the shell
    hole.add(box(L * 0.88, 0.003, 0.005), f(0.02, 0.3205, 0))
    for (const z of [-0.22, 0.22]) {
      const dimple = new THREE.CircleGeometry(0.035, 16)
      dimple.rotateX(-Math.PI / 2)
      body.add(dimple, f(0.18, 0.3215, z))
    }
    // through-hole shell legs with annular rings
    for (const sx of [-0.22, 0.2])
      for (const sz of [-0.49, 0.49]) {
        shell.add(box(0.1, 0.18, 0.05), f(sx, 0.09, sz))
        const ring = new THREE.RingGeometry(0.055, 0.11, 20)
        ring.rotateX(-Math.PI / 2)
        gold.add(ring, f(sx, 0.001, sz))
      }
    // 12 SMT pins at the back, on gold pads
    for (let i = 0; i < 12; i++) {
      const z = -0.275 + i * 0.05
      tin.add(box(0.16, 0.014, 0.026), f(L / 2 + 0.07, 0.007, z))
      gold.add(box(0.2, 0.004, 0.034), f(L / 2 + 0.09, 0.002, z))
    }
    shade.add(plane(1.3, 1.25), f(0.08, 0.0015, 0.02))
  }

  // ---------------------------------------------------------------- F1: 2410 fuse (ceramic body, tin end caps)
  const fuse = new THREE.MeshStandardMaterial({ color: '#d9cfb8', roughness: 0.62, metalness: 0, emissive: new THREE.Color('#ff2200'), emissiveIntensity: 0 })
  {
    const f = frame(P.f1.x, P.f1.z)
    const bodyMesh = new THREE.Mesh(rbox(0.4, 0.22, 0.25, 0.02), fuse)
    bodyMesh.applyMatrix4(f(0, 0.12, 0))
    root.add(bodyMesh)
    for (const s of [-1, 1]) {
      tin.add(rbox(0.1, 0.235, 0.265, 0.02), f(s * 0.245, 0.1175, 0))
      gold.add(box(0.2, 0.004, 0.32), f(s * 0.28, 0.002, 0))
      tin.add(fillet(0.085, 0.16, 0.25), f(s * 0.295, 0.004, 0, s > 0 ? 0 : Math.PI))
    }
    shade.add(plane(0.9, 0.55), f(0.02, 0.0015, 0.02))
  }

  // ---------------------------------------------------------------- D1: SMA TVS diode, cathode toward N
  {
    const f = frame(P.d1.x, P.d1.z, Math.PI / 2) // local +x → world −z (toward N)
    body.add(rbox(0.43, 0.2, 0.27, 0.022), f(0, 0.125, 0))
    white.add(box(0.07, 0.004, 0.272), f(0.15, 0.227, 0))
    for (const s of [-1, 1]) {
      tin.add(box(0.14, 0.022, 0.15), f(s * 0.245, 0.011, 0))
      tin.add(box(0.022, 0.1, 0.15), f(s * 0.215, 0.05, 0))
      gold.add(box(0.22, 0.004, 0.22), f(s * 0.28, 0.002, 0))
      tin.add(fillet(0.07, 0.05, 0.15), f(s * 0.315, 0.022, 0, s > 0 ? 0 : Math.PI))
    }
    shade.add(plane(0.85, 0.55), f(0, 0.0015, 0.02))
  }

  // ---------------------------------------------------------------- C1: bulk 1210 capacitor after the fuse
  {
    const f = frame(P.c1.x, P.c1.z)
    ceramic.add(rbox(0.26, 0.2, 0.25, 0.015), f(0, 0.1, 0))
    for (const s of [-1, 1]) {
      tin.add(rbox(0.05, 0.205, 0.255, 0.012), f(s * 0.15, 0.1025, 0))
      gold.add(box(0.14, 0.004, 0.3), f(s * 0.18, 0.002, 0))
      tin.add(fillet(0.06, 0.12, 0.25), f(s * 0.175, 0.004, 0, s > 0 ? 0 : Math.PI))
    }
    shade.add(plane(0.6, 0.5), f(0, 0.0015, 0.02))
  }

  // ---------------------------------------------------------------- U1: the Hark chip
  const u1 = chipPackage({ w: U1W, kind: 'qfp', pinsPerSide: U1N, lines: ['HK-0N', 'REV A'], mark: true })
  u1.position.copy(P.u1)
  root.add(u1)
  {
    for (let side = 0; side < 4; side++) {
      const f = frame(0, 0, (side * Math.PI) / 2)
      for (let k = 0; k < U1N; k++) gold.add(box(0.2, 0.004, U1P * 0.55), f(0.9, 0.002, pinAt(k)))
    }
    shade.add(plane(2.3, 2.3), frame(0.05, 0.05)(0, 0.0015, 0))
    const dot = new THREE.CircleGeometry(0.04, 16)
    dot.rotateX(-Math.PI / 2)
    silkB.add(dot, frame(-1.08, -1.08)(0, 0.002, 0))
  }

  // ---------------------------------------------------------------- LEDs (0603): STAT, WDT
  const glowTex = glowTexture()
  const led = (pos: THREE.Vector3): Led => {
    const f = frame(pos.x, pos.z)
    white.add(box(0.16, 0.06, 0.08), f(0, 0.03, 0))
    for (const s of [-1, 1]) {
      tin.add(box(0.03, 0.062, 0.082), f(s * 0.075, 0.031, 0))
      gold.add(box(0.08, 0.004, 0.1), f(s * 0.085, 0.002, 0))
      tin.add(fillet(0.035, 0.04, 0.08), f(s * 0.09, 0.004, 0, s > 0 ? 0 : Math.PI))
    }
    const lens = new THREE.MeshBasicMaterial({ color: '#cfd6cf', toneMapped: false })
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.06), lens)
    lm.rotation.x = -Math.PI / 2
    lm.position.set(pos.x, 0.0615, pos.z)
    root.add(lm)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false }))
    glow.renderOrder = 4
    glow.position.set(pos.x, 0.09, pos.z)
    glow.scale.setScalar(0.5)
    root.add(glow)
    return { lens, glow, pos: pos.clone().setY(0.07) }
  }
  const stat = led(P.stat)
  const wdt = led(P.wdt)

  await nextFrame()

  // ---------------------------------------------------------------- U2 (secure element) + the can fence
  const u2 = chipPackage({ w: 0.5, h: 0.08, kind: 'qfn', pinsPerSide: 4, lines: ['SE'], mark: true })
  u2.position.set(P.can.x, 0, P.can.z)
  root.add(u2)
  {
    const f = frame(P.can.x, P.can.z)
    const fw = CAN.w + 0.06
    const fd = CAN.d + 0.06
    for (const s of [-1, 1]) {
      gold.add(box(fw - 0.2, 0.004, 0.07), f(0, 0.002, (s * fd) / 2))
      const side = box(fd - 0.2, 0.004, 0.07)
      side.rotateY(Math.PI / 2)
      gold.add(side, f((s * fw) / 2, 0.002, 0))
    }
    shade.add(plane(0.75, 0.75), f(0, 0.0015, 0))
  }

  // ---------------------------------------------------------------- X1 crystal (3225), L1 inductor, U3
  {
    const f = frame(P.x1.x, P.x1.z)
    ceramic.add(box(0.32, 0.03, 0.25), f(0, 0.015, 0))
    tin.add(rbox(0.29, 0.05, 0.22, 0.012), f(0, 0.055, 0))
    shade.add(plane(0.55, 0.45), f(0, 0.0015, 0))
  }
  {
    const f = frame(P.l1.x, P.l1.z)
    body.add(rbox(0.5, 0.3, 0.5, 0.04), f(0, 0.15, 0))
    for (const s of [-1, 1]) {
      tin.add(box(0.06, 0.1, 0.36), f(s * 0.25, 0.05, 0))
      gold.add(box(0.14, 0.004, 0.42), f(s * 0.28, 0.002, 0))
    }
    shade.add(plane(0.9, 0.9), f(0, 0.0015, 0))
  }
  const u3 = chipPackage({ w: 1.1, h: 0.1, kind: 'qfn', pinsPerSide: 10, lines: ['HK-PM1'], mark: false })
  u3.position.copy(P.u3)
  root.add(u3)
  shade.add(plane(1.6, 1.6), frame(P.u3.x + 0.02, P.u3.z + 0.02)(0, 0.0015, 0))

  // ---------------------------------------------------------------- vias, test point, fiducial, mounting hole
  const via = (x: number, z: number, r = 0.042, h = 0.018) => {
    const ring = new THREE.RingGeometry(h, r, 18)
    ring.rotateX(-Math.PI / 2)
    gold.add(ring, frame(x, z)(0, 0.0012, 0))
    const c = new THREE.CircleGeometry(h, 12)
    c.rotateX(-Math.PI / 2)
    hole.add(c, frame(x, z)(0, 0.0014, 0))
  }
  via(P.v1.x, P.v1.z, 0.06, 0.026)
  for (const [dx, dz] of [
    [-0.09, 0],
    [0, 0],
    [0.09, 0],
    [-0.09, 0.13],
    [0, 0.13],
    [0.09, 0.13],
  ])
    via(P.gnd.x + dx, P.gnd.z + dz, 0.036, 0.015)
  // fence stitching: the U1↔U2 bus dives through vias outside/inside the can
  const busVia = (i: number) => ({ out: v2(-0.66, -1.42 - i * 0.14), inn: v2(-1.05, -1.52 - i * 0.1) })
  for (let i = 0; i < 4; i++) {
    const b = busVia(i)
    via(b.out.x, b.out.y, 0.036, 0.015)
    via(b.inn.x, b.inn.y, 0.032, 0.013)
  }
  // ground stitching around the can fence and along the board edge
  for (let i = 0; i < 9; i++) via(P.can.x - 0.62 + i * 0.155, P.can.z - 0.66, 0.03, 0.012)
  for (let z = -7; z < 5; z += 0.34) if (Math.abs(z - P.j1.z) > 0.7) via(P.edge + 0.28, z, 0.034, 0.014)
  const R = rng(41)
  for (let i = 0; i < 18; i++) {
    const x = 1.25 + R() * 1.6
    const z = 0.55 + R() * 1.2
    via(x, z, 0.03, 0.012)
  }
  {
    const c = new THREE.CircleGeometry(0.075, 24)
    c.rotateX(-Math.PI / 2)
    gold.add(c, frame(P.tp1.x, P.tp1.z)(0, 0.002, 0))
  }
  {
    const f = frame(-3.55, -0.75)
    const disc = new THREE.CircleGeometry(0.05, 24)
    disc.rotateX(-Math.PI / 2)
    gold.add(disc, f(0, 0.002, 0))
    const ring = new THREE.RingGeometry(0.05, 0.13, 28)
    ring.rotateX(-Math.PI / 2)
    bare.add(ring, f(0, 0.001, 0))
  }
  {
    const f = frame(-3.45, -2.9)
    const ring = new THREE.RingGeometry(0.17, 0.32, 40)
    ring.rotateX(-Math.PI / 2)
    gold.add(ring, f(0, 0.002, 0))
    const c = new THREE.CircleGeometry(0.17, 32)
    c.rotateX(-Math.PI / 2)
    hole.add(c, f(0, 0.003, 0))
  }

  // ---------------------------------------------------------------- silkscreen outlines
  const SW = 0.011
  const line = (x0: number, z0: number, x1: number, z1: number, w = SW) => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const g = new THREE.PlaneGeometry(len + w, w)
    g.rotateX(-Math.PI / 2)
    const m = new THREE.Matrix4().compose(v3((x0 + x1) / 2, 0.0016, (z0 + z1) / 2), new THREE.Quaternion().setFromAxisAngle(Y, -Math.atan2(z1 - z0, x1 - x0)), v3(1, 1, 1))
    silkB.add(g, m)
  }
  const rect = (cx: number, cz: number, w: number, d: number) => {
    line(cx - w / 2, cz - d / 2, cx + w / 2, cz - d / 2)
    line(cx - w / 2, cz + d / 2, cx + w / 2, cz + d / 2)
    line(cx - w / 2, cz - d / 2, cx - w / 2, cz + d / 2)
    line(cx + w / 2, cz - d / 2, cx + w / 2, cz + d / 2)
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const c = 1.2
      line(sx * c, sz * c, sx * (c - 0.22), sz * c)
      line(sx * c, sz * c, sx * c, sz * (c - 0.22))
    }
  rect(P.f1.x, P.f1.z, 0.84, 0.46)
  rect(P.d1.x, P.d1.z, 0.44, 0.78)
  line(P.d1.x - 0.22, P.d1.z - 0.3, P.d1.x + 0.22, P.d1.z - 0.3, 0.035)
  rect(P.c1.x, P.c1.z, 0.5, 0.42)
  rect(P.stat.x, P.stat.z, 0.3, 0.17)
  rect(P.wdt.x, P.wdt.z, 0.3, 0.17)
  rect(P.can.x, P.can.z, CAN.w + 0.22, CAN.d + 0.22)
  rect(P.l1.x, P.l1.z, 0.66, 0.66)
  {
    const r = new THREE.RingGeometry(0.105, 0.116, 32)
    r.rotateX(-Math.PI / 2)
    silkB.add(r, frame(P.tp1.x, P.tp1.z)(0, 0.0016, 0))
  }
  line(P.j1.x + 0.5, P.j1.z - 0.6, P.j1.x + 0.5, P.j1.z + 0.6)

  // ---------------------------------------------------------------- passives: neat arrays, like a real placement
  const parts: Passive[] = []
  const row = (x0: number, z0: number, dx: number, dz: number, n: number, ry: number, k: Kind, skip?: (i: number) => boolean) => {
    for (let i = 0; i < n; i++) if (!skip || !skip(i)) parts.push({ x: x0 + dx * i, z: z0 + dz * i, ry, k })
  }
  const H = Math.PI / 2
  // U1 decoupling: right column, front pair, left pair
  row(1.3, 0.2, 0, 0.17, 3, H, 'c')
  row(-1.28, -0.62, 0, 0.17, 3, H, 'c')
  row(1.2, 1.08, 0.17, 0, 2, 0, 'c6')
  // LED current-limit resistors
  parts.push({ x: P.stat.x, z: P.stat.z + 0.36, ry: 0, k: 'r' }, { x: P.wdt.x, z: P.wdt.z + 0.36, ry: 0, k: 'r' })
  // U2's decoupling just outside the can (inside the fence is the part's own)
  row(-2.35, -2.05, 0, 0.16, 3, H, 'c')
  // crystal load caps
  row(1.2, -1.75, 0.2, 0, 3, 0, 'c')
  // around U3
  row(2.85, -3.5, 0, 0.18, 5, H, 'c')
  row(3.15, -3.85, 0.18, 0, 5, 0, 'r')
  row(4.35, -3.5, 0, 0.18, 5, H, 'c')
  // a termination array behind the can, rows of the back field
  row(-3.0, -1.55, 0, -0.16, 8, 0, 'r')
  const Rp = rng(9)
  const back = mobile ? 3 : 5
  for (let r = 0; r < back; r++) row(-2.6, -2.75 - r * 0.42, 0.26, 0, 26, r % 2 ? 0 : H, r % 3 === 1 ? 'r' : 'c', i => Rp() < 0.28 || (i > 18 && i < 23 && r < 3))
  // right field: bulk 0603s and 0402 pairs
  for (let r = 0; r < (mobile ? 4 : 7); r++) row(3.1, -1.6 + r * 0.46, 0.34, 0, 9, r % 2 ? H : 0, r % 2 ? 'c6' : 'c', () => Rp() < 0.35)
  root.add(passives(parts))

  // ---------------------------------------------------------------- materials, merge
  const shadowTex = shadowTexture()
  const shadeMat = new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false })
  const meshes: [Bucket, THREE.Material][] = [
    [shade, shadeMat],
    [bare, new THREE.MeshStandardMaterial({ color: '#3a3524', roughness: 0.85 })],
    [tin, TIN],
    [shell, new THREE.MeshStandardMaterial({ color: '#c4c9cf', roughness: 0.4, metalness: 1 })],
    [gold, GOLD],
    [body, new THREE.MeshStandardMaterial({ color: '#1c1e22', roughness: 0.5, metalness: 0 })],
    [ceramic, new THREE.MeshStandardMaterial({ color: '#6b5037', roughness: 0.6 })],
    [white, new THREE.MeshStandardMaterial({ color: '#d4d3cc', roughness: 0.5 })],
    [silkB, new THREE.MeshBasicMaterial({ color: '#b4b7b1' })],
    [hole, new THREE.MeshBasicMaterial({ color: '#020203' })],
  ]
  for (const [b, m] of meshes) {
    const mesh = b.mesh(m)
    if (mesh) {
      if (b === shade) mesh.renderOrder = 1
      root.add(mesh)
    }
  }
  const canShadow = new THREE.Mesh(plane(CAN.w + 0.5, CAN.d + 0.5), new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false }))
  canShadow.position.set(P.can.x + 0.03, 0.0017, P.can.z + 0.02)
  canShadow.renderOrder = 1
  root.add(canShadow)

  await nextFrame()

  // ---------------------------------------------------------------- silkscreen labels
  const label = (t: string, x: number, z: number, h = 0.09, align: 'left' | 'center' = 'center', ry = 0) => {
    const m = silk(t, { height: h, align, color: '#b4b7b1' })
    m.position.set(x, 0.0018, z)
    m.rotation.z = ry
    root.add(m)
  }
  label('J1', P.j1.x + 0.12, P.j1.z + 0.7)
  label('VBUS', P.j1.x + 0.95, P.j1.z - 0.5, 0.075)
  label('F1', P.f1.x, P.f1.z - 0.36)
  label('D1', P.d1.x + 0.4, P.d1.z + 0.02)
  label('TVS', P.d1.x + 0.44, P.d1.z + 0.16, 0.065)
  label('C1', P.c1.x, P.c1.z - 0.3)
  label('TP1', P.tp1.x, P.tp1.z + 0.21, 0.07)
  label('U1', 0.95, 1.38, 0.09)
  label('STAT', P.stat.x, P.stat.z + 0.2, 0.06)
  label('WDT', P.wdt.x, P.wdt.z + 0.2, 0.06)
  label('SH1', P.can.x, P.can.z + 0.72, 0.09)
  label('X1', P.x1.x, P.x1.z - 0.27, 0.07)
  label('L1', P.l1.x, P.l1.z + 0.44, 0.08)
  label('GND', P.gnd.x + 0.34, P.gnd.z + 0.07, 0.065)
  label('HK-0N · PWR IN · REV A', -3.9, 2.25, 0.085, 'left')

  // ---------------------------------------------------------------- traces
  const TY = 0
  // main rail: J1 VBUS pin → V1 → F1 → N → U1 (left side, 3rd pin from the front)
  const pin = pinAt(U1N - 3)
  const mainPath: THREE.Vector3[] = [
    v3(P.j1.x + 0.5, TY, 0.625),
    v3(P.j1.x + 0.72, TY, 0.625),
    v3(P.j1.x + 0.845, TY, P.v1.z),
    v3(P.v1.x, TY, P.v1.z),
    v3(P.f1.x - 0.28, TY, P.f1.z),
    v3(P.f1.x + 0.28, TY, P.f1.z),
    v3(P.n.x, TY, P.n.z),
  ]
  let split = 0
  for (let i = 0; i < mainPath.length - 1; i++) split += mainPath[i].distanceTo(mainPath[i + 1])
  mainPath.push(...route(v2(P.n.x, P.n.z), v2(-1.0, pin), { y: TY, jog: 0.35 }).slice(1))
  const main = new Traces([mainPath], { width: 0.07, base: '#2c3138' })
  root.add(main.group)

  // the shunt: N → D1 cathode, D1 anode → the ground vias; TP1's tap
  const g0 = P.gnd
  const shunt = new Traces(
    [
      [v3(P.n.x, TY, P.n.z), v3(P.d1.x, TY, P.d1.z - 0.26)],
      [v3(P.d1.x - 0.09, TY, P.d1.z + 0.3), v3(g0.x - 0.09, TY, g0.z + 0.13)],
      [v3(P.d1.x, TY, P.d1.z + 0.3), v3(g0.x, TY, g0.z + 0.13)],
      [v3(P.d1.x + 0.09, TY, P.d1.z + 0.3), v3(g0.x + 0.09, TY, g0.z + 0.13)],
      [v3(P.tp1.x, TY, P.v1.z), v3(P.tp1.x, TY, P.tp1.z)],
    ],
    { width: 0.06, color: S.red, base: '#2c3138' },
  )
  root.add(shunt.group)

  // the rest of the board's signals
  const bus: THREE.Vector3[][] = []
  // U1 ↔ U2 through the fence vias (top-left pins)
  for (let i = 0; i < 4; i++) {
    const b = busVia(i)
    bus.push(route(v2(pinAt(i), -1.0), b.out, { y: TY, jog: 0.25, xFirst: false }))
    bus.push(route(b.inn, v2(-1.23, -1.9 + i * 0.1), { y: TY, jog: 0.4 }))
  }
  // LEDs from the front pins
  bus.push([v3(pinAt(9), TY, 1.0), v3(pinAt(9), TY, 1.12), v3(P.stat.x - 0.085, TY, P.stat.z - 0.13), v3(P.stat.x - 0.085, TY, P.stat.z)])
  bus.push([v3(pinAt(12), TY, 1.0), v3(pinAt(12), TY, 1.1), v3(P.wdt.x - 0.085, TY, P.wdt.z - 0.13), v3(P.wdt.x - 0.085, TY, P.wdt.z)])
  // crystal (right side, back pins)
  bus.push(route(v2(1.0, pinAt(0)), v2(P.x1.x - 0.12, P.x1.z), { y: TY, jog: 0.3 }))
  bus.push(route(v2(1.0, pinAt(1)), v2(P.x1.x + 0.12, P.x1.z + 0.02), { y: TY, jog: 0.7 }))
  // a parallel bus off the back of U1 into the distance
  for (let i = 0; i < 7; i++) {
    const x = pinAt(6 + i)
    const zb = -2.45 - i * 0.02
    const x2 = x + 0.55
    bus.push([v3(x, TY, -1.0), v3(x, TY, zb), v3(x2, TY, zb - 0.55), v3(x2, TY, -8)])
  }
  // right-side lines toward U3
  for (let i = 0; i < 5; i++) bus.push(route(v2(1.0, pinAt(3 + i)), v2(3.02, -2.62 - i * 0.12), { y: TY, jog: 0.1 + i * 0.05, xFirst: false }))
  const busT = new Traces(bus, { width: 0.034, base: '#22262c' })
  root.add(busT.group)

  return { root, mainPath, split, main, shunt, bus: busT, fuse, stat, wdt, canShadow, glowTex }
}

/** Point at distance `d` along a polyline. */
export function along(path: THREE.Vector3[], d: number, out: THREE.Vector3): THREE.Vector3 {
  let rem = Math.max(0, d)
  for (let i = 0; i < path.length - 1; i++) {
    const len = path[i].distanceTo(path[i + 1])
    if (rem <= len || i === path.length - 2) return out.copy(path[i]).lerp(path[i + 1], Math.min(1, rem / Math.max(len, 1e-6)))
    rem -= len
  }
  return out.copy(path[path.length - 1])
}

/**
 * The kit's cached materials used in this set, plain and instanced twins
 * (the kit's chip leads and SMD fields draw MATI.*): cloned, never patched in
 * place, or the focus falloff would leak into every other chapter's parts.
 */
export function sharedMaterials(): Set<THREE.Material> {
  const kit = ['mask', 'gold', 'copper', 'tin', 'epoxy', 'aluminum', 'ceramic', 'fr4', 'silk'] as const
  return new Set<THREE.Material>(kit.flatMap(k => [MAT[k](), MATI[k]()]))
}
