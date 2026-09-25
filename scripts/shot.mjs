// Headless screenshots of the WebGL story at exact scroll positions.
//
//   node scripts/shot.mjs --frames=hero:0,hero:0.5,work:0.3 [--port=5173] [--out=shots]
//                         [--w=1440] [--h=900] [--mobile] [--wait=1800] [--only=hero]
//                         [--tag=name] [--mouse=0.3,-0.2] [--rm]
//
// Each frame is "<chapter>:<local 0..1>" or "p:<global 0..1>". Images land in
// <out>/<tag?>-<chapter>-<local>.png. Console errors from the page are printed,
// and the process exits 1 if any were seen, so it doubles as a smoke test.
// Requires the dev server (npm run dev -- --port <port>) to be running.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)
const port = args.port ?? 5173
const out = args.out ?? 'shots'
const mobile = !!args.mobile
const W = parseInt(args.w ?? (mobile ? 390 : 1440), 10)
const H = parseInt(args.h ?? (mobile ? 844 : 900), 10)
const WAIT = parseInt(args.wait ?? 1800, 10)
const frames = String(args.frames ?? 'hero:0').split(',')
const tag = args.tag ? `${args.tag}-` : mobile ? 'm-' : ''
fs.mkdirSync(out, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization'],
})
const errors = []
try {
  const page = await browser.newPage()
  if (mobile) {
    await page.emulate({
      viewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
  } else {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  }
  // --rm: emulate prefers-reduced-motion (check every module's calm path)
  if (args.rm) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warn' || m.type() === 'log') {
      const t = m.text()
      if (m.type() === 'error') errors.push(t)
      console.log(`[page ${m.type()}] ${t}`)
    }
  })
  page.on('pageerror', e => {
    errors.push(String(e))
    console.log(`[pageerror] ${e}`)
  })

  const q = new URLSearchParams({ nointro: '1' })
  if (args.only) q.set('only', args.only)
  if (args.debug) q.set('debug', '1')
  await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load', timeout: 90000 })
  await page.waitForFunction('window.__hark && window.__hark.ready', { timeout: 90000 })
  await new Promise(r => setTimeout(r, 800))

  if (args.mouse) {
    const [mx, my] = String(args.mouse).split(',').map(Number)
    await page.mouse.move(((mx + 1) / 2) * W, ((1 - my) / 2) * H, { steps: 8 })
  }

  for (const f of frames) {
    const [id, l] = f.split(':')
    const local = parseFloat(l ?? '0')
    // a dev-server reload mid-run silently resets the page to the hero, so
    // confirm the engine is in the requested chapter before capturing
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.waitForFunction('window.__hark && window.__hark.ready', { timeout: 90000 })
      if (id === 'p') await page.evaluate(v => window.__hark.goto(v), local)
      else await page.evaluate((c, v) => window.__hark.gotoChapter(c, v), id, local)
      await new Promise(r => setTimeout(r, WAIT))
      if (id === 'p') break
      const at = await page
        .evaluate(() => {
          const s = window.__hark?.engine.state
          return s ? s.slots[s.index].def.id : null
        })
        .catch(() => null)
      if (at === id) break
      console.log(`[shot] expected ${id}, found ${at} — retrying`)
    }
    const file = path.join(out, `${tag}${id}-${local.toFixed(local * 100 === Math.round(local * 100) ? 2 : 3)}.png`)
    await page.screenshot({ path: file })
    console.log(`saved ${file}`)
  }
} finally {
  // close() can hang when two headless Chromes run at once: don't wait forever
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))])
}
if (errors.length) console.log(`\n${errors.length} console error(s)`)
process.exit(errors.length ? 1 : 0)
