import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, S, Traces, chipPackage, dieMaterial, route, silk, smdField } from '../../kit/silicon'
import { clamp, ease, lerp, rng, segment, smoothstep } from '../../core/math'
import { benchTexture, boardSilkTexture, maskTexture, scopeTexture, softDisc, softRect, waferTexture, type BoardLayout } from './textures'

/*
 * THE FAB — four stations on a perforated stainless laminar-flow bench, each
 * a tabletop macro vignette (1 unit = 1 cm, y up, front toward +z):
 *
 *   buildProbe   LISTEN     a probe card's tungsten needles touch down on a
 *                           die's bond pads; signals run out along the card to
 *                           a small scope that draws the waveform (measure first)
 *   buildLitho   PROTOTYPE  a photomask (glass + chrome pattern) over a resist-
 *                           coated wafer; a scanning slit of light sweeps toward
 *                           the camera and the pattern appears behind it
 *   buildStack   BUILD      an exploded interconnect cross-section: copper
 *                           layers (M1–M4) and their vias rise into place one
 *                           by one; each carries signal once it lands
 *   buildBurnIn  SUPPORT     a burn-in board of Hark chips in test sockets; a
 *                           pick-and-place nozzle seats the last part, then the
 *                           PASS LEDs light in sequence
 *
 * Every update takes progress values derived from scroll (never accumulated)
 * plus `time` for idle motion only.
 */

const UP = new THREE.Vector3(0, 1, 0)

/** Chapter-local materials (instanced meshes never share a material with plain meshes). */
function localMats() {
  return {
    anod: new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.4, metalness: 0.75 }),
    matte: new THREE.MeshStandardMaterial({ color: '#1b1d21', roughness: 0.62, metalness: 0.45 }),
    nickel: new THREE.MeshStandardMaterial({ color: '#b9bcc1', roughness: 0.34, metalness: 1 }),
    tungsten: new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.2, metalness: 1 }),
    goldI: new THREE.MeshStandardMaterial({ color: S.gold, roughness: 0.22, metalness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b38b48', roughness: 0.3, metalness: 1 }),
    siliconEdge: new THREE.MeshStandardMaterial({ color: '#4a4a55', roughness: 0.25, metalness: 0.8 }),
    shadow: (tex: THREE.Texture, opacity: number) =>
      new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  }
}
type Mats = ReturnType<typeof localMats>
let _m: Mats | null = null
const mats = () => (_m ??= localMats())

/** A flat plane lying in XZ at height y. */
function flat(w: number, d: number, mat: THREE.Material, y = 0.004): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat)
  m.rotation.x = -Math.PI / 2
  m.position.y = y
  return m
}

/** Instance a unit +Y cylinder from a to b. */
function strut(m: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, d: THREE.Vector3) {
  d.subVectors(b, a)
  const len = d.length()
  q.setFromUnitVectors(UP, d.multiplyScalar(1 / Math.max(len, 1e-6)))
  s.set(1, len, 1)
  m.compose(a, q, s)
}

// ------------------------------------------------------------------ bench

export interface Bench {
  mesh: THREE.Mesh
  /** centre of the light pool (world XZ) */
  focus: THREE.Vector2
}

/**
 * The perforated stainless bench. It is lit as a pool around `focus` and
 * dissolves into the backdrop beyond (no hard horizon behind the stations).
 */
export function buildBench(x0: number, x1: number): Bench {
  const W = x1 - x0
  const D = 64
  const tex = benchTexture()
  tex.repeat.set(W / 1.15, D / 1.15)
  const u = { uFocus: { value: new THREE.Vector2() }, uPool: { value: new THREE.Vector2(9, 24) } }
  const mat = new THREE.MeshStandardMaterial({ color: '#8d9197', map: tex, roughness: 0.56, metalness: 0.72, transparent: true })
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBenchW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBenchW = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uFocus, uPool;\nvarying vec2 vBenchW;')
      .replace(
        '#include <opaque_fragment>',
        `float benchD = length((vBenchW - uFocus) * vec2(0.8, 1.0));
        float pool = 1.0 - smoothstep(uPool.x, uPool.y, benchD);
        outgoingLight *= 0.35 + 0.65 * pool;
        diffuseColor.a *= pool;
        #include <opaque_fragment>`,
      )
  }
  mat.customProgramCacheKey = () => 'fab-bench'
  const mesh = flat(W, D, mat, 0)
  mesh.position.set((x0 + x1) / 2, 0, -8)
  mesh.renderOrder = -1
  return { mesh, focus: u.uFocus.value }
}

// ------------------------------------------------------------------ 1 · probe station

export interface ProbeStation {
  group: THREE.Group
  /** a world-space point on the needle tips (for the probe label) */
  tip: THREE.Vector3
  /** the scope screen centre (local) */
  screen: THREE.Vector3
  update(o: { scope: number; touch: number; listen: number; time: number; flow: number; live: number }): void
}

export function buildProbe(o: { mobile: boolean; die: THREE.CanvasTexture }): ProbeStation {
  const M = mats()
  const g = new THREE.Group()
  const WR = 7
  const DIE = 1.5
  const PITCH = 1.62
  const TOP = 0.88 // wafer top

  // chuck: an anodized base ring and a nickel-plated vacuum chuck
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7.9, 8.05, 0.14, 128), M.anod)
  base.position.y = 0.07
  const chuck = new THREE.Mesh(new THREE.CylinderGeometry(7.35, 7.35, 0.66, 128), M.nickel)
  chuck.position.y = 0.14 + 0.33
  g.add(base, chuck)

  // the wafer: grid of dies, and the one under test at full resolution
  const waferTex = waferTexture(o.mobile ? 1024 : 2048, o.die.image as CanvasImageSource, WR, PITCH, DIE)
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(WR, WR, 0.08, 160, 1, true), M.siliconEdge)
  edge.position.y = TOP - 0.04
  const wafer = flat(WR * 2, WR * 2, dieMaterial(waferTex), TOP)
  wafer.geometry.dispose()
  wafer.geometry = new THREE.CircleGeometry(WR, 160)
  const die = flat(DIE, DIE, dieMaterial(o.die), TOP + 0.0015)
  g.add(edge, wafer, die)

  // ---- the probe head (card + epoxy ring + needles) moves as one
  const head = new THREE.Group()
  g.add(head)
  const CARD_B = 2.02 // card underside (head-local, at touchdown)
  const CARD_T = CARD_B + 0.16
  const outer = new THREE.Shape()
  outer.absarc(0, 0, 5.8, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, 2.75, 0, Math.PI * 2, true)
  outer.holes.push(hole)
  const cardGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.16, bevelEnabled: false, curveSegments: 96 })
  cardGeo.rotateX(-Math.PI / 2)
  const card = new THREE.Mesh(cardGeo, [MAT.mask(), MAT.fr4()])
  card.position.y = CARD_B
  head.add(card)

  // epoxy ring the needles are set in
  const yb = CARD_B - 0.3
  const prof = [
    new THREE.Vector2(2.05, yb + 0.06),
    new THREE.Vector2(2.12, yb),
    new THREE.Vector2(2.62, yb),
    new THREE.Vector2(2.72, yb + 0.07),
    new THREE.Vector2(2.72, CARD_B),
    new THREE.Vector2(2.05, CARD_B),
  ]
  const ring = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), new THREE.MeshStandardMaterial({ color: '#2b2217', roughness: 0.35, metalness: 0.1 }))
  head.add(ring)

  // needles: one per bond pad (every other pad on phones), tip + cantilever beam
  const pads: THREE.Vector3[] = []
  const per = 28
  const step = o.mobile ? 2 : 1
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < per; i += step) {
      const along = -DIE / 2 + DIE * (0.06 + (0.88 * (i + 0.5)) / per)
      const inset = -DIE / 2 + DIE * 0.027
      const p = new THREE.Vector3()
      if (side === 0) p.set(along, TOP, inset)
      else if (side === 1) p.set(along, TOP, -inset)
      else if (side === 2) p.set(inset, TOP, along)
      else p.set(-inset, TOP, along)
      pads.push(p)
    }
  }
  const tipGeo = new THREE.CylinderGeometry(0.009, 0.0035, 1, 6, 1, true).translate(0, 0.5, 0)
  const beamGeo = new THREE.CylinderGeometry(0.0105, 0.009, 1, 6, 1, true).translate(0, 0.5, 0)
  const tips = new THREE.InstancedMesh(tipGeo, M.tungsten, pads.length)
  const beams = new THREE.InstancedMesh(beamGeo, M.tungsten, pads.length)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const sc = new THREE.Vector3()
  const dv = new THREE.Vector3()
  const dir = new THREE.Vector3()
  pads.forEach((p, i) => {
    dir.set(p.x, 0, p.z).normalize()
    const k = p.clone().addScaledVector(dir, 0.05)
    k.y += 0.13
    const rk = Math.hypot(k.x, k.z)
    const a = k.clone().addScaledVector(dir, 2.14 - rk)
    a.y = yb + 0.05
    strut(m4, p, k, q, sc, dv)
    tips.setMatrixAt(i, m4)
    strut(m4, k, a, q, sc, dv)
    beams.setMatrixAt(i, m4)
  })
  head.add(tips, beams)

  // gold pogo pads + routed traces on the card top: signals run outward
  const NP = 48
  const padGeo = new THREE.BoxGeometry(0.24, 0.014, 0.13)
  const pogo = new THREE.InstancedMesh(padGeo, M.goldI, NP)
  const paths: THREE.Vector3[][] = []
  for (let i = 0; i < NP; i++) {
    const th = (i / NP) * Math.PI * 2 + 0.03
    const r1 = 5.25
    const px = Math.cos(th) * r1
    const pz = Math.sin(th) * r1
    q.setFromAxisAngle(UP, -th)
    m4.compose(new THREE.Vector3(px, CARD_T + 0.007, pz), q, sc.set(1, 1, 1))
    pogo.setMatrixAt(i, m4)
    const th0 = th - 0.09
    const a = new THREE.Vector2(Math.cos(th0) * 2.95, Math.sin(th0) * 2.95)
    const b = new THREE.Vector2(Math.cos(th) * (r1 - 0.14), Math.sin(th) * (r1 - 0.14))
    paths.push(route(a, b, { y: CARD_T + 0.004, jog: 0.35 + (i % 3) * 0.15 }))
  }
  head.add(pogo)
  const traces = new Traces(paths, { width: 0.03, base: '#3a322b' })
  head.add(traces.group)
  // a tidy ring of 0402 decoupling caps between the traces and the pogo pads
  const NC = 24
  const capBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#8a7358', roughness: 0.55 }), NC)
  const capEnds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.052, 0.052), M.nickel, NC * 2)
  let nc = 0
  for (let i = 0; i < NC; i++) {
    const th = ((i + 0.5) / NC) * Math.PI * 2 + 0.03
    if (Math.abs(th - Math.PI / 2) < 0.35) continue // clear of the silkscreen
    q.setFromAxisAngle(UP, -th + Math.PI / 2)
    const c = new THREE.Vector3(Math.cos(th) * 4.62, CARD_T + 0.025, Math.sin(th) * 4.62)
    m4.compose(c, q, sc.set(1, 1, 1))
    capBody.setMatrixAt(nc, m4)
    const d = new THREE.Vector3(0.05, 0, 0).applyQuaternion(q)
    m4.compose(c.clone().add(d), q, sc)
    capEnds.setMatrixAt(nc * 2, m4)
    m4.compose(c.clone().sub(d), q, sc)
    capEnds.setMatrixAt(nc * 2 + 1, m4)
    nc++
  }
  capBody.count = nc
  capEnds.count = nc * 2
  head.add(capBody, capEnds)
  const lab = silk('HK-PC112 · REV A', { height: 0.2, color: '#d9d6cc' })
  lab.position.set(-1.7, CARD_T + 0.003, 3.95)
  head.add(lab)
  const pin1 = silk('▲ 1', { height: 0.16, color: '#d9d6cc' })
  pin1.position.set(2.95, CARD_T + 0.003, 0.25)
  head.add(pin1)

  // contact: a green point of light on each pad once the needles land
  const dotGeo = new THREE.CircleGeometry(0.018, 10).rotateX(-Math.PI / 2)
  const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(S.signal).multiplyScalar(3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, pads.length)
  pads.forEach((p, i) => {
    m4.makeTranslation(p.x, TOP + 0.003, p.z)
    dots.setMatrixAt(i, m4)
  })
  dots.renderOrder = 3
  g.add(dots)

  // a soft green light pool on the die while it's being measured
  const poolMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(S.signal), alphaMap: softDisc(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const pool = flat(3.6, 3.6, poolMat, TOP + 0.004)
  pool.renderOrder = 3
  g.add(pool)

  // ---- the scope: a small instrument on a post, back right
  const scope = new THREE.Group()
  const SCOPE_Y = 3.1
  const body = new THREE.Mesh(new RoundedBoxGeometry(5.4, 3.55, 0.6, 3, 0.14), M.anod)
  scope.add(body)
  const screenU = {
    uMap: { value: scopeTexture() },
    uTime: { value: 0 },
    uDraw: { value: 0 },
    uAmp: { value: 0 },
    uColor: { value: new THREE.Color(S.signal) },
  }
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(4.9, 3.06),
    new THREE.ShaderMaterial({
      uniforms: screenU,
      toneMapped: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uTime, uDraw, uAmp; uniform vec3 uColor;
        varying vec2 vUv;
        // a voice-like burst: a carrier under a slow envelope (hark = listen)
        float sig(float x) {
          float e1 = 0.5 + 0.5 * sin(x * 7.0 - uTime * 0.9);
          float e2 = 0.5 + 0.5 * sin(x * 2.3 + uTime * 0.45);
          float env = 0.12 + 0.88 * e1 * e1 * (0.35 + 0.65 * e2);
          float c = sin(x * 58.0 - uTime * 4.0) * 0.62 + sin(x * 121.0 - uTime * 7.0) * 0.24 + sin(x * 19.0 + uTime * 1.3) * 0.3;
          return c * env * 0.6 * uAmp;
        }
        void main() {
          vec3 col = texture2D(uMap, vUv).rgb;
          float gx = (vUv.x - 0.04) / 0.92;
          float gy = (vUv.y - 0.5) / 0.74;
          float inG = step(0.0, gx) * step(gx, 1.0);
          float f = sig(gx);
          float f2 = sig(gx + 0.002);
          // distance to the curve in physical units (graticule 4.5 x 2.26)
          float slope = (f2 - f) * 2.26 / (0.002 * 4.5);
          float d = abs(gy - f) * 2.26 / sqrt(1.0 + slope * slope);
          float line = 1.0 - smoothstep(0.012, 0.03, d);
          float glow = exp(-d * 22.0) * 0.35;
          float drawn = 1.0 - smoothstep(uDraw - 0.004, uDraw, gx);
          float head = exp(-abs(gx - uDraw) * 60.0) * step(0.001, uDraw) * (1.0 - step(0.999, uDraw));
          col += uColor * (line * 1.9 + glow) * drawn * inG;
          col += uColor * head * (1.0 - smoothstep(0.0, 0.08, d)) * 1.5 * inG;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  )
  screen.position.z = 0.305
  scope.add(screen)
  const postL = SCOPE_Y - 1.775 - 0.14
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, postL, 16), M.nickel)
  post.position.y = -1.775 - postL / 2
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.16, 48), M.anod)
  foot.position.y = 0.08 - SCOPE_Y
  scope.add(post, foot)
  const scopeLab = silk('HK-SCOPE 01', { height: 0.16, color: '#b9b5aa' })
  scopeLab.rotation.x = 0
  scopeLab.position.set(-2.45, -1.62, 0.305)
  scope.add(scopeLab)
  scope.position.set(8.6, SCOPE_Y, -2.6)
  scope.rotation.y = -0.31
  g.add(scope)

  // baked contact shadows
  const disc = softDisc(128, 0.55)
  const sh1 = flat(18.5, 18.5, M.shadow(disc, 0.7), 0.003)
  const sh2 = flat(3.4, 3.4, M.shadow(disc, 0.6), 0.003)
  sh2.position.set(scope.position.x, 0.003, scope.position.z)
  g.add(sh1, sh2)

  const tipLocal = new THREE.Vector3(DIE / 2 + 0.05, TOP + 0.08, 0)
  const tip = new THREE.Vector3()
  return {
    group: g,
    tip,
    screen: scope.position,
    update({ scope: showScope, touch, listen, time, flow, live }) {
      scope.visible = showScope > 0.001
      // head lifts 0.16 off the pads before touchdown (pick-and-place precise, a tiny settle)
      head.position.y = 0.16 * (1 - touch)
      const contact = smoothstep(0.88, 0.94, touch)
      dotMat.opacity = contact * (0.35 + 0.65 * listen)
      poolMat.opacity = 0.05 * contact * (0.5 + 0.5 * listen)
      traces.set({ time, flow, density: 2.4, glow: 0.5 * live * contact, offset: 0 })
      screenU.uTime.value = time
      screenU.uDraw.value = listen
      screenU.uAmp.value = contact * showScope
      g.updateMatrixWorld()
      tip.copy(tipLocal).applyMatrix4(g.matrixWorld)
    },
  }
}

// ------------------------------------------------------------------ 2 · lithography

export interface LithoStation {
  group: THREE.Group
  /** a point on the photomask (local) for the probe label */
  mark: THREE.Vector3
  update(o: { sweep: number; on: number; time: number }): void
}

export function buildLitho(o: { mobile: boolean }): LithoStation {
  const M = mats()
  const g = new THREE.Group()
  const WR = 5.4
  const L = 11.4 // pattern square (mask chrome area)
  const PLATE = 12.2
  const PITCH = 1.3
  const TOP = 0.88
  const MASK_B = TOP + 0.95
  const MASK_T = MASK_B + 0.3
  const Z0 = -6.4
  const Z1 = 6.4

  const base = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.45, 0.14, 128), M.anod)
  base.position.y = 0.07
  const chuck = new THREE.Mesh(new THREE.CylinderGeometry(5.85, 5.85, 0.66, 128), M.nickel)
  chuck.position.y = 0.47
  g.add(base, chuck)

  // resist-coated wafer; the latent image appears where the light has passed
  const maskTex = maskTexture(o.mobile ? 1024 : 2048, L, WR, PITCH)
  const wu = {
    uPattern: { value: maskTex },
    uSweep: { value: Z0 },
    uHalf: { value: L / 2 },
    uOn: { value: 0 },
    uSig: { value: new THREE.Color(S.signal) },
  }
  const resist = new THREE.MeshPhysicalMaterial({
    color: '#3a3558',
    metalness: 0.5,
    roughness: 0.24,
    iridescence: 1,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [260, 720],
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
  })
  resist.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, wu)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = position.xy;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uPattern; uniform float uSweep, uHalf, uOn; uniform vec3 uSig;\nvarying vec2 vPat;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 pUv = vec2((vPat.x + uHalf) / (2.0 * uHalf), (vPat.y + uHalf) / (2.0 * uHalf));
        float pat = texture2D(uPattern, pUv).g;
        float wz = -vPat.y;
        float passed = 1.0 - smoothstep(uSweep - 0.06, uSweep + 0.02, wz);
        float exposed = (1.0 - pat) * passed;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.43, 0.6), exposed * 0.85);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float front = exp(-abs(wz - uSweep) * 3.2) * (1.0 - smoothstep(uSweep, uSweep + 0.05, wz));
        totalEmissiveRadiance += uSig * (1.0 - pat) * front * 1.6 * uOn;
        totalEmissiveRadiance += uSig * (1.0 - pat) * passed * 0.018 * uOn;`,
      )
  }
  resist.customProgramCacheKey = () => 'fab-resist'
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(WR, WR, 0.08, 160, 1, true), M.siliconEdge)
  edge.position.y = TOP - 0.04
  const wafer = new THREE.Mesh(new THREE.CircleGeometry(WR, 160), resist)
  wafer.rotation.x = -Math.PI / 2
  wafer.position.y = TOP
  g.add(edge, wafer)

  // the photomask: chrome on the underside of a quartz plate
  const chrome = flat(L, L, new THREE.MeshStandardMaterial({ color: '#dfe2e7', metalness: 1, roughness: 0.26, alphaMap: maskTex, transparent: true, side: THREE.DoubleSide }), MASK_B + 0.004)
  chrome.renderOrder = 1
  const faceMat = new THREE.MeshPhysicalMaterial({ color: '#dbe8ea', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.07, clearcoat: 0.5, clearcoatRoughness: 0.08, envMapIntensity: 0.9, depthWrite: false })
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#a8d4cb', metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false })
  const plate = new THREE.Mesh(new THREE.BoxGeometry(PLATE, MASK_T - MASK_B, PLATE), [edgeMat, edgeMat, faceMat, faceMat, edgeMat, edgeMat])
  plate.position.y = (MASK_B + MASK_T) / 2
  plate.renderOrder = 2
  g.add(chrome, plate)

  // mask holder: a frame under the plate edges on four posts
  const hold: THREE.BufferGeometry[] = []
  const bw = 0.55
  for (const sgn of [-1, 1]) {
    hold.push(new THREE.BoxGeometry(PLATE + 0.7, 0.24, bw).translate(0, MASK_B - 0.12, sgn * (PLATE / 2 - 0.1)))
    hold.push(new THREE.BoxGeometry(bw, 0.24, PLATE + 0.7).translate(sgn * (PLATE / 2 - 0.1), MASK_B - 0.12, 0))
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) hold.push(new THREE.CylinderGeometry(0.22, 0.26, MASK_B - 0.24, 20).translate(sx * (PLATE / 2 + 0.1), (MASK_B - 0.24) / 2, sz * (PLATE / 2 + 0.1)))
  const holder = new THREE.Mesh(mergeGeometries(hold)!, M.anod)
  hold.forEach(h => h.dispose())
  g.add(holder)

  // the scanner gantry: two rails and the slit bar that travels toward the camera
  const RAIL_Y = MASK_T + 1.9
  const gan: THREE.BufferGeometry[] = []
  for (const sx of [-1, 1]) {
    gan.push(new THREE.BoxGeometry(0.34, 0.3, 15.4).translate(sx * 7.4, RAIL_Y, 0))
    for (const sz of [-1, 1]) gan.push(new THREE.BoxGeometry(0.4, RAIL_Y, 0.4).translate(sx * 7.4, RAIL_Y / 2, sz * 7.4))
  }
  const gantry = new THREE.Mesh(mergeGeometries(gan)!, M.matte)
  gan.forEach(h => h.dispose())
  g.add(gantry)
  const bar = new THREE.Group()
  const barBody = new THREE.Mesh(new RoundedBoxGeometry(15.2, 0.36, 0.62, 2, 0.06), M.matte)
  barBody.position.y = RAIL_Y + 0.28
  const slitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4fbff').multiplyScalar(4), toneMapped: false })
  const slit = flat(L + 0.4, 0.07, slitMat, RAIL_Y + 0.095)
  slit.rotation.x = Math.PI / 2
  const barLab = silk('SCAN · 365 NM', { height: 0.17, color: '#b9b5aa' })
  barLab.position.set(-7.0, RAIL_Y + 0.465, 0.1)
  bar.add(barBody, slit, barLab)
  g.add(bar)

  // the light: a curtain from the slit down to the wafer, a band on the mask
  const sheetU = { uI: { value: 0 } }
  const sheetH = RAIL_Y + 0.09 - TOP
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(L + 0.3, sheetH),
    new THREE.ShaderMaterial({
      uniforms: sheetU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uI; varying vec2 vUv;
        void main() {
          float x = 1.0 - smoothstep(0.42, 0.5, abs(vUv.x - 0.5));
          float y = 0.35 + 0.65 * vUv.y;
          gl_FragColor = vec4(vec3(0.82, 0.92, 1.0) * x * y * y * 0.055 * uI, 1.0);
        }
      `,
    }),
  )
  sheet.position.y = TOP + sheetH / 2
  sheet.renderOrder = 4
  const bandMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#eaf6ff').multiplyScalar(1.1), alphaMap: softRect(256, 64, 0.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const band = flat(L + 0.4, 0.9, bandMat, MASK_T + 0.003)
  band.renderOrder = 4
  g.add(sheet, band)

  const disc = softDisc(128, 0.55)
  const rect = softRect(256, 256, 0.14)
  g.add(flat(14, 14, M.shadow(disc, 0.7), 0.003), flat(17, 17, M.shadow(rect, 0.45), 0.002))

  return {
    group: g,
    mark: new THREE.Vector3(4.6, MASK_T, -3.4),
    update({ sweep, on }) {
      const z = lerp(Z0, Z1, sweep)
      bar.position.z = z
      sheet.position.z = z
      band.position.z = z
      const live = on * smoothstep(0, 0.04, sweep) * (1 - smoothstep(0.96, 1, sweep))
      sheetU.uI.value = live
      bandMat.opacity = 0.16 * live
      slitMat.color.set('#f4fbff').multiplyScalar(0.6 + 3.4 * live)
      wu.uSweep.value = z
      wu.uOn.value = live
    },
  }
}

// ------------------------------------------------------------------ 3 · interconnect stack

export interface StackStation {
  group: THREE.Group
  /** layer label anchors (local, left-front corner of each layer at rest) */
  labels: THREE.Vector3[]
  /** current (animated) offset of each layer from its rest height */
  drop: number[]
  /** rest heights of the layers (bottoms) */
  levels: number[]
  update(o: { rise: number[]; glow: number; time: number; flow: number }): void
}

/** Copper with signal pulses racing along its length (per-instance phase). */
function pulseCopper(axis: 'x' | 'z') {
  const u = { uTime: { value: 0 }, uGlow: { value: 0 }, uFlow: { value: 4 }, uSig: { value: new THREE.Color(S.signal) } }
  const mat = new THREE.MeshStandardMaterial({ color: '#c47a42', metalness: 0.9, roughness: 0.34, transparent: true })
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAlong; varying float vSeed; varying float vTop;').replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 pw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        pw = instanceMatrix * pw;
        vSeed = fract(float(gl_InstanceID) * 0.6180339);
      #else
        vSeed = 0.0;
      #endif
      vAlong = (modelMatrix * pw).${axis};
      vTop = normal.y;`,
    )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uGlow, uFlow; uniform vec3 uSig; varying float vAlong; varying float vSeed; varying float vTop;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float ph = fract((vAlong - uTime * uFlow) / 9.0 + vSeed);
        float tail = smoothstep(0.9, 0.98, ph);
        float pulse = tail * tail * (1.0 - smoothstep(0.98, 0.996, ph));
        totalEmissiveRadiance += uSig * pulse * (0.3 + 1.5 * smoothstep(0.5, 0.9, vTop)) * uGlow;`,
      )
  }
  mat.customProgramCacheKey = () => `fab-pulse-${axis}`
  return { mat, u }
}

export function buildStack(o: { die: THREE.CanvasTexture }): StackStation {
  const M = mats()
  const g = new THREE.Group()
  const r = rng(23)
  // plinth + substrate (the die's floorplan on top)
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(7.8, 0.5, 7.8, 2, 0.06), M.anod)
  plinth.position.y = 0.25
  const side = new THREE.MeshStandardMaterial({ color: '#2b2a33', roughness: 0.42, metalness: 0.45 })
  const sub = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.9, 6.4), [side, side, dieMaterial(o.die), side, side, side])
  sub.position.y = 0.5 + 0.45
  g.add(plinth, sub)
  const SUB_T = 1.4
  // polysilicon gates (along z)
  const gates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.12, 5.6), new THREE.MeshStandardMaterial({ color: '#6e5a55', roughness: 0.4, metalness: 0.3 }), 22)
  const m4 = new THREE.Matrix4()
  const gx: number[] = []
  for (let i = 0; i < 22; i++) {
    const x = (i - 10.5) * 0.26
    gx.push(x)
    m4.makeTranslation(x, SUB_T + 0.06, 0)
    gates.setMatrixAt(i, m4)
  }
  g.add(gates)

  const H = [0.14, 0.2, 0.3, 0.45]
  const Wd = [0.13, 0.2, 0.34, 0.54]
  const P = [0.4, 0.56, 0.85, 1.45]
  const N = [14, 10, 7, 4]
  const AX: ('x' | 'z')[] = ['x', 'z', 'x', 'z']
  const GAP = 0.95
  const levels: number[] = []
  let y = SUB_T + 0.12 + 0.72
  for (let k = 0; k < 4; k++) {
    levels.push(y)
    y += H[k] + GAP
  }
  type Seg = { across: number; a: number; b: number }
  const segs: Seg[][] = []
  const layers: { grp: THREE.Group; line: ReturnType<typeof pulseCopper>; via: THREE.MeshStandardMaterial; ild: THREE.MeshStandardMaterial; edgeMat: THREE.LineBasicMaterial }[] = []
  const labels: THREE.Vector3[] = []
  const half = 2.95
  for (let k = 0; k < 4; k++) {
    const list: Seg[] = []
    for (let i = 0; i < N[k]; i++) {
      const across = (i - (N[k] - 1) / 2) * P[k]
      // 1–3 segments per track, with gaps (real routing, not a comb)
      let a = -half + r() * 0.5
      const nseg = k === 3 ? 1 : 1 + Math.floor(r() * 3)
      for (let s = 0; s < nseg; s++) {
        const remaining = half - a
        const len = s === nseg - 1 ? remaining - r() * 0.4 : remaining * (0.3 + r() * 0.4)
        if (len > 0.4) list.push({ across, a, b: a + len })
        a += len + 0.3 + r() * 0.4
        if (a > half - 0.4) break
      }
    }
    segs.push(list)
    const grp = new THREE.Group()
    const line = pulseCopper(AX[k])
    const lines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), line.mat, list.length)
    list.forEach((s, i) => {
      const mid = (s.a + s.b) / 2
      const len = s.b - s.a
      if (AX[k] === 'x') m4.compose(new THREE.Vector3(mid, 0, s.across), new THREE.Quaternion(), new THREE.Vector3(len, H[k], Wd[k]))
      else m4.compose(new THREE.Vector3(s.across, 0, mid), new THREE.Quaternion(), new THREE.Vector3(Wd[k], H[k], len))
      lines.setMatrixAt(i, m4)
    })
    grp.add(lines)
    // vias hanging from this layer down to the one below (contacts to the gates for M1)
    const vias: THREE.Matrix4[] = []
    if (k === 0) {
      for (const s of list)
        for (const x of gx) {
          if (x < s.a + 0.05 || x > s.b - 0.05 || r() > 0.16) continue
          const h = levels[0] - (SUB_T + 0.12)
          vias.push(new THREE.Matrix4().compose(new THREE.Vector3(x, -h, s.across), new THREE.Quaternion(), new THREE.Vector3(0.06, h, 0.06)))
        }
    } else {
      const below = segs[k - 1]
      const topB = levels[k - 1] + H[k - 1]
      const h = levels[k] - topB
      const w = Math.min(Wd[k], Wd[k - 1]) * 0.72
      for (const s of list)
        for (const b of below) {
          // this track runs along AX[k] at s.across; the one below runs across it at b.across
          const along = b.across
          const cross = s.across
          if (along < s.a + w || along > s.b - w) continue
          if (cross < b.a + w || cross > b.b - w) continue
          if (r() > 0.34) continue
          const px = AX[k] === 'x' ? along : cross
          const pz = AX[k] === 'x' ? cross : along
          vias.push(new THREE.Matrix4().compose(new THREE.Vector3(px, -h, pz), new THREE.Quaternion(), new THREE.Vector3(w, h, w)))
        }
    }
    const via = new THREE.MeshStandardMaterial({ color: '#b8ada0', roughness: 0.42, metalness: 0.9, transparent: true })
    if (vias.length) {
      const vm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), via, vias.length)
      vias.forEach((m, i) => vm.setMatrixAt(i, m))
      grp.add(vm)
    }
    // the inter-layer dielectric this layer sits on: a faint glass plate with lit edges
    const ild = new THREE.MeshStandardMaterial({ color: '#d7e0e6', transparent: true, opacity: 0.08, roughness: 0.12, metalness: 0.1, depthWrite: false })
    const slabGeo = new THREE.BoxGeometry(6.3, 0.03, 6.3)
    const slab = new THREE.Mesh(slabGeo, ild)
    slab.position.y = -0.016
    slab.renderOrder = 2
    const edgeMat = new THREE.LineBasicMaterial({ color: '#ffe7b8', transparent: true, opacity: 0.3, depthWrite: false })
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), edgeMat)
    edges.position.y = -0.016
    grp.add(slab, edges)
    grp.position.y = levels[k]
    g.add(grp)
    layers.push({ grp, line, via, ild, edgeMat })
    labels.push(new THREE.Vector3(-3.15, levels[k] + H[k] / 2, 3.15))
  }

  const disc = softRect(256, 256, 0.16)
  g.add(flat(10.5, 10.5, M.shadow(disc, 0.65), 0.003))

  const drop = [0, 0, 0, 0]
  return {
    group: g,
    labels,
    levels,
    drop,
    update({ rise, glow, time, flow }) {
      for (let k = 0; k < 4; k++) {
        const L = layers[k]
        const t = clamp(rise[k])
        // rises from the layer below and lands with a tiny settle
        const e = t < 0.82 ? ease.outCubic(t / 0.82) * 1.012 : lerp(1.012, 1, smoothstep(0.82, 1, t))
        drop[k] = -(1 - e) * 1.05
        L.grp.position.y = levels[k] + drop[k]
        L.grp.visible = t > 0.001
        const op = smoothstep(0, 0.4, t)
        L.line.mat.opacity = op
        L.via.opacity = op
        L.ild.opacity = 0.08 * op
        L.edgeMat.opacity = 0.3 * op
        L.line.u.uTime.value = time
        L.line.u.uFlow.value = flow * (k % 2 ? -1 : 1) * (1 + k * 0.25)
        L.line.u.uGlow.value = glow * smoothstep(0.85, 1, t)
      }
    },
  }
}

// ------------------------------------------------------------------ 4 · burn-in

export interface BurnInStation {
  group: THREE.Group
  /** LED world positions for labels */
  leds: THREE.Vector3[]
  update(o: { place: number; pass: number[]; time: number; flow: number; live: number }): void
}

export function buildBurnIn(o: { mobile: boolean }): BurnInStation {
  const M = mats()
  const g = new THREE.Group()
  const BW = 15
  const BD = 10
  const BOARD_B = 0.55
  const TH = 0.16
  const BT = BOARD_B + TH
  const cols = [-5.0, -1.67, 1.67, 5.0]
  const rows = [-2.0, 1.65]
  const sockets: THREE.Vector2[] = []
  for (const z of rows) for (const x of cols) sockets.push(new THREE.Vector2(x, z))
  const SOCK = 2.02
  const leds = sockets.map(c => new THREE.Vector2(c.x - 0.8, c.y + 1.45))
  const layout: BoardLayout = { w: BW, d: BD, sockets, socket: SOCK, leds }

  // board on brass standoffs
  const board = new THREE.Mesh(new THREE.BoxGeometry(BW, TH, BD), [MAT.fr4(), MAT.fr4(), MAT.mask(), MAT.mask(), MAT.fr4(), MAT.fr4()])
  board.position.y = BOARD_B + TH / 2
  g.add(board)
  const so: THREE.BufferGeometry[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) so.push(new THREE.CylinderGeometry(0.28, 0.28, BOARD_B, 6).translate(sx * (BW / 2 - 0.5), BOARD_B / 2, sz * (BD / 2 - 0.5)))
  const standoffs = new THREE.Mesh(mergeGeometries(so)!, M.brass)
  so.forEach(s => s.dispose())
  g.add(standoffs)
  const silkMat = new THREE.MeshStandardMaterial({ color: '#f1f0ea', map: boardSilkTexture(layout, o.mobile ? 72 : 136), transparent: true, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  const silkPlane = flat(BW, BD, silkMat, BT + 0.004)
  silkPlane.renderOrder = 1
  g.add(silkPlane)

  // gold edge fingers along the back edge
  const NF = 44
  const fingers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.17, 0.012, 0.78), M.goldI, NF)
  const m4 = new THREE.Matrix4()
  const fx: number[] = []
  for (let i = 0; i < NF; i++) {
    const x = -6.3 + (12.6 * i) / (NF - 1)
    fx.push(x)
    m4.makeTranslation(x, BT + 0.006, -BD / 2 + 0.47)
    fingers.setMatrixAt(i, m4)
  }
  g.add(fingers)

  // traces: each socket's right side → the column gap → the edge connector
  const paths: THREE.Vector3[][] = []
  const used = new Set<number>()
  const yT = BT + 0.003
  sockets.forEach((c, si) => {
    const row = si < 4 ? 0 : 1
    for (let j = 0; j < 3; j++) {
      const y0 = c.y - 0.45 + j * 0.45
      const gxl = c.x + 1.36 + (row * 3 + (2 - j)) * 0.105
      let best = 0
      let bd = Infinity
      fx.forEach((x, i) => {
        const d = Math.abs(x - gxl)
        if (!used.has(i) && d < bd) {
          bd = d
          best = i
        }
      })
      used.add(best)
      const f = fx[best]
      const cc = 0.18
      const zEnd = -BD / 2 + 0.88
      paths.push([
        new THREE.Vector3(c.x + 1.0, yT, y0),
        new THREE.Vector3(gxl - cc, yT, y0),
        new THREE.Vector3(gxl, yT, y0 - cc),
        new THREE.Vector3(gxl, yT, zEnd + Math.abs(f - gxl)),
        new THREE.Vector3(f, yT, zEnd),
      ])
    }
  })
  const traces = new Traces(paths, { width: 0.05, base: '#2e3238' })
  g.add(traces.group)

  // tiny passives around the sockets
  const smd = smdField({
    x0: -7,
    z0: -3.9,
    x1: 7,
    z1: 4.2,
    count: o.mobile ? 60 : 120,
    seed: 31,
    avoid: (x, z) => {
      for (const c of sockets) if (Math.abs(x - c.x) < 1.45 && Math.abs(z - c.y) < 1.45) return true
      for (const l of leds) if (Math.abs(x - l.x - 0.4) < 0.75 && Math.abs(z - l.y) < 0.3) return true
      if (z > 3.6 && x < -1.5) return true
      if (z > 3.3 && x > 5.2) return true
      return false
    },
  })
  smd.position.y = BT
  g.add(smd)

  // test sockets (PEEK) — a floor and four walls around a pocket
  const W2 = SOCK / 2
  const wall = 0.22
  const WH = 0.3
  const sg = mergeGeometries([
    new THREE.BoxGeometry(SOCK, 0.1, SOCK).translate(0, 0.05, 0),
    new THREE.BoxGeometry(SOCK, WH, wall).translate(0, WH / 2, -W2 + wall / 2),
    new THREE.BoxGeometry(SOCK, WH, wall).translate(0, WH / 2, W2 - wall / 2),
    new THREE.BoxGeometry(wall, WH, SOCK - 2 * wall).translate(-W2 + wall / 2, WH / 2, 0),
    new THREE.BoxGeometry(wall, WH, SOCK - 2 * wall).translate(W2 - wall / 2, WH / 2, 0),
  ])!
  const sockMesh = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: '#ad9a7a', roughness: 0.6, metalness: 0 }), sockets.length)
  sockets.forEach((c, i) => {
    m4.makeTranslation(c.x, BT, c.y)
    sockMesh.setMatrixAt(i, m4)
  })
  g.add(sockMesh)

  // the Hark chips, instanced from one kit package
  const pkg = chipPackage({ w: 1.5, h: 0.17, kind: 'qfn', pinsPerSide: 10, lines: ['HK-0N', 'REV A'] })
  const pBody = pkg.children[0] as THREE.Mesh
  const pTop = pkg.userData.top as THREE.Mesh
  const bodyGeo = (pBody.geometry as THREE.BufferGeometry).clone().translate(0, pBody.position.y, 0)
  const topGeo = (pTop.geometry as THREE.BufferGeometry).clone().rotateX(-Math.PI / 2).translate(0, pTop.position.y, 0)
  const chipBody = new THREE.InstancedMesh(bodyGeo, (pBody.material as THREE.Material).clone(), sockets.length)
  const chipTop = new THREE.InstancedMesh(topGeo, pTop.material as THREE.Material, sockets.length)
  const SEAT = BT + 0.1
  const chipAt = (i: number, y: number) => {
    m4.makeTranslation(sockets[i].x, y, sockets[i].y)
    chipBody.setMatrixAt(i, m4)
    chipTop.setMatrixAt(i, m4)
  }
  sockets.forEach((_, i) => chipAt(i, SEAT))
  g.add(chipBody, chipTop)

  // pick-and-place nozzle (seats the last part)
  const LAST = 6 // U7: seated last, in full view
  const nozzle = new THREE.Group()
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.14, 24), new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.7 }))
  cup.position.y = 0.07
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 20), M.nickel)
  tube.position.y = 0.14 + 1.6
  const headBlock = new THREE.Mesh(new RoundedBoxGeometry(1.1, 1.4, 1.1, 2, 0.1), M.anod)
  headBlock.position.y = 0.14 + 3.2 + 0.7
  nozzle.add(cup, tube, headBlock)
  nozzle.position.set(sockets[LAST].x, 0, sockets[LAST].y)
  g.add(nozzle)

  // PASS LEDs (0603) and the green light they throw on the mask
  const ledMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.09, 0.13), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), leds.length)
  const poolMat = new THREE.MeshBasicMaterial({ color: '#ffffff', alphaMap: softDisc(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2), poolMat, leds.length)
  poolMesh.renderOrder = 3
  const off = new THREE.Color('#1a2320')
  const on = new THREE.Color(S.signal).multiplyScalar(3.2)
  const pool = new THREE.Color(S.signal).multiplyScalar(0.11)
  const tmpC = new THREE.Color()
  leds.forEach((l, i) => {
    m4.makeTranslation(l.x, BT + 0.045, l.y)
    ledMesh.setMatrixAt(i, m4)
    m4.makeTranslation(l.x, BT + 0.006, l.y)
    poolMesh.setMatrixAt(i, m4)
    ledMesh.setColorAt(i, off)
    poolMesh.setColorAt(i, tmpC.setRGB(0, 0, 0))
  })
  g.add(ledMesh, poolMesh)

  const rect = softRect(256, 256, 0.12)
  g.add(flat(BW + 2.2, BD + 2.2, M.shadow(rect, 0.7), 0.003))

  const ledWorld = leds.map(l => new THREE.Vector3(l.x, BT + 0.1, l.y))
  const lastPass = new Array(leds.length).fill(-1)

  return {
    group: g,
    leds: ledWorld,
    update({ place, pass, time, flow, live }) {
      // nozzle: down fast and precise, seat (tiny settle), release, lift clear
      const down = ease.inOutCubic(segment(place, 0, 0.45))
      const settle = Math.sin(Math.PI * segment(place, 0.45, 0.6)) * 0.012
      const up = ease.inOutCubic(segment(place, 0.62, 1))
      const carry = SEAT + lerp(4.2, 0, down) - settle
      chipAt(LAST, place < 0.6 ? carry : SEAT)
      chipBody.instanceMatrix.needsUpdate = true
      chipTop.instanceMatrix.needsUpdate = true
      nozzle.position.y = (place < 0.6 ? carry + 0.17 : SEAT + 0.17) + up * 5.5
      nozzle.visible = place < 0.999
      let dirty = false
      for (let i = 0; i < pass.length; i++) {
        const v = Math.round(clamp(pass[i]) * 100)
        if (v === lastPass[i]) continue
        lastPass[i] = v
        dirty = true
        ledMesh.setColorAt(i, tmpC.copy(off).lerp(on, v / 100))
        poolMesh.setColorAt(i, tmpC.copy(pool).multiplyScalar(v / 100))
      }
      if (dirty) {
        ledMesh.instanceColor!.needsUpdate = true
        poolMesh.instanceColor!.needsUpdate = true
      }
      traces.set({ time, flow, density: 2.6, glow: 0.7 * live })
      // the PASS lights breathe, slowly (well under 1 Hz)
      poolMat.opacity = 0.85 + 0.15 * Math.sin(time * 1.3)
    },
  }
}

// ------------------------------------------------------------------ foreground bokeh

export interface ForeBokeh {
  mesh: THREE.Mesh
  set(o: { time: number; intensity: number; color: THREE.Color }): void
}

/**
 * Out-of-focus lights between the lens and the bench (macro depth of field):
 * soft hexagonal discs that slide across the frame as the camera dollies.
 * One draw call; billboarded in the vertex shader; they fade as they near
 * the lens so none ever fills the frame.
 */
export function buildBokeh(x0: number, x1: number, count = 16): ForeBokeh {
  const r = rng(77)
  const corner = [-1, -1, 1, -1, 1, 1, -1, 1]
  const pos: number[] = []
  const cen: number[] = []
  const size: number[] = []
  const seed: number[] = []
  const idx: number[] = []
  for (let i = 0; i < count; i++) {
    const cx = lerp(x0, x1, (i + r()) / count)
    const cy = 1.2 + r() * 4.5
    const cz = 4.5 + r() * 5
    const s = 0.35 + r() * 0.8
    const sd = r()
    for (let k = 0; k < 4; k++) {
      pos.push(corner[k * 2], corner[k * 2 + 1], 0)
      cen.push(cx, cy, cz)
      size.push(s)
      seed.push(sd)
    }
    const v = i * 4
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(cen, 3))
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
  g.setIndex(idx)
  const u = { uTime: { value: 0 }, uI: { value: 0 }, uColor: { value: new THREE.Color('#ffd28a') } }
  const mesh = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute vec3 aCenter; attribute float aSize; attribute float aSeed;
        uniform float uTime;
        varying vec2 vC; varying float vSeed; varying float vDepth;
        void main() {
          vec3 c = aCenter + vec3(sin(uTime * 0.07 + aSeed * 6.28) * 0.25, cos(uTime * 0.05 + aSeed * 4.0) * 0.15, 0.0);
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * aSize;
          vC = position.xy;
          vSeed = aSeed;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uI; uniform vec3 uColor;
        varying vec2 vC; varying float vSeed; varying float vDepth;
        float hexd(vec2 p) { p = abs(p); return max(dot(p, vec2(0.8660254, 0.5)), p.y); }
        void main() {
          float d = hexd(vC);
          float disc = 1.0 - smoothstep(0.8, 0.95, d);
          float rim = smoothstep(0.62, 0.9, d) * disc;
          float a = disc * 0.55 + rim * 0.45;
          // fade near the lens (never a frame-filling blob) and far away (in focus = invisible)
          a *= smoothstep(1.2, 3.5, vDepth) * (1.0 - smoothstep(16.0, 30.0, vDepth));
          a *= 0.6 + 0.4 * vSeed;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * a * uI, 1.0);
        }
      `,
    }),
  )
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  return {
    mesh,
    set({ time, intensity, color }) {
      u.uTime.value = time
      u.uI.value = intensity
      u.uColor.value.copy(color)
    },
  }
}
