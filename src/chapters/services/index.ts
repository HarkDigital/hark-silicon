import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, damp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { S } from '../../kit/silicon'
import { BLOCKS, DIE } from './die'
import { buildDie, DT, WALL_TOP, type DieScene } from './scene'
import { Hud, type HudMetrics } from './hud'
import './services.css'

/*
 * SERVICES — "Die". Inside the Hark chip.
 *
 *   0.00–0.044  the etched lid is picked straight up and carried away (under
 *               the SEM cut: a strong silhouette in monochrome); the camera
 *               drops into the cavity — the die is still an electron-
 *               microscope image (post.sem) and develops into colour
 *   0.036–0.134 the headline beat (≥ 0.35 vh, settled at the heading stop
 *               0.06 and the nav landing 0.08): the whole die, eleven
 *               blocks, gold bond wires to the leadframe; "Eleven ways to be
 *               heard." The rig drifts slowly in (scroll-driven orbit), a
 *               signal enters from a bond pad and races to block 01, and the
 *               camera dives to it (0.113–0.15) as the headline hands over
 *               to the panel
 *   0.134–0.92  eleven blocks (~0.0715 each): the camera flies low over the
 *               die from block to block (a macro slider, serpentine: back
 *               row →, middle ←, front →), racks focus ahead of each move,
 *               the studio sweeps a highlight across the iridescent silicon;
 *               the block in view lights (outline, corner brackets, label,
 *               a faint powered wash) and its link lights toward it;
 *               visited blocks stay faintly powered
 *   0.92–1.00   pull up to the whole die; every block and link powers up in
 *               order as the SEM cut begins
 *
 * Everything derives from `local`; frame.time only drives signal pulses,
 * a slow breathing of the lit block and a hair of rig hover. Block light is
 * damped in time (snaps on teleports) so a fast scrub can't strobe.
 */

const N = BLOCKS.length
/** the blocks start where the headline hands over */
const A = 0.134
const B = 0.92
const SPAN = (B - A) / N
/** half-width (in slots) of each move, centred on the boundary between two blocks */
const TRAVEL = 0.27
const ANCHORS = Array.from({ length: N }, (_, i) => A + SPAN * (i + 0.55))
/** the headline beat: 0.098 local = 0.37 vh at length 3.8 (the cut clears by ~0.045) */
const INTRO_IN = 0.036
const INTRO_OUT = A
const CARD_OUT = 0.925
/** lid → overview, overview hold (the headline), dive to block 01 */
const LID1 = 0.044
const DIVE0 = 0.113
const DIVE1 = 0.15
/** the signal from the bond pad to block 01 */
const SIG0 = 0.06
const SIG1 = 0.124
/** pull-up to the whole die */
const OUT0 = 0.912
const OUT1 = 0.985
/** a visited block keeps this much light */
const RES = 0.16

const LID = -3
const OVER = -2
const OUT = N

/** smootherstep: a precise start and a settled finish */
const glide = (t: number) => {
  const x = clamp(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
const remap = (v: number, a: number, b: number) => clamp((v - a) / (b - a))

interface Pose {
  pos: THREE.Vector3
  target: THREE.Vector3
  fov: number
}
const mkPose = (): Pose => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 32 })

interface Region {
  cx: number
  cy: number
  hw: number
  hh: number
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let die: DieScene
  let hud: Hud
  let canvas: HTMLCanvasElement | null = null
  let camRef: THREE.PerspectiveCamera | null = null
  let active = false
  let mobile = false
  let lastLocal = -1
  let snap = true
  /** how far the overview has drifted in (0 at the lid, 1 as the dive starts) */
  let hold = 1

  const litS = new Float32Array(N)
  const probe = new THREE.PerspectiveCamera()
  const pv = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const tmpDir = new THREE.Vector3()
  const fitDir = new THREE.Vector3()
  const tmpRight = new THREE.Vector3()
  const tmpUp = new THREE.Vector3()
  const poseA = mkPose()
  const poseB = mkPose()
  const pose = mkPose()
  const focusPt = new THREE.Vector3()
  const cA = new THREE.Vector3()
  const cB = new THREE.Vector3()
  const etched = new THREE.Color('#b9b09a')
  const glow = new THREE.Color(S.signal).multiplyScalar(1.1)

  // subjects to frame
  const lidPts = [-7.2, 7.2].flatMap(x => [-7.2, 7.2].map(z => new THREE.Vector3(x, WALL_TOP + 0.45, z)))
  const lidCenter = new THREE.Vector3(0, WALL_TOP + 0.45, 0)
  const overPts = [-6.7, 6.7].flatMap(x => [-6.7, 6.7].map(z => new THREE.Vector3(x, DT, z)))
  const outPts = [-6.3, 6.3].flatMap(x => [-6.3, 6.3].map(z => new THREE.Vector3(x, DT, z)))
  const dieCenter = new THREE.Vector3(0, DT, 0)
  let blockPts: THREE.Vector3[][] = []

  function aim(center: THREE.Vector3, dir: THREE.Vector3, d: number, ax: number, ay: number, tv: number, th: number, out: Pose) {
    out.pos.copy(center).addScaledVector(dir, -d)
    tmpRight.crossVectors(dir, up).normalize()
    tmpUp.crossVectors(tmpRight, dir)
    out.target.copy(center).addScaledVector(tmpRight, -ax * th * d).addScaledVector(tmpUp, -ay * tv * d)
  }

  /** frame `pts` (around `center`) into `r` (NDC) from elevation/yaw */
  function fit(out: Pose, pts: THREE.Vector3[], center: THREE.Vector3, elev: number, yaw: number, fov: number, aspect: number, r: Region) {
    const tv = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const th = tv * aspect
    const dir = fitDir.set(-Math.sin(yaw) * Math.cos(elev), -Math.sin(elev), -Math.cos(yaw) * Math.cos(elev)).normalize()
    let ext = 0
    for (const p of pts) ext = Math.max(ext, p.distanceTo(center))
    let d = Math.max(1, ext / Math.max(0.1, Math.min(r.hw * th, r.hh * tv)))
    let ax = r.cx
    let ay = r.cy
    probe.fov = fov
    probe.aspect = aspect
    probe.near = 0.05
    probe.far = 500
    probe.updateProjectionMatrix()
    for (let it = 0; it < 4; it++) {
      aim(center, dir, d, ax, ay, tv, th, out)
      probe.position.copy(out.pos)
      probe.up.set(0, 1, 0)
      probe.lookAt(out.target)
      probe.updateMatrixWorld()
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of pts) {
        pv.copy(p).project(probe)
        minX = Math.min(minX, pv.x)
        maxX = Math.max(maxX, pv.x)
        minY = Math.min(minY, pv.y)
        maxY = Math.max(maxY, pv.y)
      }
      if (!Number.isFinite(minX + maxX + minY + maxY)) break
      const k = Math.max((maxX - minX) / (2 * r.hw), (maxY - minY) / (2 * r.hh))
      ax -= (minX + maxX) / 2 - r.cx
      ay -= (minY + maxY) / 2 - r.cy
      d *= clamp(k, 0.5, 2)
    }
    aim(center, dir, d, ax, ay, tv, th, out)
    out.fov = fov
  }

  /** the NDC region of a pixel box (written into one scratch Region: each fit consumes it before the next call) */
  const rScratch: Region = { cx: 0, cy: 0, hw: 1, hh: 1 }
  const rLid: Region = { cx: 0, cy: 0, hw: 1.05, hh: 1.05 }
  function region(x0: number, x1: number, y0: number, y1: number, W: number, H: number, fill: number): Region {
    const w = Math.max(40, x1 - x0)
    const h = Math.max(40, y1 - y0)
    rScratch.cx = (x0 + x0 + w) / W - 1
    rScratch.cy = 1 - (y0 + y0 + h) / H
    rScratch.hw = (w / W) * fill
    rScratch.hh = (h / H) * fill
    return rScratch
  }

  /** the rest pose for a tour key (LID, OVER, block 0..10, OUT) */
  function restPose(key: number, out: Pose, frame: Frame, m: HudMetrics) {
    const W = Math.max(1, frame.width || 1440)
    const H = Math.max(1, frame.height || 900)
    const aspect = W / H
    const portrait = H > W
    const gutter = m.valid ? m.gutter : 24
    const safeTop = m.valid ? m.safeTop : H * 0.11
    const safeBottom = m.valid ? m.safeBottom : H * 0.11
    const fov = portrait ? 40 : 32
    if (key === LID) {
      fit(out, lidPts, lidCenter, 1.2, 0, fov, aspect, rLid)
      return
    }
    if (key === OVER) {
      const r = portrait
        ? region(gutter, W - gutter, safeTop + 4, (m.valid ? m.introTop : H * 0.6) - 16, W, H, 0.96)
        : region((m.valid ? Math.min(m.introRight, W * 0.5) : W * 0.42) + 32, W - gutter, safeTop + 8, H - safeBottom - 8, W, H, 0.96)
      // the headline hold drifts: a slow scroll-driven orbit in (hold 0 → 1)
      const h = hold
      fit(out, overPts, dieCenter, (portrait ? 1.0 : 0.98) + 0.05 * (1 - h), -0.1 - 0.12 * (1 - h), fov, aspect, r)
      out.pos.lerp(out.target, -0.045 * (1 - h))
      return
    }
    if (key === OUT) {
      const r = region(gutter, W - gutter, safeTop + 6, H - safeBottom - 6, W, H, 0.92)
      fit(out, outPts, dieCenter, 1.12, 0.12, fov, aspect, r)
      return
    }
    const b = BLOCKS[key]
    const r = portrait
      ? region(gutter, W - gutter, safeTop + 6, (m.valid ? m.cardTop : H * 0.55) - 14, W, H, 0.98)
      : region((m.valid ? m.colRight : W * 0.36) + 36, W - gutter * 1.1, safeTop + 10, H - safeBottom - 10, W, H, 0.94)
    const yaw = (b.x + b.w / 2 - 0.5) * 0.6
    fit(out, blockPts[key], die.centers[key], portrait ? 0.74 : 0.6, yaw, fov, aspect, r)
  }

  function centerOf(key: number, out: THREE.Vector3) {
    if (key === LID) return out.copy(lidCenter)
    if (key === OVER || key === OUT) return out.copy(dieCenter)
    return out.copy(die.centers[key])
  }

  /** where the tour is: moving from → to with eased progress s (s = 1: at rest on `to`); written into T */
  const T = { from: LID, to: OVER, s: 0, raw: 0 }
  function setT(from: number, to: number, raw: number, eased = true) {
    T.from = from
    T.to = to
    T.raw = raw
    T.s = eased ? glide(raw) : raw
  }
  function tour(local: number) {
    if (local < LID1) return setT(LID, OVER, remap(local, 0.006, LID1))
    if (local < DIVE0) return setT(OVER, OVER, 1, false)
    if (local < DIVE1 && local < A + SPAN * (1 - TRAVEL)) return setT(OVER, 0, remap(local, DIVE0, DIVE1))
    if (local >= OUT0) return setT(N - 1, OUT, remap(local, OUT0, OUT1))
    const u = (local - A) / SPAN
    for (let j = 1; j < N; j++) {
      if (Math.abs(u - j) < TRAVEL) return setT(j - 1, j, (u - (j - TRAVEL)) / (2 * TRAVEL))
    }
    const k = Math.max(0, Math.min(N - 1, Math.floor(u + TRAVEL)))
    setT(k, k, 1, false)
  }

  /** how much light block k should carry at `local` (before time damping) */
  function litTarget(k: number, local: number): number {
    if (local < DIVE0) return 0
    if (local >= OUT0) return Math.max(k === N - 1 ? 1 : RES, smoothstep(OUT0 + 0.005 * k, OUT0 + 0.005 * k + 0.018, local))
    if (T.to === 0 && T.from === OVER) return k === 0 ? smoothstep(0.45, 1, T.s) : 0
    if (T.from === T.to) return k === T.to ? 1 : k < T.to ? RES : 0
    if (k === T.from) return lerp(1, RES, smoothstep(0, 0.55, T.s))
    if (k === T.to) return smoothstep(0.45, 1, T.s)
    return k < T.from ? RES : 0
  }

  return {
    id: 'services',
    group,
    anchors: ANCHORS,

    async init(ctx: ChapterContext) {
      mobile = ctx.mobile
      // the die labels are drawn in Martian Mono: make sure it's there first
      try {
        await Promise.race([
          Promise.all([document.fonts.load("600 84px 'Martian Mono Variable'"), document.fonts.load("500 34px 'Martian Mono Variable'")]),
          new Promise(r => setTimeout(r, 1500)),
        ])
      } catch {
        /* fonts API unavailable: the labels repaint when fonts arrive */
      }
      die = await buildDie(ctx.renderer, ctx.mobile)
      group.add(die.root)
      blockPts = die.corners.map((cs, k) => {
        const c = die.centers[k]
        return cs.map(p => p.clone().sub(c).multiplyScalar(1.08).add(c))
      })
      await nextFrame()
      hud = new Hud(ctx.stage, k => window.__hark?.land('services', true, ANCHORS[k]))

      // click a block on the die to land on it (click, not pointerdown: touch scrolls must not jump)
      canvas = ctx.renderer.domElement
      camRef = ctx.camera
      canvas.addEventListener('click', e => {
        if (!active || !canvas || lastLocal < A - 0.02 || lastLocal > CARD_OUT) return
        const r = canvas.getBoundingClientRect()
        const k = pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
        if (k >= 0) window.__hark?.land('services', true, ANCHORS[k])
      })
    },

    onEnter() {
      active = true
      snap = true
    },
    onLeave() {
      active = false
      if (canvas) canvas.style.cursor = ''
    },

    update(local, frame, ctx) {
      if (!die || !hud) return
      const rm = frame.reducedMotion
      const t = frame.time
      const dt = frame.dt
      if (Math.abs(local - lastLocal) > 0.04) snap = true
      lastLocal = local
      const m = hud.metrics()

      // ---------- camera: rest poses of the two tour keys, blended
      hold = glide(remap(local, 0.02, DIVE0))
      tour(local)
      restPose(T.from, poseA, frame, m)
      if (T.to !== T.from) restPose(T.to, poseB, frame, m)
      else {
        poseB.pos.copy(poseA.pos)
        poseB.target.copy(poseA.target)
        poseB.fov = poseA.fov
      }
      const e = T.s
      pose.pos.lerpVectors(poseA.pos, poseB.pos, e)
      pose.target.lerpVectors(poseA.target, poseB.target, e)
      pose.fov = lerp(poseA.fov, poseB.fov, e)
      if (T.from !== T.to && T.from >= 0 && T.to >= 0 && T.to < N) {
        // a macro slider move: lift a touch mid-travel so the rig clears the die
        const lift = 0.12 * poseA.pos.distanceTo(poseB.pos) + 0.15
        pose.pos.y += lift * Math.sin(Math.PI * e)
      }
      // outro: keep rising into the cut
      if (local > OUT1) pose.pos.lerp(pose.target, -(local - OUT1) * 2.2)
      if (!rm) {
        pose.pos.x += Math.sin(t * 0.21) * 0.018
        pose.pos.y += Math.sin(t * 0.17 + 1.3) * 0.012
      }

      // ---------- the lid: a straight pick, then carried away (pick-and-place)
      const lift = glide(remap(local, 0.004, 0.022))
      const away = remap(local, 0.016, 0.046)
      const aw = away * away * (3 - 2 * away)
      die.lid.position.set(0, WALL_TOP + 2.4 * lift - 0.06 * Math.sin(Math.PI * remap(local, 0.018, 0.024)) + 6 * aw, -30 * aw * aw)
      die.lid.rotation.x = -0.28 * aw
      die.lid.visible = away < 1

      // ---------- focus: racks to the next subject slightly ahead of the camera
      centerOf(T.from, cA)
      centerOf(T.to, cB)
      focusPt.lerpVectors(cA, cB, smoothstep(0.08, 0.6, T.raw))
      if (local < LID1) {
        // on the lid until it lifts, then down onto the die
        const lidY = die.lid.position.y + 0.45
        focusPt.set(0, lerp(lidY, DT, smoothstep(0.012, 0.034, local)), 0)
      }
      tmpDir.subVectors(pose.target, pose.pos).normalize()
      const focus = Math.max(0.5, tmpDir.dot(pv.subVectors(focusPt, pose.pos)))
      const tourAp = mobile ? 0.55 : 0.7
      const ap = local < DIVE0 ? lerp(0.9, 0.3, smoothstep(0.03, LID1, local)) : local > OUT0 ? lerp(tourAp, 0.25, T.s) : local < DIVE1 ? lerp(0.3, tourAp, T.s) : tourAp
      die.dieU.uFocus.value = focus
      die.dieU.uAperture.value = ap

      // ---------- block light
      const breath = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 0.5)
      for (let k = 0; k < N; k++) {
        const target = litTarget(k, local)
        litS[k] = snap ? target : damp(litS[k], target, 7, dt)
        die.dieU.uLit.value[k] = litS[k]
        const L = die.labels[k]
        L.u.uColor.value.copy(etched).lerp(glow, litS[k])
        const depth = tmpDir.dot(pv.subVectors(L.center, pose.pos))
        const def = clamp((Math.abs(depth - focus) / focus - 0.12) * ap)
        L.u.uBias.value = def * 4
        L.u.uOpacity.value = lerp(0.72, 1, litS[k]) * (1 - 0.35 * def)
      }
      die.dieU.uBreath.value = breath
      die.dieU.uTime.value = rm ? 0 : t
      die.dieU.uLine.value = lerp(0.05, 0.1, smoothstep(0.03, 0.05, local) * (1 - smoothstep(DIVE0, DIVE1, local)))

      // ---------- the bus: links light toward the block in view
      const bus = die.bus
      const bu = bus.u
      const flow = rm ? 0.12 : 1.1
      bu.uTime.value = t
      bu.uFlow.value = flow
      for (let k = 0; k < N; k++) {
        const len = bus.lengths[die.links[k]]
        let reach = 0
        let glowK = 0
        if (local >= OUT0) {
          reach = 1e3
          glowK = Math.max(litS[k], k < N - 1 ? 0.3 : 1)
        } else if (T.to === k && T.from !== T.to) {
          reach = len * clamp(T.raw / 0.8)
          glowK = 1
        } else if (T.to === k && T.from === T.to) {
          reach = 1e3
          glowK = 1
        } else if (local >= DIVE0 && k < (T.to >= 0 && T.to < N ? T.to : 0)) {
          reach = 1e3
          glowK = 0.3
        }
        if (k === 0 && local >= SIG0 && local < DIVE1) {
          reach = len * clamp(remap(local, SIG0, SIG1))
          glowK = 1
        }
        bu.uReach.value[k] = reach
        bu.uLit.value[k] = glowK
      }
      bu.uReach.value[11] = 1e3
      bu.uLit.value[11] = lerp(0.2, 0.7, smoothstep(OUT0, OUT1, local)) * smoothstep(0.03, 0.06, local)
      snap = false

      // ---------- world: a dark macro studio; highlights sweep across the silicon as the rig moves
      const w = ctx.world.params
      const f = T.from >= 0 && T.to >= 0 && T.to < N ? T.from + (T.to - T.from) * T.s : T.to >= N ? N - 1 + T.s : 0
      const sweep = T.from !== T.to && T.from >= 0 && T.to < N ? Math.sin(Math.PI * T.s) : 0
      w.top = '#0a0d15'
      w.bottom = '#030408'
      w.a = S.signal
      w.b = S.gold
      w.bokeh = 0.55
      w.focus.set(0.25, 0.55)
      w.env = 1.15
      w.envTurn = 0.35 + (rm ? 0 : 0.55 * sweep) + f * 0.12 + (local < LID1 ? 0.6 * (1 - T.s) : 0)
      // the die's own studio turns with the rig: the sheen slides across the silicon on every move
      die.dieTop.envMapRotation.y = (rm ? 0 : 0.35 * sweep) + (f - 5) * 0.05
      w.keyDir.set(-0.45, 0.85, 0.5)
      w.key = 2.1
      w.fill = 0.32

      // ---------- post: the microscope — the die is an SEM image until the lid is off
      const post = ctx.post.params
      post.sem = 1 - smoothstep(0.03, 0.058, local)
      post.bloomStrength = 0.42 + 0.1 * smoothstep(OUT0, OUT1, local)
      post.bloomRadius = 0.35
      post.bloomThreshold = 0.95
      post.vignette = 0.42
      post.grain = 0.032

      // ---------- copy
      const introOn = local >= INTRO_IN && local < INTRO_OUT
      const shown = local >= A && local < CARD_OUT ? Math.max(0, Math.min(N - 1, Math.floor((local - A) / SPAN))) : -1
      hud.update(introOn, shown)

      // ---------- hover: a pointer over a block (desktop)
      if (active && !mobile && canvas) {
        const k = local > A - 0.02 && local < CARD_OUT ? pick(frame.pointerRaw.x, frame.pointerRaw.y) : -1
        const cur = k >= 0 ? 'pointer' : ''
        if (canvas.style.cursor !== cur) canvas.style.cursor = cur
      }
    },

    camera(_local, frame, out: CameraPose) {
      out.position.copy(pose.pos)
      out.target.copy(pose.target)
      out.fov = pose.fov
      out.roll = 0
      out.parallax = frame.height > frame.width ? 0.05 : 0.09
    },
  }

  /** the block under a pointer (NDC), or -1 */
  function pick(x: number, y: number): number {
    if (!camRef) return -1
    pv.set(x, y, 0.5).unproject(camRef).sub(camRef.position).normalize()
    if (pv.y > -1e-3) return -1
    const tt = (DT - camRef.position.y) / pv.y
    const hx = camRef.position.x + pv.x * tt
    const hz = camRef.position.z + pv.z * tt
    const u = hx / DIE + 0.5
    const v = hz / DIE + 0.5
    for (let k = 0; k < N; k++) {
      const b = BLOCKS[k]
      if (u >= b.x && u <= b.x + b.w && v >= b.y && v <= b.y + b.h) return k
    }
    return -1
  }
}

