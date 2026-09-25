import * as THREE from 'three'

/** Tiny element factory: el('div', 'hud-label', 'TEXT') */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  if (parent) parent.appendChild(node)
  return node
}

/**
 * Set opacity + a small translate from a 0..1 visibility value (cheap, no
 * layout). With dy = 0 only opacity/visibility are touched, so the node's own
 * CSS/JS transform is left alone.
 */
export function reveal(node: HTMLElement, v: number, dy = 14) {
  const o = Math.max(0, Math.min(1, v))
  const s = o.toFixed(3)
  if (node.style.opacity !== s) {
    node.style.opacity = s
    if (dy !== 0) node.style.transform = `translate3d(0, ${((1 - o) * dy).toFixed(2)}px, 0)`
    node.style.visibility = o < 0.002 ? 'hidden' : 'visible'
  }
}

const _v = new THREE.Vector3()

/**
 * A HUD callout pinned to a 3D point: a dot at the point, an elbow leader
 * line, and a label box. Lives in the chapter's stage element.
 *
 *   const c = new Callout(stage, { side: 'right' })
 *   c.label.textContent = 'PORTFOLIO_01'
 *   // each frame:
 *   c.update(worldPos, camera, frame.width, frame.height, visibility)
 */
export class Callout {
  root: HTMLDivElement
  label: HTMLDivElement
  private svg: SVGSVGElement
  private path: SVGPathElement
  private dot: HTMLDivElement
  side: 'left' | 'right'
  offset: { x: number; y: number }
  private lw = 0

  constructor(
    parent: HTMLElement,
    { side = 'right', offset = { x: 90, y: -60 } }: { side?: 'left' | 'right'; offset?: { x: number; y: number } } = {},
  ) {
    this.side = side
    this.offset = offset
    this.root = el('div', 'callout', undefined, parent)
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'callout-svg')
    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.svg.appendChild(this.path)
    this.root.appendChild(this.svg)
    this.dot = el('div', 'callout-dot', undefined, this.root)
    this.label = el('div', 'callout-label', undefined, this.root)
    // measure the label only when it actually changes size (no per-frame layout reads)
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(entries => {
        for (const e of entries) this.lw = (e.target as HTMLElement).offsetWidth
      }).observe(this.label)
    }
  }

  /** Returns false when the point is behind the camera. */
  update(world: THREE.Vector3, camera: THREE.Camera, w: number, h: number, visibility = 1): boolean {
    _v.copy(world).project(camera)
    const behind = _v.z > 1
    const x = (_v.x * 0.5 + 0.5) * w
    const y = (-_v.y * 0.5 + 0.5) * h
    // before the first real frame the camera matrices can be degenerate
    const valid = Number.isFinite(x) && Number.isFinite(y)
    const vis = behind || !valid ? 0 : visibility
    reveal(this.root, vis, 0)
    if (vis <= 0) return !behind && valid
    const lw = this.lw || (this.lw = this.label.offsetWidth)
    // flip to the other side rather than run off the edge of the screen
    const margin = 12
    let side = this.side
    if (side === 'right' && x + this.offset.x + 8 + lw > w - margin) side = 'left'
    else if (side === 'left' && x - this.offset.x - 8 - lw < margin) side = 'right'
    const dx = side === 'right' ? this.offset.x : -this.offset.x
    const lx = x + dx
    const ly = y + this.offset.y
    const elbow = x + dx * 0.35
    // offsets computed by chapters before first layout can be NaN — never write them
    if (!Number.isFinite(lx + ly + elbow + lw)) {
      reveal(this.root, 0, 0)
      return true
    }
    this.path.setAttribute('d', `M${x},${y} L${elbow},${ly} L${lx},${ly}`)
    this.dot.style.transform = `translate3d(${x}px, ${y}px, 0)`
    const labelX = side === 'right' ? lx + 8 : lx - 8 - lw
    this.label.style.transform = `translate3d(${Math.max(margin, Math.min(w - margin - lw, labelX))}px, ${ly - 10}px, 0)`
    return true
  }
}

/**
 * Editorial word-rise reveal (Resonance's text motion — replaces scrambles).
 *
 *   const h = rise(el('h2', 'hud-h2', undefined, stage), 'Built to be <em>heard.</em>')
 *   setRise(h, local > 0.1 && local < 0.4)   // each frame; cheap, idempotent
 *
 * Words slide up out of a clip with a slight stagger when `is-in` is set and
 * sink back when it's removed. Settles in ~0.6s; text is always exact.
 * `html` may contain <em>/<br>; other markup is stripped to text.
 */
export function rise<T extends HTMLElement>(node: T, html: string): T {
  node.classList.add('rise')
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  let i = 0
  const out: string[] = []
  const walk = (n: Node, wrapEm: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const parts = (n.textContent ?? '').split(/(\s+)/)
      for (const p of parts) {
        if (!p) continue
        if (/^\s+$/.test(p)) out.push(' ')
        else {
          const w = p.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
          out.push(`<span class="rise-w" style="--i:${i++}"><span>${wrapEm ? `<em>${w}</em>` : w}</span></span>`)
        }
      }
    } else if (n.nodeName === 'BR') out.push('<br>')
    else n.childNodes.forEach(c => walk(c, wrapEm || n.nodeName === 'EM'))
  }
  tmp.childNodes.forEach(c => walk(c, false))
  node.innerHTML = out.join('')
  node.setAttribute('aria-label', tmp.textContent ?? '')
  return node
}

/** Toggle a rise() element in/out (no-op when unchanged). */
export function setRise(node: HTMLElement, on: boolean) {
  if (node.classList.contains('is-in') !== on) node.classList.toggle('is-in', on)
}
