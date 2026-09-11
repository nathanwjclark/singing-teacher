import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three (~644 kB) is the only chunk above 500 kB, and the first Movement map paint needs it.
    chunkSizeWarningLimit: 700,
    rolldownOptions: { output: { codeSplitting: { groups: [
      // three changes less often than the app, so it gets its own long-cached vendor chunk.
      { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
      // All styles stay one stylesheet in import order, as before the split: split per chunk, the
      // lazy chunks' rules would load after App.css and win the cascade ties App.css wins today.
      { name: 'styles', test: /\.css$/ },
    ] } } },
  },
})
