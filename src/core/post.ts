import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

/*
 * Post-processing for Hark Silicon: Render → Sanitize (NaN guard) → Bloom →
 * Output → FINAL.
 *
 * FINAL is a macro-lens finish (gentle aberration, vignette, fine grain,
 * flash and fade) plus the SEM CUT: approaching a chapter boundary a raster
 * beam sweeps down the frame and everything above it becomes a SCANNING
 * ELECTRON MICROSCOPE image — monochrome, edges glowing (secondary-electron
 * edge effect), grainy, with horizontal scan jitter. At the boundary the
 * image dissolves into beam noise (hiding the swap); after it, the beam
 * sweeps down again and the next chapter scans back into colour.
 *
 * `params.sem` (0..1) holds the SEM look on purpose (a microscope moment).
 * Keep the Post API (params / resetParams / setSize / render / compileAsync /
 * setFadeTone / cutSide) and the uTransition / uFade / uFlash / uGlitch
 * uniforms — the engine drives them.
 */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    /** 0..1, peaks exactly at a chapter boundary (engine-driven) */
    uTransition: { value: 0 },
    /** -1 approaching the boundary, +1 leaving it */
    uCutSide: { value: 1 },
    /** 0..1 signal interference (a surge, a glitch) */
    uGlitch: { value: 0 },
    uAberration: { value: 0.0012 },
    uGrain: { value: 0.028 },
    uVignette: { value: 0.34 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    /** 0..1 hold the SEM look */
    uSem: { value: 0 },
    uFadeColor: { value: new THREE.Color('#05070b') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDpr, uTransition, uCutSide, uGlitch, uAberration, uGrain, uVignette, uFlash, uFade, uSem;
    uniform vec2 uResolution;
    uniform vec3 uFadeColor;
    varying vec2 vUv;

    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float pow2(float x) { return x * x; }

    // the SEM rendition of the frame at uv
    vec3 sem(vec2 uv, float noise) {
      float row = floor(uv.y * uResolution.y / uDpr);
      // horizontal scan jitter per line (beam instability)
      uv.x += (hash(vec2(row, floor(uTime * 24.0))) - 0.5) * 0.0025 * (0.3 + noise);
      vec2 px = uDpr * 1.3 / uResolution;
      float l = luma(texture2D(tDiffuse, uv).rgb);
      float lx = luma(texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb) - luma(texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb);
      float ly = luma(texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb) - luma(texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb);
      float edge = sqrt(lx * lx + ly * ly);
      // SE edge effect: edges and slopes glow, flats sit mid-grey
      float v = 0.16 + pow2(clamp(l, 0.0, 1.0)) * 0.55 + clamp(edge * 2.6, 0.0, 0.75);
      float g = hash(uv * uResolution + fract(uTime * 13.7) * 71.0);
      v += (g - 0.5) * (0.12 + 0.55 * noise);
      // faint line structure of the raster
      v *= 0.94 + 0.06 * step(0.5, fract(row * 0.5));
      v = mix(v, g, noise * noise);
      return vec3(v) * vec3(0.93, 0.97, 1.0);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float gl = clamp(uGlitch, 0.0, 1.0);
      if (gl > 0.001) {
        float band = step(0.9, hash(vec2(floor(uv.y * 40.0), floor(uTime * 18.0))));
        uv.x += gl * (0.02 * band + 0.003 * sin(uv.y * 120.0 + uTime * 40.0));
      }

      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * uAberration).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * uAberration).b;

      // ---- SEM (held) and the SEM cut
      float t = clamp(uTransition, 0.0, 1.0);
      float y = 1.0 - uv.y;                                  // 0 at the top
      float e = t * t * (3.0 - 2.0 * t);
      float covered = 0.0;
      float beam = 0.0;
      if (t > 0.001) {
        if (uCutSide < 0.0) {
          float p = e * 1.15;                                  // beam going down, SEM above it
          covered = 1.0 - smoothstep(p - 0.01, p, y);
          beam = exp(-pow2((y - p) * 90.0));
        } else {
          float q = (1.0 - e) * 1.15;                          // after: colour above the beam, SEM below
          covered = smoothstep(q - 0.01, q, y);
          beam = exp(-pow2((y - q) * 90.0));
        }
      }
      float m = max(covered, clamp(uSem, 0.0, 1.0));
      if (m > 0.001) {
        float noise = smoothstep(0.62, 1.0, t);
        col = mix(col, sem(uv, noise), m);
      }
      col += vec3(0.75, 0.95, 1.0) * beam * 0.55 * step(0.001, t) * (1.0 - smoothstep(0.9, 1.0, t));

      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
      float v = 1.0 - smoothstep(0.35, 1.05, length(c * vec2(1.0, 0.9)) * 1.4);
      col *= mix(1.0, 0.6 + 0.4 * v, uVignette);
      col += (hash(vUv * uResolution + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/** minimum seconds between two white-flash onsets (WCAG 2.3.1) */
const FLASH_GAP = 0.4

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** wobble 0..1 */
  glitch: number
  /** white wash 0..1 */
  flash: number
  exposure: number
  /** 0..1 hold the SEM (electron microscope) look */
  sem: number
}

/** Bloom only catches HDR (> ~1.0): emissive lamps, LEDs, speculars. */
export const POST_DEFAULTS: PostParams = {
  bloomStrength: 0.55,
  bloomRadius: 0.5,
  bloomThreshold: 0.95,
  aberration: 0.0012,
  grain: 0.028,
  vignette: 0.34,
  glitch: 0,
  flash: 0,
  exposure: 1,
  sem: 0,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through bloom.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  /**
   * Chapters write targets here every frame (the engine resets them to
   * defaults first); values are damped so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  /** -1 while approaching a chapter boundary, +1 after it (engine-driven) */
  cutSide = 1
  fade = 0
  private lastFlashAt = -1e9
  private flashLive = false
  private flashOk = true

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled; MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: noMsaa ? 0 : 4,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new ShaderPass(SanitizeShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.4, 1.0)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.final = new ShaderPass(FinalShader)
    this.composer.addPass(this.final)
  }

  /** Colour the reduced-motion fade passes through. */
  setCutColor(color: THREE.ColorRepresentation) {
    ;(this.final.uniforms.uFadeColor.value as THREE.Color).set(color)
  }

  /** Engine hook (kept for compatibility; themes may tint the fade by scene tone). */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  /**
   * Compile every post-processing shader in parallel so the first composer
   * render doesn't block on synchronous links.
   */
  compileAsync(): Promise<unknown> {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const b = this.bloom as unknown as Record<string, unknown>
    const mats: THREE.Material[] = []
    const add = (m: unknown) => {
      if (m && (m as THREE.Material).isMaterial) mats.push(m as THREE.Material)
    }
    for (const pass of this.composer.passes) add((pass as unknown as { material?: unknown }).material)
    for (const m of (b.separableBlurMaterials as unknown[]) ?? []) add(m)
    add(b.compositeMaterial)
    add(b.blendMaterial)
    add(b.materialHighPassFilter)
    add(b.copyMaterial)
    return Promise.all(mats.map(m => this.renderer.compileAsync(new THREE.Mesh(quad.geometry, m), cam).catch(() => {})))
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
    this.final.uniforms.uDpr.value = dpr
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' ? p[key] : c[key] + (p[key] - c[key]) * k
    }

    // flash budget (WCAG 2.3.1): a flash starting within FLASH_GAP of the last is dropped
    if (c.flash > 0.02) {
      if (!this.flashLive) {
        this.flashLive = true
        this.flashOk = time - this.lastFlashAt >= FLASH_GAP
        if (this.flashOk) this.lastFlashAt = time
      }
      if (!this.flashOk) c.flash = 0
    } else this.flashLive = false
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    u.uVignette.value = c.vignette
    u.uFlash.value = c.flash
    u.uSem.value = c.sem
    u.uCutSide.value = this.cutSide
    u.uFade.value = this.fade
    this.composer.render(dt)
  }
}
