import * as THREE from 'three'
import { S } from '../../kit/silicon'

/*
 * The die's top-level signal bus: metal lines in the routing channels with
 * green signal pulses riding them. Like the kit's Traces (one merged mesh for
 * the metal, one additive mesh for the light), but every path belongs to a
 * GROUP (the block it feeds), and each group has its own glow and reach, so
 * one draw call can light the link into the block in view, keep visited
 * links faintly powered, and race a signal head along a link as the camera
 * travels it.
 */

export const GROUPS = 12

export interface BusPath {
  pts: THREE.Vector3[]
  group: number
}

/** Replace each corner of a polyline with a 45° chamfer of size r (PCB-style). */
export function chamfer(pts: THREE.Vector3[], r: number): THREE.Vector3[] {
  if (pts.length < 3) return pts
  const out: THREE.Vector3[] = [pts[0].clone()]
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    a.subVectors(pts[i - 1], p)
    b.subVectors(pts[i + 1], p)
    const la = a.length()
    const lb = b.length()
    const rr = Math.min(r, la * 0.5, lb * 0.5)
    if (rr < 1e-4) {
      out.push(p.clone())
      continue
    }
    out.push(p.clone().addScaledVector(a, rr / la), p.clone().addScaledVector(b, rr / lb))
  }
  out.push(pts[pts.length - 1].clone())
  return out
}

export class Bus {
  group = new THREE.Group()
  metal: THREE.Mesh
  light: THREE.Mesh
  /** length of each path, in the order given */
  lengths: number[] = []
  readonly u = {
    uTime: { value: 0 },
    uFlow: { value: 1.2 },
    uSpacing: { value: 2.6 },
    uLit: { value: new Array<number>(GROUPS).fill(0) },
    uReach: { value: new Array<number>(GROUPS).fill(1e3) },
    uColor: { value: new THREE.Color(S.signal) },
  }

  constructor(paths: BusPath[], o: { width?: number; base?: THREE.ColorRepresentation } = {}) {
    const w = o.width ?? 0.045
    const pos: number[] = []
    const uv: number[] = []
    const grp: number[] = []
    const seed: number[] = []
    const len: number[] = []
    const idx: number[] = []
    let v = 0
    const dir = new THREE.Vector3()
    const n = new THREE.Vector3()
    paths.forEach((p, pi) => {
      let total = 0
      for (let i = 0; i < p.pts.length - 1; i++) total += p.pts[i].distanceTo(p.pts[i + 1])
      this.lengths[pi] = total
      const sd = (Math.sin((pi + 1) * 12.9898) * 43758.5453) % 1
      const s01 = sd < 0 ? sd + 1 : sd
      let dist = 0
      for (let i = 0; i < p.pts.length - 1; i++) {
        const a = p.pts[i]
        const b = p.pts[i + 1]
        dir.subVectors(b, a)
        const l = dir.length()
        if (l < 1e-5) continue
        dir.normalize()
        n.set(-dir.z, 0, dir.x).multiplyScalar(w / 2)
        const a2 = a.clone().addScaledVector(dir, -w / 2)
        const b2 = b.clone().addScaledVector(dir, w / 2)
        pos.push(a2.x + n.x, a2.y, a2.z + n.z, a2.x - n.x, a2.y, a2.z - n.z, b2.x + n.x, b2.y, b2.z + n.z, b2.x - n.x, b2.y, b2.z - n.z)
        uv.push(dist, 0, dist, 1, dist + l, 0, dist + l, 1)
        for (let k = 0; k < 4; k++) {
          grp.push(p.group)
          seed.push(s01)
          len.push(total)
        }
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
        v += 4
        dist += l
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('aGroup', new THREE.Float32BufferAttribute(grp, 1))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    this.metal = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        color: o.base ?? '#8c7b5c',
        metalness: 0.85,
        roughness: 0.32,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    )
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute float aGroup;
        attribute float aSeed;
        attribute float aLen;
        uniform float uLit[${GROUPS}];
        uniform float uReach[${GROUPS}];
        varying vec2 vUv;
        varying float vSeed;
        varying float vLit;
        varying float vReach;
        varying float vLen;
        void main() {
          int gi = int(aGroup + 0.5);
          vLit = uLit[gi];
          vReach = uReach[gi];
          vUv = uv;
          vSeed = aSeed;
          vLen = aLen;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFlow, uSpacing;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vSeed;
        varying float vLit;
        varying float vReach;
        varying float vLen;
        void main() {
          float across = 1.0 - smoothstep(0.2, 0.5, abs(vUv.y - 0.5));
          float reach = min(vReach, vLen);
          float live = 1.0 - smoothstep(reach - 0.05, reach, vUv.x);
          // steady pulses (time) toward the block
          float d = vUv.x - uTime * uFlow - vSeed * uSpacing;
          float ph = fract(d / uSpacing);
          float head = 1.0 - smoothstep(0.0, 0.07, 1.0 - ph);
          float tail = smoothstep(0.4, 1.0, ph) * 0.4;
          // while a link is still being reached, a bright head races along it
          float arriving = 1.0 - step(vLen - 0.001, vReach);
          float front = arriving * exp(-abs(vUv.x - reach) * 12.0) * step(vUv.x, reach + 0.02);
          float a = vLit * ((head + tail) * (1.0 - 0.6 * arriving) + 0.14) * live + front * 2.4 * step(0.001, vLit);
          a *= across;
          if (a <= 0.003) discard;
          gl_FragColor = vec4(uColor * a * 2.0, 1.0);
        }
      `,
    })
    this.light = new THREE.Mesh(g, mat)
    this.light.renderOrder = 3
    this.group.add(this.metal, this.light)
  }
}
