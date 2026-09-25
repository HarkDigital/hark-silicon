# Hark Concept Sites: Playbook

How to build another scroll-driven WebGL concept site for **Hark Digital
Design**, the way Orbit, Resonance, Press, Town and Arcade were built. Read
this whole file before starting. It records the process that worked, the
engine, and the rules learned the hard way.

---

## 1. What we're making

A full-screen, scroll-driven WebGL "story" site: one fixed canvas, seven
chapters, each a cinematic scene with its own copy, joined by a themed
transition. Each concept is a **completely different art direction** built on
the same engine and the same client content. Each ships to its own GitHub
Pages URL so the owner, Mike, can compare them side by side.

### Existing concepts (do not repeat their look)

| Concept | Live URL | Folder (`Claude Code/…`) | Rendering | Palette / type | Cut transition | Motion |
|---|---|---|---|---|---|---|
| Classic build | https://harkdigital.github.io/hark-digital-2026/ | `Clients/Hark Digital 2026 Website/site-v2` (**read-only**) | React site | black + #00ff85 | n/a | n/a |
| **Orbit** | https://harkdigital.github.io/hark-igloo/ | `Hark Igloo` | dark cinematic 3D space, bloom | black, signal green; Syne / Inter / JetBrains Mono | glitch + zoom blur | camera flights, decoding text |
| **Resonance** | https://harkdigital.github.io/hark-resonance/ | `Hark Resonance` | photoreal PBR studio, liquid chrome | bone white, chrome, LED green; Inter Tight + Instrument Serif italic | pressure-wave ripple | damped springs, product-film dolly |
| **Press** | https://harkdigital.github.io/hark-press/ | `Hark Press` | ink densities → risograph halftone pass | newsprint, pink/green/black ink; Bricolage condensed | green ink flood | stamping, folding, stop-motion "on twos" |
| **Town** | https://harkdigital.github.io/hark-town/ | `Hark Town` | tilt-shift miniature, clay, soft shadows | sunny pastels, time of day; Fraunces + Figtree | cloud wipe | pop-up springs, trams, day→sunset |
| **Arcade** | https://harkdigital.github.io/hark-arcade/ | `Hark Arcade` | pixelate + 16-colour palette + CRT pass | Hark-16 palette; Pixelify / Silkscreen / VT323 | pixel iris wipe | stepped sprites, game feel |

**Untried directions:**
- Botanical greenhouse / terrarium (growth, macro, dew)
- Blueprint / technical drawing (line-draw reveals)
- Sumi-e ink wash
- Brutalist concrete architecture
- Claymation stop-motion
- Comic book (panels, halftone speed lines, SFX lettering)
- Film noir / cinema
- Vaporwave OS desktop (windows, icons)
- Transit / subway map
- Board game
- Knitted textile
- Chemistry lab
- Weather / meteorology
- Museum gallery
- Deep-sea bioluminescence (would need to feel different from Orbit)

When choosing, fill a row of the table above and make sure **every column**
differs from the existing rows.

---

## 2. Non-negotiables

- **Never modify** anything under `…/Mike Harkins/Clients/`. The original
  site (`Clients/Hark Digital 2026 Website`) is a read-only source.
- **Never modify the other concept folders.** Reading them for patterns is fine.
- Every concept gets a **new folder** `Claude Code/Hark <Name>`, a **new public
  repo** `HarkDigital/hark-<name>`, and its **own GitHub Pages site**
  `https://harkdigital.github.io/hark-<name>/`.
- **All copy comes verbatim** from the original site's data, via `src/content.ts`.
  - Don't invent business facts. Playful decorative text (job numbers,
    "Pop. 63", HUD scores) is fine only when it clearly isn't a claim.
  - The City Line Capital URL is on `harktest.com`, a pre-launch build:
    label it **Preview**, never "live".
  - Use **US English** (center, not centre; no Britishisms).
  - Don't repeat the tagline everywhere. Use the original section headlines:
    "Built to be heard.", "Eleven ways to be heard.", "We listen. They talk.",
    "We listen first. Then we build.", "Hacked? Breathe.", "Say hello."
  - Give each concept its own microcopy (`MICROCOPY` in content.ts).
- The site must be **noindex**. The deploy workflow injects it; the concept
  must never compete with hark.digital in search.
- Commits end with `Co-Authored-By: Claude …`. Commit or push only as part of
  this workflow (the owner has authorised deploying concepts to Pages).

---

## 3. Inputs

| What | Where |
|---|---|
| Services (11), work (15), testimonials (8) | `Clients/Hark Digital 2026 Website/site-v2/src/data/{services,work,testimonials}.ts` |
| Process steps and stats | `site-v2/src/data/servicePages.ts` (Software Development `process` + `stat` fields) |
| Section headlines | `site-v2/src/sections/{Work,Services,Testimonials}.tsx` |
| Logo mark / wordmark | `Clients/Hark Digital 2026 Website/Logo Piece.svg`, `Hark-Logo.svg` |
| Portfolio screenshots (1280×800 webp) | `site-v2/public/work/*.webp` |
| **All of the above, already extracted** | the template's `src/content.ts`, `src/logo/*`, `public/work`, `public/logo` |

---

## 4. The engine (copy it; don't rebuild it)

**Template: `Claude Code/Hark Town`.** Its core has every fix to date (Arcade
shares it). Copy these verbatim:

```
src/core/   Engine.ts post.ts assets.ts dom.ts math.ts scramble.ts glsl.ts
            types.ts debug.ts srContent.ts yield.ts
src/logo/   logo.ts svgSource.ts
src/content.ts   src/main.ts
src/ui/     mark.ts inert.ts polyfills.ts   (fallback.ts: rewrite simply, see §6)
scripts/shot.mjs
tsconfig.json vite.config.ts vite.shots.config.ts .gitignore
.github/workflows/deploy.yml
public/work  public/logo  public/favicon.svg
```

**Then replace per theme:**

- **`src/world/World.ts`**: the shared backdrop/lighting module. Keep the method
  names the engine calls: `object`, `params`, `resetParams()`,
  `update(frame, camera)`. Rewrite the internals for the theme (sky dome,
  studio env map, or nothing). Update the `world` doc comment in `types.ts`.
- **`src/core/post.ts` final pass**: the theme's signature look (tilt-shift,
  riso, CRT…) plus its **cut transition**, driven by `uTransition`, which
  peaks at each chapter boundary. Keep the `Post` API (`params`,
  `resetParams`, `setSize`, `render`, `compileAsync`, `setFadeTone`).
  Pipeline: Render → Sanitize (NaN guard) → Bloom → Output → Final.
- **Engine renderer settings**: tone mapping, clear colour, shadows on or off.
- **`src/styles/base.css`**:
  - Tokens and fonts.
  - The HUD vocabulary: `.hud-eyebrow .hud-title .hud-h2 .hud-body .hud-quote .hud-label .hud-tags/.hud-tag .hud-btn(--ghost) .hud-panel .hud-rule .callout*`.
  - The `.rise` word reveal, restyled per theme.
  - Keep the structural rules: `#gl`, `#track`, `#stages`, `.stage`,
    `#chrome`, `#loader` (z 130), `.sr-copy` focus pills, `.skip-link`,
    reduced motion.
- **`src/main.ts`**: font imports (`@fontsource…`).
- **`index.html`**: title, description, and OG tags (`og:url`, `og:image`
  → `https://harkdigital.github.io/hark-<name>/og.jpg`).
- **`src/content.ts`**:
  - Add the previous concept's URL to `BRAND` (e.g. `arcadeSite`).
  - Set new `MICROCOPY` (`signalEyebrow`, `scrollHint`, audio labels).
- **`src/core/srContent.ts`**: add the new sister link to the contact "Elsewhere" line.
- **`src/ui/mark.ts`**: `CONCEPT_TAG` → `Concept · <Name>`.
- **`src/chapters/index.ts`**: chapter ids, labels, lengths and landings.
- **UI stubs** (loader, chrome, sound, rotate): write minimal versions with
  the right APIs; the UI agent replaces them (see §6).
- **A shared kit** (`src/kit/*`) of theme primitives, so every chapter speaks
  one visual language. Examples: Town's clay props; Arcade's
  `toon/voxels/sprite/pixelText`; Press's ink materials.

### Chapter API (`src/core/types.ts`)

```ts
interface Chapter {
  id: string
  group: THREE.Group                                   // visible only while active
  init(ctx): Promise<void> | void                      // build everything; yield with nextFrame()
  update(local: number, frame: Frame, ctx): void       // local = 0..1 through this chapter
  camera(local: number, frame: Frame, out: CameraPose): void
  anchors?: number[]                                   // local position of each item (keyboard focus lands here)
  onEnter?, onLeave?, onPointerDown?
}
// ctx: renderer, camera, world, post, assets, stage (fixed DOM overlay), mobile, reducedMotion
// ChapterDef: { id, label, length (viewport heights), landing? (local where nav lands), load }
```

Engine facts:
- Only the active chapter renders.
- `post.params` and `world.params` reset to defaults every frame before `update`.
- `window.__hark`:
  - `land(id, smooth?, local?)`: visitor navigation. Lands on settled copy;
    long jumps run a time-driven cut.
  - `gotoChapter(id, local)`: exact jumps, for tests only.
  - `goto(p)`: jump to overall progress.
  - `engine`: the engine instance.
- `engine.paused` skips rendering.
- `engine.focusChapter(id)` moves keyboard focus to a chapter heading.

### Standard story (7 chapters)

| id | Content | Typical length (vh) / landing |
|---|---|---|
| hero | BRAND.tagline, manifesto, CTAs "See the work" → `land('work')`, "Start a project" → `land('contact')` | 2.6 / 0 |
| work | SECTIONS.work; 6 featured WORK items with screenshots, then "Nine more, all live." + Say hello | 3.8 / 0.12 |
| services | SECTIONS.services; 11 SERVICES (title, blurb, tags), 01–11 index | 3.6–4.4 / 0.08 |
| voices | SECTIONS.voices; 8 TESTIMONIALS, one at a time, comfortable dwell | 3.0–3.4 / 0.05–0.08 |
| shield | SECURITY (eyebrow, "Hacked? Breathe.", body, CTA) + the 24/7 stat | 1.6–1.9 / 0.45 |
| process | "We listen first. Then we build." + PROCESS (4 steps) + STATS (10 years, $1M+, 15) | 1.8–2.2 / 0.17–0.19 |
| contact | CONTACT + big email CTA + Copy email + links to all sister concepts + Back to top (`land('hero')`) + footer; ends conclusively | 1.4–1.6 / 0.3 |

Work comes right after the hero (proof first, like the original home page).
The order can change if the concept demands it. Resonance put the
testimonials right after the record crate, for example.

---

## 5. The process (what worked)

The owner runs these with **ultracode** / multi-agent **workflows**. Each
concept took about **4 workflows** and roughly **6–9M subagent tokens**:
build about 1h, review about 1h, fix about 45 min. Agents run in parallel,
one per module.

### Phase 0: Scout (inline, about 10 min)

Read this playbook and the template's `src/core/types.ts`, `Engine.ts` and
`content.ts`. Then pick the theme and write its row for the §1 table.

### Phase 1: Scaffold (inline, about 30 min)

1. Create the folder and copy the engine files (§4). Write `package.json`,
   then install:
   ```bash
   npm i three lenis <fontsource packages>
   npm i -D vite typescript @types/three puppeteer-core
   ```
2. Write `World.ts`, the post final pass, `base.css`, the kit, `index.html`,
   `chapters/index.ts`, placeholder chapters (one lit mesh + `rise` headline
   each), and UI stubs.
3. Start two servers on a **unique port pair**. Used so far:
   5173/5190/5195 (Orbit), 5280/5290 (Resonance), 5380/5390 (Press),
   5480/5490 (Town), 5580/5590 (Arcade). Next: **5680/5690**.
   ```bash
   npx vite --port 5680 --strictPort &                                  # HMR (agents)
   npx vite --config vite.shots.config.ts --port 5690 --strictPort &    # no-HMR (screenshots)
   ```
4. Smoke-test with `node scripts/shot.mjs --port=5690 --frames=hero:0.4 --out=<scratch>`,
   look at the PNG, and tune the post pass until the look is right. **Get the
   signature look right before fanning out.**
5. Initialise the repo and publish it:
   ```bash
   git init && git branch -M main && git add -A && git commit -m "Scaffold …"
   gh repo create HarkDigital/hark-<name> --public --source . --remote origin --push
   gh api -X POST repos/HarkDigital/hark-<name>/pages -f build_type=workflow
   ```

### Phase 2: Build workflow (8–9 agents in parallel)

One agent per module: `hero`, `work`, `services`, `voices`, `shield`,
`process`, `contact`, `ui`, and optionally `world` (kit and world art
direction).

Each agent prompt has two parts:
1. **A shared preamble.** Theme, art direction, movement vocabulary,
   typography, framework and API summary, the rules in §7, ownership, and
   the verification loop.
2. **A module brief.** A storyboard by local progress for its chapter, or
   the UI spec below.

Every agent must iterate with screenshots at 1440x900, 1280x720, 1024x768,
768x1024, 390x844 and 375x667, run the full site once with no console
errors, keep `tsc` clean, and return `{summary, files, coreChangeRequests,
knownIssues, screenshots}`.

**The UI agent owns:**
- **Chrome:** brand top-left with the concept tag; nav Work · Services ·
  Contact + "Start a project" (`land`); sound toggle bottom-left; progress
  readout bottom-right with a clickable pip per chapter, using business names
  (hero→Home, work→Work, services→Services, voices→Clients,
  shield→Security, process→Process, contact→Contact); mobile menu dialog.
- **Loader:** a minimum of about 1.2s, never hangs, crisp exit, inert page
  behind it.
- **Sound:** generative WebAudio, off by default, starts only on a real
  gesture (not Tab), preference in localStorage, mutes when the tab is hidden.
- **Rotate card:** dismissible, with a "Continue anyway" button.
- **No-WebGL fallback page.**

Keep these APIs:
- `createLoader(root, {skip}) → {progress, finish}`
- `createChrome(root, engine, sound) → {update}`; it calls
  `mountRotateGate(shown => engine.paused = shown)`.
- `Sound {enabled, onChange, toggle, update, cut, blip, tone}`
- `mountRotateGate(onChange?)`, `unmountRotateGate()`

### Phase 3: Integrate (inline)

1. Read every agent's `coreChangeRequests` and apply the sensible ones yourself.
2. Run `tsc`.
3. Commit.
4. Do a full sweep: every chapter at locals 0.03, 0.15, 0.3, 0.45, 0.6,
   0.75, 0.9 and 0.97, desktop and `--mobile`, built into per-chapter
   contact sheets (§8). **Look at them.**
5. Capture `public/og.jpg`: `--w=1200 --h=630` on the hero payoff frame.
6. Push. Pages deploys on push. If a push doesn't trigger, run
   `gh workflow run deploy.yml --repo HarkDigital/hark-<name> --ref main`.

### Phase 4: Review workflow (4 report-only reviewers)

The four lenses:
1. **perf + compat:** cold start, long tasks, frame times, shader prewarm
   hitches, memory, Safari 15 / Firefox hazards.
2. **a11y:** Tab order, anchors, focus visibility, reduced motion, contrast
   on real backgrounds, forced no-WebGL fallback.
3. **UX + copy fidelity:** diff all copy against site-v2 data, links, flow,
   landing frames; ask whether it's distinct from the sister sites.
4. **viewport QA:** 1920x1080, 1366x657, 1280x720, 1024x768, 768x1024,
   390x844, 375x667 and 844x390.

Findings are **evidence-backed** (screenshot path, measurement, or file:line),
with a severity and an owner module. Save them all to
`scratchpad/<name>-review/findings.json`.

### Phase 5: Fix workflow

1. Fix the **core** findings yourself first, and commit.
2. Then run one agent per module with its assigned findings. Point them at
   `findings.json` and list the core changes already made.
3. Integrate again: apply core requests, run `tsc`, sweep, push.
4. Run a **live check** of the deployed site with puppeteer: every chapter
   via `land()`, no failed slots, no console errors. Confirm `og.jpg` returns 200.

---

## 6. Gotchas

These are the rules to paste into agent preambles. Each one cost at least one
review round.

**Story and scroll**
- Everything is derived from `local` (0..1). `frame.time` is only for idle
  motion. It must look right when jumping straight to any local value;
  screenshots do exactly that. Never accumulate state across scroll.
- The engine's cut transition covers the first and last ~5–6% of each
  chapter (`CUT_WINDOW` 0.18vh). Design in/out beats for it, and **never put
  the intro headline or a nav landing frame under it.**
- Text reveals must settle to exact, readable text within ~0.8s and never
  re-trigger every frame. Never leave text garbled or dimmed at rest.
- Panels and labels must match what's on screen at rest (e.g. the service
  card names the service shown).
- Navigation always uses `land()`. `gotoChapter(id, 0)` parks on the cut
  peak: a white or glitched frame.

**Accessibility**
- Stages are aria-hidden visual layers. The engine sets `tabindex=-1` on their
  controls.
- Keyboard and screen readers use the linear copy in `srContent.ts`. Items
  carry `data-anchor="i"` → `chapter.anchors[i]`.
- One h1 (hero). Small text ≥ 4.5:1 on the **actual** rendered background;
  large text ≥ 3:1.
- Reduced motion: no flashes, strobing, screen shake or camera drift; words
  appear instantly. Never flash more than 3 times per second.
- The rotate card must be dismissible (WCAG 1.3.4). Never inert `#track` or
  the skip link.
- `inert` needs a fallback on Safari < 15.5 and Firefox < 112.

**Safari 15 and Firefox compatibility** (the build target is safari15)
- No regex lookbehind.
- No `color-mix()`. The minifier drops fallback lines, so use rgba tokens.
- Write `-webkit-backdrop-filter` **before** `backdrop-filter`, or the
  minifier drops the unprefixed one.
- `overflow: clip`: add an `@supports not` fallback.
- Canvas 2D `fontStretch`/`letterSpacing` don't exist in Safari. Use
  Press's `src/print/type.ts` `setPrintFont()` with an x-scale fallback.
- `roundRect` needs the polyfill (`src/ui/polyfills.ts`, installed at boot).

**GLSL**
- Never `pow(x, y)` with a possibly negative `x`; write `x*x`.
- No reversed `smoothstep` edges; use `1.0 - smoothstep(a, b, x)`.
- Keep `fwidth`/`dFdx` out of non-uniform branches, and avoid dynamic loop bounds.
- The Sanitize pass guards NaN; don't rely on it.

**Performance**
- Prewarm compiles each chapter with **only its own lights** (the group is
  removed from the scene while compiling), plus the world and post passes,
  asynchronously. It's already in the template.
- Init yields use `nextFrame()` from `src/core/yield.ts`, which is safe in a
  hidden tab. `setTimeout(0)` is throttled to 1/s in background tabs, which
  once made a load take 27s.
- Don't block init on the 15 screenshots. Load the first immediately and the
  rest after `hark:reveal`. Decode off the main thread
  (`fetch → blob → createImageBitmap` with resize) and upload in idle time.
- Other performance rules:
  - Use InstancedMesh and merged geometry. The Builder should output indexed geometry.
  - Don't share one material between instanced and plain meshes.
  - Keep the shadow frustum tight, and don't let tiny props cast shadows.
- Adaptive DPR measures against the display's own cadence, so iOS Low Power
  Mode's 30fps cap isn't mistaken for a slow GPU. Canvas sizing uses 100lvh;
  a resize keeps the story position. Both are already in the template.

**Robustness**
- The render loop re-arms first and catches errors.
- A chapter that throws becomes an empty placeholder, not a dead site.
- Context loss triggers a reload.

**Tooling**
- Agents share one HMR dev server, which reloads pages mid-screenshot. Take
  screenshots on the **no-HMR** server. `shot.mjs` re-checks the active
  chapter and retries.
- Frame names use 2–3 decimals, so frames closer than 0.001 overwrite each other.

**Fallback**
- Rewrite `src/ui/fallback.ts` simply: loop `CHAPTER_COPY_IDS`, then
  `buildChapterCopy(id, true)`. The UI agent styles it.
- Don't copy the template's themed fallback; it imports theme art.

---

## 7. Verification snippets

**Screenshots:**

```bash
node scripts/shot.mjs --port=5690 --frames=hero:0.03,hero:0.5,work:0.15 --out=<dir> [--mobile] [--w=375 --h=667] [--wait=2200] [--only=hero] [--debug]
```

**Contact sheets** (desktop row of 8 plus mobile row of 8 per chapter):

```python
from PIL import Image, ImageDraw
import os
L=["0.03","0.15","0.30","0.45","0.60","0.75","0.90","0.97"]
for c in ["hero","work","services","voices","shield","process","contact"]:
    sheet=Image.new('RGB',(1440,450+390),'white')
    for i,l in enumerate(L):
        for pre,size,pos in [("",(360,225),((i%4)*360,(i//4)*225)),("m-",(180,390),(i*180,450))]:
            f=f"{pre}{c}-{l}.png"
            if os.path.exists(f): sheet.paste(Image.open(f).convert('RGB').resize(size),pos)
    sheet.save(f"S-{c}.png")
```

**Live check** (puppeteer, after deploy): load
`https://harkdigital.github.io/hark-<name>/?nointro`, wait for
`window.__hark.ready`, call `land(id, false)` for every chapter, then assert
`engine.slots.filter(s => s.failed)` is empty and no console errors occurred.
Do this for desktop 1440x900 and mobile emulation 390x844.

---

## 8. Kickoff prompt for a new thread

> Read `/Users/michaelharkins/Hark.Digital Dropbox/Mike Harkins/Claude Code/HARK-CONCEPT-PLAYBOOK.md`
> and follow it to build a new Hark Digital concept site with the theme
> **<THEME, or "your choice">**. Work in this folder. Use `Hark Town` as the
> engine template and the 2026 site folder as the read-only content source.
> Publish it to a new GitHub Pages instance (`HarkDigital/hark-<name>`), run
> the build → review → fix workflows, and give me the live link with
> screenshots when done. ultracode

Include `ultracode` (or say "use workflows"). The process depends on parallel
multi-agent workflows.
