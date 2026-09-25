import * as THREE from 'three'

/*
 * Macro-lens depth of field, faked cheaply (chapter-local).
 *
 *  - withDof(material): every material in the set fades toward a dark
 *    "defocus" tone as it leaves a band around the focus distance (behind it:
 *    far range; in front: near range). Detail loses contrast the way a
 *    blurred background does; the subject stays crisp.
 *  - Bokeh: the bright things in the set (LEDs, specular glints on tin and
 *    gold) are ALSO drawn as camera-facing hexagonal discs whose size is the
 *    circle of confusion at their depth: sharp pin-points in focus, big faint
 *    discs out of it. Rack focus = move `dof.focus`.
 *
 * One uniform block is shared by every patched material, so a focus pull is a
 * few float writes per frame.
 */

export const dof = {
  uDofFocus: { value: 5 },
  /** defocus ramps (cm from the focus distance): in front of it, behind it */
  uDofNear: { value: new THREE.Vector2(1, 3) },
  uDofFar: { value: new THREE.Vector2(1, 4) },
  uDofAmt: { value: 0.9 },
  uDofColor: { value: new THREE.Color('#05070a') },
}

type Mode = 'opaque' | 'alpha' | 'add'

const DOF_FRAG = (mode: Mode) => /* glsl */ `
  {
    float dz = vDofZ - uDofFocus;
    float coc = dz > 0.0 ? smoothstep(uDofFar.x, uDofFar.y, dz) : smoothstep(uDofNear.x, uDofNear.y, -dz);
    coc *= uDofAmt;
    ${
      mode === 'opaque'
        ? 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uDofColor, coc);'
        : mode === 'alpha'
          ? // fully defocused: gone (no depth written, and no 0 * Inf = NaN from grazing speculars)
            'gl_FragColor.a *= 1.0 - coc; if (gl_FragColor.a < 0.003) discard; if (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0);'
          : 'gl_FragColor.rgb *= 1.0 - coc;'
    }
  }
`
const DOF_DECL = /* glsl */ `
  varying float vDofZ;
  uniform float uDofFocus, uDofAmt;
  uniform vec2 uDofNear, uDofFar;
  uniform vec3 uDofColor;
`

/** Patch a built-in material (standard / physical / basic) with the depth fade. */
export function withDof<M extends THREE.Material>(m: M, mode: Mode = m.transparent ? 'alpha' : 'opaque'): M {
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, dof)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vDofZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDofZ = -mvPosition.z;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DOF_DECL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${DOF_FRAG(mode)}`)
  }
  m.customProgramCacheKey = () => `hs-dof-${mode}`
  return m
}

/**
 * Shape of the kit's trace pulses at macro scale: a short bright head, a short
 * tail, a faint always-on glow (fractions of the pulse spacing).
 */
export const pulseShape = {
  uHsHead: { value: 0.012 },
  uHsTail: { value: 0.92 },
  uHsBase: { value: 0.012 },
}

/**
 * Patch a raw ShaderMaterial (the kit's trace pulses): additive output dims
 * with defocus, and the pulse shape is tightened where the source matches.
 * Falls back to the kit's look if the shader doesn't look as expected.
 */
export function withDofRaw(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  if (!/void\s+main\s*\(\s*\)\s*\{/.test(m.vertexShader) || !/\}\s*$/.test(m.fragmentShader.trim())) return m
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, dof, pulseShape)
    shader.vertexShader = shader.vertexShader.replace(
      /void\s+main\s*\(\s*\)\s*\{/,
      'varying float vDofZ;\nvoid main() {\n  vDofZ = -(modelViewMatrix * vec4(position, 1.0)).z;',
    )
    const f = shader.fragmentShader
      .trim()
      .replace('smoothstep(0.0, 0.035, 1.0 - ph)', 'smoothstep(0.0, uHsHead, 1.0 - ph)')
      .replace('smoothstep(0.55, 1.0, ph) * 0.35', 'smoothstep(uHsTail, 1.0, ph) * 0.5')
      .replace('a += 0.06 * uGlow', 'a += uHsBase * uGlow')
    shader.fragmentShader = DOF_DECL + 'uniform float uHsHead, uHsTail, uHsBase;\n' + f.slice(0, f.lastIndexOf('}')) + DOF_FRAG('add') + '\n}'
  }
  m.customProgramCacheKey = () => 'hs-dof-raw'
  return m
}

/**
 * Clone + patch every material under `root` (shared kit materials are never
 * modified in place — other chapters use them). Meshes with
 * userData.noDof keep their material.
 */
export function dofTree(root: THREE.Object3D, cache = new Map<string, THREE.Material>(), fadeOut = false) {
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || mesh.userData.noDof) return
    const swap = (m: THREE.Material) => {
      let c = cache.get(m.uuid)
      if (!c) {
        const k = m.clone()
        if (fadeOut) k.transparent = true
        c = withDof(k, fadeOut ? 'alpha' : undefined)
        cache.set(m.uuid, c)
      }
      return c
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  return cache
}

/* ------------------------------------------------------------------ bokeh */

export interface BokehSource {
  p: THREE.Vector3
  color: THREE.ColorRepresentation
  /** peak brightness when in focus */
  power: number
  /** 0 = steady (an LED); >0 = a specular glint that comes and goes with the view */
  glint: number
}

const BOKEH_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aColor;
  attribute vec3 aInfo; // power, glint, phase
  uniform float uDofFocus, uAperture, uMinR, uTanV, uGain;
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    // behind (or grazing) the lens: no disc
    if (-mv.z < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vCol = vec3(0.0); return; }
    float d = -mv.z;
    // circle of confusion as a fraction of the half screen height
    float coc = max(uMinR, uAperture * abs(d - uDofFocus) / d);
    float r = coc * d * uTanV;
    // energy spreads over the disc: big discs are faint
    float e = clamp(pow(uMinR / coc, 1.15), 0.035, 1.0);
    // a specular glint only shows from some directions
    vec3 toCam = normalize(cameraPosition - aCenter);
    float g = sin(aInfo.z * 6.2832 + dot(toCam, vec3(7.1, 3.3, 5.7)));
    // glints only exist as bokeh: in focus the geometry itself carries the highlight
    float glint = mix(1.0, smoothstep(0.35, 0.95, g) * smoothstep(0.015, 0.05, coc), step(0.001, aInfo.y));
    vCol = aColor * aInfo.x * e * glint * uGain;
    vUv = position.xy;
    // sit the disc in front of the surface it belongs to
    mv.xyz += normalize(-mv.xyz) * min(r, d * 0.35);
    mv.xy += position.xy * r;
    gl_Position = projectionMatrix * mv;
    if (vCol.r + vCol.g + vCol.b < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`
const BOKEH_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vCol;
  // a 9-blade iris: nearly round, a hint of polygon
  float irisD(vec2 p) {
    float r = length(p);
    float a = atan(p.y, p.x);
    float blade = cos(6.2832 / 9.0 * 0.5) / cos(mod(a, 6.2832 / 9.0) - 6.2832 / 18.0);
    return r / mix(1.0, blade, 0.35);
  }
  void main() {
    float d = irisD(vUv);
    float disc = 1.0 - smoothstep(0.62, 0.98, d);
    // a slightly brighter rim (spherical aberration), soft core
    float rim = smoothstep(0.45, 0.85, d) * disc;
    float a = disc * 0.5 + rim * 0.35;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vCol * a, 1.0);
  }
`

export class Bokeh {
  mesh: THREE.Mesh
  u = {
    uDofFocus: dof.uDofFocus,
    uAperture: { value: 0.16 },
    uMinR: { value: 0.006 },
    uTanV: { value: 0.3 },
    uGain: { value: 1 },
  }
  private info: THREE.InstancedBufferAttribute

  constructor(sources: BokehSource[]) {
    const n = Math.max(1, sources.length)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const c = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    const info = new Float32Array(n * 3)
    const tmp = new THREE.Color()
    sources.forEach((s, i) => {
      c.set([s.p.x, s.p.y, s.p.z], i * 3)
      tmp.set(s.color)
      col.set([tmp.r, tmp.g, tmp.b], i * 3)
      info.set([s.power, s.glint, (Math.sin(i * 91.7) * 0.5 + 0.5) * 7.3], i * 3)
    })
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(c, 3))
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3))
    this.info = new THREE.InstancedBufferAttribute(info, 3)
    g.setAttribute('aInfo', this.info)
    g.instanceCount = sources.length
    const m = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: BOKEH_VERT,
      fragmentShader: BOKEH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(g, m)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    this.mesh.userData.noDof = true
  }

  /** set the power of source i (LEDs powering on) */
  power(i: number, v: number) {
    const a = this.info.array as Float32Array
    if (Math.abs(a[i * 3] - v) < 1e-4) return
    a[i * 3] = v
    this.info.needsUpdate = true
  }
}
