import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, WORK, workImage } from '../../content'
import { smoothstep } from '../../core/math'
import { beat, placeholderFloor } from '../common'
import { loadScreenshot, placeholderTexture, whenRevealed } from '../../kit/images'
import '../chapter.css'

/*
 * WORK (placeholder). Pattern: intro headline → one beat per featured project
 * (screenshot + card with name, industry, blurb, tags, visit link; harktest.com
 * = "Preview") → "Nine more, all live." list → out. Screenshots load lazily
 * after the reveal, decoded off the main thread (src/kit/images.ts).
 */
const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const isPreview = (url: string) => /harktest\.com/.test(url)

export default function create(): Chapter {
  const group = new THREE.Group()
  const screens = FEATURED.map((_, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshBasicMaterial({ map: placeholderTexture(), toneMapped: false }))
    m.position.set(i * 5, 0.4, 0)
    group.add(m)
    return m
  })
  group.add(placeholderFloor(60))
  const B = beat(0, FEATURED.length, 0.1, 0.84)
  let intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement, name: HTMLElement, meta: HTMLElement, blurb: HTMLElement, tags: HTMLElement, visit: HTMLAnchorElement
  let rest: HTMLElement
  let shown = -1
  return {
    id: 'work',
    group,
    // featured first, then the nine others (srContent / WORK order: featured are first in content.ts)
    anchors: [...B.centers, ...REST.map(() => 0.9)],
    init(ctx) {
      intro = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECTIONS.work.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-h2', undefined, intro), 'Built to be <em>heard.</em>')
      card = el('div', 'ph-panel hud-panel', undefined, ctx.stage)
      meta = el('p', 'hud-label', '', card)
      name = el('h3', 'hud-h2', '', card)
      blurb = el('p', 'hud-body', '', card)
      tags = el('ul', 'hud-tags', undefined, card)
      visit = el('a', 'hud-btn hud-btn--ghost', '', card)
      visit.target = '_blank'
      visit.rel = 'noopener'
      rest = el('div', 'ph-panel hud-panel', undefined, ctx.stage)
      el('h3', 'hud-h2', 'Nine more, all live.', rest)
      const list = el('ul', 'ph-list', undefined, rest)
      for (const w of REST) {
        const a = el('a', '', `${w.name} ↗`, el('li', '', undefined, list))
        a.href = w.url
        a.target = '_blank'
        a.rel = 'noopener'
      }
      const hello = el('button', 'hud-btn', 'Say hello', rest)
      hello.type = 'button'
      hello.addEventListener('click', () => window.__hark?.land('contact'))
      // first screenshot right away, the rest after the reveal
      const load = (i: number) =>
        loadScreenshot(workImage(FEATURED[i].id), { width: 1024 })
          .then(t => {
            const m = screens[i].material as THREE.MeshBasicMaterial
            m.map = t
            m.needsUpdate = true
          })
          .catch(() => {})
      load(0)
      whenRevealed().then(async () => {
        for (let i = 1; i < FEATURED.length; i++) await load(i)
      })
    },
    update(local) {
      const b = beat(local, FEATURED.length, 0.1, 0.84)
      reveal(intro, 1 - smoothstep(0.09, 0.12, local))
      setRise(introTitle, local > 0.02 && local < 0.1)
      reveal(card, b.active ? smoothstep(0.02, 0.12, b.phase) * (1 - smoothstep(0.9, 1, b.phase)) : 0, 0)
      reveal(rest, smoothstep(0.85, 0.88, local) * (1 - smoothstep(0.95, 0.97, local)), 0)
      if (b.active && b.idx !== shown) {
        shown = b.idx
        const w = FEATURED[shown]
        meta.textContent = `${String(shown + 1).padStart(2, '0')} / ${String(FEATURED.length).padStart(2, '0')} · ${w.industry}`
        name.textContent = w.name
        blurb.textContent = w.blurb
        tags.replaceChildren(...w.tags.map(t => Object.assign(document.createElement('li'), { className: 'hud-tag', textContent: t })))
        visit.href = w.url
        visit.textContent = isPreview(w.url) ? 'Preview site ↗' : 'Visit site ↗'
      }
    },
    camera(local, _frame, out) {
      const b = beat(local, FEATURED.length, 0.1, 0.84)
      const x = local < 0.1 ? -2 : local > 0.84 ? (FEATURED.length - 1) * 5 + 2 : b.idx * 5 + (b.phase - 0.5) * 0.8
      out.position.set(x + 1.2, 0.6, 5)
      out.target.set(x, 0.3, 0)
      out.fov = 42
      out.parallax = 0.3
    },
  }
}
