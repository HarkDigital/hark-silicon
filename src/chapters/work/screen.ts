import * as THREE from 'three'
import { placeholderTexture } from '../../kit/images'

/*
 * A board-mounted display's cover glass: real glossy glass (the studio's
 * softboxes slide across it as the camera moves) with the panel's light as
 * emission underneath. The glass covers the black print border and the
 * active area; the screenshot is the active area's emission.
 *
 * Boot, all scroll-driven:
 *   boot 0..1   the backlight comes up (black pixels glow a faint blue-grey,
 *               brighter at the LED edge)
 *   scan 0..1   a thin signal-green scan line writes the image top → bottom
 */

export interface ScreenUniforms {
  uBoot: { value: number }
  uScan: { value: number }
  uBright: { value: number }
  uActive: { value: THREE.Vector2 }
}

export function screenMaterial(active: THREE.Vector2): { mat: THREE.MeshStandardMaterial; u: ScreenUniforms } {
  const u: ScreenUniforms = {
    uBoot: { value: 0 },
    uScan: { value: 0 },
    uBright: { value: 0.86 },
    uActive: { value: active },
  }
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.07,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: placeholderTexture('#0c0f14'),
  })
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBoot, uScan, uBright;\nuniform vec2 uActive;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        {
          vec2 q = (vEmissiveMapUv - 0.5) / uActive + 0.5;
          vec2 e2 = min(q, 1.0 - q);
          float inA = smoothstep(-0.0012, 0.0012, min(e2.x, e2.y));
          vec3 img = texture2D(emissiveMap, clamp(q, 0.0, 1.0)).rgb * uBright;
          float scanning = step(0.0001, uScan);
          float lineY = 1.0 - uScan;
          float shown = smoothstep(lineY - 0.0025, lineY + 0.0025, q.y) * scanning;
          // backlight bleeding through black liquid crystal, brighter at the LED edge (bottom)
          vec3 back = vec3(0.012, 0.016, 0.022) * (0.75 + 0.5 * (1.0 - q.y)) * uBoot;
          vec3 c = mix(back, img, shown);
          // the freshly written rows run a touch hot, then settle
          float fresh = exp(-max(q.y - lineY, 0.0) * 26.0) * shown * (1.0 - step(0.9999, uScan));
          c += img * fresh * 0.35;
          // the scan line itself
          float live = scanning * (1.0 - step(0.9999, uScan));
          float sl = exp(-pow2((q.y - lineY) * 190.0));
          c += vec3(0.45, 1.0, 0.7) * sl * 2.2 * live;
          totalEmissiveRadiance = c * inA;
        }
        `,
      )
  }
  mat.customProgramCacheKey = () => 'wk-screen-v1'
  return { mat, u }
}
