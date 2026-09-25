import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, SERVICES } from '../../content'
import { smoothstep } from '../../core/math'
import { beat, placeholderFloor, placeholderMark, framedCamera } from '../common'
import '../chapter.css'

/*
 * SERVICES (placeholder). Pattern: intro headline → 11 beats, the panel names
 * the service shown at rest (switch when the new visual has formed) → out.
 * anchors = one local per service (keyboard focus lands on each).
 */
export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = placeholderMark('#3a7bff')
  mark.scale.setScalar(1.6)
  group.add(mark, placeholderFloor())
  const B = beat(0, SERVICES.length, 0.08, 0.94)
  let intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement, num: HTMLElement, title: HTMLElement, blurb: HTMLElement, tags: HTMLElement
  let shown = -1
  return {
    id: 'services',
    group,
    anchors: B.centers,
    init(ctx) {
      intro = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', `${SECTIONS.services.eyebrow} · 01—11`, intro)
      introTitle = rise(el('h2', 'hud-h2', undefined, intro), 'Eleven ways to be <em>heard.</em>')
      card = el('div', 'ph-panel hud-panel', undefined, ctx.stage)
      num = el('p', 'hud-label', '', card)
      title = el('h3', 'hud-h2', '', card)
      blurb = el('p', 'hud-body', '', card)
      tags = el('ul', 'hud-tags', undefined, card)
    },
    update(local, frame) {
      const b = beat(local, SERVICES.length, 0.08, 0.94)
      mark.rotation.y = local * Math.PI * 4 + frame.time * 0.2
      reveal(intro, 1 - smoothstep(0.07, 0.1, local))
      setRise(introTitle, local > 0.02 && local < 0.08)
      reveal(card, b.active ? 1 : 0, 0)
      if (b.active && b.idx !== shown) {
        shown = b.idx
        const s = SERVICES[shown]
        num.textContent = `${s.num} / ${SERVICES.length}`
        title.textContent = s.title
        blurb.textContent = s.blurb
        tags.replaceChildren(...s.tags.map(t => Object.assign(document.createElement('li'), { className: 'hud-tag', textContent: t })))
      }
    },
    camera(_local, frame, out) {
      framedCamera(out, frame)
    },
  }
}
