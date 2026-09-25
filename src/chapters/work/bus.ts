import * as THREE from 'three'
import { S } from '../../kit/silicon'
import { COC_GLSL, dofUniforms, type DofUniforms } from './dof'

/*
 * The motherboard's data bus: every lane on the board in ONE copper mesh and
 * ONE additive pulse mesh (a chapter-local cousin of kit Traces).
 *
 * Each lane carries a group id (0–5 = the six display modules, 6 = the nine
 * chips, 7 = misc/ambient). Per group the chapter drives, every frame:
 *   go[g]    distance still to travel before the signal front reaches the
 *            END of each lane in the group (units). Large = nothing sent yet;
 *            0 = the front is at the connector; negative = arrived, the lane
 *            is live along its whole length (steady stream of pulses).
 *   gain[g]  brightness of the live stream (the current module is brightest).
 * `hot` picks one lane of group 6 (the chip the table points at).
 *
 * Everything is scroll-derived except the flow of pulses (frame.time).
 */

export interface LaneDef {
  pts: THREE.Vector3[]
  group: number
  lane: number
}

const GROUPS = 8

export class Bus {
  group = new THREE.Group()
  copper: THREE.Mesh
  pulses: THREE.Mesh
  /** total length of each lane (same order as given) */
  lengths: number[] = []
  u = {
    uTime: { value: 0 },
    uFlow: { value: 7 },
    uAmbient: { value: 0.22 },
    uGo: { value: new Array<number>(GROUPS).fill(1e4) },
    uGain: { value: new Array<number>(GROUPS).fill(1) },
    uHot: { value: -1 },
    uHotAmt: { value: 0 },
    uHead: { value: 1 },
    uGlowW: { value: 0.22 },
    uColor: { value: new THREE.Color(S.signal) },
    ...dofUniforms(),
  }

  constructor(lanes: LaneDef[], o: { width?: number; glow?: number; y?: number; dof?: DofUniforms } = {}) {
    if (o.dof) Object.assign(this.u, o.dof)
    const w = o.width ?? 0.05
    const gw = o.glow ?? 0.22
    this.u.uGlowW.value = gw
    const build = (width: number, withAttrs: boolean) => {
      const pos: number[] = []
      const uv: number[] = []
      const meta: number[] = []
      const idx: number[] = []
      let v = 0
      lanes.forEach((ln, li) => {
        const pts = ln.pts
        let total = 0
        for (let i = 0; i < pts.length - 1; i++) total += pts[i].distanceTo(pts[i + 1])
        this.lengths[li] = total
        // deterministic per-lane phase (screenshots and reloads match)
        const s = Math.abs(Math.sin((li + 1) * 12.9898) * 43758.5453) % 1
        let dist = 0
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]
          const b = pts[i + 1]
          const dir = new THREE.Vector3().subVectors(b, a)
          const len = dir.length()
          if (len < 1e-5) continue
          dir.normalize()
          const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2)
          // extend by half the copper width so 45° joints close without gaps
          const ext = w / 2
          const a2 = a.clone().addScaledVector(dir, i === 0 ? 0 : -ext)
          const b2 = b.clone().addScaledVector(dir, i === pts.length - 2 ? 0 : ext)
          const d0 = dist - (i === 0 ? 0 : ext)
          const d1 = dist + len + (i === pts.length - 2 ? 0 : ext)
          pos.push(a2.x + n.x, a2.y, a2.z + n.z, a2.x - n.x, a2.y, a2.z - n.z, b2.x + n.x, b2.y, b2.z + n.z, b2.x - n.x, b2.y, b2.z - n.z)
          uv.push(d0, 0, d0, 1, d1, 0, d1, 1)
          if (withAttrs) for (let k = 0; k < 4; k++) meta.push(s, ln.group, ln.lane, total)
          idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
          v += 4
          dist += len
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      if (withAttrs) g.setAttribute('aMeta', new THREE.Float32BufferAttribute(meta, 4))
      g.setIndex(idx)
      g.computeVertexNormals()
      g.computeBoundingSphere()
      return g
    }

    // copper under the solder mask: a faintly raised, darker-than-mask sheen
    this.copper = new THREE.Mesh(
      build(w, false),
      new THREE.MeshStandardMaterial({
        color: '#2c2a28',
        roughness: 0.34,
        metalness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    )
    this.copper.position.y = o.y ?? 0.003

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
        attribute vec4 aMeta;
        uniform float uGo[${GROUPS}];
        uniform float uGain[${GROUPS}];
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vSeed, vGroup, vLane, vLen, vGo, vGain;
        void main() {
          vUv = uv;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          vSeed = aMeta.x; vGroup = aMeta.y; vLane = aMeta.z; vLen = aMeta.w;
          int g = int(aMeta.y + 0.5);
          vGo = uGo[g];
          vGain = uGain[g];
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFlow, uAmbient, uHot, uHotAmt, uHead, uGlowW;
        uniform vec3 uColor;
        uniform float uFocus, uBand, uAmount;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vSeed, vGroup, vLane, vLen, vGo, vGain;
        ${COC_GLSL}
        // one pulse per 'spacing' units: a short bright head, a soft tail behind it
        float pulse(float d, float spacing, float seed) {
          float ph = fract(d / spacing - seed);
          float head = 1.0 - smoothstep(0.0, 0.05, 1.0 - ph);
          float tail = smoothstep(0.45, 1.0, ph);
          return head + tail * tail * 0.45;
        }
        void main() {
          float d = vUv.x;
          float a = (vUv.y - 0.5) * uGlowW;
          // thin bright core + a soft halo (neighbouring lanes' halos add up)
          // out of focus (the macro lens), a pulse spreads into a softer, dimmer line
          float sp = 1.0 + wkCocAt(length(vWorld - cameraPosition)) * 12.0;
          float prof = exp(-a * a / (0.00032 * sp * sp)) / sp + exp(-a * a / (0.0028 * sp)) * 0.16;
          float t = uTime * uFlow;
          float front = vLen - vGo;
          float passed = 1.0 - smoothstep(front - 0.06, front + 0.06, d);
          float hot = 0.0;
          if (vGroup > 5.5 && vGroup < 6.5) hot = (1.0 - smoothstep(0.3, 0.6, abs(vLane - uHot))) * uHotAmt;
          float gain = vGain * (1.0 + hot * 1.6);
          // idle chatter on unpowered lanes, a steady stream on live ones
          float amb = pulse(d - t * 0.8, 17.0, vSeed) * uAmbient * (1.0 - passed);
          float stream = (pulse(d - t * 1.35, 5.5, fract(vSeed * 3.7)) * 0.95 + 0.1) * passed * gain;
          // the burst: a hot front and a comet tail behind it
          float dd = front - d;
          float head = exp(-dd * dd / 0.06) * 2.4 * uHead;
          float comet = passed * exp(-max(dd, 0.0) / 4.0) * 0.9 * uHead;
          float v = (amb + stream + head + comet) * prof;
          if (v < 0.003) discard;
          gl_FragColor = vec4(uColor * v * 1.5, 1.0);
        }
      `,
    })
    this.pulses = new THREE.Mesh(build(gw, true), pm)
    this.pulses.position.y = (o.y ?? 0.003) + 0.001
    this.pulses.renderOrder = 2
    this.pulses.frustumCulled = false
    this.group.add(this.copper, this.pulses)
  }
}
