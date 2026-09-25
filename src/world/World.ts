import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * The shared world for Hark Silicon: a MACRO PHOTOGRAPHY studio for
 * electronics. Everything is shot like a product macro — a very shallow
 * depth of field, so behind every subject the world is a soft field of
 * out-of-focus BOKEH (discs of light from LEDs and reflections), over a deep
 * graphite-blue gradient.
 *
 *  - BACKDROP (camera-centred dome shader): gradient + two soft light pools +
 *    hexagonal-aperture bokeh discs drifting slowly (params.bokeh, colours a/b).
 *  - STUDIO REFLECTIONS (PMREM, built once): a dark room with a long softbox
 *    overhead, two tall strips, a warm bounce card and a cool rim — metal
 *    (gold pads, copper, the chip's lid) lives on these. params.env sets the
 *    strength, params.envTurn rotates the room (sweep a highlight across a
 *    part as it arrives).
 *  - CLEANROOM (params.amber 0..1): the fab's yellow photolithography light —
 *    tints the key, fill, backdrop and reflections amber.
 *  - KEY + FILL: one directional key (specular glints on pins and pads) and a
 *    low hemisphere.
 *
 * Chapters set world.params every frame they care; the engine resets them to
 * defaults first; values are damped so cuts never pop.
 */

export interface WorldParams {
  /** backdrop gradient (top / bottom) */
  top: THREE.ColorRepresentation
  bottom: THREE.ColorRepresentation
  /** the two bokeh / light-pool colours */
  a: THREE.ColorRepresentation
  b: THREE.ColorRepresentation
  /** 0..1 how many out-of-focus light discs float behind (0 = clean backdrop) */
  bokeh: number
  /** where the light pools sit, in screen space (-1..1, y up) */
  focus: THREE.Vector2
  /** 0..1 the fab's yellow cleanroom light */
  amber: number
  /** studio reflection strength (scene.environmentIntensity) */
  env: number
  /** studio rotation about Y (radians): sweep highlights across metal */
  envTurn: number
  /** key light: direction it comes FROM, and strength */
  keyDir: THREE.Vector3
  key: number
  /** hemisphere fill strength */
  fill: number
}

export const WORLD_DEFAULTS = {
  top: '#0a0f18',
  bottom: '#03050a',
  a: '#00ff85',
  b: '#3f7cff',
  bokeh: 0.7,
  amber: 0,
  env: 1,
  envTurn: 0,
  key: 2.4,
  fill: 0.35,
}

const AMBER = new THREE.Color('#ffb020')

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uTop, uBottom, uA, uB;
  uniform float uBokeh, uTime, uTanV, uAmber;
  uniform vec2 uFocus;
  uniform mat3 uViewRot;
  varying vec3 vDir;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // a soft, nearly round aperture disc (a 9-blade iris reads round), radius r
  float hexDisc(vec2 p, float r) {
    float d = length(p);
    return 1.0 - smoothstep(r * 0.55, r, d);
  }
  void main() {
    vec3 v = uViewRot * normalize(vDir);
    float z = max(-v.z, 0.05);
    vec2 p = v.xy / z / uTanV;
    float h = clamp(p.y * 0.35 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBottom, uTop, smoothstep(0.1, 0.95, h));
    // two broad light pools behind the subject
    vec2 q = p - uFocus;
    col += uA * exp(-dot(q - vec2(0.35, 0.1), q - vec2(0.35, 0.1)) / 0.7) * 0.035;
    col += uB * exp(-dot(q + vec2(0.55, 0.2), q + vec2(0.55, 0.2)) / 1.0) * 0.06;
    // bokeh: a grid of cells, each maybe holding one drifting disc
    if (uBokeh > 0.001) {
      for (int layer = 0; layer < 2; layer++) {
        float fl = float(layer);
        float cell = mix(0.42, 0.75, fl);
        vec2 drift = vec2(uTime * (0.012 + 0.008 * fl), sin(uTime * 0.05 + fl) * 0.03);
        vec2 gp = (p + drift) / cell;
        vec2 id = floor(gp);
        vec2 f = fract(gp) - 0.5;
        float r1 = hash(id + fl * 17.0);
        float present = step(1.0 - uBokeh * 0.28, r1);
        vec2 off = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.5;
        float r = mix(0.05, 0.19, hash(id + 11.3) * hash(id + 4.4));
        float d = hexDisc(f - off, r);
        // brighter rim like real bokeh (spherical aberration), soft centre
        float rim = d - hexDisc(f - off, r * 0.8) * 0.4;
        vec3 c = mix(uA, uB, step(0.62, hash(id + 5.9)));
        // most out-of-focus lights are warm white (reflections), a few are LEDs
        c = mix(c, vec3(1.0, 0.9, 0.75), step(0.45, hash(id + 2.2)) * 0.75);
        float twinkle = 0.75 + 0.25 * sin(uTime * (0.4 + r1) + r1 * 20.0);
        col += c * rim * present * (0.03 + 0.06 * (1.0 - fl)) * twinkle;
      }
    }
    col = mix(col, col * vec3(1.25, 0.95, 0.45) + vec3(0.03, 0.018, 0.0), uAmber);
    col += (hash(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) / 255.0;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`

export class World {
  object = new THREE.Group()
  key: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  envMap: THREE.Texture | null = null
  params: WorldParams = {
    ...WORLD_DEFAULTS,
    focus: new THREE.Vector2(0.2, 0),
    keyDir: new THREE.Vector3(-0.45, 0.85, 0.55),
  }
  private cur = {
    top: new THREE.Color(),
    bottom: new THREE.Color(),
    a: new THREE.Color(),
    b: new THREE.Color(),
    bokeh: WORLD_DEFAULTS.bokeh,
    amber: 0,
    env: 1,
    envTurn: 0,
    key: WORLD_DEFAULTS.key,
    fill: WORLD_DEFAULTS.fill,
    focus: new THREE.Vector2(0.2, 0),
  }
  private first = true
  private clock = 0
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uBokeh: { value: 0.7 },
    uTime: { value: 0 },
    uTanV: { value: 0.4 },
    uAmber: { value: 0 },
    uFocus: { value: new THREE.Vector2() },
    uViewRot: { value: new THREE.Matrix3() },
  }
  private tmp = new THREE.Color()
  private tmpV = new THREE.Vector3()
  private tmpM = new THREE.Matrix4()
  private keyBase = new THREE.Color('#fff6ea')

  constructor(
    private scene: THREE.Scene,
    private mobile: boolean,
    renderer?: THREE.WebGLRenderer,
  ) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false, uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG }),
    )
    dome.frustumCulled = false
    dome.renderOrder = -10
    this.object.add(dome)

    this.key = new THREE.DirectionalLight(0xfff6ea, WORLD_DEFAULTS.key)
    scene.add(this.key)
    scene.add(this.key.target)
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x15110c, WORLD_DEFAULTS.fill)
    scene.add(this.hemi)
    if (renderer) this.buildStudio(renderer)
  }

  /** Studio reflections for metal: a dark room with softboxes, prefiltered once. */
  private buildStudio(renderer: THREE.WebGLRenderer) {
    const room = new THREE.Scene()
    room.add(new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: '#06080c', side: THREE.BackSide })))
    const panel = (w: number, h: number, color: string, power: number, pos: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }))
      m.position.set(...pos)
      m.lookAt(0, 0, 0)
      room.add(m)
    }
    panel(12, 3, '#ffffff', 2.4, [0, 6.8, 0]) // long overhead softbox
    panel(1.2, 10, '#ffffff', 4, [-10, 1, 3]) // tall strip left
    panel(1.0, 10, '#eaf2ff', 3, [10, 1, -2]) // tall strip right
    panel(6, 3, '#ffcf9a', 1.2, [4, -3, 9]) // warm bounce card (gold reads gold)
    panel(5, 2, '#6f9bff', 1.0, [-6, -2, -9]) // cool rim
    panel(4, 1.5, '#00ff85', 0.8, [7, -4, -7]) // a hint of signal green
    const pmrem = new THREE.PMREMGenerator(renderer)
    const rt = pmrem.fromScene(room, 0.03)
    pmrem.dispose()
    room.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
    this.envMap = rt.texture
    this.scene.environment = rt.texture
  }

  resetParams() {
    const p = this.params
    p.top = WORLD_DEFAULTS.top
    p.bottom = WORLD_DEFAULTS.bottom
    p.a = WORLD_DEFAULTS.a
    p.b = WORLD_DEFAULTS.b
    p.bokeh = WORLD_DEFAULTS.bokeh
    p.amber = WORLD_DEFAULTS.amber
    p.env = WORLD_DEFAULTS.env
    p.envTurn = WORLD_DEFAULTS.envTurn
    p.key = WORLD_DEFAULTS.key
    p.fill = WORLD_DEFAULTS.fill
    p.focus.set(0.2, 0)
    p.keyDir.set(-0.45, 0.85, 0.55)
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    const k = this.first ? 1 : 1 - Math.exp(-4 * frame.dt)
    this.first = false
    c.top.lerp(this.tmp.set(p.top), k)
    c.bottom.lerp(this.tmp.set(p.bottom), k)
    c.a.lerp(this.tmp.set(p.a), k)
    c.b.lerp(this.tmp.set(p.b), k)
    c.bokeh += (p.bokeh - c.bokeh) * k
    c.amber += (p.amber - c.amber) * k
    c.env += (p.env - c.env) * k
    let dt = p.envTurn - c.envTurn
    dt = Math.atan2(Math.sin(dt), Math.cos(dt))
    c.envTurn += dt * k
    c.key += (p.key - c.key) * k
    c.fill += (p.fill - c.fill) * k
    c.focus.lerp(p.focus, k)
    if (!frame.still) this.clock += frame.dt * (frame.reducedMotion ? 0.15 : 1)

    const u = this.uniforms
    u.uTop.value.copy(c.top)
    u.uBottom.value.copy(c.bottom)
    u.uA.value.copy(c.a)
    u.uB.value.copy(c.b)
    u.uBokeh.value = c.bokeh * (this.mobile ? 0.8 : 1)
    u.uAmber.value = c.amber
    u.uTime.value = this.clock
    u.uFocus.value.copy(c.focus)
    const persp = camera as THREE.PerspectiveCamera
    u.uTanV.value = Math.tan(THREE.MathUtils.degToRad((persp.fov ?? 45) / 2))
    camera.updateMatrixWorld()
    this.tmpM.extractRotation(camera.matrixWorldInverse)
    u.uViewRot.value.setFromMatrix4(this.tmpM)

    this.scene.environmentIntensity = c.env * (1 - c.amber * 0.35)
    this.scene.environmentRotation.y = c.envTurn
    this.key.color.copy(this.keyBase).lerp(AMBER, c.amber * 0.85)
    this.key.intensity = c.key
    this.key.position.copy(camera.position).addScaledVector(this.tmpV.copy(p.keyDir).normalize(), 50)
    this.key.target.position.copy(camera.position)
    this.key.target.updateMatrixWorld()
    this.hemi.intensity = c.fill
    this.hemi.color.set('#bfd4ff').lerp(AMBER, c.amber)
    this.object.position.copy(camera.position)
  }
}
