import { el, rise, setRise } from '../../core/dom'
import { SECTIONS, SERVICES } from '../../content'
import { BLOCKS } from './die'

/*
 * DOM for the die tour. Scroll decides WHAT is on screen (the intro or which
 * block); CSS decides HOW it arrives, so wherever the scroll rests the copy
 * is settled and exact.
 *
 *   intro   eyebrow + "Eleven ways to be heard." + a datasheet line
 *   panel   the DATASHEET: BLOCK NN / 11 · die code — title · blurb · tags ·
 *           the 01–11 index (buttons land on each block)
 *
 * All eleven items share one grid cell, so the panel never changes size.
 * metrics() reports the live layout so the camera frames the die into the
 * space the copy leaves free (re-measured only when something resizes).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const setOn = (node: HTMLElement, on: boolean, cls = 'is-on') => {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on)
}

export interface HudMetrics {
  /** right edge of the copy column (landscape) */
  colRight: number
  /** top of the panel / intro block (portrait: the die lives above it) */
  cardTop: number
  introTop: number
  introRight: number
  safeTop: number
  safeBottom: number
  gutter: number
  valid: boolean
}

export class Hud {
  private intro: HTMLElement
  private introTitle: HTMLElement
  private col: HTMLElement
  private card: HTMLElement
  private cur: HTMLElement
  private code: HTMLElement
  private items: { root: HTMLElement; title: HTMLElement }[] = []
  private keys: HTMLButtonElement[] = []
  private probeTop: HTMLElement
  private probeBottom: HTMLElement
  private shown = -2
  private key = -2
  private dirty = true
  private m: HudMetrics = { colRight: 0, cardTop: 0, introTop: 0, introRight: 0, safeTop: 0, safeBottom: 0, gutter: 16, valid: false }

  constructor(
    private stage: HTMLElement,
    onKey: (k: number) => void,
  ) {
    /* intro */
    this.intro = el('div', 'sd-intro', undefined, stage)
    el('p', 'hud-eyebrow sd-intro-eyebrow', `${SECTIONS.services.eyebrow} · 01–${pad(SERVICES.length)}`, this.intro)
    this.introTitle = rise(el('h2', 'hud-h2 sd-intro-title', undefined, this.intro), 'Eleven ways to be <em>heard.</em>')
    const spec = el('p', 'hud-label sd-intro-spec', undefined, this.intro)
    spec.innerHTML = '<span>HK-0N</span><span>DIE · 11 BLOCKS</span><span>REV A</span>'

    /* the datasheet panel */
    this.col = el('div', 'sd-col', undefined, stage)
    this.card = el('div', 'sd-card hud-panel', undefined, this.col)
    const head = el('p', 'hud-label sd-head', undefined, this.card)
    el('span', 'sd-led', undefined, head)
    const count = el('span', 'sd-count', 'BLOCK ', head)
    this.cur = el('span', 'sd-cur', '01', count)
    el('span', 'sd-of', ` / ${pad(SERVICES.length)}`, count)
    this.code = el('span', 'sd-code', BLOCKS[0].code, head)
    const stack = el('div', 'sd-stack', undefined, this.card)
    for (const s of SERVICES) {
      const root = el('div', 'sd-item', undefined, stack)
      const title = rise(el('h3', 'hud-h2 sd-title', undefined, root), s.title)
      el('p', 'hud-body sd-blurb', s.blurb, root)
      const tags = el('ul', 'hud-tags sd-tags', undefined, root)
      for (const t of s.tags) el('li', 'hud-tag', t, tags)
      this.items.push({ root, title })
    }
    const foot = el('div', 'sd-foot', undefined, this.card)
    const keys = el('div', 'sd-keys', undefined, foot)
    SERVICES.forEach((s, k) => {
      const b = el('button', 'sd-key', s.num, keys)
      b.type = 'button'
      b.title = s.title
      b.setAttribute('aria-label', `${s.num} ${s.title}`)
      b.addEventListener('click', () => onKey(k))
      this.keys.push(b)
    })

    /* layout probes on the safe bands (for the camera fit) */
    this.probeTop = el('div', 'sd-probe sd-probe--top', undefined, stage)
    this.probeBottom = el('div', 'sd-probe sd-probe--bottom', undefined, stage)
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => (this.dirty = true))
      for (const n of [stage, this.col, this.card, this.intro, this.probeTop, this.probeBottom]) ro.observe(n)
    }
    window.addEventListener('resize', () => (this.dirty = true))
  }

  /** Where the copy sits right now (stage pixels; offset* ignore transforms). */
  metrics(): HudMetrics {
    if (this.dirty) {
      const m = this.m
      const h = this.stage.offsetHeight
      if (!h) return m
      this.dirty = false
      m.colRight = this.col.offsetLeft + this.card.offsetLeft + this.card.offsetWidth
      m.cardTop = this.col.offsetTop + this.card.offsetTop
      let top = Infinity
      let right = 0
      for (const c of Array.from(this.intro.children) as HTMLElement[]) {
        top = Math.min(top, c.offsetTop)
        right = Math.max(right, c.offsetLeft + c.offsetWidth)
      }
      m.introTop = this.intro.offsetTop + (Number.isFinite(top) ? top : 0)
      m.introRight = this.intro.offsetLeft + right
      m.safeTop = this.probeTop.offsetTop
      m.safeBottom = h - (this.probeBottom.offsetTop + this.probeBottom.offsetHeight)
      m.gutter = this.col.offsetLeft
      m.valid = m.colRight > 0 && m.cardTop > 0
    }
    return this.m
  }

  update(introOn: boolean, shown: number) {
    setOn(this.intro, introOn)
    setRise(this.introTitle, introOn)
    const cardOn = shown >= 0
    setOn(this.col, cardOn)
    if (shown !== this.shown) {
      this.shown = shown
      this.items.forEach((it, k) => {
        const on = k === shown
        setOn(it.root, on)
        setRise(it.title, on)
      })
      if (cardOn) {
        this.cur.textContent = SERVICES[shown].num
        this.code.textContent = BLOCKS[shown].code
      }
    }
    if (shown !== this.key && shown >= 0) {
      this.key = shown
      this.keys.forEach((b, k) => {
        setOn(b, k === shown)
        setOn(b, k < shown, 'is-past')
      })
    }
  }
}
