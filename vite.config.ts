import { defineConfig } from 'vite'

// GitHub Pages serves from /<repo>/ — CI passes --base=/<repo>/.
export default defineConfig({
  server: { host: true },
  build: {
    // Safari 15/16.3 can't parse class static blocks (three r186) — lower them
    target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
    chunkSizeWarningLimit: 1500,
  },
})
