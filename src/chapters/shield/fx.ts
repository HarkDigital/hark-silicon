import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { S, type Traces } from '../../kit/silicon'
import { rng } from '../../core/math'
import { CAN } from './board'

/*
 * SURGE effects: the main rail's pulse shader (a red surge that turns green
 * past the clamp), via sparks, the shield can and the pick-and-place nozzle.
 */

/**
 * Swap the main rail's pulse material for one that knows about the clamp:
 * everything up to the surge front (uReach) runs red and fast; with uClamp on,
 * pulses past the clamp node (uSplit) are clean green; uSteady turns it all
 * green and calm. Uses the kit Traces geometry (uv.x = distance along path).
 */
export class RailPulses {
  u = {
    uTime: { value: 0 },
    uFlowR: { value: 14 },
    uFlowG: { value: 3 },
    uDensR: { value: 4 },
    uDensG: { value: 1.4 },
    uReach: { value: 0 },
    uSplit: { value: 1 },
    uClamp: { value: 0 },
    uSurge: { value: 1 },
    uCalm: { value: 1 },
    uSteady: { value: 0 },
    uRed: { value: new THREE.Color(S.red) },
    uGreen: { value: new THREE.Color(S.signal) },
  }
  constructor(traces: Traces, split: number) {
    this.u.uSplit.value = split
    const old = traces.pulses.material as THREE.Material
    traces.pulses.material = new THREE.ShaderMaterial({
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
      fragmentShader: /* glsl */ `
        uniform float uTime, uFlowR, uFlowG, uDensR, uDensG, uReach, uSplit, uClamp, uSurge, uCalm, uSteady;
        uniform vec3 uRed, uGreen;
        varying vec2 vUv; varying float vSeed;
        float train(float x, float flow, float dens) {
          float spacing = 10.0 / max(dens, 0.05);
          float ph = fract((x - uTime * flow) / spacing - vSeed);
          float head = 1.0 - smoothstep(0.0, 0.05, 1.0 - ph);
          float tail = smoothstep(0.45, 1.0, ph) * 0.4;
          return head + tail;
        }
        void main() {
          float x = vUv.x;
          float across = 1.0 - smoothstep(0.22, 0.5, abs(vUv.y - 0.5));
          // how far the surge has got (a soft front)
          float hit = 1.0 - smoothstep(uReach - 0.22, uReach, x);
          float past = uClamp * smoothstep(uSplit - 0.04, uSplit + 0.1, x);
          float red = hit * (1.0 - past) * (1.0 - uSteady);
          // the surge: a dense fast train with a crackling ripple riding on it
          float rip = 0.5 + 0.5 * sin((x - uTime * uFlowR) * 23.0 + sin(x * 9.0 + uTime * 1.3) * 2.0);
          float aR = (train(x, uFlowR, uDensR) + 0.3 * rip * rip + 0.12) * uSurge;
          // a hot front just behind the arriving edge
          aR += smoothstep(uReach - 0.5, uReach - 0.08, x) * hit * 0.9 * uSurge * (1.0 - uClamp);
          float aG = (train(x, uFlowG, uDensG) + 0.07) * uCalm;
          float a = mix(aG, aR, red) * across;
          if (a <= 0.002) discard;
          vec3 col = mix(uGreen, uRed, red);
          // the hottest part of the surge burns toward white
          col = mix(col, vec3(1.0, 0.82, 0.72), clamp(red * (aR - 1.2) * 0.35, 0.0, 0.6));
          gl_FragColor = vec4(col * a * 2.2, 1.0);
        }
      `,
    })
    old.dispose()
  }
}

/**
 * Sparks thrown off a via during the flashover: short streaks (line
 * segments, head + tail), ballistic, respawning. Positions are computed on
 * the GPU from uTime; uAmt 0 hides them (reduced motion).
 */
export class Sparks {
  obj: THREE.LineSegments
  u = { uTime: { value: 0 }, uAmt: { value: 0 } }
  constructor(n: number) {
    const R = rng(77)
    const pos = new Float32Array(n * 2 * 3)
    const seed = new Float32Array(n * 2 * 4)
    const end = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const s = [R(), R(), R(), R()]
      for (let e = 0; e < 2; e++) {
        const k = i * 2 + e
        seed.set(s, k * 4)
        end[k] = e
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2)
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute float aEnd;
        uniform float uTime, uAmt;
        varying float vA; varying float vEnd;
        vec3 fly(float t) {
          float ang = aSeed.x * 6.2831853;
          float up = 0.5 + aSeed.y * 1.4;
          vec3 v = normalize(vec3(cos(ang), up, sin(ang))) * (0.7 + aSeed.z * 1.8);
          vec3 p = v * t - vec3(0.0, 3.2, 0.0) * t * t;
          p.y = max(p.y, 0.002);
          return p;
        }
        void main() {
          float life = 0.32 + 0.4 * aSeed.w;
          float ph = fract(uTime / life + aSeed.w * 7.31 + aSeed.x * 3.7);
          float t = ph * life;
          float tt = max(t - 0.035 * aEnd, 0.0);
          vec3 p = fly(tt);
          // only some sparks live at any moment; the rest wait
          float on = step(0.35, fract(aSeed.y * 13.7 + floor(uTime / life + aSeed.w * 7.31 + aSeed.x * 3.7) * 0.618));
          vA = uAmt * on * (1.0 - ph) * (1.0 - ph);
          vEnd = aEnd;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position + p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vEnd;
        void main() {
          vec3 hot = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.28, 0.12), vEnd);
          float a = vA * (1.0 - vEnd * 0.8);
          if (a <= 0.002) discard;
          gl_FragColor = vec4(hot * a * 3.0, 1.0);
        }
      `,
    })
    this.obj = new THREE.LineSegments(g, m)
    this.obj.frustumCulled = false
    this.obj.renderOrder = 3
  }
  set(time: number, amt: number) {
    this.u.uTime.value = time
    this.u.uAmt.value = amt
    this.obj.visible = amt > 0.002
  }
}

/** A stamped tin RF shield can: vented lid (pick-up spot in the middle), four walls, corner slits. */
export function shieldCan(): THREE.Group {
  const { w, d, h } = CAN
  const t = 0.012
  const g = new THREE.Group()
  // stamped nickel-silver: satin, so the lid reads bright from any angle
  const mat = new THREE.MeshStandardMaterial({ color: '#b9bec5', roughness: 0.5, metalness: 1, side: THREE.DoubleSide })
  // lid with a grid of vent holes, a clear pick-up disc in the middle
  const s = new THREE.Shape()
  s.moveTo(-w / 2, -d / 2)
  s.lineTo(w / 2, -d / 2)
  s.lineTo(w / 2, d / 2)
  s.lineTo(-w / 2, d / 2)
  s.closePath()
  const pitch = 0.094
  const r = 0.021
  const nx = Math.floor((w - 0.16) / pitch)
  const nz = Math.floor((d - 0.16) / pitch)
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = -((nx * pitch) / 2) + i * pitch
      const y = -((nz * pitch) / 2) + j * pitch + (i % 2 ? pitch / 2 : 0)
      if (Math.abs(y) > d / 2 - 0.08) continue
      if (Math.hypot(x, y) < 0.21) continue
      const p = new THREE.Path()
      p.absarc(x, y, r, 0, Math.PI * 2, true)
      s.holes.push(p)
    }
  const lid = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 3 })
  lid.rotateX(-Math.PI / 2)
  lid.translate(0, h - t, 0)
  // walls (a hair short of the corners: the stamped slits)
  const gap = 0.02
  const walls: THREE.BufferGeometry[] = []
  for (const sgn of [-1, 1]) {
    const a = new THREE.BoxGeometry(w - 2 * gap, h - t, t)
    a.translate(0, (h - t) / 2, (sgn * (d - t)) / 2)
    const b = new THREE.BoxGeometry(t, h - t, d - 2 * gap)
    b.translate((sgn * (w - t)) / 2, (h - t) / 2, 0)
    walls.push(a.toNonIndexed(), b.toNonIndexed())
    a.dispose()
    b.dispose()
  }
  // a stamped stiffening rim around the pick-up disc
  const rim = new THREE.TorusGeometry(0.21, 0.008, 6, 40)
  rim.rotateX(Math.PI / 2)
  rim.translate(0, h + 0.001, 0)
  const parts = [lid.index ? lid.toNonIndexed() : lid, ...walls, rim.toNonIndexed()]
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.deleteAttribute(k)
  const merged = mergeGeometries(parts)!
  parts.forEach(p => p.dispose())
  rim.dispose()
  mat.envMapIntensity = 1.5
  const mesh = new THREE.Mesh(merged, mat)
  g.add(mesh)
  // dark inside (so the vents read as holes, not see-through)
  const inner = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * t, 0.001, d - 2 * t), new THREE.MeshBasicMaterial({ color: '#030405' }))
  inner.position.y = h - t - 0.03
  g.add(inner)
  return g
}

/** The pick-and-place head: a steel shaft, a collar and a black rubber tip. Tip at y = 0. */
export function nozzle(): THREE.Group {
  const g = new THREE.Group()
  const steel = new THREE.MeshStandardMaterial({ color: '#8d949c', roughness: 0.28, metalness: 1 })
  const dark = new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.45, metalness: 0.6 })
  const rubber = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.85 })
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.07, 28), rubber)
  tip.position.y = 0.035
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 20), steel)
  shaft.position.y = 0.07 + 0.6
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 28), dark)
  collar.position.y = 1.4
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 6, 32), dark)
  body.position.y = 1.55 + 3
  g.add(tip, shaft, collar, body)
  return g
}

/** A soft hexagonal aperture disc with a brighter rim (6-blade iris bokeh). */
function hexTexture(): THREE.CanvasTexture {
  const N = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')!
  const hex = (r: number) => {
    g.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6
      const x = N / 2 + Math.cos(a) * r
      const y = N / 2 + Math.sin(a) * r
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    }
    g.closePath()
  }
  // soft edge: stacked hexes; the rim a touch brighter than the centre
  for (let k = 0; k < 10; k++) {
    const r = N * 0.46 - k * 1.2
    g.fillStyle = `rgba(255,255,255,${k < 3 ? 0.05 : 0.02})`
    hex(r)
    g.fill()
  }
  g.globalCompositeOperation = 'destination-out'
  g.fillStyle = 'rgba(0,0,0,0.35)'
  hex(N * 0.3)
  g.fill()
  return new THREE.CanvasTexture(cv)
}

/**
 * Out-of-focus lights far down the board (defocused LEDs and glints) — the
 * macro lens's bokeh, behind the subject. Slow twinkle only (≤ 0.2 Hz).
 */
export class Bokeh {
  group = new THREE.Group()
  private items: { s: THREE.Sprite; base: THREE.Color; ph: number; amp: number }[] = []
  private tint = new THREE.Color()
  constructor(n: number) {
    const tex = hexTexture()
    const R = rng(23)
    const palette = ['#fff1dc', '#fff1dc', '#ffe2b8', '#00ff85']
    for (let i = 0; i < n; i++) {
      const base = new THREE.Color(palette[Math.floor(R() * palette.length)])
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }))
      // spread across the far board, bigger (more defocused) the farther away
      const z = -5 - R() * 7
      const x = -5 + ((i + R() * 0.8) / n) * 13
      s.position.set(x, 0.15 + R() * 0.9, z)
      s.scale.setScalar(0.3 + (-z - 5) * 0.05 + R() * 0.35)
      s.renderOrder = 2
      this.group.add(s)
      this.items.push({ s, base, ph: R() * 6.28, amp: 0.35 + R() * 0.5 })
    }
  }
  /** level 0..1, `hot` 0..1 pushes the palette toward the surge red */
  set(time: number, level: number, hot: number, red: THREE.Color) {
    for (const it of this.items) {
      const tw = 0.7 + 0.3 * Math.sin(time * 0.9 + it.ph)
      this.tint.copy(it.base).lerp(red, hot * 0.75)
      it.s.material.color.copy(this.tint).multiplyScalar(level * it.amp * tw)
    }
    this.group.visible = level > 0.002
  }
}
