import * as THREE from 'three'
import { chipPackage } from '../kit/silicon'
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

/** The Hark chip (kit chipPackage) — a stand-in hero object, standing up to face the camera. */
export function placeholderMark(): THREE.Group {
  const g = new THREE.Group()
  const chip = chipPackage({ w: 1.6, kind: 'qfp', pinsPerSide: 14, lines: ['HARK-1', 'MAKE · LISTEN'] })
  chip.rotation.x = Math.PI / 2
  chip.position.z = -0.1
  g.add(chip)
  return g
}

/** A faint reference grid floor so placeholder scenes read as space. */
export function placeholderFloor(size = 30, y = -1.4): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, size, 0x1c2430, 0x10151c)
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
