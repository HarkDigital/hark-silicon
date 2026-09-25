/*
 * roundRect() for canvas paths — Safari < 16 and Firefox < 112 lack it, and
 * several chapters draw rounded print art with it. Installed once at boot.
 */
type RR = (x: number, y: number, w: number, h: number, r?: number | DOMPointInit | (number | DOMPointInit)[]) => void

function radius(r: unknown): number {
  if (typeof r === 'number') return r
  if (r && typeof (r as Iterable<unknown>)[Symbol.iterator] === 'function') {
    const f = [...(r as Iterable<number | DOMPointInit>)][0]
    return typeof f === 'number' ? f : (f?.x ?? 0)
  }
  return (r as DOMPointInit | undefined)?.x ?? 0
}

function install(proto: { roundRect?: RR } & CanvasPath) {
  if (typeof proto.roundRect === 'function') return
  proto.roundRect = function (this: CanvasPath, x, y, w, h, r = 0) {
    const rr = Math.max(0, Math.min(radius(r), Math.abs(w) / 2, Math.abs(h) / 2))
    this.moveTo(x + rr, y)
    this.arcTo(x + w, y, x + w, y + h, rr)
    this.arcTo(x + w, y + h, x, y + h, rr)
    this.arcTo(x, y + h, x, y, rr)
    this.arcTo(x, y, x + w, y, rr)
    this.closePath()
  }
}

export function installPrintPolyfills() {
  try {
    if (typeof CanvasRenderingContext2D !== 'undefined') install(CanvasRenderingContext2D.prototype as never)
    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') install(OffscreenCanvasRenderingContext2D.prototype as never)
    if (typeof Path2D !== 'undefined') install(Path2D.prototype as never)
  } catch {
    /* best-effort */
  }
}
