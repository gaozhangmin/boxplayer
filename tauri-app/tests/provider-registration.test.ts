import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProviderRegistration, parseRegistration, registrationKeys } from '../scripts/provider-registration.mjs'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const checkout = mkdtempSync(join(tmpdir(), 'boxplayer-registration-'))
  directories.push(checkout)
  const root = join(checkout, 'tauri-app')
  const localRegistration = join(root, '.local', 'provider-registration.ts')
  mkdirSync(join(root, '.local'), { recursive: true })
  return { checkout, root, localRegistration }
}

const generated = () => registrationKeys.map(key => `export const ${key} = ${JSON.stringify('synthetic-' + key)}`).join('\n')

it('loads only app registration from the standalone Tauri configuration', () => {
  const { root, localRegistration } = fixture()
  writeFileSync(localRegistration, generated() + '\nexport const ACCOUNT_TOKEN = "must-not-import"')

  const result = loadProviderRegistration({ root, env: {} })

  expect(result.missing).toEqual([])
  expect(result.configured).toHaveLength(registrationKeys.length)
  expect(Object.keys(result.env)).not.toContain('BOXPLAYER_ACCOUNT_TOKEN')
  expect(result.env.BOXPLAYER_GOOGLE_CLIENT_ID).toBe('synthetic-GOOGLE_CLIENT_ID')
})

it('prefers environment overrides and the explicit file to Tauri local defaults', () => {
  const { checkout, root, localRegistration } = fixture()
  const explicit = join(checkout, 'registration.ts')
  writeFileSync(localRegistration, generated())
  writeFileSync(explicit, 'export const GOOGLE_CLIENT_ID = "explicit-id"')

  const result = loadProviderRegistration({
    root,
    env: { BOXPLAYER_REGISTRATION_FILE: explicit, BOXPLAYER_ONEDRIVE_CLIENT_ID: 'environment-id' },
  })

  expect(result.env.BOXPLAYER_ONEDRIVE_CLIENT_ID).toBe('environment-id')
  expect(result.env.BOXPLAYER_GOOGLE_CLIENT_ID).toBe('explicit-id')
  expect(result.env.BOXPLAYER_BOX_CLIENT_ID).toBe('synthetic-BOX_CLIENT_ID')
})

it('rejects missing registration even when the old Electron file exists', () => {
  const { checkout, root } = fixture()
  mkdirSync(join(checkout, 'src'))
  writeFileSync(join(checkout, 'src', 'secrets.generated.ts'), generated())
  const env = { BOXPLAYER_GOOGLE_CLIENT_SECRET: 'never-log-me' }

  expect(() => loadProviderRegistration({ root, env })).toThrow('Missing application registration:')
  expect(loadProviderRegistration({ root, env, strict: false }).missing).toContain('GOOGLE_CLIENT_ID')
  try {
    loadProviderRegistration({ root, env })
  } catch (error) {
    expect(String(error)).not.toContain('never-log-me')
  }
})

it('does not execute generated-file expressions while parsing registration', () => {
  expect(parseRegistration('export const GOOGLE_CLIENT_ID = globalThis.malicious()\nexport const GOOGLE_CLIENT_SECRET = "synthetic";'))
    .toEqual({ GOOGLE_CLIENT_SECRET: 'synthetic' })
})
