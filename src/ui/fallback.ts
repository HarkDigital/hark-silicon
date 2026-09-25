import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { CONCEPT_TAG, WORDMARK } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'

/*
 * Plain HTML version for browsers without WebGL2 (and the last resort if
 * boot fails): every chapter's copy in order, visible. THEME: style it like
 * the concept (.fb-* in ui.css) — Press made it a zine page, Town a
 * guidebook, Arcade an instruction manual.
 */
export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  unmountRotateGate()
  releaseInert('loader')
  document.getElementById('loader')?.remove()
  root.style.pointerEvents = 'auto'
  root.innerHTML = `<div class="fb"><header class="fb-top">${WORDMARK} ${CONCEPT_TAG}</header><div class="fb-main" id="fb-main" tabindex="-1"></div></div>`
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link')
  if (skip) skip.href = '#fb-main'
  const main = root.querySelector<HTMLElement>('#fb-main')!
  for (const id of CHAPTER_COPY_IDS) {
    const copy = buildChapterCopy(id, true)
    if (!copy) continue
    const sec = document.createElement('section')
    sec.className = 'fb-section'
    sec.appendChild(copy)
    main.appendChild(sec)
  }
}
