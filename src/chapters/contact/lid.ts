import * as THREE from 'three'
import { logoShapes } from '../../logo/logo'
import { rng } from '../../core/math'

/*
 * POWER ON · the lid of U1: the same HARK-1 part the story opened on (the
 * hero), laser-etched into EDM-textured mould compound. Grey etch, no glow:
 * the mark reads because the key rakes across the recessed etch.
 *
 * Two textures from one layout:
 *   map  albedo (dark compound, light-grey raster etch, ejector-pin marks)
 *   aux  R = height (bump: the etch is recessed), G = roughness (the etch is
 *        rougher, the ejector marks polished)
 * The map doubles as a faint emissive so the etch reads as laser marking
 * under any light (the compound stays dark).
 */

const MONO = "'Martian Mono Variable', ui-monospace, monospace"
const GROT = "'Space Grotesk Variable', system-ui, sans-serif"

export interface Lid {
  material: THREE.MeshStandardMaterial
  /** the albedo (the etch is its bright part) */
  map: THREE.CanvasTexture
  /** redraw once the etch fonts are in */
  redraw(): void
}

function canvas(n: number) {
  const c = document.createElement('canvas')
  c.width = c.height = n
  return { c, g: c.getContext('2d')! }
}

/** a small tile of 1–2 px specks (fast: filled as a pattern, not per speck) */
function speckTile(seed: number, density: number, colour: (r: number) => [number, number, number, number]) {
  const T = 256
  const { c, g } = canvas(T)
  const img = g.createImageData(T, T)
  const R = rng(seed)
  for (let i = 0; i < T * T; i++) {
    if (R() >= density) continue
    const [r, gg, b, a] = colour(R())
    const big = R() < 0.2
    for (const o of big ? [0, 1, T, T + 1] : [0]) {
      const k = ((i + o) % (T * T)) * 4
      img.data[k] = r
      img.data[k + 1] = gg
      img.data[k + 2] = b
      img.data[k + 3] = a
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, -size)
  g.beginPath()
  for (const s of logoShapes()) {
    s.getPoints(64).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    for (const hole of s.holes) {
      hole.getPoints(32).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
  }
  g.restore()
}

export function buildLid(N: number): Lid {
  const albedo = canvas(N)
  const aux = canvas(N)
  const speckA = speckTile(11, 0.035, r => (r < 0.5 ? [40, 43, 48, 150] : [8, 9, 11, 140]))
  const speckX = speckTile(12, 0.035, r => (r < 0.5 ? [236, 170, 0, 140] : [236, 110, 0, 140]))

  const draw = () => {
    // the etch as a mask (drawn once per redraw, released after)
    const mask = canvas(N)
    const e = mask.g
    e.fillStyle = '#fff'
    drawMark(e, N * 0.5, N * 0.39, N * 0.4)
    e.fill('evenodd')
    e.textAlign = 'center'
    e.textBaseline = 'alphabetic'
    e.font = `600 ${Math.round(N * 0.078)}px ${GROT}`
    e.fillText('HARK-1', N * 0.5, N * 0.715)
    e.font = `500 ${Math.round(N * 0.034)}px ${MONO}`
    e.fillText('MAKE THE INTERNET LISTEN', N * 0.5, N * 0.785)
    e.fillText('HK-0N  ·  REV A  ·  PHL', N * 0.5, N * 0.84)
    const tint = canvas(N)

    const layer = (g: CanvasRenderingContext2D, base: string, speck: HTMLCanvasElement, eject: string, dimple: string, etch: string, raster: string | null) => {
      g.globalCompositeOperation = 'source-over'
      g.fillStyle = base
      g.fillRect(0, 0, N, N)
      // EDM mould texture
      const pat = g.createPattern(speck, 'repeat')
      if (pat) {
        g.fillStyle = pat
        g.fillRect(0, 0, N, N)
      }
      // ejector-pin marks (shallow polished circles) and the pin-1 dimple
      g.fillStyle = eject
      for (const [x, y] of [
        [0.86, 0.14],
        [0.14, 0.86],
        [0.86, 0.86],
      ]) {
        g.beginPath()
        g.arc(x * N, y * N, N * 0.045, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = dimple
      g.beginPath()
      g.arc(0.1 * N, 0.1 * N, N * 0.032, 0, Math.PI * 2)
      g.fill()
      // the laser etch: the mask filled with the etch tone (+ a raster)
      const t = tint.g
      t.globalCompositeOperation = 'source-over'
      t.clearRect(0, 0, N, N)
      t.drawImage(mask.c, 0, 0)
      t.globalCompositeOperation = 'source-in'
      t.fillStyle = etch
      t.fillRect(0, 0, N, N)
      if (raster) {
        t.globalCompositeOperation = 'source-atop'
        t.fillStyle = raster
        for (let y = 0; y < N; y += 3) t.fillRect(0, y, N, 1)
      }
      g.drawImage(tint.c, 0, 0)
    }
    layer(albedo.g, '#141619', speckA, '#18191c', '#0d0e10', '#c6cacf', 'rgba(60,64,70,0.5)')
    // aux: R height (etch recessed, dimple deep), G roughness (etch rough, ejector marks polished)
    layer(aux.g, 'rgb(255,138,0)', speckX, 'rgb(232,92,0)', 'rgb(64,58,0)', 'rgb(140,230,0)', null)
    mask.c.width = mask.c.height = 0
    tint.c.width = tint.c.height = 0
  }
  draw()

  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }
  const map = mk(albedo.c, true)
  const auxTex = mk(aux.c, false)
  const material = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: auxTex,
    bumpMap: auxTex,
    bumpScale: 1.4,
    roughness: 1,
    metalness: 0,
    emissiveMap: map,
    emissive: new THREE.Color('#a3a7ad'),
  })
  return {
    material,
    map,
    redraw() {
      draw()
      map.needsUpdate = true
      auxTex.needsUpdate = true
    },
  }
}
