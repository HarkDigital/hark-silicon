import { SITE } from '../content'
import { MARK_SVG } from '../logo/svgSource'

/*
 * The Hark mark as inline-SVG path data for the DOM layer (chrome + loader).
 * Pulled from the same Illustrator source the 3D geometry uses, minus the
 * three hairline slivers. The rotated <rect> diamond is baked into a plain
 * path so it can be stroked / dash-animated like the loops.
 */

export const MARK_VIEWBOX = '0 0 1889.6 1889.9'

function parseMark() {
  const loops = [...MARK_SVG.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]).filter(d => d.length > 200)

  // <rect x y w h transform="translate(tx ty) rotate(-45)">
  const r = MARK_SVG.match(
    /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)"/,
  )
  let diamond = ''
  if (r) {
    const [x, y, w, h, tx, ty, deg] = r.slice(1).map(Number)
    const a = (deg * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const pts = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ].map(([px, py]) => [px * c - py * s + tx, px * s + py * c + ty])
    diamond = `M${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}Z`
  }
  return { loops, diamond }
}

export const MARK_PATHS = parseMark()

/**
 * The real wordmark, "Hark.Digital" (BRAND.short): the dot is a tiny signal
 * green LED. The period stays in the markup (clipped) so copy/paste and
 * find-in-page still read "Hark.Digital". Styled by the .wm rules in ui.css.
 */
export const WORDMARK = `<span class="wm"><span class="wm-a">Hark</span><span class="wm-dot">.</span><span class="wm-b">Digital</span></span>`

/** This site is a concept direction, not a rebrand: a small tag, never part of the name. */
export const CONCEPT_TAG = `<span class="wm-tag"><span class="wm-tag-k">Concept</span><b aria-hidden="true">·</b><em>${SITE.name}</em></span>`

/**
 * Inline SVG markup for the mark. Loops fill with currentColor; the diamond
 * gets its own class so CSS can light it in signal green.
 */
export function markSvg(className = '', { title }: { title?: string } = {}) {
  const a11y = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true" focusable="false"'
  return `<svg class="${className}" viewBox="${MARK_VIEWBOX}" ${a11y} xmlns="http://www.w3.org/2000/svg">${MARK_PATHS.loops
    .map(d => `<path class="mk-loop" d="${d}"/>`)
    .join('')}<path class="mk-diamond" d="${MARK_PATHS.diamond}"/></svg>`
}
