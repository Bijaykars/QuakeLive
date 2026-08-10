import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite's bundler fails to emit maplibre's worker chunk (504 in dev, 404 in production —
  // blank data layers either way). Dev fix: exclude from the dep optimizer. Production fix:
  // public/assets/maplibre-gl-{worker,shared}.mjs are copies from node_modules/maplibre-gl/dist
  // that the built bundle resolves at runtime — keep them in sync when upgrading maplibre-gl.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
