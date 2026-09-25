import * as THREE from 'three'
import { logoGeometry, logoParts } from '../logo/logo'
import { clamp } from '../core/math'
import type { CameraPose, Frame } from '../core/types'

/*
 * Shared helpers for the starter's placeholder chapters. Each chapter is a
 * working, content-complete example of the Chapter API — replace the scene
 * with the concept's own, keep the patterns:
 *   - everything derived from `local` (screenshots jump to any value)
 *   - copy in ctx.stage inside .hud-panel, revealed with rise()/setRise()
 *   - items stepped with beat(), chapter.anchors pointing at each item
 *   - in/out beats kept clear of the engine's cut window (first/last ~6%)
 */

/** The Hark mark as a lit 3D block with a glowing diamond — a stand-in hero object. */
export function placeholderMark(color = '#00e27a'): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    logoGeometry({ depth: 0.22 }),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 }),
  )
  g.add(body)
  const diamond = new THREE.Mesh(
    new THREE.ShapeGeometry(logoParts().diamond),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff85').multiplyScalar(2.2), toneMapped: false }),
  )
  diamond.position.z = 0.125
  g.add(diamond)
  return g
}

/** A faint reference grid floor so placeholder scenes read as space. */
export function placeholderFloor(size = 30, y = -1.4): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, size, 0x3a4150, 0x262b34)
  grid.position.y = y
  return grid
}

/**
 * Step through `count` items between local `a` and `b`.
 * Returns the current index, the progress inside its slot (0..1), and the
 * local value at the centre of each slot (use those for chapter.anchors).
 */
export function beat(local: number, count: number, a: number, b: number) {
  const span = (b - a) / count
  const idx = Math.min(count - 1, Math.max(0, Math.floor((local - a) / span)))
  const phase = clamp((local - a - idx * span) / span)
  const active = local >= a && local <= b
  return { idx, phase, active, centers: Array.from({ length: count }, (_, i) => a + span * (i + 0.55)) }
}

/**
 * Frame the placeholder subject (at the origin) clear of the copy: to the
 * right on landscape screens (copy lives on the left), smaller and above
 * center on portrait (copy lives at the top and bottom). `amount` 0..1 eases
 * between a centred shot and the offset one.
 */
export function framedCamera(out: CameraPose, frame: Frame, amount = 1, dist = 7.5) {
  const portrait = frame.height > frame.width
  if (portrait) {
    out.position.set(0, 0.3, dist * 1.45)
    out.target.set(0, -0.35 * amount, 0)
  } else {
    out.position.set(-2.1 * amount, 0.5, dist)
    out.target.set(-1.5 * amount, 0, 0)
  }
  out.fov = 40
  out.parallax = 0.3
}
