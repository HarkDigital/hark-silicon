import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * The shared world: whatever every chapter has in common behind it — here a
 * camera-centred backdrop gradient plus one key light and a hemisphere fill.
 *
 * THEME: replace the internals (Orbit: nebula + stars; Resonance: studio
 * env map; Town: time-of-day sky + soft-shadow sun; Arcade: gradient + pixel
 * stars). Keep what the engine calls: `object`, `params`, `resetParams()`,
 * `update(frame, camera)` — and keep ctx.world typed in src/core/types.ts.
 *
 * Chapters set world.params every frame they care; the engine resets them to
 * defaults first; values are damped so cuts never pop.
 */

export interface WorldParams {
  /** backdrop gradient (top of the sky / bottom) */
  top: THREE.ColorRepresentation
  bottom: THREE.ColorRepresentation
  /** key light: direction it comes FROM, and strength */
  keyDir: THREE.Vector3
  key: number
  /** hemisphere fill strength */
  fill: number
}

export const WORLD_DEFAULTS = { top: '#1a1d24', bottom: '#2a2f3a', key: 2.2, fill: 1.0 }

export class World {
  object = new THREE.Group()
  key: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams = { ...WORLD_DEFAULTS, keyDir: new THREE.Vector3(-0.5, 0.8, 0.6) }
  private cur = { top: new THREE.Color(), bottom: new THREE.Color(), key: WORLD_DEFAULTS.key, fill: WORLD_DEFAULTS.fill }
  private first = true
  private uniforms = { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } }
  private tmpA = new THREE.Color()
  private tmpB = new THREE.Color()
  private tmpV = new THREE.Vector3()

  constructor(scene: THREE.Scene, _mobile: boolean) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uBottom;
          varying vec3 vDir;
          float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          void main() {
            float h = normalize(vDir).y * 0.5 + 0.5;
            vec3 c = mix(uBottom, uTop, smoothstep(0.2, 0.85, h));
            c += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    )
    dome.frustumCulled = false
    dome.renderOrder = -10
    this.object.add(dome)

    this.key = new THREE.DirectionalLight(0xffffff, WORLD_DEFAULTS.key)
    scene.add(this.key)
    scene.add(this.key.target)
    this.hemi = new THREE.HemisphereLight(0xdfe7ff, 0x3a3530, WORLD_DEFAULTS.fill)
    scene.add(this.hemi)
  }

  resetParams() {
    const p = this.params
    p.top = WORLD_DEFAULTS.top
    p.bottom = WORLD_DEFAULTS.bottom
    p.key = WORLD_DEFAULTS.key
    p.fill = WORLD_DEFAULTS.fill
    p.keyDir.set(-0.5, 0.8, 0.6)
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    this.tmpA.set(p.top)
    this.tmpB.set(p.bottom)
    if (this.first) {
      c.top.copy(this.tmpA)
      c.bottom.copy(this.tmpB)
      c.key = p.key
      c.fill = p.fill
      this.first = false
    }
    const k = 1 - Math.exp(-5 * frame.dt)
    c.top.lerp(this.tmpA, k)
    c.bottom.lerp(this.tmpB, k)
    c.key += (p.key - c.key) * k
    c.fill += (p.fill - c.fill) * k
    this.uniforms.uTop.value.copy(c.top)
    this.uniforms.uBottom.value.copy(c.bottom)
    this.key.intensity = c.key
    this.key.position.copy(camera.position).addScaledVector(this.tmpV.copy(p.keyDir).normalize(), 50)
    this.key.target.position.copy(camera.position)
    this.key.target.updateMatrixWorld()
    this.hemi.intensity = c.fill
    this.object.position.copy(camera.position)
  }
}
