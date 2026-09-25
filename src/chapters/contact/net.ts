import * as THREE from 'three'
import { S } from '../../kit/silicon'
import type { NetPath } from './layout'

/*
 * The board's signal layer: every net as one merged, MITERED ribbon (no
 * overlapping quads at corners, so the additive light never doubles up),
 * drawn over the copper that is baked into the board texture.
 *
 * Each fragment knows its NETWORK distance d = start + along·rate. One
 * scroll-driven uniform, uFront, sweeps through the network: right at the
 * front there is a bright head (the arriving signal, with a short comet
 * tail); where the front has passed, short pulses ride the trace. Between
 * pulses the trace is plain copper: the green is only ever the signal. The
 * ribbon is wider than the copper so a pulse has a soft halo on the mask.
 */

const HALO = 3.4

export class Net {
  mesh: THREE.Mesh
  u = {
    uTime: { value: 0 },
    uFront: { value: -1 },
    uFlow: { value: 2.2 },
    uPulse: { value: 1 },
    uHead: { value: 3.2 },
    uColor: { value: new THREE.Color(S.signal) },
  }

  constructor(paths: NetPath[], y = 0.0016) {
    const pos: number[] = []
    const uv: number[] = []
    const start: number[] = []
    const rate: number[] = []
    const kind: number[] = []
    const seed: number[] = []
    const core: number[] = []
    const idx: number[] = []
    let base = 0
    paths.forEach((p, pi) => {
      const pts = p.pts
      if (pts.length < 2) return
      const hw = (p.w * HALO) / 2
      const s = Math.abs(Math.sin((pi + 1) * 12.9898) * 43758.5453) % 1
      let dist = -hw * 0.6
      // extend the ends slightly so the halo rounds off past the pads
      const first = pts[0].clone().addScaledVector(pts[0].clone().sub(pts[1]).normalize(), hw * 0.6)
      const n = pts.length
      const last = pts[n - 1].clone().addScaledVector(pts[n - 1].clone().sub(pts[n - 2]).normalize(), hw * 0.6)
      const P = [first, ...pts.slice(1, -1), last]
      for (let i = 0; i < P.length; i++) {
        if (i > 0) dist += P[i].distanceTo(P[i - 1])
        const a = P[Math.max(0, i - 1)]
        const b = P[Math.min(P.length - 1, i + 1)]
        const dIn = i > 0 ? P[i].clone().sub(a).normalize() : b.clone().sub(P[i]).normalize()
        const dOut = i < P.length - 1 ? b.clone().sub(P[i]).normalize() : dIn.clone()
        const t = dIn.clone().add(dOut)
        if (t.lengthSq() < 1e-8) t.copy(dOut)
        t.normalize()
        // normal in XZ (x, z) → left of travel
        const nx = -t.y
        const nz = t.x
        const m = 1 / Math.max(0.4, nx * -dIn.y + nz * dIn.x)
        const ox = nx * hw * m
        const oz = nz * hw * m
        pos.push(P[i].x + ox, y, P[i].y + oz, P[i].x - ox, y, P[i].y - oz)
        uv.push(dist, 0, dist, 1)
        for (let k = 0; k < 2; k++) {
          start.push(p.start)
          rate.push(p.rate)
          kind.push(p.kind)
          seed.push(s)
          core.push(1 / HALO)
        }
        if (i > 0) {
          const v0 = base + (i - 1) * 2
          idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2)
        }
      }
      base += P.length * 2
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('aStart', new THREE.Float32BufferAttribute(start, 1))
    g.setAttribute('aRate', new THREE.Float32BufferAttribute(rate, 1))
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    g.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1))
    g.setIndex(idx)
    g.computeBoundingSphere()
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute float aStart, aRate, aKind, aSeed, aCore;
        varying vec2 vUv; varying float vStart, vRate, vKind, vSeed, vCore;
        void main() {
          vUv = uv; vStart = aStart; vRate = aRate; vKind = aKind; vSeed = aSeed; vCore = aCore;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFront, uFlow, uPulse, uHead;
        uniform vec3 uColor;
        varying vec2 vUv; varying float vStart, vRate, vKind, vSeed, vCore;
        void main() {
          float d = vStart + max(vUv.x, 0.0) * vRate;
          float h = uFront - d;
          float live = smoothstep(0.0, 0.35, h);
          // the arriving signal: a bright head with a short comet tail
          float head = smoothstep(-0.1, 0.02, h) * (1.0 - smoothstep(0.02, 0.55, h));
          // pulses riding toward +along (into U1 for inputs, out to the LEDs for outputs):
          // a short head and a short tail; plain copper between them
          float spacing = mix(3.4, 6.0, vKind);
          float ph = fract((vUv.x - uTime * uFlow) / spacing - vSeed);
          float pulse = (1.0 - smoothstep(0.0, 0.04, 1.0 - ph)) + smoothstep(0.8, 1.0, ph) * 0.3;
          // across: the copper core + a soft halo on the mask
          float x = abs(vUv.y * 2.0 - 1.0);
          float c = 1.0 - smoothstep(vCore * 0.85, vCore * 1.15, x);
          float halo = (1.0 - x) * (1.0 - x);
          float a = live * uPulse * (1.0 - 0.4 * vKind) * pulse * (c * 0.9 + 0.3 * halo);
          a += head * uHead * (c + 0.35 * halo);
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
  }

  set(o: { time: number; front: number; flow: number; pulse: number; head: number }) {
    const u = this.u
    u.uTime.value = o.time
    u.uFront.value = o.front
    u.uFlow.value = o.flow
    u.uPulse.value = o.pulse
    u.uHead.value = o.head
  }
}

/**
 * Soft light pools on the mask around lit LEDs, one
 * instanced additive quad each; per-instance brightness.
 */
export class Halos {
  mesh: THREE.InstancedMesh
  private on: THREE.InstancedBufferAttribute
  constructor(points: { x: number; z: number; size: number }[], color: THREE.ColorRepresentation = S.signal) {
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    this.on = new THREE.InstancedBufferAttribute(new Float32Array(points.length), 1)
    this.on.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aOn', this.on)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        attribute float aOn; varying float vOn; varying vec2 vUv;
        void main() { vOn = aOn; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vOn; varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float a = (exp(-r * r * 7.0) * 0.55 + exp(-r * r * 60.0) * 0.9) * (1.0 - smoothstep(0.85, 1.0, r)) * vOn;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, points.length)
    const m = new THREE.Matrix4()
    points.forEach((p, i) => {
      m.makeScale(p.size, 1, p.size).setPosition(p.x, 0.003, p.z)
      this.mesh.setMatrixAt(i, m)
    })
    this.mesh.renderOrder = 3
    this.mesh.frustumCulled = false
  }
  set(i: number, v: number) {
    const a = this.on.array as Float32Array
    if (Math.abs(a[i] - v) > 1e-4) {
      a[i] = v
      this.on.needsUpdate = true
    }
  }
}
