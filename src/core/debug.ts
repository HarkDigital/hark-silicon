import type { Engine } from './Engine'

/** ?debug overlay: fps, active chapter, local + global progress, draw calls. */
export function mountDebug(engine: Engine) {
  const box = document.createElement('div')
  box.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:200;font:11px/1.5 ui-monospace,monospace;color:#00ff85;background:rgba(0,0,0,.7);padding:6px 8px;pointer-events:none;white-space:pre'
  document.body.appendChild(box)
  let frames = 0
  let acc = 0
  let fps = 0
  engine.onFrame.push((f, s) => {
    frames++
    acc += f.dt
    if (acc > 0.5) {
      fps = Math.round(frames / acc)
      frames = 0
      acc = 0
    }
    const slot = s.slots[s.index]
    const info = engine.renderer.info
    box.textContent =
      `${fps} fps  dpr ${engine.renderer.getPixelRatio().toFixed(2)}\n` +
      `${slot?.def.id} local ${s.local.toFixed(3)}  global ${f.progress.toFixed(3)}\n` +
      `vel ${f.velocity.toFixed(2)}  calls ${info.render.calls}  tris ${info.render.triangles}`
  })
}
