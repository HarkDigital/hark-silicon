import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { logoShapes } from '../logo/logo'

/*
 * Hark Silicon kit — one electronics vocabulary for every chapter.
 * Units: 1 = 1 cm (a QFN chip ~0.7, a big BGA ~3.5, the board ~40 wide).
 * Boards lie in the XZ plane (y up), front edge toward +z.
 *
 *   S                          palette by name
 *   MAT                        cached materials: mask (matte-black solder mask),
 *                              gold (ENIG pads), copper, tin (leads), epoxy
 *                              (package), silicon (iridescent die), aluminum
 *                              (bond pads), ceramic, fr4 (board edge),
 *                              silk (white silkscreen), led(color, strength)
 *   route(a, b, o)             PCB-style path between two XZ points: straight
 *                              runs joined by 45° jogs
 *   new Traces(paths, o)       copper traces under the mask + animated light
 *                              PULSES riding them (signals). One draw call each.
 *                              traces.set({ time, flow, density, glow, reach, offset })
 *   chipPackage(o)             a black QFN/QFP/BGA package with the Hark mark
 *                              laser-etched, part-number lines and a pin-1 dot
 *   dieTexture(o)              a procedural die-shot floorplan (CanvasTexture)
 *                              + the block rectangles it drew (for labels)
 *   dieMaterial(tex)           iridescent silicon (thin-film sheen) with the map
 *   bondWires(pairs, o)        gold wire arcs (merged tubes)
 *   silk(text, o)              white silkscreen text on a plane (lies flat on XZ)
 *   smdField(o)                instanced tiny SMD parts scattered in an area
 *
 * Rules: the board is MATTE black; metal reads because of the studio env
 * (world.params.env / envTurn); signals are the only saturated green.
 */

export const S = {
  mask: '#0b0d10',
  maskEdge: '#1a1e24',
  gold: '#d9a84a',
  copper: '#b8733d',
  tin: '#c7ccd2',
  epoxy: '#16181b',
  silk: '#f2f2ee',
  signal: '#00ff85',
  cyan: '#39e0ff',
  amber: '#ffb020',
  red: '#ff3b3b',
  fr4: '#9c8f55',
} as const

const cache = new Map<string, THREE.Material>()
function once<M extends THREE.Material>(key: string, make: () => M): M {
  let m = cache.get(key) as M | undefined
  if (!m) cache.set(key, (m = make()))
  return m
}

/**
 * Materials drawn by an InstancedMesh must not also be drawn by a plain Mesh
 * (three re-resolves the program on every draw). MAT.x() is for plain meshes;
 * MATI.x() returns a cached instanced twin.
 */
export const MAT = {
  mask: () => once('mask', () => new THREE.MeshPhysicalMaterial({ color: S.mask, roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 })),
  gold: () => once('gold', () => new THREE.MeshStandardMaterial({ color: S.gold, roughness: 0.22, metalness: 1 })),
  copper: () => once('copper', () => new THREE.MeshStandardMaterial({ color: S.copper, roughness: 0.3, metalness: 1 })),
  tin: () => once('tin', () => new THREE.MeshStandardMaterial({ color: S.tin, roughness: 0.28, metalness: 1 })),
  epoxy: () => once('epoxy', () => new THREE.MeshStandardMaterial({ color: S.epoxy, roughness: 0.62, metalness: 0 })),
  aluminum: () => once('aluminum', () => new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.35, metalness: 1 })),
  ceramic: () => once('ceramic', () => new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.5, metalness: 0 })),
  fr4: () => once('fr4', () => new THREE.MeshStandardMaterial({ color: S.fr4, roughness: 0.8, metalness: 0 })),
  silk: () => once('silk', () => new THREE.MeshBasicMaterial({ color: S.silk })),
  /** emissive light (LEDs, lit pads); strength > 1 blooms */
  led: (color: THREE.ColorRepresentation = S.signal, strength = 3) =>
    once(`led:${new THREE.Color(color).getHexString()}:${strength}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), toneMapped: false })),
}

const twins = new Map<THREE.Material, THREE.Material>()
function twin<M extends THREE.Material>(m: M): M {
  let t = twins.get(m) as M | undefined
  if (!t) twins.set(m, (t = m.clone() as M))
  return t
}
/** instanced twins of the kit materials (use these on InstancedMesh) */
export const MATI = {
  mask: () => twin(MAT.mask()),
  gold: () => twin(MAT.gold()),
  copper: () => twin(MAT.copper()),
  tin: () => twin(MAT.tin()),
  epoxy: () => twin(MAT.epoxy()),
  aluminum: () => twin(MAT.aluminum()),
  ceramic: () => twin(MAT.ceramic()),
  fr4: () => twin(MAT.fr4()),
  silk: () => twin(MAT.silk()),
  led: (color: THREE.ColorRepresentation = S.signal, strength = 3) => twin(MAT.led(color, strength)),
}

/**
 * PCB-style route from a to b in the XZ plane: run along the dominant axis,
 * a single 45° jog to line up, then straight in. `jog` (0..1) sets where the
 * jog happens. Returns the corner points (y = o.y).
 */
export function route(a: THREE.Vector2, b: THREE.Vector2, o: { jog?: number; y?: number; xFirst?: boolean } = {}): THREE.Vector3[] {
  const y = o.y ?? 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  const xFirst = o.xFirst ?? Math.abs(dx) >= Math.abs(dy)
  const main = xFirst ? dx : dy
  const cross = xFirst ? dy : dx
  const diag = Math.min(Math.abs(cross), Math.abs(main))
  const straight = Math.abs(main) - diag
  const j = o.jog ?? 0.5
  const s1 = straight * j
  const sgnM = Math.sign(main) || 1
  const sgnC = Math.sign(cross) || 1
  const pts: THREE.Vector2[] = [a.clone()]
  const p1 = xFirst ? new THREE.Vector2(a.x + sgnM * s1, a.y) : new THREE.Vector2(a.x, a.y + sgnM * s1)
  const p2 = xFirst ? new THREE.Vector2(p1.x + sgnM * diag, p1.y + sgnC * diag) : new THREE.Vector2(p1.x + sgnC * diag, p1.y + sgnM * diag)
  pts.push(p1, p2)
  // any remaining cross distance (when |cross| > |main|) goes straight
  const rem = Math.abs(cross) - diag
  if (rem > 1e-4) pts.push(xFirst ? new THREE.Vector2(p2.x, p2.y + sgnC * rem) : new THREE.Vector2(p2.x + sgnC * rem, p2.y))
  pts.push(b.clone())
  const out: THREE.Vector3[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last.x - p.x, last.z - p.y) > 1e-4) out.push(new THREE.Vector3(p.x, y, p.y))
  }
  return out
}

export interface TraceOpts {
  width?: number
  /** colour of the light pulses */
  color?: THREE.ColorRepresentation
  /** trace (copper under mask) colour */
  base?: THREE.ColorRepresentation
  /** pulse shape: head length (fraction of the spacing, default 0.035) */
  head?: number
  /** where the tail starts (fraction of the spacing from the head, default 0.55: a 45% tail; 0.9 = a short tail) */
  tail?: number
  /** always-on base glow along live traces (default 0.06) */
  baseGlow?: number
}

/**
 * Copper traces under the solder mask, with light pulses (signals) riding
 * them. All paths are merged: one mesh for the copper, one additive mesh for
 * the pulses. Pulse position = distance along the path − (time·flow + offset);
 * `reach` limits pulses to the first N units of every path (a signal
 * arriving); `density` = pulses per 10 units.
 */
export class Traces {
  group = new THREE.Group()
  copper: THREE.Mesh
  pulses: THREE.Mesh
  /** total length of each path (same order as given) */
  lengths: number[] = []
  private u = {
    uTime: { value: 0 },
    uFlow: { value: 6 },
    uDensity: { value: 1 },
    uGlow: { value: 1 },
    uReach: { value: 1e6 },
    uOffset: { value: 0 },
    uColor: { value: new THREE.Color(S.signal) },
  }

  constructor(paths: THREE.Vector3[][], o: TraceOpts = {}) {
    const w = o.width ?? 0.06
    const pos: number[] = []
    const uv: number[] = []
    const seed: number[] = []
    const idx: number[] = []
    let v = 0
    paths.forEach((pts, pi) => {
      let dist = 0
      // deterministic per-path phase (screenshots and reloads match)
      const s = (Math.sin((pi + 1) * 12.9898) * 43758.5453) % 1
      const s01 = s < 0 ? s + 1 : s
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        const dir = new THREE.Vector3().subVectors(b, a)
        const len = dir.length()
        if (len < 1e-5) continue
        dir.normalize()
        const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w / 2)
        // extend each segment by half a width so joints close
        const a2 = a.clone().addScaledVector(dir, -w / 2)
        const b2 = b.clone().addScaledVector(dir, w / 2)
        pos.push(a2.x + n.x, a2.y, a2.z + n.z, a2.x - n.x, a2.y, a2.z - n.z, b2.x + n.x, b2.y, b2.z + n.z, b2.x - n.x, b2.y, b2.z - n.z)
        uv.push(dist, 0, dist, 1, dist + len, 0, dist + len, 1)
        seed.push(s01, s01, s01, s01)
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
        v += 4
        dist += len
      }
      this.lengths[pi] = dist
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    this.copper = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: o.base ?? '#2a2f36', roughness: 0.35, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    )
    if (o.color) this.u.uColor.value.set(o.color)
    // pulse shape options are applied to the shader text (the defaults below
    // are the literal constants, so chapter-side patches keep matching)
    const shape = (src: string) => {
      let out = src
      if (o.head !== undefined) out = out.replace('smoothstep(0.0, 0.035, 1.0 - ph)', `smoothstep(0.0, ${o.head.toFixed(4)}, 1.0 - ph)`)
      if (o.tail !== undefined) out = out.replace('smoothstep(0.55, 1.0, ph) * 0.35', `smoothstep(${o.tail.toFixed(4)}, 1.0, ph) * 0.35`)
      if (o.baseGlow !== undefined) out = out.replace('a += 0.06 * uGlow', `a += ${o.baseGlow.toFixed(4)} * uGlow`)
      return out
    }
    const pm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute float aSeed; varying vec2 vUv; varying float vSeed;
        void main() { vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: shape(/* glsl */ `
        uniform float uTime, uFlow, uDensity, uGlow, uReach, uOffset; uniform vec3 uColor;
        varying vec2 vUv; varying float vSeed;
        void main() {
          float spacing = 10.0 / max(uDensity, 0.05);
          float d = vUv.x - (uTime * uFlow + uOffset) - vSeed * spacing;
          float ph = fract(d / spacing);
          // a bright head with a fading tail behind it (moving toward +dist)
          float head = 1.0 - smoothstep(0.0, 0.035, 1.0 - ph);
          float tail = smoothstep(0.55, 1.0, ph) * 0.35;
          float across = 1.0 - smoothstep(0.25, 0.5, abs(vUv.y - 0.5));
          float live = 1.0 - smoothstep(uReach - 0.4, uReach, vUv.x);
          float a = (head + tail) * across * live * uGlow;
          // a faint always-on glow so traces read as 'live'
          a += 0.06 * uGlow * across * live;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * a * 2.2, 1.0);
        }
      `),
    })
    this.pulses = new THREE.Mesh(g, pm)
    this.pulses.renderOrder = 2
    this.group.add(this.copper, this.pulses)
  }

  /** time (s), flow (units/s), density (pulses per 10 units), glow (0..), reach (units along each path), offset (units, scroll-driven) */
  set(o: { time?: number; flow?: number; density?: number; glow?: number; reach?: number; offset?: number; color?: THREE.ColorRepresentation }) {
    const u = this.u
    if (o.time !== undefined) u.uTime.value = o.time
    if (o.flow !== undefined) u.uFlow.value = o.flow
    if (o.density !== undefined) u.uDensity.value = o.density
    if (o.glow !== undefined) u.uGlow.value = o.glow
    if (o.reach !== undefined) u.uReach.value = o.reach
    if (o.offset !== undefined) u.uOffset.value = o.offset
    if (o.color !== undefined) u.uColor.value.set(o.color)
  }
}

/** Canvas texture helper. */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true, text = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  // redraw once web fonts are in — only for canvases that draw text
  if (text)
    document.fonts?.ready.then(() => {
      g.clearRect(0, 0, w, h)
      draw(g)
      t.needsUpdate = true
    })
  return t
}

/** Draw the Hark mark (normalised shapes) into a 2D context at (cx, cy), `size` px tall. */
function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, -size)
  g.beginPath()
  for (const s of logoShapes()) {
    const pts = s.getPoints(48)
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    for (const h of s.holes) {
      const hp = h.getPoints(24)
      hp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
  }
  g.fill('evenodd')
  g.restore()
}

export interface PackageOpts {
  /** body width/depth/height (cm) */
  w?: number
  d?: number
  h?: number
  /** 'qfp' gull-wing leads, 'qfn' flat pads under the edge, 'bga' no visible leads */
  kind?: 'qfp' | 'qfn' | 'bga'
  pinsPerSide?: number
  /** laser-etched top lines (under the mark) */
  lines?: string[]
  /** etch the Hark mark on the lid */
  mark?: boolean
  /** false = no etched top plane (callers that build their own lid) */
  top?: boolean
}

/**
 * A chip package centred at the origin, sitting on y = 0 (body up to h).
 * group.userData.top = the etched top mesh (swap its material for effects).
 */
export function chipPackage(o: PackageOpts = {}): THREE.Group {
  const w = o.w ?? 2
  const d = o.d ?? w
  const h = o.h ?? 0.18
  const kind = o.kind ?? 'qfp'
  const n = o.pinsPerSide ?? (kind === 'bga' ? 0 : 16)
  const g = new THREE.Group()
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.03, h * 0.25)), MAT.epoxy())
  body.position.y = h / 2 + (kind === 'qfp' ? 0.05 : 0)
  body.castShadow = true
  g.add(body)
  // etched top: slightly lighter grey marks on the matte epoxy
  const lines = o.lines ?? []
  if (o.top === false) {
    addLeads()
    return g
  }
  const tex = canvasTex(1024, Math.round((1024 * d) / w), c => {
    const W = c.canvas.width
    const H = c.canvas.height
    c.fillStyle = '#16181b'
    c.fillRect(0, 0, W, H)
    c.fillStyle = 'rgba(190,196,204,0.55)'
    if (o.mark !== false) drawMark(c, W * 0.5, H * (lines.length ? 0.4 : 0.5), H * 0.38)
    c.font = `500 ${Math.round(H * 0.075)}px 'Martian Mono Variable', ui-monospace, monospace`
    c.textAlign = 'center'
    lines.forEach((l, i) => c.fillText(l, W / 2, H * (0.72 + i * 0.1)))
    // pin-1 dot
    c.beginPath()
    c.arc(W * 0.08, H * 0.08 + 6, H * 0.03, 0, Math.PI * 2)
    c.fill()
  })
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, d * 0.96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0 }))
  top.rotation.x = -Math.PI / 2
  top.position.y = body.position.y + h / 2 + 0.001
  g.add(top)
  g.userData.top = top
  addLeads()
  return g
  function addLeads() {
  if (n > 0) {
    const pitch = Math.min((w * 0.8) / n, 0.13)
    const span = pitch * (n - 1)
    const leadGeo =
      kind === 'qfp'
        ? (() => {
            // gull-wing: out, down, out (merged boxes)
            const t = 0.018
            const a = new THREE.BoxGeometry(0.12, t, pitch * 0.45)
            a.translate(0.06, 0.1, 0)
            const b = new THREE.BoxGeometry(t, 0.1, pitch * 0.45)
            b.translate(0.12, 0.05, 0)
            const c = new THREE.BoxGeometry(0.1, t, pitch * 0.45)
            c.translate(0.17, 0.009, 0)
            return mergeGeometries([a, b, c])!
          })()
        : (() => {
            const pad = new THREE.BoxGeometry(0.08, 0.02, pitch * 0.5)
            pad.translate(0.02, 0.01, 0)
            return pad
          })()
    const leads = new THREE.InstancedMesh(leadGeo, MATI.tin(), n * 4)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    let i = 0
    for (let side = 0; side < 4; side++) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2)
      const half = (side % 2 === 0 ? w : d) / 2
      for (let k = 0; k < n; k++) {
        const along = -span / 2 + k * pitch
        const p = new THREE.Vector3(half - 0.02, 0, along).applyQuaternion(q)
        m.compose(p, q, new THREE.Vector3(1, 1, 1))
        leads.setMatrixAt(i++, m)
      }
    }
    leads.castShadow = true
    g.add(leads)
  }
  }
}

export interface DieBlock {
  x: number
  y: number
  w: number
  h: number
  kind: string
}

/**
 * A procedural die-shot floorplan: blocks of SRAM arrays (fine grids), logic
 * (dense noise), analog (larger shapes), I/O ring with bond pads, and routing
 * channels. Returns the texture and the block rects (in 0..1 UV space, y down)
 * so chapters can put labels / highlights on them.
 */
export function dieTexture(o: { size?: number; seed?: number; blocks?: number } = {}): { texture: THREE.CanvasTexture; blocks: DieBlock[] } {
  const N = o.size ?? 2048
  let seed = o.seed ?? 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const blocks: DieBlock[] = []
  const texture = canvasTex(N, N, g => {
    seed = o.seed ?? 7
    blocks.length = 0
    g.fillStyle = '#2b2440'
    g.fillRect(0, 0, N, N)
    // I/O ring + bond pads
    const ring = N * 0.06
    g.fillStyle = '#3b3354'
    g.fillRect(0, 0, N, ring)
    g.fillRect(0, N - ring, N, ring)
    g.fillRect(0, 0, ring, N)
    g.fillRect(N - ring, 0, ring, N)
    g.fillStyle = '#c9ccd6'
    const pads = 28
    for (let i = 0; i < pads; i++) {
      const t = ring + ((N - 2 * ring) * (i + 0.5)) / pads
      const s = ring * 0.5
      g.fillRect(t - s / 2, ring * 0.2, s, s)
      g.fillRect(t - s / 2, N - ring * 0.2 - s, s, s)
      g.fillRect(ring * 0.2, t - s / 2, s, s)
      g.fillRect(N - ring * 0.2 - s, t - s / 2, s, s)
    }
    // core: recursive split into blocks with routing channels between
    const want = o.blocks ?? 11
    type R = { x: number; y: number; w: number; h: number }
    const rects: R[] = [{ x: ring * 1.25, y: ring * 1.25, w: N - ring * 2.5, h: N - ring * 2.5 }]
    while (rects.length < want) {
      rects.sort((a, b) => b.w * b.h - a.w * a.h)
      const r = rects.shift()!
      const vert = r.w > r.h
      const f = 0.35 + rnd() * 0.3
      const gap = N * 0.012
      if (vert) {
        const a = r.w * f
        rects.push({ x: r.x, y: r.y, w: a - gap / 2, h: r.h }, { x: r.x + a + gap / 2, y: r.y, w: r.w - a - gap / 2, h: r.h })
      } else {
        const a = r.h * f
        rects.push({ x: r.x, y: r.y, w: r.w, h: a - gap / 2 }, { x: r.x, y: r.y + a + gap / 2, w: r.w, h: r.h - a - gap / 2 })
      }
    }
    rects.sort((a, b) => a.y - b.y || a.x - b.x)
    const kinds = ['logic', 'sram', 'logic', 'analog', 'sram', 'logic', 'io', 'sram', 'logic', 'analog', 'logic', 'sram']
    rects.forEach((r, i) => {
      const kind = kinds[i % kinds.length]
      blocks.push({ x: r.x / N, y: r.y / N, w: r.w / N, h: r.h / N, kind })
      const hue = kind === 'sram' ? '#5a4f8a' : kind === 'analog' ? '#4d6a7a' : kind === 'io' ? '#6a5a3a' : '#463d66'
      g.fillStyle = hue
      g.fillRect(r.x, r.y, r.w, r.h)
      if (kind === 'sram') {
        g.strokeStyle = 'rgba(210,200,255,0.18)'
        g.lineWidth = 1
        const step = 5
        for (let x = r.x; x < r.x + r.w; x += step) {
          g.beginPath()
          g.moveTo(x, r.y)
          g.lineTo(x, r.y + r.h)
          g.stroke()
        }
        for (let y = r.y; y < r.y + r.h; y += step * 2) {
          g.beginPath()
          g.moveTo(r.x, y)
          g.lineTo(r.x + r.w, y)
          g.stroke()
        }
      } else if (kind === 'analog') {
        for (let k = 0; k < 14; k++) {
          g.fillStyle = `rgba(${150 + rnd() * 80},${170 + rnd() * 60},${200},0.25)`
          const w = r.w * (0.1 + rnd() * 0.3)
          const h = r.h * (0.1 + rnd() * 0.3)
          g.fillRect(r.x + rnd() * (r.w - w), r.y + rnd() * (r.h - h), w, h)
        }
      } else {
        // standard-cell logic: dense rows of tiny rectangles
        const rowH = 6
        for (let y = r.y; y < r.y + r.h - rowH; y += rowH) {
          let x = r.x
          while (x < r.x + r.w - 2) {
            const cw = 2 + rnd() * 9
            g.fillStyle = `rgba(${170 + rnd() * 70},${150 + rnd() * 60},${220 + rnd() * 35},${0.08 + rnd() * 0.2})`
            g.fillRect(x, y, cw - 1, rowH - 1)
            x += cw
          }
        }
      }
      g.strokeStyle = 'rgba(230,220,255,0.35)'
      g.lineWidth = 2
      g.strokeRect(r.x, r.y, r.w, r.h)
    })
    // top-metal power grid
    g.strokeStyle = 'rgba(230,200,140,0.12)'
    g.lineWidth = 3
    for (let x = ring; x < N - ring; x += N / 24) {
      g.beginPath()
      g.moveTo(x, ring)
      g.lineTo(x, N - ring)
      g.stroke()
    }
  }, true, false)
  return { texture, blocks }
}

/** Iridescent silicon with a die map (thin-film sheen shifts with the view). */
export function dieMaterial(map: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map,
    color: 0xffffff,
    metalness: 0.55,
    roughness: 0.24,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [180, 620],
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
  })
}

/** Gold bond wires: arcs from each `from` to `to` (world units), merged. */
export function bondWires(pairs: [THREE.Vector3, THREE.Vector3][], o: { radius?: number; loop?: number } = {}): THREE.Mesh {
  const r = o.radius ?? 0.006
  const geos = pairs.map(([a, b]) => {
    const mid = a.clone().lerp(b, 0.35)
    mid.y += (o.loop ?? 0.18) + a.distanceTo(b) * 0.15
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    return new THREE.TubeGeometry(curve, 16, r, 5, false)
  })
  const m = new THREE.Mesh(mergeGeometries(geos)!, MAT.gold())
  geos.forEach(g2 => g2.dispose())
  return m
}

/** White silkscreen text lying flat on the board (XZ plane), `height` cm tall. */
export function silk(text: string, o: { height?: number; color?: THREE.ColorRepresentation; weight?: number; align?: 'left' | 'center' } = {}): THREE.Mesh {
  const px = 96
  const font = `${o.weight ?? 500} ${px}px 'Martian Mono Variable', ui-monospace, monospace`
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = font
  const W = Math.ceil(probe.measureText(text).width) + 16
  const H = Math.ceil(px * 1.3)
  const tex = canvasTex(W, H, g => {
    g.font = font
    g.fillStyle = '#ffffff'
    g.textBaseline = 'middle'
    g.fillText(text, 8, H / 2)
  })
  const height = o.height ?? 0.25
  const geo = new THREE.PlaneGeometry((height * W) / H, height)
  if (o.align !== 'center') geo.translate((height * W) / H / 2, 0, 0)
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: o.color ?? S.silk, transparent: true, depthWrite: false })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.002
  return mesh
}

/** Instanced tiny SMD parts (0402/0603 caps and resistors) scattered in a rect on XZ. */
export function smdField(o: { x0: number; z0: number; x1: number; z1: number; count: number; seed?: number; avoid?: (x: number, z: number) => boolean }): THREE.Group {
  let seed = o.seed ?? 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const g = new THREE.Group()
  const capGeo = new THREE.BoxGeometry(0.1, 0.05, 0.05)
  const endGeo = new THREE.BoxGeometry(0.022, 0.052, 0.052)
  const bodies = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.6 }), o.count)
  const ends = new THREE.InstancedMesh(endGeo, MATI.tin(), o.count * 2)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  let k = 0
  for (let i = 0; i < o.count; i++) {
    let x = 0
    let z = 0
    let tries = 0
    do {
      x = o.x0 + rnd() * (o.x1 - o.x0)
      z = o.z0 + rnd() * (o.z1 - o.z0)
    } while (o.avoid && o.avoid(x, z) && ++tries < 12)
    const rot = rnd() < 0.5 ? 0 : Math.PI / 2
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
    m.compose(new THREE.Vector3(x, 0.025, z), q, new THREE.Vector3(1, 1, 1))
    bodies.setMatrixAt(i, m)
    const dir = new THREE.Vector3(0.05, 0, 0).applyQuaternion(q)
    m.compose(new THREE.Vector3(x + dir.x, 0.026, z + dir.z), q, new THREE.Vector3(1, 1, 1))
    ends.setMatrixAt(k++, m)
    m.compose(new THREE.Vector3(x - dir.x, 0.026, z - dir.z), q, new THREE.Vector3(1, 1, 1))
    ends.setMatrixAt(k++, m)
  }
  g.add(bodies, ends)
  return g
}
