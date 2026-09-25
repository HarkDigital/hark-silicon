import * as THREE from 'three'

/**
 * Cached texture loading with a shared progress counter the loader screen
 * reads. Chapters call `assets.texture(url)` during init.
 */
export class Assets {
  private cache = new Map<string, Promise<THREE.Texture>>()
  private loader = new THREE.TextureLoader()
  total = 0
  done = 0
  onProgress: (done: number, total: number) => void = () => {}

  constructor(private renderer: THREE.WebGLRenderer) {}

  texture(url: string, opts: { srgb?: boolean; repeat?: boolean } = {}): Promise<THREE.Texture> {
    const key = `${url}|${opts.srgb !== false}|${!!opts.repeat}`
    const hit = this.cache.get(key)
    if (hit) return hit
    this.total++
    this.onProgress(this.done, this.total)
    const p = new Promise<THREE.Texture>((resolve, reject) => {
      this.loader.load(
        url,
        tex => {
          if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace
          if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
          tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
          this.done++
          this.onProgress(this.done, this.total)
          resolve(tex)
        },
        undefined,
        err => {
          this.done++
          this.onProgress(this.done, this.total)
          reject(err)
        },
      )
    })
    this.cache.set(key, p)
    return p
  }

  /** Track any other async work (e.g. fonts) in the loader's progress. */
  track<T>(p: Promise<T>): Promise<T> {
    this.total++
    this.onProgress(this.done, this.total)
    return p.finally(() => {
      this.done++
      this.onProgress(this.done, this.total)
    })
  }
}

/** Resolve a file in /public against the deploy base (GitHub Pages subpath). */
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
