import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'

/*
 * Sound (THEME: every concept composes its own generative WebAudio score —
 * Orbit a space pad, Resonance a studio room + real cymatics tones, Press
 * print-shop foley, Town birdsong + marimba, Arcade chiptune).
 *
 * Keep the API: enabled, onChange, toggle(), update(), cut(), blip(), tone().
 * Rules: off by default; audio only starts from a real gesture (click, tap,
 * Enter/Space — never Tab); remember the preference in localStorage (try/
 * catch); set navigator.audioSession.type = 'playback' when enabling (iOS
 * silent switch); mute while the tab is hidden; keep levels tasteful.
 *
 * This neutral version: a soft blip on toggle/nav and a gentle cut whoosh.
 */
const KEY = 'hark:sound'

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []
  private ctx: AudioContext | null = null
  private master: GainNode | null = null

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) this.ctx.suspend().catch(() => {})
      else if (this.enabled) this.ctx.resume().catch(() => {})
    })
  }

  /** was sound on last visit? (it still needs a gesture to start) */
  get remembered() {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  }

  /** call from a click / key handler */
  toggle() {
    this.enabled = !this.enabled
    try {
      localStorage.setItem(KEY, this.enabled ? '1' : '0')
    } catch {
      /* storage blocked */
    }
    if (this.enabled) this.start()
    else this.ctx?.suspend().catch(() => {})
    for (const fn of this.onChange) fn(this.enabled)
    if (this.enabled) this.blip(2)
  }

  private start() {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = 'playback'
    } catch {
      /* not supported */
    }
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
    }
    this.ctx.resume().catch(() => {})
  }

  update(_frame: Frame, _state: EngineState) {}

  cut(_from: number, _to: number) {
    if (!this.enabled || !this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(220, t)
    o.frequency.exponentialRampToValueAtTime(90, t + 0.5)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.65)
  }

  blip(pitch = 0) {
    if (!this.enabled || !this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'triangle'
    o.frequency.value = 660 * Math.pow(2, pitch / 12)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.2)
  }

  tone(_hz: number, _level: number) {}
}
