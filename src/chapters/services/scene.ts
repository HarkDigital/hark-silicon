import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, S, bondWires, dieMaterial } from '../../kit/silicon'
import { SERVICES } from '../../content'
import { nextFrame } from '../../core/yield'
import { BLOCKS, CORE0, CORE1, DIE, INDUCTOR, PADS, PAD_IN, drawDetail, drawDetailNormals, drawDieMap, drawLabel, drawLid, drawThickness, padUV, spiralPoints, uvToWorld } from './die'
import { Bus, chamfer, type BusPath } from './bus'

/*
 * INSIDE THE CHIP — the decapped Hark package, built at "macro" scale
 * (the die is 10 units across):
 *
 *   board (solder mask) ─ gull-wing leads ─ black epoxy body with a cavity
 *   └ bond shelf with gold leadframe fingers (fanned)
 *     └ silver die paddle ─ die-attach fillet ─ THE DIE (iridescent floorplan,
 *       eleven blocks) ─ 104 gold bond wires with ball + stitch bonds
 *   the lid: the etched Hark top, lifted away in the intro
 *
 * The die's top face uses the kit's iridescent dieMaterial with this
 * chapter's floorplan, a thin-film thickness map, and a small shader patch:
 * crisp analytic block outlines + corner brackets that light signal-green
 * per block (uLit), a faint powered wash inside a lit block, and a macro
 * depth-of-field falloff (the map blurs by mip bias away from the focus
 * distance, and the surface goes satin there).
 */

export const DIE_H = 0.3
/** die top (world y) */
export const DT = 0.36
export const SHELF_Y = 0.42
export const WALL_TOP = 1.2
export const PKG = 10
export const SHELF_IN = 6.0
export const WALL_IN = 8.1
export const BOARD_Y = -1.45
const PKG_BOTTOM = -1.25
const CAV_FLOOR = -0.06
const LID_H = 0.45

export interface DieUniforms {
  uRect: { value: THREE.Vector4[] }
  uLit: { value: number[] }
  uFocus: { value: number }
  uAperture: { value: number }
  uSig: { value: THREE.Color }
  uGlow: { value: number }
  uLine: { value: number }
  uBreath: { value: number }
  uTime: { value: number }
  uDetail: { value: THREE.Texture | null }
}

export interface Label {
  mesh: THREE.Mesh
  u: { uMap: { value: THREE.Texture }; uColor: { value: THREE.Color }; uOpacity: { value: number }; uBias: { value: number } }
  center: THREE.Vector3
}

export interface DieScene {
  root: THREE.Group
  lid: THREE.Group
  dieU: DieUniforms
  labels: Label[]
  bus: Bus
  /** bus path index of the link INTO block k */
  links: number[]
  /** world centre of each block on the die top */
  centers: THREE.Vector3[]
  /** world corners (4) of each block on the die top */
  corners: THREE.Vector3[][]
  wires: THREE.Mesh
  /** the die top's material (its studio rotates with the rig) */
  dieTop: THREE.MeshPhysicalMaterial
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

function canvasTexture(cv: HTMLCanvasElement, srgb: boolean, aniso: number) {
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  cv.addEventListener('repaint', () => (t.needsUpdate = true))
  return t
}

function labelMaterial(tex: THREE.Texture) {
  const u = {
    uMap: { value: tex as THREE.Texture },
    uColor: { value: new THREE.Color('#bdb5a0') },
    uOpacity: { value: 0.8 },
    uBias: { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity, uBias;
      varying vec2 vUv;
      void main() {
        float a = texture2D(uMap, vUv, uBias).a * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  })
  return { mat, u }
}

/** the die's top-face material: kit dieMaterial + floorplan + thin film + block light + macro DOF */
function dieTopMaterial(map: THREE.Texture, thick: THREE.Texture, U: DieUniforms) {
  const m = dieMaterial(map)
  m.iridescenceThicknessMap = thick
  m.iridescenceThicknessRange = [200, 520]
  // silicon is ~30% reflective (IOR ≈ 3.9): a strong dielectric specular that the film colours
  m.metalness = 0.3
  m.roughness = 0.24
  m.ior = 2.3
  m.specularIntensity = 1
  m.specularColor = new THREE.Color(2, 2, 2)
  m.clearcoat = 0.25
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U)
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform vec4 uRect[${BLOCKS.length}];
        uniform float uLit[${BLOCKS.length}];
        uniform float uFocus, uAperture, uGlow, uLine, uBreath, uTime;
        uniform vec3 uSig;
        uniform sampler2D uDetail;
        float sdHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        // macro depth of field: sharp within ±12% of the focus distance, then falling off
        float sdDef = clamp((abs(vViewPosition.z - uFocus) / max(uFocus, 0.001) - 0.12) * uAperture, 0.0, 1.0);
        vec4 sampledDiffuseColor = texture2D(map, vMapUv, sdDef * 4.5);
        float sdCore = step(${CORE0.toFixed(3)}, vMapUv.x) * step(vMapUv.x, ${CORE1.toFixed(3)}) * step(${CORE0.toFixed(3)}, vMapUv.y) * step(vMapUv.y, ${CORE1.toFixed(3)});
        float sdDet = texture2D(uDetail, vMapUv * 14.0, sdDef * 4.5).r;
        sampledDiffuseColor.rgb *= mix(1.0, 0.5 + sdDet, 0.5 * sdCore);
        diffuseColor *= sampledDiffuseColor;`,
      )
      .replace('#include <roughnessmap_fragment>', /* glsl */ `float roughnessFactor = min(1.0, roughness + sdDef * 0.3);`)
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec2 dUv = vMapUv;
          vec2 fw = fwidth(dUv);
          float px = max(max(fw.x, fw.y), 1e-6);
          float soft = 1.0 + sdDef * 8.0;
          // sparse cells flickering with activity inside a powered block (fade out when sub-pixel)
          vec2 cell = floor(dUv * vec2(170.0, 820.0));
          float ch = sdHash(cell);
          float act = step(0.994, ch) * (0.5 + 0.5 * sin(uTime * (0.5 + ch * 1.1) + ch * 40.0)) * (1.0 - smoothstep(0.0012, 0.0026, px));
          vec3 em = vec3(0.0);
          for (int k = 0; k < ${BLOCKS.length}; k++) {
            vec4 r = uRect[k];
            vec2 c = (r.xy + r.zw) * 0.5;
            vec2 hs = (r.zw - r.xy) * 0.5;
            vec2 q = abs(dUv - c) - hs;
            float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
            // screen-space line width (1.4 px, softer out of focus)
            float aa = max(fwidth(sd), 1e-6);
            float pxd = abs(sd) / aa;
            float line = 1.0 - smoothstep(0.35 * soft, 1.1 * soft, pxd);
            vec2 cq = abs(dUv - c) / hs;
            float corner = step(0.9, cq.x) * step(0.9, cq.y);
            float bracket = (1.0 - smoothstep(1.2 * soft, 2.2 * soft, abs(sd + 1.2 * aa) / aa)) * corner;
            float inside = 1.0 - smoothstep(-0.0005, 0.0005, sd);
            float halo = exp(-abs(sd) * 320.0) * (1.0 - inside);
            float L = uLit[k];
            em += uSig * L * (line * 1.25 + bracket * 1.9 + halo * 0.12 + inside * act * (0.28 + 0.14 * uBreath));
            em += vec3(0.78, 0.82, 0.95) * uLine * (line + bracket * 0.6) * (1.0 - L);
          }
          totalEmissiveRadiance += em * uGlow * (1.0 - 0.6 * sdDef);
        }`,
      )
  }
  m.customProgramCacheKey = () => 'hark-silicon-die-top'
  return m
}

/**
 * Gold for the bond wires, faded where they fall out of focus: a thin wire
 * blurred by a macro lens spreads into a faint glint, so near and far wires
 * read soft while the die in focus stays crisp.
 */
function defocusGold(U: DieUniforms) {
  const m = new THREE.MeshStandardMaterial({ color: S.gold, roughness: 0.22, metalness: 1, transparent: true })
  m.onBeforeCompile = sh => {
    sh.uniforms.uFocus = U.uFocus
    sh.uniforms.uAperture = U.uAperture
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFocus, uAperture;')
      .replace(
        '#include <opaque_fragment>',
        `float wDef = clamp((abs(vViewPosition.z - uFocus) / max(uFocus, 0.001) - 0.15) * uAperture * 1.3, 0.0, 1.0);
        diffuseColor.a *= 1.0 - 0.72 * wDef;
        #include <opaque_fragment>`,
      )
  }
  m.customProgramCacheKey = () => 'hark-silicon-wire'
  return m
}

/**
 * The die's own reflection studio (PMREM, built once): a macro rig lights
 * silicon from low and behind, so the surface carries a broad soft sheen —
 * that sheen is where the thin film shows its colours. A large warm-white
 * softbox behind, a cool strip to the right, a warm gold card low left, a
 * dim overhead. The chapter rotates it (envMapRotation) as the rig moves.
 */
function dieStudio(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new THREE.Scene()
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(10, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        float band(float x, float c, float w) { return 1.0 - smoothstep(w * 0.45, w, abs(x - c)); }
        void main() {
          vec3 d = normalize(vDir);
          float el = asin(clamp(d.y, -1.0, 1.0));
          float az = atan(d.x, -d.z);
          vec3 col = vec3(0.012, 0.013, 0.02);
          // low behind: grazing reflections put a sheen on the far part of the frame
          col += vec3(1.0, 0.95, 0.88) * 1.0 * band(az, -0.1, 0.7) * band(el, 0.26, 0.24);
          col += vec3(0.55, 0.72, 1.0) * 0.9 * band(az, 0.95, 0.16) * band(el, 0.4, 0.34);
          col += vec3(1.0, 0.7, 0.36) * 0.6 * band(az, -1.2, 0.3) * band(el, 0.18, 0.2);
          col += vec3(0.7, 0.75, 0.85) * 0.28 * smoothstep(1.0, 1.45, el);
          // a narrow high strip: steep views (the overview, the pull-up) get a diagonal sheen
          col += vec3(0.95, 0.93, 1.0) * 0.6 * band(az, 0.55, 0.32) * band(el, 1.05, 0.3);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  )
  room.add(sphere)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(room, 0)
  pmrem.dispose()
  sphere.geometry.dispose()
  ;(sphere.material as THREE.Material).dispose()
  return rt.texture
}

export async function buildDie(renderer: THREE.WebGLRenderer, mobile: boolean): Promise<DieScene> {
  const root = new THREE.Group()
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy())

  // ---------------- the die
  const mapCv = drawDieMap(mobile ? 1024 : 2048)
  await nextFrame()
  const map = canvasTexture(mapCv, true, aniso)
  const thick = canvasTexture(drawThickness(256), false, 1)
  const detailCv = drawDetail(mobile ? 256 : 512)
  const detail = canvasTexture(detailCv, false, aniso)
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping
  const detailN = canvasTexture(drawDetailNormals(detailCv), false, aniso)
  detailN.wrapS = detailN.wrapT = THREE.RepeatWrapping
  detailN.repeat.set(14, 14)
  const dieU: DieUniforms = {
    uRect: { value: BLOCKS.map(b => new THREE.Vector4(b.x, 1 - (b.y + b.h), b.x + b.w, 1 - b.y)) },
    uLit: { value: BLOCKS.map(() => 0) },
    uFocus: { value: 12 },
    uAperture: { value: 0 },
    uSig: { value: new THREE.Color(S.signal) },
    uGlow: { value: 1 },
    uLine: { value: 0.05 },
    uBreath: { value: 0 },
    uTime: { value: 0 },
    uDetail: { value: detail },
  }
  const side = new THREE.MeshStandardMaterial({ color: '#2b2d34', metalness: 0.7, roughness: 0.42 })
  const top = dieTopMaterial(map, thick, dieU)
  const studio = dieStudio(renderer)
  top.envMap = studio
  top.envMapIntensity = 1
  top.normalMap = detailN
  top.normalScale.set(0.35, 0.35)
  const die = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE_H, DIE), [side, side, top, side, side, side])
  die.position.y = DT - DIE_H / 2
  root.add(die)

  // die-attach fillet (silver epoxy bead) and the paddle
  const fillet = new THREE.Mesh(new RoundedBoxGeometry(DIE + 0.26, 0.12, DIE + 0.26, 2, 0.055), new THREE.MeshStandardMaterial({ color: '#6c6f77', metalness: 0.4, roughness: 0.62 }))
  fillet.position.y = 0.1
  root.add(fillet)
  const paddle = new THREE.Mesh(new THREE.BoxGeometry(11.7, 0.1, 11.7), new THREE.MeshStandardMaterial({ color: '#50545c', metalness: 0.85, roughness: 0.58 }))
  paddle.position.y = -0.01
  root.add(paddle)

  // the PLL inductor: thick top-metal spiral standing proud of block 05
  {
    const r = INDUCTOR.r * DIE
    const pts = spiralPoints(r, INDUCTOR.turns)
    const geos: THREE.BufferGeometry[] = []
    const w = r * 0.1
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az) + w
      const g = new THREE.BoxGeometry(len, 0.022, w)
      g.rotateY(-Math.atan2(bz - az, bx - ax))
      g.translate((ax + bx) / 2, 0.011, (az + bz) / 2)
      geos.push(g)
    }
    // the underpass back out of the centre
    const [ex, ez] = pts[pts.length - 1]
    const up = new THREE.BoxGeometry(w, 0.012, Math.abs(ez) + r * 1.25)
    up.translate(ex, 0.004, (ez + r * 1.25) / 2)
    geos.push(up)
    // thick copper: lit by the die's own studio so it glints at the macro angle
    const coil = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ color: S.copper, roughness: 0.3, metalness: 1, envMap: studio, envMapIntensity: 1.4 }))
    geos.forEach(g => g.dispose())
    uvToWorld(INDUCTOR.u, INDUCTOR.v, DT, coil.position)
    root.add(coil)
  }
  await nextFrame()

  // ---------------- the package body (one merged mesh)
  {
    const hS = (SHELF_Y - CAV_FLOOR) / 2 + CAV_FLOOR
    const hW = (WALL_TOP - CAV_FLOOR) / 2 + CAV_FLOOR
    const sh = SHELF_Y - CAV_FLOOR
    const wh = WALL_TOP - CAV_FLOOR
    const sd = WALL_IN - SHELF_IN
    const wd = PKG - WALL_IN
    const geos = [
      box(2 * PKG, CAV_FLOOR - PKG_BOTTOM, 2 * PKG, 0, (CAV_FLOOR + PKG_BOTTOM) / 2, 0),
      // bond shelf ring
      box(2 * WALL_IN, sh, sd, 0, hS, -(SHELF_IN + sd / 2)),
      box(2 * WALL_IN, sh, sd, 0, hS, SHELF_IN + sd / 2),
      box(sd, sh, 2 * SHELF_IN, -(SHELF_IN + sd / 2), hS, 0),
      box(sd, sh, 2 * SHELF_IN, SHELF_IN + sd / 2, hS, 0),
      // walls
      box(2 * PKG, wh, wd, 0, hW, -(WALL_IN + wd / 2)),
      box(2 * PKG, wh, wd, 0, hW, WALL_IN + wd / 2),
      box(wd, wh, 2 * WALL_IN, -(WALL_IN + wd / 2), hW, 0),
      box(wd, wh, 2 * WALL_IN, WALL_IN + wd / 2, hW, 0),
    ]
    const body = new THREE.Mesh(mergeGeometries(geos)!, MAT.epoxy())
    geos.forEach(g => g.dispose())
    root.add(body)
  }

  // ---------------- leadframe fingers, bond wires, ball + stitch bonds
  const goldI = new THREE.MeshStandardMaterial({ color: '#c99a42', roughness: 0.36, metalness: 1 })
  // out of focus, gold highlights spread: roughen with defocus (same lens as the die)
  goldI.onBeforeCompile = sh => {
    sh.uniforms.uFocus = dieU.uFocus
    sh.uniforms.uAperture = dieU.uAperture
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFocus, uAperture;')
      .replace(
        '#include <roughnessmap_fragment>',
        `float gDef = clamp((abs(vViewPosition.z - uFocus) / max(uFocus, 0.001) - 0.12) * uAperture, 0.0, 1.0);
        float roughnessFactor = min(1.0, roughness + gDef * 0.45);`,
      )
  }
  goldI.customProgramCacheKey = () => 'hark-silicon-gold-dof'
  const tinI = new THREE.MeshStandardMaterial({ color: '#a9aeb6', roughness: 0.42, metalness: 1 })
  const n = PADS * 4
  const fingers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.03, 1), goldI, n)
  const bonds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), goldI, n * 2)
  const pairs: [THREE.Vector3, THREE.Vector3][] = []
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const Y = new THREE.Vector3(0, 1, 0)
  const sc = new THREE.Vector3()
  const p = new THREE.Vector3()
  let fi = 0
  let bi = 0
  const TIP = 6.4
  const END = 8.5
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < PADS; i++) {
      const [u, v] = padUV(s, i)
      const pad = uvToWorld(u, v, DT)
      // along = the coordinate running along the side; out = the unit normal of the side
      const horiz = s === 0 || s === 2
      const along = horiz ? pad.x : pad.z
      const sign = s === 0 || s === 3 ? -1 : 1
      const at = (a: number, r: number) => (horiz ? new THREE.Vector3(a, 0, sign * r) : new THREE.Vector3(sign * r, 0, a))
      const tip = at(along * 1.28, TIP)
      const end = at(along * 1.62, END)
      const d = end.clone().sub(tip)
      const len = d.length()
      q.setFromAxisAngle(Y, Math.atan2(-d.z, d.x))
      p.copy(tip).add(end).multiplyScalar(0.5)
      p.y = SHELF_Y + 0.015
      m4.compose(p, q, sc.set(len, 1, 0.19))
      fingers.setMatrixAt(fi++, m4)
      // ball bond on the die pad, stitch on the finger tip
      const ball = pad.clone()
      ball.y = DT + 0.014
      m4.compose(ball, q.identity(), sc.set(0.085, 0.04, 0.085))
      bonds.setMatrixAt(bi++, m4)
      const stitch = tip.clone().addScaledVector(d.clone().normalize(), 0.14)
      stitch.y = SHELF_Y + 0.036
      m4.compose(stitch, q.setFromAxisAngle(Y, Math.atan2(-d.z, d.x)), sc.set(0.1, 0.022, 0.07))
      bonds.setMatrixAt(bi++, m4)
      pairs.push([ball.clone().setY(DT + 0.03), stitch.clone().setY(SHELF_Y + 0.045)])
    }
  }
  fingers.instanceMatrix.needsUpdate = true
  bonds.instanceMatrix.needsUpdate = true
  root.add(fingers, bonds)
  const wires = bondWires(pairs, { radius: mobile ? 0.016 : 0.013, loop: 0.34 })
  wires.material = defocusGold(dieU)
  root.add(wires)
  await nextFrame()

  // ---------------- outside: gull-wing leads, the board, its pads
  {
    const LP = 26
    const geoA = box(0.55, 0.07, 0.26, PKG + 0.27, -0.55, 0)
    const geoB = box(0.07, 0.86, 0.26, PKG + 0.52, -0.95, 0)
    const geoC = box(0.6, 0.07, 0.26, PKG + 0.8, BOARD_Y + 0.05, 0)
    const lead = mergeGeometries([geoA, geoB, geoC])!
    ;[geoA, geoB, geoC].forEach(g => g.dispose())
    const leads = new THREE.InstancedMesh(lead, tinI, LP * 4)
    const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.02, 0.36), goldI, LP * 4)
    let k = 0
    for (let s = 0; s < 4; s++) {
      q.setFromAxisAngle(Y, (s * Math.PI) / 2)
      for (let i = 0; i < LP; i++) {
        const a = -8 + (16 * (i + 0.5)) / LP
        p.set(0, 0, a).applyQuaternion(q)
        m4.compose(p, q, sc.set(1, 1, 1))
        leads.setMatrixAt(k, m4)
        const pp = new THREE.Vector3(PKG + 0.85, BOARD_Y + 0.01, a).applyQuaternion(q)
        m4.compose(pp, q, sc.set(1, 1, 1))
        pads.setMatrixAt(k++, m4)
      }
    }
    leads.instanceMatrix.needsUpdate = true
    pads.instanceMatrix.needsUpdate = true
    const board = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), MAT.mask())
    board.rotation.x = -Math.PI / 2
    board.position.y = BOARD_Y
    // a soft contact shadow under the package
    const shadowCv = document.createElement('canvas')
    shadowCv.width = shadowCv.height = 128
    const sg = shadowCv.getContext('2d')!
    const grd = sg.createRadialGradient(64, 64, 20, 64, 64, 64)
    grd.addColorStop(0, 'rgba(0,0,0,0.85)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    sg.fillStyle = grd
    sg.fillRect(0, 0, 128, 128)
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCv), transparent: true, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = BOARD_Y + 0.004
    root.add(leads, pads, board, shadow)
  }

  // ---------------- the lid (the etched Hark top) — lifted away in the intro
  const lid = new THREE.Group()
  {
    const lidBody = new THREE.Mesh(new RoundedBoxGeometry(2 * PKG, LID_H, 2 * PKG, 2, 0.08), MAT.epoxy())
    lidBody.position.y = LID_H / 2
    const lidTex = canvasTexture(drawLid(mobile ? 512 : 1024), true, aniso)
    const lidTop = new THREE.Mesh(new THREE.PlaneGeometry(2 * PKG * 0.97, 2 * PKG * 0.97), new THREE.MeshStandardMaterial({ map: lidTex, roughness: 0.62, metalness: 0 }))
    lidTop.rotation.x = -Math.PI / 2
    lidTop.position.y = LID_H + 0.002
    lid.add(lidBody, lidTop)
    lid.position.y = WALL_TOP
    root.add(lid)
  }

  // ---------------- block labels (etched metal text, lit per block)
  const labels: Label[] = []
  const centers: THREE.Vector3[] = []
  const corners: THREE.Vector3[][] = []
  const LH = 0.19
  BLOCKS.forEach((b, i) => {
    const s = SERVICES[i]
    const cv = drawLabel(s.num, b.code, s.title.toUpperCase(), mobile ? 0.62 : 1)
    const tex = canvasTexture(cv, false, aniso)
    const { mat, u } = labelMaterial(tex)
    const w = (LH * cv.width) / cv.height
    const geo = new THREE.PlaneGeometry(w, LH)
    geo.translate(w / 2, LH / 2, 0)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    uvToWorld(b.x + 0.01, b.y + b.h - 0.01, DT + 0.003, mesh.position)
    mesh.renderOrder = 2
    root.add(mesh)
    labels.push({ mesh, u, center: mesh.position.clone().add(new THREE.Vector3(w / 2, 0, -LH / 2)) })
    centers.push(uvToWorld(b.x + b.w / 2, b.y + b.h / 2, DT))
    corners.push([
      uvToWorld(b.x, b.y, DT),
      uvToWorld(b.x + b.w, b.y, DT),
      uvToWorld(b.x + b.w, b.y + b.h, DT),
      uvToWorld(b.x, b.y + b.h, DT),
    ])
  })

  // ---------------- the signal bus in the routing channels
  const Yb = DT + 0.002
  const W = (pts: [number, number][]) => chamfer(pts.map(([u, v]) => uvToWorld(u, v, Yb)), 0.06)
  const [, padV] = padUV(3, 8)
  const linkPts: [number, number][][] = [
    [
      [PAD_IN + 0.012, padV],
      [0.2, padV],
      [0.2, 0.345],
    ],
    [
      [0.23, 0.345],
      [0.23, 0.353],
      [0.45, 0.353],
      [0.45, 0.345],
    ],
    [
      [0.47, 0.345],
      [0.47, 0.353],
      [0.64, 0.353],
      [0.64, 0.345],
    ],
    [
      [0.66, 0.345],
      [0.66, 0.353],
      [0.83, 0.353],
      [0.83, 0.345],
    ],
    [
      [0.87, 0.345],
      [0.87, 0.367],
      [0.8, 0.367],
      [0.8, 0.375],
    ],
    [
      [0.79, 0.625],
      [0.79, 0.633],
      [0.62, 0.633],
      [0.62, 0.625],
    ],
    [
      [0.38, 0.625],
      [0.38, 0.633],
      [0.2, 0.633],
      [0.2, 0.625],
    ],
    [
      [0.12, 0.625],
      [0.12, 0.647],
      [0.16, 0.647],
      [0.16, 0.655],
    ],
    [
      [0.2, 0.655],
      [0.2, 0.647],
      [0.36, 0.647],
      [0.36, 0.655],
    ],
    [
      [0.42, 0.655],
      [0.42, 0.647],
      [0.57, 0.647],
      [0.57, 0.655],
    ],
    [
      [0.61, 0.655],
      [0.61, 0.647],
      [0.78, 0.647],
      [0.78, 0.655],
    ],
  ]
  const paths: BusPath[] = linkPts.map((pts, k) => ({ pts: W(pts), group: k }))
  const links = paths.map((_, k) => k)
  // ambient bus: the vertical gaps between blocks and the long runs of the channels
  const AMB = 11
  const amb: [number, number][][] = [
    [
      [0.09, 0.367],
      [0.77, 0.367],
    ],
    [
      [0.4, 0.633],
      [0.6, 0.633],
    ],
    [
      [0.8, 0.647],
      [0.91, 0.647],
    ],
    [
      [0.342, 0.09],
      [0.342, 0.34],
    ],
    [
      [0.556, 0.09],
      [0.556, 0.34],
    ],
    [
      [0.74, 0.09],
      [0.74, 0.34],
    ],
    [
      [0.292, 0.38],
      [0.292, 0.62],
    ],
    [
      [0.708, 0.38],
      [0.708, 0.62],
    ],
    [
      [0.252, 0.66],
      [0.252, 0.91],
    ],
    [
      [0.486, 0.66],
      [0.486, 0.91],
    ],
    [
      [0.67, 0.66],
      [0.67, 0.91],
    ],
  ]
  for (const a of amb) paths.push({ pts: W(a), group: AMB })
  const bus = new Bus(paths, { width: 0.045 })
  root.add(bus.group)

  return { root, lid, dieU, labels, bus, links, centers, corners, wires, dieTop: top }
}
