import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: { output: { codeSplitting: { groups: [
      // All styles stay one stylesheet in import order, as before the split: split per chunk, the
      // lazy chunks' rules would load after App.css and win the cascade ties App.css wins today.
      { name: 'styles', test: /\.css$/ },
    ] } } },
  },
})
