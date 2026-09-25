import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { reveal, setRise } from '../../core/dom'
import { clamp, damp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { S } from '../../kit/silicon'
import { buildHud, measureHud, type Hud, type HudLayout, type Rect } from './hud'
import { buildBoard, type Board } from './board'
import { BD, BW, SEQ, U1C, U1_LID_Y } from './layout'
import './contact.css'

/*
 * CONTACT · "Power On" — the final chapter, and the bookend of the first.
 *
 * The story opened on HARK-1 (the hero's etched chip); it closes on it. The
 * same part, soldered to the finished Hark board, shot as a product macro,
 * powering on. Everything is scroll-driven through one network "front":
 *
 *   0.00–0.09  under the SEM cut: a grazing macro across HARK-1's lid (grey
 *              laser etch, a warm key raking it from behind, tin leads on
 *              gold pads), the board dark copper
 *   0.09       D1 · PWR lights: the single status LED behind the chip
 *   0.10–0.24  signals leave every peripheral (flash, crystal, sensors, the
 *              header, USB) as green pulses racing along the copper, timed to
 *              converge on U1 at the same instant
 *   0.24–0.27  U1 hears them: a warm glint crosses its etch, then its outputs
 *              race to the status LEDs (SIG LINK ACT RDY); the camera rises,
 *              the board's title silk sliding out from under the panel
 *   0.28–0.36  the landing (nav and heading stop at 0.3): beside the settled
 *              panel, the title block, HARK-1 and 'SAY HELLO · email', whole
 *   0.36–0.92  a slow, precise pull-up to a top-down still of the whole board
 *   0.92–1.00  stillness: the board, 'SAY HELLO · mike@hark.digital'
 *
 * Green is the signal only: LEDs, pulse heads, the pulses behind them. The
 * traces themselves stay copper.
 *
 * The camera orbits a focus point (el/az/R keys, a C1 Hermite track) and is
 * lens-shifted so the focus lands in the free space beside the datasheet
 * panel (measured, see hud.ts). The landing is FITTED (distance and focus)
 * so its silk lines always sit whole inside that space, never under the
 * chrome. frame.time only drives the pulses riding behind the front and the
 * ACT LED's breath; both hold still when the visitor pauses motion.
 */

const FOV = 28
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
/** art-rect scale the close-up distances were tuned for (1440×900 beside the panel) */
const NOMINAL_ART = 0.83

interface Key {
  t: number
  /** focus (board space) */
  f: [number, number, number]
  /** distance (close keys are scaled by the art size; fitted keys replace it) */
  r: number
  el: number
  az: number
  /** key light: elevation, and azimuth offset from straight behind the subject (deg) */
  kEl: number
  kAz: number
  key: number
  /** studio reflections: strength, rotation relative to the camera (rad) */
  env: number
  turn: number
  /** frame these points (x, y, z) in the art rect instead of using r (f is re-centred) */
  fit?: readonly (readonly [number, number, number])[]
}

const LX = U1C.x
const LZ = U1C.y
/**
 * The landing frame: HARK-1's lid in the middle, the board's title block (the
 * Hark mark, 'Hark Digital Design') behind it and the J2 header with
 * 'SAY HELLO · mike@hark.digital' in front, every line whole inside the art
 * rect (a close framing would slice one of them under the chrome).
 */
const LAND_FIT = [
  // the title block
  [-4.38, 0, -3.02],
  [-0.7, 0, -3.02],
  [-4.38, 0, -2.16],
  [-0.7, 0, -2.16],
  // U1 with its leads and pads
  [LX - 1.36, 0, LZ - 1.36],
  [LX + 1.36, 0, LZ - 1.36],
  [LX - 1.36, 0, LZ + 1.36],
  [LX + 1.36, 0, LZ + 1.36],
  [LX + 1.05, U1_LID_Y, LZ + 1.05],
  // J2 (its gold posts stand 6 mm tall), 'SAY HELLO · email' and the tagline under it
  [-5.2, 0, 2.3],
  [-4.9, 0.6, 2.7],
  [-5.2, 0, 3.16],
  [1.14, 0, 2.58],
  [1.14, 0, 3.16],
] as const
const KEYS: Key[] = [
  { t: 0.0, f: [LX + 0.2, U1_LID_Y, LZ + 0.1], r: 5.0, el: 11, az: -24, kEl: 18, kAz: 35, key: 0.95, env: 0.35, turn: 1.0 },
  { t: 0.16, f: [LX + 0.35, U1_LID_Y * 0.8, LZ - 0.05], r: 5.5, el: 17, az: -24, kEl: 20, kAz: 35, key: 1.05, env: 0.38, turn: 0.8 },
  // rising, swung a little further round: the title silk waits behind the panel
  // and slides out from under it, never across the top chrome
  { t: 0.23, f: [LX + 0.15, 0.15, LZ - 0.3], r: 6.0, el: 29, az: -31, kEl: 26, kAz: 34, key: 1.15, env: 0.4, turn: 0.65 },
  { t: 0.3, f: [-1.7, 0.02, -1.06], r: 0, el: 58, az: 8, kEl: 38, kAz: 35, key: 1.4, env: 0.4, turn: 0.5, fit: LAND_FIT },
  { t: 0.36, f: [-1.7, 0.02, -1.06], r: 0, el: 59, az: 9, kEl: 38, kAz: 36, key: 1.4, env: 0.4, turn: 0.5, fit: LAND_FIT },
  // the final still: r is replaced by the fitted distance
  { t: 0.92, f: [0, 0, 0.1], r: 20, el: 72, az: -5, kEl: 54, kAz: 124, key: 1.9, env: 1, turn: 1.2 },
]

/** scroll → network front */
const FRONT: [number, number][] = [
  [0.09, 0],
  [0.12, SEQ.plane],
  [0.18, 9.6],
  [0.24, SEQ.converge],
  [0.275, SEQ.end],
]
function frontAt(l: number) {
  if (l <= FRONT[0][0]) return -1 + (l / FRONT[0][0]) * 0.9
  for (let i = 1; i < FRONT.length; i++) {
    const k1 = FRONT[i]
    const k0 = FRONT[i - 1]
    if (l <= k1[0]) return lerp(k0[1], k1[1], (l - k0[0]) / (k1[0] - k0[0]))
  }
  return SEQ.end + (l - FRONT[FRONT.length - 1][0]) * 8
}

const N_COMP = 11
const TIMES = KEYS.map(k => k.t)
/** per-key component rows (filled on relayout: the fitted distances depend on the art rect) */
const VALS = KEYS.map(() => new Array<number>(N_COMP).fill(0))
const TRACK = new Array<number>(N_COMP).fill(0)

/** Fritsch–Carlson style slope at key k (zero at the ends and at extrema) */
function slope(vals: number[][], times: number[], k: number, c: number) {
  const n = times.length
  if (k === 0 || k === n - 1) return 0
  const a = (vals[k][c] - vals[k - 1][c]) / (times[k] - times[k - 1])
  const b = (vals[k + 1][c] - vals[k][c]) / (times[k + 1] - times[k])
  if (a * b <= 0) return 0
  return (2 * a * b) / (a + b)
}

/** monotone cubic Hermite through keyed values (per component), zero slope at the ends */
function track(t: number, vals: number[][], times: number[], out: number[]) {
  const n = times.length
  if (t <= times[0] || t >= times[n - 1]) {
    const row = vals[t <= times[0] ? 0 : n - 1]
    for (let c = 0; c < out.length; c++) out[c] = row[c]
    return out
  }
  let i = 0
  while (i < n - 2 && t > times[i + 1]) i++
  const t0 = times[i]
  const t1 = times[i + 1]
  const h = t1 - t0
  const u = (t - t0) / h
  const h00 = 2 * u * u * u - 3 * u * u + 1
  const h10 = u * u * u - 2 * u * u + u
  const h01 = -2 * u * u * u + 3 * u * u
  const h11 = u * u * u - u * u
  for (let c = 0; c < out.length; c++) out[c] = h00 * vals[i][c] + h10 * h * slope(vals, times, i, c) + h01 * vals[i + 1][c] + h11 * h * slope(vals, times, i + 1, c)
  return out
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let hud: Hud
  let board: Board | null = null
  let lay: HudLayout | null = null
  let lastW = 0
  let lastH = 0
  let hoverAmt = 0
  const shortLandscape = () => matchMedia('(orientation: landscape) and (max-height: 500px)').matches

  const tmp = {
    pos: new THREE.Vector3(),
    tgt: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    y: new THREE.Vector3(0, 1, 0),
    p: new THREE.Vector3(),
    off: new THREE.Color('#2e312c'),
    c: new THREE.Color(),
    lit: new THREE.Color(S.signal).multiplyScalar(4.2),
  }
  /** this frame's pose (computed in update, written in camera) */
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), parallax: 0, az: 0 }

  /** distance that fits the whole board in the art rect at elevation el */
  const fitBoard = (art: Rect, H: number, el: number) => {
    const aw = Math.max(60, art.x1 - art.x0)
    const ah = Math.max(60, art.y1 - art.y0)
    const rw = (BW * 1.02 * H) / (2 * TAN * aw)
    const rd = (BD * Math.sin(THREE.MathUtils.degToRad(el)) * 1.06 * H) / (2 * TAN * ah)
    return Math.max(rw, rd)
  }

  /**
   * Frame a set of points in the art rect, looking from (el, az): returns the
   * distance, and moves `F` (the focus, which the lens shift puts at the art
   * centre) so the points' projected bounds are centred. Perspective makes
   * near points project larger, so every point is projected; a few
   * fixed-point steps converge. Runs on relayout only.
   */
  const fitPoints = (pts: readonly (readonly [number, number, number])[], F: THREE.Vector3, el: number, az: number, fit: Rect, art: Rect, H: number) => {
    const aw = Math.max(60, fit.x1 - fit.x0) * 0.97
    const ah = Math.max(60, fit.y1 - fit.y0) * 0.97
    // where the fit rect's centre sits relative to the art centre (px, +x right, +y up)
    const ox = (fit.x0 + fit.x1) / 2 - (art.x0 + art.x1) / 2
    const oy = (art.y0 + art.y1) / 2 - (fit.y0 + fit.y1) / 2
    const e = THREE.MathUtils.degToRad(el)
    const a = THREE.MathUtils.degToRad(az)
    const dx = Math.cos(e) * Math.sin(a)
    const dy = Math.sin(e)
    const dz = Math.cos(e) * Math.cos(a)
    // camera basis (independent of R)
    tmp.fwd.set(-dx, -dy, -dz)
    tmp.right.crossVectors(tmp.fwd, tmp.y).normalize()
    tmp.up.crossVectors(tmp.right, tmp.fwd)
    const k = H / 2 / TAN
    let R = 10
    for (let it = 0; it < 6; it++) {
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const [x, y, z] of pts) {
        tmp.p.set(x - (F.x + R * dx), y - (F.y + R * dy), z - (F.z + R * dz))
        const zc = Math.max(0.05, tmp.p.dot(tmp.fwd))
        const sx = (tmp.p.dot(tmp.right) / zc) * k
        const sy = (tmp.p.dot(tmp.up) / zc) * k
        x0 = Math.min(x0, sx)
        x1 = Math.max(x1, sx)
        y0 = Math.min(y0, sy)
        y1 = Math.max(y1, sy)
      }
      // centre the bounds on the fit rect (px → world at the focus distance), then scale to fit
      F.addScaledVector(tmp.right, (((x0 + x1) / 2 - ox) / k) * R).addScaledVector(tmp.up, (((y0 + y1) / 2 - oy) / k) * R)
      R *= Math.max((x1 - x0) / aw, (y1 - y0) / ah)
    }
    return R
  }

  /** rebuild the key table for this layout (fitted distances, art-scaled close-ups) */
  const buildVals = (W: number, H: number) => {
    const art = lay?.art ?? { x0: 0, y0: 0, x1: W, y1: H }
    // fitted frames stay inside the chrome band too (portrait lets the art rise into
    // the top band's middle, where the brand plate and the menu sit at its ends)
    const fit: Rect = { x0: art.x0, x1: art.x1, y0: Math.max(art.y0, lay?.safe.y0 ?? 0), y1: art.y1 }
    KEYS.forEach((k, i) => {
      // close-ups scale with the frame they are seen in at that moment (full screen
      // under the cut, beside / above the panel once it is in)
      const at = artAt(k.t, W, H)
      const sArt = Math.min(Math.max(60, at.x1 - at.x0), Math.max(60, at.y1 - at.y0) * 1.15) / H
      let r = (k.r * NOMINAL_ART) / Math.max(0.2, sArt)
      const F = tmp.tgt.set(k.f[0], k.f[1], k.f[2])
      if (i === KEYS.length - 1) r = fitBoard(art, H, k.el)
      else if (k.fit) r = fitPoints(k.fit, F, k.el, k.az, fit, art, H)
      const row = VALS[i]
      row[0] = F.x
      row[1] = F.y
      row[2] = F.z
      row[3] = Math.log(r)
      row[4] = k.el
      row[5] = k.az
      row[6] = k.kEl
      row[7] = k.kAz
      row[8] = k.key
      row[9] = k.env
      row[10] = k.turn
    })
  }

  const relayout = (W: number, H: number) => {
    lay = measureHud(hud, W, H, !shortLandscape())
    hud.dirty = false
    lastW = W
    lastH = H
    buildVals(W, H)
  }

  /** the rect the board is framed in at this local (full screen under the cut → beside the panel) */
  const artRect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }
  const artAt = (local: number, W: number, H: number): Rect => {
    const a = lay?.art
    const k = smoothstep(0.05, 0.19, local)
    artRect.x0 = lerp(0, a ? a.x0 : 0, k)
    artRect.y0 = lerp(H * 0.06, a ? a.y0 : H * 0.06, k)
    artRect.x1 = lerp(W, a ? a.x1 : W, k)
    artRect.y1 = lerp(H * 0.94, a ? a.y1 : H * 0.94, k)
    return artRect
  }

  const pose = (local: number, W: number, H: number) => {
    const art = artAt(local, W, H)
    const v = track(local, VALS, TIMES, TRACK)
    const R = Math.exp(v[3])
    const e = THREE.MathUtils.degToRad(v[4])
    const a = THREE.MathUtils.degToRad(v[5])
    const F = tmp.tgt.set(v[0], v[1], v[2])
    const P = tmp.pos.set(v[0] + R * Math.cos(e) * Math.sin(a), v[1] + R * Math.sin(e), v[2] + R * Math.cos(e) * Math.cos(a))
    // lens shift: put F at the centre of the art rect
    tmp.fwd.subVectors(F, P).normalize()
    tmp.right.crossVectors(tmp.fwd, tmp.y).normalize()
    tmp.up.crossVectors(tmp.right, tmp.fwd)
    const nx = ((art.x0 + art.x1) / 2 / W) * 2 - 1
    const ny = 1 - ((art.y0 + art.y1) / 2 / H) * 2
    const dx = nx * R * TAN * (W / H)
    const dy = ny * R * TAN
    cam.pos.copy(P).addScaledVector(tmp.right, -dx).addScaledVector(tmp.up, -dy)
    cam.tgt.copy(F).addScaledVector(tmp.right, -dx).addScaledVector(tmp.up, -dy)
    cam.parallax = 0.012 * R * (1 - 0.5 * smoothstep(0.85, 0.95, local))
    cam.az = a
  }

  return {
    id: 'contact',
    group,
    anchors: [0.3],

    async init(ctx: ChapterContext) {
      hud = buildHud(ctx.stage)
      await nextFrame()
      // silkscreen and the lid etch are drawn with the site fonts: give them a moment to arrive
      const fonts = document.fonts
      let fontsIn = false
      if (fonts) {
        const want = Promise.all([
          fonts.load("600 40px 'Martian Mono Variable'"),
          fonts.load("500 40px 'Martian Mono Variable'"),
          fonts.load("600 40px 'Space Grotesk Variable'"),
        ]).then(() => (fontsIn = true))
        await Promise.race([want, new Promise(r => setTimeout(r, 1200))]).catch(() => {})
      }
      board = buildBoard({ mobile: ctx.mobile })
      group.add(board.root)
      if (/[?&]debug\b/.test(location.search)) {
        const w = window as unknown as Record<string, unknown>
        w.__contactBoard = board
        w.__contactKeys = KEYS
        w.__contactRelayout = () => (hud.dirty = true)
      }
      if (fonts && !fontsIn) fonts.ready.then(() => board?.redraw()).catch(() => {})
      await nextFrame()
    },

    update(local, frame, ctx) {
      const W = frame.width
      const H = frame.height
      if (hud.dirty || W !== lastW || H !== lastH || !lay) relayout(W, H)
      const b = board
      // calm: reduced motion, or the visitor paused motion (frame.time holds still)
      const calm = frame.reducedMotion || !!frame.still
      const t = frame.time
      const settle = smoothstep(0.34, 0.92, local)
      const front = frontAt(local)
      pose(local, W, H)
      // the track's lighting components (key elevation / azimuth offset / strength, studio)
      const kEl = TRACK[6]
      const kAz = TRACK[7]
      const key = TRACK[8]
      const env = TRACK[9]
      const turn = TRACK[10]

      // ---- the network: signals race along the copper; the copper stays copper
      if (b) {
        hoverAmt = damp(hoverAmt, hud.hover ? 1 : 0, 5, frame.dt)
        const since = (performance.now() - hud.copiedAt) / 1000
        const copied = since >= 0 && since < 1.4 ? Math.sin((since / 1.4) * Math.PI) : 0
        b.net.set({
          time: t,
          front,
          flow: calm ? 0.22 : lerp(2.2, 1.3, settle),
          // pulses behind the front: a little brighter while the address is hovered / just copied
          pulse: (calm ? 0.5 : 0.85) * (1 + 0.35 * hoverAmt + 0.5 * copied),
          head: calm ? 0.9 : 1.4,
        })

        // LEDs: D1 PWR first (the one light of the power-on), then D2–D5; ACT breathes softly (< 1 Hz)
        const ledOn = b.layout.ledOn
        for (let i = 0; i < ledOn.length; i++) {
          // D1 warms up over a longer stretch of the front: the one light of the power-on
          let on = smoothstep(ledOn[i] - 0.05, ledOn[i] + (i === 0 ? 1.2 : 0.3), front)
          if (i === 3 && !calm) on *= 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.4))
          b.lenses.setColorAt(i, tmp.c.copy(tmp.off).lerp(tmp.lit, on))
          b.halos.set(i, on * (i === 0 ? 1.0 : 0.75))
        }
        if (b.lenses.instanceColor) b.lenses.instanceColor.needsUpdate = true

        // U1 hears everything at once: a warm glint crosses its etch (once, scroll-driven)
        const sw = clamp((front - SEQ.converge) / (SEQ.sweepEnd - SEQ.converge))
        b.sweepU.uSweep.value = lerp(-0.3, 1.3, sw)
        b.sweepU.uAmt.value = calm ? 0.5 : 1
      }

      // ---- the world: graphite studio, warm bokeh behind (green lives on the board only)
      const wp = ctx.world.params
      wp.top = '#0a0e14'
      wp.bottom = '#020305'
      wp.a = '#b08a55'
      wp.b = '#6d7a92'
      wp.bokeh = lerp(0.85, 1, settle)
      if (lay) {
        const art = artAt(local, W, H)
        const aspect = W / H
        wp.focus.set((((art.x0 + art.x1) / 2 / W) * 2 - 1) * aspect * 0.8, (1 - ((art.y0 + art.y1) / 2 / H) * 2) * 0.8)
      }
      // the studio travels with the camera (lights on the rig): a warm key behind the
      // subject rakes the lid so the etch reads; U1 hearing the board turns the room a
      // little (a highlight crossing the lid), all scroll-driven
      const hear = smoothstep(SEQ.converge - 0.5, SEQ.sweepEnd + 0.5, front)
      wp.env = env
      wp.envTurn = cam.az + turn - 0.9 * (1 - hear) * smoothstep(0.06, 0.2, local)
      const ka = cam.az + Math.PI + THREE.MathUtils.degToRad(kAz)
      const ke = THREE.MathUtils.degToRad(kEl)
      wp.keyDir.set(Math.sin(ka) * Math.cos(ke), Math.sin(ke), Math.cos(ka) * Math.cos(ke))
      wp.key = key
      wp.fill = 0.3
      // the mask at a grazing angle would mirror the whole studio: keep it satin-matte
      // in the low opening shots, a touch of clearcoat once the camera is up
      if (b) {
        const graze = 1 - smoothstep(0.18, 0.32, local)
        b.surface.roughness = 1 + 0.3 * graze
        b.surface.clearcoat = 0.32 - 0.24 * graze
      }

      // ---- post
      const pp = ctx.post.params
      // a restrained, tight bloom: only LED cores and arriving heads bloom (the raking
      // key's glints on the leads stay glints in the low opening)
      pp.bloomStrength = 0.34
      pp.bloomRadius = 0
      pp.bloomThreshold = lerp(2.0, 1.5, smoothstep(0.16, 0.3, local))
      pp.vignette = 0.4

      // ---- copy
      reveal(hud.panel, smoothstep(0.1, 0.19, local))
      setRise(hud.title, local > 0.12)
      const powered = front > SEQ.pwr
      if (hud.status.classList.contains('is-on') !== powered) hud.status.classList.toggle('is-on', powered)
    },

    camera(_local, _frame, out: CameraPose) {
      out.position.copy(cam.pos)
      out.target.copy(cam.tgt)
      out.fov = FOV
      out.roll = 0
      out.parallax = cam.parallax
    },
  }
}
