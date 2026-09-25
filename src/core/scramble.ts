// Decoding-text effect for HUD labels (the igloo.inc "signal resolving" look).

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>_-:.'
const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0]

/**
 * Render `text` resolved up to `t` (0..1). Unresolved characters show random
 * glyphs; spaces stay spaces. Deterministic in `t` except for the glyphs, so
 * it works for scroll-driven reveals.
 */
export function scrambleAt(text: string, t: number): string {
  if (t >= 1) return text
  if (t <= 0) return text.replace(/\S/g, ' ')
  const n = text.length
  const resolved = Math.floor(t * n)
  const noisy = Math.min(n, resolved + Math.max(3, Math.floor(n * 0.25)))
  let out = ''
  for (let i = 0; i < n; i++) {
    const ch = text[i]
    if (ch === ' ' || ch === '\n') out += ch
    else if (i < resolved) out += ch
    else if (i < noisy) out += pick()
    else out += ' '
  }
  return out
}

/**
 * Time-based scramble bound to one element. `play(text)` decodes into the new
 * text; calling again mid-animation retargets smoothly.
 */
export class Scramble {
  private raf = 0
  private text = ''
  constructor(
    public el: HTMLElement,
    initial = '',
  ) {
    this.text = initial
    if (initial) el.textContent = initial
  }

  play(text: string, { duration = 0.7, delay = 0 } = {}) {
    if (text === this.text && !this.raf) return
    this.text = text
    cancelAnimationFrame(this.raf)
    const start = performance.now() + delay * 1000
    const tick = (now: number) => {
      const t = (now - start) / (duration * 1000)
      if (t < 0) {
        this.raf = requestAnimationFrame(tick)
        return
      }
      this.el.textContent = scrambleAt(text, t)
      if (t < 1) this.raf = requestAnimationFrame(tick)
      else this.raf = 0
    }
    this.raf = requestAnimationFrame(tick)
  }

  /** Scroll-driven: show the text resolved to t. */
  at(text: string, t: number) {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.text = text
    const s = scrambleAt(text, t)
    if (this.el.textContent !== s) this.el.textContent = s
  }

  clear() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.text = ''
    this.el.textContent = ''
  }
}
