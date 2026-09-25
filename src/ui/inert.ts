/*
 * Shared, reference-counted `inert` for page layers. The mobile menu and the
 * phone-landscape rotate gate can both hold the same layer (say #stages); a
 * layer only wakes up once every holder has let go, and anything that was
 * already inert before the first hold is left exactly as it was.
 */

const holders = new Map<HTMLElement, { keys: Set<string>; was: boolean }>()

export function holdInert(key: string, els: Iterable<HTMLElement | null | undefined>) {
  for (const el of els) {
    if (!el) continue
    let h = holders.get(el)
    if (!h) {
      h = { keys: new Set(), was: el.inert }
      holders.set(el, h)
    }
    h.keys.add(key)
    el.inert = true
  }
}

export function releaseInert(key: string) {
  for (const [el, h] of holders) {
    if (!h.keys.delete(key) || h.keys.size) continue
    el.inert = h.was
    holders.delete(el)
  }
}
