import * as THREE from 'three'

/*
 * POWER ON · the board layout, as data (board space: x right, "z" = y of the
 * Vector2 = toward the front edge; units cm; board top at y = 0).
 *
 * One source of truth for everything that has to line up: the copper drawn
 * into the board texture, the glowing nets riding on top of it, the pads and
 * the parts. The layout is a small, finished "Hark dev board":
 *
 *   top-left   the Hark mark + board name (silkscreen)
 *   left       U3 (SPI flash) → U1 on a 4-line bus; Y1 (crystal) → U1
 *   centre     U1, the Hark chip (QFP-64)
 *   top-right  U4 (sensor) → U1; the status row: D1 PWR, then U1 → D2–D5
 *   right      U5 → U1; C1 bulk can; U2 regulator
 *   front      J1 USB-C (power in), J2 1×6 header + "SAY HELLO · email"
 *
 * Nets carry a network START (in "front" units: where along the power-on
 * sequence they begin) and a RATE (front units per cm), so one scroll-driven
 * uniform can light the whole board in order: VBUS and the PWR LED first,
 * then every input converging on U1 at the same instant, then U1's outputs
 * racing to the status LEDs. The copper stays copper: only the arriving
 * signal (and the pulses behind it) is light.
 */

export type V2 = THREE.Vector2
const v = (x: number, z: number) => new THREE.Vector2(x, z)

export const BW = 11
export const BD = 7.2
export const CORNER_R = 0.36

/* ---- U1, the Hark chip (kit chipPackage, kind qfp) */
export const U1C = v(-0.4, -0.4)
export const U1W = 2.1
export const U1N = 16
export const U1_PITCH = Math.min((U1W * 0.8) / U1N, 0.13)
const U1_HALF = U1W / 2
const U1_SPAN = U1_PITCH * (U1N - 1)
/** QFP pads under the gull-wing feet: from half+0.06 to half+0.26 */
export const U1_PAD_IN = U1_HALF + 0.06
export const U1_PAD_OUT = U1_HALF + 0.26
/** top of U1's lid (kit qfp: body lifted 0.05 on its leads, 0.18 tall) */
export const U1_LID_Y = 0.05 + 0.18 + 0.001
const U1_ESC = U1_HALF + 0.42

/**
 * U1 pin k on side s at distance `out` from the centre. Sides follow the kit's
 * lead order: 0 = +x (k runs +z), 1 = −z (k runs +x), 2 = −x (k runs −z),
 * 3 = +z (k runs −x).
 */
export function u1Pin(side: number, k: number, out = U1_PAD_OUT): V2 {
  const along = -U1_SPAN / 2 + k * U1_PITCH
  const c = U1C
  if (side === 0) return v(c.x + out, c.y + along)
  if (side === 1) return v(c.x + along, c.y - out)
  if (side === 2) return v(c.x - out, c.y - along)
  return v(c.x - along, c.y + out)
}

/* ---- other parts (centres) */
export const U2C = v(4.55, 1.3) // SOT-223 regulator, leads toward +z, tab toward −z
export const U3C = v(-3.5, -0.4) // SOIC-8 flash, pin rows facing ±x
export const U4C = v(1.7, -2.55) // QFN sensor 0.4
export const U5C = v(2.45, -0.1) // QFN 0.5
export const U6C = v(2.62, 1.55) // SOT-23-6 ESD array over the USB pair
export const Y1C = v(-2.55, -1.135) // 3225 crystal, pads along z
export const J1C = v(3.3, 3.29) // USB-C receptacle centre (mouth at +z, overhangs the edge)
export const J1_D = 0.735
export const J1_MOUTH_Z = BD / 2 + 0.06
export const J2_PIN0 = v(-4.9, 2.7) // 1×6 header, 2.54 mm pitch along +x
export const J2_PITCH = 0.254
export const C1C = v(4.95, -0.62) // electrolytic can
export const PLANE_ORIGIN = v(4.55, 0.62) // the regulator's output vias: the power plane lights from here
/** D2–D5 (U1's status outputs) */
export const LED_X = [3.2, 3.6, 4.0, 4.4]
export const LED_Z = -2.78
export const RLED_Z = -2.18
/** D1 · PWR: first in the status row, behind U1 (in frame with the lid in the opening) */
export const D1C = v(2.72, LED_Z)
/** where D1's feed drops from the inner 3V3 layer */
export const D1_VIA = v(2.72, -1.5)
export const HOLES = [v(-5.05, -3.15), v(5.05, -3.15), v(-5.05, 3.15), v(5.05, 3.15)]
export const HOLE_R = 0.16
export const TESTPOINTS: { p: V2; label: string; left?: boolean }[] = [
  { p: v(3.72, 0.82), label: 'TP1 3V3', left: true },
  { p: v(-4.45, 0.95), label: 'TP2 GND' },
  { p: v(1.6, 2.2), label: 'TP3 SIG' },
]
export const FIDUCIALS = [v(-5.0, 0.55), v(-0.55, -3.15), v(5.2, 2.35)]

/** 0402 / 0603 / 0805 passives: kind c = capacitor (tan), r = resistor (black top), f = ferrite (grey) */
export interface Passive {
  p: V2
  rot: number
  size: '0402' | '0603' | '0805'
  kind: 'c' | 'r' | 'f'
}
const P = (x: number, z: number, rot: number, size: Passive['size'], kind: Passive['kind']): Passive => ({ p: v(x, z), rot, size, kind })
export const PASSIVES: Passive[] = [
  // U1 decoupling, one at each corner, rotated 45°
  P(U1C.x - 1.5, U1C.y - 1.5, Math.PI / 4, '0402', 'c'),
  P(U1C.x + 1.5, U1C.y - 1.5, -Math.PI / 4, '0402', 'c'),
  P(U1C.x + 1.5, U1C.y + 1.5, Math.PI / 4, '0402', 'c'),
  P(U1C.x - 1.5, U1C.y + 1.5, -Math.PI / 4, '0402', 'c'),
  // crystal load caps
  P(-2.78, -1.6, 0, '0402', 'c'),
  P(-2.32, -1.6, 0, '0402', 'c'),
  // U3 / U4 / U5 decoupling
  P(-3.5, -1.02, 0, '0402', 'c'),
  P(2.18, -2.55, Math.PI / 2, '0402', 'c'),
  P(2.98, -0.1, Math.PI / 2, '0402', 'c'),
  // LED resistors (R1 for D1 PWR, then D2–D5's)
  P(D1C.x, RLED_Z, Math.PI / 2, '0402', 'r'),
  ...LED_X.map(x => P(x, RLED_Z, Math.PI / 2, '0402', 'r')),
  // power: ferrite on VBUS, bulk caps, USB CC resistors
  P(4.35, 2.45, 0, '0805', 'f'),
  P(5.12, 2.05, Math.PI / 2, '0805', 'c'),
  P(5.12, 0.92, Math.PI / 2, '0805', 'c'),
  P(2.72, 2.42, Math.PI / 2, '0402', 'r'),
  P(2.95, 2.42, Math.PI / 2, '0402', 'r'),
]

/* ---- nets */
export interface NetPath {
  pts: V2[]
  /** copper width (cm) */
  w: number
  /** network start (front units) */
  start: number
  /** front units per cm along the path */
  rate: number
  /** 0 = signal, 1 = power */
  kind: number
}

/** Cut every interior corner of an orthogonal/45° polyline by `c` (clamped to half of each leg). */
export function chamfer(pts: V2[], c: number): V2[] {
  if (pts.length < 3) return pts.map(p => p.clone())
  const out: V2[] = [pts[0].clone()]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = pts[i + 1]
    const la = a.distanceTo(b)
    const lb = b.distanceTo(n)
    const da = b.clone().sub(a).normalize()
    const db = n.clone().sub(b).normalize()
    if (Math.abs(da.dot(db)) > 0.999) {
      out.push(b.clone())
      continue
    }
    const k = Math.min(c, la * 0.5, lb * 0.5)
    out.push(b.clone().addScaledVector(da, -k), b.clone().addScaledVector(db, k))
  }
  out.push(pts[pts.length - 1].clone())
  return out
}

/** PCB-style route: run along the dominant axis, one 45° jog at `jog`, then straight in. */
export function jogRoute(a: V2, b: V2, jog = 0.5, xFirst?: boolean): V2[] {
  const dx = b.x - a.x
  const dz = b.y - a.y
  const xf = xFirst ?? Math.abs(dx) >= Math.abs(dz)
  const main = xf ? dx : dz
  const cross = xf ? dz : dx
  const diag = Math.min(Math.abs(cross), Math.abs(main))
  const straight = Math.abs(main) - diag
  const s1 = straight * jog
  const sm = Math.sign(main) || 1
  const sc = Math.sign(cross) || 1
  const p1 = xf ? v(a.x + sm * s1, a.y) : v(a.x, a.y + sm * s1)
  const p2 = xf ? v(p1.x + sm * diag, p1.y + sc * diag) : v(p1.x + sc * diag, p1.y + sm * diag)
  const pts = [a.clone(), p1, p2]
  const rem = Math.abs(cross) - diag
  if (rem > 1e-4) pts.push(xf ? v(p2.x, p2.y + sc * rem) : v(p2.x + sc * rem, p2.y))
  pts.push(b.clone())
  return dedupe(pts)
}

export function dedupe(pts: V2[]): V2[] {
  const out: V2[] = []
  for (const p of pts) {
    const l = out[out.length - 1]
    if (!l || l.distanceTo(p) > 1e-4) out.push(p)
  }
  // drop collinear midpoints
  const res: V2[] = []
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const da = out[i].clone().sub(out[i - 1]).normalize()
      const db = out[i + 1].clone().sub(out[i]).normalize()
      if (da.dot(db) > 0.9999) continue
    }
    res.push(out[i])
  }
  return res
}

/** Offset a polyline sideways by d (left of travel, +), with miter joins. */
export function offsetLine(pts: V2[], d: number): V2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dIn = i > 0 ? p.clone().sub(a).normalize() : b.clone().sub(p).normalize()
    const dOut = i < pts.length - 1 ? b.clone().sub(p).normalize() : dIn.clone()
    const t = dIn.clone().add(dOut).normalize()
    const n = v(-t.y, t.x)
    const m = 1 / Math.max(0.35, n.dot(v(-dIn.y, dIn.x)))
    return p.clone().addScaledVector(n, d * m)
  })
}

export function pathLength(pts: V2[]) {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += pts[i].distanceTo(pts[i - 1])
  return l
}

/** The sequence, in front units. */
export const SEQ = {
  /** the PWR LED lights as soon as VBUS is live */
  pwr: 0.4,
  /** the regulator's output: the power plane starts spreading here */
  plane: 2.9,
  /** plane ring speed (cm per front unit) */
  planeSpeed: 1.6,
  /** every input reaches U1 at this instant */
  converge: 15,
  /** U1's outputs leave for the LEDs */
  outputs: 15.5,
  outRate: 0.42,
  /** the mark sweep runs from converge to this */
  sweepEnd: 17.6,
  /** everything is lit */
  end: 18.4,
}

export const planeArrival = (p: V2) => SEQ.plane + p.distanceTo(PLANE_ORIGIN) / SEQ.planeSpeed

export interface Layout {
  nets: NetPath[]
  /** traces drawn only as copper (GND stubs etc.) */
  stubs: { pts: V2[]; w: number }[]
  vias: V2[]
  /** network time each LED lights (D1 PWR first, then D2–D5) */
  ledOn: number[]
}

export function buildLayout(): Layout {
  const nets: NetPath[] = []
  const stubs: { pts: V2[]; w: number }[] = []
  const SIG = 0.05
  const PWR = 0.13

  /** an input into U1 that arrives exactly at SEQ.converge (or as soon after as its power allows) */
  const input = (pts: V2[]) => {
    const len = pathLength(pts)
    const start = Math.max(SEQ.converge - len, planeArrival(pts[0]) + 0.35)
    nets.push({ pts, w: SIG, start, rate: 1, kind: 0 })
  }

  // ---- VBUS: J1 → F1 → U2 input (the first thing to light)
  const vbus = chamfer([v(3.52, 2.9), v(3.52, 2.45), v(4.8, 2.45), v(4.8, 1.72)], 0.18)
  nets.push({ pts: vbus, w: PWR, start: 0, rate: 1, kind: 1 })
  // 3V3 (inner layer) → R1 → D1 PWR: the first light on the board
  const pwrLed = [D1_VIA.clone(), v(D1C.x, LED_Z + 0.06)]
  nets.push({ pts: pwrLed, w: 0.07, start: SEQ.pwr - pathLength(pwrLed) * 0.3, rate: 0.3, kind: 1 })
  // 3V3 out of the regulator tab into the plane vias, and on to TP1
  nets.push({ pts: [v(4.55, 1.0), v(4.55, 0.62)], w: 0.2, start: SEQ.plane - 0.4, rate: 1, kind: 1 })
  nets.push({ pts: [v(4.55, 0.82), v(3.72, 0.82)], w: PWR, start: SEQ.plane - 0.2, rate: 1, kind: 1 })
  nets.push({ pts: chamfer([v(4.55, 0.82), v(5.12, 0.82), v(5.12, 0.84)], 0.1), w: PWR, start: SEQ.plane - 0.2, rate: 1, kind: 1 })

  // ---- J2 header bus (6) → U1 bottom side, left pins (concentric corners)
  for (let i = 0; i < 6; i++) {
    const pin = v(J2_PIN0.x + i * J2_PITCH, J2_PIN0.y)
    const pad = u1Pin(3, 15 - i)
    const zh = 1.42 + i * 0.105
    input(chamfer([pin, v(pin.x, zh), v(pad.x, zh), pad], 0.2))
  }

  // ---- U3 (SPI flash) → U1 left side (4)
  for (let j = 0; j < 4; j++) {
    const a = v(U3C.x + 0.38, U3C.y + (j - 1.5) * 0.127)
    const pad = u1Pin(2, 8 - j)
    const esc = u1Pin(2, 8 - j, U1_ESC)
    input(dedupe([...jogRoute(a, esc, 0.5, true), pad]))
    // the flash's other row drops to vias (inner layers)
    stubs.push({ pts: [v(U3C.x - 0.38, a.y), v(U3C.x - 0.62, a.y)], w: SIG })
  }

  // ---- Y1 (crystal) → U1 left side, top pins
  for (let j = 0; j < 2; j++) {
    const a = v(Y1C.x + 0.2, Y1C.y + (j ? 0.11 : -0.11))
    const pad = u1Pin(2, j ? 14 : 15)
    const esc = u1Pin(2, j ? 14 : 15, U1_ESC)
    input(dedupe([...jogRoute(a, esc, 0.35, true), pad]))
  }

  // ---- U4 (sensor) → U1 top side, right pins (3, concentric)
  for (let j = 0; j < 3; j++) {
    const a = v(U4C.x - 0.24, U4C.y + (j - 1) * 0.1)
    const pad = u1Pin(1, 12 + j)
    input(chamfer([a, v(pad.x, a.y), pad], 0.16))
  }

  // ---- U5 → U1 right side (4)
  for (let j = 0; j < 4; j++) {
    const a = v(U5C.x - 0.3, U5C.y + (j - 1.5) * 0.1)
    const pad = u1Pin(0, 8 + j)
    const esc = u1Pin(0, 8 + j, U1_ESC)
    input(dedupe([...jogRoute(a, esc, 0.5, true), pad]))
  }

  // ---- USB D+/D− differential pair: J1 → (under U6) → U1 bottom side, right pins
  {
    const centre = chamfer([v(3.305, 2.9), v(3.305, 1.55), v(0.23, 1.55), v(0.23, U1C.y + U1_PAD_OUT)], 0.3)
    for (const s of [-1, 1]) input(dedupe(offsetLine(centre, s * U1_PITCH * 0.5)))
  }

  // ---- U1 → status LEDs D2–D5 (outputs, concentric)
  for (let j = 0; j < 4; j++) {
    const pad = u1Pin(0, 1 + j)
    const x = LED_X[j]
    const pts = chamfer([pad, v(x, pad.y), v(x, LED_Z + 0.06)], 0.22)
    nets.push({ pts, w: SIG, start: SEQ.outputs + j * 0.12, rate: SEQ.outRate, kind: 0 })
  }

  // ---- LED on times (D1 when its feed arrives, then D2–D5)
  const ledOn = [SEQ.pwr]
  for (let j = 0; j < 4; j++) {
    const n = nets[nets.length - 4 + j]
    ledOn.push(n.start + pathLength(n.pts) * n.rate)
  }

  // ---- GND / misc copper stubs (texture only)
  stubs.push({ pts: [v(4.55, 1.72), v(4.55, 1.95)], w: PWR })
  stubs.push({ pts: [v(3.08, 2.9), v(3.08, 2.62)], w: 0.1 })
  stubs.push({ pts: [v(2.72, 2.47), v(2.72, 2.66), v(2.95, 2.85)], w: SIG }, { pts: [v(2.95, 2.47), v(2.95, 2.62), v(3.05, 2.72)], w: SIG })
  stubs.push({ pts: [v(2.72, 2.37), v(2.72, 2.15)], w: SIG }, { pts: [v(2.95, 2.37), v(2.95, 2.15)], w: SIG })

  // ---- vias
  const vias: V2[] = []
  const blocked = (p: V2) => {
    if (HOLES.some(h => h.distanceTo(p) < 0.55)) return true
    if (p.x > 2.6 && p.x < 4.05 && p.y > 2.55) return true // J1
    if (p.x > 4.6 && p.y > -1.1 && p.y < 2.4) return true // C1 / C3 / C4
    if (p.x < -3.3 && p.y > 2.4 && p.y < 3.3) return true // J2 labels
    if (FIDUCIALS.some(f => f.distanceTo(p) < 0.3)) return true
    return false
  }
  // edge stitching
  const inset = 0.2
  const step = 0.3
  const x0 = -BW / 2 + inset
  const x1 = BW / 2 - inset
  const z0 = -BD / 2 + inset
  const z1 = BD / 2 - inset
  for (let x = x0 + 0.3; x <= x1 - 0.3; x += step) {
    for (const z of [z0, z1]) {
      const p = v(x, z)
      if (!blocked(p)) vias.push(p)
    }
  }
  for (let z = z0 + 0.3; z <= z1 - 0.3; z += step) {
    for (const x of [x0, x1]) {
      const p = v(x, z)
      if (!blocked(p)) vias.push(p)
    }
  }
  // regulator output (the plane feed)
  vias.push(v(4.4, 0.55), v(4.55, 0.55), v(4.7, 0.55), v(4.4, 0.42), v(4.55, 0.42), v(4.7, 0.42))
  // U3 far row
  for (let j = 0; j < 4; j++) vias.push(v(U3C.x - 0.66, U3C.y + (j - 1.5) * 0.127 + (j % 2 ? 0.03 : -0.03)))
  // USB via fence
  for (let x = 0.75; x <= 2.3; x += 0.22) vias.push(v(x, 1.84))
  // decoupling cap vias (next to the U1 corner caps)
  vias.push(v(U1C.x - 1.74, U1C.y - 1.74), v(U1C.x + 1.74, U1C.y - 1.74), v(U1C.x + 1.72, U1C.y + 1.72), v(U1C.x - 1.72, U1C.y + 1.72))
  // misc
  vias.push(v(-2.55, -1.84), v(-2.3, -1.84), v(-3.1, -1.02), v(2.18, -2.9), v(3.28, -0.1), v(4.55, 1.95), v(3.08, 2.62), v(2.72, 2.12), v(2.95, 2.12))
  vias.push(v(1.9, 0.7), v(2.1, 0.55), v(-2.2, 0.8), v(-2.4, 0.95))
  vias.push(D1_VIA.clone())

  return { nets, stubs, vias, ledOn }
}
