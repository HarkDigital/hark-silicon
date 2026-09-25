import * as THREE from 'three'
import { rng } from '../../core/math'
import { logoShapes } from '../../logo/logo'

/*
 * Canvas textures for the Fab (process chapter): the perforated stainless
 * laminar-flow bench, the probed wafer's die grid, the photomask pattern
 * (also the latent image printed on the second wafer), the scope's LCD
 * graticule, the burn-in board's silkscreen, and a soft disc for contact
 * shadows / light pools. Everything is deterministic (seeded) so reloads and
 * screenshots match.
 */

const MONO = "'Martian Mono Variable', ui-monospace, monospace"

/** A canvas texture; `draw` runs now and again once webfonts are ready (text-bearing canvases). */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, o: { srgb?: boolean; fonts?: boolean } = {}): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  draw(g, w, h)
  const t = new THREE.CanvasTexture(cv)
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (o.fonts) {
    document.fonts?.ready.then(() => {
      g.clearRect(0, 0, w, h)
      draw(g, w, h)
      t.needsUpdate = true
    })
  }
  return t
}

/**
 * Perforated brushed stainless (a laminar-flow cleanroom bench): one tile
 * holds a staggered pair of holes. Repeat it across the bench.
 */
export function benchTexture(): THREE.CanvasTexture {
  const t = canvasTex(256, 256, (g, N) => {
    const r = rng(5)
    g.fillStyle = '#8a8e94'
    g.fillRect(0, 0, N, N)
    // brushed grain along x
    for (let i = 0; i < 320; i++) {
      const y = Math.floor(r() * N)
      const a = 0.025 + r() * 0.07
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`
      g.fillRect(0, y, N, 1)
    }
    // holes on a 60° stagger: corners + centre (tiles seamlessly)
    const hole = (x: number, y: number) => {
      g.beginPath()
      g.arc(x, y, N * 0.165, 0, Math.PI * 2)
      g.fillStyle = '#3a3d42'
      g.fill()
      g.beginPath()
      g.arc(x + 2, y + 2.5, N * 0.145, 0, Math.PI * 2)
      g.fillStyle = '#060708'
      g.fill()
    }
    for (const [x, y] of [
      [0, 0],
      [N, 0],
      [0, N],
      [N, N],
      [N / 2, N / 2],
    ])
      hole(x, y)
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/**
 * A wafer's top face: a grid of identical dies (the kit's die floorplan
 * stamped at `pitch`), partial dies at the edge, an edge-exclusion ring and a
 * flat. Mapped onto a CircleGeometry of radius R lying in XZ (uv from the
 * circle's own mapping): canvas x ↔ world x, canvas y ↔ world z.
 */
export function waferTexture(size: number, die: CanvasImageSource, R: number, pitch: number, dieSize: number): THREE.CanvasTexture {
  return canvasTex(size, size, (g, N) => {
    const k = N / (2 * R)
    const px = (x: number) => (x + R) * k
    g.fillStyle = '#56526a'
    g.fillRect(0, 0, N, N)
    g.save()
    g.beginPath()
    g.arc(N / 2, N / 2, R * 0.975 * k, 0, Math.PI * 2)
    g.clip()
    // scribe streets (a touch brighter than the dies)
    g.fillStyle = '#7b7890'
    g.fillRect(0, 0, N, N)
    const n = Math.ceil(R / pitch) + 1
    const s = dieSize * k
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const cx = i * pitch
        const cz = j * pitch
        const h = dieSize / 2
        const inside = [
          [cx - h, cz - h],
          [cx + h, cz - h],
          [cx - h, cz + h],
          [cx + h, cz + h],
        ].every(([x, z]) => Math.hypot(x, z) < R * 0.955)
        const x0 = px(cx) - s / 2
        const y0 = px(cz) - s / 2
        if (inside) g.drawImage(die, x0, y0, s, s)
        else {
          // partial edge dies: printed, never finished
          g.fillStyle = '#433f58'
          g.fillRect(x0, y0, s, s)
          g.fillStyle = 'rgba(200,190,240,0.08)'
          g.fillRect(x0 + s * 0.1, y0 + s * 0.1, s * 0.8, s * 0.8)
        }
      }
    }
    g.restore()
    // edge bead ring
    g.strokeStyle = 'rgba(220,215,240,0.25)'
    g.lineWidth = N * 0.004
    g.beginPath()
    g.arc(N / 2, N / 2, R * 0.985 * k, 0, Math.PI * 2)
    g.stroke()
  })
}

/** Draw one field of a circuit layer (Manhattan lines, pads, a memory grating) into g at (x, y, s). */
function drawField(g: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number) {
  const r = rng(seed)
  const u = s / 100
  g.save()
  g.translate(x, y)
  // pad ring
  for (let i = 0; i < 10; i++) {
    const t = 12 + i * 8.4
    g.fillRect(t * u, 3 * u, 4.5 * u, 4.5 * u)
    g.fillRect(t * u, 92.5 * u, 4.5 * u, 4.5 * u)
    g.fillRect(3 * u, t * u, 4.5 * u, 4.5 * u)
    g.fillRect(92.5 * u, t * u, 4.5 * u, 4.5 * u)
  }
  // a memory grating block
  for (let i = 0; i < 16; i++) g.fillRect(14 * u, (14 + i * 2.1) * u, 30 * u, 1.05 * u)
  // buses and routing
  for (let i = 0; i < 9; i++) {
    const yy = 52 + i * 4.4
    const x0 = 12 + r() * 10
    const x1 = 50 + r() * 38
    g.fillRect(x0 * u, yy * u, (x1 - x0) * u, (1 + r() * 1.4) * u)
  }
  for (let i = 0; i < 8; i++) {
    const xx = 52 + i * 4.6
    const y0 = 12 + r() * 8
    const y1 = 30 + r() * 22
    g.fillRect(xx * u, y0 * u, (1 + r() * 1.2) * u, (y1 - y0) * u)
  }
  // a couple of analog blocks
  g.fillRect(58 * u, 58 * u, 12 * u, 9 * u)
  g.fillRect(74 * u, 62 * u, 13 * u, 18 * u)
  g.clearRect(76 * u, 64 * u, 9 * u, 14 * u)
  g.fillRect(78 * u, 66 * u, 5 * u, 10 * u)
  g.restore()
}

/**
 * The photomask pattern (white = chrome) over a square of side L: a chrome
 * border with alignment crosses, a clear window of radius R holding a grid
 * of fields. The same canvas is the latent image printed on the wafer below
 * (proximity printing is 1:1).
 */
export function maskTexture(size: number, L: number, R: number, pitch: number): THREE.CanvasTexture {
  return canvasTex(
    size,
    size,
    (g, N) => {
      const k = N / L
      g.fillStyle = '#000'
      g.fillRect(0, 0, N, N)
      g.fillStyle = '#fff'
      // chrome border outside the window
      g.beginPath()
      g.rect(0, 0, N, N)
      g.arc(N / 2, N / 2, R * 1.02 * k, 0, Math.PI * 2, true)
      g.fill('evenodd')
      // alignment crosses cut into the border
      g.fillStyle = '#000'
      const cross = (cx: number, cy: number) => {
        const a = N * 0.022
        const b = N * 0.0035
        g.fillRect(cx - a, cy - b, a * 2, b * 2)
        g.fillRect(cx - b, cy - a, b * 2, a * 2)
      }
      const m = N * 0.06
      cross(m, N / 2)
      cross(N - m, N / 2)
      cross(N / 2, m)
      cross(N / 2, N - m)
      // the fields
      g.fillStyle = '#fff'
      const n = Math.ceil(R / pitch) + 1
      const s = pitch * 0.92 * k
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const cx = i * pitch
          const cz = j * pitch
          const h = pitch * 0.46
          const inside = [
            [cx - h, cz - h],
            [cx + h, cz - h],
            [cx - h, cz + h],
            [cx + h, cz + h],
          ].every(([x, z]) => Math.hypot(x, z) < R * 0.97)
          if (!inside) continue
          drawField(g, N / 2 + cx * k - s / 2, N / 2 + cz * k - s / 2, s, 17)
        }
      }
      // scribe lanes: fine chrome grid between fields
      g.globalAlpha = 0.9
      for (let i = -n; i <= n + 1; i++) {
        const p = N / 2 + (i - 0.5) * pitch * k
        g.save()
        g.beginPath()
        g.arc(N / 2, N / 2, R * 0.97 * k, 0, Math.PI * 2)
        g.clip()
        g.fillRect(p - 1, 0, 2, N)
        g.fillRect(0, p - 1, N, 2)
        g.restore()
      }
      g.globalAlpha = 1
    },
    { srgb: false },
  )
}

/** The probe station scope's LCD: dim graticule + mono readouts (the waveform is drawn live in a shader). */
export function scopeTexture(w = 640, h = 400): THREE.CanvasTexture {
  return canvasTex(
    w,
    h,
    (g, W, H) => {
      g.fillStyle = '#040807'
      g.fillRect(0, 0, W, H)
      const top = H * 0.13
      const bot = H * 0.87
      const gh = bot - top
      g.strokeStyle = 'rgba(140,255,200,0.13)'
      g.lineWidth = 1
      for (let i = 0; i <= 10; i++) {
        const x = Math.round(W * 0.04 + ((W * 0.92) / 10) * i) + 0.5
        g.beginPath()
        g.moveTo(x, top)
        g.lineTo(x, bot)
        g.stroke()
      }
      for (let i = 0; i <= 8; i++) {
        const y = Math.round(top + (gh / 8) * i) + 0.5
        g.beginPath()
        g.moveTo(W * 0.04, y)
        g.lineTo(W * 0.96, y)
        g.stroke()
      }
      // centre axis ticks
      g.strokeStyle = 'rgba(140,255,200,0.28)'
      for (let i = 0; i <= 50; i++) {
        const x = Math.round(W * 0.04 + ((W * 0.92) / 50) * i) + 0.5
        g.beginPath()
        g.moveTo(x, top + gh / 2 - 4)
        g.lineTo(x, top + gh / 2 + 4)
        g.stroke()
      }
      g.font = `500 ${Math.round(H * 0.052)}px ${MONO}`
      g.fillStyle = 'rgba(150,255,205,0.75)'
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      g.fillText('CH1  500 mV/div', W * 0.04, H * 0.065)
      g.textAlign = 'right'
      g.fillText('1.0 ms/div  RUN', W * 0.96, H * 0.065)
      g.textAlign = 'left'
      g.fillStyle = 'rgba(150,255,205,0.5)'
      g.fillText('PROBE 01 · DIE 0,0', W * 0.04, H * 0.935)
      g.textAlign = 'right'
      g.fillText('VDD 1.8V', W * 0.96, H * 0.935)
    },
    { fonts: true },
  )
}

/** Draw the Hark mark (normalised shapes), `size` px tall, centred at (cx, cy). */
function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, -size)
  g.beginPath()
  for (const s of logoShapes()) {
    s.getPoints(40).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    for (const h of s.holes) {
      h.getPoints(20).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
  }
  g.fill('evenodd')
  g.restore()
}

export interface BoardLayout {
  /** board size (cm) */
  w: number
  d: number
  /** socket centres (board-local XZ) and outer size */
  sockets: THREE.Vector2[]
  socket: number
  /** LED positions (board-local XZ) */
  leds: THREE.Vector2[]
}

/** The burn-in board's silkscreen, in board-local XZ: an alphaMap (white ink on opaque black; three reads green). */
export function boardSilkTexture(L: BoardLayout, px: number): THREE.CanvasTexture {
  const W = Math.round(L.w * px)
  const H = Math.round(L.d * px)
  return canvasTex(
    W,
    H,
    (g, cw, ch) => {
      const k = cw / L.w
      const X = (x: number) => (x + L.w / 2) * k
      const Z = (z: number) => (z + L.d / 2) * k
      g.fillStyle = '#000'
      g.fillRect(0, 0, cw, ch)
      g.strokeStyle = '#fff'
      g.fillStyle = '#fff'
      g.lineWidth = Math.max(2, k * 0.035)
      g.textBaseline = 'middle'
      const s = L.socket
      L.sockets.forEach((c, i) => {
        // socket courtyard with a pin-1 notch
        const x0 = X(c.x - s / 2 - 0.12)
        const y0 = Z(c.y - s / 2 - 0.12)
        const ww = (s + 0.24) * k
        g.beginPath()
        g.moveTo(x0 + 0.3 * k, y0)
        g.lineTo(x0 + ww, y0)
        g.lineTo(x0 + ww, y0 + ww)
        g.lineTo(x0, y0 + ww)
        g.lineTo(x0, y0 + 0.3 * k)
        g.closePath()
        g.stroke()
        // designator at the top-right corner (clear of the PASS LED of the row behind)
        g.font = `600 ${Math.round(k * 0.26)}px ${MONO}`
        g.textAlign = 'right'
        g.fillText(`U${i + 1}`, x0 + ww, y0 - 0.26 * k)
        g.textAlign = 'left'
        // LED outline + PASS
        const l = L.leds[i]
        g.strokeRect(X(l.x - 0.16), Z(l.y - 0.1), 0.32 * k, 0.2 * k)
        g.font = `600 ${Math.round(k * 0.2)}px ${MONO}`
        g.fillText('PASS', X(l.x + 0.26), Z(l.y) + 1)
        g.font = `500 ${Math.round(k * 0.15)}px ${MONO}`
        g.fillText(`D${i + 1}`, X(l.x - 0.16), Z(l.y + 0.27))
      })
      // title block
      g.textAlign = 'left'
      g.font = `600 ${Math.round(k * 0.34)}px ${MONO}`
      g.fillText('HK-BIB-08', X(-L.w / 2 + 0.7), Z(L.d / 2 - 0.62))
      g.font = `500 ${Math.round(k * 0.2)}px ${MONO}`
      g.fillText('BURN-IN · 8 SITE · REV A', X(-L.w / 2 + 0.7), Z(L.d / 2 - 0.25))
      drawMark(g, X(L.w / 2 - 1.0), Z(L.d / 2 - 0.55), k * 0.6)
      // fiducials
      for (const [fx, fz] of [
        [-L.w / 2 + 0.45, -L.d / 2 + 1.35],
        [L.w / 2 - 0.45, -L.d / 2 + 1.35],
        [L.w / 2 - 0.45, L.d / 2 - 1.3],
      ]) {
        g.beginPath()
        g.arc(X(fx), Z(fz), 0.14 * k, 0, Math.PI * 2)
        g.stroke()
      }
    },
    { fonts: true, srgb: false },
  )
}

/*
 * The two soft masks below feed `alphaMap`, which three reads from the GREEN
 * channel (not alpha): they paint grey on OPAQUE black, never white fading to
 * transparent (that would read as a hard-edged solid shape).
 */

/** A soft radial disc (grey on opaque black; an alphaMap): contact shadows and light pools. */
export function softDisc(size = 128, hard = 0): THREE.CanvasTexture {
  return canvasTex(
    size,
    size,
    (g, N) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, N, N)
      const gr = g.createRadialGradient(N / 2, N / 2, N * 0.5 * hard, N / 2, N / 2, N / 2)
      gr.addColorStop(0, '#fff')
      gr.addColorStop(0.5, 'rgb(115,115,115)')
      gr.addColorStop(1, '#000')
      g.fillStyle = gr
      g.fillRect(0, 0, N, N)
    },
    { srgb: false },
  )
}

/** A soft rounded-rectangle mask (grey on opaque black; an alphaMap) for boards / plates: white centre fading to the edges. */
export function softRect(w = 256, h = 256, feather = 0.18): THREE.CanvasTexture {
  return canvasTex(
    w,
    h,
    (g, W, H) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, W, H)
      // (ctx.filter is missing in Safari: blur via a shadow cast from off-canvas)
      const f = Math.min(W, H) * feather
      g.shadowColor = '#fff'
      g.shadowBlur = f
      g.shadowOffsetX = W * 2
      g.fillStyle = '#fff'
      g.fillRect(f - W * 2, f, W - 2 * f, H - 2 * f)
    },
    { srgb: false },
  )
}

/**
 * The lithography light curtain's mask (grey on opaque black; an alphaMap):
 * soft at its two sides and falling off toward the wafer, (0.35 + 0.65·v)²
 * from the wafer (v = 0) up to the slit (v = 1).
 */
export function curtainMask(w = 64, h = 128): THREE.CanvasTexture {
  return canvasTex(
    w,
    h,
    (g, W, H) => {
      const img = g.createImageData(W, H)
      const ss = (a: number, b: number, x: number) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      for (let r = 0; r < H; r++) {
        const v = 1 - (r + 0.5) / H // canvas top row = uv.y 1 (flipY)
        const y = 0.35 + 0.65 * v
        for (let c = 0; c < W; c++) {
          const u = (c + 0.5) / W
          const x = 1 - ss(0.42, 0.5, Math.abs(u - 0.5))
          const k = Math.round(255 * x * y * y)
          const o = (r * W + c) * 4
          img.data[o] = img.data[o + 1] = img.data[o + 2] = k
          img.data[o + 3] = 255
        }
      }
      g.putImageData(img, 0, 0)
    },
    { srgb: false },
  )
}
