// Smoke-test a deployed (or local) site: every chapter via land(), desktop and
// mobile, reporting ready time, failed chapters and console errors.
//
//   node scripts/live-check.mjs https://harkdigital.github.io/hark-<name>/
//   node scripts/live-check.mjs http://localhost:5690/
//
// Exits 1 if any chapter failed or any console error was logged.
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const base = process.argv[2]
if (!base) {
  console.error('usage: node scripts/live-check.mjs <url>')
  process.exit(2)
}
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--hide-scrollbars'] })
let bad = false
for (const mobile of [false, true]) {
  const p = await b.newPage()
  if (mobile)
    await p.emulate({
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
  else await p.setViewport({ width: 1440, height: 900 })
  const errs = []
  p.on('pageerror', e => errs.push(String(e)))
  p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  const t0 = Date.now()
  const sep = base.includes('?') ? '&' : '?'
  await p.goto(`${base}${sep}nointro&v=${Date.now()}`, { waitUntil: 'load' })
  await p.waitForFunction('window.__hark && window.__hark.ready', { timeout: 90000 })
  const ready = Date.now() - t0
  const ids = await p.evaluate(() => window.__hark.engine.slots.map(s => s.def.id))
  for (const id of ids.slice(1)) {
    await p.evaluate(i => window.__hark.land(i, false), id)
    await new Promise(r => setTimeout(r, 800))
  }
  const failed = await p.evaluate(() => window.__hark.engine.slots.filter(s => s.failed).map(s => s.def.id))
  console.log(`${mobile ? 'mobile ' : 'desktop'} ready ${ready}ms  failed: ${JSON.stringify(failed)}  errors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`)
  if (failed.length || errs.length) bad = true
  await p.close()
}
await b.close()
process.exit(bad ? 1 : 0)
