import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { CONTACT, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'

/*
 * Persistent chrome (THEME: restyle freely — Orbit an instrument HUD, Press a
 * print masthead, Town wayfinding signage with a minimap, Arcade a game HUD).
 *
 *   top-left      mark + "Hark.Digital" wordmark + "Concept · <name>" tag
 *   top-right     Work · Services · Contact + "Start a project"
 *                 (≤ 820px: Menu → full-screen dialog)
 *   bottom-left   sound toggle
 *   bottom-right  "03 / 07 — Label · Business name" + one pip per chapter
 *
 * API used by main.ts: createChrome(root, engine, sound) → { update(frame, state) }.
 * Navigation always uses engine.land(id) (lands on settled copy; long jumps cut).
 */

/** Plain business names for the chapter readout (chapter labels are poetic). */
const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const NAV = ['work', 'services', 'contact']
const pad = (n: number) => String(n).padStart(2, '0')

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const has = (id: string) => slots.some(s => s.def.id === id)
  root.innerHTML = `
    <div class="ch">
      <a class="ch-brand" href="#hero" data-go="hero" aria-label="Hark Digital Design, back to the start">
        <span class="ch-mark">${markSvg('ch-mark-svg')}</span>
        <span class="ch-brand-text">${WORDMARK}${CONCEPT_TAG}</span>
      </a>
      <nav class="ch-nav" aria-label="Primary">
        ${NAV.filter(has)
          .map(id => `<a href="#${id}" data-go="${id}">${BUSINESS[id]}</a>`)
          .join('')}
        <a class="hud-btn ch-cta" href="#contact" data-go="contact">Start a project</a>
      </nav>
      <button class="ch-menu-btn" type="button" aria-expanded="false" aria-controls="ch-menu">Menu</button>
      <button class="ch-sound" type="button" aria-pressed="false">${MICROCOPY.audio}: <span>${MICROCOPY.audioOff}</span></button>
      <div class="ch-read">
        <p class="ch-read-line hud-label" aria-live="polite"></p>
        <nav class="ch-pips" aria-label="Chapters">
          ${slots
            .map((s, i) => `<button type="button" class="ch-pip" data-go="${s.def.id}" aria-label="${pad(i + 1)}: ${s.def.label} (${BUSINESS[s.def.id] ?? s.def.label})"><i></i></button>`)
            .join('')}
        </nav>
      </div>
      <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
        <button class="ch-menu-close" type="button">Close</button>
        <ul>
          ${slots.map((s, i) => `<li><a href="#${s.def.id}" data-go="${s.def.id}"><small>${pad(i + 1)}</small> ${BUSINESS[s.def.id] ?? s.def.label}</a></li>`).join('')}
        </ul>
        <a class="hud-btn" href="${CONTACT.href}">Email us</a>
      </div>
    </div>`

  const menu = root.querySelector<HTMLElement>('.ch-menu')!
  const menuBtn = root.querySelector<HTMLButtonElement>('.ch-menu-btn')!
  const soundBtn = root.querySelector<HTMLButtonElement>('.ch-sound')!
  const line = root.querySelector<HTMLElement>('.ch-read-line')!
  const pips = [...root.querySelectorAll<HTMLElement>('.ch-pip')]

  const openMenu = (open: boolean) => {
    menu.hidden = !open
    menuBtn.setAttribute('aria-expanded', String(open))
    if (open) {
      holdInert('menu', [document.getElementById('track'), document.getElementById('stages')])
      menu.querySelector<HTMLElement>('a, button')?.focus()
    } else {
      releaseInert('menu')
      menuBtn.focus()
    }
  }
  menuBtn.addEventListener('click', () => openMenu(menu.hidden !== false))
  menu.querySelector('.ch-menu-close')!.addEventListener('click', () => openMenu(false))
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.hidden === false) openMenu(false)
  })

  root.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')
    if (!a) return
    e.preventDefault()
    if (menu.hidden === false) openMenu(false)
    sound.blip(1)
    const id = a.dataset.go!
    if (id === 'hero') engine.goto(0)
    else engine.land(id)
  })

  soundBtn.addEventListener('click', () => sound.toggle())
  const syncSound = (on: boolean) => {
    soundBtn.setAttribute('aria-pressed', String(on))
    soundBtn.querySelector('span')!.textContent = on ? MICROCOPY.audioOn : MICROCOPY.audioOff
  }
  sound.onChange.push(syncSound)

  mountRotateGate(shown => (engine.paused = shown))

  let last = -1
  return {
    update(_frame: Frame, state: EngineState) {
      if (state.index === last) return
      last = state.index
      const s = slots[state.index]
      if (!s) return
      line.textContent = `${pad(state.index + 1)} / ${pad(slots.length)} — ${s.def.label} · ${BUSINESS[s.def.id] ?? ''}`
      pips.forEach((p, i) => p.classList.toggle('is-on', i === state.index))
    },
  }
}
