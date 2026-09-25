import type { ChapterDef } from '../core/types'

/**
 * The scroll story, in order. `length` is scroll distance in viewport
 * heights; `landing` is where nav jumps land (local progress, on settled
 * copy — keep it clear of the ~6% cut window at each end). Each chapter lives
 * in src/chapters/<id>/ and default-exports a factory returning a Chapter.
 *
 * THEME: rename the labels to fit the concept (Orbit "Signal/Orbit/…",
 * Press "Proof/Paste-up/…", Arcade "Title Screen/Arcade Hall/…"). The ids are
 * shared with src/core/srContent.ts and the chrome's business names.
 */
export const CHAPTERS: ChapterDef[] = [
  { id: 'hero', label: 'Package', length: 2.2, landing: 0, intro: 0.8, load: () => import('./hero/index') },
  { id: 'work', label: 'Board', length: 3.8, landing: 0.12, intro: 0.06, load: () => import('./work/index') },
  { id: 'services', label: 'Die', length: 4.1, landing: 0.08, intro: 0.06, load: () => import('./services/index') },
  { id: 'voices', label: 'Wafer', length: 3.0, landing: 0.08, intro: 0.06, load: () => import('./voices/index') },
  { id: 'shield', label: 'Surge', length: 1.7, landing: 0.45, intro: 0.45, load: () => import('./shield/index') },
  { id: 'process', label: 'Fab', length: 2.2, landing: 0.17, intro: 0.12, load: () => import('./process/index') },
  { id: 'contact', label: 'Power On', length: 1.5, landing: 0.3, intro: 0.3, load: () => import('./contact/index') },
]
