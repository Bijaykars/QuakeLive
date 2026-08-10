import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite's dep optimizer fails to emit maplibre's worker chunk (504 in dev, blank map).
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
