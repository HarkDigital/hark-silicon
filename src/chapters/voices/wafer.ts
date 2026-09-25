import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { S, Traces } from '../../kit/silicon'
import { dieTile } from './dieTile'
import { nextFrame } from '../../core/yield'
import { TESTIMONIALS } from '../../content'

/*
 * The Wafer (voices) — scene parts.
 *
 *   a 300 mm silicon wafer (R = 15 cm, 775 µm thick, a notch toward the
 *   camera) on a black vacuum chuck. The top is ONE mesh with a custom
 *   physical material: every die is the same floorplan tile (sampled at full
 *   resolution in every cell, so the die under the probe is as sharp as the
 *   macro lens), scribe lanes and the bare-silicon edge ring are procedural,
 *   and eight dies are the clients'. Each still reads as a DIE: the full
 *   floorplan, with the client's initials as real chip-art — a small top-metal
 *   signature in the near-left corner of the core (~14 % of the die) — and a
 *   mask-ID line printed in the scribe lane in front of it
 *   ('SQ · BELLVIEW WINERY', tiny mono, next to a few PCM test pads). An
 *   overlay atlas carries both, plus the probe scrub marks. On top of the
 *   thin-film iridescence the die pattern DIFFRACTS: rainbow bands from two
 *   studio lights, placed by the grating equation, sweep as the wafer turns.
 *   The lens's shallow depth of field is a circle of confusion from each
 *   fragment's view depth turned into a texture-gradient scale (the die
 *   under the probe stays sharp, the rows in front and behind go soft; the
 *   focus drifts long mid-step and racks back in on arrival). The only green
 *   on a client die is its seal ring (pulses while powered, a faint steady
 *   ring once passed) and its bin dot.
 *
 *   a cantilever probe card's needles (merged, tapered tungsten) converge on
 *   the pads of whichever die sits under the probe (the world origin); the
 *   stage moves the wafer, the needles only lift and touch down.
 *
 * Units: 1 = 1 cm. The wafer lies in XZ, y up; the front (+z) faces the camera.
 */

export const N = 8
/** the clients (the atlas and the chapter agree on this order) */
export const CLIENTS = TESTIMONIALS.slice(0, N)
/** wafer radius, edge-exclusion radius, die pitch, die size, thickness */
export const R = 15
export const RE = 14.62
export const P = 1.25
export const D = 1.17
export const T = 0.078
/** the wafer's top surface (the chuck's top is y = 0) */
export const TOP = T

/**
 * The eight client dies (grid index x right, z toward the camera), in
 * testimonial order: a short stepping tour that ends on the centre die.
 */
export const DIES: [number, number][] = [
  [-4, -2],
  [-2, -4],
  [1, -3],
  [3, -1],
  [2, 2],
  [-1, 3],
  [-3, 1],
  [0, 0],
]

/** wafer-local centre of die k */
export function dieCentre(k: number, out = new THREE.Vector2()): THREE.Vector2 {
  const d = DIES[Math.max(0, Math.min(N - 1, k))]
  return out.set(d[0] * P, d[1] * P)
}

/** true when the whole die cell (ix, iz) lies inside the edge exclusion */
export function dieInside(ix: number, iz: number): boolean {
  const h = D / 2
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (Math.hypot(ix * P + sx * h, iz * P + sz * h) > RE) return false
  return true
}

/** initials from a name ("MaryJane Kinkade" → "MK") */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

/* ------------------------------------------------ probe geometry (shared) */

/** pad centres in normalised die coords (a.x right, a.y from the far edge) — match the kit floorplan's pad ring */
const PAD_IN = 0.027
const padT = (i: number) => 0.06 + (0.88 * (i + 0.5)) / 28
/** where the needles touch down: [a.x, a.y, side] (0 = far edge, 1 = left, 2 = right) */
export const TIPS: [number, number, number][] = [
  ...[2, 5, 8, 11, 16, 19, 22, 25].map(i => [padT(i), PAD_IN, 0] as [number, number, number]),
  ...[3, 7, 11].flatMap(i => [[PAD_IN, padT(i), 1] as [number, number, number], [1 - PAD_IN, padT(i), 2] as [number, number, number]]),
]
/**
 * The chip-art signature on a client die (normalised die coords): a small
 * keep-out in the near-left corner of the core (inside the power ring, clear
 * of the needles, which all land on the far half), the initials in top metal.
 */
export const SIG = { x0: 0.1, y0: 0.745, x1: 0.33, y1: 0.905 }
/** the bin mark (a green probe dot) */
export const BIN = { x: 0.9, y: 0.1 }
/**
 * The mask-ID strip printed in the scribe lane in front of (+z) a client die,
 * as a fraction of the die size. The lane is (P − D) / D ≈ 0.068 wide; the
 * strip sits in its middle.
 */
const LANE_K = 1 / 16
/** atlas rows: each client gets a die square (cs) and its lane strip (cs · LANE_K) under it */
const ATLAS_AY = 1 / (2 * (1 + LANE_K))
const ATLAS_LY = LANE_K / (2 * (1 + LANE_K))

/* ------------------------------------------------------------- textures */

type Ctx2D = CanvasRenderingContext2D

function fontsReady(): Promise<void> {
  const f = document.fonts
  if (!f) return Promise.resolve()
  return Promise.all([f.load("700 100px 'Space Grotesk Variable'"), f.load("500 40px 'Martian Mono Variable'")])
    .then(() => undefined)
    .catch(() => undefined)
}

/**
 * The client overlay atlas: 4 × 2 rows, one per client die. Each row is the
 * die square (cs × cs) with its scribe-lane strip (cs × cs·LANE_K) under it.
 *   die square: R = the initials (top metal), G = fine metal (the
 *               signature's corner ticks and part number), B = probe scrub
 *               marks on the pads the needles touch
 *   lane strip: G = the mask-ID line, R = PCM test pads and a vernier
 * Painted additively on opaque black (read as data, not colour).
 */
export function clientAtlas(clients: { name: string; company: string }[], cell: number): THREE.CanvasTexture {
  // a multiple of 16 keeps the strip a whole number of pixels (the shader's ATLAS_* fractions stay exact)
  const cs = Math.max(16, Math.round(cell / 16) * 16)
  const ls = cs * LANE_K
  const rh = cs + ls
  const cv = document.createElement('canvas')
  cv.width = cs * 4
  cv.height = rh * 2
  const g = cv.getContext('2d')!
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.NoColorSpace
  tex.anisotropy = 8
  // one scratch layer for the slotted initials, reused by every cell
  const layer = document.createElement('canvas')
  layer.width = Math.ceil(cs * (SIG.x1 - SIG.x0))
  layer.height = Math.ceil(cs * (SIG.y1 - SIG.y0))
  const draw = () => {
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#000'
    g.fillRect(0, 0, cv.width, cv.height)
    g.globalCompositeOperation = 'lighter'
    clients.forEach((c, k) => drawCell(g, layer, (k % 4) * cs, Math.floor(k / 4) * rh, cs, ls, c, k))
    tex.needsUpdate = true
  }
  draw()
  fontsReady().then(draw)
  return tex
}

const face = (px: number) => `700 ${px}px 'Space Grotesk Variable', system-ui, sans-serif`
const mono = (px: number) => `500 ${px}px 'Martian Mono Variable', ui-monospace, monospace`

function drawCell(g: Ctx2D, layer: HTMLCanvasElement, x0: number, y0: number, cs: number, ls: number, c: { name: string; company: string }, k: number) {
  g.save()
  g.translate(x0, y0)
  g.beginPath()
  g.rect(0, 0, cs, cs + ls)
  g.clip()
  const ini = initials(c.name)
  const sx0 = cs * SIG.x0
  const sy0 = cs * SIG.y0
  const sw = cs * (SIG.x1 - SIG.x0)
  const sh = cs * (SIG.y1 - SIG.y0)
  const inset = sw * 0.09

  // R — the initials: a top-metal signature, ~14 % of the die, slotted as wide metal is
  let fs = cs * 0.14
  g.font = face(fs)
  const maxW = sw - inset * 2
  const w = g.measureText(ini).width
  if (w > maxW) fs *= maxW / w
  const l = layer.getContext('2d')!
  l.globalCompositeOperation = 'source-over'
  l.globalAlpha = 1
  l.clearRect(0, 0, layer.width, layer.height)
  l.font = face(fs)
  l.textAlign = 'left'
  l.textBaseline = 'alphabetic'
  l.fillStyle = '#ff0000'
  l.fillText(ini, inset, sh * 0.68)
  l.globalCompositeOperation = 'destination-out'
  l.globalAlpha = 0.55
  const sp = Math.max(3, fs * 0.16)
  const slot = Math.max(1, fs * 0.03)
  for (let row = 0, y = sp * 0.5; y < sh; y += sp, row++) {
    for (let x = (row % 2) * sp * 1.3; x < sw; x += sp * 2.6) l.fillRect(x, y, sp * 1.7, slot)
  }
  g.drawImage(layer, sx0, sy0)

  // G — fine metal: corner ticks around the keep-out, a part number under the initials
  g.strokeStyle = '#00ff00'
  g.fillStyle = '#00ff00'
  const lw = Math.max(1, cs * 0.0032)
  g.lineWidth = lw
  const tick = cs * 0.02
  const h = lw / 2
  for (const [x, y, dx, dy] of [
    [sx0 + h, sy0 + h, 1, 1],
    [sx0 + sw - h, sy0 + h, -1, 1],
    [sx0 + h, sy0 + sh - h, 1, -1],
    [sx0 + sw - h, sy0 + sh - h, -1, -1],
  ]) {
    g.beginPath()
    g.moveTo(x, y + dy * tick)
    g.lineTo(x, y)
    g.lineTo(x + dx * tick, y)
    g.stroke()
  }
  let ps = cs * 0.021
  const part = `HK-${String(k + 1).padStart(2, '0')} REV A`
  g.font = mono(ps)
  const pw = g.measureText(part).width
  if (pw > maxW) ps *= maxW / pw
  g.font = mono(ps)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillText(part, sx0 + inset, sy0 + sh * 0.88)

  // B — probe scrub marks on the pads the needles touch (the bin dot is procedural)
  g.fillStyle = '#0000ff'
  for (const [ax, ay, side] of TIPS) {
    g.beginPath()
    // a short scrub along the needle's travel
    if (side === 0) g.ellipse(ax * cs, ay * cs, cs * 0.0055, cs * 0.009, 0, 0, Math.PI * 2)
    else g.ellipse(ax * cs, ay * cs, cs * 0.009, cs * 0.0055, 0, 0, Math.PI * 2)
    g.fill()
  }

  // ---- the scribe-lane strip in front of the die ----
  const ly = cs
  // R — process-control test pads at the far end of the strip
  g.fillStyle = '#ff0000'
  const pp = Math.round(ls * 0.56)
  const py = ly + Math.round((ls - pp) / 2)
  const xr = cs * 0.975
  for (let i = 0; i < 3; i++) g.fillRect(Math.round(xr - pp - i * pp * 1.55), py, pp, pp)
  const padsL = xr - pp * 4.1
  // G — the mask-ID line, left-aligned with the signature: 'SQ · BELLVIEW WINERY'
  const id = `${ini} · ${c.company.toUpperCase()}`
  const tx = sx0 + inset
  let ts = ls * 0.6
  g.font = mono(ts)
  let tw = g.measureText(id).width
  // a vernier between the name and the pads, when the name leaves room for one
  const bar = Math.max(1, ls * 0.07)
  const vW = bar * 16.6
  const vR = padsL - pp * 0.8
  const vernier = tx + tw + pp * 1.2 < vR - vW
  const maxT = (vernier ? vR - vW : padsL) - pp * 1.2 - tx
  if (tw > maxT) {
    ts *= maxT / tw
    tw = maxT
  }
  g.font = mono(ts)
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  g.fillStyle = '#00ff00'
  g.fillText(id, tx, ly + ls * 0.53)
  if (vernier) {
    g.fillStyle = '#ff0000'
    for (let i = 0; i < 7; i++) g.fillRect(vR - bar - i * bar * 2.6, ly + ls * (i === 3 ? 0.2 : 0.3), bar, ls * (i === 3 ? 0.6 : 0.4))
  }
  g.restore()
}

/** Concentric vacuum grooves for the chuck's top (radial UVs of a cylinder cap). */
function chuckTexture(size: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  const c = size / 2
  const grd = g.createRadialGradient(c, c, 0, c, c, c)
  grd.addColorStop(0, '#16181c')
  grd.addColorStop(1, '#0e1013')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  for (let r = 0.08; r < 0.97; r += 0.062) {
    g.strokeStyle = '#050607'
    g.lineWidth = size * 0.004
    g.beginPath()
    g.arc(c, c, r * c, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = 'rgba(120,128,140,0.18)'
    g.lineWidth = size * 0.0012
    g.beginPath()
    g.arc(c, c, r * c + size * 0.003, 0, Math.PI * 2)
    g.stroke()
  }
  // radial vacuum channels
  g.strokeStyle = '#050607'
  g.lineWidth = size * 0.004
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4
    g.beginPath()
    g.moveTo(c + Math.cos(a) * c * 0.08, c + Math.sin(a) * c * 0.08)
    g.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95)
    g.stroke()
  }
  // the chuck's polished lip
  g.strokeStyle = 'rgba(160,168,180,0.35)'
  g.lineWidth = size * 0.006
  g.beginPath()
  g.arc(c, c, c * 0.985, 0, Math.PI * 2)
  g.stroke()
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/* --------------------------------------------------------------- wafer */

export interface WaferUniforms {
  uTile: { value: THREE.Texture | null }
  uAtlas: { value: THREE.Texture | null }
  uClient: { value: THREE.Vector2[] }
  uPower: { value: number[] }
  uPass: { value: number[] }
  /** camera distance to the focus plane, its half-depth (fraction) and the blur scale (px) */
  uFocusD: { value: number }
  uFocusTol: { value: number }
  uAper: { value: number }
  uL0: { value: THREE.Vector3 }
  uL1: { value: THREE.Vector3 }
  uDiff: { value: number }
  uPeriod: { value: number }
  uSignal: { value: THREE.Color }
}

const f = (v: number) => v.toFixed(5)

const FRAG_PARS = /* glsl */ `
uniform sampler2D uTile;
uniform sampler2D uAtlas;
uniform vec2 uClient[8];
uniform float uPower[8];
uniform float uPass[8];
uniform float uFocusD;
uniform float uFocusTol;
uniform float uAper;
uniform vec3 uL0;
uniform vec3 uL1;
uniform float uDiff;
uniform float uPeriod;
uniform vec3 uSignal;
varying vec2 vWp;
varying vec3 vGx;
varying vec3 vGz;
const float HK_PITCH = ${f(P)};
const float HK_HALF = ${f((0.5 * D) / P)};
const float HK_RE = ${f(RE)};
// the client atlas: a die square and its lane strip per row (fractions of the atlas height)
const float HK_AY = ${f(ATLAS_AY)};
const float HK_LY = ${f(ATLAS_LY)};
// the lane strip's height in pitch units
const float HK_LANE = ${f((LANE_K * D) / P)};
vec3 hkHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// visible spectrum: x 0 (violet) .. 1 (red), soft ends
vec3 hkSpectrum(float x) {
  float w = smoothstep(0.0, 0.2, x) * (1.0 - smoothstep(0.8, 1.0, x));
  return mix(vec3(0.7), hkHue((1.0 - clamp(x, 0.0, 1.0)) * 0.78), 0.8) * w;
}
// first + second diffraction order for a tangential offset t (grating equation, wavelength in µm)
vec3 hkOrders(float t) {
  float a = abs(t) * uPeriod;
  return hkSpectrum((a - 0.38) / 0.34) + 0.45 * hkSpectrum((a * 0.5 - 0.38) / 0.34);
}
float hkBox(vec2 a, vec4 r, float e) {
  vec2 lo = smoothstep(r.xy - e, r.xy + e, a);
  vec2 hi = 1.0 - smoothstep(r.zw - e, r.zw + e, a);
  return lo.x * lo.y * hi.x * hi.y;
}
`

const FRAG_MAP = /* glsl */ `
  // ---- die grid (all derivatives at top level) ----
  vec2 hkQ = vWp / HK_PITCH;
  vec2 hkQx = dFdx(hkQ);
  vec2 hkQy = dFdy(hkQ);
  vec2 hkId = floor(hkQ + 0.5);
  vec2 hkF = hkQ - hkId;
  vec2 hkA = hkF / (2.0 * HK_HALF) + 0.5;
  float hkPx = max(length(hkQx), length(hkQy));
  // depth of field: circle of confusion (px) from the view depth → a mip bias
  float hkDepth = max(vViewPosition.z, 1e-3);
  float hkCoc = uAper * max(abs(hkDepth - uFocusD) - uFocusTol * uFocusD, 0.0) / hkDepth;
  float hkS = 1.0 + hkCoc;
  vec2 hkGx = hkQx / (2.0 * HK_HALF) * hkS;
  vec2 hkGy = hkQy / (2.0 * HK_HALF) * hkS;
  float hkAa = hkPx * (0.7 + hkCoc * 0.5) + 0.0015;
  // die vs scribe lane (fades to the average when lanes are sub-pixel)
  float hkEdge = max(abs(hkF.x), abs(hkF.y));
  float hkIn = 1.0 - smoothstep(HK_HALF - hkAa, HK_HALF + hkAa, hkEdge);
  hkIn = mix(hkIn, 0.88, smoothstep(0.03, 0.09, hkPx * hkS));
  float hkR = length(vWp);
  float hkPat = 1.0 - smoothstep(HK_RE - hkAa * HK_PITCH, HK_RE + hkAa * HK_PITCH, hkR);
  float hkDie = hkIn * hkPat;
  vec3 hkTile = textureGrad(uTile, vec2(hkA.x, 1.0 - hkA.y), vec2(hkGx.x, -hkGx.y), vec2(hkGy.x, -hkGy.y)).rgb;
  // ---- the client dies, and the scribe lane in front of each ----
  float hkSel = -1.0;
  float hkLSel = -1.0;
  float hkPow = 0.0;
  float hkPas = 0.0;
  // the lane just in front of (+z) die (x, z) belongs to it: floor() picks that die for the lane's fragments
  vec2 hkLId = vec2(hkId.x, floor(hkQ.y));
  for (int k = 0; k < 8; k++) {
    vec2 dd = abs(hkId - uClient[k]);
    float hit = 1.0 - step(0.25, max(dd.x, dd.y));
    vec2 dl = abs(hkLId - uClient[k]);
    hkLSel = mix(hkLSel, float(k), 1.0 - step(0.25, max(dl.x, dl.y)));
    hkSel = mix(hkSel, float(k), hit);
    hkPow += uPower[k] * hit;
    hkPas += uPass[k] * hit;
  }
  float hkIsC = step(-0.5, hkSel) * hkDie;
  float hkK = max(hkSel, 0.0);
  vec2 hkCell = vec2(mod(hkK, 4.0), floor(hkK / 4.0));
  vec2 hkAc = clamp(hkA, 0.0, 1.0);
  vec2 hkAuv = vec2((hkCell.x + hkAc.x) * 0.25, 1.0 - hkCell.y * 0.5 - hkAc.y * HK_AY);
  vec2 hkGax = vec2(hkGx.x * 0.25, -hkGx.y * HK_AY);
  vec2 hkGay = vec2(hkGy.x * 0.25, -hkGy.y * HK_AY);
  // (explicit gradients: the atlas is only fetched on the eight client dies and their lanes)
  vec3 hkOv = vec3(0.0);
  float hkRf = 0.0;
  float hkRn = 0.0;
  if (hkIsC > 0.0) {
    hkOv = textureGrad(uAtlas, hkAuv, hkGax, hkGay).rgb * hkIsC;
    // the letters stand proud: a lit rim on the far (light) side, a shadow on the near side
    vec2 hkOff = vec2(0.0055 * 0.25, 0.0065 * HK_AY);
    hkRf = textureGrad(uAtlas, hkAuv + vec2(-hkOff.x, hkOff.y), hkGax, hkGay).r * hkIsC;
    hkRn = textureGrad(uAtlas, hkAuv - vec2(-hkOff.x, hkOff.y), hkGax, hkGay).r * hkIsC;
  }
  // the signature's keep-out (no dummy fill under chip art)
  float hkSig = hkBox(hkA, vec4(${f(SIG.x0)}, ${f(SIG.y0)}, ${f(SIG.x1)}, ${f(SIG.y1)}), 0.003 + hkAa * 0.5) * hkIsC;
  float hkLet = hkOv.r;
  float hkRim = clamp(hkLet - hkRf, 0.0, 1.0);
  float hkShade = clamp(hkRf - hkLet, 0.0, 1.0) + clamp(hkLet - hkRn, 0.0, 1.0) * 0.5;
  // the mask-ID strip (fades out with the lane itself once lanes go sub-pixel)
  float hkLv = (fract(hkQ.y) - 0.5) / HK_LANE + 0.5;
  float hkLk = max(hkLSel, 0.0);
  vec2 hkLCell = vec2(mod(hkLk, 4.0), floor(hkLk / 4.0));
  float hkLOn = step(-0.5, hkLSel) * step(0.0, hkLv) * step(hkLv, 1.0) * step(0.0, hkA.x) * step(hkA.x, 1.0) * (1.0 - hkIn) * hkPat;
  vec2 hkLuv = vec2((hkLCell.x + hkAc.x) * 0.25, 1.0 - hkLCell.y * 0.5 - HK_AY - clamp(hkLv, 0.0, 1.0) * HK_LY);
  vec2 hkGlx = vec2(hkGx.x * 0.25, -hkQx.y * hkS * (HK_LY / HK_LANE));
  vec2 hkGly = vec2(hkGy.x * 0.25, -hkQy.y * hkS * (HK_LY / HK_LANE));
  vec2 hkLane = vec2(0.0);
  if (hkLOn > 0.0) hkLane = textureGrad(uAtlas, hkLuv, hkGlx, hkGly).rg * hkLOn;
  float hkLM = max(hkLane.r, hkLane.g);
  // ---- colour: polished bare silicon, the floorplan, chip art in top metal ----
  vec3 hkCol = mix(vec3(0.32, 0.33, 0.35), hkTile, hkDie);
  hkCol = mix(hkCol, hkTile * 0.28 + vec3(0.016, 0.015, 0.026), hkSig * 0.9);
  hkCol = mix(hkCol, vec3(0.62, 0.61, 0.58), hkOv.g * 0.8);
  // probe scrub marks: a dull bruise on the aluminium pads
  hkCol *= 1.0 - hkOv.b * 0.45;
  hkCol = mix(hkCol, vec3(0.74, 0.75, 0.78), hkLet);
  hkCol = mix(hkCol, vec3(1.0), hkRim * 0.8);
  hkCol *= 1.0 - hkShade * 0.75;
  // the lane: aluminium test pads and the mask-ID line on the bare silicon
  hkCol = mix(hkCol, vec3(0.68, 0.69, 0.72), hkLane.r * 0.9);
  hkCol = mix(hkCol, vec3(0.8, 0.8, 0.82), hkLane.g);
  diffuseColor.rgb *= hkCol;
`

const FRAG_ROUGH = /* glsl */ `
  roughnessFactor = mix(0.07, roughnessFactor, hkDie);
  roughnessFactor = mix(roughnessFactor, 0.36, max(hkLet, hkSig * 0.5));
  roughnessFactor = mix(roughnessFactor, 0.42, hkLM);
`
const FRAG_METAL = /* glsl */ `
  metalnessFactor = mix(0.9, metalnessFactor, hkDie);
  metalnessFactor = mix(metalnessFactor, 0.45, hkLet);
  metalnessFactor = mix(metalnessFactor, 0.5, hkLM);
`

const FRAG_EMISSIVE = /* glsl */ `
  {
    // diffraction: the die pattern is a 2D grating; each studio light throws
    // its first/second orders where the tangential (V + L) matches λ / d
    vec3 V = normalize(vViewPosition);
    vec3 gX = normalize(vGx);
    vec3 gZ = normalize(vGz);
    vec3 L0 = normalize((viewMatrix * vec4(uL0, 0.0)).xyz);
    vec3 L1 = normalize((viewMatrix * vec4(uL1, 0.0)).xyz);
    vec3 h0 = V + L0;
    vec3 h1 = V + L1;
    float x0 = dot(h0, gX);
    float z0 = dot(h0, gZ);
    float x1 = dot(h1, gX);
    float z1 = dot(h1, gZ);
    vec3 dif = hkOrders(x0) * exp(-z0 * z0 * 28.0) + hkOrders(z0) * exp(-x0 * x0 * 28.0);
    dif += (hkOrders(x1) * exp(-z1 * z1 * 40.0) + hkOrders(z1) * exp(-x1 * x1 * 40.0)) * 0.7;
    float grate = hkDie * (1.0 - hkLet) * (1.0 - hkSig * 0.75) * (0.55 + 3.0 * dot(hkTile, vec3(0.3, 0.5, 0.2)));
    totalEmissiveRadiance += uDiff * dif * grate;
    // the signal on a client die is only its bin dot and seal ring: the dot
    // lights when the probe powers the die and stays lit (quieter) once passed
    float hkBe = hkAa / (2.0 * HK_HALF);
    float hkBin = (1.0 - smoothstep(0.02 - hkBe, 0.02 + hkBe, length(hkA - vec2(${f(BIN.x)}, ${f(BIN.y)})))) * hkIsC;
    totalEmissiveRadiance += uSignal * hkBin * (hkPow * 4.0 + hkPas * 1.6);
    // a passed die keeps a faint green seal ring: the eight are easy to find on the wafer
    float hkRw = max(0.012, hkPx * 1.1);
    float hkRing = smoothstep(HK_HALF - hkRw * 2.2, HK_HALF - hkRw, hkEdge) * hkIn * hkIsC;
    totalEmissiveRadiance += uSignal * hkRing * hkPas * 0.7;
  }
`

const FRAG_IRID = /* glsl */ `
  #ifdef USE_IRIDESCENCE
    material.iridescence *= hkDie * (1.0 - hkLet);
  #endif
`

export interface Wafer {
  /** chuck + wafer: the moving stage */
  stage: THREE.Group
  top: THREE.Mesh
  uniforms: WaferUniforms
  /** the seal-ring signal on the powered die (child of stage) */
  signal: Traces
  signalLen: number
}

function waferShape(): THREE.Shape {
  const s = new THREE.Shape()
  const notchHalf = 0.012 // rad
  const depth = 0.16
  const n = 480
  const a0 = -Math.PI / 2 + notchHalf
  const a1 = (3 * Math.PI) / 2 - notchHalf
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    const x = Math.cos(a) * R
    const y = Math.sin(a) * R
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.lineTo(0, -R + depth)
  s.closePath()
  return s
}

/** Builds the stage, yielding between the heavy canvas steps (hidden-tab safe). */
export async function buildWafer(o: { mobile: boolean; anisotropy: number }): Promise<Wafer> {
  const stage = new THREE.Group()

  // chuck: black anodised, concentric vacuum grooves, a polished lip
  const chuckGeo = new THREE.CylinderGeometry(R + 0.9, R + 0.9, 1.4, 160, 1)
  chuckGeo.translate(0, -0.7 - 0.002, 0)
  const chuckTop = new THREE.MeshStandardMaterial({ map: chuckTexture(o.mobile ? 512 : 1024), roughness: 0.5, metalness: 0.5, color: '#b8bcc4' })
  const chuckSide = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.38, metalness: 0.8 })
  const chuck = new THREE.Mesh(chuckGeo, [chuckSide, chuckTop, chuckSide])
  stage.add(chuck)
  // a soft contact shadow ring where the wafer meets the chuck
  const shadowGeo = new THREE.RingGeometry(R - 0.2, R + 0.55, 160, 1)
  shadowGeo.rotateX(-Math.PI / 2)
  const shadowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vP; void main(){ float r = length(vP); float a = 1.0 - smoothstep(${f(R)}, ${f(R + 0.5)}, r); gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.6); }`,
  })
  const shadow = new THREE.Mesh(shadowGeo, shadowMat)
  shadow.position.y = 0.0005
  stage.add(shadow)

  // the wafer: a bevelled disc with a notch
  const bt = 0.016
  const geo = new THREE.ExtrudeGeometry(waferShape(), {
    depth: T - 2 * bt,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 12,
  })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, bt, 0)
  geo.computeVertexNormals()

  await nextFrame()
  const tile = dieTile(o.mobile ? 1024 : 2048, 29)
  tile.anisotropy = o.anisotropy
  await nextFrame()
  const atlas = clientAtlas(
    DIES.map((_, k) => ({ name: CLIENTS[k].name, company: CLIENTS[k].company })),
    o.mobile ? 256 : 512,
  )
  atlas.anisotropy = o.anisotropy

  const uniforms: WaferUniforms = {
    uTile: { value: tile },
    uAtlas: { value: atlas },
    uClient: { value: DIES.map(([x, z]) => new THREE.Vector2(x, z)) },
    uPower: { value: new Array(N).fill(0) },
    uPass: { value: new Array(N).fill(0) },
    uFocusD: { value: 5 },
    uFocusTol: { value: 0.06 },
    uAper: { value: 0 },
    uL0: { value: new THREE.Vector3(0, 0.6, -0.8).normalize() },
    uL1: { value: new THREE.Vector3(-0.8, 0.5, -0.2).normalize() },
    uDiff: { value: 0.5 },
    uPeriod: { value: 1.5 },
    uSignal: { value: new THREE.Color(S.signal) },
  }

  const topMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.55,
    roughness: 0.26,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [180, 620],
  })
  topMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWp;\nvarying vec3 vGx;\nvarying vec3 vGz;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
        vWp = position.xz;
        vGx = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vGz = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`,
    )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${FRAG_IRID}`)
  }
  topMat.customProgramCacheKey = () => 'hark-wafer-top-v2'
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#8a9098', metalness: 1, roughness: 0.16 })
  const top = new THREE.Mesh(geo, [topMat, edgeMat])
  stage.add(top)

  // the signal on the powered die: pulses round its seal ring (the only green on a client die, with the bin dot)
  const h = D / 2 - 0.006
  const ring = [
    new THREE.Vector3(-h, 0, -h),
    new THREE.Vector3(h, 0, -h),
    new THREE.Vector3(h, 0, h),
    new THREE.Vector3(-h, 0, h),
    new THREE.Vector3(-h, 0, -h + 0.0001),
  ]
  const signal = new Traces([ring], { width: 0.009 })
  signal.copper.visible = false
  signal.group.position.y = TOP + 0.0008
  stage.add(signal.group)

  return { stage, top, uniforms, signal, signalLen: Math.max(...signal.lengths) }
}

/* -------------------------------------------------------------- needles */

/** a tapered rod from a (radius ra) to b (radius rb) */
function rod(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const g = new THREE.CylinderGeometry(rb, ra, len, 6, 1, true)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
  g.translate(a.x, a.y, a.z)
  return g
}

/**
 * Cantilever probe needles converging on the die under the probe (origin):
 * a short bent tip down onto each pad, then a beam rising toward the card.
 * The beams fade out as they leave the focal plane (vertex alpha), so they
 * read as thin bright lines coming out of the blur. The group's y is the
 * lift (0 = touching down).
 */
export function buildProbe(): THREE.Group {
  const group = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  const rise = THREE.MathUtils.degToRad(24)
  for (const [axn, ayn, side] of TIPS) {
    const tip = new THREE.Vector3((axn - 0.5) * D, TOP + 0.0012, (ayn - 0.5) * D)
    const out = new THREE.Vector3()
    if (side === 0) out.set(tip.x * 0.7, 0, -1)
    else out.set(side === 1 ? -1 : 1, 0, tip.z * 0.4 - 0.35)
    out.normalize()
    const knee = tip.clone().addScaledVector(out, 0.022)
    knee.y += 0.06
    const len = 2.4
    const end = knee
      .clone()
      .addScaledVector(out, Math.cos(rise) * len)
      .add(new THREE.Vector3(0, Math.sin(rise) * len, 0))
    for (const g of [rod(tip, knee, 0.0011, 0.0026), rod(knee, end, 0.0026, 0.0048)]) {
      const p = g.getAttribute('position')
      const col = new Float32Array(p.count * 4)
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - tip.x, p.getY(i) - tip.y, p.getZ(i) - tip.z)
        const a = 1 - THREE.MathUtils.smoothstep(d, 0.2, 1.25)
        col.set([1, 1, 1, a], i * 4)
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4))
      geos.push(g)
    }
  }
  const merged = mergeGeometries(geos)!
  geos.forEach(g => g.dispose())
  const mat = new THREE.MeshStandardMaterial({ color: '#a3a9b1', metalness: 1, roughness: 0.3, vertexColors: true, transparent: true, depthWrite: false })
  const mesh = new THREE.Mesh(merged, mat)
  mesh.renderOrder = 3
  group.add(mesh)
  return group
}
