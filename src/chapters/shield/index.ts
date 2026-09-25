import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECURITY, STATS } from '../../content'
import { S } from '../../kit/silicon'
import { P, CAN, along, buildBoard, sharedMaterials, type Board } from './board'
import { Bokeh, RailPulses, Sparks, nozzle, shieldCan } from './fx'
import { applyFocus, focus } from './focus'
import './shield.css'

/*
 * SURGE — "Hacked? Breathe."  The power input of the Hark board, shot macro.
 *
 *   0.00–0.30  THE SURGE   a red surge races in from the USB-C port at the
 *                          board edge along the input rail toward the Hark
 *                          chip; the input via flashes over (sparks), the fuse
 *                          heats, the green signals brown out (glitch ≤ 0.28),
 *                          the chip's STAT LED flickers amber (slow). A
 *                          datasheet fault panel reads FAULT · OVERVOLTAGE.
 *   0.30–0.60  BREATHE     the TVS diode clamps: past it the rail runs green,
 *                          the surge drains red into the ground vias, the fuse
 *                          cools and holds, and a pick-and-place head drops the
 *                          shield can over the secure element. Headline + body
 *                          (+ three status rows) settled by the 0.45 landing.
 *   0.60–0.95  STEADY      calm green traffic, the WDT LED breathes; '24/7' +
 *                          its label + the emergency CTA (anchor 0.8).
 *
 * Everything derives from `local`; frame.time drives only idle motion (pulses,
 * sparks, LED breathing/flicker). Reduced motion or Motion off (frame.still):
 * slow signals, no sparks, no glitch, static LEDs, no camera drift.
 */

const STAT = STATS.find(s => s.value === '24/7') ?? STATS[STATS.length - 1]
const TITLE = SECURITY.title.replace('Breathe.', '<em>Breathe.</em>')

/** Story envelopes — pure functions of local. */
function story(l: number) {
  const surge = smoothstep(0.045, 0.1, l)
  const clampOn = smoothstep(0.3, 0.355, l)
  const threat = surge * (1 - clampOn)
  return {
    surge,
    clampOn,
    threat,
    flash: smoothstep(0.1, 0.15, l) * (1 - smoothstep(0.27, 0.33, l)),
    heat: smoothstep(0.12, 0.26, l) * (1 - smoothstep(0.34, 0.5, l)),
    drain: smoothstep(0.3, 0.335, l) * (1 - smoothstep(0.42, 0.56, l)),
    steady: smoothstep(0.38, 0.5, l),
    drop: segment(l, 0.35, 0.412),
    settle: segment(l, 0.412, 0.432),
    lift: segment(l, 0.438, 0.53),
    wdt: smoothstep(0.46, 0.56, l),
    fault: smoothstep(0.075, 0.11, l) * (1 - smoothstep(0.265, 0.295, l)),
    a: smoothstep(0.31, 0.355, l) * (1 - smoothstep(0.6, 0.635, l)),
    b: smoothstep(0.655, 0.69, l) * (1 - smoothstep(0.945, 0.975, l)),
    coWarn: smoothstep(0.125, 0.155, l) * (1 - smoothstep(0.255, 0.285, l)),
    coClamp: smoothstep(0.335, 0.36, l) * (1 - smoothstep(0.462, 0.48, l)),
    coCan: smoothstep(0.482, 0.5, l) * (1 - smoothstep(0.575, 0.6, l)),
    coWdt: smoothstep(0.72, 0.75, l) * (1 - smoothstep(0.925, 0.95, l)),
  }
}

/** surge front distance along the main rail */
function reachAt(l: number, split: number, len: number) {
  const a = ease.inQuad(segment(l, 0.045, 0.165)) * (split + 0.25)
  const b = ease.outCubic(segment(l, 0.165, 0.3)) * Math.max(0, (len - split - 0.25) * 0.72)
  return a + b
}

// ------------------------------------------------------------------ camera

interface Key {
  l: number
  s: THREE.Vector3
  /** orbit angle around the subject (rad, 0 = from +z, − toward −x) */
  a: number
  /** elevation above the board plane (rad) */
  e: number
  d: number
  fov: number
  /** where the subject sits on screen (NDC) */
  ox: number
  oy: number
}
const k = (l: number, x: number, z: number, a: number, e: number, d: number, fov: number, ox: number, oy: number): Key => ({
  l,
  s: new THREE.Vector3(x, 0.1, z),
  a,
  e,
  d,
  fov,
  ox,
  oy,
})

const LAND: Key[] = [
  k(0.0, -2.7, 0.7, -0.6, 0.3, 5.6, 30, 0.13, -0.12),
  k(0.14, -2.45, 0.7, -0.55, 0.32, 5.3, 30, 0.14, -0.11),
  k(0.28, -1.95, 0.6, -0.48, 0.38, 5.4, 30, 0.16, -0.08),
  k(0.37, -1.1, 0.0, -0.38, 0.64, 6.8, 30, 0.24, 0.0),
  k(0.46, -0.6, -0.12, -0.27, 0.72, 7.8, 30, 0.3, 0.0),
  k(0.6, -0.5, -0.12, -0.22, 0.74, 7.7, 30, 0.3, 0.01),
  k(0.78, -0.45, -0.05, -0.1, 0.8, 8.2, 30, 0.28, 0.02),
  k(1.0, -0.4, -0.05, -0.02, 0.84, 8.6, 30, 0.28, 0.02),
]
const TALL: Key[] = [
  k(0.0, -2.7, 0.7, -1.2, 0.55, 8.2, 40, 0.0, 0.26),
  k(0.14, -2.45, 0.7, -1.1, 0.58, 7.8, 40, 0.0, 0.27),
  k(0.28, -2.0, 0.65, -0.95, 0.62, 7.6, 40, 0.0, 0.3),
  k(0.37, -1.0, 0.15, -0.5, 0.74, 9.8, 40, 0.0, 0.36),
  k(0.46, -0.6, 0.1, -0.36, 0.82, 10.9, 40, 0.0, 0.42),
  k(0.6, -0.55, 0.1, -0.3, 0.84, 10.7, 40, 0.0, 0.42),
  k(0.78, -0.45, 0.1, -0.15, 0.88, 11.3, 40, 0.0, 0.42),
  k(1.0, -0.4, 0.1, -0.06, 0.92, 11.7, 40, 0.0, 0.42),
]

const _S = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _v = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const RED = new THREE.Color(S.red)
const AMBER = new THREE.Color(S.amber)
const GREEN = new THREE.Color(S.signal)
const OFF = new THREE.Color('#cfd6cf')
const HOT = new THREE.Color('#ff5a2a')
const _c = new THREE.Color()
const _c2 = new THREE.Color()
const _look = new THREE.Vector3()

// ------------------------------------------------------------------ chapter

export default function create(): Chapter {
  const group = new THREE.Group()
  group.name = 'shield'
  let board: Board
  let rail: RailPulses
  let sparks: Sparks
  let bokeh: Bokeh
  let can: THREE.Group
  let head: THREE.Group
  let railLen = 1
  let shuntLen = 1
  const glows: Record<'front' | 'via' | 'fuse' | 'd1', THREE.Sprite> = {} as never
  let stage: HTMLElement
  let scrim: HTMLElement, probe: HTMLElement
  let fault: HTMLElement, volt: HTMLElement, meter: HTMLElement
  let copyA: HTMLElement, title: HTMLElement
  let copyB: HTMLElement, stat: HTMLElement, liveDot: HTMLElement
  const checks: { at: number; node: HTMLElement; state: HTMLElement; from: string; to: string; on: boolean }[] = []
  let coWarn: Callout, coClamp: Callout, coCan: Callout, coWdt: Callout
  let lastVolt = ''
  let cam: THREE.PerspectiveCamera | null = null
  /** focus follows last frame's camera, except right after a snap (enter, jump) */
  let camLocal = -1
  const tmp = new THREE.Vector3()
  const labelW = new Map<Callout, number>()
  const lay = { dirty: true, top: 90, bottom: 90, aRight: 0, aTop: 0, bRight: 0, bTop: 0, fRight: 0, fTop: 0, fBottom: 0, w: 0, h: 0 }

  function measure(frame: Frame) {
    lay.dirty = false
    lay.w = frame.width
    lay.h = frame.height
    lay.top = probe.offsetTop
    lay.bottom = frame.height - (probe.offsetTop + probe.offsetHeight)
    let right = 0
    for (const n of copyA.querySelectorAll<HTMLElement>('.sh-eyebrow, .sh-plate, .rise-w')) right = Math.max(right, n.getBoundingClientRect().right)
    const ra = copyA.getBoundingClientRect()
    const rb = copyB.getBoundingClientRect()
    const rf = fault.getBoundingClientRect()
    lay.aRight = right || ra.right
    lay.aTop = ra.top
    lay.bRight = rb.right
    lay.bTop = rb.top
    lay.fRight = rf.right
    lay.fTop = rf.top
    lay.fBottom = rf.bottom
    for (const c of [coWarn, coClamp, coCan, coWdt]) labelW.set(c, c.label.offsetWidth)
  }

  /** Place a callout clear of the chrome bands and of the copy block that is showing. */
  function place(c: Callout, at: THREE.Vector3, vis: number, ctx: ChapterContext, frame: Frame, copy: 'a' | 'b' | 'f' | null, below = false) {
    if (vis <= 0.001) {
      c.update(at, ctx.camera, frame.width, frame.height, 0)
      return
    }
    _v.copy(at).project(ctx.camera)
    const w = frame.width
    const tall = frame.height > frame.width
    const x = (_v.x * 0.5 + 0.5) * w
    const y = (-_v.y * 0.5 + 0.5) * frame.height
    const lw = labelW.get(c) || 220
    const base = tall ? { x: 30, y: below ? 64 : -70 } : { x: 64, y: below ? 60 : -56 }
    c.offset.x = base.x
    c.offset.y = base.y
    const room = w - 12 - 8 - lw - x
    if (room < base.x) c.offset.x = Math.max(14, room)
    const labelY = y + c.offset.y
    let ok = _v.z < 1 && Math.min(y, labelY - 4) > lay.top + 8 && Math.max(y, labelY + 34) < frame.height - lay.bottom - 6
    if (ok && copy) {
      const right = copy === 'a' ? lay.aRight : copy === 'b' ? lay.bRight : lay.fRight
      const top = copy === 'a' ? lay.aTop : copy === 'b' ? lay.bTop : lay.fTop
      if (tall) ok = Math.max(y, labelY + 36) < top - 10
      else {
        const flips = room < 14
        const labelLeft = flips ? x - c.offset.x - 8 - lw : x
        ok = (x > right + 24 && labelLeft > right + 12) || (copy === 'f' && Math.min(y, labelY - 4) > lay.fBottom + 10)
      }
    }
    c.update(at, ctx.camera, frame.width, frame.height, ok ? vis : 0)
  }

  function sprite(color: THREE.ColorRepresentation, scale: number) {
    // no depth test: a camera-facing glow would otherwise be cut flat where it dips into the board
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: board.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false }))
    s.scale.setScalar(scale)
    s.renderOrder = 4
    group.add(s)
    return s
  }

  function callout(stage: HTMLElement, key: string, sub: string, mod: string) {
    const c = new Callout(stage, { side: 'right', offset: { x: 64, y: -56 } })
    c.root.classList.add('sh-co', `sh-co--${mod}`)
    el('span', 'sh-co-k', key, c.label)
    el('span', 'sh-co-v', sub, c.label)
    return c
  }

  return {
    id: 'shield',
    group,
    anchors: [0.8],

    async init(ctx) {
      cam = ctx.camera
      board = await buildBoard(ctx.mobile)
      group.add(board.root)
      rail = new RailPulses(board.main, board.split)
      railLen = board.main.lengths[0] ?? 3
      shuntLen = Math.max(...board.shunt.lengths)
      await nextFrame()
      sparks = new Sparks(ctx.mobile ? 26 : 44)
      sparks.obj.position.set(P.v1.x, 0.004, P.v1.z)
      group.add(sparks.obj)
      can = shieldCan()
      can.position.set(P.can.x, 0, P.can.z)
      head = nozzle()
      head.position.set(P.can.x, CAN.h, P.can.z)
      group.add(can, head)
      glows.front = sprite(RED, 0.34)
      glows.via = sprite('#ff5a2a', 0.42)
      glows.via.position.set(P.v1.x, 0.05, P.v1.z)
      glows.fuse = sprite('#ff6a2a', 0.6)
      glows.fuse.position.set(P.f1.x, 0.14, P.f1.z)
      glows.d1 = sprite(RED, 0.5)
      glows.d1.position.set(P.d1.x, 0.16, P.d1.z)
      // macro focus falloff on everything this chapter draws
      applyFocus(group, sharedMaterials())
      // out-of-focus lights far down the board (added after the falloff: they ARE the defocus)
      bokeh = new Bokeh(ctx.mobile ? 6 : 9)
      group.add(bokeh.group)

      // ---------------------------------------------------------- DOM
      stage = ctx.stage
      scrim = el('div', 'sh-scrim', undefined, stage)
      probe = el('div', 'sh-probe', undefined, stage)

      // beat 1: the fault readout (decorative datasheet detail)
      fault = el('div', 'hud-panel sh-fault', undefined, stage)
      const fh = el('div', 'sh-fault-head', undefined, fault)
      el('span', 'sh-fault-k', 'Fault · Overvoltage', fh)
      el('span', 'hud-label', 'EVT 0x3F', fh)
      const rd = el('div', 'sh-read', undefined, fault)
      el('span', 'hud-label', 'VBUS · J1', rd)
      volt = el('b', 'sh-volt', '5.0 V', rd)
      meter = el('div', 'sh-meter', undefined, fault)
      el('i', 'sh-meter-fill', undefined, meter)
      el('b', 'sh-meter-limit', undefined, meter)
      el('p', 'hud-label sh-fault-meta', 'Limit 5.5 V · J1 → F1 → U1', fault)

      // beat 2: eyebrow, headline, body + status rows
      copyA = el('div', 'sh-a', undefined, stage)
      el('p', 'hud-eyebrow sh-eyebrow', SECURITY.eyebrow, copyA)
      title = rise(el('h2', 'hud-title sh-title', undefined, copyA), TITLE)
      const plate = el('div', 'hud-panel sh-plate', undefined, copyA)
      el('p', 'hud-body', SECURITY.body, plate)
      const list = el('ul', 'sh-checks', undefined, plate)
      for (const [ref, name, from, to, at] of [
        ['D1', 'TVS clamp', 'Armed', 'Clamped', 0.335],
        ['F1', 'Fuse', 'Hot', 'Holding', 0.4],
        ['SH1', 'Shield can', 'Open', 'Seated', 0.428],
      ] as const) {
        const li = el('li', 'sh-check', undefined, list)
        el('span', 'sh-ref', ref, li)
        el('span', 'sh-name', name, li)
        const st = el('span', 'sh-state', from, li)
        checks.push({ at, node: li, state: st, from, to, on: false })
      }

      // beat 3: 24/7 + label + CTA
      copyB = el('div', 'hud-panel sh-b', undefined, stage)
      const hd = el('div', 'sh-b-head', undefined, copyB)
      const live = el('span', 'hud-label sh-live', undefined, hd)
      liveDot = el('i', 'sh-live-dot', undefined, live)
      live.append('WDT · Heartbeat')
      el('span', 'hud-label', 'U1 · REV A', hd)
      stat = rise(el('p', 'hud-title sh-stat', undefined, copyB), STAT.value)
      el('hr', 'hud-rule sh-rule', undefined, copyB)
      el('p', 'hud-body sh-stat-label', STAT.label, copyB)
      const cta = el('a', 'hud-btn sh-cta', SECURITY.cta, copyB)
      cta.href = SECURITY.href

      coWarn = callout(stage, 'V1 · Flashover', 'Arc across the input via', 'warn')
      coClamp = callout(stage, 'D1 · TVS clamp', 'Surge shunted to ground', 'ok')
      coCan = callout(stage, 'SH1 · Shield can', 'Secure element, sealed', 'ok')
      coWdt = callout(stage, 'WDT · Watchdog', 'Always listening', 'ok')

      for (const n of [scrim, fault, copyA, copyB]) reveal(n, 0, 0)
      const mark = () => (lay.dirty = true)
      window.addEventListener('resize', mark)
      document.fonts?.ready.then(mark)
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(mark).observe(stage)
    },

    onEnter() {
      lay.dirty = true
      camLocal = -1
    },

    update(local, frame, ctx) {
      const st = story(local)
      // the calm path: reduced motion, or the visitor paused ambient motion
      const rm = ctx.reducedMotion || !!frame.still
      const t = frame.time
      // slow, irregular waver (≤ 2 Hz components): brownout, LED flicker, glitch
      const waver = rm ? 0.5 : clamp(0.5 + 0.5 * Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1.1) + 0.18 * Math.sin(t * 11.3 + 0.4))

      // ---------------------------------------------------------- signals
      const reach = reachAt(local, board.split, railLen)
      const u = rail.u
      u.uTime.value = t
      u.uFlowR.value = rm ? 1.2 : 13
      u.uFlowG.value = rm ? 0.5 : lerp(2.2, 3, st.steady)
      u.uDensR.value = 4.5
      u.uDensG.value = 1.6
      u.uReach.value = reach
      u.uClamp.value = st.clampOn
      u.uSurge.value = st.surge * (2.2 - 1.1 * smoothstep(0.34, 0.5, local))
      u.uCalm.value = lerp(1, 0.25 + 0.3 * waver, st.threat)
      u.uSteady.value = st.steady
      board.shunt.set({
        time: t,
        flow: rm ? 1 : 7,
        density: 5,
        glow: 1.7 * st.drain,
        reach: shuntLen * smoothstep(0.3, 0.345, local) + 0.3,
      })
      board.bus.set({
        time: t,
        flow: rm ? 0.4 : lerp(2.2, 2.6, st.steady),
        density: 0.75,
        glow: lerp(0.45, 0.1 + 0.2 * waver, st.threat),
      })

      // ---------------------------------------------------------- the surge front, flashover, heat, clamp
      along(board.mainPath, reach - 0.06, tmp)
      glows.front.position.set(tmp.x, 0.06, tmp.z)
      const frontOn = st.surge * (1 - st.clampOn) * smoothstep(0.02, 0.2, reach)
      glows.front.material.color.copy(RED).multiplyScalar(1.6 * frontOn)
      glows.front.scale.setScalar(0.3 + 0.06 * waver)
      glows.via.material.color.copy(HOT).multiplyScalar(st.flash * (0.55 + 0.45 * waver) * 1.3)
      glows.via.visible = st.flash > 0.002
      sparks.set(t, rm ? 0 : st.flash)
      bokeh.set(rm ? 0 : t, 0.4, st.threat * 0.35, RED)
      board.fuse.emissiveIntensity = st.heat * (0.15 + 0.03 * waver)
      glows.fuse.material.color.copy(HOT).multiplyScalar(st.heat * 0.6)
      glows.fuse.visible = st.heat > 0.002
      glows.d1.material.color.copy(RED).multiplyScalar(st.drain * 0.55)
      glows.d1.visible = st.drain > 0.002

      // ---------------------------------------------------------- LEDs
      // STAT: amber, flickering slowly while the rail is hit; green once clean
      const flick = rm ? 0.8 : 0.35 + 0.65 * waver
      const amber = st.surge * (1 - smoothstep(0.32, 0.38, local))
      const okLed = smoothstep(0.42, 0.48, local)
      _c.copy(OFF).lerp(_c2.copy(AMBER).multiplyScalar(2.6), amber * flick)
      _c.lerp(_c2.copy(GREEN).multiplyScalar(1.6), okLed)
      board.stat.lens.color.copy(_c)
      board.stat.glow.material.color.copy(AMBER).multiplyScalar(amber * flick * 0.9).add(_c2.copy(GREEN).multiplyScalar(okLed * 0.35))
      // WDT: breathes slowly (a ~4.5 s cycle) in the steady state
      const breath = rm ? 0.75 : 0.25 + 0.75 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 4.5))
      const wdt = st.wdt * breath
      board.wdt.lens.color.copy(OFF).lerp(_c2.copy(GREEN).multiplyScalar(3), wdt)
      board.wdt.glow.material.color.copy(GREEN).multiplyScalar(wdt * 0.9)

      // ---------------------------------------------------------- the shield can: pick, place, settle, release
      const drop = ease.inOutCubic(st.drop)
      const hover = 0.022
      const canY = lerp(3.2, hover, drop) - hover * ease.outCubic(st.settle)
      can.visible = local > 0.33
      can.position.y = canY
      head.visible = local > 0.33 && st.lift < 1
      head.position.y = canY + CAN.h + ease.inCubic(st.lift) * 4
      const sh = board.canShadow.material as THREE.MeshBasicMaterial
      sh.opacity = can.visible ? 0.85 * smoothstep(1.2, 0, canY) : 0

      // ---------------------------------------------------------- world + post
      const p = ctx.world.params
      const tall = frame.height > frame.width
      p.top = '#0a0d14'
      p.bottom = '#030408'
      p.a = st.threat > 0.5 ? S.red : S.signal
      p.b = st.threat > 0.5 ? '#2a2f3d' : '#3f7cff'
      p.bokeh = 0.75
      p.focus.set(tall ? 0 : 0.35, tall ? 0.4 : 0.1)
      p.env = lerp(0.95, 1.15, st.steady)
      // sweep the studio across the can as it arrives
      p.envTurn = lerp(-0.5, 0.45, smoothstep(0.34, 0.5, local)) + 0.25 * smoothstep(0.6, 1, local)
      // the key comes from behind and above: glints on pads, pins and the can lid, a sheen on the mask
      // portrait frames look along the rail from the left, into the key: soften it there
      p.key = tall ? 0.8 : 1.25
      p.keyDir.set(-0.75, 0.55, -0.38)
      p.fill = 0.22

      const post = ctx.post.params
      post.glitch = rm ? 0 : Math.min(0.28, 0.26 * st.threat * smoothstep(0.08, 0.16, local) * (0.35 + 0.65 * waver))
      post.bloomStrength = 0.55 + 0.3 * st.threat
      post.vignette = 0.34 + 0.12 * st.threat
      post.aberration = 0.0012 + 0.0012 * st.threat

      // ---------------------------------------------------------- DOM
      if (lay.dirty || lay.w !== frame.width || lay.h !== frame.height) measure(frame)
      reveal(fault, st.fault)
      const v = (5 + 31.8 * ease.inOutQuad(segment(local, 0.06, 0.25))).toFixed(1)
      if (v !== lastVolt) {
        lastVolt = v
        volt.textContent = `${v} V`
        meter.style.setProperty('--v', (Number(v) / 40).toFixed(3))
      }
      reveal(copyA, st.a)
      setRise(title, local > 0.32 && local < 0.62)
      for (const c of checks) {
        const on = local >= c.at
        if (on !== c.on) {
          c.on = on
          c.state.textContent = on ? c.to : c.from
          c.node.classList.toggle('is-ok', on)
        }
      }
      reveal(copyB, st.b)
      setRise(stat, local > 0.66 && local < 0.96)
      liveDot.style.opacity = (0.35 + 0.65 * breath).toFixed(2)
      reveal(scrim, Math.max(st.a, st.b, st.fault * 0.6), 0)

      // the flashover label hangs below the via, clear of the fuse
      place(coWarn, tmp.set(P.v1.x, 0.02, P.v1.z), st.coWarn, ctx, frame, 'f', true)
      place(coClamp, tmp.set(P.d1.x, 0.23, P.d1.z), st.coClamp, ctx, frame, 'a')
      place(coCan, tmp.set(P.can.x + 0.35, CAN.h, P.can.z - 0.25), st.coCan, ctx, frame, 'a')
      place(coWdt, tmp.set(P.wdt.x, 0.07, P.wdt.z), st.coWdt, ctx, frame, 'b')
    },

    camera(local, frame, out) {
      const tall = frame.height > frame.width
      const keys = tall ? TALL : LAND
      let i = 0
      while (i < keys.length - 2 && local > keys[i + 1].l) i++
      const A = keys[i]
      const B = keys[i + 1]
      const t0 = clamp((local - A.l) / (B.l - A.l))
      const u = lerp(t0, t0 * t0 * (3 - 2 * t0), 0.85)
      _S.copy(A.s).lerp(B.s, u)
      const a = lerp(A.a, B.a, u)
      const e = lerp(A.e, B.e, u)
      let d = lerp(A.d, B.d, u)
      const fov = lerp(A.fov, B.fov, u)
      const ox = lerp(A.ox, B.ox, u)
      const oy = lerp(A.oy, B.oy, u)
      // narrow landscape screens: step back a touch so the cluster fits right of the copy
      const aspect = frame.width / Math.max(1, frame.height)
      if (!tall && aspect < 1.5) d *= lerp(1.18, 1, clamp((aspect - 1.2) / 0.3))
      const ce = Math.cos(e)
      out.position.set(_S.x + Math.sin(a) * ce * d, _S.y + Math.sin(e) * d, _S.z + Math.cos(a) * ce * d)
      _fwd.copy(_S).sub(out.position).normalize()
      _right.crossVectors(_fwd, UP).normalize()
      _up.crossVectors(_right, _fwd)
      const hh = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * d
      const hw = hh * aspect
      out.target.copy(_S).addScaledVector(_right, -ox * hw).addScaledVector(_up, -oy * hh)
      out.fov = fov
      out.roll = 0
      out.parallax = 0.18
      // focus on the subject; the board behind falls off into soft shadow.
      // The engine eases the pose ~0.2 s behind the scroll, so rack to the
      // subject's depth as the lens actually sees it (last frame's camera):
      // the raw distance would run ahead on a brisk scroll and sink the
      // subject into the defocus until the camera caught up. The engine
      // snaps the pose on entry and on a > 0.04 jump: use the pose then.
      let fd = d
      if (cam && camLocal >= 0 && Math.abs(local - camLocal) <= 0.04) {
        cam.getWorldDirection(_look)
        const depth = _v.copy(_S).sub(cam.position).dot(_look)
        if (depth > 0.5) fd = d + clamp(depth - d, -3, 3)
      }
      camLocal = local
      focus.uFocus.value = fd
      focus.uFar.value = tall ? 5 : 3.6
      focus.uNear.value = 2.6
      // a macro slider breathing on its rails (never under reduced motion / Motion off)
      if (!frame.reducedMotion && !frame.still) {
        const tt = frame.time
        out.position.addScaledVector(_right, Math.sin(tt * 0.21) * 0.04)
        out.position.y += Math.sin(tt * 0.17 + 1.3) * 0.025
      }
    },
  }
}
