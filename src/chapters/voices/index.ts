import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, remap, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECTIONS } from '../../content'
import { S } from '../../kit/silicon'
import { CLIENTS, D, DIES, N, P, TOP, buildProbe, buildWafer, dieCentre, dieInside, R, type Wafer } from './wafer'
import './voices.css'

/*
 * WAFER (voices) — a 300 mm wafer on a black vacuum chuck, shot like a
 * product macro. Eight of its dies are the clients': each is still a die
 * (its floorplan, pads and seal ring carry the frame), signed with the
 * client's initials as small top-metal chip art in one corner and a mask-ID
 * line in the scribe lane ('SQ · BELLVIEW WINERY'). A prober works through
 * them: the needles lift, the stage slides the wafer (a precise move, a tiny
 * fine-alignment step), the needles touch down on the pads, the die powers
 * up (a signal racing round its seal ring, the bin dot lit — the only green
 * on the die) — and the client talks.
 *
 *   0.000–0.088  intro: the whole wafer turning in the light (a diffraction
 *                rainbow sweeps it), "We listen. They talk."
 *   0.080–0.148  the dive: from the wide shot down to die 1 under the probe
 *   0.088–0.920  eight voices (0.104 each). Around each boundary the stage
 *                steps to the next client die (the copy switches mid-move);
 *                then the needles touch down and everything holds.
 *   0.921–0.962  out: the needles lift, the lens pulls back to the whole
 *                wafer turning — eight green pass marks on it — and the SEM
 *                cut scans it to monochrome.
 *
 * Everything is derived from `local`; frame.time only drives idle motion
 * (signal pulses, the wafer's slow turn in the wide shots, a lens breath).
 */

const B0 = 0.088
const B1 = 0.92
const SPAN = (B1 - B0) / N
/** scroll hysteresis around every card boundary */
const HYST = 0.005
const DIVE0 = 0.08
const DIVE1 = 0.148
/** the stage step around each boundary b: [b − PRE, b + POST] (the copy switches mid-move) */
const PRE = 0.016
const POST = 0.024
const OUT0 = 0.921
const OUT1 = 0.962
/** per client die: camera azimuth and elevation offsets (deg) and a distance factor — a little variety between stops */
const AZ = [-9, 7, -5, 9, -7, 5, -9, 0]
const EL = [0, 3, -2, 4, -3, 2, -1, 1]
const DK = [1, 0.95, 1.04, 0.97, 1.03, 0.95, 1.02, 1]

const bOf = (i: number) => B0 + i * SPAN
/** local where die k's touchdown completes */
const arriveOf = (k: number) => (k === 0 ? DIVE1 : bOf(k) + POST)
/** local where the needles leave die k */
const leaveOf = (k: number) => (k < N - 1 ? bOf(k + 1) - PRE : OUT0)

interface Track {
  /** -1 = wide intro, 0..N-1 = client dies, N = wide out */
  from: number
  to: number
  /** raw 0..1 through the move */
  raw: number
  /** eased stage/camera progress */
  t: number
  /** 0..1 how far the probe is lifted in a step (0 = touching) */
  lift: number
  /** probe height (cm) */
  probeY: number
  /** 0..1 dwell progress at rest on `from` (the slow push-in) */
  dwell: number
}

/** a precise stage move: a clean slide to 98.5 %, a beat, then a fine-alignment step */
function stageEase(m: number): number {
  const coarse = ease.inOutCubic(clamp(m / 0.8))
  return 0.985 * coarse + 0.015 * smoothstep(0.88, 1, m)
}

function trackAt(local: number, o: Track): Track {
  o.lift = 0
  o.probeY = 0
  o.dwell = 0
  o.raw = 0
  if (local < DIVE0) {
    o.from = o.to = -1
    o.t = 0
    o.probeY = 5
    return o
  }
  if (local < DIVE1) {
    o.from = -1
    o.to = 0
    o.raw = (local - DIVE0) / (DIVE1 - DIVE0)
    o.t = ease.inOutCubic(o.raw)
    o.probeY = lerp(5, 0, smoothstep(0.3, 0.97, o.raw) ** 0.7)
    return o
  }
  if (local >= OUT0) {
    o.from = N - 1
    o.to = N
    o.raw = clamp((local - OUT0) / (OUT1 - OUT0))
    o.t = ease.inOutCubic(o.raw)
    o.probeY = lerp(0, 5, smoothstep(0, 0.55, o.raw))
    return o
  }
  // steps between client dies
  let k = 0
  for (let i = 1; i < N; i++) if (local >= bOf(i) - PRE) k = i
  const a = bOf(k) - PRE
  const b = bOf(k) + POST
  if (k > 0 && local < b) {
    o.from = k - 1
    o.to = k
    o.raw = (local - a) / (b - a)
    const m = clamp((o.raw - 0.12) / 0.76)
    o.t = stageEase(m)
    o.lift = smoothstep(0, 0.14, o.raw) * (1 - smoothstep(0.84, 1, o.raw))
    o.probeY = 0.2 * o.lift
    return o
  }
  // at rest on die k
  o.from = o.to = k
  o.t = 0
  o.dwell = clamp((local - arriveOf(k)) / Math.max(1e-3, leaveOf(k) - arriveOf(k)))
  return o
}

/** 0 in the wide shots, 1 at the macro stops (eased through the dive and the pull-back) */
function macroOf(tr: Track): number {
  const wideA = tr.from < 0 || tr.from >= N
  const wideB = tr.to < 0 || tr.to >= N
  return wideA && wideB ? 0 : wideA ? tr.t : wideB ? 1 - tr.t : 1
}

/** 0 = landscape layout, 1 = portrait (mirrors voices.css) */
const portraitK = (f: Frame) => clamp(remap(f.width / Math.max(1, f.height), 1.02, 0.86))

interface Pose {
  /** camera target (world) */
  tgt: THREE.Vector3
  el: number
  az: number
  /** log distance */
  ld: number
  fov: number
  /** where the target should sit on screen (NDC) */
  nx: number
  ny: number
}
const mkPose = (): Pose => ({ tgt: new THREE.Vector3(), el: 0, az: 0, ld: 0, fov: 30, nx: 0, ny: 0 })

export default function create(): Chapter {
  const group = new THREE.Group()
  let wafer: Wafer
  let probe: THREE.Group
  let ready = false

  // DOM
  let intro: HTMLElement
  let introTitle: HTMLElement
  let panel: HTMLElement
  let stack: HTMLElement
  let head: HTMLElement
  let count: HTMLElement
  let xy: HTMLElement
  let bin: HTMLElement
  const mapDies: SVGRectElement[] = []
  let mapProbe: SVGGElement
  const cards: { root: HTMLElement; parts: HTMLElement[]; h: number }[] = []
  let shown = -2
  let stackH = -1
  let deferShow = 0
  let binOn = -1
  /** measured layout (px) — read only on resize / card-size changes */
  const lay = { safeTop: 0, panelBottom: 0, maxPanel: 0, h: 0, w: 0 }

  const trk: Track = { from: -1, to: -1, raw: 0, t: 0, lift: 0, probeY: 0, dwell: 0 }
  const pa = mkPose()
  const pb = mkPose()
  const cA = new THREE.Vector2()
  const cB = new THREE.Vector2()
  const tmp = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const buf = new THREE.Vector2()
  const lens: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30, roll: 0, parallax: 0 }

  /* ------------------------------------------------------------ poses */

  function poseFor(k: number, f: Frame, dwell: number, out: Pose): Pose {
    const pk = portraitK(f)
    const w = f.width
    const H = f.height
    const aspect = w / Math.max(1, H)
    if (k < 0 || k >= N) {
      // the whole wafer: intro (right of / below the headline) and out (centred)
      const isOut = k >= N
      out.tgt.set(0, 0, 0)
      // portrait looks down more steeply: a rounder wafer fills the tall frame
      out.el = THREE.MathUtils.degToRad(lerp(isOut ? 36 : 30, isOut ? 40 : 42, pk))
      out.az = THREE.MathUtils.degToRad(isOut ? 12 : -16)
      const lFov = 30
      const pFov = 38
      out.fov = lerp(lFov, pFov, pk)
      // fit the wafer's width: landscape ~78 % of the height-limited frame, portrait the width
      const tanV = Math.tan(THREE.MathUtils.degToRad(out.fov / 2))
      const landD = (R * 2.35) / (2 * tanV) / Math.min(1.6, aspect) + 6
      const portD = (R * 2.08) / (2 * tanV * aspect)
      out.ld = Math.log(lerp(isOut ? landD * 1.22 : landD, isOut ? portD * 1.12 : portD, pk))
      out.nx = isOut ? 0 : lerp(clamp(remap(aspect, 1.2, 1.8, 0.1, 0.22)), 0, pk)
      out.ny = isOut ? 0.02 : lerp(-0.12, -0.08, pk)
      return out
    }
    out.tgt.set(0, TOP, 0)
    out.az = THREE.MathUtils.degToRad(AZ[k] * lerp(1, 0.6, pk))
    out.el = THREE.MathUtils.degToRad(lerp(33, 40, pk) + EL[k])
    // landscape: the die sits centred in the free area right of the panel
    const gutter = clamp(0.034 * w, 16, 48)
    const panelRight = gutter + Math.min(500, 0.4 * w)
    const freeC = (panelRight + w) / 2
    const lnx = clamp((freeC / w) * 2 - 1, 0.1, 0.45)
    const lFov = 30
    // the die spans ~46 % of the free area's width, whatever the aspect
    const tanL = Math.tan(THREE.MathUtils.degToRad(lFov / 2))
    const dieW = 0.46 * Math.max(200, w - panelRight)
    const lD = clamp((D * w) / (2 * tanL * aspect * dieW), 4.2, 7)
    // portrait: the die framed in the window between the chrome and the tallest panel
    const pFov = 36
    const tanP = Math.tan(THREE.MathUtils.degToRad(pFov / 2))
    const measured = lay.h > 0 && Math.abs(lay.h - H) < 2 && Math.abs(lay.w - w) < 2
    const top = measured ? lay.safeTop : clamp(0.105 * H, 80, 112)
    const bot = (measured ? lay.panelBottom - lay.maxPanel : H * 0.5) - 10
    const regionH = Math.max(120, bot - top)
    const cy = (top + bot) / 2
    const pny = 1 - (2 * cy) / H
    // the die (with a margin of its neighbours) spans ~70 % of the window's height,
    // and never more than ~62 % of the screen's width
    const byH = (1.5 * H) / (2 * regionH) / tanP
    const byW = (1.17 * 1.4) / (2 * tanP * aspect)
    const pD = clamp(Math.max(byH, byW), 4.6, 12)
    out.fov = lerp(lFov, pFov, pk)
    out.ld = Math.log(lerp(lD, pD, pk) * DK[k] * (1 - 0.055 * dwell))
    out.nx = lerp(lnx, 0, pk)
    out.ny = lerp(0.07, pny, pk)
    return out
  }

  /** write a blended pose (+ arc) to position/target */
  function applyPose(a: Pose, b: Pose, t: number, arc: number, f: Frame, out: CameraPose) {
    const aspect = f.width / Math.max(1, f.height)
    const el = lerp(a.el, b.el, t) + arc * THREE.MathUtils.degToRad(4)
    const az = lerp(a.az, b.az, t)
    const d = Math.exp(lerp(a.ld, b.ld, t)) * (1 + arc * 0.14)
    const fov = lerp(a.fov, b.fov, t)
    out.target.lerpVectors(a.tgt, b.tgt, t)
    out.position
      .set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
      .multiplyScalar(d)
      .add(out.target)
    // slide target + camera parallel to the image plane so the target lands at (nx, ny)
    const nx = lerp(a.nx, b.nx, t)
    const ny = lerp(a.ny, b.ny, t)
    fwd.subVectors(out.target, out.position).normalize()
    right.crossVectors(fwd, tmp.set(0, 1, 0)).normalize()
    up.crossVectors(right, fwd).normalize()
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const halfW = halfH * aspect
    tmp
      .copy(right)
      .multiplyScalar(-nx * halfW)
      .addScaledVector(up, -ny * halfH)
    out.position.add(tmp)
    out.target.add(tmp)
    out.fov = fov
  }

  /* -------------------------------------------------------------- DOM */

  function buildMap(parent: HTMLElement) {
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'vw-map')
    svg.setAttribute('viewBox', '-50 -50 100 100')
    svg.setAttribute('aria-hidden', 'true')
    const k = 48 / R
    const circle = document.createElementNS(NS, 'path')
    // the wafer outline with its notch (bottom = toward the camera)
    const nh = 0.012
    const a0 = Math.PI / 2 + nh
    const a1 = Math.PI / 2 - nh + Math.PI * 2
    const pts: string[] = []
    for (let i = 0; i <= 96; i++) {
      const a = a0 + ((a1 - a0) * i) / 96
      pts.push(`${(Math.cos(a) * 48).toFixed(2)},${(Math.sin(a) * 48).toFixed(2)}`)
    }
    circle.setAttribute('d', `M${pts.join('L')}L0,${(48 - 0.16 * k * 1.6).toFixed(2)}Z`)
    circle.setAttribute('class', 'vw-map-wafer')
    svg.appendChild(circle)
    let d = ''
    const s = D * k
    for (let ix = -12; ix <= 12; ix++)
      for (let iz = -12; iz <= 12; iz++) {
        if (!dieInside(ix, iz)) continue
        if (DIES.some(([x, z]) => x === ix && z === iz)) continue
        d += `M${(ix * P * k - s / 2).toFixed(2)} ${(iz * P * k - s / 2).toFixed(2)}h${s.toFixed(2)}v${s.toFixed(2)}h${(-s).toFixed(2)}z`
      }
    const grid = document.createElementNS(NS, 'path')
    grid.setAttribute('d', d)
    grid.setAttribute('class', 'vw-map-grid')
    svg.appendChild(grid)
    DIES.forEach(([ix, iz]) => {
      const r = document.createElementNS(NS, 'rect')
      r.setAttribute('x', (ix * P * k - s / 2).toFixed(2))
      r.setAttribute('y', (iz * P * k - s / 2).toFixed(2))
      r.setAttribute('width', s.toFixed(2))
      r.setAttribute('height', s.toFixed(2))
      svg.appendChild(r)
      mapDies.push(r)
    })
    // the probe crosshair (moves to the active die)
    mapProbe = document.createElementNS(NS, 'g')
    mapProbe.setAttribute('class', 'vw-map-probe')
    for (const [x1, y1, x2, y2] of [
      [-9, 0, -4, 0],
      [4, 0, 9, 0],
      [0, -9, 0, -4],
      [0, 4, 0, 9],
    ]) {
      const l = document.createElementNS(NS, 'line')
      l.setAttribute('x1', String(x1))
      l.setAttribute('y1', String(y1))
      l.setAttribute('x2', String(x2))
      l.setAttribute('y2', String(y2))
      mapProbe.appendChild(l)
    }
    svg.appendChild(mapProbe)
    parent.appendChild(svg)
  }

  function buildDom(stage: HTMLElement) {
    intro = el('div', 'vw-intro', undefined, stage)
    el('p', 'hud-eyebrow vw-eyebrow', SECTIONS.voices.eyebrow, intro)
    const m = SECTIONS.voices.title.match(/^(.*?\.)\s+(.*)$/)
    const html = m ? `${m[1]} <em>${m[2]}</em>` : SECTIONS.voices.title
    introTitle = rise(el('h2', 'hud-h2 vw-title', undefined, intro), html)

    panel = el('figure', 'vw-panel hud-panel', undefined, stage)
    head = el('div', 'vw-head', undefined, panel)
    buildMap(head)
    const meta = el('div', 'vw-meta', undefined, head)
    count = el('p', 'vw-count', '', meta)
    xy = el('p', 'vw-xy', '', meta)
    bin = el('p', 'vw-bin', '', meta)
    stack = el('div', 'vw-stack', undefined, panel)
    CLIENTS.forEach(t => {
      const root = el('div', 'vw-card', undefined, stack)
      if (t.quote.length > 170) root.classList.add('vw-card--long')
      const q = rise(el('blockquote', 'hud-quote vw-quote', undefined, root), `“${t.quote}”`)
      const who = el('p', 'vw-who', undefined, root)
      const name = rise(el('span', 'hud-label vw-name', undefined, who), t.name)
      const co = rise(el('span', 'hud-label vw-co', undefined, who), t.company)
      cards.push({ root, parts: [q, name, co], h: 0 })
    })
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) {
          const c = cards.find(k => k.root === e.target)
          if (c) c.h = (e.target as HTMLElement).offsetHeight
        }
        applyStackHeight()
        measure()
      })
      cards.forEach(c => ro.observe(c.root))
      ro.observe(head)
    }
    window.addEventListener('resize', measure)
    measure()
  }

  function measure() {
    if (!panel) return
    const cs = getComputedStyle(panel)
    const gap = parseFloat(cs.rowGap) || 0
    const chrome = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + gap + head.offsetHeight
    let tallest = 0
    for (const c of cards) tallest = Math.max(tallest, c.h || c.root.offsetHeight)
    lay.safeTop = intro.offsetTop
    lay.panelBottom = panel.offsetTop + panel.offsetHeight
    lay.maxPanel = chrome + tallest
    lay.h = window.innerHeight
    lay.w = window.innerWidth
  }

  /** glide the stack to the shown card's height (snap when the panel is appearing) */
  function applyStackHeight(snap = false) {
    if (shown < 0 || shown >= N) return
    const c = cards[shown]
    const h = c.h || (c.h = c.root.offsetHeight)
    if (h && h !== stackH) {
      stackH = h
      if (snap) stack.style.transition = 'none'
      stack.style.height = `${h}px`
      if (snap) {
        void stack.offsetHeight
        stack.style.transition = ''
      }
    }
  }

  function setCard(i: number, on: boolean) {
    const c = cards[i]
    if (!c) return
    c.root.classList.toggle('is-on', on)
    for (const p of c.parts) setRise(p, on)
  }

  function sinkAll() {
    for (let i = 0; i < N; i++) setCard(i, false)
    setRise(introTitle, false)
    intro.classList.remove('is-on')
    panel.classList.remove('is-on')
    shown = -2
    stackH = -1
    binOn = -1
  }

  function wantAt(local: number) {
    let want = local < B0 ? -1 : local >= B1 ? N : Math.min(N - 1, Math.floor((local - B0) / SPAN))
    if (shown >= -1 && want !== shown && Math.abs(want - shown) === 1) {
      const hi = Math.max(want, shown)
      const boundary = hi >= N ? B1 : bOf(hi)
      if (Math.abs(local - boundary) < HYST) want = shown
    }
    return want
  }

  const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±')
  const pad2 = (v: number) => String(Math.abs(v)).padStart(2, '0')

  function show(next: number) {
    if (next === shown) return
    const wasCard = shown >= 0 && shown < N
    if (wasCard) setCard(shown, false)
    shown = next
    const isCard = next >= 0 && next < N
    panel.classList.toggle('is-on', isCard)
    if (isCard) {
      setCard(next, true)
      count.innerHTML = `Die <b>${pad2(next + 1)}</b> / ${pad2(N)}`
      const [ix, iz] = DIES[next]
      xy.textContent = `X${sgn(ix)}${pad2(ix)} · Y${sgn(-iz)}${pad2(-iz)}`
      mapDies.forEach((r, i) => r.setAttribute('class', i === next ? 'is-on' : i < next ? 'is-past' : 'is-next'))
      const k = 48 / R
      mapProbe.setAttribute('transform', `translate(${(ix * P * k).toFixed(2)} ${(iz * P * k).toFixed(2)})`)
      applyStackHeight(!wasCard)
    }
  }

  /* ----------------------------------------------------------- chapter */

  return {
    id: 'voices',
    group,
    // keyboard stops land on each voice once the die is powered, its seal ring
    // traced and the quote settled (die 1 rests only briefly after the dive)
    anchors: CLIENTS.map((_, i) => (i === 0 ? arriveOf(0) + 0.016 : bOf(i) + SPAN * 0.62)),

    async init(ctx: ChapterContext) {
      buildDom(ctx.stage)
      await nextFrame()
      const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
      wafer = await buildWafer({ mobile: ctx.mobile, anisotropy: aniso })
      group.add(wafer.stage)
      await nextFrame()
      probe = buildProbe()
      group.add(probe)
      ready = true
    },

    onEnter() {
      sinkAll()
      deferShow = 1
    },

    onLeave() {
      sinkAll()
    },

    update(local, frame, ctx) {
      if (!ready) return
      const rm = frame.reducedMotion
      const tIdle = frame.time * (rm ? 0.2 : 1)
      const tr = trackAt(local, trk)
      const pk = portraitK(frame)

      /* ---- the stage: slide the wafer so the active die sits under the probe ---- */
      const wideA = tr.from < 0 || tr.from >= N
      const wideB = tr.to < 0 || tr.to >= N
      if (wideA) cA.set(0, 0)
      else dieCentre(tr.from, cA)
      if (wideB) cB.set(0, 0)
      else dieCentre(tr.to, cB)
      const px = lerp(cA.x, cB.x, tr.t)
      const pz = lerp(cA.y, cB.y, tr.t)
      // rotation: the wide shots turn slowly in the light; steps swing a little
      const introTurn = -0.55 + local * 3.2 + (rm ? 0 : tIdle * 0.02)
      const outTurn = (local - OUT0) * 7 + (rm ? 0 : tIdle * 0.02)
      let theta = 0
      if (tr.from < 0 && tr.to < 0) theta = introTurn
      else if (tr.from < 0) theta = lerp(introTurn, 0, tr.t)
      else if (tr.to >= N) theta = lerp(0, outTurn, tr.t)
      else if (tr.from !== tr.to) theta = Math.sin(Math.PI * tr.t) * 0.09 * (tr.to % 2 ? 1 : -1)
      const st = wafer.stage
      st.rotation.y = theta
      tmp.set(px, 0, pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, theta)
      st.position.set(-tmp.x, 0, -tmp.z)

      /* ---- the probe ---- */
      probe.position.y = tr.probeY
      probe.visible = tr.probeY < 4.9

      /* ---- power, pass marks, the signal ---- */
      const U = wafer.uniforms
      let lit = -1
      let litP = 0
      for (let k = 0; k < N; k++) {
        const a = arriveOf(k)
        const l = leaveOf(k)
        const on = smoothstep(a - 0.004, a + 0.006, local) * (1 - smoothstep(l, l + 0.004, local))
        U.uPower.value[k] = on
        U.uPass.value[k] = smoothstep(l, l + 0.008, local)
        if (on > litP) {
          litP = on
          lit = k
        }
      }
      const sig = wafer.signal
      sig.group.visible = lit >= 0
      if (lit >= 0) {
        dieCentre(lit, cA)
        sig.group.position.set(cA.x, TOP + 0.0008, cA.y)
        // the pulse races once round the seal ring as the needles land
        const reach = remap(local, arriveOf(lit) - 0.004, arriveOf(lit) + 0.014, 0, wafer.signalLen + 0.5)
        sig.set({
          time: tIdle,
          flow: rm ? 0.12 : 0.9,
          density: 5,
          glow: litP * (rm ? 0.7 : 1),
          reach,
          offset: local * 6,
          color: S.signal,
        })
      }

      /* ---- the lens: depth of field around the probe point, rack focus on arrival ---- */
      const moving = tr.from >= 0 && tr.to < N && tr.from !== tr.to ? Math.sin(Math.PI * clamp(tr.raw)) : 0
      const macro = macroOf(tr)
      cameraAt(local, frame, lens)
      ctx.renderer.getDrawingBufferSize(buf)
      // focus sits on the probe point; mid-step it drifts long, then racks back in on arrival
      U.uFocusD.value = lens.position.distanceTo(lens.target) * (1 + 0.1 * moving)
      U.uFocusTol.value = 0.055
      U.uAper.value = macro * macro * 0.05 * buf.y * lerp(1, 0.8, pk)
      U.uDiff.value = lerp(0.62, 0.48, macro)

      /* ---- light ---- */
      const w = ctx.world.params
      w.top = '#0b0d12'
      w.bottom = '#030406'
      w.a = S.signal
      w.b = '#6a5cff'
      w.bokeh = lerp(0.62, 0.45, macro)
      w.focus.set(lerp(0.35, 0.2, pk), 0.25)
      // a studio sweep across the metal each time a die arrives
      const sweep = tr.from !== tr.to ? Math.sin(Math.PI * clamp(tr.raw)) : 0
      w.envTurn = 1.1 + (rm ? 0 : 0.6 * sweep) + (wideA && wideB ? local * 1.5 : 0)
      w.env = 1.15
      w.key = 0.9
      w.keyDir.set(-0.3, 0.9, -0.3)
      w.fill = 0.32

      const post = ctx.post.params
      post.bloomStrength = 0.62
      post.bloomRadius = 0.5
      post.vignette = 0.38

      /* ---- DOM ---- */
      if (deferShow > 0) {
        deferShow--
        return
      }
      show(wantAt(local))
      setRise(introTitle, shown === -1 && local > 0.012)
      intro.classList.toggle('is-on', shown === -1)
      if (shown >= 0 && shown < N) {
        const on = U.uPower.value[shown] > 0.5 ? 1 : 0
        if (on !== binOn) {
          binOn = on
          bin.textContent = on ? 'Probe · Bin 1 pass' : 'Stepping…'
          bin.classList.toggle('is-on', on === 1)
        }
      }
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      cameraAt(local, frame, out)
    },
  }

  function cameraAt(local: number, frame: Frame, out: CameraPose) {
    const tr = trackAt(local, trk)
    poseFor(tr.from, frame, tr.from === tr.to ? tr.dwell : 1, pa)
    poseFor(tr.to, frame, 0, pb)
    const between = tr.from >= 0 && tr.to < N && tr.from !== tr.to
    const arc = between ? Math.sin(Math.PI * clamp(tr.raw)) : 0
    applyPose(pa, pb, tr.from === tr.to ? 0 : tr.t, arc, frame, out)
    if (!frame.reducedMotion) {
      // a lens breath
      const t = frame.time
      out.position.y += Math.sin(t * 0.37) * 0.012 * Math.exp(lerp(pa.ld, pb.ld, tr.t)) * 0.2
      out.position.x += Math.sin(t * 0.23 + 1.3) * 0.008 * Math.exp(lerp(pa.ld, pb.ld, tr.t)) * 0.2
    }
    out.roll = 0
    out.parallax = frame.reducedMotion ? 0 : lerp(1.0, 0.1, macroOf(tr))
  }
}
