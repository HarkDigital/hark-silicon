import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECURITY, STATS } from '../../content'
import { smoothstep } from '../../core/math'
import { placeholderFloor, placeholderMark, framedCamera } from '../common'
import '../chapter.css'

/*
 * SHIELD (placeholder). Pattern: threat beat (0–0.35) → "Hacked? Breathe."
 * + body (settled by the 0.45 landing) → calm + 24/7 + emergency CTA (anchor).
 */
export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = placeholderMark()
  mark.scale.setScalar(1.6)
  group.add(mark, placeholderFloor())
  const stat = STATS.find(s => s.value === '24/7')!
  let copy: HTMLElement, title: HTMLElement, calm: HTMLElement
  return {
    id: 'shield',
    group,
    anchors: [0.8],
    init(ctx) {
      copy = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECURITY.eyebrow, copy)
      title = rise(el('h2', 'hud-title', undefined, copy), 'Hacked? <em>Breathe.</em>')
      el('p', 'hud-body', SECURITY.body, copy)
      calm = el('div', 'ph-panel hud-panel', undefined, ctx.stage)
      el('p', 'hud-h2', stat.value, calm)
      el('p', 'hud-body', stat.label, calm)
      const cta = el('a', 'hud-btn', SECURITY.cta, calm)
      cta.href = SECURITY.href
    },
    update(local, frame, ctx) {
      const threat = 1 - smoothstep(0.3, 0.4, local)
      mark.rotation.y = frame.time * 0.3
      mark.position.x = threat * 0.04 * Math.sin(frame.time * 40) * (ctx.reducedMotion ? 0 : 1)
      reveal(copy, smoothstep(0.35, 0.42, local) * (1 - smoothstep(0.94, 0.97, local)))
      setRise(title, local > 0.36 && local < 0.95)
      reveal(calm, smoothstep(0.7, 0.76, local) * (1 - smoothstep(0.94, 0.97, local)), 0)
      if (threat > 0.5) ctx.world.params.a = '#ff3b3b'
    },
    camera(_local, frame, out) {
      framedCamera(out, frame)
    },
  }
}
