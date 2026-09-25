import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { BRAND, MICROCOPY } from '../../content'
import { ease, segment, smoothstep } from '../../core/math'
import { placeholderFloor, framedCamera } from '../common'
import { MAT, Traces, bondWires, chipPackage, dieMaterial, dieTexture, route, silk, smdField } from '../../kit/silicon'
import '../chapter.css'

/*
 * HERO (placeholder). Pattern: an intro beat with the manifesto + scroll hint,
 * a middle beat for the signature animation, and a payoff with the tagline
 * and two CTAs (land('work') / land('contact')). Replace the scene entirely.
 */
export default function create(): Chapter {
  const group = new THREE.Group()
  // KIT SMOKE TEST (placeholder): a board standing up to face the camera
  const board = new THREE.Group()
  board.rotation.x = Math.PI / 2
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(14, 0.16, 9), MAT.mask())
  pcb.position.y = -0.08
  board.add(pcb)
  const chip = chipPackage({ w: 2.2, kind: 'qfp', pinsPerSide: 16, lines: ['HARK-1', 'MAKE · LISTEN'] })
  board.add(chip)
  const paths: THREE.Vector3[][] = []
  for (let i = 0; i < 16; i++) {
    const a = new THREE.Vector2(1.3, -0.9 + i * 0.12)
    const b = new THREE.Vector2(6.8, -4 + i * 0.5)
    paths.push(route(a, b, { y: 0.002, jog: 0.3 + (i % 4) * 0.1 }))
    paths.push(route(new THREE.Vector2(-1.3, -0.9 + i * 0.12), new THREE.Vector2(-6.8, -4 + i * 0.5), { y: 0.002, jog: 0.4 }))
  }
  const traces = new Traces(paths, { width: 0.05 })
  board.add(traces.group)
  board.add(smdField({ x0: -6.5, z0: -4, x1: 6.5, z1: 4, count: 160, avoid: (x, z) => Math.abs(x) < 1.8 && Math.abs(z) < 1.8 }))
  const lab = silk('U1  HARK-1', { height: 0.22 })
  lab.position.set(-1.1, 0.002, 1.5)
  board.add(lab)
  const die = dieTexture({ size: 1024 })
  const dieMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 2.4), dieMaterial(die.texture))
  dieMesh.position.set(4.4, 0.04, 2)
  board.add(dieMesh)
  const pads: [THREE.Vector3, THREE.Vector3][] = []
  for (let i = 0; i < 10; i++) pads.push([new THREE.Vector3(3.3 + i * 0.22, 0.08, 0.9), new THREE.Vector3(3.3 + i * 0.22, 0.01, 0.2)])
  board.add(bondWires(pads))
  board.scale.setScalar(0.42)
  group.add(board, placeholderFloor())
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
      traces.set({ time: frame.time, flow: 5, density: 1.2 })
      const spin = ease.inOutCubic(segment(local, 0.1, 0.6))
      board.rotation.set(Math.PI / 2 - 0.35 + 0.1 * Math.sin(frame.time * 0.4), 0, 0.15 * spin)
      reveal(intro, 1 - smoothstep(0.08, 0.14, local))
      reveal(payoff, smoothstep(0.62, 0.7, local) * (1 - smoothstep(0.93, 0.97, local)))
      setRise(title, local > 0.64 && local < 0.95)
    },
    camera(local, frame, out) {
      framedCamera(out, frame, ease.inOutCubic(segment(local, 0.55, 0.7)))
    },
  }
}
