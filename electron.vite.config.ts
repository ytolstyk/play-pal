import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        // Two entries: the app window bridge and the YouTube Music view's clock reporter.
        // Sandboxed preloads can't require chunks, so neither may share runtime imports with the other.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          yt: resolve(__dirname, 'src/preload/yt.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()]
  }
})
