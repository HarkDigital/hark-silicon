// Fonts: Space Grotesk (display + body) and Martian Mono (datasheet labels, part numbers).
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/martian-mono/standard.css'
import './styles/base.css'
import './ui/ui.css'

import { installPrintPolyfills } from './ui/polyfills'
import { Engine } from './core/Engine'
import { CHAPTERS } from './chapters/index'
import { createLoader } from './ui/loader'
import { createChrome } from './ui/chrome'
import { Sound } from './ui/sound'
import { renderFallback } from './ui/fallback'
import { mountDebug } from './core/debug'

/*
 * URL params (handy for review + screenshots):
 *   ?nointro            skip the loader animation
 *   ?c=work&l=0.5       jump to a chapter at local progress
 *   ?p=0.42             jump to global progress
 *   ?only=work          init only that chapter (fast dev loop)
 *   ?debug              fps / chapter / progress readout
 */
const params = new URLSearchParams(location.search)

declare global {
  interface Window {
    __hark?: {
      ready: boolean
      engine: Engine
      goto: (p: number) => void
      /** exact jump (screenshots, tests) */
      gotoChapter: (id: string, local?: number) => void
      /** visitor navigation: lands just past the cut on settled copy; long jumps cut */
      land: (id: string, smooth?: boolean, local?: number) => void
    }
  }
}

installPrintPolyfills()

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const track = document.getElementById('track')!
  let stages = document.getElementById('stages')
  if (!stages) {
    stages = document.createElement('div')
    stages.id = 'stages'
    document.body.insertBefore(stages, document.getElementById('chrome'))
  }
  if (!Engine.supported()) {
    canvas.remove()
    document.getElementById('loader')?.remove()
    renderFallback(track)
    return
  }
  const loader = createLoader(document.getElementById('loader')!, { skip: params.has('nointro') })

  const engine = new Engine(canvas, track, stages)
  // the GPU context is gone for good: show the static copy, not an empty canvas
  engine.onContextGone = () => {
    canvas.remove()
    stages?.remove()
    renderFallback(track)
  }
  engine.assets.onProgress = (done, total) => loader.progress(total ? done / total : 0)
  if (document.fonts?.ready) engine.assets.track(document.fonts.ready)
  await engine.load(CHAPTERS, params.get('only'))

  const sound = new Sound()
  const chrome = createChrome(document.getElementById('chrome')!, engine, sound)
  engine.onFrame.push((f, s) => {
    chrome.update(f, s)
    sound.update(f, s)
  })
  engine.onCut.push((a, b) => sound.cut(a, b))

  const p = params.get('p')
  const c = params.get('c')
  const hash = location.hash.slice(1)
  if (p) engine.goto(parseFloat(p))
  else if (c) engine.gotoChapter(c, parseFloat(params.get('l') ?? '0'))
  else if (hash && CHAPTERS.some(ch => ch.id === hash)) engine.land(hash, false)
  else engine.goto(0)

  engine.start()
  window.__hark = {
    ready: false,
    engine,
    goto: p => engine.goto(p),
    gotoChapter: (id, l = 0) => engine.gotoChapter(id, l),
    land: (id, smooth = true, local) => engine.land(id, smooth, local),
  }
  if (params.has('debug')) mountDebug(engine)

  await loader.finish()
  document.documentElement.dataset.ready = '1'
  window.dispatchEvent(new Event('hark:reveal'))
  window.__hark.ready = true
}

boot().catch(err => {
  console.error('[hark] boot failed', err)
  const track = document.getElementById('track')
  if (track) renderFallback(track)
  document.getElementById('loader')?.remove()
})
