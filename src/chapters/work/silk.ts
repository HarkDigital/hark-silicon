import * as THREE from 'three'

/*
 * Silkscreen for a whole board in ONE draw call: every label, outline, pin-1
 * triangle and dot is a quad into one canvas atlas. Lies flat on XZ; text
 * reads left→right seen from the front (+z), its "up" toward −z.
 *
 *   const silk = new SilkAtlas()
 *   silk.text('DS1', x, z, { h: 0.3 })
 *   silk.rect(x0, z0, x1, z1, 0.03)
 *   const mesh = silk.build()        // after fonts are loaded
 */

type Align = 'left' | 'center' | 'right'
interface TextItem {
  kind: 'text'
  s: string
  x: number
  z: number
  h: number
  rot: number
  align: Align
  weight: number
}
interface QuadItem {
  kind: 'quad'
  /** 4 corners (x, z) in order a, b, c, d (a→b = +u, a→d = +v) */
  c: number[]
  patch: 'solid' | 'dot' | 'tri'
}
type Item = TextItem | QuadItem

const FONT_PX = 72
const CELL_PAD = 6

export class SilkAtlas {
  private items: Item[] = []

  text(s: string, x: number, z: number, o: { h?: number; rot?: number; align?: Align; weight?: number } = {}) {
    this.items.push({ kind: 'text', s, x, z, h: o.h ?? 0.24, rot: o.rot ?? 0, align: o.align ?? 'left', weight: o.weight ?? 500 })
    return this
  }

  /** a straight line of width lw */
  line(ax: number, az: number, bx: number, bz: number, lw = 0.03) {
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    const nx = (-dz / len) * (lw / 2)
    const nz = (dx / len) * (lw / 2)
    // extend by half a width so corners close
    const ex = (dx / len) * (lw / 2)
    const ez = (dz / len) * (lw / 2)
    this.items.push({
      kind: 'quad',
      c: [ax - ex + nx, az - ez + nz, bx + ex + nx, bz + ez + nz, bx + ex - nx, bz + ez - nz, ax - ex - nx, az - ez - nz],
      patch: 'solid',
    })
    return this
  }

  rect(x0: number, z0: number, x1: number, z1: number, lw = 0.03) {
    this.line(x0, z0, x1, z0, lw).line(x1, z0, x1, z1, lw).line(x1, z1, x0, z1, lw).line(x0, z1, x0, z0, lw)
    return this
  }

  /** corner brackets only (a component courtyard) */
  corners(x0: number, z0: number, x1: number, z1: number, len = 0.5, lw = 0.03) {
    this.line(x0, z0, x0 + len, z0, lw).line(x0, z0, x0, z0 + len, lw)
    this.line(x1, z0, x1 - len, z0, lw).line(x1, z0, x1, z0 + len, lw)
    this.line(x1, z1, x1 - len, z1, lw).line(x1, z1, x1, z1 - len, lw)
    this.line(x0, z1, x0 + len, z1, lw).line(x0, z1, x0, z1 - len, lw)
    return this
  }

  dot(x: number, z: number, r = 0.06) {
    this.items.push({ kind: 'quad', c: [x - r, z + r, x + r, z + r, x + r, z - r, x - r, z - r], patch: 'dot' })
    return this
  }

  /** a pin-1 triangle pointing along angle `rot` (0 = toward +x) */
  tri(x: number, z: number, size = 0.18, rot = 0) {
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const p = (u: number, v: number) => [x + u * c - v * s, z + u * s + v * c]
    const r = size / 2
    this.items.push({ kind: 'quad', c: [...p(-r, r), ...p(r, r), ...p(r, -r), ...p(-r, -r)], patch: 'tri' })
    return this
  }

  build(color: THREE.ColorRepresentation = '#e6e6df'): THREE.Mesh {
    const probe = document.createElement('canvas').getContext('2d')!
    const fontOf = (w: number) => `${w} ${FONT_PX}px 'Martian Mono Variable', ui-monospace, monospace`
    // measure + shelf-pack
    const W = 2048
    const cellH = Math.ceil(FONT_PX * 1.3)
    type Placed = { item: TextItem; x: number; y: number; w: number }
    const placed: Placed[] = []
    let cx = 0
    let cy = 80 // row 0 holds the solid/dot/tri patches
    for (const it of this.items) {
      if (it.kind !== 'text') continue
      probe.font = fontOf(it.weight)
      const w = Math.min(W - 2 * CELL_PAD, Math.ceil(probe.measureText(it.s).width) + 2 * CELL_PAD)
      if (cx + w > W) {
        cx = 0
        cy += cellH
      }
      placed.push({ item: it, x: cx, y: cy, w })
      cx += w
    }
    const H = Math.min(4096, THREE.MathUtils.ceilPowerOfTwo(cy + cellH))
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const g = cv.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(4, 4, 24, 24) // solid
    g.beginPath()
    g.arc(64, 32, 28, 0, Math.PI * 2) // dot
    g.fill()
    g.beginPath()
    g.moveTo(104, 4) // triangle pointing +u (right)
    g.lineTo(160, 32)
    g.lineTo(104, 60)
    g.closePath()
    g.fill()
    g.textBaseline = 'middle'
    for (const p of placed) {
      g.font = fontOf(p.item.weight)
      g.fillText(p.item.s, p.x + CELL_PAD, p.y + cellH / 2)
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter

    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let v = 0
    const U = (px: number) => px / W
    const V = (py: number) => 1 - py / H
    const quad = (c: number[], u0: number, v0: number, u1: number, v1: number) => {
      // a (u0,v0) b (u1,v0) c (u1,v1) d (u0,v1)
      pos.push(c[0], 0, c[1], c[2], 0, c[3], c[4], 0, c[5], c[6], 0, c[7])
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
      v += 4
    }
    for (const it of this.items) {
      if (it.kind !== 'quad') continue
      if (it.patch === 'solid') quad(it.c, U(10), V(22), U(22), V(10))
      else if (it.patch === 'dot') quad(it.c, U(36), V(60), U(92), V(4))
      else quad(it.c, U(102), V(62), U(162), V(2))
    }
    for (const p of placed) {
      const it = p.item
      const scale = it.h / FONT_PX // cm per px
      const qw = p.w * scale
      const qh = cellH * scale
      const ox = it.align === 'left' ? 0 : it.align === 'center' ? -qw / 2 : -qw
      const c = Math.cos(it.rot)
      const s = Math.sin(it.rot)
      // local u → +x, local v (text up) → −z; rotate about y by rot
      const P = (lu: number, lv: number) => {
        const lx = lu
        const lz = -lv
        return [it.x + lx * c + lz * s, it.z - lx * s + lz * c]
      }
      const a = P(ox, -qh / 2)
      const b = P(ox + qw, -qh / 2)
      const cc = P(ox + qw, qh / 2)
      const d = P(ox, qh / 2)
      quad([...a, ...b, ...cc, ...d], U(p.x), V(p.y + cellH), U(p.x + p.w), V(p.y))
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
    geo.setIndex(idx)
    geo.computeBoundingSphere()
    const mat = new THREE.MeshStandardMaterial({
      color,
      map: tex,
      // opaque cut-out, so the depth-of-field veil blurs it with the board
      alphaTest: 0.42,
      roughness: 0.82,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 1
    return mesh
  }
}
