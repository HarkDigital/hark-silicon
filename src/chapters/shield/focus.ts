import * as THREE from 'three'

/*
 * Macro-lens focus falloff for the SURGE set (chapter-local).
 *
 * Every material in the chapter is cloned (the kit's cached materials are
 * shared with other chapters, so they are never patched in place) and fades
 * toward a dark defocus tone as it leaves a band around the focus distance:
 * the subject is crisp, the board behind it sinks into soft shadow the way a
 * shallow depth of field and a pooled key light do in a product macro.
 * Additive materials (signals, glows) dim instead. One shared uniform block:
 * a rack focus is a few float writes per frame.
 */

export const focus = {
  uFocus: { value: 6 },
  uNear: { value: 2.5 },
  uFar: { value: 4 },
  uAmt: { value: 0.9 },
  uFogCol: { value: new THREE.Color('#05070a') },
}

type Mode = 'opaque' | 'alpha' | 'add'

const DECL = /* glsl */ `
  varying float vFz;
  uniform float uFocus, uNear, uFar, uAmt;
  uniform vec3 uFogCol;
`
const FRAG = (mode: Mode) => /* glsl */ `
  {
    float dz = vFz - uFocus;
    float coc = dz > 0.0 ? smoothstep(0.0, uFar, dz) : smoothstep(0.0, uNear, -dz);
    coc *= uAmt;
    ${
      mode === 'opaque'
        ? 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, coc);'
        : mode === 'alpha'
          ? 'gl_FragColor.a *= 1.0 - coc * 0.9;'
          : 'gl_FragColor.rgb *= 1.0 - coc * 0.85;'
    }
  }
`

function patchBuiltin<M extends THREE.Material>(m: M, mode: Mode): M {
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, focus)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFz;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFz = -mvPosition.z;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DECL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FRAG(mode)}`)
  }
  m.customProgramCacheKey = () => `hs-shield-focus-${mode}`
  return m
}

function patchRaw(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  if (!/void\s+main\s*\(\s*\)\s*\{/.test(m.vertexShader) || !/\}\s*$/.test(m.fragmentShader.trim())) return m
  const vs = m.vertexShader.replace(/void\s+main\s*\(\s*\)\s*\{/, 'varying float vFz;\nvoid main() {\n  vFz = -(modelViewMatrix * vec4(position, 1.0)).z;')
  const f = m.fragmentShader.trim()
  const fs = DECL + f.slice(0, f.lastIndexOf('}')) + FRAG('add') + '\n}'
  m.vertexShader = vs
  m.fragmentShader = fs
  Object.assign(m.uniforms, focus)
  m.needsUpdate = true
  return m
}

/**
 * Patch every mesh / line material under `root`. Materials in `shared` (the
 * kit's cached MAT.* / MATI.* instances, used by other chapters too) are
 * cloned first; everything else belongs to this chapter and is patched in
 * place, so live references (Traces uniforms, LED lenses) keep working.
 *
 * Patched materials are keyed by material + instanced: an InstancedMesh never
 * shares a material with a plain Mesh (three would re-resolve the program on
 * every draw), so a material drawn by both kinds gets its own instanced clone.
 * Instanced meshes are converted first, so those clones are taken from the
 * pristine material, before any in-place patch.
 */
export function applyFocus(root: THREE.Object3D, shared: Set<THREE.Material>) {
  const inst: THREE.Mesh[] = []
  const plain: THREE.Mesh[] = []
  const drawnPlain = new Set<THREE.Material>()
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!(mesh.isMesh || (o as THREE.LineSegments).isLineSegments) || (o as THREE.Sprite).isSprite) return
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) inst.push(mesh)
    else {
      plain.push(mesh)
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m) drawnPlain.add(m)
    }
  })
  const done = new Map<string, THREE.Material>()
  const conv = (m: THREE.Material, instanced: boolean): THREE.Material => {
    const key = `${m.uuid}:${instanced ? 'i' : 'm'}`
    let c = done.get(key)
    if (c) return c
    const own = !shared.has(m) && !(instanced && drawnPlain.has(m))
    let src = m
    if (!own) {
      src = m.clone()
      // a raw shader's live uniforms (time, reach…) stay shared with the original
      if ((m as THREE.ShaderMaterial).isShaderMaterial) (src as THREE.ShaderMaterial).uniforms = (m as THREE.ShaderMaterial).uniforms
    }
    if ((src as THREE.ShaderMaterial).isShaderMaterial) c = patchRaw(src as THREE.ShaderMaterial)
    else c = patchBuiltin(src, src.blending === THREE.AdditiveBlending ? 'add' : src.transparent ? 'alpha' : 'opaque')
    done.set(key, c)
    return c
  }
  for (const [list, instanced] of [
    [inst, true],
    [plain, false],
  ] as const)
    for (const mesh of list) {
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(m => conv(m, instanced))
      else if (mesh.material) mesh.material = conv(mesh.material, instanced)
    }
}
