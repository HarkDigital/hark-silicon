import * as THREE from 'three'
import Lenis from 'lenis'
import { Post } from './post'
import { Assets } from './assets'
import { World } from '../world/World'
import { clamp, damp } from './math'
import { buildChapterCopy } from './srContent'
import { nextFrame } from './yield'
import type { CameraPose, Chapter, ChapterContext, ChapterDef, Frame } from './types'

export interface ChapterSlot {
  def: ChapterDef
  chapter: Chapter
  ctx: ChapterContext
  /** scroll range in viewport heights */
  start: number
  end: number
  section: HTMLElement
  stage: HTMLElement
  failed: boolean
}

export interface EngineState {
  index: number
  local: number
  slots: ChapterSlot[]
  /** total scroll length in viewport heights */
  total: number
}

/** Scroll distance (in vh) on each side of a cut where the glitch ramps. */
const CUT_WINDOW = 0.18
/** Render-pixel budget: 4K/5K windows would otherwise push 15+ MP through bloom. */
const PIXEL_BUDGET = 6e6

function emptyChapter(id: string): Chapter {
  return {
    id,
    group: new THREE.Group(),
    init() {},
    update() {},
    camera(_l, _f, out) {
      out.position.set(0, 0, 10)
      out.target.set(0, 0, 0)
    },
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000)
  post: Post
  world: World
  assets: Assets
  lenis: Lenis
  slots: ChapterSlot[] = []
  state: EngineState = { index: 0, local: 0, slots: this.slots, total: 1 }
  frame: Frame
  pose: CameraPose = {
    position: new THREE.Vector3(0, 0, 10),
    target: new THREE.Vector3(),
    fov: 45,
    roll: 0,
    parallax: 0,
  }
  /** Listeners run after each frame's chapter update (HUD chrome, sound…). */
  onFrame: ((frame: Frame, state: EngineState) => void)[] = []
  onCut: ((from: number, to: number) => void)[] = []

  /** scroll-track viewport height (keyed on innerHeight so mobile URL bars don't relayout) */
  private vh = window.innerHeight
  private vw = window.innerWidth
  /** drawing size = the canvas's CSS box (100lvh on phones, stable while toolbars slide) */
  private cw = 0
  private ch = 0
  private dpr = 0
  private timer = new THREE.Timer()
  private lastScrollVh = 0
  private running = false
  private mobile: boolean
  private reducedMotion: boolean
  /** adaptive resolution: multiplier on the device pixel ratio, lowered when frames run long */
  private dprScale = 1
  private perfEma = 1 / 60
  private cadence: number[] = []
  private cadenceTick = 0
  private cadenceSorted = new Float32Array(120)
  private baseline = 1 / 60
  private slowFor = 0
  private fastFor = 0
  private perfCooldown = 0
  /** after a step up: the scale we came from, and how long to watch for a relapse */
  private upFrom = 0
  private upWatch = 0
  /** no stepping up past this until `ceilFor` runs out (a step up that relapsed) */
  private dprCeil = 1
  private ceilFor = 0
  /** time-driven cut used for long nav jumps (so we never scrub through five chapters) */
  private jump: { t: number; id: string; local: number; swapped: boolean } | null = null
  /** true while something (e.g. the rotate gate) covers the scene — skip rendering */
  paused = false
  private cutHold = 0
  private cutPeakAt = -1e9
  /**
   * Ambient motion on/off. When off, frame.time holds still once the intro
   * reveal has had time to play (3 s after 'hark:reveal').
   */
  motion = true
  private revealAt = -1
  /** called when the GPU context is gone for good (main.ts shows the fallback) */
  onContextGone: (() => void) | null = null
  private listenerFailed = new WeakSet<object>()
  private suppressFocusLand = false
  private tmpRight = new THREE.Vector3()
  private tmpUp = new THREE.Vector3()

  constructor(
    private canvas: HTMLCanvasElement,
    private track: HTMLElement,
    private stages: HTMLElement,
  ) {
    this.mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768
    // phones (and any device we've had to scale down) drop CSS backdrop-filter
    document.documentElement.classList.toggle('lowfx', this.mobile)
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    // THEME: clear colour, tone mapping and shadows.
    //   NeutralToneMapping suits bright/product scenes, ACES suits dark
    //   cinematic ones, NoToneMapping suits stylised post passes (palette
    //   snaps, ink densities). Shadows cost real GPU time — enable only if
    //   the look needs them (then keep the shadow frustum tight).
    this.renderer.setClearColor(0x05070b, 1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.shadowMap.enabled = false
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMappingExposure = 1
    this.renderer.info.autoReset = false
    this.renderer.debug.checkShaderErrors = !import.meta.env.PROD

    this.world = new World(this.scene, this.mobile, this.renderer)
    this.scene.add(this.world.object)
    this.assets = new Assets(this.renderer)
    // MSAA only where it pays: 1x desktop screens. Retina is already supersampled,
    // and multisampled half-float ping-pong targets cost ~1 GB of VRAM there.
    const msaa = !this.mobile && (window.devicePixelRatio || 1) < 1.5
    this.post = new Post(this.renderer, this.scene, this.camera, !msaa)

    this.frame = {
      time: 0,
      dt: 0.016,
      progress: 0,
      velocity: 0,
      pointer: new THREE.Vector2(),
      pointerRaw: new THREE.Vector2(),
      width: this.vw,
      height: this.vh,
      mobile: this.mobile,
      reducedMotion: this.reducedMotion,
    }

    this.lenis = new Lenis({
      autoRaf: false,
      lerp: this.reducedMotion ? 1 : 0.09,
      wheelMultiplier: 0.85,
      touchMultiplier: 1.4,
      smoothWheel: !this.reducedMotion,
    })

    this.resize(true)
    window.addEventListener('resize', () => this.resize())
    const toNdc = (e: PointerEvent) =>
      this.frame.pointerRaw.set((e.clientX / this.cw) * 2 - 1, -(e.clientY / this.ch) * 2 + 1)
    window.addEventListener('pointermove', toNdc)
    window.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement
      if (t.closest('a, button, input, textarea, select, label')) return
      toNdc(e)
      const slot = this.slots[this.state.index]
      slot?.chapter.onPointerDown?.(this.frame, slot.ctx)
    })

    // A lost context takes every baked texture/PMREM with it; a reload is the
    // only honest recovery.
    let lostTimer = 0
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      // if the GPU never gives the context back, reload once rather than
      // leave an empty sky with floating labels
      lostTimer = window.setTimeout(() => {
        // reload at most once a minute; a repeat loss shows the static copy
        // instead of an empty canvas under a live HUD
        let recent = false
        try {
          const last = Number(sessionStorage.getItem('hark:ctx-reload') || 0)
          recent = Date.now() - last < 60_000
          if (!recent) sessionStorage.setItem('hark:ctx-reload', String(Date.now()))
        } catch {
          /* storage blocked */
        }
        if (!recent) {
          location.reload()
          return
        }
        this.running = false
        this.onContextGone?.()
      }, 3000)
    })
    canvas.addEventListener('webglcontextrestored', () => {
      window.clearTimeout(lostTimer)
      location.reload()
    })

    // Scrolling by wheel/touch after focusing an item stop in the copy layer
    // would leave a stale focus pill on screen — drop that focus.
    const dropCopyFocus = () => {
      const a = document.activeElement as HTMLElement | null
      if (a && a.closest('.sr-copy')) a.blur()
    }
    window.addEventListener('wheel', dropCopyFocus, { passive: true })
    window.addEventListener('touchmove', dropCopyFocus, { passive: true })
  }

  /** Is WebGL2 available at all? */
  static supported() {
    try {
      const c = document.createElement('canvas')
      return !!c.getContext('webgl2')
    } catch {
      return false
    }
  }

  /**
   * Import and init every chapter. A chapter that throws is replaced with an
   * empty placeholder so one bad scene can never take the whole site down.
   * Inits run one per frame so the loader keeps animating.
   * `only` (debug) inits a single chapter and stubs the rest.
   */
  async load(defs: ChapterDef[], only?: string | null) {
    let cursor = 0
    for (const def of defs) {
      // the accessible, linear copy of the chapter lives in its scroll section;
      // the stage is the visual layer only
      const section = document.createElement('section')
      section.className = 'chapter'
      section.id = def.id
      section.dataset.chapter = def.id
      const copy = buildChapterCopy(def.id)
      if (copy) {
        section.appendChild(copy)
        const heading = copy.querySelector<HTMLElement>('h1, h2')
        if (heading) {
          heading.id ||= `${def.id}-title`
          section.setAttribute('aria-labelledby', heading.id)
        }
      }
      section.addEventListener('focusin', e => {
        if (this.suppressFocusLand) return
        // items (a project, a service, a quote…) can drive the timeline directly
        const target = e.target as HTMLElement
        const a = target.closest<HTMLElement>('[data-anchor]')
        const slot = this.slots.find(x => x.def.id === def.id)
        const anchor = a && slot?.chapter.anchors?.[Number(a.dataset.anchor)]
        // the section heading is a stop too: it lands on the chapter's intro beat
        if (/^H[12]$/.test(target.tagName) && def.intro != null) this.land(def.id, true, def.intro)
        else if (anchor != null) this.land(def.id, true, anchor)
        else if (this.slots[this.state.index]?.def.id !== def.id) this.land(def.id)
      })
      this.track.appendChild(section)

      const stage = document.createElement('div')
      stage.className = `stage stage-${def.id}`
      stage.dataset.chapter = def.id
      stage.setAttribute('aria-hidden', 'true')
      stage.inert = true
      this.stages.appendChild(stage)

      const ctx: ChapterContext = {
        renderer: this.renderer,
        camera: this.camera,
        world: this.world,
        post: this.post,
        assets: this.assets,
        stage,
        mobile: this.mobile,
        reducedMotion: this.reducedMotion,
      }
      const slot: ChapterSlot = {
        def,
        chapter: emptyChapter(def.id),
        ctx,
        start: cursor,
        end: cursor + def.length,
        section,
        stage,
        failed: false,
      }
      cursor += def.length
      this.slots.push(slot)
    }
    // one extra viewport so the last chapter can reach local = 1
    const tail = document.createElement('div')
    tail.className = 'track-tail'
    this.track.appendChild(tail)
    this.state.total = cursor
    this.layoutTrack()

    const active = this.slots.filter(s => !only || s.def.id === only)
    const modules = active.map(s => this.assets.track(s.def.load()).catch(err => err as Error))
    for (let i = 0; i < active.length; i++) {
      const slot = active[i]
      try {
        const mod = await modules[i]
        if (mod instanceof Error) throw mod
        slot.chapter = mod.default()
        await this.assets.track(Promise.resolve(slot.chapter.init(slot.ctx)))
      } catch (err) {
        console.error(`[hark] chapter "${slot.def.id}" failed to load`, err)
        slot.failed = true
        slot.chapter = emptyChapter(slot.def.id)
        slot.stage.replaceChildren()
      }
      slot.chapter.group.visible = false
      this.scene.add(slot.chapter.group)
      this.keyboardViaCopyLayer(slot.stage)
      await nextFrame()
    }
    for (const slot of this.slots) if (!slot.chapter.group.parent) this.scene.add(slot.chapter.group)

    await this.prewarm()
  }

  /**
   * Stages are aria-hidden visuals; keyboard and screen-reader users drive the
   * story through the linear copy in #track instead. Keep stage controls out
   * of the tab order (mouse/touch still work), including ones added later.
   */
  private keyboardViaCopyLayer(stage: HTMLElement) {
    const sweep = () =>
      stage
        .querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
        .forEach(el => {
          if (el.tabIndex !== -1) el.tabIndex = -1
        })
    sweep()
    new MutationObserver(sweep).observe(stage, { childList: true, subtree: true })
  }

  /**
   * Compile shaders against the REAL render target (HDR, linear, no tone
   * mapping) in parallel, then render each chapter at a few points so lazily
   * built materials, geometry and textures upload before the reveal.
   */
  private async prewarm() {
    // lit programs key on the environment map: give the scene its real one first
    ;(this.world as unknown as { warmEnv?: () => void }).warmEnv?.()
    const target = this.post.composer.renderTarget1
    // Compile each chapter with ONLY its own group (and lights) visible:
    // three keys programs on the visible light set, so compiling everything at
    // once builds variants no chapter ever uses and the real ones link later,
    // synchronously, on first entry.
    const compiles: Promise<unknown>[] = []
    this.renderer.setRenderTarget(target)
    for (const slot of this.slots) {
      for (const other of this.slots) other.chapter.group.visible = other === slot
      for (const l of [0.5, 0.04, 0.92]) {
        try {
          slot.chapter.update(l, this.frame, slot.ctx)
          // compile against this chapter's lights only: take the group out of the
          // scene (three gathers lights from both the scene and the object)
          const g = slot.chapter.group
          const probe = new THREE.Group()
          this.scene.remove(g)
          probe.add(g, this.world.object)
          compiles.push(this.renderer.compileAsync(probe, this.camera, this.scene).catch(() => {}))
          this.scene.add(g, this.world.object)
        } catch (err) {
          console.error(`[hark] chapter "${slot.def.id}" failed during compile`, err)
        }
      }
    }
    for (const slot of this.slots) slot.chapter.group.visible = false
    compiles.push(this.post.compileAsync())
    await Promise.all(compiles)
    await nextFrame()

    // the composer's own passes
    this.post.render(0.016, 0)
    await nextFrame()

    // Render each chapter at a few points so geometry/textures upload and the
    // GPU builds pipelines for the real attachment format (incl. MSAA).
    const rt = new THREE.WebGLRenderTarget(64, 64, {
      type: THREE.HalfFloatType,
      samples: target.samples,
    })
    for (const slot of this.slots) {
      try {
        slot.chapter.group.visible = true
        for (const l of [0.04, 0.92, 0.5]) {
          slot.chapter.update(l, this.frame, slot.ctx)
          slot.chapter.camera(l, this.frame, this.pose)
          this.applyCamera(0)
          this.renderer.setRenderTarget(rt)
          this.renderer.render(this.scene, this.camera)
        }
      } catch (err) {
        console.error(`[hark] chapter "${slot.def.id}" failed during prewarm`, err)
      } finally {
        slot.chapter.group.visible = false
      }
      await nextFrame()
    }
    this.renderer.setRenderTarget(null)
    rt.dispose()
  }

  private layoutTrack() {
    for (const slot of this.slots) {
      slot.section.style.height = `${slot.def.length * this.vh}px`
      // the chapter's accessible copy sits inside its settled range, so a
      // screen-reader cursor or Find in page scrolls the story to this chapter
      const copy = slot.section.querySelector<HTMLElement>('.sr-copy')
      if (copy) {
        const at = slot.def.intro ?? slot.def.landing ?? 0.1
        const top = Math.max(0, Math.min(at * slot.def.length + 1, slot.def.length - 1.2))
        copy.style.top = `${top * this.vh}px`
      }
    }
    const tail = this.track.querySelector<HTMLElement>('.track-tail')
    if (tail) tail.style.height = `${this.vh}px`
  }

  private resize(force = false) {
    const iw = window.innerWidth
    const ih = window.innerHeight
    // mobile URL bars change innerHeight constantly; only relayout the scroll
    // track on real changes so the page doesn't jump
    if (force || iw !== this.vw || Math.abs(ih - this.vh) > this.vh * 0.25) {
      // keep the visitor at the same point of the story across a relayout
      const progress = this.lenis && this.state.total > 0 ? this.lenis.scroll / (this.state.total * this.vh) : 0
      this.vw = iw
      this.vh = ih
      this.layoutTrack()
      this.lenis?.resize()
      if (!force && this.lenis && progress > 0) {
        this.lenis.scrollTo(progress * this.state.total * this.vh, { immediate: true, force: true })
      }
    }

    const w = this.canvas.clientWidth || iw
    const h = this.canvas.clientHeight || ih
    const base = Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2)
    const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))
    const dpr = Math.max(this.mobile ? 1 : 0.75, Math.min(base, budget) * this.dprScale)
    if (!force && w === this.cw && h === this.ch && Math.abs(dpr - this.dpr) < 1e-3) return
    this.cw = w
    this.ch = h
    this.dpr = dpr
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.post.setSize(w, h, dpr)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.frame.width = w
    this.frame.height = h
  }

  /** Where a nav jump should land inside a chapter: just past its cut, on settled copy. */
  landingFor(id: string) {
    const slot = this.slots.find(s => s.def.id === id)
    if (!slot) return 0
    return slot.def.landing ?? Math.min(0.2, Math.max(0.06, 0.34 / slot.def.length))
  }

  /**
   * Navigate to a chapter the way a visitor should see it. Neighbours scroll
   * smoothly; longer jumps cut (flash out, jump, flash in) instead of scrubbing
   * through every chapter in between.
   */
  land(id: string, smooth = true, at?: number) {
    const target = this.slots.findIndex(s => s.def.id === id)
    if (target < 0) return
    const local = at ?? this.landingFor(id)
    if (!smooth) return this.gotoChapter(id, local)
    if (Math.abs(target - this.state.index) <= 1) return this.gotoChapter(id, local, true)
    this.jump = { t: 0, id, local, swapped: false }
  }

  /**
   * Move keyboard focus to a chapter's heading in the copy layer (after an
   * in-page jump) without re-triggering the focus→land behaviour.
   */
  focusChapter(id: string) {
    const slot = this.slots.find(s => s.def.id === id)
    const heading = slot?.section.querySelector<HTMLElement>('h1, h2')
    if (!heading) return
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    this.suppressFocusLand = true
    heading.focus({ preventScroll: true })
    this.suppressFocusLand = false
  }

  /** Jump to global progress 0..1 (no smoothing). */
  goto(p: number) {
    this.jump = null
    const y = clamp(p) * this.state.total * this.vh
    this.lenis.scrollTo(y, { immediate: true, force: true })
  }

  /** Jump into a chapter at an exact local progress 0..1. */
  gotoChapter(id: string, local = 0, smooth = false) {
    const slot = this.slots.find(s => s.def.id === id)
    if (!slot) return
    if (!smooth) this.jump = null
    const y = (slot.start + clamp(local) * slot.def.length) * this.vh + 1
    this.lenis.scrollTo(y, smooth ? { duration: 1.8, force: true } : { immediate: true, force: true })
  }

  start() {
    if (this.running) return
    this.running = true
    let reported = false
    const loop = (ms: number) => {
      if (!this.running) return
      // re-arm first: one bad frame must never stop scrolling or rendering
      requestAnimationFrame(loop)
      this.timer.update(ms)
      this.lenis.raf(ms)
      if (this.paused) return
      try {
        this.tick()
      } catch (err) {
        if (!reported) console.error('[hark] frame failed', err)
        reported = true
      }
    }
    requestAnimationFrame(loop)
  }

  /**
   * Keep the frame rate up on weaker GPUs: drop the render resolution in
   * steps while frames run long relative to the display's own cadence (so a
   * 30 fps Low Power Mode cap is not mistaken for a slow GPU), and creep back
   * up once there's headroom.
   */
  private adaptResolution(raw: number, dt: number) {
    if (document.hidden || this.frame.time < 4 || this.jump) return
    this.cadence.push(raw)
    if (this.cadence.length > 120) this.cadence.shift()
    if (this.cadence.length >= 60 && ++this.cadenceTick % 20 === 0) {
      const sorted = this.cadenceSorted.subarray(0, this.cadence.length)
      sorted.set(this.cadence)
      sorted.sort()
      // the display's own interval — but never learn a GPU-bound rate as "the
      // display": anything slower than ~45 fps is treated as a slow frame
      this.baseline = Math.min(1 / 45, Math.max(1 / 144, sorted[Math.floor(sorted.length * 0.1)]))
    }
    this.perfEma += (raw - this.perfEma) * 0.05
    this.perfCooldown -= dt
    this.ceilFor -= dt
    if (this.ceilFor <= 0) this.dprCeil = 1
    // a step up that pushes frames past the cadence again is reverted at once
    // and capped for a minute (otherwise it can settle between the thresholds)
    if (this.upWatch > 0) {
      this.upWatch -= dt
      if (this.upWatch < 2.5 && this.perfEma > this.baseline * 1.12) {
        this.dprCeil = this.upFrom
        this.ceilFor = 60
        this.dprScale = this.upFrom
        this.upWatch = 0
        this.perfCooldown = 6
        this.resize()
        return
      }
    }
    const slow = this.perfEma > Math.min(1 / 45, Math.max(this.baseline * 1.25, 1 / 58))
    const fast = this.perfEma < Math.min(this.baseline * 1.1, 1 / 55)
    this.slowFor = slow ? this.slowFor + dt : 0
    this.fastFor = fast ? this.fastFor + dt : 0
    if (this.slowFor > 1.5 && this.dprScale > 0.5) {
      this.dprScale = Math.max(0.5, this.dprScale - 0.15)
      this.slowFor = 0
      this.upWatch = 0
      this.perfCooldown = 6
      this.resize()
    } else if (this.fastFor > 8 && this.dprScale < Math.min(1, this.dprCeil) && this.perfCooldown <= 0) {
      this.upFrom = this.dprScale
      this.dprScale = Math.min(1, this.dprCeil, this.dprScale + 0.1)
      this.fastFor = 0
      this.upWatch = 3
      this.perfEma = this.baseline
      this.resize()
    }
    document.documentElement.classList.toggle('lowfx', this.mobile || this.dprScale < 0.99)
  }

  private applyCamera(parallax: number) {
    const cam = this.camera
    const pose = this.pose
    cam.position.copy(pose.position)
    cam.up.set(0, 1, 0)
    cam.lookAt(pose.target)
    if (parallax) {
      this.tmpRight.setFromMatrixColumn(cam.matrixWorld, 0)
      this.tmpUp.setFromMatrixColumn(cam.matrixWorld, 1)
      cam.position
        .addScaledVector(this.tmpRight, this.frame.pointer.x * parallax)
        .addScaledVector(this.tmpUp, this.frame.pointer.y * parallax * 0.6)
      cam.lookAt(pose.target)
    }
    if (pose.roll) cam.rotateZ(pose.roll)
    if (cam.fov !== pose.fov) {
      cam.fov = pose.fov
      cam.updateProjectionMatrix()
    }
  }

  /** 0..1 strength of a time-driven cut in progress (long nav jumps). */
  private jumpFx(dt: number) {
    const j = this.jump
    if (!j) return 0
    const IN = 0.26
    const OUT = 0.5
    j.t += dt
    if (j.t < IN) {
      const x = j.t / IN
      return x * x
    }
    if (!j.swapped) {
      j.swapped = true
      const slot = this.slots.find(s => s.def.id === j.id)
      if (slot) {
        const y = (slot.start + j.local * slot.def.length) * this.vh + 1
        this.lenis.scrollTo(y, { immediate: true, force: true })
      }
    }
    const out = clamp((j.t - IN) / OUT)
    if (out >= 1) this.jump = null
    return 1 - out * out * (3 - 2 * out)
  }

  private tick() {
    const f = this.frame
    const raw = Math.max(this.timer.getDelta(), 0)
    f.dt = Math.min(raw, 1 / 20)
    if (this.revealAt < 0 && document.documentElement.dataset.ready === '1') this.revealAt = performance.now()
    const idle = this.motion || this.revealAt < 0 || performance.now() - this.revealAt < 3000
    if (idle) f.time += f.dt
    f.still = !idle
    this.adaptResolution(Math.min(raw, 0.1), f.dt)
    f.pointer.x = damp(f.pointer.x, f.pointerRaw.x, 3.5, f.dt)
    f.pointer.y = damp(f.pointer.y, f.pointerRaw.y, 3.5, f.dt)

    const fx = this.jumpFx(f.dt)

    const scrollVh = this.lenis.scroll / this.vh
    const vel = (scrollVh - this.lastScrollVh) / Math.max(f.dt, 1e-3)
    this.lastScrollVh = scrollVh
    // a nav jump teleports the scroll; don't let it register as warp speed
    f.velocity = this.jump ? damp(f.velocity, 0, 8, f.dt) : damp(f.velocity, vel, 8, f.dt)
    f.progress = clamp(scrollVh / this.state.total)

    // which chapter owns this scroll position?
    let index = this.slots.length - 1
    for (let i = 0; i < this.slots.length; i++) {
      if (scrollVh < this.slots[i].end) {
        index = i
        break
      }
    }
    const slot = this.slots[index]
    if (!slot) return
    const local = clamp((scrollVh - slot.start) / slot.def.length)

    // glitch ramps up approaching any internal cut and back down after it
    let d = Infinity
    let side = 1
    for (let i = 1; i < this.slots.length; i++) {
      const dd = scrollVh - this.slots[i].start
      if (Math.abs(dd) < d) {
        d = Math.abs(dd)
        side = dd < 0 ? -1 : 1
      }
    }
    const tr = clamp(1 - d / CUT_WINDOW)
    const scrollCut = tr * tr * (3 - 2 * tr)
    const cut = Math.max(scrollCut, fx)
    // which side of the cut we're on (the SEM beam scans down, then back into colour)
    this.post.cutSide = fx > scrollCut && this.jump ? (this.jump.swapped ? 1 : -1) : side
    // cut budget (WCAG 2.3.1): while boundaries come fast (a quick scroll or
    // a cut peaked < 0.5 s ago) hold the transition so they merge into one
    // continuous sheet instead of a train of full-frame dips
    const now = performance.now()
    if (cut > 0.9) this.cutPeakAt = now
    this.cutHold = Math.max(this.cutHold * Math.exp(-f.dt / 0.45), cut)
    const rapid = now - this.cutPeakAt < 500 || Math.abs(f.velocity) > 3
    const cutOut = rapid ? Math.max(cut, this.cutHold) : cut
    if (this.reducedMotion) {
      // no ripples or flashes: a quiet, shallow dip instead
      this.post.transition = 0
      this.post.fade = cutOut * 0.35
    } else {
      this.post.transition = cutOut
      this.post.fade = 0
    }

    if (index !== this.state.index || !slot.chapter.group.visible) {
      const prev = this.slots[this.state.index]
      if (prev && prev !== slot) {
        prev.chapter.group.visible = false
        prev.stage.classList.remove('is-active')
        prev.stage.inert = true
        prev.chapter.onLeave?.(prev.ctx)
      }
      slot.chapter.group.visible = true
      slot.stage.classList.add('is-active')
      slot.stage.inert = false
      slot.chapter.onEnter?.(slot.ctx)
      const from = this.state.index
      this.state.index = index
      // scrolled into another chapter by keyboard/scrollbar while a copy-layer
      // stop of a different chapter still has focus: move focus along (no pill
      // left over the wrong scene, and the next Tab continues from here)
      const ae = document.activeElement as HTMLElement | null
      const sec = ae?.closest<HTMLElement>('.chapter')
      if (!this.jump && ae && ae.closest('.sr-copy') && sec && sec.dataset.chapter !== slot.def.id) this.focusChapter(slot.def.id)
      document.documentElement.dataset.chapter = slot.def.id
      if (from !== index) {
        const url = index === 0 ? location.pathname + location.search : `#${slot.def.id}`
        try {
          history.replaceState(null, '', url)
        } catch {
          /* sandboxed */
        }
        for (const fn of this.onCut) fn(from, index)
      }
    }
    this.state.local = local

    this.post.resetParams()
    this.world.resetParams()
    this.pose.parallax = 0
    this.pose.roll = 0
    try {
      slot.chapter.update(local, f, slot.ctx)
      slot.chapter.camera(local, f, this.pose)
    } catch (err) {
      if (!slot.failed) console.error(`[hark] chapter "${slot.def.id}" crashed in update`, err)
      slot.failed = true
    }
    if (this.reducedMotion) {
      this.post.params.flash = Math.min(this.post.params.flash, 0.08)
      this.post.params.glitch = 0
    }
    this.applyCamera(this.reducedMotion ? 0 : this.pose.parallax)
    this.world.update(f, this.camera)

    for (const fn of this.onFrame) {
      try {
        fn(f, this.state)
      } catch (err) {
        if (!this.listenerFailed.has(fn)) console.error('[hark] frame listener failed', err)
        this.listenerFailed.add(fn)
      }
    }
    this.renderer.info.reset()
    this.post.render(f.dt, f.time)
  }
}
