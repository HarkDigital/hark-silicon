import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { BRAND, MICROCOPY, SERVICES } from '../../content'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { S } from '../../kit/silicon'
import { buildHero, LID_Y, type HeroSet } from './board'
import { dof } from './dof'
import './hero.css'

/*
 * HERO — "Package". The Hark chip, shot as a product macro.
 *
 *   0.00–0.10  INTRO   a low, grazing close on the etched lid: the mark
 *                      catching a raking key, the far leads and the board
 *                      melting into bokeh, D1 a green disc behind the chip.
 *                      After the loader, a time-based POWER-ON (~1.6 s):
 *                      signals race in from the dark edges of the board
 *                      (Traces reach), D1 lights, a light sweep crosses the
 *                      lid (envTurn).
 *   0.05–0.44  BOARD   the camera pulls up and back, sliding low across the
 *                      board from U2 (1.8 V regulator) past the chip to Y1
 *                      (100 MHz crystal); focus racks between them; probe
 *                      callouts name each part and what it stands for (the
 *                      services, verbatim); pulses stream in.
 *   0.37–0.93  PAYOFF  high over the chip (3/4 top-down; chip right of
 *                      centre on landscape, on top on portrait), creeping in
 *                      slowly with the scroll: the tagline clocks in + CTAs.
 *   0.93–1.00  OUT     the camera dives into the lid as the SEM cut begins.
 *
 * Every pose derives from `local`; frame.time only drives the idle signal
 * bursts, LED breathing and the power-on clock.
 */

interface Shot {
  tx: number
  ty: number
  tz: number
  /** azimuth / elevation of the camera around the target (degrees) */
  az: number
  el: number
  dist: number
  /** the width (cm) that must fit across the frame (portrait framing) */
  fit: number
  fov: number
  /** where the target sits on screen (NDC) */
  sx: number
  sy: number
  /** the point in focus (rack focus), board XZ */
  fx: number
  fz: number
  /** depth-of-field band (cm in front of / behind focus) and bokeh aperture */
  near: number
  far: number
  ap: number
  /** key light, relative to the camera: azimuth offset from straight behind the subject, elevation (deg), strength */
  kAz: number
  kEl: number
  key: number
  /** studio reflections: strength, and rotation relative to the camera (rad) */
  env: number
  turn: number
}

type Key = 'intro' | 'b1' | 'b2' | 'pay' | 'hold' | 'out'
const LAND: Record<Key, Shot> = {
  intro: { tx: 0, ty: LID_Y, tz: 0.1, az: 10, el: 13, dist: 7.6, fit: 2.6, fov: 30, sx: 0.24, sy: -0.16, fx: 0, fz: 0.1, near: 3.2, far: 4.0, ap: 0.5, kAz: 5, kEl: 13, key: 0.9, env: 0.5, turn: 1.0 },
  b1: { tx: 2.0, ty: 0.12, tz: 2.2, az: 36, el: 14, dist: 8.6, fit: 5, fov: 30, sx: 0.04, sy: -0.06, fx: 4.3, fz: 4.4, near: 6, far: 12, ap: 0.42, kAz: 22, kEl: 14, key: 1.0, env: 0.5, turn: 0.5 },
  b2: { tx: -1.9, ty: 0.1, tz: 2.0, az: -32, el: 19, dist: 9.8, fit: 6, fov: 30, sx: -0.04, sy: -0.06, fx: -4.2, fz: 4.25, near: 7, far: 13, ap: 0.42, kAz: -22, kEl: 19, key: 1.0, env: 0.5, turn: 0.5 },
  pay: { tx: 0, ty: LID_Y, tz: 0, az: -14, el: 54, dist: 11.8, fit: 3.4, fov: 30, sx: 0.42, sy: 0.03, fx: 0, fz: 0, near: 7, far: 9, ap: 0.34, kAz: 8, kEl: 50, key: 1.3, env: 0.3, turn: 0.5 },
  /** the end of the payoff hold: the same framing, a few degrees round and a little closer */
  hold: { tx: 0, ty: LID_Y, tz: 0, az: -6, el: 57, dist: 11.0, fit: 3.3, fov: 30, sx: 0.42, sy: 0.03, fx: 0, fz: 0, near: 7, far: 9, ap: 0.34, kAz: 8, kEl: 52, key: 1.3, env: 0.3, turn: 0.5 },
  out: { tx: 0, ty: LID_Y, tz: 0.1, az: -8, el: 70, dist: 2.3, fit: 1.2, fov: 28, sx: 0, sy: 0, fx: 0, fz: 0.1, near: 1.2, far: 1.6, ap: 0.5, kAz: 16, kEl: 64, key: 1.2, env: 0.3, turn: 0.5 },
}
const PORT: Record<Key, Shot> = {
  intro: { ...LAND.intro, sx: 0, sy: 0.3, fov: 36, el: 24, fit: 3.3 },
  b1: { ...LAND.b1, sx: 0, sy: 0.08, fov: 38, fit: 3.6 },
  b2: { ...LAND.b2, sx: 0, sy: 0.08, fov: 38, fit: 4.0 },
  pay: { ...LAND.pay, sx: 0, sy: 0.36, fov: 38, fit: 3.9, el: 58, kEl: 66, key: 1.1 },
  hold: { ...LAND.hold, sx: 0, sy: 0.36, fov: 38, fit: 3.75, el: 61, kEl: 66, key: 1.1 },
  out: { ...LAND.out, fov: 34, fit: 1.4 },
}

/**
 * The beats (local). The tour is short so the tagline lands about a viewport
 * in; the payoff then holds (creeping) until the dive.
 */
const T = {
  /** intro sheet fades */
  sheet: [0.065, 0.1],
  /** intro → U2 → Y1 → payoff (camera) */
  b1: [0.05, 0.19],
  b2: [0.19, 0.31],
  pay: [0.31, 0.44],
  /** payoff copy in (the camera is still settling) and out */
  copy: [0.37, 0.43],
  copyOut: [0.925, 0.955],
  /** the dive into the lid */
  out: 0.925,
} as const

/** smootherstep on a segment */
const sm = (x: number, a: number, b: number) => {
  const t = segment(x, a, b)
  return t * t * t * (t * (t * 6 - 15) + 10)
}
const outQuart = (t: number) => 1 - Math.pow(1 - clamp(t), 4)

export default function create(): Chapter {
  const group = new THREE.Group()
  let set: HeroSet | null = null
  let reduced = false

  // DOM
  let intro: HTMLElement
  let payoff: HTMLElement
  let title: HTMLElement
  const callouts: { c: Callout; at: 'u1' | 'vdd' | 'clk'; a: number; b: number }[] = []

  // power-on clock (performance time, seconds)
  let revealAt = -1
  let initAt = 0
  const now = () => performance.now() / 1000

  // pose, computed in update(), written in camera()
  const shot: Shot = { ...LAND.intro }
  const pos = new THREE.Vector3()
  const tgt = new THREE.Vector3()
  const focusPt = new THREE.Vector3()
  let fov = 28
  let parallax = 0
  const tmpF = new THREE.Vector3()
  const tmpR = new THREE.Vector3()
  const tmpU = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const tmpP = new THREE.Vector3()
  /** first frame after entering: the engine camera still holds the last chapter's pose */
  let fresh = true
  const ledCol = new THREE.Color()
  const ledOff = new THREE.Color('#06140d')
  const signal = new THREE.Color(S.signal)

  const SHOT_KEYS = Object.keys(LAND.intro) as (keyof Shot)[]
  const shotAt = (local: number, portrait: boolean, out: Shot) => {
    const P = portrait ? PORT : LAND
    const w1 = sm(local, T.b1[0], T.b1[1])
    const w2 = sm(local, T.b2[0], T.b2[1])
    const w3 = sm(local, T.pay[0], T.pay[1])
    // the hold creeps in with the scroll (never still while the page moves)
    const wh = 0.5 - 0.5 * Math.cos(Math.PI * segment(local, T.pay[1], T.out))
    const w4 = Math.pow(segment(local, T.out, 1), 1.7)
    for (const k of SHOT_KEYS) {
      const pay = lerp(P.pay[k], P.hold[k], wh)
      out[k] = lerp(lerp(lerp(lerp(P.intro[k], P.b1[k], w1), P.b2[k], w2), pay, w3), P.out[k], w4)
    }
    return out
  }

  return {
    id: 'hero',
    group,
    anchors: [0.8],

    onEnter() {
      fresh = true
    },

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      initAt = now()
      set = await buildHero(ctx.mobile)
      group.add(set.root)

      // ---- DOM: the intro datasheet
      intro = el('div', 'hs-intro', undefined, ctx.stage)
      const sheet = el('div', 'hud-panel hs-sheet', undefined, intro)
      const head = el('div', 'hs-sheet-head', undefined, sheet)
      el('span', 'hs-pn', 'HK-0N · HARK-1', head)
      el('span', 'hs-rev', 'REV A', head)
      el('p', 'hud-eyebrow', MICROCOPY.signalEyebrow, sheet)
      el('p', 'hud-body hs-manifesto', BRAND.manifesto, sheet)
      el('hr', 'hud-rule hs-rule', undefined, sheet)
      const foot = el('div', 'hs-sheet-foot', undefined, sheet)
      const hint = el('p', 'hud-label hs-hint', undefined, foot)
      el('span', 'hs-hint-arrow', '↓', hint)
      el('span', '', MICROCOPY.scrollHint, hint)
      el('p', 'hud-label hs-spec', 'VDD 1.8 V · CLK 100 MHz', foot)

      // ---- DOM: the payoff
      payoff = el('div', 'hs-payoff', undefined, ctx.stage)
      el('div', 'hs-scrim', undefined, payoff)
      const inner = el('div', 'hs-payoff-inner', undefined, payoff)
      el('p', 'hud-label hs-locale', BRAND.locale, inner)
      title = rise(el('h1', 'hud-title hs-title', undefined, inner), 'Make the internet <em>listen.</em>')
      const ctas = el('div', 'hs-ctas', undefined, inner)
      const see = el('button', 'hud-btn', 'See the work', ctas)
      see.type = 'button'
      see.addEventListener('click', () => window.__hark?.land('work'))
      const start = el('a', 'hud-btn hud-btn--ghost', 'Start a project', ctas)
      start.href = '#contact'
      start.addEventListener('click', e => {
        if (!window.__hark) return
        e.preventDefault()
        window.__hark.land('contact')
      })

      // ---- probe callouts: the part, and what it stands for (service titles, verbatim)
      const svc = (slug: string) => SERVICES.find(x => x.slug === slug)?.title ?? ''
      const mk = (part: string, lines: string[], at: 'u1' | 'vdd' | 'clk', side: 'left' | 'right', ox: number, oy: number, a: number, b: number) => {
        const c = new Callout(ctx.stage, { side, offset: { x: ctx.mobile ? Math.round(ox * 0.6) : ox, y: oy } })
        el('span', 'hs-co-part', part, c.label)
        for (const l of lines) if (l) el('span', 'hs-co-svc', l, c.label)
        c.root.classList.add('hs-callout')
        callouts.push({ c, at, a, b })
      }
      // the logic, the power, the clock
      mk('U1 · HARK-1', [svc('software-development'), svc('ai-consulting')], 'u1', 'right', 76, -64, 0.115, 0.215)
      mk('U2 · VDD 1.8 V', [svc('web-design'), svc('ecommerce')], 'vdd', 'right', 62, -58, 0.09, 0.2)
      mk('Y1 · CLK 100 MHz', [svc('page-speed'), svc('seo-geo')], 'clk', 'left', 62, -58, 0.2, 0.335)

      const onReveal = () => {
        if (revealAt < 0) revealAt = now()
      }
      if (document.documentElement.dataset.ready === '1') onReveal()
      else window.addEventListener('hark:reveal', onReveal, { once: true })
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      if (!set) return
      const t = frame.time
      const portrait = frame.width <= frame.height
      const aspect = frame.width / Math.max(1, frame.height)

      // ---- power-on (time-based, after the loader)
      const clock = now()
      if (revealAt < 0 && (document.documentElement.dataset.ready === '1' || clock - initAt > 20)) revealAt = clock
      const since = revealAt < 0 ? 0 : clock - revealAt
      const on = revealAt >= 0
      const reachK = reduced ? (on ? 1 : 0) : ease.inOutCubic(segment(since, 0.05, 1.25))
      const glowK = reduced ? smoothstep(0, 0.8, since) : smoothstep(0.1, 1.2, since)
      const ledK = reduced ? smoothstep(0.3, 1.0, since) : sm(since, 1.1, 1.45)
      const sweep = reduced ? 0 : (1 - outQuart(segment(since, 0.2, 1.7))) * -1.25

      // ---- camera
      shotAt(local, portrait, shot)
      // narrower landscapes: the intro subject slides right, clear of the datasheet
      // (short landscape phones: the sheet is half the screen wide)
      if (!portrait) shot.sx += (frame.height <= 500 ? 0.2 : clamp((1.6 - aspect) * 0.3, 0, 0.12)) * (1 - sm(local, T.b1[0], T.b1[1]))
      const tanV = Math.tan(THREE.MathUtils.degToRad(shot.fov / 2))
      const d = Math.max(shot.dist, shot.fit / (2 * tanV * aspect))
      const az = THREE.MathUtils.degToRad(shot.az)
      const elv = THREE.MathUtils.degToRad(shot.el)
      // the slow macro drift: a millimetre or two, only while settled
      const drift = reduced ? 0 : 1
      tgt.set(shot.tx + 0.04 * Math.sin(t * 0.21) * drift, shot.ty, shot.tz + 0.03 * Math.sin(t * 0.17 + 1) * drift)
      focusPt.set(shot.fx, 0.15, shot.fz)
      pos.set(Math.sin(az) * Math.cos(elv), Math.sin(elv), Math.cos(az) * Math.cos(elv)).multiplyScalar(d).add(tgt)
      tmpF.subVectors(tgt, pos).normalize()
      tmpR.crossVectors(tmpF, UP).normalize()
      tmpU.crossVectors(tmpR, tmpF)
      const shiftR = -shot.sx * d * tanV * aspect
      const shiftU = -shot.sy * d * tanV
      pos.addScaledVector(tmpR, shiftR).addScaledVector(tmpU, shiftU)
      tgt.addScaledVector(tmpR, shiftR).addScaledVector(tmpU, shiftU)
      fov = shot.fov
      parallax = 0.012 * d

      // ---- depth of field + bokeh
      dof.uDofFocus.value = pos.distanceTo(focusPt)
      dof.uDofNear.value.set(shot.near * 0.35, shot.near)
      dof.uDofFar.value.set(shot.far * 0.25, shot.far)
      dof.uDofAmt.value = 1
      for (const b of [set.bokeh, set.bokehFar]) {
        b.u.uAperture.value = shot.ap
        b.u.uTanV.value = tanV
        b.u.uMinR.value = frame.mobile ? 0.008 : 0.006
      }

      // ---- signals: ambient drift + clock-tick bursts + a scroll push
      let offset: number
      if (reduced) offset = t * 0.5 + local * 10
      else {
        const P = 2.6
        const n = Math.floor(t / P)
        const f = t - n * P
        offset = t * 1.2 + 6.5 * (n + ease.inOutCubic(clamp(f / 0.7))) + local * 34
      }
      set.traces.set({
        time: 0,
        flow: 0,
        offset,
        density: 0.8,
        glow: lerp(0.15, 1, glowK),
        reach: reachK * (set.maxLen + 1),
      })

      // ---- LEDs: D1 comes on with the power-on, then breathes slowly; D2 idles
      set.leds.forEach((l, i) => {
        // slow breathing (well under 1 Hz), steady under reduced motion
        const breathe = reduced ? 1 : i === 0 ? 0.92 + 0.08 * Math.sin(t * 1.1) : 0.75 + 0.25 * Math.sin(t * 2.4 + 1)
        const k = ledK * breathe
        ledCol.copy(ledOff).lerp(signal, Math.min(1, k)).multiplyScalar(1 + 3.2 * k)
        l.emit.color.copy(ledCol)
        l.lens.emissiveIntensity = 0.9 * k
        l.spill.opacity = 0.22 * k
        set!.bokeh.power(l.idx, l.power * k)
      })

      // ---- world: macro studio, grazing key, bokeh behind
      const wp = ctx.world.params
      wp.top = '#080a0f'
      wp.bottom = '#030405'
      wp.a = '#1f9d63'
      wp.b = '#6e6557'
      wp.bokeh = 0.85
      // the pools gather behind the subject
      wp.focus.set(shot.sx * aspect + 0.1, shot.sy + 0.35)
      // the studio travels with the camera (lights on the rig): the key sits behind the
      // subject so the lid and the pad tops carry a soft sheen that reveals the etch
      wp.env = shot.env * lerp(0.6, 1, glowK)
      wp.envTurn = az + shot.turn + sweep + (reduced ? 0 : 0.06 * Math.sin(t * 0.13))
      const ka = az + Math.PI + THREE.MathUtils.degToRad(shot.kAz)
      const ke = THREE.MathUtils.degToRad(shot.kEl)
      wp.keyDir.set(Math.sin(ka) * Math.cos(ke), Math.sin(ke), Math.cos(ka) * Math.cos(ke))
      wp.key = shot.key * lerp(0.55, 1, glowK)
      wp.fill = 0.28

      // ---- post
      const pp = ctx.post.params
      pp.bloomStrength = 0.5
      pp.bloomRadius = 0.55
      pp.bloomThreshold = 0.95
      pp.vignette = 0.42
      pp.grain = 0.03

      // ---- DOM
      reveal(intro, 1 - smoothstep(T.sheet[0], T.sheet[1], local))
      intro.classList.toggle('is-in', on && since > (reduced ? 0 : 0.35))
      reveal(payoff, smoothstep(T.copy[0], T.copy[1], local) * (1 - smoothstep(T.copyOut[0], T.copyOut[1], local)), 0)
      setRise(title, local > T.copy[0] + 0.015 && local < 0.945)

      // ---- callouts, projected with the camera as rendered (the engine time-damps the
      // pose; last frame's is a frame old at most). The first frame after entering, it
      // is still another chapter's, so the callouts sit that one frame out.
      const skip = fresh
      fresh = false
      const cam = ctx.camera
      const H = frame.height
      const shortLand = !portrait && H <= 500
      const safeTop = shortLand ? 56 : clamp(0.105 * H, 80, 112)
      const safeBot = shortLand ? 52 : clamp(0.105 * H, 82, 110)
      const v = tmpP
      for (const { c, at, a, b } of callouts) {
        const p = set.pins[at]
        let vis = skip ? 0 : smoothstep(a, a + 0.025, local) * (1 - smoothstep(b - 0.025, b, local))
        if (vis > 0) {
          v.copy(p).project(cam)
          const y = (-v.y * 0.5 + 0.5) * H
          vis *= smoothstep(safeTop + 44, safeTop + 76, y) * (1 - smoothstep(H - safeBot - 40, H - safeBot - 12, y))
        }
        c.update(p, cam, frame.width, H, vis)
      }
    },

    camera(_local: number, _frame: Frame, out: CameraPose) {
      out.position.copy(pos)
      out.target.copy(tgt)
      out.fov = fov
      out.roll = 0
      out.parallax = parallax
    },
  }
}
