import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, TESTIMONIALS } from '../../content'
import { smoothstep } from '../../core/math'
import { beat, placeholderFloor, placeholderMark, framedCamera } from '../common'
import '../chapter.css'

/*
 * VOICES (placeholder). Pattern: header → 8 quotes, ONE at a time, each fully
 * readable for a comfortable dwell (≈0.1 local ≈ 0.3vh each) → out.
 */
export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = placeholderMark('#c2419a')
  mark.scale.setScalar(1.4)
  group.add(mark, placeholderFloor())
  const B = beat(0, TESTIMONIALS.length, 0.08, 0.94)
  let intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement, quote: HTMLElement, who: HTMLElement
  let shown = -1
  return {
    id: 'voices',
    group,
    anchors: B.centers,
    init(ctx) {
      intro = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECTIONS.voices.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-h2', undefined, intro), 'We listen. <em>They talk.</em>')
      card = el('figure', 'ph-panel hud-panel', undefined, ctx.stage)
      card.style.margin = '0'
      quote = el('blockquote', 'hud-quote', '', card)
      quote.style.margin = '0'
      who = el('figcaption', 'hud-label', '', card)
    },
    update(local, frame) {
      const b = beat(local, TESTIMONIALS.length, 0.08, 0.94)
      mark.rotation.y = frame.time * 0.2 + local * 2
      reveal(intro, 1 - smoothstep(0.07, 0.1, local))
      setRise(introTitle, local > 0.02 && local < 0.08)
      reveal(card, b.active ? 1 : 0, 0)
      if (b.active && b.idx !== shown) {
        shown = b.idx
        const t = TESTIMONIALS[shown]
        quote.textContent = `“${t.quote}”`
        who.textContent = `${t.name} · ${t.company}`
      }
    },
    camera(_local, frame, out) {
      framedCamera(out, frame)
    },
  }
}
