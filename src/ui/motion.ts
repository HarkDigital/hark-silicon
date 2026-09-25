/*
 * The visitor's Motion choice (SW1 in the chrome), remembered for the
 * session. The chrome owns the switch; the loader reads it so a visitor who
 * turned Motion off and reloads also gets the calm boot exit.
 */

const MOTION_KEY = 'hark-silicon:motion'

/** the stored choice, or `fallback` when there is none (or storage is blocked) */
export function readMotion(fallback: boolean): boolean {
  try {
    const v = sessionStorage.getItem(MOTION_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* blocked storage: the default for this visit */
  }
  return fallback
}

export function rememberMotion(on: boolean) {
  try {
    sessionStorage.setItem(MOTION_KEY, on ? '1' : '0')
  } catch {
    /* private mode / blocked storage: the choice lasts until reload */
  }
}
