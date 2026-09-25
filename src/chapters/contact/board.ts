import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { chipPackage, S } from '../../kit/silicon'
import { logoShapes } from '../../logo/logo'
import { BRAND } from '../../content'
import { rng } from '../../core/math'
import {
  BD,
  BW,
  C1C,
  CORNER_R,
  D1C,
  FIDUCIALS,
  HOLE_R,
  HOLES,
  J1C,
  J1_D,
  J1_MOUTH_Z,
  J2_PIN0,
  J2_PITCH,
  LED_X,
  LED_Z,
  PASSIVES,
  PLANE_ORIGIN,
  TESTPOINTS,
  U1C,
  U1N,
  U1W,
  U1_PAD_IN,
  U1_PAD_OUT,
  U2C,
  U3C,
  U4C,
  U5C,
  U6C,
  Y1C,
  buildLayout,
  u1Pin,
  type Layout,
  type V2,
} from './layout'
import { Halos, Net } from './net'

/*
 * POWER ON · the finished Hark board, built once.
 *
 *   board      rounded FR4 slab with plated mounting holes; its top is ONE
 *              physical material with two baked canvases:
 *                map  = matte black mask, ground pour, copper traces,
 *                       clearance channels, via holes, white silkscreen
 *                       (designators, outlines, the Hark mark, the email)
 *                aux  = R: height (bump: the mask hugging the copper, the
 *                       raised ink), G/B: where the power plane glows
 *              and a patched emissive: a ring of light spreading from the
 *              regulator (uWave) that leaves the plane faintly lit (uPlane).
 *   parts      instanced by material (tin, gold, bodies, plastic…): U1 the
 *              Hark chip (kit), regulator, flash, sensors, crystal, USB-C
 *              (a real hollow shell with a tongue), 1×6 header, bulk can,
 *              0402/0603/0805 passives, LEDs, vias, test points, fiducials.
 *   light      the Net (glowing traces), LED halos, and the etched-mark sweep
 *              over U1.
 */

const MM = {
  tin: () => new THREE.MeshStandardMaterial({ color: '#b4b9bf', roughness: 0.34, metalness: 1 }),
  solder: () => new THREE.MeshStandardMaterial({ color: '#9ea3a9', roughness: 0.42, metalness: 1 }),
  gold: () => new THREE.MeshStandardMaterial({ color: S.gold, roughness: 0.32, metalness: 1 }),
  copper: () => new THREE.MeshStandardMaterial({ color: '#d08a52', roughness: 0.2, metalness: 1 }),
  epoxy: () => new THREE.MeshStandardMaterial({ color: '#17191c', roughness: 0.58, metalness: 0 }),
  plastic: () => new THREE.MeshStandardMaterial({ color: '#0f1013', roughness: 0.42, metalness: 0 }),
  body: () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0 }),
  alu: () => new THREE.MeshStandardMaterial({ color: '#c4c9d0', roughness: 0.3, metalness: 1 }),
  shell: () => new THREE.MeshStandardMaterial({ color: '#aeb3ba', roughness: 0.34, metalness: 1 }),
  cave: () => new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.8, metalness: 0, side: THREE.BackSide }),
  fr4: () => new THREE.MeshStandardMaterial({ color: '#3a3526', roughness: 0.82, metalness: 0 }),
}

/** instanced boxes: add(x, y0, z, sx, sy, sz, ry, color?) — y0 = bottom of the box */
class Boxes {
  items: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; c?: THREE.Color }[] = []
  add(x: number, y0: number, z: number, sx: number, sy: number, sz: number, ry = 0, c?: THREE.ColorRepresentation) {
    this.items.push({ x, y: y0 + sy / 2, z, sx, sy, sz, ry, c: c !== undefined ? new THREE.Color(c) : undefined })
  }
  build(geo: THREE.BufferGeometry, mat: THREE.Material) {
    const n = Math.max(1, this.items.length)
    const m = new THREE.InstancedMesh(geo, mat, n)
    const mt = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    this.items.forEach((b, i) => {
      q.setFromAxisAngle(up, b.ry)
      mt.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz))
      m.setMatrixAt(i, mt)
      if (b.c) m.setColorAt(i, b.c)
    })
    if (!this.items.length) m.count = 0
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    return m
  }
}

/** local → board transform for a part at (cx, cz) rotated ry about +y */
function place(cx: number, cz: number, ry: number) {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  // three's Y rotation: x' = x cos + z sin, z' = −x sin + z cos
  return (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c]
}

const PASSIVE_DIM = {
  '0402': { l: 0.1, w: 0.05, h: 0.035 },
  '0603': { l: 0.16, w: 0.08, h: 0.045 },
  '0805': { l: 0.2, w: 0.125, h: 0.06 },
}
const PASSIVE_COL = { c: '#8e7150', r: '#141518', f: '#2b2d31' }

export interface Board {
  root: THREE.Group
  chip: THREE.Group
  net: Net
  halos: Halos
  /** LED lenses: 0 = D1 PWR, 1–4 = D2–D5 */
  lenses: THREE.InstancedMesh
  sweepU: { uSweep: { value: number }; uLit: { value: number } }
  planeU: { uWave: { value: number }; uPlane: { value: number }; uRing: { value: number } }
  layout: Layout
  redraw(): void
  canvas: HTMLCanvasElement
}

export function buildBoard(o: { mobile: boolean }): Board {
  const layout = buildLayout()
  const root = new THREE.Group()
  const W = BW
  const D = BD
  const T = 0.16

  /* ------------------------------------------------ textures */
  const px = o.mobile ? 1024 : 2048
  const s = px / W
  const cw = px
  const ch = Math.round(D * s)
  const mapCv = document.createElement('canvas')
  mapCv.width = cw
  mapCv.height = ch
  const auxCv = document.createElement('canvas')
  auxCv.width = cw
  auxCv.height = ch
  const map = new THREE.CanvasTexture(mapCv)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const aux = new THREE.CanvasTexture(auxCv)
  aux.colorSpace = THREE.NoColorSpace
  aux.anisotropy = 8
  let redrawCrisp = () => {}
  const redraw = () => {
    drawBoard(mapCv.getContext('2d')!, s, layout, 'map')
    drawBoard(auxCv.getContext('2d')!, s, layout, 'aux')
    map.needsUpdate = true
    aux.needsUpdate = true
    redrawCrisp()
  }
  redraw()

  /* ------------------------------------------------ the board slab */
  const shape = new THREE.Shape()
  {
    const x0 = -W / 2
    const y0 = -D / 2
    const r = CORNER_R
    shape.moveTo(x0 + r, y0)
    shape.lineTo(x0 + W - r, y0)
    shape.absarc(x0 + W - r, y0 + r, r, -Math.PI / 2, 0, false)
    shape.lineTo(x0 + W, y0 + D - r)
    shape.absarc(x0 + W - r, y0 + D - r, r, 0, Math.PI / 2, false)
    shape.lineTo(x0 + r, y0 + D)
    shape.absarc(x0 + r, y0 + D - r, r, Math.PI / 2, Math.PI, false)
    shape.lineTo(x0, y0 + r)
    shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false)
    for (const h of HOLES) {
      const p = new THREE.Path()
      p.absarc(h.x, -h.y, HOLE_R, 0, Math.PI * 2, true)
      shape.holes.push(p)
    }
  }
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 14 })
  slabGeo.rotateX(-Math.PI / 2)
  slabGeo.translate(0, -T, 0)
  {
    const p = slabGeo.attributes.position as THREE.BufferAttribute
    const uv = slabGeo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + W / 2) / W, (D / 2 - p.getZ(i)) / D)
    uv.needsUpdate = true
  }
  const green = new THREE.Color(S.signal)
  const planeU = { uWave: { value: -10 }, uPlane: { value: 0 }, uRing: { value: 2.4 } }
  const top = new THREE.MeshPhysicalMaterial({
    map,
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.42,
    bumpMap: aux,
    bumpScale: o.mobile ? 0.55 : 0.9,
    emissive: green,
    emissiveMap: aux,
    emissiveIntensity: 1,
  })
  const origin = new THREE.Vector2((PLANE_ORIGIN.x + W / 2) / W, (D / 2 - PLANE_ORIGIN.y) / D)
  top.onBeforeCompile = sh => {
    sh.uniforms.uWave = planeU.uWave
    sh.uniforms.uPlane = planeU.uPlane
    sh.uniforms.uRing = planeU.uRing
    sh.uniforms.uWaveO = { value: origin }
    sh.uniforms.uBoard = { value: new THREE.Vector2(W, D) }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWave, uPlane, uRing; uniform vec2 uWaveO, uBoard;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float r = length((vEmissiveMapUv - uWaveO) * uBoard);
          float h = uWave - r;
          // a thin bright wavefront with a short fading wake
          float ring = smoothstep(-0.1, 0.0, h) * ((1.0 - smoothstep(0.0, 0.3, h)) + 0.07 * (1.0 - smoothstep(0.0, 2.0, h)));
          float lit = smoothstep(0.0, 1.2, h);
          totalEmissiveRadiance *= ring * uRing + lit * uPlane;
        }`,
      )
  }
  top.customProgramCacheKey = () => 'hs-contact-board'
  const slab = new THREE.Mesh(slabGeo, [top, MM.fr4()])
  root.add(slab)

  /* ------------------------------------------------ parts */
  const tin = new Boxes()
  const solder = new Boxes()
  const gold = new Boxes()
  const epoxy = new Boxes()
  const plastic = new Boxes()
  const bodies = new Boxes()
  const alu = new Boxes()

  // U1: the Hark chip
  const tinMat = MM.tin()
  const epoxyMat = MM.epoxy()
  const chip = chipPackage({ w: U1W, kind: 'qfp', pinsPerSide: U1N, lines: ['HK-0N', 'POWER · ON'] })
  chip.traverse(n => {
    const m = n as THREE.Mesh
    if (!m.isMesh) return
    if (m === chip.userData.top) return
    m.material = (m as THREE.InstancedMesh).isInstancedMesh ? tinMat : epoxyMat
    m.castShadow = false
  })
  chip.position.set(U1C.x, 0, U1C.y)
  root.add(chip)
  // its pads (solder), 64
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < U1N; k++) {
      const p = u1Pin(side, k, (U1_PAD_IN + U1_PAD_OUT) / 2)
      const along = side % 2 === 0
      solder.add(p.x, 0, p.y, along ? 0.2 : 0.06, 0.012, along ? 0.06 : 0.2)
    }
  }

  // U2: SOT-223 regulator (leads toward +z, tab toward −z)
  {
    const [cx, cz] = [U2C.x, U2C.y]
    epoxy.add(cx, 0.03, cz, 0.65, 0.15, 0.35)
    for (const dx of [-0.23, 0, 0.23]) {
      tin.add(cx + dx, 0.075, cz + 0.2, 0.07, 0.018, 0.06)
      tin.add(cx + dx, 0.012, cz + 0.24, 0.07, 0.07, 0.02)
      tin.add(cx + dx, 0, cz + 0.3, 0.07, 0.018, 0.12)
      tin.add(cx + dx, 0, cz + 0.31, 0.1, 0.008, 0.16)
    }
    tin.add(cx, 0.075, cz - 0.2, 0.3, 0.018, 0.06)
    tin.add(cx, 0.012, cz - 0.24, 0.3, 0.07, 0.02)
    tin.add(cx, 0, cz - 0.3, 0.3, 0.018, 0.12)
    tin.add(cx, 0, cz - 0.31, 0.34, 0.008, 0.18)
  }

  // U3: SOIC-8 flash (pin rows along z, facing ±x)
  {
    const [cx, cz] = [U3C.x, U3C.y]
    epoxy.add(cx, 0.02, cz, 0.39, 0.14, 0.49)
    for (const sx of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const z = cz + (j - 1.5) * 0.127
        tin.add(cx + sx * 0.215, 0.07, z, 0.05, 0.015, 0.042)
        tin.add(cx + sx * 0.245, 0.01, z, 0.014, 0.07, 0.042)
        tin.add(cx + sx * 0.29, 0, z, 0.09, 0.015, 0.042)
        tin.add(cx + sx * 0.3, 0, z, 0.15, 0.006, 0.06)
      }
    }
  }

  // U4 / U5: QFNs (edge pads peek out from under the body)
  for (const [c, w, n] of [
    [U4C, 0.4, 3],
    [U5C, 0.5, 4],
  ] as [V2, number, number][]) {
    epoxy.add(c.x, 0.004, c.y, w, 0.085, w)
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < n; k++) {
        const a = (k - (n - 1) / 2) * 0.1
        const f = place(c.x, c.y, (side * Math.PI) / 2)
        const [x, z] = f(w / 2 + 0.008, a)
        const along = side % 2 === 0
        tin.add(x, 0, z, along ? 0.07 : 0.03, 0.02, along ? 0.03 : 0.07)
      }
    }
  }

  // U6: SOT-23-6 ESD array over the USB pair
  {
    const [cx, cz] = [U6C.x, U6C.y]
    epoxy.add(cx, 0.02, cz, 0.29, 0.1, 0.16)
    for (const sz of [-1, 1]) {
      for (const dx of [-0.095, 0, 0.095]) {
        tin.add(cx + dx, 0.05, cz + sz * 0.1, 0.035, 0.012, 0.04)
        tin.add(cx + dx, 0, cz + sz * 0.14, 0.035, 0.012, 0.06)
      }
    }
  }

  // Y1: 3225 crystal (ceramic base, seam-welded metal lid)
  {
    const [cx, cz] = [Y1C.x, Y1C.y]
    bodies.add(cx, 0.004, cz, 0.25, 0.05, 0.32, 0, '#cbbf9f')
    alu.add(cx, 0.054, cz, 0.21, 0.026, 0.28)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tin.add(cx + sx * 0.08, 0, cz + sz * 0.11, 0.1, 0.012, 0.09)
  }

  // passives
  for (const p of PASSIVES) {
    const d = PASSIVE_DIM[p.size]
    const f = place(p.p.x, p.p.y, p.rot)
    const [bx, bz] = f(0, 0)
    bodies.add(bx, 0.004, bz, d.l * 0.7, d.h, d.w * 0.96, p.rot, PASSIVE_COL[p.kind])
    for (const e of [-1, 1]) {
      const [x, z] = f(e * d.l * 0.42, 0)
      tin.add(x, 0.004, z, d.l * 0.17, d.h * 1.02, d.w, p.rot)
      const [fx, fz] = f(e * d.l * 0.54, 0)
      tin.add(fx, 0, fz, d.l * 0.14, d.h * 0.45, d.w * 1.15, p.rot)
    }
  }

  // LEDs (0603): body, tin ends, and a lens that lights (separate instanced basic material)
  const ledPos: { x: number; z: number; rot: number }[] = [{ x: D1C.x, z: D1C.y, rot: 0 }, ...LED_X.map(x => ({ x, z: LED_Z, rot: Math.PI / 2 }))]
  for (const l of ledPos) {
    const f = place(l.x, l.z, l.rot)
    bodies.add(l.x, 0.004, l.z, 0.12, 0.045, 0.08, l.rot, '#dcdad0')
    for (const e of [-1, 1]) {
      const [x, z] = f(e * 0.068, 0)
      tin.add(x, 0.004, z, 0.028, 0.046, 0.08, l.rot)
      const [fx, fz] = f(e * 0.088, 0)
      tin.add(fx, 0, fz, 0.022, 0.02, 0.09, l.rot)
    }
  }
  const lensGeo = new THREE.BoxGeometry(1, 1, 1)
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  const lenses = new THREE.InstancedMesh(lensGeo, lensMat, ledPos.length)
  {
    const mt = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    ledPos.forEach((l, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot)
      mt.compose(new THREE.Vector3(l.x, 0.05, l.z), q, new THREE.Vector3(0.1, 0.012, 0.066))
      lenses.setMatrixAt(i, mt)
      lenses.setColorAt(i, new THREE.Color('#3a3d38'))
    })
  }
  root.add(lenses)

  // J2: 1×6 header (black plastic, gold posts with pointed tips)
  const pinGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.032, 0.032, 0.56, 4, 1).translate(0, 0.28, 0),
    new THREE.CylinderGeometry(0.012, 0.032, 0.05, 4, 1).translate(0, 0.585, 0),
  ])!
  pinGeo.rotateY(Math.PI / 4)
  const pinXs: number[] = []
  {
    const cx = J2_PIN0.x + 2.5 * J2_PITCH
    plastic.add(cx, 0, J2_PIN0.y, 6 * J2_PITCH - 0.01, 0.25, J2_PITCH - 0.004)
    for (let i = 0; i < 6; i++) pinXs.push(J2_PIN0.x + i * J2_PITCH)
  }

  // C1: the bulk can on its plastic base
  {
    plastic.add(C1C.x, 0, C1C.y, 0.66, 0.06, 0.66)
    for (const sz of [-1, 1]) tin.add(C1C.x, 0, C1C.y + sz * 0.36, 0.1, 0.02, 0.14)
  }
  const can = buildCan()
  can.position.set(C1C.x, 0.06, C1C.y)
  root.add(can)

  // J1: USB-C receptacle
  const usb = buildUsbC(tin, gold)
  root.add(usb)

  // build batches
  const goldMat = MM.gold()
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const round = new RoundedBoxGeometry(1, 1, 1, 2, 0.14)
  root.add(tin.build(unit, tinMat))
  root.add(solder.build(unit, MM.solder()))
  root.add(gold.build(unit, goldMat))
  root.add(epoxy.build(round, epoxyMat))
  root.add(plastic.build(round, MM.plastic()))
  root.add(bodies.build(round, MM.body()))
  root.add(alu.build(unit, MM.alu()))
  {
    const pins = new THREE.InstancedMesh(pinGeo, goldMat, pinXs.length)
    const mt = new THREE.Matrix4()
    pinXs.forEach((x, i) => pins.setMatrixAt(i, mt.makeTranslation(x, 0.25, J2_PIN0.y)))
    root.add(pins)
  }

  // flat metal: vias, mounting rings, test points, fiducials
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, pts: V2[], y: number) => {
    geo.rotateX(-Math.PI / 2)
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length))
    const mt = new THREE.Matrix4()
    pts.forEach((p, i) => m.setMatrixAt(i, mt.makeTranslation(p.x, y, p.y)))
    root.add(m)
    return m
  }
  flat(new THREE.RingGeometry(0.021, 0.046, 14), goldMat, layout.vias, 0.0012)
  flat(new THREE.RingGeometry(HOLE_R, 0.31, 40), goldMat, HOLES, 0.0012)
  flat(
    new THREE.CircleGeometry(0.075, 24),
    goldMat,
    TESTPOINTS.map(t => t.p),
    0.0014,
  )
  flat(new THREE.CircleGeometry(0.05, 24), MM.copper(), FIDUCIALS, 0.0014)
  {
    const wall = new THREE.CylinderGeometry(HOLE_R, HOLE_R, T, 32, 1, true)
    const m = new THREE.InstancedMesh(wall, new THREE.MeshStandardMaterial({ color: S.gold, roughness: 0.3, metalness: 1, side: THREE.BackSide }), HOLES.length)
    const mt = new THREE.Matrix4()
    HOLES.forEach((h, i) => m.setMatrixAt(i, mt.makeTranslation(h.x, -T / 2, h.y)))
    root.add(m)
  }

  const crisp = buildCrisp()
  root.add(crisp.mesh)
  redrawCrisp = crisp.redraw

  /* ------------------------------------------------ light */
  const net = new Net(layout.nets, PLANE_ORIGIN)
  root.add(net.mesh)
  const halos = new Halos([...ledPos.map(l => ({ x: l.x, z: l.z, size: 0.95 })), { x: U1C.x, z: U1C.y, size: 4.4 }])
  root.add(halos.mesh)

  // the etched-mark sweep over U1 (additive, masked by the etch)
  const topMesh = chip.userData.top as THREE.Mesh
  const topMap = (topMesh.material as THREE.MeshStandardMaterial).map
  const sweepU = { uSweep: { value: -1 }, uLit: { value: 0 } }
  const sweep = new THREE.Mesh(
    (topMesh.geometry as THREE.PlaneGeometry).clone(),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uMap: { value: topMap }, uColor: { value: green }, ...sweepU },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor; uniform float uSweep, uLit; varying vec2 vUv;
        void main() {
          vec3 t = texture2D(uMap, vUv).rgb;
          // a blurred read (mip bias) gives the lit etch a soft local glow without
          // pushing anything over the bloom threshold
          vec3 tb = texture2D(uMap, vUv, 3.5).rgb;
          float etch = smoothstep(0.03, 0.2, dot(t, vec3(0.3333)));
          float glow = smoothstep(0.012, 0.1, dot(tb, vec3(0.3333)));
          float diag = (vUv.x + (1.0 - vUv.y)) * 0.5;
          float x = (diag - uSweep) * 7.0;
          float band = exp(-x * x);
          vec3 c = uColor * (etch * (band * 1.2 + uLit * 0.3) + glow * (band * 0.3 + uLit * 0.05)) + vec3(0.85, 1.0, 0.9) * band * etch * 0.22 + vec3(1.0) * band * 0.02;
          if (max(c.r, max(c.g, c.b)) < 0.003) discard;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  )
  sweep.rotation.x = -Math.PI / 2
  sweep.position.set(U1C.x, topMesh.position.y + 0.0015, U1C.y)
  sweep.renderOrder = 4
  root.add(sweep)

  return { root, chip, net, halos, lenses, sweepU, planeU, layout, redraw, canvas: mapCv }
}

/* ================================================================ crisp silkscreen */

/**
 * Labels the opening close-ups get near to (J1, the PWR LED, the regulator)
 * are drawn as real geometry from one text atlas (one draw call) instead of
 * being baked into the board map, so they stay sharp at macro distances.
 */
const CRISP: { str: string; x: number; z: number; size: number; align: CanvasTextAlign; weight: number }[] = [
  { str: 'J1', x: J1C.x - 0.6, z: J1C.y - 0.28, size: 0.13, align: 'right', weight: 600 },
  { str: 'USB-C', x: J1C.x - 0.6, z: J1C.y - 0.1, size: 0.1, align: 'right', weight: 500 },
  { str: '5V IN', x: J1C.x - 0.6, z: J1C.y + 0.06, size: 0.1, align: 'right', weight: 500 },
  { str: 'PWR', x: D1C.x, z: D1C.y + 0.26, size: 0.11, align: 'center', weight: 600 },
  { str: 'F1', x: 4.35, z: 2.66, size: 0.09, align: 'center', weight: 500 },
  { str: 'R1', x: 4.22, z: 2.96, size: 0.08, align: 'center', weight: 500 },
  { str: 'U2', x: U2C.x - 0.44, z: U2C.y - 0.3, size: 0.12, align: 'right', weight: 500 },
  { str: '3V3', x: U2C.x - 0.44, z: U2C.y - 0.12, size: 0.1, align: 'right', weight: 500 },
  ...TESTPOINTS.filter(t => t.left).map(t => ({ str: t.label, x: t.p.x - 0.19, z: t.p.y, size: 0.085, align: 'right' as CanvasTextAlign, weight: 600 })),
]

function buildCrisp() {
  const EM = 112
  const ROW = Math.ceil(EM * 1.3)
  const PAD = 18
  const AW = 1024
  const font = (w: number) => `${w} ${EM}px 'Martian Mono Variable', ui-monospace, monospace`
  const probe = document.createElement('canvas').getContext('2d')!
  // pack labels into rows
  const slots: { x: number; y: number; w: number }[] = []
  let cx = 0
  let row = 0
  for (const c of CRISP) {
    probe.font = font(c.weight)
    const w = Math.ceil(probe.measureText(c.str).width) + PAD * 2
    if (cx + w > AW) {
      cx = 0
      row++
    }
    slots.push({ x: cx, y: row * ROW, w })
    cx += w
  }
  const cv = document.createElement('canvas')
  cv.width = AW
  cv.height = (row + 1) * ROW
  const g = cv.getContext('2d')!
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const draw = () => {
    g.clearRect(0, 0, cv.width, cv.height)
    g.fillStyle = '#ffffff'
    g.textBaseline = 'middle'
    CRISP.forEach((c, i) => {
      const sl = slots[i]
      g.font = font(c.weight)
      g.textAlign = 'left'
      g.fillText(c.str, sl.x + PAD, sl.y + ROW / 2)
    })
    tex.needsUpdate = true
  }
  draw()
  // one merged quad per label, uv into the atlas
  const pos: number[] = []
  const uv: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  CRISP.forEach((c, i) => {
    const sl = slots[i]
    const k = c.size / EM
    const w = sl.w * k
    const h = ROW * k
    const textW = (sl.w - PAD * 2) * k
    const left = c.align === 'left' ? c.x - PAD * k : c.align === 'right' ? c.x - textW - PAD * k : c.x - w / 2
    const x0 = left
    const x1 = left + w
    const z0 = c.z - h / 2
    const z1 = c.z + h / 2
    const u0 = sl.x / AW
    const u1 = (sl.x + sl.w) / AW
    const v0 = 1 - (sl.y + ROW) / cv.height
    const v1 = 1 - sl.y / cv.height
    const b = i * 4
    const y = 0.0009
    pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1)
    uv.push(u0, v1, u1, v1, u0, v0, u1, v0)
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setIndex(idx)
  const mat = new THREE.MeshStandardMaterial({
    color: '#e6e6e0',
    map: tex,
    transparent: true,
    depthWrite: false,
    roughness: 0.78,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 1
  return { mesh, redraw: draw }
}

/* ================================================================ USB-C */

function stadium(w: number, h: number, cx = 0, cy = 0): THREE.Shape {
  const r = h / 2
  const s = new THREE.Shape()
  s.moveTo(cx - w / 2 + r, cy - r)
  s.lineTo(cx + w / 2 - r, cy - r)
  s.absarc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2, false)
  s.lineTo(cx - w / 2 + r, cy + r)
  s.absarc(cx - w / 2 + r, cy, r, Math.PI / 2, Math.PI * 1.5, false)
  return s
}

function buildUsbC(tin: Boxes, gold: Boxes): THREE.Group {
  const g = new THREE.Group()
  const w = 0.894
  const h = 0.326
  const wall = 0.026
  const shellShape = stadium(w, h)
  const hole = stadium(w - wall * 2, h - wall * 2)
  shellShape.holes.push(hole as unknown as THREE.Path)
  const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
    depth: J1_D,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 12,
  })
  // mouth at +z (local extrusion end)
  const shell = new THREE.Mesh(shellGeo, MM.shell())
  const y = h / 2 + 0.004
  const zBack = J1_MOUTH_Z - J1_D - 0.012
  shell.position.set(J1C.x, y, zBack)
  g.add(shell)
  // a dark cavity inside (seen through the mouth)
  const caveGeo = new THREE.ExtrudeGeometry(stadium(w - wall * 2 - 0.004, h - wall * 2 - 0.004), { depth: J1_D - 0.02, bevelEnabled: false, curveSegments: 12 })
  const cave = new THREE.Mesh(caveGeo, MM.cave())
  cave.position.set(J1C.x, y, zBack + 0.004)
  g.add(cave)
  // the tongue with its contacts
  const tongue = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.07, 0.46, 2, 0.02), MM.plastic())
  tongue.position.set(J1C.x, y, J1_MOUTH_Z - 0.3)
  g.add(tongue)
  for (let i = 0; i < 12; i++) {
    const x = J1C.x + (i - 5.5) * 0.05
    for (const sy of [-1, 1]) gold.add(x, y + sy * 0.036 - 0.003, J1_MOUTH_Z - 0.33, 0.025, 0.006, 0.34)
  }
  // rear SMD leads + solder, and the shell's through-hole legs
  for (let i = 0; i < 12; i++) {
    const x = J1C.x + (i - 5.5) * 0.05
    tin.add(x, 0, zBack - 0.07, 0.026, 0.014, 0.16)
  }
  for (const sx of [-1, 1]) {
    tin.add(J1C.x + sx * (w / 2 + 0.012), 0, zBack + 0.18, 0.03, 0.22, 0.12)
    tin.add(J1C.x + sx * (w / 2 + 0.012), 0, J1_MOUTH_Z - 0.2, 0.03, 0.22, 0.12)
    tin.add(J1C.x + sx * (w / 2 + 0.03), 0, zBack + 0.18, 0.08, 0.012, 0.2)
    tin.add(J1C.x + sx * (w / 2 + 0.03), 0, J1_MOUTH_Z - 0.2, 0.08, 0.012, 0.2)
  }
  return g
}

/* ================================================================ the can */

function buildCan(): THREE.Group {
  const g = new THREE.Group()
  const R = 0.315
  const H = 0.54
  const prof = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(R - 0.02, 0),
    new THREE.Vector2(R, 0.02),
    new THREE.Vector2(R, 0.07),
    new THREE.Vector2(R - 0.018, 0.085),
    new THREE.Vector2(R - 0.018, 0.1),
    new THREE.Vector2(R, 0.115),
    new THREE.Vector2(R, H - 0.03),
    new THREE.Vector2(R - 0.012, H - 0.008),
    new THREE.Vector2(R - 0.035, H),
    new THREE.Vector2(R - 0.05, H - 0.004),
  ]
  const side = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), MM.alu())
  g.add(side)
  // the top: brushed aluminium, a black polarity arc, the scored vent
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const c = cv.getContext('2d')!
  c.fillStyle = '#bfc4cb'
  c.fillRect(0, 0, 256, 256)
  const r = rng(11)
  for (let i = 0; i < 90; i++) {
    c.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,44,50'},${0.05 + r() * 0.06})`
    c.lineWidth = 1
    c.beginPath()
    c.arc(128, 128, 10 + r() * 118, 0, Math.PI * 2)
    c.stroke()
  }
  c.fillStyle = '#121316'
  c.beginPath()
  c.arc(128, 128, 128, Math.PI * 0.62, Math.PI * 1.38)
  c.arc(128, 128, 64, Math.PI * 1.38, Math.PI * 0.62, true)
  c.closePath()
  c.fill()
  c.strokeStyle = 'rgba(30,32,36,0.8)'
  c.lineWidth = 3
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    c.beginPath()
    c.moveTo(128 - Math.cos(a) * 70, 128 - Math.sin(a) * 70)
    c.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70)
    c.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const lid = new THREE.Mesh(new THREE.CircleGeometry(R - 0.048, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 1 }))
  lid.rotation.x = -Math.PI / 2
  lid.position.y = H - 0.004
  g.add(lid)
  return g
}

/* ================================================================ the board texture */

type Mode = 'map' | 'aux'

/**
 * Draws the board top in board coordinates (cm). mode 'map' = colour,
 * 'aux' = R height / G,B plane-glow mask.
 */
function drawBoard(g: CanvasRenderingContext2D, s: number, lay: Layout, mode: Mode) {
  const W = BW
  const D = BD
  const map = mode === 'map'
  // palette: [map colour, aux rgb]
  const C = {
    base: map ? '#090a0d' : 'rgb(70,0,0)',
    pour: map ? '#0e1115' : 'rgb(170,40,40)',
    gap: map ? '#07080a' : 'rgb(40,0,0)',
    trace: map ? '#181c22' : 'rgb(190,0,0)',
    stub: map ? '#161a1f' : 'rgb(185,0,0)',
    opening: map ? '#050506' : 'rgb(30,0,0)',
    hole: map ? '#010102' : 'rgb(10,210,210)',
    silk: map ? '#e6e6e0' : 'rgb(255,0,0)',
    silkDim: map ? 'rgba(230,230,224,0.9)' : 'rgb(240,0,0)',
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, g.canvas.width, g.canvas.height)
  g.setTransform(s, 0, 0, s, (s * W) / 2, (s * D) / 2)
  g.lineCap = 'round'
  g.lineJoin = 'round'

  // mask over bare laminate, then the ground pour
  g.fillStyle = C.base
  g.fillRect(-W / 2, -D / 2, W, D)
  g.fillStyle = C.pour
  roundRect(g, -W / 2 + 0.14, -D / 2 + 0.14, W - 0.28, D - 0.28, 0.26)
  g.fill()

  // clearances around everything the pour must not touch
  g.strokeStyle = C.gap
  for (const n of lay.nets) strokePath(g, n.pts, n.w + 0.13)
  for (const st of lay.stubs) strokePath(g, st.pts, st.w + 0.13)
  g.fillStyle = C.gap
  for (const h of HOLES) circle(g, h.x, h.y, 0.44)
  for (const f of FIDUCIALS) circle(g, f.x, f.y, 0.17)
  for (const t of TESTPOINTS) circle(g, t.p.x, t.p.y, 0.14)
  for (const v of lay.vias) circle(g, v.x, v.y, 0.085)
  // part keep-outs (under bodies and pads)
  const keep = (x: number, z: number, w: number, d: number) => g.fillRect(x - w / 2, z - d / 2, w, d)
  keep(U1C.x, U1C.y, U1_PAD_OUT * 2 + 0.12, U1_PAD_OUT * 2 + 0.12)
  keep(U2C.x, U2C.y, 0.85, 0.95)
  keep(U3C.x, U3C.y, 0.82, 0.62)
  keep(U4C.x, U4C.y, 0.6, 0.6)
  keep(U5C.x, U5C.y, 0.7, 0.7)
  keep(U6C.x, U6C.y, 0.42, 0.42)
  keep(Y1C.x, Y1C.y, 0.38, 0.44)
  keep(J1C.x, J1C.y - 0.1, 1.08, 1.0)
  keep(J2_PIN0.x + 2.5 * J2_PITCH, J2_PIN0.y, 6 * J2_PITCH + 0.12, 0.38)
  keep(C1C.x, C1C.y, 0.78, 0.9)

  // copper traces (under the mask)
  g.strokeStyle = C.trace
  for (const n of lay.nets) strokePath(g, n.pts, n.w)
  g.strokeStyle = C.stub
  for (const st of lay.stubs) strokePath(g, st.pts, st.w)

  // U1 thermal / power: a big square of copper under the chip (the mask shows its edge)
  g.fillStyle = C.stub
  keep(U1C.x, U1C.y, 1.5, 1.5)

  // mask openings (dark rings around exposed metal)
  g.fillStyle = C.opening
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < U1N; k++) {
      const p = u1Pin(side, k, (U1_PAD_IN + U1_PAD_OUT) / 2)
      const along = side % 2 === 0
      keep(p.x, p.y, along ? 0.24 : 0.085, along ? 0.085 : 0.24)
    }
  }
  for (const t of TESTPOINTS) circle(g, t.p.x, t.p.y, 0.1)
  for (const h of HOLES) circle(g, h.x, h.y, 0.34)
  for (const v of lay.vias) circle(g, v.x, v.y, 0.052)
  // via drills
  g.fillStyle = C.hole
  for (const v of lay.vias) circle(g, v.x, v.y, 0.021)

  // baked contact shadows under the parts (colour map only)
  if (map) {
    const shadow = (x: number, z: number, w: number, d: number, blur: number, a: number) => {
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.shadowColor = `rgba(0,0,0,${a})`
      g.shadowBlur = blur * s
      g.shadowOffsetX = 10000
      g.fillStyle = '#000'
      g.fillRect((x - w / 2 + W / 2) * s - 10000, (z - d / 2 + D / 2) * s, w * s, d * s)
      g.restore()
    }
    shadow(U1C.x, U1C.y, U1W * 0.98, U1W * 0.98, 0.2, 0.85)
    shadow(U2C.x, U2C.y, 0.66, 0.36, 0.08, 0.8)
    shadow(U3C.x, U3C.y, 0.4, 0.5, 0.06, 0.8)
    shadow(C1C.x, C1C.y, 0.66, 0.66, 0.14, 0.85)
    shadow(J1C.x, J1C.y, 0.9, J1_D, 0.12, 0.85)
    shadow(J2_PIN0.x + 2.5 * J2_PITCH, J2_PIN0.y, 6 * J2_PITCH, 0.26, 0.1, 0.85)
  }

  /* ---- silkscreen */
  g.fillStyle = C.silk
  g.strokeStyle = C.silk
  const lw = 0.016
  g.lineWidth = lw
  const line = (pts: [number, number][]) => {
    g.beginPath()
    pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)))
    g.stroke()
  }
  const rect = (x: number, z: number, w: number, d: number) => g.strokeRect(x - w / 2, z - d / 2, w, d)
  const txt = (str: string, x: number, z: number, size: number, o: { align?: CanvasTextAlign; weight?: number; font?: 'mono' | 'sans'; track?: number } = {}) => {
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    const fam = o.font === 'sans' ? "'Space Grotesk Variable', system-ui, sans-serif" : "'Martian Mono Variable', ui-monospace, monospace"
    g.font = `${o.weight ?? 500} ${Math.max(4, size * s).toFixed(1)}px ${fam}`
    g.textAlign = o.align ?? 'left'
    g.textBaseline = 'middle'
    if ('letterSpacing' in g && o.track) (g as unknown as { letterSpacing: string }).letterSpacing = `${(o.track * size * s).toFixed(1)}px`
    g.fillText(str, (x + W / 2) * s, (z + D / 2) * s)
    g.restore()
  }

  // U1: corner brackets outside the pads + pin-1 dot + designator
  {
    const e = U1_PAD_OUT + 0.1
    const l = 0.32
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = U1C.x + sx * e
        const cz = U1C.y + sz * e
        line([
          [cx - sx * l, cz],
          [cx, cz],
          [cx, cz - sz * l],
        ])
      }
    }
    circle(g, U1C.x - e + 0.02, U1C.y - e - 0.14, 0.05)
    txt('U1', U1C.x - e - 0.02, U1C.y + e + 0.12, 0.15, { align: 'right', weight: 600 })
  }
  // U2, U3, U4, U5, U6, Y1 outlines
  rect(U2C.x, U2C.y, 0.78, 0.86)
  rect(U3C.x, U3C.y, 0.56, 0.66)
  circle(g, U3C.x - 0.36, U3C.y - 0.4, 0.035)
  txt('U3', U3C.x, U3C.y + 0.48, 0.12, { align: 'center' })
  rect(U4C.x, U4C.y, 0.56, 0.56)
  circle(g, U4C.x - 0.34, U4C.y - 0.34, 0.03)
  txt('U4', U4C.x, U4C.y - 0.42, 0.12, { align: 'center' })
  rect(U5C.x, U5C.y, 0.66, 0.66)
  circle(g, U5C.x - 0.39, U5C.y - 0.39, 0.03)
  txt('U5', U5C.x, U5C.y + 0.47, 0.12, { align: 'center' })
  rect(U6C.x, U6C.y, 0.4, 0.4)
  txt('U6', U6C.x + 0.28, U6C.y + 0.3, 0.1, { align: 'left' })
  rect(Y1C.x, Y1C.y, 0.36, 0.44)
  txt('Y1', Y1C.x - 0.26, Y1C.y, 0.12, { align: 'right' })

  // J2: header outline, pin-1 marker, pin names, the email line
  {
    const x0 = J2_PIN0.x - J2_PITCH / 2 - 0.05
    const x1 = J2_PIN0.x + 5.5 * J2_PITCH + 0.05
    rect((x0 + x1) / 2, J2_PIN0.y, x1 - x0, 0.36)
    g.fillRect(x0 - 0.1, J2_PIN0.y - 0.18, 0.05, 0.36)
    txt('J2', x0 - 0.02, J2_PIN0.y - 0.33, 0.13, { weight: 600 })
    const names = ['TX', 'RX', 'SDA', 'SCL', 'GP0', 'GP1']
    names.forEach((n, i) => txt(n, J2_PIN0.x + i * J2_PITCH, J2_PIN0.y + 0.33, 0.075, { align: 'center', weight: 600 }))
    // the arrow + the line itself
    const ax = x1 + 0.2
    g.beginPath()
    g.moveTo(ax, J2_PIN0.y)
    g.lineTo(ax + 0.13, J2_PIN0.y - 0.075)
    g.lineTo(ax + 0.13, J2_PIN0.y + 0.075)
    g.closePath()
    g.fill()
    txt(`SAY HELLO · ${BRAND.email}`, ax + 0.26, J2_PIN0.y + 0.01, 0.2, { weight: 600 })
  }

  // J1 USB-C: courtyard + label
  rect(J1C.x, J1C.y + 0.05, 1.02, 0.86)

  // D1 PWR, D2–D5 status
  rect(D1C.x, D1C.y, 0.3, 0.18)
  g.fillRect(D1C.x + 0.15, D1C.y - 0.09, 0.03, 0.18)
  const ledNames = ['SIG', 'LINK', 'ACT', 'RDY']
  LED_X.forEach((x, i) => {
    rect(x, LED_Z, 0.18, 0.3)
    g.fillRect(x - 0.09, LED_Z - 0.18, 0.18, 0.03)
    txt(ledNames[i], x, LED_Z - 0.34, 0.085, { align: 'center', weight: 600 })
  })
  txt('D2–D5', LED_X[0] - 0.22, LED_Z, 0.09, { align: 'right' })

  // C1: can outline with its polarity
  {
    const r = 0.37
    g.beginPath()
    g.moveTo(C1C.x - r, C1C.y - r)
    g.lineTo(C1C.x + r - 0.12, C1C.y - r)
    g.lineTo(C1C.x + r, C1C.y - r + 0.12)
    g.lineTo(C1C.x + r, C1C.y + r - 0.12)
    g.lineTo(C1C.x + r - 0.12, C1C.y + r)
    g.lineTo(C1C.x - r, C1C.y + r)
    g.closePath()
    g.stroke()
    txt('+', C1C.x - r + 0.02, C1C.y - r - 0.14, 0.16, { align: 'left', weight: 600 })
    txt('C1', C1C.x - r - 0.06, C1C.y, 0.12, { align: 'right' })
  }

  // test points, holes
  for (const t of TESTPOINTS) {
    g.beginPath()
    g.arc(t.p.x, t.p.y, 0.13, 0, Math.PI * 2)
    g.stroke()
    if (!t.left) txt(t.label, t.p.x + 0.19, t.p.y, 0.085, { weight: 600 })
  }

  // the Hark mark + board name (top left)
  g.fillStyle = C.silk
  {
    const mx = -3.95
    const mz = -2.62
    const size = 0.72
    g.save()
    g.translate(mx, mz)
    g.scale(size, -size)
    g.beginPath()
    for (const sh of logoShapes()) {
      sh.getPoints(40).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
      for (const h of sh.holes) {
        h.getPoints(20).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
        g.closePath()
      }
    }
    g.fill('evenodd')
    g.restore()
    txt('Hark Digital Design', -3.42, -2.78, 0.3, { font: 'sans', weight: 600, track: -0.02 })
    txt('HK-0N · POWER ON · REV A', -3.42, -2.44, 0.12, { weight: 500 })
  }
  txt(BRAND.tagline.toUpperCase(), 0.62, -3.2, 0.12, { weight: 500 })
  txt(BRAND.locale.toUpperCase(), -3.42, -2.24, 0.085, { weight: 500 })

  // a small 2D code patch (decorative)
  {
    const r = rng(2016)
    const n = 12
    const cell = 0.034
    const x0 = 1.5
    const z0 = 2.98
    g.fillStyle = C.silk
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const edge = i === 0 || j === n - 1
        const clock = (j === 0 && i % 2 === 0) || (i === n - 1 && j % 2 === 1)
        if (edge || clock || (i > 0 && j < n - 1 && r() < 0.48)) g.fillRect(x0 + j * cell, z0 + i * cell, cell * 1.02, cell * 1.02)
      }
    }
  }

  // passives' designators (a few, like a real board)
  txt('C5', -2.78, -1.76, 0.08, { align: 'center' })
  txt('C6', -2.32, -1.76, 0.08, { align: 'center' })

  // fine speckle: the matte mask's texture (colour map only)
  if (map) {
    g.setTransform(1, 0, 0, 1, 0, 0)
    const r = rng(7)
    const n = Math.round((g.canvas.width * g.canvas.height) / 120)
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.028)' : 'rgba(0,0,0,0.12)'
      g.fillRect(r() * g.canvas.width, r() * g.canvas.height, 1 + r() * 1.5, 1 + r() * 1.5)
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
}

function strokePath(g: CanvasRenderingContext2D, pts: V2[], w: number) {
  if (pts.length < 2) return
  g.lineWidth = w
  g.beginPath()
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
  g.stroke()
}

function circle(g: CanvasRenderingContext2D, x: number, z: number, r: number) {
  g.beginPath()
  g.arc(x, z, r, 0, Math.PI * 2)
  g.fill()
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}
