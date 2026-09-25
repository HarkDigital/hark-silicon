import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'
import { CHAPTERS } from '../chapters/index'

/*
 * Hark Silicon sound: a board, powered (WebAudio, no files).
 *
 *   hum      the warm "powered" hum: a four-voice pad of soft sines, each
 *            doubled by a quiet triangle a few cents off, through a gentle
 *            low-pass, over a faint sub an octave below the root. Two banks
 *            crossfade when the harmony changes, so a new chapter settles in
 *            over ~2 s. Each voice breathes on its own slow swell.
 *   ticks    DATA: sparse, tiny high sine blips arpeggiating the chapter's
 *            chord three octaves up. At rest one every couple of seconds;
 *            scrolling speeds them up (the bus gets busy), and they walk up
 *            the chord while you scroll down and back down when you scroll up.
 *   fan      a faint filtered-noise bed (a cooling fan across the room) that
 *            spins up a touch while you scroll.
 *   modes    each chapter shifts the harmony:
 *              hero      Package   A, open fifths (idle, powered)
 *              work      Board     D, calm
 *              services  Die       E major 7, brighter, busier
 *              voices    Wafer     F, warm and low
 *              shield    Surge     tense (tritone + b9, darker filter) that
 *                                  RESOLVES to C# major as the chapter settles
 *              process   Fab       G, steady
 *              contact   Power On  C, high and bright
 *   cut()    the SEM beam: a quick band-passed noise sweep falling down the
 *            spectrum, and a soft relay click as the frame swaps
 *   blip()   a tiny tick (nav, buttons), pitched up the chord
 *   tone()   a pure sine a chapter may ask for (also via 'hark:tone' events)
 *
 * Off by default. Sound only ever starts from a user gesture: the toggle's
 * own click / tap / Enter / Space. A remembered "on" (localStorage) waits for
 * the first real activation (a click or tap, or Enter / Space on a control;
 * never Tab, Shift, arrows or scrolling). Faded out and suspended while the
 * tab is hidden. On iOS the session is switched to "playback" so the silent
 * switch doesn't swallow it. Everything is kept low: the master sits well
 * under full scale and a gentle compressor glues it.
 */

export const STORE_KEY = 'hark-silicon:audio'

/** The remembered choice: true (on), false (off), or null when never set. */
export function storedAudio(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'
const MASTER_LEVEL = 0.8
const TONE_MAX = 0.05

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

interface Mode {
  /** MIDI root of the hum */
  root: number
  /** pad chord, semitones from root (four voices) */
  pad: number[]
  /** chord tones the data ticks walk through (semitones above root + 36) */
  arp: number[]
  /** pad low-pass cutoff (Hz) */
  cutoff: number
  /** pad level multiplier */
  level: number
  /** seconds between ticks at rest */
  rest: number
}

const MODES: Record<string, Mode> = {
  hero: { root: 45, pad: [0, 7, 12, 19], arp: [0, 7, 12, 14, 19, 24], cutoff: 760, level: 1, rest: 2.2 },
  work: { root: 50, pad: [0, 7, 12, 16], arp: [0, 4, 7, 12, 16, 19], cutoff: 820, level: 0.95, rest: 1.9 },
  services: { root: 52, pad: [0, 7, 11, 16], arp: [0, 4, 7, 11, 14, 16, 19], cutoff: 1050, level: 0.85, rest: 1.3 },
  voices: { root: 41, pad: [0, 7, 16, 21], arp: [0, 4, 7, 9, 12, 16], cutoff: 640, level: 1.1, rest: 2.6 },
  shield: { root: 49, pad: [0, 6, 10, 13], arp: [0, 1, 6, 10, 13, 18], cutoff: 560, level: 1, rest: 1.6 },
  process: { root: 43, pad: [0, 7, 12, 14], arp: [0, 2, 7, 9, 12, 14], cutoff: 800, level: 1, rest: 1.8 },
  contact: { root: 48, pad: [0, 7, 11, 16], arp: [0, 4, 7, 11, 12, 16, 19, 23], cutoff: 1400, level: 0.9, rest: 1.5 },
}
/** Surge, once it settles: the tension resolves to a major chord */
const SHIELD_RESOLVED: Mode = { ...MODES.shield, pad: [0, 7, 12, 16], arp: [0, 4, 7, 12, 16, 19], cutoff: 900, rest: 2 }

const VOICE_GAIN = [0.03, 0.022, 0.017, 0.012]

interface Bank {
  out: GainNode
  voices: { a: OscillatorNode; b: OscillatorNode }[]
  sub: OscillatorNode
}

function setAudioSession(type: 'playback' | 'auto') {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = type
  } catch {
    /* not supported */
  }
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private dry!: GainNode
  private padFilter!: BiquadFilterNode
  private banks: Bank[] = []
  private bankOn = 0
  private tickBus!: GainNode
  private fanGain!: GainNode
  private fanFilter!: BiquadFilterNode
  private noise!: AudioBuffer
  private toneOsc!: OscillatorNode
  private toneGain!: GainNode

  // story state
  private chapter = 'hero'
  private mode: Mode = MODES.hero
  private modeKey = ''
  private resolved = false
  private cutoff = MODES.hero.cutoff
  private lastFilterAt = 0
  private busy = 0

  private nextTick = 0
  private arpStep = 0
  private lastCut = 0
  private lastBlip = 0
  private suspendTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" preference waiting for the first user gesture */
  private armed = false
  private gestureBound = false

  // requested pure tone (kept even while muted so it applies the moment sound starts)
  private toneHz = 440
  private toneLevel = 0

  constructor() {
    this.armed = storedAudio() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
  }

  /** was sound on last visit? (it still needs a gesture to start) */
  get remembered() {
    return storedAudio() === true
  }

  /** Flip sound on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    this.persist(this.enabled)
  }

  /** Follow the story: which chapter is playing, how fast the visitor scrolls. */
  update(frame: Frame, state: EngineState) {
    const slot = state.slots[state.index]
    if (!slot) return
    const id = slot.def.id
    if (id !== this.chapter) this.chapter = id
    // Surge: hold the tension, then resolve once the chapter settles (with hysteresis)
    if (id === 'shield') {
      if (!this.resolved && state.local > 0.62) this.resolved = true
      else if (this.resolved && state.local < 0.5) this.resolved = false
    } else this.resolved = false
    const ctx = this.live()
    if (!ctx) return
    const key = id === 'shield' && this.resolved ? 'shield+' : id
    if (key !== this.modeKey) this.setMode(key, ctx)

    const now = ctx.currentTime
    const v = Math.abs(frame.velocity || 0)
    const busy = smooth(0.04, 1.6, v)
    this.busy += (busy - this.busy) * Math.min(1, frame.dt * 6)

    // scrolling opens the hum a touch and spins the fan up; both settle at rest
    if (now - this.lastFilterAt > 0.12) {
      this.lastFilterAt = now
      const target = this.mode.cutoff * (1 + this.busy * 0.45)
      if (Math.abs(target - this.cutoff) > 10) {
        this.cutoff = target
        this.padFilter.frequency.setTargetAtTime(target, now, 0.35)
      }
      this.fanGain.gain.setTargetAtTime(0.009 + this.busy * 0.008, now, 0.5)
    }

    // data ticks: sparse at rest, a busy bus while scrolling
    const interval = this.mode.rest * (1 - this.busy) + 0.085 * this.busy
    if (now + interval < this.nextTick) this.nextTick = now + interval
    if (now >= this.nextTick) {
      const dir = (frame.velocity || 0) < -0.02 ? -1 : 1
      this.tick(ctx, now + 0.01, dir, 0.55 + this.busy * 0.45)
      // at rest, now and then a two-word burst
      if (this.busy < 0.2 && Math.random() < 0.22) this.tick(ctx, now + 0.075, dir, 0.4)
      this.nextTick = now + interval * (0.75 + Math.random() * 0.5)
    }
  }

  /** The SEM beam sweeping the frame: a falling filtered sweep and a soft relay click. */
  cut(_from: number, to: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastCut < 0.35) return
    this.lastCut = now
    // the beam: band-passed noise falling from bright to dark
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 5
    bp.frequency.setValueAtTime(5200, now)
    bp.frequency.exponentialRampToValueAtTime(420, now + 0.34)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.045, now + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38)
    src.connect(bp).connect(g).connect(this.dry)
    src.start(now, Math.random() * 1.5, 0.42)
    // the swap: a soft click, then one tick in the key of the chapter we arrive in
    this.click(ctx, now + 0.2, 0.05)
    const m = MODES[CHAPTERS[to]?.id ?? ''] ?? this.mode
    this.ping(ctx, now + 0.26, m.root + 36 + m.arp[2 % m.arp.length], 0.028, 0.09, 0)
  }

  /** A tiny tick (nav, buttons). `pitch` steps up the chord. No-op while off. */
  blip(pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < 0.05) return
    this.lastBlip = now
    const p = Math.max(0, Math.round(pitch))
    const arp = this.mode.arp
    const semi = arp[p % arp.length] + 12 * Math.floor(p / arp.length)
    this.ping(ctx, now, this.mode.root + 36 + semi, 0.032, 0.05, 0)
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /* ------------------------------------------------------------ internals */

  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private persist(on: boolean) {
    try {
      localStorage.setItem(STORE_KEY, on ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[hark] audio unavailable', err)
      }
    }
    this.applyRunning(true)
    for (const fn of this.onChange) fn(on)
  }

  /** Resume + fade in, or fade out + suspend, based on enabled/hidden. */
  private applyRunning(greet = false) {
    const ctx = this.ctx
    if (!ctx) return
    clearTimeout(this.suspendTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, greet ? 0.25 : 0.5)
          this.modeKey = ''
          this.setMode(this.chapter === 'shield' && this.resolved ? 'shield+' : this.chapter, ctx)
          this.applyTone()
          if (greet) {
            // power on: the hum's filter opens from dark, three rising ticks
            this.padFilter.frequency.cancelScheduledValues(t)
            this.padFilter.frequency.setValueAtTime(160, t)
            this.padFilter.frequency.setTargetAtTime(this.mode.cutoff, t + 0.05, 0.45)
            const r = this.mode.root + 36
            this.ping(ctx, t + 0.04, r + this.mode.arp[0], 0.03, 0.06, -0.2)
            this.ping(ctx, t + 0.12, r + this.mode.arp[1], 0.03, 0.06, 0)
            this.ping(ctx, t + 0.2, r + this.mode.arp[2], 0.034, 0.09, 0.2)
            this.nextTick = t + 2.4
          } else this.nextTick = t + 0.8
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.16)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 1000,
      )
    }
  }

  /** Start audio on the first real gesture (remembered preference / blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    let sx = 0
    let sy = 0
    const events = ['click', 'keydown', 'touchstart', 'touchend'] as const
    const handler = (e: Event) => {
      if (e.type === 'touchstart') {
        const t = (e as TouchEvent).touches[0]
        if (t) {
          sx = t.clientX
          sy = t.clientY
        }
        return
      }
      if (e.type === 'touchend') {
        // a tap, not a scroll or a swipe
        const t = (e as TouchEvent).changedTouches[0]
        if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 12) return
      }
      // keyboard: only Enter / Space aimed at a control counts as "play"; Tab,
      // Shift+Tab, arrows, PageDown and Space-to-scroll are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, { capture: true, passive: true })
  }

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx

    // master -> high-pass -> gentle glue compression -> out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 38
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -22
    comp.knee.value = 18
    comp.ratio.value = 3
    comp.attack.value = 0.008
    comp.release.value = 0.25
    this.master.connect(hp)
    hp.connect(comp)
    comp.connect(ctx.destination)

    this.dry = ctx.createGain()
    this.dry.connect(this.master)
    this.noise = noiseBuffer(ctx, 3)

    // the hum: two banks of four voices (+ a sub), crossfaded on chord changes
    this.padFilter = ctx.createBiquadFilter()
    this.padFilter.type = 'lowpass'
    this.padFilter.frequency.value = this.cutoff
    this.padFilter.Q.value = 0.6
    this.padFilter.connect(this.dry)

    const now = ctx.currentTime
    for (let b = 0; b < 2; b++) {
      const out = ctx.createGain()
      out.gain.value = 0
      out.connect(this.padFilter)
      const voices: Bank['voices'] = []
      for (let v = 0; v < 4; v++) {
        const vg = ctx.createGain()
        const base = VOICE_GAIN[v]
        vg.gain.value = base
        // each voice breathes on its own slow swell
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.045 + v * 0.021 + b * 0.009
        const depth = ctx.createGain()
        depth.gain.value = base * 0.45
        lfo.connect(depth).connect(vg.gain)
        lfo.start(now + v * 0.6)
        const a = ctx.createOscillator()
        const t = ctx.createOscillator()
        a.type = 'sine'
        t.type = 'triangle'
        t.detune.value = 4 + v
        a.frequency.value = 110
        t.frequency.value = 110
        const tg = ctx.createGain()
        tg.gain.value = 0.32
        a.connect(vg)
        t.connect(tg).connect(vg)
        vg.connect(out)
        a.start(now)
        t.start(now)
        voices.push({ a, b: t })
      }
      // the sub: the powered hum under everything
      const sub = ctx.createOscillator()
      sub.type = 'sine'
      sub.frequency.value = 55
      const sg = ctx.createGain()
      sg.gain.value = 0.02
      sub.connect(sg).connect(out)
      sub.start(now)
      this.banks.push({ out, voices, sub })
    }

    // data ticks bus
    this.tickBus = ctx.createGain()
    this.tickBus.gain.value = 1
    this.tickBus.connect(this.dry)

    // the fan: a soft pink-ish noise bed, low-passed, slowly drifting
    const fan = ctx.createBufferSource()
    fan.buffer = pinkBuffer(ctx, 4)
    fan.loop = true
    // the buffer's head is pre-blended with its last 50 ms: loop short of them
    fan.loopStart = 0
    fan.loopEnd = fan.buffer.duration - 0.05
    this.fanFilter = ctx.createBiquadFilter()
    this.fanFilter.type = 'lowpass'
    this.fanFilter.frequency.value = 620
    this.fanFilter.Q.value = 0.5
    const fanHp = ctx.createBiquadFilter()
    fanHp.type = 'highpass'
    fanHp.frequency.value = 140
    this.fanGain = ctx.createGain()
    this.fanGain.gain.value = 0.009
    const drift = ctx.createOscillator()
    drift.frequency.value = 0.06
    const driftDepth = ctx.createGain()
    driftDepth.gain.value = 110
    drift.connect(driftDepth).connect(this.fanFilter.frequency)
    drift.start(now)
    fan.connect(fanHp).connect(this.fanFilter).connect(this.fanGain).connect(this.dry)
    fan.start(now)

    // requested pure tone
    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain).connect(this.dry)
    this.toneOsc.start(now)
  }

  /** Load a chapter's chord into the idle bank and crossfade to it. */
  private setMode(key: string, ctx: AudioContext) {
    this.modeKey = key
    const m = key === 'shield+' ? SHIELD_RESOLVED : (MODES[key] ?? MODES.hero)
    this.mode = m
    this.arpStep = 0
    if (!this.banks.length) return
    const now = ctx.currentTime
    const incoming = this.banks[1 - this.bankOn]
    const outgoing = this.banks[this.bankOn]
    this.bankOn = 1 - this.bankOn
    incoming.voices.forEach((v, i) => {
      const f = mtof(m.root + m.pad[i])
      // the idle bank is (nearly) silent: a short glide hides any retune
      for (const o of [v.a, v.b]) {
        o.frequency.cancelScheduledValues(now)
        o.frequency.setTargetAtTime(f, now, 0.04)
      }
    })
    incoming.sub.frequency.cancelScheduledValues(now)
    incoming.sub.frequency.setTargetAtTime(mtof(m.root - 12), now, 0.04)
    incoming.out.gain.cancelScheduledValues(now)
    incoming.out.gain.setValueAtTime(incoming.out.gain.value, now)
    incoming.out.gain.setTargetAtTime(m.level, now + 0.08, 0.8)
    outgoing.out.gain.cancelScheduledValues(now)
    outgoing.out.gain.setValueAtTime(outgoing.out.gain.value, now)
    outgoing.out.gain.setTargetAtTime(0, now, 0.6)
    this.cutoff = m.cutoff
    this.padFilter.frequency.setTargetAtTime(m.cutoff, now, 0.7)
  }

  /** One data tick: the next chord tone, walking with the scroll direction. */
  private tick(ctx: AudioContext, t: number, dir: number, vel: number) {
    const arp = this.mode.arp
    const n = arp.length
    this.arpStep = (((this.arpStep + dir) % n) + n) % n
    const pan = (this.arpStep / Math.max(1, n - 1) - 0.5) * 0.7
    this.ping(ctx, t, this.mode.root + 36 + arp[this.arpStep], 0.02 * vel, 0.045 + Math.random() * 0.03, pan)
  }

  /** A short, pure sine blip with a click-free envelope. */
  private ping(ctx: AudioContext, t: number, midi: number, level: number, decay: number, pan: number) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = mtof(midi)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    let node: AudioNode = g
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, pan))
      g.connect(p)
      node = p
    }
    o.connect(g)
    node.connect(this.tickBus)
    o.start(t)
    o.stop(t + decay + 0.02)
    o.onended = () => {
      o.disconnect()
      node.disconnect()
      if (node !== g) g.disconnect()
    }
  }

  /** A soft relay click: a few milliseconds of high-passed noise. */
  private click(ctx: AudioContext, t: number, level: number) {
    const s = ctx.createBufferSource()
    s.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2400
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.0015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.022)
    s.connect(hp).connect(g).connect(this.dry)
    s.start(t, Math.random() * 2, 0.03)
    s.onended = () => g.disconnect()
  }

  private applyTone() {
    const ctx = this.ctx
    if (!ctx || !this.toneOsc) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.05)
    this.toneGain.gain.setTargetAtTime(this.enabled ? this.toneLevel * TONE_MAX : 0, now, 0.12)
  }
}

/* ----------------------------------------------------------------- buffers */

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/** Pink-ish noise (Paul Kellet's economy filter), with the loop seam crossfaded. */
function pinkBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18
  }
  // blend the last 50 ms into the head; the source loops short of them, so the
  // seam (tail -> head) continues exactly where the blend began: no click
  const fade = Math.floor(ctx.sampleRate * 0.05)
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[i] = d[i] * k + d[len - fade + i] * (1 - k)
  }
  return buf
}
