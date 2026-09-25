import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, rise, setRise, reveal } from '../../core/dom'
import { PROCESS, STATS } from '../../content'
import { clamp, ease, lerp, segment, smoothstep, window01 } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { S, dieTexture } from '../../kit/silicon'
import { buildBench, buildBokeh, buildBurnIn, buildLitho, buildProbe, buildStack, type Bench, type ForeBokeh, type BurnInStation, type LithoStation, type ProbeStation, type StackStation } from './stations'
import './process.css'

/*
 * THE FAB — "We listen first. Then we build."
 *
 * Under the cleanroom's yellow photolithography light, the camera slides
 * along a perforated stainless bench past four stations, one per step:
 *
 *   0.00–0.10  in-beat (under the SEM cut): the probe station from above —
 *              a strong circle of card, needles and wafer grid; the headline
 *   0.10–0.78  four steps (SP = 0.17 each). The camera arrives at each station
 *              as its step begins, dollies in slowly while it works, and slides
 *              low along the bench to the next:
 *                1 LISTEN     needles touch down on the bond pads; signals run
 *                             out along the probe card; the scope draws the wave
 *                2 PROTOTYPE  a slit of light scans the photomask toward us and
 *                             the pattern appears on the wafer behind it
 *                3 BUILD      copper layers M1–M4 and their vias rise into
 *                             place; each carries signal once it lands
 *                4 SUPPORT    the last Hark chip is seated; PASS LEDs light in
 *                             sequence along the burn-in board
 *   0.78–0.95  results: the amber light gives way to clean white; the camera
 *              rises over the finished board; three datasheet spec cells
 *   0.95–1.00  out-beat under the cut
 *
 * Everything is derived from `local`; frame.time only drives idle motion
 * (signal pulses, the running scope trace, the PASS LEDs' slow breathing).
 */

// ---------------------------------------------------------------- layout + timeline

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
/** station centres along the bench (x) */
const X = [0, 20, 40, 60]
const A = 0.1
const B = 0.78
const SP = (B - A) / PROCESS.length
const ANCHORS = PROCESS.map((_, k) => A + SP * (k + 0.55))
const STATS_AT = 0.875
const CARD = [0.125, 0.785] as const
const CELLS = [0.81, 0.955] as const
/** 10 years, $1M+, 15 — in that order */
const SHOW = [STATS[0], STATS[2], STATS[1]]
const STATION = ['Probe', 'Litho', 'Metal', 'Test']
/** studio (env) rotation that flatters each station's metal */
const TURN = [0.2, 0.9, -1.5, 0.4]
/** action progress of station k (0 before its step, 1 after) */
const act = (local: number, k: number) => segment(local, A + SP * (k + 0.08), A + SP * (k + 0.8))
/** step 1 is two beats: the needles touch down, then the camera racks over to the scope as it draws */
const TOUCH = [0.128, 0.168] as const
const LISTEN = [0.188, 0.262] as const
/** the probe station's scope (matches buildProbe) */
const SCOPE = V(X[0] + 8.6, 3.1, -2.6)

// ---------------------------------------------------------------- camera keys

interface Key {
  t: number
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
  /** subject centre (the bench light pool + backdrop light gather here) */
  c: THREE.Vector3
  /** on the glide INTO this key, back away by this fraction mid-way */
  lift?: number
  /** on the glide INTO this key, slide low across the bench mid-way (0..1) */
  dip?: number
}
const DEG = Math.PI / 180
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const UPV = new THREE.Vector3(0, 1, 0)

/** A key orbiting c: azimuth (deg, + = camera to the front-left), elevation, distance; c lands at screen (sx, sy). */
function orbit(t: number, c: THREE.Vector3, az: number, el: number, d: number, fov: number, sx: number, sy: number, aspect: number, lift?: number): Key {
  const a = az * DEG
  const e = el * DEG
  const pos = V(c.x - Math.sin(a) * Math.cos(e) * d, c.y + Math.sin(e) * d, c.z + Math.cos(a) * Math.cos(e) * d)
  _f.subVectors(c, pos).normalize()
  _r.crossVectors(_f, UPV).normalize()
  _u.crossVectors(_r, _f)
  const halfH = Math.tan((fov * DEG) / 2) * d
  const tgt = c.clone().addScaledVector(_r, -sx * halfH * aspect).addScaledVector(_u, -sy * halfH)
  return { t, pos, tgt, fov, c: c.clone(), lift }
}

function keysFor(aspect: number): Key[] {
  const portrait = aspect < 0.9
  const k: Key[] = []
  const C = [V(X[0], 1.05, 0), V(X[1], 1.5, 0.4), V(X[2], 3.3, 0), V(X[3], 0.9, 0.4)]
  const s = (i: number, f: number) => A + SP * (i + f)
  if (!portrait) {
    const narrow = clamp((1.6 - aspect) / 0.6) // 0 at 16:10, 1 at 4:3-ish
    const w = 1 + 0.4 * narrow
    const sx = 0.26 + 0.06 * narrow
    const fov = 30
    k.push(orbit(0, V(X[0], 0.9, -0.4), 14, 70, 21 * w, fov, sx, 0.02, aspect))
    k.push(orbit(0.09, V(X[0], 0.9, -0.4), 17, 67, 20 * w, fov, sx, 0.02, aspect))
    k.push(orbit(0.15, C[0], 22, 44, 11 * w, fov, sx, 0, aspect))
    k.push(orbit(0.2, C[0], 17, 41, 10.2 * w, fov, sx, 0, aspect))
    k.push(orbit(0.246, SCOPE, 18, 18, 13 * w, fov, sx * 0.7, 0.02, aspect))
    k.push(orbit(s(1, 0.3), C[1], 26, 38, 23 * w, fov, sx, -0.04, aspect, 0.12))
    k.push(orbit(s(1, 0.82), C[1], 19, 35, 21.5 * w, fov, sx, -0.04, aspect))
    k.push({ ...orbit(s(2, 0.26), C[2], 30, 20, 17.5 * w, fov, sx, 0.02, aspect), dip: 0.7 })
    k.push(orbit(s(2, 0.82), C[2], 22, 17, 16.5 * w, fov, sx, 0.02, aspect))
    k.push({ ...orbit(s(3, 0.26), C[3], 26, 38, 18 * w, fov, sx, -0.02, aspect), dip: 0.55 })
    k.push(orbit(s(3, 0.8), C[3], 19, 42, 17 * w, fov, sx, -0.02, aspect))
    const R = V(X[3], 0.9, 0.3)
    k.push(orbit(0.865, R, 8, 40, 31 * w, fov, 0, 0.3, aspect))
    k.push(orbit(0.955, R, 5, 42, 30 * w, fov, 0, 0.3, aspect))
    k.push(orbit(1, R, 4, 43, 29.5 * w, fov, 0, 0.3, aspect))
  } else {
    const tall = clamp((0.75 - aspect) / 0.29) // 0 at tablet, 1 at phone
    const w = 1.45 + 0.35 * tall
    const fov = 38
    const sy = lerp(0.22, 0.3, tall)
    k.push(orbit(0, V(X[0], 0.9, -0.4), 10, 72, 20 * w, fov, 0, 0.12, aspect))
    k.push(orbit(0.09, V(X[0], 0.9, -0.4), 12, 69, 19 * w, fov, 0, 0.12, aspect))
    k.push(orbit(0.15, C[0], 20, 46, 9.5 * w, fov, 0, sy, aspect))
    k.push(orbit(0.2, C[0], 14, 43, 9 * w, fov, 0, sy, aspect))
    k.push(orbit(0.246, SCOPE, 14, 16, 10.8 * w, fov, 0, sy, aspect))
    k.push(orbit(s(1, 0.3), C[1], 22, 40, 16.5 * w, fov, 0, sy, aspect, 0.15))
    k.push(orbit(s(1, 0.82), C[1], 16, 37, 15.5 * w, fov, 0, sy, aspect))
    k.push({ ...orbit(s(2, 0.26), C[2], 26, 22, 15 * w, fov, 0, sy, aspect), dip: 0.28 })
    k.push(orbit(s(2, 0.82), C[2], 20, 19, 14.2 * w, fov, 0, sy, aspect))
    k.push({ ...orbit(s(3, 0.26), C[3], 20, 44, 17 * w, fov, 0, sy, aspect), dip: 0.3 })
    k.push(orbit(s(3, 0.8), C[3], 14, 48, 16 * w, fov, 0, sy, aspect))
    const R = V(X[3], 0.9, 0.3)
    k.push(orbit(0.865, R, 4, 50, 25.5 * w, fov, 0, 0.42, aspect))
    k.push(orbit(0.955, R, 3, 52, 24.8 * w, fov, 0, 0.42, aspect))
    k.push(orbit(1, R, 2, 53, 24.4 * w, fov, 0, 0.42, aspect))
  }
  return k
}

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

function sample(keys: Key[], local: number, pos: THREE.Vector3, tgt: THREE.Vector3, c: THREE.Vector3): number {
  if (local <= keys[0].t) {
    pos.copy(keys[0].pos)
    tgt.copy(keys[0].tgt)
    c.copy(keys[0].c)
    return keys[0].fov
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (local <= b.t) {
      const e = smoother(segment(local, a.t, b.t))
      pos.lerpVectors(a.pos, b.pos, e)
      tgt.lerpVectors(a.tgt, b.tgt, e)
      c.lerpVectors(a.c, b.c, e)
      if (b.lift) pos.sub(tgt).multiplyScalar(1 + b.lift * Math.sin(Math.PI * e)).add(tgt)
      if (b.dip) {
        // a low, grazing slide over the perforated steel between stations
        const m = b.dip * Math.sin(Math.PI * e)
        pos.y = lerp(pos.y, 2.4, m)
        tgt.y = lerp(tgt.y, 1.6, m * 0.6)
      }
      return lerp(a.fov, b.fov, e)
    }
  }
  const z = keys[keys.length - 1]
  pos.copy(z.pos)
  tgt.copy(z.tgt)
  c.copy(z.c)
  return z.fov
}

// ---------------------------------------------------------------- colours

const AMBER_TOP = new THREE.Color('#3a2a0e')
const AMBER_BOT = new THREE.Color('#0a0804')
const WHITE_TOP = new THREE.Color('#1a1f26')
const WHITE_BOT = new THREE.Color('#07090c')
const BOKEH_A_AMB = new THREE.Color('#ffc766')
const BOKEH_B_AMB = new THREE.Color('#fff0d0')
const BOKEH_A_WHT = new THREE.Color('#e4ecf6')
const BOKEH_B_WHT = new THREE.Color(S.signal)

// ---------------------------------------------------------------- chapter

export default function create(): Chapter {
  const group = new THREE.Group()
  let bench: Bench
  let probe: ProbeStation
  let litho: LithoStation
  let stack: StackStation
  let burn: BurnInStation
  let fore: ForeBokeh
  const bokehCol = new THREE.Color()
  const BOKEH_AMB = new THREE.Color('#ffcf85')
  const BOKEH_WHT = new THREE.Color('#dfe9f5')
  const stations: THREE.Group[] = []
  let ready = false

  // DOM
  let head: HTMLElement, headline: HTMLElement
  let card: HTMLElement
  const stepEls: HTMLElement[] = []
  const stepTitles: HTMLElement[] = []
  const nodes: HTMLElement[] = []
  let fill: HTMLElement
  let specs: HTMLElement
  const cells: HTMLElement[] = []
  let shown = -2
  let cellsOn = false
  let fillCache = -1

  // probe labels (3D-anchored callouts): what each station is, datasheet style
  type Probe = { c: Callout; at: THREE.Vector3; win: readonly [number, number]; point: () => THREE.Vector3; column?: boolean; sx: number; w: number }
  /** the step card's box (updated on resize only — no per-frame layout reads) */
  const cardBox = { l: 0, t: 0, r: 0, b: 0 }
  const probes: Probe[] = []
  const _p = new THREE.Vector3()
  const _s = new THREE.Vector3()

  // per-frame scratch
  const pass = new Array(8).fill(0)
  const rise4 = [0, 0, 0, 0]
  const tmpPos = new THREE.Vector3()
  const tmpTgt = new THREE.Vector3()
  const tmpC = new THREE.Vector3()
  const top = new THREE.Color()
  const bot = new THREE.Color()
  const ca = new THREE.Color()
  const cb = new THREE.Color()
  const scratch = new THREE.PerspectiveCamera(30, 1, 0.1, 500)
  let keys: Key[] = []
  let keysAspect = -1
  let ctxRef: ChapterContext | null = null

  return {
    id: 'process',
    group,
    // the four steps, then the stats (srContent makes the first stat a keyboard stop)
    anchors: [...ANCHORS, STATS_AT],

    async init(ctx) {
      ctxRef = ctx
      const mobile = ctx.mobile
      bench = buildBench(X[0] - 26, X[3] + 26)
      group.add(bench.mesh)
      const die = dieTexture({ size: mobile ? 512 : 1024, seed: 11 })
      probe = buildProbe({ mobile, die: die.texture })
      probe.group.position.x = X[0]
      group.add(probe.group)
      await nextFrame()
      litho = buildLitho({ mobile })
      litho.group.position.x = X[1]
      group.add(litho.group)
      await nextFrame()
      stack = buildStack({ die: die.texture })
      stack.group.position.x = X[2]
      group.add(stack.group)
      burn = buildBurnIn({ mobile })
      burn.group.position.x = X[3]
      group.add(burn.group)
      stations.push(probe.group, litho.group, stack.group, burn.group)
      fore = buildBokeh(X[0] - 6, X[3] + 8, ctx.mobile ? 10 : 16)
      group.add(fore.mesh)
      await nextFrame()

      // ---- DOM
      const stage = ctx.stage
      head = el('div', 'pc-head', undefined, stage)
      el('p', 'hud-eyebrow', 'How we work', head)
      headline = rise(el('h2', 'hud-h2 pc-headline', undefined, head), 'We listen first. <em>Then we build.</em>')

      card = el('div', 'pc-card hud-panel', undefined, stage)
      const cardTop = el('div', 'pc-card-top', undefined, card)
      el('p', 'hud-label', 'Process flow', cardTop)
      el('p', 'hud-label pc-rev', 'HK-FAB · Rev A', cardTop)
      const steps = el('div', 'pc-steps', undefined, card)
      PROCESS.forEach((p, i) => {
        const s = el('div', 'pc-step', undefined, steps)
        const n = String(i + 1).padStart(2, '0')
        stepTitles.push(rise(el('h3', 'pc-title', undefined, s), `<em>${n}</em> — ${p.title}`))
        el('p', 'hud-body pc-text', p.text, s)
        el('p', 'pc-meta', `Stn ${n} · ${STATION[i]}`, s)
        stepEls.push(s)
      })
      const flow = el('div', 'pc-flow', undefined, card)
      const tr = el('span', 'pc-flow-trace', undefined, flow)
      fill = el('span', 'pc-flow-fill', undefined, tr)
      const ol = el('ol', 'pc-flow-nodes', undefined, flow)
      PROCESS.forEach(p => {
        const li = el('li', 'pc-node', undefined, ol)
        el('span', 'pc-pad', undefined, li)
        el('span', 'pc-name', p.title, li)
        nodes.push(li)
      })

      specs = el('div', 'pc-specs', undefined, stage)
      const specTop = el('div', 'pc-specs-top', undefined, specs)
      el('p', 'hud-label', 'Key specifications', specTop)
      el('p', 'hud-label pc-rev', 'HK-0N · Rev A', specTop)
      const row = el('div', 'pc-cells', undefined, specs)
      SHOW.forEach((s, i) => {
        const c = el('div', 'pc-cell hud-panel', undefined, row)
        c.style.setProperty('--i', String(i))
        el('p', 'pc-sym', `Spec 0${i + 1}`, c)
        el('p', 'pc-value', s.value, c)
        el('p', 'pc-label', s.label, c)
        cells.push(c)
      })
      // probe labels
      const probeLabel = (text: string, win: readonly [number, number], point: () => THREE.Vector3, side: 'left' | 'right', offset: { x: number; y: number }) => {
        const c = new Callout(stage, { side, offset: { ...offset } })
        c.label.textContent = text
        c.root.classList.add('pc-probe')
        reveal(c.root, 0, 0)
        // label width estimate (mono caps ≈ 8.4px per character + padding)
        probes.push({ c, at: new THREE.Vector3(), win, point, sx: 0, w: text.length * 8.4 + 18 })
      }
      probeLabel('Probe card · 112 ch', [0.17, 0.228], () => probe.tip, 'right', { x: 80, y: -70 })
      probeLabel('Photomask · Cr on quartz', [0.3, 0.42], () => _p.copy(litho.mark).add(litho.group.position), 'right', { x: 60, y: -56 })
      const tags = ['M1 · Metal 1', 'M2', 'M3', 'M4 · Top metal']
      for (let k = 3; k >= 0; k--) {
        // each tag appears as its layer lands
        const at = 0.483 + 0.0257 * k
        probeLabel(tags[k], [at, 0.596], () => _p.copy(stack.labels[k]).add(stack.group.position).setY(stack.labels[k].y + stack.drop[k]), 'left', { x: 46, y: 0 })
        probes[probes.length - 1].column = true
      }
      probeLabel('Burn-in · 8 / 8 pass', [0.735, 0.785], () => _p.copy(burn.leds[7]).add(burn.group.position), 'right', { x: 70, y: -64 })

      const measure = () => {
        const r = card.getBoundingClientRect()
        cardBox.l = r.left
        cardBox.t = r.top
        cardBox.r = r.right
        cardBox.b = r.bottom
      }
      measure()
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(card)
      window.addEventListener('resize', measure)

      reveal(head, 0, 0)
      reveal(card, 0, 0)
      reveal(specs, 0, 0)
      ready = true
    },

    update(local, frame, ctx) {
      if (!ready) return
      const rm = frame.reducedMotion
      const t = frame.time
      const portrait = frame.height > frame.width * 1.1

      // ---- stations (all state from local; time only for idle pulses)
      // needles: down fast and precise, a tiny settle (overtravel) on the pads
      const touchRaw = segment(local, TOUCH[0], TOUCH[1])
      const touch = touchRaw < 0.8 ? ease.inOutCubic(touchRaw / 0.8) : 1 - 0.06 * Math.sin(Math.PI * segment(touchRaw, 0.8, 1))
      probe.update({ scope: 1 - smoothstep(0.272, 0.3, local), touch: Math.min(touch, 1), listen: ease.inOutQuad(segment(local, LISTEN[0], LISTEN[1])), time: rm ? t * 0.15 : t, flow: rm ? 1.2 : 5.5, live: 1 })

      const p2 = act(local, 1)
      const inLitho = local > A + SP * 0.9 && local < A + SP * 2.1 ? 1 : 0
      litho.update({ sweep: ease.inOutQuad(segment(p2, 0.04, 0.94)), on: inLitho, time: t })

      const p3 = act(local, 2)
      for (let k = 0; k < 4; k++) rise4[k] = segment(p3, 0.02 + 0.21 * k, 0.24 + 0.21 * k)
      stack.update({ rise: rise4, glow: 1, time: rm ? t * 0.15 : t, flow: rm ? 0.6 : 2.6 })

      const p4 = act(local, 3)
      for (let i = 0; i < pass.length; i++) {
        const at = 0.46 + i * 0.055
        pass[i] = smoothstep(at, at + 0.035, p4)
      }
      burn.update({ place: segment(p4, 0.1, 0.42), pass, time: rm ? t * 0.15 : t, flow: rm ? 1 : 4.5, live: smoothstep(0.34, 0.45, p4) })

      // ---- world: the fab's yellow light, then clean white for the results
      const white = smoothstep(0.78, 0.87, local)
      fore.set({ time: rm ? 0 : t, intensity: 0.07, color: bokehCol.copy(BOKEH_AMB).lerp(BOKEH_WHT, white) })
      const w = ctx.world.params
      w.amber = 0.82 * (1 - white)
      w.top = top.copy(AMBER_TOP).lerp(WHITE_TOP, white)
      w.bottom = bot.copy(AMBER_BOT).lerp(WHITE_BOT, white)
      w.a = ca.copy(BOKEH_A_AMB).lerp(BOKEH_A_WHT, white)
      w.b = cb.copy(BOKEH_B_AMB).lerp(BOKEH_B_WHT, white)
      w.bokeh = 0.9
      w.env = lerp(1.35, 1.3, white)
      // (envTurn is set in camera(): the studio turns with the camera's subject along the bench)
      // key from the right and a little behind: 3/4 modelling and edge glints on
      // metal, with the mirror highlight of flat parts (wafers, dies) kept out of frame
      w.keyDir.set(0.8, 0.55, -0.25)
      w.key = lerp(2.3, 2.9, white)
      w.fill = lerp(0.5, 0.38, white)

      // ---- post
      const post = ctx.post.params
      post.bloomStrength = 0.62
      post.bloomRadius = 0.55
      post.bloomThreshold = 0.9
      post.vignette = 0.42
      post.grain = 0.034
      post.aberration = 0.0014

      // ---- DOM
      const headEnd = portrait ? 0.15 : 0.235
      reveal(head, window01(local, 0.04, headEnd, 0.03), 0)
      setRise(headline, local > 0.045 && local < headEnd - 0.01)

      const cardV = window01(local, CARD[0], CARD[1], 0.018)
      reveal(card, cardV, 0)
      const idx = clamp(Math.floor((local - A) / SP), 0, 3)
      const phase = clamp((local - A - idx * SP) / SP)
      const cur = local > CARD[0] && local < CARD[1] ? idx : -1
      if (cur !== shown) {
        shown = cur
        stepEls.forEach((s, i) => s.classList.toggle('is-on', i === cur))
        nodes.forEach((n, i) => {
          n.classList.toggle('is-on', i === cur)
          n.classList.toggle('is-done', cur >= 0 && i < cur)
        })
      }
      for (let i = 0; i < stepTitles.length; i++) setRise(stepTitles[i], i === cur && cardV > 0.05)
      // the signal runs along the track toward the next node late in each step
      const f = idx >= 3 ? 1 : (idx + ease.inOutCubic(segment(phase, 0.62, 1))) / 3
      const qf = Math.round(f * 1000)
      if (qf !== fillCache) {
        fillCache = qf
        fill.style.transform = `scaleX(${(qf / 1000).toFixed(3)})`
      }

      // probe labels: only where there's room (landscape), clear of the chrome bands
      const cam = ctx.camera
      // the chrome's bands (base.css --safe-top / --safe-bottom; thin on landscape phones)
      const short = frame.height <= 500 && frame.width > frame.height
      const bandT = (short ? 56 : clamp(frame.height * 0.105, 80, 112)) + 10
      const bandB = (short ? 52 : clamp(frame.height * 0.105, 82, 110)) + 10
      // the layer tags line up in one column left of the stack
      let column = Infinity
      for (const p of probes) {
        p.at.copy(p.point())
        _s.copy(p.at).project(cam)
        p.sx = (_s.x * 0.5 + 0.5) * frame.width
        if (p.column && Number.isFinite(p.sx)) column = Math.min(column, p.sx - 48)
      }
      for (const p of probes) {
        let v = portrait ? 0 : window01(local, p.win[0], p.win[1], 0.012)
        if (v > 0) {
          _s.copy(p.at).project(cam)
          const y = (-_s.y * 0.5 + 0.5) * frame.height
          const top = Math.min(y, y + p.c.offset.y - 12)
          const bot = Math.max(y, y + p.c.offset.y + 12)
          if (!(top > bandT && bot < frame.height - bandB)) v = 0
          if (p.column && Number.isFinite(column)) p.c.offset.x = Math.max(24, p.sx - column)
          // keep the label (and its leader) clear of the step card
          const ly = y + p.c.offset.y
          const x0 = p.c.side === 'left' ? p.sx - p.c.offset.x - 8 - p.w : p.sx
          const x1 = p.c.side === 'left' ? p.sx : p.sx + p.c.offset.x + 8 + p.w
          if (x0 < cardBox.r + 16 && x1 > cardBox.l - 16 && Math.max(y, ly) > cardBox.t - 22 && Math.min(y, ly) < cardBox.b + 22) v = 0
        }
        p.c.update(p.at, cam, frame.width, frame.height, v)
      }

      const on = local > CELLS[0] && local < CELLS[1]
      reveal(specs, window01(local, CELLS[0] - 0.012, CELLS[1] + 0.006, 0.02), 0)
      if (on !== cellsOn) {
        cellsOn = on
        for (const c of cells) c.classList.toggle('is-on', on)
      }
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const aspect = frame.width / Math.max(1, frame.height)
      if (Math.abs(aspect - keysAspect) > 1e-3) {
        keys = keysFor(aspect)
        keysAspect = aspect
      }
      const fov = sample(keys, local, tmpPos, tmpTgt, tmpC)
      // a slow macro breath while dwelling (idle only)
      if (!frame.reducedMotion) tmpPos.y += Math.sin(frame.time * 0.35) * 0.04
      out.position.copy(tmpPos)
      out.target.copy(tmpTgt)
      out.fov = fov
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.22

      if (!ready) return
      bench.focus.set(tmpC.x, tmpC.z)
      // the studio turns as the camera slides between stations, sweeping the
      // highlights across the metal; each station has its own best angle
      // (station 3's copper reads as copper on every face at -1.5)
      const u = clamp(tmpC.x / (X[1] - X[0]), 0, 3)
      const i0 = Math.min(2, Math.floor(u))
      const turn = lerp(TURN[i0], TURN[i0 + 1], ease.inOutCubic(u - i0)) + 0.45 * smoothstep(0.8, 0.95, local)
      if (ctxRef) ctxRef.world.params.envTurn = turn
      for (let k = 0; k < 4; k++) stations[k].visible = Math.abs(X[k] - tmpC.x) < 30
      if (ctxRef) {
        scratch.position.copy(tmpPos)
        scratch.fov = fov
        scratch.aspect = aspect
        scratch.updateProjectionMatrix()
        scratch.lookAt(tmpTgt)
        scratch.updateMatrixWorld()
        _f.copy(tmpC).project(scratch)
        if (Number.isFinite(_f.x) && Number.isFinite(_f.y)) ctxRef.world.params.focus.set(clamp(_f.x, -1.2, 1.2) * aspect, clamp(_f.y, -0.9, 0.9))
      }
    },
  }
}
