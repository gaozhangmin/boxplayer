// vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@main':   path.resolve(__dirname, 'electron/main'),
      '@earendil-works/pi-ai/compat': path.resolve(__dirname, 'src/services/agent/piCompatBrowser.ts'),
      '@earendil-works/pi-agent-core/dist/agent.js': path.resolve(__dirname, 'node_modules/@earendil-works/pi-agent-core/dist/agent.js')
    }
  },
  test: {
    environment: 'node',
    include: [
      'electron/main/core/__tests__/**/*.test.ts',
      'electron/main/aria/__tests__/**/*.test.ts',
      'shared/__tests__/**/*.test.ts',
      'src/down/motrix-integration/**/*.test.ts',
      'src/down/integration/**/*.test.ts',
      'scripts/__tests__/**/*.test.mjs',
      'src/media-server/__tests__/**/*.test.ts',
      'src/utils/__tests__/**/*.test.ts',
      'src/analytics/__tests__/**/*.test.ts',
      'src/aliapi/__tests__/**/*.test.ts',
      'src/pikpak/__tests__/**/*.test.ts',
      'src/quark/__tests__/**/*.test.ts',
      'src/guangya/__tests__/**/*.test.ts',
      'src/cloud123/__tests__/**/*.test.ts',
      'src/cloudbaidu/__tests__/**/*.test.ts',
      'src/cloud139/__tests__/**/*.test.ts',
      'src/cloud189/__tests__/**/*.test.ts',
      'src/dropbox/__tests__/**/*.test.ts',
      'src/onedrive/__tests__/**/*.test.ts',
      'src/box/__tests__/**/*.test.ts',
      'src/google/__tests__/**/*.test.ts',
      'clouddrive-cli/__tests__/**/*.test.ts',
    ],
  },
})
