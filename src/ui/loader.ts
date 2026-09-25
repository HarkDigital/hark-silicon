import { holdInert, releaseInert } from './inert'
import { markSvg } from './mark'

/*
 * Boot screen (THEME: every concept designs its own — Orbit drew the mark,
 * Resonance asked "Play with sound?", Press printed a proof, Town built an
 * island, Arcade booted a BIOS).
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 * Rules: shows at least ~1.2s, never hangs (finish() always resolves), the
 * page behind is inert while it's up, skip removes it at once (?nointro).
 */
const MIN_MS = 1200

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  const start = performance.now()
  if (skip) root.remove()
  else {
    root.innerHTML = `
      <div class="ld">
        <div class="ld-mark">${markSvg('ld-svg')}</div>
        <div class="ld-bar"><i></i></div>
        <p class="ld-pct hud-label"><span data-pct>000</span>%</p>
      </div>`
    holdInert('loader', [document.getElementById('track'), document.getElementById('stages'), document.getElementById('chrome')])
  }
  const bar = root.querySelector<HTMLElement>('.ld-bar i')
  const pct = root.querySelector<HTMLElement>('[data-pct]')
  return {
    progress(p: number) {
      const v = Math.max(0, Math.min(1, p))
      if (bar) bar.style.transform = `scaleX(${v})`
      if (pct) pct.textContent = String(Math.round(v * 100)).padStart(3, '0')
    },
    async finish(): Promise<void> {
      if (skip) return
      const wait = MIN_MS - (performance.now() - start)
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      root.classList.add('is-out')
      await new Promise(r => setTimeout(r, 500))
      releaseInert('loader')
      root.remove()
    },
  }
}
