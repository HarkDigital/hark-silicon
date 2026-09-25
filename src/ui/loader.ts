import { BRAND } from '../content'
import { holdInert, releaseInert } from './inert'
import { MARK_PATHS } from './mark'
import { mountRotateGate } from './rotate'
import { readMotion } from './motion'

/*
 * Boot screen: the Hark chip powers on.
 *
 * A black screen with a faint CAD grid and a tiny board drawn in white
 * silkscreen: an outline with four mounting holes, a power connector J1
 * with its status LED, the U1 footprint (gold pads, a pin-1 chamfer) and an
 * edge connector on the right. The boot runs like a chip's power-on self
 * test:
 *
 *   ~0.1 s   the POWER RAIL lights: a green signal races from J1 to U1 and
 *            the status LED comes on (steady; nothing here ever blinks)
 *   ~0.45 s  POST log: "VDD 1.8V ... OK", then "CLK 100 MHZ ... LOCK"
 *   then     "LOADING LEVELS ... n%" follows progress(), and the Hark mark
 *            etched on U1 is TRACED in signal green, loop by loop, as it loads
 *   finish() the signal completes the mark, the die lights (loops etched
 *            white, the diamond green), the data lines race out to the edge
 *            connector, "SIGNAL ... READY" — then an SEM beam sweeps down the
 *            screen and scans the loader away (~0.75 s), revealing the site
 *
 * Rules: shows at least ~1.2 s, never hangs (every wait is a timer, never an
 * animation or a frame callback, so a background tab still finishes), the
 * page behind is inert while it's up, and skip (?nointro) removes it at once.
 * Reduced motion (or Motion switched off earlier this session): the same
 * boot, but the exit is a quiet fade.
 *
 * The log and the board are decorative (aria-hidden); a polite status line
 * says "Loading Hark Digital Design".
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 */

const MIN_MS = 1200
/** how long the mark takes to close once finish() is called */
const CLOSE_MS = 480
/** the beam sweep (keep in step with ui.css) */
const SWEEP_MS = 760

const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))

/* ------------------------------------------------------------- the board */

// viewBox 0 0 360 220 · U1 body 132..228 x 58..154 (96 x 96), centre (180, 106)
const U1 = { x: 132, y: 58, s: 96 }
const MARK = { size: 60 }

function footprint() {
  const n = 10
  const pitch = 7.2
  const off = (U1.s - (n - 1) * pitch) / 2
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const o = off + i * pitch
    out.push(
      `<rect x="${(U1.x + o - 1.6).toFixed(1)}" y="${U1.y - 9}" width="3.2" height="6.5" rx="0.6"/>`,
      `<rect x="${(U1.x + o - 1.6).toFixed(1)}" y="${U1.y + U1.s + 2.5}" width="3.2" height="6.5" rx="0.6"/>`,
      `<rect x="${U1.x - 9}" y="${(U1.y + o - 1.6).toFixed(1)}" width="6.5" height="3.2" rx="0.6"/>`,
      `<rect x="${U1.x + U1.s + 2.5}" y="${(U1.y + o - 1.6).toFixed(1)}" width="6.5" height="3.2" rx="0.6"/>`,
    )
  }
  return out.join('')
}

/** pad centre on U1's right side, pin k (0 = top) */
const rightPin = (k: number) => U1.y + (U1.s - 9 * 7.2) / 2 + k * 7.2

function boardSvg() {
  const s = MARK.size / 1889.6
  const mx = 180 - MARK.size / 2
  const my = 106 - MARK.size / 2
  const loops = MARK_PATHS.loops
  const markPaths = (cls: string) =>
    loops.map(d => `<path class="${cls}" d="${d}"/>`).join('') + `<path class="${cls} ${cls}--dia" d="${MARK_PATHS.diamond}"/>`
  // data lines: from U1's right pads out to the edge connector's fingers
  const data = [2, 4, 5, 7]
    .map((k, i) => {
      const y0 = rightPin(k)
      const y1 = 78 + i * 20
      const x0 = U1.x + U1.s + 9
      const jog = Math.abs(y1 - y0)
      const xa = 262 + i * 6
      const dy = Math.sign(y1 - y0)
      return `M${x0} ${y0.toFixed(1)} H${xa} L${xa + jog} ${(y0 + dy * jog).toFixed(1)} H330`
    })
    .map(d => `<path class="ld-tr ld-tr--data" d="${d}"/>`)
    .join('')
  const fingers = [0, 1, 2, 3].map(i => `<rect x="330" y="${72 + i * 20}" width="18" height="12" rx="1"/>`).join('')
  const rail = `M34 62 H88 L106.8 80.8 H${U1.x - 9}`
  const gnd = `M34 78 H78 L95.2 95.2 H${U1.x - 9}`
  return `
  <svg class="ld-board" viewBox="0 0 360 220" aria-hidden="true" focusable="false">
    <defs>
      <filter id="ld-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="360" height="220">
        <feGaussianBlur stdDeviation="2.2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="ld-glow-mk" filterUnits="userSpaceOnUse" x="-300" y="-300" width="2500" height="2500">
        <feGaussianBlur stdDeviation="60" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <radialGradient id="ld-led-g">
        <stop offset="0" stop-color="#00ff85" stop-opacity="0.9"/>
        <stop offset="1" stop-color="#00ff85" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect class="ld-edge" x="4" y="4" width="352" height="212" rx="11"/>
    <g class="ld-holes">
      <circle cx="18" cy="18" r="5.5"/><circle cx="342" cy="18" r="5.5"/>
      <circle cx="18" cy="202" r="5.5"/><circle cx="342" cy="202" r="5.5"/>
    </g>
    <g class="ld-silk">
      <path d="M22 50 h18 v40 h-18 z"/>
      <path d="${`M${U1.x - 16} ${U1.y - 4} V${U1.y - 16} H${U1.x - 4}`}"/>
      <path d="${`M${U1.x + U1.s + 16} ${U1.y + U1.s + 4} V${U1.y + U1.s + 16} H${U1.x + U1.s + 4}`}"/>
      <path d="M324 64 h30 v84 h-30"/>
    </g>
    <g class="ld-txt">
      <text x="22" y="44">J1</text>
      <text x="44" y="58" class="ld-txt--s">VIN</text>
      <text x="44" y="96" class="ld-txt--s">GND</text>
      <text x="${U1.x - 16}" y="${U1.y - 20}">U1</text>
      <text x="180" y="${U1.y + U1.s + 30}" text-anchor="middle">HARK-1</text>
      <text x="322" y="58" text-anchor="end">J3</text>
      <text x="22" y="190" class="ld-txt--s">HK-0N</text>
      <text x="338" y="190" text-anchor="end" class="ld-txt--s">REV A</text>
      <text x="56" y="130" class="ld-txt--s">D1</text>
    </g>
    <g class="ld-cu">
      <path class="ld-tr" d="${rail}"/>
      <path class="ld-tr" d="${gnd}"/>
      ${data}
    </g>
    <g class="ld-sig" filter="url(#ld-glow)">
      <path class="ld-tr ld-dash ld-rail" d="${rail}"/>
      <path class="ld-tr ld-dash ld-rail" d="${gnd}"/>
      ${data.replace(/class="ld-tr ld-tr--data"/g, 'class="ld-tr ld-dash ld-data"')}
    </g>
    <g class="ld-j1"><rect x="26" y="56" width="10" height="12" rx="1"/><rect x="26" y="72" width="10" height="12" rx="1"/></g>
    <g class="ld-fingers">${fingers}</g>
    <g class="ld-led"><rect class="ld-led-pad" x="52" y="108" width="12" height="7" rx="1"/><circle class="ld-led-glow" cx="58" cy="111.5" r="10" fill="url(#ld-led-g)"/><rect class="ld-led-lens" x="54.5" y="109" width="7" height="5" rx="1"/></g>
    <g class="ld-pads">${footprint()}</g>
    <path class="ld-u1" d="M${U1.x + 8} ${U1.y} H${U1.x + U1.s} V${U1.y + U1.s} H${U1.x} V${U1.y + 8} Z"/>
    <circle class="ld-p1" cx="${U1.x + 10}" cy="${U1.y + 10}" r="2.2"/>
    <g class="ld-mk" transform="translate(${mx} ${my}) scale(${s.toFixed(6)})">
      <g class="ld-mk-fill">${markPaths('ld-mf')}</g>
      <g class="ld-mk-base">${markPaths('ld-mb')}</g>
      <g class="ld-mk-sig" filter="url(#ld-glow-mk)">${markPaths('ld-ms')}</g>
    </g>
  </svg>`
}

/* ------------------------------------------------------------ the loader */

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  // phones held sideways get the rotate card from the very first frame
  mountRotateGate()
  if (skip) {
    root.remove()
    return { progress() {}, finish: () => Promise.resolve() }
  }

  // reduced motion, or the visitor turned Motion off earlier this session
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || !readMotion(true)
  root.innerHTML = `
  <div class="ld${reduced ? ' is-reduced' : ''}">
    <p class="sr-only" role="status">Loading ${BRAND.name}</p>
    <div class="ld-core" aria-hidden="true">
      ${boardSvg()}
      <div class="ld-log">
        <p class="ld-l ld-l--head is-on"><span>HARK-1 · REV A</span><span>POST</span></p>
        <p class="ld-l" data-l="vdd"><span>VDD 1.8V</span><i></i><b>OK</b></p>
        <p class="ld-l" data-l="clk"><span>CLK 100 MHZ</span><i></i><b>LOCK</b></p>
        <p class="ld-l" data-l="lvl"><span>LOADING LEVELS</span><i></i><b class="ld-pct">0%</b></p>
        <p class="ld-l" data-l="sig"><span>SIGNAL</span><i></i><b>READY</b></p>
      </div>
    </div>
  </div>
  <i class="ld-beam" aria-hidden="true"></i>`
  holdInert('loader', [
    document.getElementById('track'),
    document.getElementById('stages'),
    document.getElementById('chrome'),
    document.querySelector<HTMLElement>('.skip-link'),
  ])

  const wrap = root.querySelector<HTMLElement>('.ld')!
  const pctEl = root.querySelector<HTMLElement>('.ld-pct')!
  const line = (k: string) => root.querySelector<HTMLElement>(`[data-l="${k}"]`)!
  const sig = [...root.querySelectorAll<SVGPathElement>('.ld-ms')]
  // every dashed stroke gets its real length (pathLength is uneven across engines)
  const lens = new Map<SVGPathElement, number>()
  for (const p of [...root.querySelectorAll<SVGPathElement>('.ld-dash'), ...sig]) {
    let L = 0
    try {
      L = p.getTotalLength()
    } catch {
      L = 0
    }
    if (!(L > 0)) L = 1000
    L = Math.ceil(L + 2)
    lens.set(p, L)
    p.style.strokeDasharray = `${L} ${L}`
    p.style.strokeDashoffset = String(L)
  }
  const light = (sel: string) =>
    root.querySelectorAll<SVGPathElement>(sel).forEach(p => {
      p.style.strokeDashoffset = '0'
    })

  const start = performance.now()
  const timers: number[] = []
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
  // the boot schedule (timers, so a background tab still gets there)
  at(90, () => {
    wrap.classList.add('is-power')
    light('.ld-rail')
  })
  at(430, () => {
    wrap.classList.add('is-vdd')
    line('vdd').classList.add('is-on')
  })
  at(640, () => line('clk').classList.add('is-on'))
  at(820, () => line('lvl').classList.add('is-on'))

  let target = 0
  let shown = 0
  let finishing = false
  let raf = 0
  let lastPct = -1
  let lastT = start

  const paint = (v: number) => {
    // the signal traces the etched mark as the levels load
    for (const p of sig) {
      const L = lens.get(p) ?? 1000
      p.style.strokeDashoffset = (L * (1 - v)).toFixed(1)
    }
    const pct = Math.round(v * 100)
    if (pct !== lastPct) {
      lastPct = pct
      pctEl.textContent = `${pct}%`
    }
  }

  // Cosmetic easing toward the real progress. Before finish() the trace may
  // only creep toward ~94% (fast at first, then ever slower), so the mark
  // always has time to draw and 100 always means "done".
  const step = (ms: number) => {
    raf = 0
    const dt = Math.min(0.1, Math.max(0, (ms - lastT) / 1000))
    lastT = ms
    // nothing counts until the levels line is up
    const since = ms - start - 820
    // an asymptote, so the count keeps inching on while the scene compiles
    const cap = finishing ? 1 : since <= 0 ? 0 : 0.94 * (1 - Math.exp(-since / 520))
    const goal = Math.min(finishing ? 1 : target, cap)
    shown += (goal - shown) * (1 - Math.exp(-dt * (finishing ? 10 : 5)))
    if (Math.abs(goal - shown) < 0.002) shown = goal
    paint(shown)
    if (!(finishing && shown >= 1)) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)

  return {
    progress(p: number) {
      const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
      target = Math.max(target, v)
    },
    async finish(): Promise<void> {
      const left = MIN_MS - (performance.now() - start)
      if (left > 0) await wait(left)
      // whatever the schedule reached, the whole POST is on screen now
      for (const t of timers) window.clearTimeout(t)
      wrap.classList.add('is-power', 'is-vdd')
      light('.ld-rail')
      for (const k of ['vdd', 'clk', 'lvl']) line(k).classList.add('is-on')
      // the signal completes the mark
      finishing = true
      target = 1
      if (!raf) raf = requestAnimationFrame(step)
      await wait(reduced ? 140 : CLOSE_MS * 0.6)
      // the die lights, the data lines race out, SIGNAL READY
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      paint(1)
      wrap.classList.add('is-done')
      light('.ld-data')
      line('sig').classList.add('is-on')
      await wait(reduced ? 200 : CLOSE_MS)
      // the beam scans the loader away; the page wakes as it starts
      root.classList.add('is-out')
      releaseInert('loader')
      window.setTimeout(() => root.remove(), (reduced ? 360 : SWEEP_MS) + 140)
      // hand over a beat into the sweep, so the hero's reveal rides it
      await wait(reduced ? 60 : 160)
    },
  }
}
