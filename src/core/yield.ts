/**
 * Yield to the browser between heavy init steps so the loader keeps painting.
 * rAF never fires in a hidden/background tab and setTimeout(0) is throttled
 * to ~1/s there, so hidden tabs yield with a MessageChannel macrotask instead
 * (and a timeout guards a tab hidden mid-wait). Use this everywhere instead of
 * a local `new Promise(r => setTimeout(r, 0))`.
 */
export const nextFrame = () =>
  new Promise<void>(resolve => {
    let done = false
    const r = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (document.hidden) {
      const ch = new MessageChannel()
      ch.port1.onmessage = r
      ch.port2.postMessage(0)
      return
    }
    requestAnimationFrame(r)
    setTimeout(r, 150)
  })
