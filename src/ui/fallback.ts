import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { BRAND } from '../content'
import { CHAPTERS } from '../chapters/index'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'

/*
 * Plain HTML version for browsers without WebGL2 (and the last resort if
 * boot fails), and the chrome's "Read as a page" view (?read, for tiny or
 * zoomed viewports and anyone who would rather read): every chapter's copy
 * in story order, visible, typeset as a printed
 * DATASHEET — white paper, black ink, a signal-green header rule, a part
 * number block (HK-0N · Rev A, decorative), a contents list, and numbered
 * sections, each with its chapter's label in the margin like a datasheet's
 * section tabs. In ?read mode a "Back to the story" link leads to the
 * section you were reading, in the 3D story. Styles: .fb-* in ui.css.
 */

const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const pad = (n: number) => String(n).padStart(2, '0')

export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  unmountRotateGate()
  releaseInert('loader')
  document.getElementById('loader')?.remove()
  // a chrome built before the context died has nothing left to steer
  const chrome = document.getElementById('chrome')
  if (chrome) chrome.replaceChildren()
  root.style.pointerEvents = 'auto'

  // story order (CHAPTERS), so the numbers match the site's pins and Menu
  const ids = [
    ...CHAPTERS.map(c => c.id).filter(id => CHAPTER_COPY_IDS.includes(id)),
    ...CHAPTER_COPY_IDS.filter(id => !CHAPTERS.some(c => c.id === id)),
  ]
  const reading = new URLSearchParams(location.search).has('read')
  const labelOf = (id: string) => CHAPTERS.find(c => c.id === id)?.label ?? ''
  const toc = ids
    .map(
      (id, i) =>
        `<li><a href="#${id}"><span class="fb-toc-n" aria-hidden="true">${pad(i + 1)}</span><span class="fb-toc-name">${esc(BUSINESS[id] ?? id)}</span><i aria-hidden="true"></i><span class="fb-toc-lab">${esc(labelOf(id))}</span></a></li>`,
    )
    .join('')

  const back = reading
    ? `<p class="fb-back"><a href="${esc(location.pathname)}#${esc(ids[0] ?? 'hero')}" data-story><i aria-hidden="true"></i>Back to the story</a></p>`
    : ''

  root.innerHTML = `
  <div class="fb${reading ? ' fb--read' : ''}">
    ${back}
    <header class="fb-head">
      <div class="fb-brand">
        <span class="fb-mark" aria-hidden="true">${markSvg('fb-mark-svg')}</span>
        <span class="fb-brand-t">${WORDMARK}${CONCEPT_TAG}</span>
      </div>
      <dl class="fb-part" aria-label="Document">
        <div><dt>Part</dt><dd>HK-0N</dd></div>
        <div><dt>Doc</dt><dd>Datasheet</dd></div>
        <div><dt>Rev</dt><dd>A</dd></div>
      </dl>
    </header>
    <div class="fb-rule" aria-hidden="true"></div>
    <nav class="fb-toc" aria-label="Contents">
      <p class="fb-k">Contents</p>
      <ol>${toc}</ol>
    </nav>
    <div class="fb-main" id="fb-main" tabindex="-1"></div>
    <footer class="fb-foot">
      <span>${esc(BRAND.name)} · ${esc(BRAND.locale)}</span>
      <span aria-hidden="true">HK-0N · Rev A · Page 1 of 1</span>
    </footer>
  </div>`
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link')
  if (skip) skip.href = '#fb-main'
  const main = root.querySelector<HTMLElement>('#fb-main')!
  ids.forEach((id, i) => {
    const copy = buildChapterCopy(id, true)
    if (!copy) return
    // the story's item stops only steer the 3D scene; on paper they are plain titles
    copy.querySelectorAll<HTMLAnchorElement>('a[data-anchor][href^="#"]:not([data-land])').forEach(a => {
      const span = document.createElement('span')
      span.append(...a.childNodes)
      a.replaceWith(span)
    })
    // in-page links are plain hash links here (a clone drops the story's
    // land() handler, which would do nothing if the engine died mid-visit)
    copy.querySelectorAll<HTMLAnchorElement>('a[data-land]').forEach(a => a.replaceWith(a.cloneNode(true)))
    // headings are Tab stops for the scroll story; not on a page you simply read
    copy.querySelectorAll<HTMLElement>('h1[tabindex], h2[tabindex]').forEach(h => h.removeAttribute('tabindex'))
    const sec = document.createElement('section')
    sec.className = `fb-sec fb-sec--${id}`
    sec.id = id
    const heading = copy.querySelector<HTMLElement>('h1, h2')
    if (heading) {
      heading.id ||= `fb-${id}-title`
      sec.setAttribute('aria-labelledby', heading.id)
    }
    const tab = document.createElement('div')
    tab.className = 'fb-tab'
    tab.setAttribute('aria-hidden', 'true')
    tab.innerHTML = `<span class="fb-tab-n">${pad(i + 1)}</span><span class="fb-tab-lab">${esc(labelOf(id))}</span><span class="fb-tab-biz">${esc(BUSINESS[id] ?? '')}</span>`
    sec.append(tab, copy)
    main.appendChild(sec)
  })

  if (reading) {
    const story = root.querySelector<HTMLAnchorElement>('[data-story]')
    // back to the story at the section in view (the story lands on #hash)
    story?.addEventListener('click', () => {
      let at = ids[0] ?? 'hero'
      for (const sec of main.querySelectorAll<HTMLElement>('.fb-sec')) {
        if (sec.getBoundingClientRect().top <= innerHeight * 0.35) at = sec.id
      }
      story.href = `${location.pathname}#${at}`
    })
    // the page is built after the browser looked for the #hash: go there now
    const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    if (target && main.contains(target) && target.id !== ids[0]) target.scrollIntoView()
  }
}
