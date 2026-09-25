import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { reveal, setRise } from '../../core/dom'
import { clamp, damp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { S } from '../../kit/silicon'
import { buildHud, measureHud, type Hud, type HudLayout, type Rect } from './hud'
import { buildBoard, type Board } from './board'
import { BD, BW, SEQ } from './layout'
import './contact.css'

/*
 * CONTACT · "Power On" — the final chapter.
 *
 * Back out at board scale: the finished Hark board, shot as a product macro,
 * powering on. Everything is scroll-driven through one network "front":
 *
 *   0.00–0.09  under the SEM cut: a grazing macro on the USB-C mouth (strong
 *              silhouettes: the steel shell, the tongue, the board edge)
 *   0.09       D1 · PWR lights
 *   0.09–0.13  VBUS: power races from J1 through the ferrite to the regulator
 *   0.13–0.21  the power plane wakes: a ring of light spreads from the
 *              regulator across the board, lighting every via as it passes
 *   0.21–0.29  signals leave every peripheral (flash, crystal, sensors, the
 *              header, USB) timed to converge on U1 at the same instant
 *   0.29–0.33  U1 hears them: a light sweep crosses its laser-etched mark,
 *              then its outputs race to the status LEDs (SIG LINK ACT RDY)
 *   0.33–0.92  a slow, precise pull-up to a top-down still of the whole board
 *   0.92–1.00  stillness: the board glows softly, bokeh behind
 *
 * The camera orbits a focus point (el/az/R keys, a C1 Hermite track) and is
 * lens-shifted so the focus lands in the free space beside the datasheet
 * panel (measured, see hud.ts). frame.time only drives the ambient pulses.
 */

const FOV = 28
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
/** art-rect scale the close-up distances were tuned for (1440×900 beside the panel) */
const NOMINAL_ART = 0.83

interface Key {
  t: number
  f: [number, number, number]
  r: number
  el: number
  az: number
}
const KEYS: Key[] = [
  { t: 0.0, f: [3.35, 0.15, 3.6], r: 3.0, el: 9, az: 30 },
  { t: 0.12, f: [4.15, 0.05, 2.2], r: 4.8, el: 28, az: 18 },
  { t: 0.21, f: [0.5, 0, 0.5], r: 11.5, el: 50, az: 9 },
  { t: 0.3, f: [-0.35, 0.2, -0.5], r: 5.9, el: 63, az: 4 },
  // the final still: r is replaced by the fitted distance
  { t: 0.92, f: [0, 0, 0.1], r: 20, el: 72, az: -5 },
]

/** scroll → network front */
const FRONT: [number, number][] = [
  [0.085, 0],
  [0.13, SEQ.plane],
  [0.205, 9.6],
  [0.285, SEQ.converge],
  [0.335, SEQ.end],
]
function frontAt(l: number) {
  if (l <= FRONT[0][0]) return -1 + (l / FRONT[0][0]) * 0.9
  for (let i = 1; i < FRONT.length; i++) {
    const [t1, v1] = FRONT[i]
    const [t0, v0] = FRONT[i - 1]
    if (l <= t1) return lerp(v0, v1, (l - t0) / (t1 - t0))
  }
  return SEQ.end + (l - FRONT[FRONT.length - 1][0]) * 8
}

/** monotone cubic Hermite through keyed values (per component), zero slope at the ends */
function track(t: number, vals: number[][], times: number[]): number[] {
  const n = times.length
  if (t <= times[0]) return vals[0].slice()
  if (t >= times[n - 1]) return vals[n - 1].slice()
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
  const slope = (k: number, c: number) => {
    if (k === 0 || k === n - 1) return 0
    const a = (vals[k][c] - vals[k - 1][c]) / (times[k] - times[k - 1])
    const b = (vals[k + 1][c] - vals[k][c]) / (times[k + 1] - times[k])
    if (a * b <= 0) return 0
    return (2 * a * b) / (a + b)
  }
  return vals[i].map((v0, c) => h00 * v0 + h10 * h * slope(i, c) + h01 * vals[i + 1][c] + h11 * h * slope(i + 1, c))
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
    off: new THREE.Color('#2e312c'),
    c: new THREE.Color(),
    lit: new THREE.Color(S.signal).multiplyScalar(4.2),
  }

  const relayout = (W: number, H: number) => {
    lay = measureHud(hud, W, H, !shortLandscape())
    hud.dirty = false
    lastW = W
    lastH = H
  }

  /** the rect the board is framed in at this local (full screen under the cut → beside the panel) */
  const artAt = (local: number, W: number, H: number): Rect => {
    const full: Rect = { x0: 0, y0: H * 0.06, x1: W, y1: H * 0.94 }
    const a = lay?.art ?? full
    const k = smoothstep(0.05, 0.19, local)
    return { x0: lerp(full.x0, a.x0, k), y0: lerp(full.y0, a.y0, k), x1: lerp(full.x1, a.x1, k), y1: lerp(full.y1, a.y1, k) }
  }

  /** distance that fits the whole board in the art rect at elevation el */
  const fitR = (art: Rect, H: number, el: number) => {
    const aw = Math.max(60, art.x1 - art.x0)
    const ah = Math.max(60, art.y1 - art.y0)
    const rw = (BW * 1.02 * H) / (2 * TAN * aw)
    const rd = (BD * Math.sin(THREE.MathUtils.degToRad(el)) * 1.06 * H) / (2 * TAN * ah)
    return Math.max(rw, rd)
  }

  const pose = (local: number, frame: Frame, out: CameraPose) => {
    const W = frame.width
    const H = frame.height
    const art = artAt(local, W, H)
    const aw = Math.max(60, art.x1 - art.x0)
    const ah = Math.max(60, art.y1 - art.y0)
    const sArt = Math.min(aw, ah * 1.15) / H
    const closeK = NOMINAL_ART / Math.max(0.2, sArt)
    const finalArt = lay?.art ?? art
    const rFit = fitR(finalArt, H, KEYS[KEYS.length - 1].el)
    const times = KEYS.map(k => k.t)
    const vals = KEYS.map((k, i) => [k.f[0], k.f[1], k.f[2], Math.log(i === KEYS.length - 1 ? rFit : k.r * closeK), k.el, k.az])
    const [fx, fy, fz, lr, el, az] = track(local, vals, times)
    const R = Math.exp(lr)
    const e = THREE.MathUtils.degToRad(el)
    const a = THREE.MathUtils.degToRad(az)
    const F = tmp.tgt.set(fx, fy, fz)
    const P = tmp.pos.set(fx + R * Math.cos(e) * Math.sin(a), fy + R * Math.sin(e), fz + R * Math.cos(e) * Math.cos(a))
    // lens shift: put F at the centre of the art rect
    tmp.fwd.subVectors(F, P).normalize()
    tmp.right.crossVectors(tmp.fwd, tmp.y).normalize()
    tmp.up.crossVectors(tmp.right, tmp.fwd)
    const cx = (art.x0 + art.x1) / 2
    const cy = (art.y0 + art.y1) / 2
    const nx = (cx / W) * 2 - 1
    const ny = 1 - (cy / H) * 2
    const dx = nx * R * TAN * (W / H)
    const dy = ny * R * TAN
    out.position.copy(P).addScaledVector(tmp.right, -dx).addScaledVector(tmp.up, -dy)
    out.target.copy(F).addScaledVector(tmp.right, -dx).addScaledVector(tmp.up, -dy)
    out.fov = FOV
    out.roll = 0
    out.parallax = 0.012 * R * (1 - 0.5 * smoothstep(0.85, 0.95, local))
  }

  return {
    id: 'contact',
    group,
    anchors: [0.3],

    async init(ctx: ChapterContext) {
      hud = buildHud(ctx.stage)
      await nextFrame()
      // silkscreen is drawn with the site fonts: give them a moment to arrive
      const fonts = document.fonts
      let fontsIn = false
      if (fonts) {
        const want = Promise.all([fonts.load("600 40px 'Martian Mono Variable'"), fonts.load("600 40px 'Space Grotesk Variable'")]).then(() => (fontsIn = true))
        await Promise.race([want, new Promise(r => setTimeout(r, 1200))]).catch(() => {})
      }
      board = buildBoard({ mobile: ctx.mobile })
      group.add(board.root)
      if (/[?&]debug\b/.test(location.search)) (window as unknown as Record<string, unknown>).__contactBoard = board
      if (fonts && !fontsIn) fonts.ready.then(() => board?.redraw()).catch(() => {})
      await nextFrame()
    },

    update(local, frame, ctx) {
      const W = frame.width
      const H = frame.height
      if (hud.dirty || W !== lastW || H !== lastH || !lay) relayout(W, H)
      const b = board
      const rm = frame.reducedMotion
      const t = frame.time
      const settle = smoothstep(0.34, 0.92, local)
      const front = frontAt(local)

      // ---- the network
      if (b) {
        hoverAmt = damp(hoverAmt, hud.hover ? 1 : 0, 5, frame.dt)
        const since = (performance.now() - hud.copiedAt) / 1000
        const copied = since >= 0 && since < 1.4 ? Math.sin((since / 1.4) * Math.PI) : 0
        b.net.set({
          time: t,
          front,
          flow: rm ? 0.22 : lerp(2.4, 1.3, settle),
          steady: 0.2 + 0.05 * settle + 0.08 * hoverAmt + 0.12 * copied,
          pulse: rm ? 0.45 : 0.95,
          head: rm ? 1.0 : 1.9,
          wave: (front - SEQ.plane) * SEQ.planeSpeed,
          idle: 0.075,
        })
        b.planeU.uWave.value = (front - SEQ.plane) * SEQ.planeSpeed
        b.planeU.uRing.value = rm ? 0.5 : 0.95
        b.planeU.uPlane.value = 0.009 * smoothstep(SEQ.plane, SEQ.plane + 2, front) * (1 + 1.5 * copied)

        // LEDs: D1 PWR first, then the four status LEDs; ACT breathes softly (< 1 Hz)
        const ledOn = b.layout.ledOn
        for (let i = 0; i < ledOn.length; i++) {
          let on = smoothstep(ledOn[i] - 0.05, ledOn[i] + 0.3, front)
          if (i === 3 && !rm) on *= 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.4))
          b.lenses.setColorAt(i, tmp.c.copy(tmp.off).lerp(tmp.lit, on))
          b.halos.set(i, on * (i === 0 ? 1.05 : 0.9))
        }
        if (b.lenses.instanceColor) b.lenses.instanceColor.needsUpdate = true

        // U1 hears everything at once: the mark sweep, then a soft steady glow
        const sw = clamp((front - SEQ.converge) / (SEQ.sweepEnd - SEQ.converge))
        b.sweepU.uSweep.value = lerp(-0.3, 1.3, sw)
        b.sweepU.uLit.value = smoothstep(SEQ.converge + 0.6, SEQ.sweepEnd + 0.4, front) * (1 + 0.5 * hoverAmt)
        b.halos.set(5, smoothstep(SEQ.converge - 0.2, SEQ.converge + 1.2, front) * (0.16 + 0.08 * hoverAmt + (0.28 * (1 - sw)) * sw * 4))
      }

      // ---- the world: graphite studio, bokeh behind, a slow highlight sweep across the board
      const wp = ctx.world.params
      wp.top = '#0a0f16'
      wp.bottom = '#020305'
      wp.a = S.signal
      wp.b = '#7d91b4'
      wp.bokeh = lerp(0.85, 1, settle)
      if (lay) {
        const art = artAt(local, W, H)
        const aspect = W / H
        wp.focus.set((((art.x0 + art.x1) / 2 / W) * 2 - 1) * aspect * 0.8, (1 - ((art.y0 + art.y1) / 2 / H) * 2) * 0.8)
      }
      wp.env = 1
      // a rim along the USB-C shell for the opening, a sweep across the chip as it wakes,
      // then one slow turn of the studio during the pull-up
      wp.envTurn = lerp(0.5, -0.2, smoothstep(0.1, 0.3, local)) + 1.2 * smoothstep(0.36, 0.9, local)
      wp.keyDir.set(-0.55, 0.85, 0.3)
      wp.key = 1.9
      wp.fill = 0.32

      // ---- post
      const pp = ctx.post.params
      // a restrained, tight bloom: only LED cores and arriving heads bloom; the
      // soft light on the mask comes from the chapter's own halos
      pp.bloomStrength = 0.34
      pp.bloomRadius = 0
      pp.bloomThreshold = 1.5
      pp.vignette = 0.38

      // ---- copy
      reveal(hud.panel, smoothstep(0.1, 0.19, local))
      setRise(hud.title, local > 0.12)
      const powered = front > SEQ.pwr
      if (hud.status.classList.contains('is-on') !== powered) hud.status.classList.toggle('is-on', powered)
    },

    camera(local, frame, out) {
      pose(local, frame, out)
    },
  }
}
