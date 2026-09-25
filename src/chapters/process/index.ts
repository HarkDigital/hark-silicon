import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { PROCESS, STATS } from '../../content'
import { smoothstep } from '../../core/math'
import { beat, placeholderFloor, placeholderMark, framedCamera } from '../common'
import '../chapter.css'

/*
 * PROCESS (placeholder). Pattern: title → four steps (Listen, Prototype,
 * Build, Support) → the three stats verbatim (10 years, $1M+, 15) → out.
 */
const SHOW = [STATS[0], STATS[2], STATS[1]] // 10 years, $1M+, 15

export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = placeholderMark()
  mark.scale.setScalar(1.4)
  group.add(mark, placeholderFloor())
  const B = beat(0, PROCESS.length, 0.1, 0.78)
  let head: HTMLElement, title: HTMLElement, step: HTMLElement, stepNum: HTMLElement, stepTitle: HTMLElement, stepText: HTMLElement, stats: HTMLElement
  let shown = -1
  return {
    id: 'process',
    group,
    // the four steps, then the stats beat (srContent makes the first stat a keyboard stop)
    anchors: [...B.centers, 0.88],
    init(ctx) {
      head = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', 'How we work', head)
      title = rise(el('h2', 'hud-h2', undefined, head), 'We listen first. <em>Then we build.</em>')
      step = el('div', 'ph-panel hud-panel', undefined, ctx.stage)
      stepNum = el('p', 'hud-label', '', step)
      stepTitle = el('h3', 'hud-h2', '', step)
      stepText = el('p', 'hud-body', '', step)
      stats = el('div', 'ph-panel hud-panel', undefined, ctx.stage)
      for (const s of SHOW) {
        el('p', 'hud-h2', s.value, stats)
        el('p', 'hud-body', s.label, stats)
      }
    },
    update(local, frame) {
      const b = beat(local, PROCESS.length, 0.1, 0.78)
      mark.rotation.y = frame.time * 0.2 + b.idx * (Math.PI / 2)
      reveal(head, smoothstep(0.03, 0.08, local) * (1 - smoothstep(0.94, 0.97, local)))
      setRise(title, local > 0.04 && local < 0.95)
      reveal(step, b.active ? 1 : 0, 0)
      reveal(stats, smoothstep(0.8, 0.84, local) * (1 - smoothstep(0.94, 0.97, local)), 0)
      if (b.active && b.idx !== shown) {
        shown = b.idx
        stepNum.textContent = `Step ${String(shown + 1).padStart(2, '0')} / ${String(PROCESS.length).padStart(2, '0')}`
        stepTitle.textContent = PROCESS[shown].title
        stepText.textContent = PROCESS[shown].text
      }
    },
    camera(_local, frame, out) {
      framedCamera(out, frame)
    },
  }
}
