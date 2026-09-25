import { el, rise } from '../../core/dom'
import { BRAND, CONTACT, OTHER_CONCEPTS } from '../../content'

/*
 * POWER ON · the contact datasheet panel. Left and vertically centred on
 * landscape, along the bottom on portrait. The address is the primary action
 * (a big lit signal pad); Copy email sits beside it; the sister concepts are a
 * little pin table; Back to top and the colophon close it.
 *
 * Layout is MEASURED (on resize / font load / panel size change, never per
 * frame) so the board can be framed in whatever space the panel leaves:
 * `art` is that free rectangle in CSS px. Short screens step the panel down
 * through fit levels until it fits its band.
 */

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Hud {
  stage: HTMLElement
  probe: HTMLElement
  wrap: HTMLElement
  panel: HTMLElement
  title: HTMLElement
  status: HTMLElement
  mail: HTMLAnchorElement
  copyBtn: HTMLButtonElement
  dirty: boolean
  /** performance.now() of the last successful copy */
  copiedAt: number
  /** pointer/focus is on the address or the copy button */
  hover: boolean
}

export interface HudLayout {
  W: number
  H: number
  portrait: boolean
  /** free area for the board, CSS px */
  art: Rect
  /** the band between the top and bottom chrome (--safe-top / --safe-bottom), CSS px */
  safe: Rect
  panel: Rect
}

/** Portrait layout (panel along the bottom). Keep in sync with contact.css. */
export const PORTRAIT_QUERY = '(max-width: 767px) and (orientation: portrait), (max-width: 767px) and (min-height: 501px), (max-aspect-ratio: 9/10)'

const ICON_MAIL =
  '<svg class="pw-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5.5" width="18" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m4.6 7.4 7.4 5.6 7.4-5.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>'

/** Copy text: async Clipboard API first, then a hidden-textarea fallback. */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied or unsupported: fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  active?.focus?.({ preventScroll: true })
  return ok
}

/** A polite live region OUTSIDE the aria-hidden stage, so the copy result is announced. */
function liveRegion() {
  const id = 'pw-copy-live'
  let node = document.getElementById(id)
  if (!node) {
    node = document.createElement('p')
    node.id = id
    node.className = 'sr-only'
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    document.body.appendChild(node)
  }
  return node
}

export function buildHud(stage: HTMLElement): Hud {
  const probe = el('div', 'pw-probe', undefined, stage)
  const wrap = el('div', 'pw-wrap', undefined, stage)
  const panel = el('div', 'hud-panel pw-panel', undefined, wrap)

  const head = el('div', 'pw-head', undefined, panel)
  el('p', 'hud-eyebrow pw-eyebrow', CONTACT.eyebrow, head)
  const status = el('p', 'pw-status', undefined, head)
  status.setAttribute('aria-hidden', 'true')
  status.innerHTML = '<span class="pw-led"></span><span>PWR</span><span class="pw-part">HK-0N · J2</span>'

  const words = CONTACT.title.split(' ')
  const last = words.pop() ?? ''
  const title = rise(el('h2', 'hud-title pw-title', undefined, panel), `${words.join(' ')} <em>${last}</em>`)
  el('p', 'hud-body pw-body', CONTACT.body, panel)

  const cta = el('div', 'pw-cta', undefined, panel)
  const mail = el('a', 'hud-btn pw-mail', undefined, cta)
  mail.href = CONTACT.href
  mail.innerHTML = `${ICON_MAIL}<span class="pw-mail-addr"></span><span class="pw-go" aria-hidden="true">→</span>`
  mail.querySelector('.pw-mail-addr')!.textContent = BRAND.email

  const copyBtn = el('button', 'hud-btn hud-btn--ghost pw-copy', undefined, cta)
  copyBtn.type = 'button'
  copyBtn.innerHTML =
    '<span class="pw-copy-idle">Copy<span class="pw-copy-more"> email</span></span><span class="pw-copy-done" aria-hidden="true">Copied</span><span class="pw-copy-fail" aria-hidden="true"><span class="pw-copy-more">Copy </span>failed</span>'

  el('hr', 'hud-rule pw-rule', undefined, panel)

  const more = el('div', 'pw-more', undefined, panel)
  el('p', 'hud-label pw-more-label', 'Other concepts', more)
  const list = el('ul', 'pw-links', undefined, more)
  OTHER_CONCEPTS.forEach((c, i) => {
    const li = el('li', '', undefined, list)
    const a = el('a', 'pw-link', undefined, li)
    a.href = c.url
    a.target = '_blank'
    a.rel = 'noopener'
    el('span', 'pw-pin', String(i + 1).padStart(2, '0'), a).setAttribute('aria-hidden', 'true')
    el('span', 'pw-name', c.name, a)
    el('span', 'pw-arr', '↗', a).setAttribute('aria-hidden', 'true')
  })

  const foot = el('div', 'pw-foot', undefined, panel)
  const top = el('button', 'pw-top', undefined, foot)
  top.type = 'button'
  el('span', 'pw-arr', '↑', top).setAttribute('aria-hidden', 'true')
  el('span', '', 'Back to top', top)
  top.addEventListener('click', e => {
    const hark = window.__hark
    if (!hark) return
    hark.land('hero')
    if (e.detail === 0) hark.engine?.focusChapter('hero')
  })
  const legal = el('p', 'pw-legal', undefined, foot)
  const parts = [`© ${new Date().getFullYear()} ${BRAND.name}`, ...BRAND.locale.split(' · ')]
  parts.forEach((p, i) => {
    if (i) legal.append(' · ')
    el('span', 'pw-nw', p, legal)
  })

  const hud: Hud = { stage, probe, wrap, panel, title, status, mail, copyBtn, dirty: true, copiedAt: -1e9, hover: false }

  const on = () => (hud.hover = true)
  const off = () => (hud.hover = false)
  for (const n of [mail, copyBtn]) {
    n.addEventListener('pointerenter', on)
    n.addEventListener('pointerleave', off)
    n.addEventListener('focus', on)
    n.addEventListener('blur', off)
  }

  const live = liveRegion()
  let resetT = 0
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(BRAND.email)
    window.clearTimeout(resetT)
    copyBtn.classList.toggle('is-copied', ok)
    copyBtn.classList.toggle('is-failed', !ok)
    if (ok) hud.copiedAt = performance.now()
    live.textContent = ok ? `Copied ${BRAND.email} to the clipboard.` : `Copy failed. The address is ${BRAND.email}.`
    resetT = window.setTimeout(() => {
      copyBtn.classList.remove('is-copied', 'is-failed')
      live.textContent = ''
    }, 1900)
  })

  const dirty = () => (hud.dirty = true)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(dirty)
    ro.observe(probe)
    ro.observe(panel)
  }
  window.addEventListener('resize', dirty)
  document.fonts?.ready.then(dirty).catch(() => {})
  return hud
}

const FIT = ['pw-fit-1', 'pw-fit-2', 'pw-fit-3'] as const

export function measureHud(hud: Hud, W: number, H: number, allowFit = true): HudLayout {
  const stage = hud.stage
  const portrait = matchMedia(PORTRAIT_QUERY).matches
  stage.classList.remove(...FIT)
  const band = hud.probe.getBoundingClientRect()
  const bandH = Math.max(1, band.height)
  // portrait: the panel may take most of the band, the board lives above it
  const limit = portrait ? bandH * (W < 420 ? 0.8 : 0.68) : bandH
  if (allowFit) for (let i = 0; i < FIT.length && hud.panel.offsetHeight > limit; i++) stage.classList.add(FIT[i])

  // offset* ignore the reveal transform, so the measure is stable mid-reveal
  const w = hud.wrap.getBoundingClientRect()
  const x0 = w.left + hud.panel.offsetLeft
  const y0 = w.top + hud.panel.offsetTop
  const panel = { x0, y0, x1: x0 + hud.panel.offsetWidth, y1: y0 + hud.panel.offsetHeight }

  let art: Rect
  if (!portrait) {
    const gap = Math.max(20, W * 0.022)
    art = { x0: panel.x1 + gap, x1: band.right, y0: band.top, y1: band.bottom }
  } else {
    const gap = Math.max(10, H * 0.014)
    // the board may rise into the top band's empty middle (brand left, menu right)
    const top = Math.max(band.top * 0.8, 56)
    art = { x0: band.left, x1: band.right, y0: top, y1: Math.max(top + 90, panel.y0 - gap) }
  }
  const safe = { x0: band.left, y0: band.top, x1: band.right, y1: band.bottom }
  return { W, H, portrait, art, safe, panel }
}
