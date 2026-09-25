import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

// Screenshot server: no HMR, so edits elsewhere never reload a page mid-capture.
//   npx vite --config vite.shots.config.ts --port 5190 --strictPort
export default mergeConfig(base, defineConfig({ server: { hmr: false } }))
