/*
 * Shared, reference-counted `inert` for page layers. The loader, the mobile
 * menu sheet and the phone-landscape rotate card can all hold the same layer
 * (say #stages); a layer only wakes up once every holder has let go, and
 * anything that was already inert before the first hold is left exactly as
 * it was.
 *
 * Browsers without `inert` (Safari 15.0–15.4, Firefox < 112) get a fallback
 * with the same effect: held layers are aria-hidden (so a screen reader's
 * virtual cursor skips them), Tab / Shift+Tab walk only the focusables
 * outside every held layer, and focus that still lands inside one (a click,
 * a script, assistive tech) is moved back out. A dialog's own Tab trap runs
 * first (window, capture phase) and wins; this one only moves focus when
 * nothing else has handled the key.
 */

const NATIVE = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype

interface Hold {
  keys: Set<string>
  was: boolean
  /** fallback only: the layer's own aria-hidden before the first hold */
  aria: string | null
}

const holders = new Map<HTMLElement, Hold>()

export function holdInert(key: string, els: Iterable<HTMLElement | null | undefined>) {
  for (const el of els) {
    if (!el) continue
    let h = holders.get(el)
    if (!h) {
      h = { keys: new Set(), was: el.inert === true, aria: el.getAttribute('aria-hidden') }
      holders.set(el, h)
      if (!NATIVE) {
        el.setAttribute('aria-hidden', 'true')
        installGuard()
      }
    }
    h.keys.add(key)
    el.inert = true
  }
  // native inert blurs a focused element inside a new inert subtree; match it
  if (!NATIVE) {
    const a = document.activeElement
    if (a instanceof HTMLElement && isHeld(a)) a.blur()
  }
}

export function releaseInert(key: string) {
  for (const [el, h] of holders) {
    if (!h.keys.delete(key) || h.keys.size) continue
    el.inert = h.was
    if (!NATIVE) {
      if (h.aria == null) el.removeAttribute('aria-hidden')
      else el.setAttribute('aria-hidden', h.aria)
    }
    holders.delete(el)
  }
}

/* ------------------------------------------------------------ fallback */

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]'

function isHeld(node: Node) {
  for (const el of holders.keys()) if (el.contains(node)) return true
  return false
}

/** everything Tab could reach right now, outside the held layers, in document order */
function tabbables() {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => {
    if (el.tabIndex < 0 || isHeld(el)) return false
    if (!el.getClientRects().length) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  })
}

let guarded = false
function installGuard() {
  if (guarded) return
  guarded = true

  // Tab / Shift+Tab: step through the focusables outside the held layers.
  // Bubble phase on window, so a dialog's own trap (capture) goes first.
  window.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !holders.size) return
    const list = tabbables()
    e.preventDefault()
    if (!list.length) return
    const a = document.activeElement as HTMLElement | null
    const i = a ? list.indexOf(a) : -1
    let next: number
    if (i >= 0) next = e.shiftKey ? (i === 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1
    else if (a && a !== document.body) {
      // focus sits on something untabbable (a dialog, main): carry on from its place in the page
      const after = list.findIndex(el => a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      next = e.shiftKey ? (after <= 0 ? list.length - 1 : after - 1) : after < 0 ? 0 : after
    } else next = e.shiftKey ? list.length - 1 : 0
    list[next].focus()
  })

  // focus that still lands in a held layer is moved out, before the layer
  // reacts to it (capture on window runs ahead of the layer's own focusin)
  window.addEventListener(
    'focusin',
    e => {
      const t = e.target
      if (!holders.size || !(t instanceof HTMLElement) || !isHeld(t)) return
      e.stopPropagation()
      const list = tabbables()
      if (list.length) list[0].focus()
      else t.blur()
    },
    true,
  )
}
