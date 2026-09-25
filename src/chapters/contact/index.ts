import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { BRAND, CONTACT, OTHER_CONCEPTS } from '../../content'
import { smoothstep } from '../../core/math'
import { placeholderFloor, placeholderMark, framedCamera } from '../common'
import '../chapter.css'

/*
 * CONTACT (placeholder, the final chapter). Pattern: big email CTA (must win
 * hit-testing at every viewport), Copy email with a fallback, links to every
 * other concept (OTHER_CONCEPTS), Back to top via land('hero'), a footer, and
 * a conclusive sign-off near the end.
 */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

export default function create(): Chapter {
  const group = new THREE.Group()
  const mark = placeholderMark()
  mark.scale.setScalar(1.8)
  group.add(mark, placeholderFloor())
  let copy: HTMLElement, title: HTMLElement, signoff: HTMLElement
  return {
    id: 'contact',
    group,
    init(ctx) {
      copy = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', CONTACT.eyebrow, copy)
      title = rise(el('h2', 'hud-title', undefined, copy), 'Say <em>hello.</em>')
      el('p', 'hud-body', CONTACT.body, copy)
      const ctas = el('div', 'ph-ctas', undefined, copy)
      const mail = el('a', 'hud-btn', BRAND.email, ctas)
      mail.href = CONTACT.href
      const cp = el('button', 'hud-btn hud-btn--ghost', 'Copy email', ctas)
      cp.type = 'button'
      cp.addEventListener('click', async () => {
        const ok = await copyText(BRAND.email)
        cp.textContent = ok ? 'Copied' : 'Copy failed'
        window.setTimeout(() => (cp.textContent = 'Copy email'), 1800)
      })
      const links = el('p', 'ph-links', undefined, copy)
      for (const c of OTHER_CONCEPTS) {
        const a = el('a', '', `${c.name} ↗`, links)
        a.href = c.url
        a.target = '_blank'
        a.rel = 'noopener'
      }
      const top = el('button', '', 'Back to top ↑', links)
      top.type = 'button'
      top.addEventListener('click', () => window.__hark?.land('hero'))
      el('p', 'hud-label', `© ${new Date().getFullYear()} ${BRAND.name} · ${BRAND.locale}`, copy)
      signoff = el('p', 'hud-label', 'Thanks for listening.', ctx.stage)
      signoff.style.cssText = 'position:absolute;right:var(--gutter);top:var(--safe-top)'
    },
    update(local, frame) {
      mark.rotation.y = frame.time * 0.25
      reveal(copy, smoothstep(0.1, 0.2, local))
      setRise(title, local > 0.12)
      reveal(signoff, smoothstep(0.8, 0.86, local))
    },
    camera(_local, frame, out) {
      framedCamera(out, frame)
    },
  }
}
