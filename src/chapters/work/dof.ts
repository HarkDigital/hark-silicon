import * as THREE from 'three'

/*
 * A macro lens's shallow depth of field, chapter-local: a "blur veil".
 *
 * A transmissive sheet lies just above the whole board (nothing on the board
 * is taller). three's transmission pass hands it a mip-mapped copy of the
 * opaque scene; per fragment the veil picks a mip (its roughness) from a
 * circle of confusion — how far the board below is from the focus distance —
 * and fades itself out where the board is in focus, so the sharp full-res
 * image shows through there. Moving `focus` racks focus.
 *
 * Transparent things (signal pulses, LED glows, contact shadows) draw after
 * the veil; the pulse shader applies the same circle of confusion itself.
 * Desktop only (the transmission pass renders the opaque scene again at half
 * resolution).
 */

export interface DofUniforms {
  /** focus distance from the camera (cm) */
  uFocus: { value: number }
  /** depth either side of the focus that stays sharp (cm) */
  uBand: { value: number }
  /** aperture: blur per unit of relative defocus (0 = off) */
  uAmount: { value: number }
}

export const COC_GLSL = /* glsl */ `
  float wkCocAt(float d) {
    return uAmount * max(abs(d - uFocus) - uBand, 0.0) / max(d, 0.1);
  }
`

export function dofUniforms(): DofUniforms {
  return { uFocus: { value: 20 }, uBand: { value: 2 }, uAmount: { value: 0 } }
}

export function createVeil(u: DofUniforms, x0: number, z0: number, x1: number, z1: number, y = 1.0): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.2,
    transmission: 1,
    thickness: 0,
    ior: 1.5,
    specularIntensity: 0,
    transparent: true,
    depthWrite: false,
  })
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFocus, uBand, uAmount;\nfloat wkCoc = 0.0;\n${COC_GLSL}`)
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        {
          float dv = length(vWorldPosition - cameraPosition);
          // follow the ray on down to the board under the veil
          float t = cameraPosition.y / max(cameraPosition.y - vWorldPosition.y, 0.05);
          wkCoc = wkCocAt(dv * clamp(t, 1.0, 1.6));
          roughnessFactor = clamp(wkCoc, 0.04, 0.42);
        }
        `,
      )
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= smoothstep(0.0, 0.05, wkCoc);')
  }
  mat.customProgramCacheKey = () => 'wk-veil-v1'
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2)
  mesh.renderOrder = 1
  return mesh
}
