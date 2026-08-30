import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../../..')

describe('electron-builder file associations', () => {
  it('does not register BoxPlayer as a handler for any file extension', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'electron-builder.json'), 'utf8'))

    expect(config).not.toHaveProperty('fileAssociations')
    expect(config.nsis.include).toBe('build/installer.nsh')
  })

  it('cleans only the legacy BoxPlayer associations during a Windows upgrade', () => {
    const installer = readFileSync(resolve(root, 'build/installer.nsh'), 'utf8')

    expect(installer).toContain('ReadRegStr $R0 SHELL_CONTEXT')
    expect(installer).toContain('$R0 == "${FILECLASS}"')
    expect(installer).toContain('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${EXT}" ""')
    expect(installer).toContain('"BoxPlayer Video"')
    expect(installer).toContain('"BoxPlayer Audio"')
    expect(installer).toContain('"BoxPlayer Book"')
  })
})
