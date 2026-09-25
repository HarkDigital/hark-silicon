import { holdInert, releaseInert } from './inert'
import { holdScene, releaseScene } from './scene'

/*
 * Phone-landscape suggestion, drawn as a datasheet APPLICATION NOTE: a matte
 * panel with a gold hairline, a phone drawn in white silkscreen linework (a
 * tiny Hark chip on its screen) that turns upright once, "Turn your phone
 * upright" and "Continue anyway". Silicon frames its board shots for a tall
 * screen, so a short, touch-first landscape viewport gets the suggestion.
 * Tablets and laptops in landscape are taller than 500px and never see it.
 *
 * It is a suggestion, never a lock (WCAG 1.3.4): "Continue anyway" releases
 * the gate for the rest of the session, and while the card shows, the skip
 * link and the linear copy layer in #track stay reachable for keyboards and
 * screen readers (only the chrome, the stages and the loader are inert). The
 * card sits under #track's focus layer (ui.css), so a focused copy-layer
 * pill or the skip link always draws above it.
 *
 * Visibility is pure CSS (the same query in ui.css) so it is right on the
 * very first paint; JS makes the covered layers inert while it shows,
 * announces it, and pauses the hidden scene (scene.ts).
 *
 * API: mountRotateGate(onChange?) / unmountRotateGate(). Safe to call more
 * than once: later calls just add their onChange listener.
 */

export const ROTATE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'

const DISMISS_KEY = 'hark-silicon:rotate-ok'
const wasDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
const rememberDismissed = () => {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode / blocked storage: the choice lasts until reload */
  }
}

/** a phone in silkscreen linework, a little QFN chip on its screen */
const PHONE = `<svg class="rot-phone" viewBox="-60 -60 120 120" aria-hidden="true" focusable="false">
  <g class="rot-ph">
    <rect class="rot-ph-body" x="-26" y="-46" width="52" height="92" rx="8"/>
    <rect class="rot-ph-screen" x="-21" y="-36" width="42" height="72" rx="2"/>
    <path class="rot-ph-ear" d="M-6 -41.5h12"/>
    <g class="rot-ph-chip">
      <rect class="rot-ph-die" x="-9" y="-9" width="18" height="18" rx="1.2"/>
      <path class="rot-ph-pins" d="M-6 -12v3M-2 -12v3M2 -12v3M6 -12v3M-6 9v3M-2 9v3M2 9v3M6 9v3M-12 -6h3M-12 -2h3M-12 2h3M-12 6h3M9 -6h3M9 -2h3M9 2h3M9 6h3"/>
      <circle class="rot-ph-p1" cx="-5.5" cy="-5.5" r="1.3"/>
      <path class="rot-ph-trace" d="M0 12v10l6 6h9"/>
      <circle class="rot-ph-via" cx="15" cy="28" r="1.8"/>
    </g>
  </g>
  <path class="rot-arc" d="M40 -30 A 48 48 0 0 1 46 12"/>
  <path class="rot-arc-head" d="M41.5 7.5 L46 13 L50.5 7"/>
</svg>`

let gate: {
  el: HTMLElement
  mq: MediaQueryList
  sync: () => void
  listeners: ((shown: boolean) => void)[]
  on: () => boolean
} | null = null

export function mountRotateGate(onChange?: (shown: boolean) => void) {
  if (gate) {
    if (onChange) {
      gate.listeners.push(onChange)
      onChange(gate.on())
    }
    return
  }
  if (typeof matchMedia === 'undefined') return
  let dismissed = wasDismissed()
  const el = document.createElement('div')
  el.className = dismissed ? 'rot is-dismissed' : 'rot'
  // non-modal: the copy layer behind it stays in reach
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-labelledby', 'rot-title')
  el.setAttribute('aria-describedby', 'rot-sub')
  el.tabIndex = -1
  el.innerHTML = `
    <div class="rot-card">
      <div class="rot-art" aria-hidden="true">${PHONE}</div>
      <div class="rot-text">
        <p class="rot-k" aria-hidden="true"><span>App note 01</span><span>Orientation</span></p>
        <h2 class="rot-title" id="rot-title">Turn your phone <em>upright</em></h2>
        <p class="rot-sub" id="rot-sub">The board is laid out for a tall screen.</p>
        <p class="rot-actions"><button class="rot-go" type="button">Continue anyway</button></p>
      </div>
    </div>
    <p class="sr-only" aria-live="assertive" data-rot-live></p>`
  // right after the skip link: Tab goes skip link -> this card -> the copy layer
  const skip = document.querySelector('.skip-link')
  if (skip && skip.parentNode === document.body) skip.after(el)
  else document.body.prepend(el)

  const live = el.querySelector<HTMLElement>('[data-rot-live]')!
  const go = el.querySelector<HTMLButtonElement>('.rot-go')!
  const mq = matchMedia(ROTATE_QUERY)
  const listeners: ((shown: boolean) => void)[] = onChange ? [onChange] : []
  let on = false
  const sync = () => {
    const want = mq.matches && !dismissed
    if (want === on) return
    on = want
    el.classList.toggle('is-on', on)
    document.documentElement.classList.toggle('is-rotate', on)
    if (on) {
      holdScene('rotate')
      // only the layers the card hides; the skip link and #track stay reachable
      holdInert('rotate', ['chrome', 'stages', 'loader'].map(id => document.getElementById(id)))
      // focus stranded in a now-inert layer (or on <body>) comes to the card;
      // a reader already in the copy layer or on the skip link stays put
      const a = document.activeElement
      const keep = a instanceof HTMLElement && a !== document.body && (a.closest('#track') || a.matches('.skip-link'))
      if (!keep) el.focus({ preventScroll: true })
      // a live region only speaks when its text changes after it is shown
      requestAnimationFrame(() => {
        if (on) live.textContent = 'Turn your phone upright. The board is laid out for a tall screen.'
      })
    } else {
      releaseInert('rotate')
      releaseScene('rotate')
      live.textContent = ''
    }
    for (const fn of listeners) fn(on)
  }

  go.addEventListener('click', () => {
    const hadFocus = el.contains(document.activeElement)
    dismissed = true
    rememberDismissed()
    el.classList.add('is-dismissed')
    sync()
    if (!hadFocus) return
    // the card is gone: hand focus to the story, like the skip link does
    const main = document.getElementById('track')
    if (main && !main.closest('[inert], [aria-hidden="true"]')) main.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur?.()
  })

  mq.addEventListener?.('change', sync)
  gate = { el, mq, sync, listeners, on: () => on }
  sync()
}

/** The plain HTML fallback reads fine in any orientation. */
export function unmountRotateGate() {
  if (!gate) return
  gate.mq.removeEventListener?.('change', gate.sync)
  gate.el.remove()
  document.documentElement.classList.remove('is-rotate')
  releaseInert('rotate')
  releaseScene('rotate')
  gate = null
}
