import type * as THREE from 'three'
import type { Post } from './post'
import type { Assets } from './assets'
import type { World } from '../world/World'

/** Per-frame state handed to every update. */
export interface Frame {
  /** seconds since the experience started */
  time: number
  /** clamped frame delta in seconds */
  dt: number
  /** smoothed global scroll progress, 0..1 across the whole experience */
  progress: number
  /** smoothed scroll velocity in viewport-heights per second (signed) */
  velocity: number
  /** smoothed pointer, -1..1 (x right, y up) — use for parallax */
  pointer: THREE.Vector2
  /** raw pointer, -1..1 — use for raycasting / hover */
  pointerRaw: THREE.Vector2
  width: number
  height: number
  /** true on narrow / touch devices — fewer particles, simpler shaders */
  mobile: boolean
  /** true when the user prefers reduced motion — calm idle animation */
  reducedMotion: boolean
  /**
   * true while the visitor has paused ambient motion (a Motion toggle sets
   * engine.motion = false): frame.time stops advancing, so idle animation
   * holds still. Scroll-driven motion, cuts and damping (frame.dt) continue.
   */
  still?: boolean
}

/** Camera pose a chapter writes each frame. The engine adds pointer parallax. */
export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
  /** vertical field of view in degrees */
  fov: number
  /** roll around the view axis, radians */
  roll: number
  /** how much pointer parallax to apply (world units at the camera). 0 = none */
  parallax: number
}

/** Everything a chapter may touch. */
export interface ChapterContext {
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  /**
   * The shared world (backdrop + lighting). Set world.params each frame you
   * care (the engine resets them to defaults first). THEME: replace
   * src/world/World.ts and update this comment.
   */
  world: World
  post: Post
  assets: Assets
  /** The chapter's own fixed, full-screen DOM overlay. Put all HUD copy here. */
  stage: HTMLElement
  mobile: boolean
  reducedMotion: boolean
}

/**
 * A chapter is one "scene" of the scroll story. Only the active chapter's
 * group is visible; the engine hides the cut between chapters with a
 * transition in post (src/core/post.ts, THEME). Keep the first and last ~4% of local
 * progress visually "busy" (camera moving fast, bright) so the cut reads as
 * intentional.
 */
export interface Chapter {
  id: string
  /** 3D content. Added to the scene by the engine; visible only while active. */
  group: THREE.Group
  /** Build geometry/materials/DOM. May await textures. */
  init(ctx: ChapterContext): Promise<void> | void
  /**
   * Called every frame while active. `local` is 0..1 progress through this
   * chapter's scroll range.
   */
  update(local: number, frame: Frame, ctx: ChapterContext): void
  /** Write the camera pose for this local progress. */
  camera(local: number, frame: Frame, out: CameraPose): void
  onEnter?(ctx: ChapterContext): void
  onLeave?(ctx: ChapterContext): void
  /**
   * Local progress of each item in this chapter (a project, a service, a
   * quote…), in the order of the chapter's items in the accessible copy layer
   * (src/core/srContent.ts, data-anchor="i"). Keyboard focus on item i lands
   * the story at anchors[i].
   */
  anchors?: number[]
  /** Optional hover/click raycast hooks (pointer in NDC). */
  onPointerDown?(frame: Frame, ctx: ChapterContext): void
}

/** A chapter module default-exports a factory. */
export type ChapterFactory = () => Chapter

export interface ChapterDef {
  id: string
  /** Short HUD label, e.g. "Signal" */
  label: string
  /** Scroll length in viewport heights */
  length: number
  /** Local progress where nav jumps land (just past the cut, copy settled). Default derives from length. */
  landing?: number
  /** Local progress where the section headline shows (heading Tab stop lands here). */
  intro?: number
  load: () => Promise<{ default: ChapterFactory }>
}
