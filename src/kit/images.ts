import * as THREE from 'three'

/*
 * Screenshot loading that never janks (lessons from the Town/Press reviews):
 *  - don't await images in init (the site reveal waits for init)
 *  - decode OFF the main thread and resize at decode time
 *    (fetch → blob → createImageBitmap({ resizeWidth, resizeHeight }))
 *  - hand three a CanvasTexture (flipY works; ImageBitmap textures ignore it)
 *  - fall back to <img> + decode() where createImageBitmap resize is missing
 *
 *   const tex = placeholderTexture()           // bind this immediately
 *   whenRevealed().then(() => loadScreenshot(workImage(id), { width: 800 }))
 *     .then(t => { material.map = t; material.needsUpdate = true })
 */

/** Resolves once the loader has finished (window 'hark:reveal'), immediately if it already has. */
export function whenRevealed(): Promise<void> {
  if (document.documentElement.dataset.ready === '1') return Promise.resolve()
  return new Promise(r => window.addEventListener('hark:reveal', () => r(), { once: true }))
}

/** A 1×1 texture to bind until the real image arrives. */
export function placeholderTexture(color = '#1a1d24'): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const x = c.getContext('2d')!
  x.fillStyle = color
  x.fillRect(0, 0, 1, 1)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * Load an image as a texture, decoded off the main thread and resized to
 * `width` (height keeps the aspect ratio). Rejects on network errors.
 */
export async function loadScreenshot(url: string, { width = 800 } = {}): Promise<THREE.Texture> {
  let source: CanvasImageSource
  let w = width
  let h = Math.round(width * 0.625)
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
    source = bmp
  } catch {
    const img = new Image()
    img.src = url
    await img.decode()
    h = Math.round((w * img.naturalHeight) / img.naturalWidth)
    source = img
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(source, 0, 0, w, h)
  if ('close' in source && typeof (source as ImageBitmap).close === 'function') (source as ImageBitmap).close()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
