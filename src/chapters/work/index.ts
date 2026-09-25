import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { BRAND, SECTIONS, WORK, workImage, type WorkItem } from '../../content'
import { S } from '../../kit/silicon'
import { loadScreenshot, whenRevealed } from '../../kit/images'
import { DISP, DISP_TOP, LED_PWR, NF, NINE, NR, U1, buildBoard, modX, nineZ, placeNine, type Board } from './board'
import './work.css'

/*
 * BOARD (Selected work) — a motherboard shot as a product macro.
 *
 * Six board-mounted display modules stand on brass standoffs along a black
 * motherboard, fed by a 39-lane bus from the Hark chip (U1). The camera
 * glides low over the board from module to module; as it arrives, a signal
 * burst races down the bus into that module's connector, the status LED
 * lights and the display boots (backlight, a thin scan line, the site).
 * Then the camera pulls back to a column of nine chips silkscreened with the
 * other projects, placed like a pick-and-place machine, beside a pinout table.
 *
 *   0.000–0.160  intro: "Built to be heard." over U1 and the bus, settled
 *                from the end of the cut (~0.045) through the heading stop
 *                (0.06) and the nav landing (0.12) to 0.138 (0.35 vh)
 *   0.160–0.820  six modules (0.110 each): glide 0–30%, burst arrives 26%,
 *                boot 26–42%, datasheet panel 22–99%. Each stop has its own
 *                angle; module 3 is a low grazing pass along the bus, module
 *                5 looks nearly straight down
 *   0.820–0.953  "Nine more, all live." — the nine chips drop in, a burst
 *                fans out to them, the table's rows light them one by one
 *   0.953–1.000  out: a fast push down into the last chip (the SEM cut)
 *
 * Everything derives from `local`; frame.time only drives pulse flow, LED
 * breathing and the bokeh.
 */

const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const isPreview = (url: string) => /harktest\.com/i.test(url)

const F0 = 0.16
const F1 = 0.82
const SPAN = (F1 - F0) / NF
const itemStart = (k: number) => F0 + SPAN * k
/** item-slot shares */
const TRAVEL = 0.3
const TRAVEL0 = 0.18
const ARRIVE = 0.26
const ARRIVE0 = 0.15
const BOOT = 0.035
const SCAN = 0.095
/** the intro's glide toward module 1 starts here */
const I0 = 0.118
/** the intro copy: settled until INTRO_OUT0, gone by INTRO_OUT1 (before module 1's panel) */
const INTRO_OUT0 = 0.138
const INTRO_OUT1 = 0.154
/** module 1's signal burst leaves U1 while the headline is up */
const BURST0 = 0.07
/** the nine */
const PLACE0 = 0.83
const PLACE_STEP = 0.0016
const PLACE_DUR = 0.0075
const BURST9_A = 0.846
const BURST9_B = 0.857
const LIST_IN = 0.846
const ROW0 = 0.859
const ROW1 = 0.948
const OUT = 0.953
const rowAt = (j: number) => ROW0 + ((j + 0.5) * (ROW1 - ROW0)) / NR

const arriveAt = (k: number) => itemStart(k) + (k === 0 ? ARRIVE0 : ARRIVE) * SPAN
const FOV = 30
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)
const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
/**
 * Per-module stop: yaw offset, pitch offset (rad) and distance factor, so the
 * six stops don't repeat one shot. Module 3 (k = 2) is a low grazing pass
 * along the bus into its connector; module 5 (k = 4) is nearly top-down.
 */
const AZ = [0, -0.19, 0.2, 0.16, -0.05, -0.17]
const EL = [0, 0.06, -0.3, -0.06, 0.3, 0.05]
const DK = [1, 1.05, 0.95, 0.96, 1.02, 1.05]
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface Shot {
  C: THREE.Vector3
  yaw: number
  pitch: number
  dist: number
  fov: number
  /** where C sits on screen (NDC) */
  cx: number
  cy: number
}
const shot = (): Shot => ({ C: new THREE.Vector3(), yaw: 0, pitch: 1, dist: 20, fov: FOV, cx: 0, cy: 0 })
function copyShot(o: Shot, s: Shot) {
  o.C.copy(s.C)
  o.yaw = s.yaw
  o.pitch = s.pitch
  o.dist = s.dist
  o.fov = s.fov
  o.cx = s.cx
  o.cy = s.cy
  return o
}

interface Layout {
  key: string
  W: number
  H: number
  portrait: boolean
  safe: Region
  dockR: number
  dockBottom: number
  cardH: number[]
  listR: number
  listH: number
  introB: number
  introR: number
}

interface CardEl {
  root: HTMLElement
  name: HTMLElement
}

const _d = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const _c = new THREE.Color()
const _f = new THREE.Vector3()
const _g = new THREE.Vector3()
const _fp = new THREE.Vector3()

class Work implements Chapter {
  id = 'work'
  group = new THREE.Group()
  anchors = [...FEATURED.map((_, k) => itemStart(k) + SPAN * 0.56), ...REST.map((_, j) => rowAt(j))]

  private ctx!: ChapterContext
  private board!: Board
  private reduced = false
  private mobile = false

  // DOM
  private safe!: HTMLElement
  /** portrait pinout: a dark scrim under the chrome so the chip column's silkscreen never crowds the brand plate */
  private scrim!: HTMLElement
  private scrimV = -1
  private intro!: HTMLElement
  private introTitle!: HTMLElement
  private dock!: HTMLElement
  private cards: CardEl[] = []
  private listDock!: HTMLElement
  private list!: HTMLElement
  private listTitle!: HTMLElement
  private rows: HTMLAnchorElement[] = []
  private hoverRow = -1
  private curRow = -2

  // camera
  private lay: Layout | null = null
  private layDirty = true
  private cur = shot()
  private sa = shot()
  private sb = shot()
  private pos = new THREE.Vector3()
  private tgt = new THREE.Vector3()

  // cached per-frame state
  private ledCol = new THREE.Color()
  /** true between onEnter and onLeave (the engine also runs update() while prewarming) */
  private active = false
  private placed = -1
  /** the depth-of-field veil was shed this visit (html.lowfx) */
  private veilShed = false

  async init(ctx: ChapterContext) {
    this.ctx = ctx
    this.reduced = ctx.reducedMotion
    this.mobile = ctx.mobile
    this.buildDom(ctx.stage)
    // the silkscreen atlas measures text: wait (briefly) for the mono face
    try {
      await Promise.race([
        Promise.all([document.fonts.load("500 72px 'Martian Mono Variable'"), document.fonts.load("600 72px 'Martian Mono Variable'")]),
        new Promise(r => setTimeout(r, 1500)),
      ])
    } catch {
      /* fonts API missing: fallback mono */
    }
    await nextFrame()
    this.board = await buildBoard({
      mobile: this.mobile,
      dof: !this.mobile,
      names: REST.map(w => w.name),
      tagline: BRAND.tagline,
      locale: BRAND.locale,
      yieldFn: nextFrame,
    })
    this.group.add(this.board.root)
    await nextFrame()

    window.addEventListener('resize', () => (this.layDirty = true))
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => (this.layDirty = true))
      for (const c of this.cards) ro.observe(c.root)
      ro.observe(this.list)
      ro.observe(this.intro)
      ro.observe(this.safe)
    }
    document.fonts?.ready.then(() => (this.layDirty = true))

    // screenshots: module 1 now, the rest once the site is revealed
    const load = (k: number) =>
      loadScreenshot(workImage(FEATURED[k].id), { width: 960 })
        .then(tex => {
          tex.anisotropy = 8
          try {
            this.ctx.renderer.initTexture(tex)
          } catch {
            /* uploads on first use instead */
          }
          const m = this.board.modules[k].mat
          const old = m.emissiveMap
          m.emissiveMap = tex
          old?.dispose()
        })
        .catch(err => console.warn(`[work] missing screenshot for ${FEATURED[k].id}`, err))
    load(0)
    whenRevealed().then(async () => {
      for (let k = 1; k < NF; k++) {
        await load(k)
        await nextFrame()
      }
    })
  }

  // ------------------------------------------------------------------ DOM

  private buildDom(stage: HTMLElement) {
    this.safe = el('div', 'wk-safe', undefined, stage)
    this.scrim = el('div', 'wk-scrim', undefined, stage)
    this.scrim.setAttribute('aria-hidden', 'true')

    this.intro = el('div', 'wk-intro', undefined, stage)
    el('p', 'hud-eyebrow', SECTIONS.work.eyebrow, this.intro)
    const title = SECTIONS.work.title
    const cut = title.lastIndexOf(' ')
    this.introTitle = rise(
      el('h2', 'hud-h2 wk-title', undefined, this.intro),
      cut > 0 ? `${esc(title.slice(0, cut))} <em>${esc(title.slice(cut + 1))}</em>` : `<em>${esc(title)}</em>`,
    )
    const spec = el('div', 'wk-spec hud-panel', undefined, this.intro)
    el('span', 'wk-spec-k', 'HK-MB01 · Rev A', spec)
    const counts = el('p', 'wk-spec-v', undefined, spec)
    counts.innerHTML = [`${WORK.length} sites`, `${FEATURED.length} featured`, `${REST.length} more`].map(s => `<span>${esc(s)}</span>`).join('<i aria-hidden="true"></i>')

    this.dock = el('div', 'wk-dock', undefined, stage)
    FEATURED.forEach((w, k) => this.cards.push(this.buildCard(this.dock, w, k)))

    this.listDock = el('div', 'wk-dock wk-dock--list', undefined, stage)
    this.list = el('section', 'wk-card wk-list hud-panel', undefined, this.listDock)
    const head = el('div', 'wk-head', undefined, this.list)
    el('span', 'wk-num', `U${pad(NF + 1)}–U${pad(NF + NR)} · ${pad(WORK.length)} total`, head)
    el('span', 'hud-label wk-pinout', 'Pinout', head)
    const allLive = REST.every(w => !isPreview(w.url))
    const count = WORDS[REST.length] ?? String(REST.length)
    this.listTitle = rise(el('h3', 'hud-h2 wk-list-title', undefined, this.list), allLive ? `${esc(count)} more, <em>all live.</em>` : `${esc(count)} <em>more.</em>`)
    const thead = el('div', 'wk-thead', undefined, this.list)
    thead.innerHTML = '<span>Pin</span><span>Name</span><span class="wk-rind">Industry</span><span aria-hidden="true">↗</span>'
    const ol = el('ol', 'wk-rows', undefined, this.list)
    REST.forEach((w, j) => {
      const li = el('li', '', undefined, ol)
      const a = el('a', 'wk-row', undefined, li)
      a.href = w.url
      a.target = '_blank'
      a.rel = 'noopener'
      const pre = isPreview(w.url)
      a.innerHTML = `<span class="wk-pin">${pad(NF + j + 1)}</span><span class="wk-rname">${esc(w.name)}${
        pre ? ' <small class="wk-pre">Preview</small>' : ''
      }</span><span class="wk-rind">${esc(w.industry)}</span><span class="wk-arrow" aria-hidden="true">↗</span>`
      const on = () => (this.hoverRow = j)
      const off = () => {
        if (this.hoverRow === j) this.hoverRow = -1
      }
      a.addEventListener('pointerenter', on)
      a.addEventListener('pointerleave', off)
      a.addEventListener('focus', on)
      a.addEventListener('blur', off)
      this.rows.push(a)
    })
    const cta = el('div', 'wk-cta', undefined, this.list)
    const hello = el('button', 'hud-btn', 'Say hello', cta)
    hello.type = 'button'
    hello.addEventListener('click', () => window.__hark?.land('contact'))
  }

  private buildCard(parent: HTMLElement, w: WorkItem, k: number): CardEl {
    const root = el('article', 'wk-card hud-panel', undefined, parent)
    const pre = isPreview(w.url)
    const head = el('div', 'wk-head', undefined, root)
    el('span', 'wk-num', `Module ${pad(k + 1)} / ${pad(NF)}`, head)
    const stat = el('span', `wk-stat ${pre ? 'wk-stat--pre' : 'wk-stat--live'}`, undefined, head)
    stat.innerHTML = `<i aria-hidden="true"></i>${pre ? 'Preview' : 'Live'}`
    el('p', 'hud-label wk-ind', w.industry, root)
    const name = rise(el('h3', 'hud-h2 wk-name', undefined, root), esc(w.name))
    el('p', 'hud-body wk-blurb', w.blurb, root)
    const tags = el('ul', 'hud-tags wk-tags', undefined, root)
    for (const t of w.tags) el('li', 'hud-tag', t, tags)
    const cta = el('div', 'wk-cta', undefined, root)
    const a = el('a', 'hud-btn hud-btn--ghost wk-visit', pre ? 'Preview site ↗' : 'Visit site ↗', cta)
    a.href = w.url
    a.target = '_blank'
    a.rel = 'noopener'
    el('span', 'hud-label wk-host', pre ? 'Pre-launch build' : hostOf(w.url), cta)
    const foot = el('div', 'wk-foot', undefined, root)
    foot.setAttribute('aria-hidden', 'true')
    foot.innerHTML = [`DS${k + 1}`, `HK-D${pad(k + 1)}`, '1280 × 800', 'Rev A'].map(s => `<span>${esc(s)}</span>`).join('')
    return { root, name }
  }

  // ------------------------------------------------------------------ layout

  private ensureLayout(f: Frame): Layout {
    const key = `${f.width}x${f.height}`
    if (this.lay && this.lay.key === key && !this.layDirty) return this.lay
    this.layDirty = false
    const W = f.width
    const H = f.height
    const portrait = typeof matchMedia === 'function' ? matchMedia('(max-aspect-ratio: 10/9)').matches : W / H < 1.1
    const s = this.safe.getBoundingClientRect()
    const safe = s.width > 0 ? { x0: s.left, y0: s.top, x1: s.right, y1: s.bottom } : { x0: 24, y0: 90, x1: W - 24, y1: H - 90 }
    const d = this.dock.getBoundingClientRect()
    const ld = this.listDock.getBoundingClientRect()
    const measured = d.width > 0
    this.lay = {
      key,
      W,
      H,
      portrait,
      safe,
      dockR: measured ? d.right : W * 0.36,
      dockBottom: measured ? d.bottom : safe.y1,
      cardH: this.cards.map(c => c.root.offsetHeight || H * 0.4),
      listR: ld.width > 0 ? ld.left + this.list.offsetWidth : W * 0.42,
      listH: this.list.offsetHeight || H * 0.6,
      introB: this.intro.offsetHeight > 0 ? this.intro.offsetTop + this.intro.offsetHeight : H * 0.4,
      introR: this.intro.offsetWidth > 0 ? this.intro.offsetLeft + this.intro.offsetWidth : W * 0.45,
    }
    return this.lay
  }

  private region(kind: 'item' | 'list' | 'intro', k: number): Region {
    const L = this.lay!
    const s = L.safe
    if (kind === 'intro') {
      if (L.portrait) return { x0: 0, x1: L.W, y0: Math.min(L.introB + 10, L.H * 0.62), y1: s.y1 }
      return { x0: L.W * 0.3, x1: L.W, y0: L.H * 0.3, y1: L.H }
    }
    if (L.portrait) {
      const top = kind === 'item' ? L.dockBottom - L.cardH[k] : L.dockBottom - L.listH
      return { x0: 6, x1: L.W - 6, y0: s.y0 + 4, y1: Math.max(s.y0 + 110, top - 10) }
    }
    const right = kind === 'item' ? L.dockR : L.listR
    return { x0: right + L.W * 0.025, x1: s.x1 + L.W * 0.01, y0: s.y0 - L.H * 0.01, y1: s.y1 + L.H * 0.01 }
  }

  /** fit a subject (width w, projected height h) into a screen region: sets dist / cx / cy */
  private fit(o: Shot, w: number, h: number, reg: Region) {
    const L = this.lay!
    const aspect = L.W / Math.max(1, L.H)
    const tanH = Math.tan((o.fov * DEG) / 2)
    const fw = Math.max(0.1, (reg.x1 - reg.x0) / L.W)
    const fh = Math.max(0.1, (reg.y1 - reg.y0) / L.H)
    o.cx = ((reg.x0 + reg.x1) / 2 / L.W) * 2 - 1
    o.cy = 1 - ((reg.y0 + reg.y1) / 2 / L.H) * 2
    o.dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
    return o
  }

  // ------------------------------------------------------------------ shots

  private moduleShot(k: number, drift: number, out: Shot) {
    const L = this.lay!
    const port = L.portrait
    // portrait frames are narrow: a gentler version of each module's angle
    const vary = port ? 0.6 : 1
    out.fov = FOV
    out.yaw = 0.02 + AZ[k] * vary - drift * 0.025
    out.pitch = (port ? 1.02 : 0.98) + EL[k] * vary
    if (port) {
      out.C.set(modX(k) + drift * 0.3, 0.45, DISP.z + 1.35)
      this.fit(out, DISP.w + 0.8, (DISP.d + 3.6) * Math.sin(out.pitch) + 0.9, this.region('item', k))
    } else {
      out.C.set(modX(k) + drift * 0.45, 0.4, DISP.z + 2.0)
      this.fit(out, DISP.w + 2.2, (DISP.d + 5.6) * Math.sin(out.pitch) + 0.9, this.region('item', k))
    }
    out.dist *= DK[k] * (1.02 - drift * 0.05)
    return out
  }

  private introShot(u: number, out: Shot) {
    const L = this.lay!
    const port = L.portrait
    out.fov = 32
    const reg = this.region('intro', 0)
    if (port) {
      out.yaw = lerp(0.34, 0.28, u)
      out.pitch = lerp(0.72, 0.68, u)
      out.C.set(U1.x + 0.9 + u * 1.2, 0.3, U1.z - 0.6)
      this.fit(out, 13, 9, reg)
    } else {
      out.yaw = lerp(0.66, 0.6, u)
      out.pitch = lerp(0.28, 0.26, u)
      out.C.set(U1.x + 4.2 + u * 1.2, 0.3, U1.z - 0.4)
      this.fit(out, 15, 6, reg)
    }
    return out
  }

  private nineShot(drift: number, row: number, out: Shot) {
    const L = this.lay!
    out.fov = FOV
    const mid = NR - 1
    if (L.portrait) {
      // three rows in the band between the chrome and the table; the column's
      // ends stop short of the band's edges (U15 never pans up under the brand
      // plate, the board's front edge stays behind the table)
      out.yaw = 0
      out.pitch = 0.98
      out.C.set(NINE.x + 4.4, 0.2, nineZ(clamp(row, 1, mid - 1)) + 0.2)
      this.fit(out, 11.6, 6.6 * Math.sin(out.pitch) + 0.5, this.region('list', 0))
    } else {
      out.yaw = -0.03 - drift * 0.02
      out.pitch = 0.9
      const zc = (nineZ(0) + nineZ(mid)) / 2 - 0.4
      out.C.set(NINE.x + 4.6, 0.2, lerp(zc, nineZ(clamp(row, 0, mid)), 0.16))
      this.fit(out, 14, (nineZ(mid) - nineZ(0) + 3.6) * Math.sin(out.pitch) + 0.4, this.region('list', 0))
      out.dist *= 1 - drift * 0.04
    }
    return out
  }

  private outShot(out: Shot) {
    out.fov = FOV
    out.yaw = 0
    out.pitch = 1.32
    out.C.set(NINE.x, 0.25, nineZ(NR - 1))
    out.dist = 2.4
    out.cx = 0
    out.cy = 0
    return out
  }

  /** a glide: eased position, and in the middle the camera dips low over the bus and looks ahead */
  private glide(a: Shot, b: Shot, t: number, dip: number, out: Shot) {
    const e = ease.inOutCubic(clamp(t))
    const bump = Math.sin(Math.PI * clamp(t))
    out.C.lerpVectors(a.C, b.C, e)
    out.yaw = lerp(a.yaw, b.yaw, e) + 0.3 * dip * bump
    out.pitch = lerp(a.pitch, b.pitch, e) - 0.52 * dip * bump
    out.dist = lerp(a.dist, b.dist, e) * (1 - 0.34 * dip * bump)
    out.fov = lerp(a.fov, b.fov, e)
    out.cx = lerp(a.cx, b.cx, e) * (1 - 0.6 * bump * Math.abs(dip))
    out.cy = lerp(a.cy, b.cy, e) * (1 - 0.6 * bump * Math.abs(dip))
    out.C.z += 2.6 * dip * bump
    return out
  }

  private shotAt(l: number, out: Shot) {
    if (l < I0) return this.introShot(l / I0, out)
    const t0b = itemStart(0) + TRAVEL0 * SPAN
    if (l < t0b) return this.glide(this.introShot(1, this.sa), this.moduleShot(0, 0, this.sb), (l - I0) / (t0b - I0), 0.35, out)
    if (l < F1) {
      const k = Math.min(NF - 1, Math.floor((l - F0) / SPAN))
      const p = clamp((l - itemStart(k)) / SPAN)
      const tr = k === 0 ? TRAVEL0 : TRAVEL
      if (k > 0 && p < TRAVEL) return this.glide(this.moduleShot(k - 1, 1, this.sa), this.moduleShot(k, 0, this.sb), p / TRAVEL, 1, out)
      return this.moduleShot(k, clamp((p - tr) / (1 - tr)), out)
    }
    const row = ((l - ROW0) / (ROW1 - ROW0)) * NR - 0.5
    const drift = clamp((l - LIST_IN) / (OUT - LIST_IN))
    if (l < LIST_IN) return this.glide(this.moduleShot(NF - 1, 1, this.sa), this.nineShot(0, -0.5, this.sb), (l - F1) / (LIST_IN - F1), -0.35, out)
    if (l < OUT) return this.nineShot(drift, row, out)
    const t = Math.pow(clamp((l - OUT) / (1 - OUT)), 1.5)
    this.nineShot(1, row, this.sa)
    this.outShot(this.sb)
    out.C.lerpVectors(this.sa.C, this.sb.C, t)
    out.yaw = lerp(this.sa.yaw, this.sb.yaw, t)
    out.pitch = lerp(this.sa.pitch, this.sb.pitch, t)
    out.dist = lerp(this.sa.dist, this.sb.dist, t)
    out.fov = FOV
    out.cx = lerp(this.sa.cx, 0, t)
    out.cy = lerp(this.sa.cy, 0, t)
    return out
  }

  /** pose from a shot: C lands at (cx, cy) on screen */
  private place(s: Shot, W: number, H: number) {
    const cp = Math.cos(s.pitch)
    _d.set(Math.sin(s.yaw) * cp, -Math.sin(s.pitch), -Math.cos(s.yaw) * cp).normalize()
    _r.crossVectors(_d, UP).normalize()
    _u.crossVectors(_r, _d).normalize()
    const hh = s.dist * Math.tan((s.fov * DEG) / 2)
    const hw = hh * (W / Math.max(1, H))
    this.pos.copy(s.C).addScaledVector(_d, -s.dist).addScaledVector(_r, -s.cx * hw).addScaledVector(_u, -s.cy * hh)
    this.tgt.copy(this.pos).addScaledVector(_d, s.dist)
  }

  // ------------------------------------------------------------------ focus

  /**
   * The macro lens: where focus sits (a world point) and how shallow it is,
   * derived from local like the camera. Glides rack focus down onto the bus
   * (the signal) and back up to the display as it boots; in the nine, focus
   * slides chip to chip with the table rows.
   */
  private focusAt(l: number, out: THREE.Vector3): { band: number; amount: number } {
    const disp = (k: number, v: THREE.Vector3) => v.set(modX(k), DISP_TOP, DISP.z + 0.4)
    const rest = { band: 2.7, amount: 1.5 }
    if (l < I0) {
      out.set(U1.x + 1.5, 0.3, U1.z)
      return { band: 2.6, amount: 1.9 }
    }
    const t0b = itemStart(0) + TRAVEL0 * SPAN
    if (l < t0b) {
      const t = clamp((l - I0) / (t0b - I0))
      const e = ease.inOutCubic(t)
      out.set(U1.x + 1.5, 0.3, U1.z).lerp(disp(0, _f), e)
      return { band: lerp(2.6, rest.band, e), amount: lerp(1.9, rest.amount, e) }
    }
    if (l < F1) {
      const k = Math.min(NF - 1, Math.floor((l - F0) / SPAN))
      const p = clamp((l - itemStart(k)) / SPAN)
      if (k > 0 && p < TRAVEL) {
        const t = p / TRAVEL
        const e = ease.inOutCubic(t)
        const bump = Math.sin(Math.PI * t)
        disp(k - 1, out).lerp(disp(k, _f), e)
        out.z += 4.2 * bump
        out.y -= 0.6 * bump
        return { band: lerp(rest.band, 1.1, bump), amount: lerp(rest.amount, 2.3, bump) }
      }
      disp(k, out)
      return rest
    }
    const col = _f.set(NINE.x + 2.5, 0.2, (nineZ(0) + nineZ(NR - 1)) / 2)
    if (l < LIST_IN) {
      const e = ease.inOutCubic(clamp((l - F1) / (LIST_IN - F1)))
      disp(NF - 1, out).lerp(col, e)
      return { band: lerp(rest.band, 3.2, e), amount: lerp(rest.amount, 1.2, e) }
    }
    const rowF = clamp(((l - ROW0) / (ROW1 - ROW0)) * NR - 0.5, 0, NR - 1)
    const into = smoothstep(ROW0 - 0.004, ROW0 + 0.006, l)
    out.copy(col).lerp(_g.set(NINE.x + 2.5, 0.2, nineZ(rowF)), into)
    if (l < OUT) return { band: lerp(3.2, 3.0, into), amount: 0.95 }
    const t = clamp((l - OUT) / (1 - OUT))
    out.lerp(_g.set(NINE.x, 0.25, nineZ(NR - 1)), t)
    return { band: lerp(3.0, 0.5, t), amount: lerp(0.95, 2.6, t) }
  }

  // ------------------------------------------------------------------ light

  /** studio turn: the overhead softbox turned lengthwise (π/2) so its strip lies across the glass; a sweep per arrival */
  private turnAt(l: number) {
    const base = Math.PI / 2
    const A = 1.15
    const side = (k: number) => (k % 2 === 0 ? 1 : -1)
    if (l < F0) return base + A + 0.5 * (1 - l / F0)
    if (l < F1) {
      const k = Math.min(NF - 1, Math.floor((l - F0) / SPAN))
      const p = clamp((l - itemStart(k)) / SPAN)
      const a0 = (k === 0 ? ARRIVE0 : ARRIVE) - 0.06
      const e = ease.inOutCubic(clamp((p - a0) / 0.38))
      return base + lerp(side(k) * A, -side(k) * A, e)
    }
    const last = -side(NF - 1) * A
    return base + last + smoothstep(F1, OUT, l) * 0.6
  }

  // ------------------------------------------------------------------ frame

  update(local: number, frame: Frame, ctx: ChapterContext) {
    const l = clamp(local)
    const time = frame.time
    const reduced = this.reduced || frame.reducedMotion
    // Motion off (frame.still) holds time; the bursts calm down like reduced motion
    const calm = reduced || !!frame.still
    const L = this.ensureLayout(frame)
    const b = this.board
    if (!b) return

    // ---- camera
    this.shotAt(l, this.cur)
    this.place(this.cur, L.W, L.H)

    // ---- the macro lens: depth of field (desktop). The veil is the chapter's
    // single biggest GPU cost: it goes first when the engine sheds effects
    // (html.lowfx: phones, or the adaptive resolution has stepped down).
    if (b.veil) {
      // once shed, the veil stays off for the rest of this visit (bringing it
      // back would slow the frame and make the engine step down again)
      if (this.active && document.documentElement.classList.contains('lowfx')) this.veilShed = true
      const lens = !this.veilShed && !document.documentElement.classList.contains('lowfx')
      b.veil.visible = lens
      if (lens) {
        const f = this.focusAt(l, _fp)
        b.dof.uFocus.value = this.pos.distanceTo(_fp)
        b.dof.uBand.value = f.band
        b.dof.uAmount.value = f.amount
        // the veil's transmission pass runs at half resolution (a blur source only)
        if (this.active) ctx.renderer.transmissionResolutionScale = 0.5
      } else {
        // no veil: the pulses stay sharp with the board
        b.dof.uAmount.value = 0
      }
    }

    const inItems = l >= F0 && l < F1
    const kAct = inItems ? Math.min(NF - 1, Math.floor((l - F0) / SPAN)) : l >= F1 ? NF : -1
    const pAct = inItems ? clamp((l - itemStart(kAct)) / SPAN) : 0

    // ---- world: a macro studio over black mask; bokeh sits behind the subject
    const wp = ctx.world.params
    wp.top = '#0b1017'
    wp.bottom = '#030406'
    // the light pools: a muted green (full signal green washes the backdrop)
    wp.a = '#1f9d63'
    wp.b = '#4a5872'
    wp.bokeh = 0.9
    wp.focus.set(this.cur.cx * (L.W / Math.max(1, L.H)) * 0.8, 0.55)
    // the sweep: as a module boots, the studio's long softbox turns across it and
    // its highlight slides over the glass, the gold and the tin
    let sweep = 0
    if (inItems) {
      const a0 = (kAct === 0 ? ARRIVE0 : ARRIVE) - 0.06
      sweep = Math.sin(Math.PI * clamp((pAct - a0) / 0.38))
    }
    wp.env = 1.05 + 0.35 * sweep
    wp.envTurn = this.turnAt(l)
    wp.key = 2.1
    wp.keyDir.set(-0.5, 0.82, 0.32)
    wp.fill = 0.26

    const pp = ctx.post.params
    pp.bloomStrength = 0.62
    pp.bloomRadius = 0.45
    // screenshots and silkscreen never bloom; pulses, LEDs and the scan line do
    pp.bloomThreshold = 1.05
    pp.vignette = 0.42
    pp.aberration = 0.0014

    // ---- the bus: per-group signal fronts, all derived from local
    const bu = b.bus.u
    bu.uTime.value = time
    bu.uFlow.value = reduced ? 0.7 : 7
    bu.uAmbient.value = calm ? 0.1 : 0.2
    bu.uHead.value = calm ? 0.55 : 1
    const go = bu.uGo.value
    const gain = bu.uGain.value
    for (let g = 0; g < NF; g++) {
      const arr = arriveAt(g)
      const start = g === 0 ? BURST0 : itemStart(g) - 0.004
      const dStart = g === 0 ? 19 : 34
      if (l < start) go[g] = 1e4
      else if (l < arr) {
        const t = clamp((l - start) / (arr - start))
        go[g] = dStart * (1 - t * t)
      } else go[g] = -40 * smoothstep(arr, arr + 0.03 * SPAN, l)
      gain[g] = g === kAct ? 1 : 0.42
    }
    if (l < BURST9_A) go[6] = 1e4
    else if (l < BURST9_B) {
      const t = clamp((l - BURST9_A) / (BURST9_B - BURST9_A))
      go[6] = 30 * (1 - t * t)
    } else go[6] = -40 * smoothstep(BURST9_B, BURST9_B + 0.004, l)
    gain[6] = 0.45
    go[7] = 1e4
    const scrollRow = clamp(Math.floor(((l - ROW0) / (ROW1 - ROW0)) * NR), 0, NR - 1)
    const listV = smoothstep(LIST_IN - 0.012, LIST_IN, l) * (1 - smoothstep(OUT - 0.003, OUT + 0.004, l))
    if (listV <= 0.01) this.hoverRow = -1
    const hot = l >= ROW0 - 0.002 ? (this.hoverRow >= 0 ? this.hoverRow : scrollRow) : -1
    bu.uHot.value = hot
    bu.uHotAmt.value = hot >= 0 ? 1 : 0

    // ---- modules: backlight + scan, status LEDs
    const breathe = calm ? 1 : 0.88 + 0.12 * Math.sin(time * 2.1)
    for (let k = 0; k < NF; k++) {
      const m = b.modules[k]
      const arr = arriveAt(k)
      const boot = smoothstep(arr, arr + BOOT * SPAN, l)
      const scan = clamp((l - (arr + BOOT * SPAN)) / (SCAN * SPAN))
      m.u.uBoot.value = boot
      m.u.uScan.value = scan
      // once the camera moves on, a module drops to a dim standby
      const next = k < NF - 1 ? itemStart(k + 1) : F1
      m.u.uBright.value = 0.86 * (1 - 0.6 * smoothstep(next, next + 0.22 * SPAN, l))
      const on = smoothstep(arr - 0.002, arr + 0.004, l)
      const pre = isPreview(FEATURED[k].url)
      this.setLed(k, on, pre ? S.amber : S.signal, (k === kAct ? 4.2 : 2.6) * breathe)
    }
    // the nine: chips drop in, LEDs come up with the burst, the hot one bright
    const nineOn = smoothstep(BURST9_B - 0.002, BURST9_B + 0.004, l)
    for (let j = 0; j < NR; j++) this.setLed(NF + j, nineOn, S.signal, j === hot ? 4.4 * breathe : 1.1)
    this.setLed(LED_PWR, 1, S.signal, 2.4 * breathe)
    b.leds.instanceColor!.needsUpdate = true
    b.ledGlow.instanceColor!.needsUpdate = true

    const nineVisible = l > PLACE0 - 0.03
    b.nine.bodies.visible = b.nine.tops.visible = b.nine.leads.visible = b.nine.shadows.visible = nineVisible
    if (nineVisible) {
      let changed = false
      for (let j = 0; j < NR; j++) {
        const u = clamp((l - (PLACE0 + j * PLACE_STEP)) / PLACE_DUR)
        const y = 1.8 * (1 - ease.outExpo(u))
        changed = placeNine(b.nine, j, y) || changed
      }
      if (changed) {
        b.nine.bodies.instanceMatrix.needsUpdate = true
        b.nine.tops.instanceMatrix.needsUpdate = true
        b.nine.leads.instanceMatrix.needsUpdate = true
        b.nine.shadows.instanceMatrix.needsUpdate = true
      }
    }

    // ---- DOM
    reveal(this.intro, 1 - smoothstep(INTRO_OUT0, INTRO_OUT1, l), 0)
    setRise(this.introTitle, l > 0.004 && l < INTRO_OUT1)
    for (let k = 0; k < NF; k++) {
      let v = 0
      if (inItems && kAct === k) {
        const a = k === 0 ? 0.13 : 0.22
        v = smoothstep(a, a + 0.07, pAct) * (1 - smoothstep(0.95, 0.995, pAct))
      }
      reveal(this.cards[k].root, v, 10)
      setRise(this.cards[k].name, v > 0.3)
    }
    reveal(this.list, listV, 10)
    setRise(this.listTitle, listV > 0.3)
    const sv = L.portrait ? Math.round(listV * 50) / 50 : 0
    if (sv !== this.scrimV) {
      this.scrimV = sv
      this.scrim.style.opacity = String(sv)
    }
    const rowSel = listV > 0.01 ? hot : -1
    if (rowSel !== this.curRow) {
      this.rows.forEach((r, j) => r.classList.toggle('is-cur', j === rowSel))
      this.curRow = rowSel
    }
  }

  private setLed(i: number, on: number, color: string, strength: number) {
    const b = this.board
    const off = 0.05
    this.ledCol.set(color).multiplyScalar(strength * on)
    this.ledCol.r += off * (1 - on)
    this.ledCol.g += off * 1.1 * (1 - on)
    this.ledCol.b += off * (1 - on)
    b.leds.setColorAt(i, this.ledCol)
    _c.set(color).multiplyScalar(0.16 * on * Math.min(1.4, strength / 3))
    b.ledGlow.setColorAt(i, _c)
  }

  onEnter() {
    this.active = true
    this.veilShed = false
  }

  onLeave(ctx: ChapterContext) {
    this.active = false
    ctx.renderer.transmissionResolutionScale = 1
  }

  camera(_local: number, _frame: Frame, out: CameraPose) {
    out.position.copy(this.pos)
    out.target.copy(this.tgt)
    out.fov = this.cur.fov
    out.parallax = this.reduced ? 0 : 0.12
  }
}

export default function create(): Chapter {
  return new Work()
}
