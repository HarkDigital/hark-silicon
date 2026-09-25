import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, holdScene, releaseScene, sceneHeld } from './scene'
import { readMotion, rememberMotion } from './motion'

/*
 * Persistent chrome: the silkscreen and connectors around the edge of a board.
 *
 *   top-left      the brand as a PART: the Hark mark laser-etched on a tiny
 *                 black QFN package (tin pins, a pin-1 dot), the real
 *                 "Hark.Digital" wordmark (its dot a signal-green LED) and a
 *                 small "Concept · Silicon" tag, inside silkscreen corner
 *                 marks (-> back to the start)
 *   top-right     a connector strip, Work · Services · Contact, each with a
 *                 gold test pad that lights green for the chapter you're in,
 *                 and the lit signal-green "Start a project" pad (chamfered
 *                 pin-1 corner). <= 820px: "Menu" (a 2x3 pin-header icon)
 *                 opens a full-screen sheet styled as the DATASHEET INDEX
 *                 (a real modal dialog: focus trap, Escape, inert background
 *                 with a fallback for browsers without `inert`, focus returns
 *                 to Menu)
 *   bottom-left   SW1, a two-way DIP switch block: Sound (aria-pressed) and
 *                 Motion (aria-pressed). Motion off sets engine.motion =
 *                 false (the engine freezes idle time and takes the calm
 *                 paths: quiet cuts, no parallax, no glitch), html.motion-off
 *                 (CSS transitions and animations collapse, as under reduced
 *                 motion) and plain, unsmoothed wheel scrolling; it is
 *                 remembered for the session (./motion.ts) and starts off
 *                 under prefers-reduced-motion
 *   bottom-right  J2, a pin header read like a logic analyzer: the line
 *                 "03 / 07 · Die · Services" (the index drops out under
 *                 400px), seven header pins (pin 1
 *                 square, the rest round; gold, the current one lit signal
 *                 green; each a >= 24 px button that lands on its chapter)
 *                 threaded on a thin copper trace, and a green signal dot
 *                 travelling along the trace with the story (it leaves a
 *                 pin as its chapter begins and reaches the next as it ends)
 *
 * Read as a page: a link to the static datasheet (?read, the same view as the
 * no-WebGL fallback) that keeps the chapter you are on as its #hash. It sits
 * in the Menu sheet; everywhere else it is the last chrome Tab stop, hidden
 * until focused (a skip-link pattern). On tiny viewports (a desktop at
 * 300-400% zoom: <= 400 x 420, or a landscape window up to 600 x 500) it
 * replaces SW1 and J2 as a visible plate, since the story's panels cannot
 * reflow that small; Menu keeps the switches and the chapters.
 *
 * Every text sits on a solid solder-mask plate (no backdrop-filter: it would
 * make the compositor wait on every WebGL frame), dark enough for >= 4.5:1
 * over the brightest frame the world can put behind it. Short-landscape
 * phones get compact plates (ui.css).
 *
 * API used by main.ts: createChrome(root, engine, sound) → { update(frame, state) }.
 * Navigation always uses engine.land(id) (lands on settled copy; long jumps cut).
 */

/** Plain business names beside each chapter's poetic label. */
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
const MENU_QUERY = '(max-width: 820px)'
const READ_LABEL = 'Read as a page'
/** the static datasheet view (main.ts renders the fallback for ?read) */
const readHref = (id: string) => `?read#${id}`
const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const biz = (id: string, fallback = '') => BUSINESS[id] ?? fallback
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // the rotate card and the datasheet sheet both cover the frame: stop rendering under them
  bindScene(engine)
  mountRotateGate(shown => (engine.paused = shown || sceneHeld()))
  // dev-only handle for audio checks in headless tests
  if (import.meta.env.DEV) (window as unknown as { __harkSound?: Sound }).__harkSound = sound

  // ---------------------------------------------------------------- markup

  const chip = `<span class="ch-chip" aria-hidden="true"><i class="ch-chip-pins"></i><span class="ch-chip-body">${markSvg('ch-mark-svg')}<i class="ch-chip-p1"></i></span></span>`
  const brandInner = `<span class="ch-ticks" aria-hidden="true"></span>${chip}
      <span class="ch-brand-text" aria-hidden="true">${WORDMARK}${CONCEPT_TAG}</span>`

  const links = NAV.filter(id => indexOf(id) >= 0)
    .map(
      id =>
        `<li><a class="ch-link" href="#${id}" data-go="${id}" data-focus><i class="ch-tp" aria-hidden="true"></i>${biz(id)}</a></li>`,
    )
    .join('')

  const pins = slots
    .map(
      (s, i) =>
        `<li><button class="ch-pin${i === 0 ? ' ch-pin--1' : ''}" type="button" data-go="${s.def.id}" data-focus aria-label="${esc(biz(s.def.id, s.def.label))}: chapter ${i + 1} of ${total}, ${esc(s.def.label)}"><i aria-hidden="true"></i></button></li>`,
    )
    .join('')

  const menuItems = slots
    .map(
      (s, i) =>
        `<li><a class="ch-ml" href="#${s.def.id}" data-go="${s.def.id}">
          <span class="ch-ml-n" aria-hidden="true">${pad(i + 1)}</span>
          <span class="ch-ml-name">${esc(biz(s.def.id, s.def.label))}</span><span class="sr-only">, </span>
          <i class="ch-ml-lead" aria-hidden="true"></i>
          <span class="ch-ml-lab">${esc(s.def.label)}</span>
        </a></li>`,
    )
    .join('')

  let motionOn = readMotion(!reduced)
  const toggle = (kind: 'sound' | 'motion', label: string, on: boolean) =>
    `<button class="ch-tgl ch-tgl--${kind}" type="button" data-${kind}-toggle aria-pressed="${on}"><span class="ch-dip" aria-hidden="true"><i></i></span><span class="ch-tgl-k">${label}</span><span class="ch-tgl-st" aria-hidden="true">: <b>${on ? MICROCOPY.audioOn : MICROCOPY.audioOff}</b></span></button>`
  const switches = (extra = '') =>
    `<div class="ch-sw ch-plate${extra}"><span class="ch-ref ch-sw-ref" aria-hidden="true">SW1</span>${toggle('sound', MICROCOPY.audio, false)}${toggle('motion', MICROCOPY.motion, motionOn)}</div>`

  // a datasheet page: folded corner, three lines of type
  const pageIcon = `<svg class="ch-rp-ic" viewBox="0 0 12 14" aria-hidden="true" focusable="false"><path d="M1.5 .5h6l3 3v10h-9z M7.5 .5v3h3"/><path d="M3.5 6.5h5M3.5 8.75h5M3.5 11h3.2"/></svg>`
  const readLink = (cls: string) =>
    `<a class="${cls}" href="${readHref(slots[0]?.def.id ?? 'hero')}" data-read>${pageIcon}<span>${READ_LABEL}</span></a>`

  const cta = (extra = '') =>
    `<a class="ch-cta${extra}" href="#contact" data-go="contact" data-focus><span class="ch-cta-t">Start a project</span><i class="ch-cta-ar" aria-hidden="true"></i></a>`

  root.innerHTML = `
  <div class="chr">
    <header class="ch-top">
      <a class="ch-brand ch-plate" href="#hero" data-go="hero" data-focus aria-label="${esc(BRAND.name)}, back to the start">
        ${brandInner}
      </a>
      <nav class="ch-nav" aria-label="Primary">
        <ul class="ch-links ch-plate">${links}</ul>
        ${cta()}
      </nav>
      <button class="ch-menu-btn ch-plate" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog">
        <span class="ch-hdr" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="ch-menu-t">Menu</span>
      </button>
    </header>

    <div class="ch-bottom">
      ${switches()}
      <div class="ch-read ch-plate">
        <p class="ch-read-line" aria-hidden="true"><span class="ch-read-n"></span><span class="ch-read-k"></span><b class="ch-read-b"></b></p>
        <nav class="ch-pins" aria-label="Chapters">
          <span class="ch-ref ch-pins-ref" aria-hidden="true">J2</span>
          <div class="ch-pins-row">
            <span class="ch-trace" aria-hidden="true"><i class="ch-trace-run"><b></b></i></span>
            <ol>${pins}</ol>
          </div>
        </nav>
      </div>
      ${readLink('ch-rp ch-plate')}
    </div>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-label="Menu" data-lenis-prevent hidden>
      <div class="ch-menu-in">
        <div class="ch-menu-top">
          <span class="ch-brand ch-plate ch-menu-brand" aria-hidden="true">${brandInner}</span>
          <button class="ch-menu-btn ch-menu-close ch-plate" type="button">
            <span class="ch-x" aria-hidden="true"></span><span class="ch-menu-t">Close</span>
          </button>
        </div>
        <div class="ch-menu-body">
          <p class="ch-menu-k" aria-hidden="true"><span>HK-0N · Datasheet</span><span>Rev A</span></p>
          <p class="ch-menu-title" aria-hidden="true">Contents</p>
          <nav class="ch-menu-nav" aria-label="Chapters"><ol class="ch-toc">${menuItems}</ol></nav>
          <div class="ch-menu-foot">
            ${cta(' ch-menu-cta')}
            ${switches(' ch-menu-sw')}
          </div>
          <p class="ch-menu-mail"><a href="mailto:${BRAND.email}">${BRAND.email}</a>${readLink('ch-menu-read')}</p>
        </div>
        <p class="ch-menu-strip" aria-hidden="true"><span>Hark Silicon · HK-0N · Rev A</span><span>${esc(BRAND.locale)}</span></p>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const chr = $('.chr')
  const top = $('.ch-top')
  const bottom = $('.ch-bottom')
  const menu = $('.ch-menu')
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const pinEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-pin')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const soundBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')]
  const motionBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]')]
  const readN = $('.ch-read-n')
  const readK = $('.ch-read-k')
  const readB = $('.ch-read-b')
  const read = $('.ch-read')
  const run = $('.ch-trace-run')
  const readLinks = [...root.querySelectorAll<HTMLAnchorElement>('[data-read]')]

  // header-first tab order: the chrome comes before the active chapter's content
  const stagesEl = document.getElementById('stages')
  if (stagesEl && stagesEl.parentNode === root.parentNode && root.compareDocumentPosition(stagesEl) & Node.DOCUMENT_POSITION_PRECEDING) {
    stagesEl.parentNode!.insertBefore(root, stagesEl)
  }

  // pick-and-place: the plates drop in (fast, precise, a tiny settle) as the loader lifts
  const placeIn = () => chr.classList.add('is-in')
  if (document.documentElement.dataset.ready === '1') placeIn()
  else {
    window.addEventListener('hark:reveal', placeIn, { once: true })
    window.setTimeout(placeIn, 8000)
  }

  // ---------------------------------------------------------------- navigation

  const go = (id: string) => {
    if (indexOf(id) >= 0) engine.land(id)
  }

  root.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-go]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.go!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(a.matches('.ch-cta') ? 6 : Math.max(0, indexOf(id)))
    go(id)
    // menu links always hand focus on (the sheet they lived in is gone); the
    // top nav, CTA, brand and pins do it for keyboard activation (click.detail 0)
    if (fromMenu || (e.detail === 0 && a.hasAttribute('data-focus'))) engine.focusChapter(id)
  })

  // ------------------------------------------------------------- the readout

  let lastIndex = -1
  let cueIndex = -1
  const showRead = (i: number, cue = false) => {
    const s = slots[i]
    if (!s) return
    // the index is its own span so narrow screens can drop it (ui.css)
    readN.textContent = cue ? `Go to ${pad(i + 1)} · ` : `${pad(i + 1)} / ${pad(total)} · `
    readK.textContent = `${s.def.label} · `
    readB.textContent = biz(s.def.id, s.def.label)
    read.classList.toggle('is-cue', cue)
  }
  pinEls.forEach((b, i) => {
    b.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType === 'touch') return
      cueIndex = i
      showRead(i, i !== lastIndex)
    })
    b.addEventListener('focus', () => {
      cueIndex = i
      showRead(i, i !== lastIndex)
    })
    const uncue = () => {
      if (cueIndex !== i) return
      cueIndex = -1
      if (lastIndex >= 0) showRead(lastIndex)
    }
    b.addEventListener('pointerleave', uncue)
    b.addEventListener('blur', uncue)
  })

  // --------------------------------------------------------------------- sound

  const setState = (b: HTMLButtonElement, on: boolean) => {
    b.setAttribute('aria-pressed', String(on))
    const st = b.querySelector('.ch-tgl-st b')
    if (st) st.textContent = on ? MICROCOPY.audioOn : MICROCOPY.audioOff
  }
  const syncSound = (on: boolean) => {
    for (const b of soundBtns) setState(b, on)
    chr.classList.toggle('is-sound', on)
  }
  for (const b of soundBtns) b.addEventListener('click', () => sound.toggle())
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // -------------------------------------------------------------------- motion

  // Hold the motion still: the engine (idle clock frozen, calm cut, no
  // parallax or glitch), html.motion-off (base.css collapses transitions and
  // animations, as under reduced motion), wheel scrolling without Lenis's
  // smoothing, and a 'hark:motion' event for anything else
  const lenisOpts = engine.lenis.options
  const smooth0 = { lerp: lenisOpts.lerp, smoothWheel: lenisOpts.smoothWheel }
  const calm = () => reduced || !motionOn
  const syncMotion = () => {
    document.documentElement.classList.toggle('motion-off', !motionOn)
    engine.motion = motionOn
    lenisOpts.lerp = motionOn ? smooth0.lerp : 1
    lenisOpts.smoothWheel = motionOn ? smooth0.smoothWheel : false
    for (const b of motionBtns) setState(b, motionOn)
    window.dispatchEvent(new CustomEvent('hark:motion', { detail: { on: motionOn } }))
  }
  for (const b of motionBtns)
    b.addEventListener('click', () => {
      motionOn = !motionOn
      rememberMotion(motionOn)
      sound.blip(motionOn ? 4 : 0)
      syncMotion()
    })
  syncMotion()

  // --------------------------------------------------------------- menu sheet

  let menuOpen = false
  let hideTimer = 0
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    window.clearTimeout(hideTimer)
    menu.hidden = false
    // flush the closed state so the sheet's entrance runs
    void menu.offsetWidth
    chr.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      top,
      bottom,
    ])
    engine.lenis.stop()
    // the sheet covers the whole frame: stop rendering once it is down
    hideTimer = window.setTimeout(
      () => {
        if (menuOpen) holdScene('menu')
      },
      calm() ? 0 : 480,
    )
    menu.scrollTop = 0
    const now = menuLinks[lastIndex] ?? menuLinks[0]
    now?.focus({ preventScroll: true })
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    window.clearTimeout(hideTimer)
    chr.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    releaseScene('menu')
    engine.lenis.start()
    hideTimer = window.setTimeout(
      () => {
        if (!menuOpen) menu.hidden = true
      },
      calm() ? 20 : 360,
    )
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => {
    sound.blip(2)
    if (menuOpen) closeMenu()
    else openMenu()
  })
  menuClose.addEventListener('click', () => closeMenu())
  // capture: the dialog's own trap runs ahead of the no-`inert` fallback in inert.ts
  window.addEventListener(
    'keydown',
    e => {
      if (!menuOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    },
    true,
  )
  const narrow = matchMedia(MENU_QUERY)
  narrow.addEventListener?.('change', e => {
    if (!e.matches) closeMenu(false)
  })

  // -------------------------------------------------------------------- update

  let lastRun = -1

  return {
    update(_frame: Frame, state: EngineState) {
      const slot = state.slots[state.index]
      if (!slot) return

      if (state.index !== lastIndex) {
        lastIndex = state.index
        if (cueIndex < 0) showRead(state.index)
        else showRead(cueIndex, cueIndex !== lastIndex)
        pinEls.forEach((p, i) => {
          p.classList.toggle('is-on', i === state.index)
          p.classList.toggle('is-past', i < state.index)
          if (i === state.index) p.setAttribute('aria-current', 'step')
          else p.removeAttribute('aria-current')
        })
        const activeId = slot.def.id
        navEls.forEach(a => {
          const on = a.dataset.go === activeId
          a.classList.toggle('is-active', on)
          if (on) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        menuLinks.forEach((a, i) => {
          a.classList.toggle('is-now', i === state.index)
          if (i === state.index) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        chr.dataset.chapter = activeId
        // Read as a page opens the datasheet at the chapter you are on
        const href = readHref(activeId)
        for (const a of readLinks) a.setAttribute('href', href)
      }

      // the signal leaves pin i as chapter i begins and runs toward pin i+1;
      // in the last chapter it runs out to the end of the trace
      const last = state.index >= total - 1
      const p = Math.max(0, Math.min(1, (state.index + state.local * (last ? 0.5 : 1)) / (total - 0.5)))
      const pct = Math.round(p * 2000) / 20
      if (pct !== lastRun) {
        lastRun = pct
        run.style.transform = `translate3d(${(pct - 100).toFixed(2)}%, 0, 0)`
      }
    },
  }
}
