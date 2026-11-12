import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { dedupe:['vue','@vue/runtime-core','@vue/runtime-dom','pinia'], alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 1428, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/src-tauri/**', '**/.local/**'] } },
  clearScreen: false,
  build: { rollupOptions: { input: { main: 'index.html', settings: 'settings.html', player: 'player.html' } } },
  test: { setupFiles:['tests/setup-electron-files.ts'], environment: 'happy-dom', include: ['tests/**/*.test.ts'], clearMocks: true }
})
