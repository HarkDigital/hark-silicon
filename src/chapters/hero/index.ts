import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { BRAND, MICROCOPY } from '../../content'
import { ease, segment, smoothstep } from '../../core/math'
import { placeholderFloor, placeholderMark, framedCamera } from '../common'
import '../chapter.css'

/*
 * HERO (placeholder). Pattern: an intro beat with the manifesto + scroll hint,
 * a middle beat for the signature animation, and a payoff with the tagline
 * and two CTAs (land('work') / land('contact')). Replace the scene entirely.
 */
export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = placeholderMark()
  mark.scale.setScalar(2.2)
  group.add(mark, placeholderFloor())
  let intro: HTMLElement
  let payoff: HTMLElement
  let title: HTMLElement
  return {
    id: 'hero',
    group,
    anchors: [0.8],
    init(ctx) {
      intro = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', MICROCOPY.signalEyebrow, intro)
      el('p', 'hud-body', BRAND.manifesto, intro)
      el('p', 'hud-label', MICROCOPY.scrollHint + ' ↓', intro)
      payoff = el('div', 'ph-copy', undefined, ctx.stage)
      title = rise(el('h1', 'hud-title', undefined, payoff), 'Make the internet <em>listen.</em>')
      const ctas = el('div', 'ph-ctas', undefined, payoff)
      const see = el('button', 'hud-btn', 'See the work', ctas)
      see.type = 'button'
      see.addEventListener('click', () => window.__hark?.land('work'))
      const start = el('a', 'hud-btn hud-btn--ghost', 'Start a project', ctas)
      start.href = '#contact'
      start.addEventListener('click', e => {
        if (!window.__hark) return
        e.preventDefault()
        window.__hark.land('contact')
      })
    },
    update(local, frame) {
      const spin = ease.inOutCubic(segment(local, 0.1, 0.6))
      mark.rotation.set(0.15 * Math.sin(frame.time * 0.6), spin * Math.PI * 2 + frame.time * 0.1, 0)
      reveal(intro, 1 - smoothstep(0.08, 0.14, local))
      reveal(payoff, smoothstep(0.62, 0.7, local) * (1 - smoothstep(0.93, 0.97, local)))
      setRise(title, local > 0.64 && local < 0.95)
    },
    camera(local, frame, out) {
      framedCamera(out, frame, ease.inOutCubic(segment(local, 0.55, 0.7)))
    },
  }
}
