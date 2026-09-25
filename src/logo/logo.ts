import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { MARK_SVG, WORDMARK_SVG } from './svgSource'
import { rng } from '../core/math'

/*
 * The Hark mark as geometry. Everything is normalized so the mark is
 * centered on the origin, 1 unit tall, y-up, lying in the XY plane.
 *
 *   logoShapes()          -> THREE.Shape[]  (two interlocking loops + center diamond)
 *   logoGeometry(opts)    -> extruded, beveled solid (centered in z)
 *   logoPoints(n, opts)   -> Float32Array xyz, area-uniform samples on the face
 *   logoOutlinePoints(n)  -> Float32Array xyz, evenly spaced along every contour
 *   logoOutlines()        -> THREE.Vector2[][] closed polylines (outer + holes)
 *   wordmarkShapes()      -> the full "HARK / DIGITAL DESIGN" lockup, same space (mark 1u tall)
 *
 * The three pieces of the mark are also exposed separately via
 * logoParts() -> { loopA, loopB, diamond } so chapters can animate them
 * independently (e.g. loops spinning apart to become a portal ring).
 */

let _mark: THREE.Shape[] | null = null
let _parts: { loopA: THREE.Shape[]; loopB: THREE.Shape[]; diamond: THREE.Shape[] } | null = null
let _word: THREE.Shape[] | null = null

function parse(svg: string, minSize: number) {
  const data = new SVGLoader().parse(svg)
  const groups: THREE.Shape[][] = []
  for (const path of data.paths) {
    const shapes = path.toShapes().filter(s => {
      const b = new THREE.Box2().setFromPoints(s.getPoints(8))
      const size = b.getSize(new THREE.Vector2())
      return Math.max(size.x, size.y) > minSize
    })
    if (shapes.length) groups.push(shapes)
  }
  return groups
}

/**
 * Ramer–Douglas–Peucker on a closed polyline: drops points that sit within
 * `eps` of the simplified outline. The SVG outlines arrive as ~5,200 tiny
 * line segments; at 1u tall, eps 0.0012 is far below one game pixel, keeps
 * every corner, and cuts the extrusion from ~104k to a few thousand triangles.
 */
function simplify(pts: THREE.Vector2[], eps: number): THREE.Vector2[] {
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-9) pts = pts.slice(0, -1)
  if (pts.length < 8) return pts
  // split the ring at its two most distant points so both halves are open runs
  let far = 0
  let best = -1
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].distanceToSquared(pts[0])
    if (d > best) {
      best = d
      far = i
    }
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[far] = 1
  const stack: [number, number][] = [
    [0, far],
    [far, pts.length],
  ]
  const eps2 = eps * eps
  while (stack.length) {
    const [a, b] = stack.pop()!
    const pa = pts[a]
    const pb = pts[b % pts.length]
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const len2 = dx * dx + dy * dy || 1e-12
    let idx = -1
    let dmax = eps2
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i].x - pa.x) * dx + (pts[i].y - pa.y) * dy) / len2))
      const ex = pa.x + dx * t - pts[i].x
      const ey = pa.y + dy * t - pts[i].y
      const d = ex * ex + ey * ey
      if (d > dmax) {
        dmax = d
        idx = i
      }
    }
    if (idx >= 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

const SIMPLIFY_EPS = 0.0012

/** Normalize shape groups in-place: center on (cx, cy), scale, flip y. */
function normalize(groups: THREE.Shape[][], cx: number, cy: number, scale: number) {
  const tx = (v: THREE.Vector2) => v.set((v.x - cx) * scale, -(v.y - cy) * scale)
  const out: THREE.Shape[][] = []
  for (const g of groups) {
    const gOut: THREE.Shape[] = []
    for (const s of g) {
      // rebuild from discretized points so the flip doesn't break winding logic
      const pts = simplify(
        s.getPoints(48).map(p => tx(p.clone())),
        SIMPLIFY_EPS,
      )
      if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse()
      const shape = new THREE.Shape(pts)
      for (const h of s.holes) {
        const hp = simplify(
          h.getPoints(48).map(p => tx(p.clone())),
          SIMPLIFY_EPS,
        )
        if (!THREE.ShapeUtils.isClockWise(hp)) hp.reverse()
        shape.holes.push(new THREE.Path(hp))
      }
      gOut.push(shape)
    }
    out.push(gOut)
  }
  return out
}

function ensureMark() {
  if (_mark) return
  // viewBox 0 0 1889.6 1889.9 — drop the three hairline slivers Illustrator left behind
  const groups = parse(MARK_SVG, 40)
  const norm = normalize(groups, 1889.6 / 2, 1889.9 / 2, 1 / 1889.9)
  // order in the file: loop (top-right), loop (bottom-left), diamond
  _parts = { loopA: norm[0] ?? [], loopB: norm[1] ?? [], diamond: norm[2] ?? [] }
  _mark = norm.flat()
}

export function logoShapes(): THREE.Shape[] {
  ensureMark()
  return _mark!
}

export function logoParts() {
  ensureMark()
  return _parts!
}

export function wordmarkShapes(): THREE.Shape[] {
  if (_word) return _word
  // viewBox 0 0 5784 1664; the mark occupies roughly x 125..1598, y 97..1583.
  const groups = parse(WORDMARK_SVG, 8)
  const markH = 1583 - 97
  _word = normalize(groups, 5784 / 2, 1664 / 2, 1 / markH).flat()
  return _word
}

export interface LogoGeometryOptions {
  /** extrusion depth in units (mark is 1u tall). default 0.14 */
  depth?: number
  bevel?: boolean
  bevelSize?: number
  bevelThickness?: number
  curveSegments?: number
  shapes?: THREE.Shape[]
}

/** Extruded solid, centered in z, with smooth normals where possible. */
export function logoGeometry(opts: LogoGeometryOptions = {}): THREE.BufferGeometry {
  const {
    depth = 0.14,
    bevel = true,
    bevelSize = 0.008,
    bevelThickness = 0.012,
    curveSegments = 24,
    shapes = logoShapes(),
  } = opts
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel,
    bevelSize,
    bevelThickness,
    // 2 bevel steps: toon shading + 3–4 px pixelation can't show more
    bevelSegments: bevel ? 2 : 0,
    curveSegments,
    steps: 1,
  })
  geo.translate(0, 0, -depth / 2)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** Flat face geometry (ShapeGeometry) of the mark. */
export function logoFaceGeometry(shapes = logoShapes()): THREE.BufferGeometry {
  return mergeVertices(new THREE.ShapeGeometry(shapes, 24))
}

/**
 * Area-uniform random points on the face of the mark.
 * `depth` spreads points through z in [-depth/2, depth/2].
 */
export function logoPoints(count: number, { depth = 0, seed = 7, shapes = logoShapes() } = {}): Float32Array {
  const rand = rng(seed)
  const geo = new THREE.ShapeGeometry(shapes, 24)
  const pos = geo.attributes.position
  const index = geo.index!
  const tris: number[] = []
  const areas: number[] = []
  let total = 0
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3()
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i))
    b.fromBufferAttribute(pos, index.getX(i + 1))
    c.fromBufferAttribute(pos, index.getX(i + 2))
    const area = new THREE.Triangle(a, b, c).getArea()
    total += area
    tris.push(index.getX(i), index.getX(i + 1), index.getX(i + 2))
    areas.push(total)
  }
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = rand() * total
    // binary search the cumulative areas
    let lo = 0,
      hi = areas.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (areas[mid] < r) lo = mid + 1
      else hi = mid
    }
    a.fromBufferAttribute(pos, tris[lo * 3])
    b.fromBufferAttribute(pos, tris[lo * 3 + 1])
    c.fromBufferAttribute(pos, tris[lo * 3 + 2])
    let u = rand(),
      v = rand()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    out[i * 3] = a.x + (b.x - a.x) * u + (c.x - a.x) * v
    out[i * 3 + 1] = a.y + (b.y - a.y) * u + (c.y - a.y) * v
    out[i * 3 + 2] = (rand() - 0.5) * depth
  }
  geo.dispose()
  return out
}

/** Closed outline polylines of every contour (outer boundaries and holes). */
export function logoOutlines(shapes = logoShapes(), divisions = 160): THREE.Vector2[][] {
  const out: THREE.Vector2[][] = []
  for (const s of shapes) {
    out.push(s.getSpacedPoints(divisions))
    for (const h of s.holes) out.push(h.getSpacedPoints(Math.max(24, divisions / 3)))
  }
  return out
}

/** Points evenly spaced along all outlines (by arc length), xyz with z = 0. */
export function logoOutlinePoints(count: number, shapes = logoShapes()): Float32Array {
  const lines = logoOutlines(shapes, 400)
  const segs: { a: THREE.Vector2; b: THREE.Vector2; len: number }[] = []
  let total = 0
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const len = line[i].distanceTo(line[i + 1])
      segs.push({ a: line[i], b: line[i + 1], len })
      total += len
    }
  }
  const out = new Float32Array(count * 3)
  const step = total / count
  let si = 0,
    acc = 0
  for (let i = 0; i < count; i++) {
    const target = i * step
    while (si < segs.length - 1 && acc + segs[si].len < target) {
      acc += segs[si].len
      si++
    }
    const s = segs[si]
    const t = s.len > 0 ? (target - acc) / s.len : 0
    out[i * 3] = s.a.x + (s.b.x - s.a.x) * t
    out[i * 3 + 1] = s.a.y + (s.b.y - s.a.y) * t
    out[i * 3 + 2] = 0
  }
  return out
}

/** Signed-distance-ish inside test in normalized mark space (for voxelizing). */
export function isInsideLogo(x: number, y: number, shapes = logoShapes()): boolean {
  const p = _p.set(x, y)
  for (const s of polysFor(shapes)) {
    if (x < s.box.min.x || x > s.box.max.x || y < s.box.min.y || y > s.box.max.y) continue
    if (pointInPoly(p, s.outer)) {
      let inHole = false
      for (const h of s.holes) if (pointInPoly(p, h)) inHole = true
      if (!inHole) return true
    }
  }
  return false
}

const _p = new THREE.Vector2()
type Poly = { outer: THREE.Vector2[]; holes: THREE.Vector2[][]; box: THREE.Box2 }
const _polys = new WeakMap<THREE.Shape[], Poly[]>()
/** outline polygons per shapes array, built once (callers test thousands of points) */
function polysFor(shapes: THREE.Shape[]): Poly[] {
  let out = _polys.get(shapes)
  if (!out) {
    out = shapes.map(s => {
      const outer = s.getPoints(32)
      return { outer, holes: s.holes.map(h => h.getPoints(32)), box: new THREE.Box2().setFromPoints(outer) }
    })
    _polys.set(shapes, out)
  }
  return out
}

function pointInPoly(p: THREE.Vector2, poly: THREE.Vector2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
