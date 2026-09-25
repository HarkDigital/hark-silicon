import { holdInert, releaseInert } from './inert'

/*
 * Phone-landscape suggestion card. It's DISMISSIBLE (WCAG 1.3.4 — never
 * force an orientation): "Continue anyway" releases it for the session. It
 * never inerts #track (the accessible copy) or the skip link.
 * API: mountRotateGate(onChange?) / unmountRotateGate(); createChrome wires
 * onChange to engine.paused so the scene stops rendering underneath.
 */
const MQ = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'
const KEY = 'hark:rotate-dismissed'
let root: HTMLElement | null = null
let cleanup: (() => void) | null = null

export function mountRotateGate(onChange?: (shown: boolean) => void) {
  if (root || typeof window === 'undefined') return
  const mq = window.matchMedia(MQ)
  root = document.createElement('div')
  root.className = 'rot'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'false')
  root.setAttribute('aria-label', 'Best viewed upright')
  root.innerHTML = `
    <div class="rot-card">
      <p class="hud-h2">Turn your phone upright</p>
      <p class="hud-body">This site is designed for portrait.</p>
      <button type="button" class="hud-btn hud-btn--ghost">Continue anyway</button>
    </div>`
  document.body.appendChild(root)
  const dismissed = () => {
    try {
      return sessionStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  }
  const apply = () => {
    const show = mq.matches && !dismissed()
    root!.hidden = !show
    if (show) holdInert('rotate', [document.getElementById('stages'), document.getElementById('chrome')])
    else releaseInert('rotate')
    onChange?.(show)
  }
  root.querySelector('button')!.addEventListener('click', () => {
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* storage blocked */
    }
    apply()
  })
  mq.addEventListener?.('change', apply)
  apply()
  cleanup = () => mq.removeEventListener?.('change', apply)
}

export function unmountRotateGate() {
  cleanup?.()
  cleanup = null
  releaseInert('rotate')
  root?.remove()
  root = null
}
