// vitest.mediary.config.ts — the vendored mediary-scout workflow suite, kept apart from
// the app suite. Its SQLite tests need better-sqlite3 built for this machine's runtime:
// run under Electron (`pnpm run test:mediary`) because the app rebuilds it for Electron's ABI.
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Most vendor tests import the package index, which re-exports the Postgres adapter.
    alias: { pg: path.resolve(__dirname, 'electron/main/mediary/__tests__/pgStub.ts') }
  },
  test: {
    environment: 'node',
    include: ['vendor/mediary-workflow/**/*.test.ts'],
    exclude: [
      // Need a live Postgres (MEDIA_TRACK_POSTGRES_URL); BoxPlayer only uses SQLite.
      'vendor/mediary-workflow/**/*.pg.test.ts',
      'vendor/mediary-workflow/src/postgres-schema-init.test.ts',
      'vendor/mediary-workflow/tests/repository-contract-postgres.test.ts',
      // Reads the upstream repo's docker-compose.yml, which the subtree does not carry.
      'vendor/mediary-workflow/tests/runtime-config.test.ts'
    ]
  }
})
