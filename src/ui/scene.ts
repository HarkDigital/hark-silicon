/*
 * Reference-counted "the scene is covered" holds. The phone-landscape rotate
 * card and the mobile datasheet-index sheet each cover the WebGL frame
 * completely, so while either is up the engine skips rendering
 * (engine.paused): an unseen board never burns battery.
 *
 * Holds may be taken before the engine exists (the rotate card mounts with
 * the loader, on the very first frame); they apply once bindScene() runs.
 */

interface Pausable {
  paused: boolean
}

let target: Pausable | null = null
const holds = new Set<string>()

const apply = () => {
  if (target) target.paused = holds.size > 0
}

export function bindScene(engine: Pausable) {
  target = engine
  apply()
}

export function holdScene(key: string) {
  holds.add(key)
  apply()
}

export function releaseScene(key: string) {
  if (holds.delete(key)) apply()
}

/** true while anything holds the scene */
export function sceneHeld() {
  return holds.size > 0
}
