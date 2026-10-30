import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('human-owned release publication', () => {
  const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
  it('keeps packaging and the final release update in draft state', () => {
    const builder = JSON.parse(readFileSync(resolve('electron-builder.json'), 'utf8'))
    for (const target of builder.publish) expect(target.releaseType).toBe('draft')
    expect(workflow).toContain('--draft=true')
    expect(workflow).not.toContain('--draft=false')
    expect(workflow).toContain('--draft \\')
  })
  it('blocks existing public releases before packaging and before updating notes', () => {
    const creation = workflow.slice(workflow.indexOf('create-release:'), workflow.indexOf('\n  release:'))
    const finalization = workflow.slice(workflow.indexOf('finalize-release:'))
    for (const job of [creation, finalization]) {
      expect(job).toContain('--json isDraft --jq .isDraft')
      expect(job).toContain('Refusing to modify an already-public release')
      expect(job).toContain('exit 1')
    }
  })
  it('uses the versioned document when creating and finalizing the draft', () => {
    expect(workflow).toContain('notes="docs/releases/${GITHUB_REF_NAME}.md"')
    expect(workflow).toContain('"docs/releases/${GITHUB_REF_NAME}.md" "docs/releases/${version_without_v}.md"')
    expect(workflow).toContain('cp "${release_doc}" release-notes.md')
  })
  it('publishes both macOS architectures once using both verified runtimes', () => {
    const packaging = workflow.slice(workflow.indexOf('\n  release:'), workflow.indexOf('\n  finalize-release:'))
    const runners = packaging.match(/os: \[([^\]]+)\]/)[1].split(',').map(value => value.trim())
    expect(runners.filter(value => value.startsWith('macos-'))).toEqual(['macos-14'])
    for (const arch of ['x64', 'arm64']) {
      expect(packaging).toContain(`name: embedded-mpv-darwin-${arch}-candidate`)
      expect(packaging).toContain(`node scripts/check-embedded-mpv-bundles.mjs darwin/${arch}`)
    }
    expect(packaging).toContain("args: ${{ matrix.os == 'macos-14' && '--x64 --arm64' || '' }}")
    expect(packaging).toContain('max_attempts: 3')
    // Native x64 playback remains a prerequisite even with a single publisher.
    expect(packaging).toContain('embedded-mpv-macos-x64-test')
  })
  it('requires Trakt configuration in release builds', () => {
    expect(workflow.match(/REQUIRED_RELEASE_SECRETS: (.+)/)?.[1].split(',')).toContain('TRAKT_CLIENT_ID')
    expect(workflow.match(/TRAKT_CLIENT_ID: \$\{\{ secrets\.TRAKT_CLIENT_ID \}\}/g)).toHaveLength(2)
    expect(readFileSync(resolve('electron/main/trakt.ts'), 'utf8')).toContain("import { TRAKT_CLIENT_ID } from '../../src/secrets.generated'")
  })
})
