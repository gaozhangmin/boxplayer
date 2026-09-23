import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { packagedResourceRoots, PACKAGED_TARGETS, verifyPackagedMpv } from '../check-packaged-mpv.mjs'

function machO(arch) {
  const data = Buffer.alloc(128)
  data.writeUInt32LE(0xfeedfacf, 0)
  data.writeUInt32LE(arch === 'x64' ? 0x01000007 : 0x0100000c, 4)
  return data
}

function macFixture(arch) {
  const releaseDir = mkdtempSync(path.join(tmpdir(), 'boxplayer-packaged-mpv-'))
  const resources = path.join(releaseDir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'BoxPlayer.app', 'Contents', 'Resources')
  const directory = path.join(resources, 'engine', 'darwin', arch, 'mpv-texture')
  mkdirSync(directory, { recursive: true })
  const files = ['mpv_texture.node', 'libmpv.dylib'].map((name) => {
    const contents = machO(arch)
    writeFileSync(path.join(directory, name), contents)
    return { name, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }
  })
  writeFileSync(path.join(directory, 'mpv-bundle-manifest.json'), JSON.stringify({ platform: 'darwin', arch, renderer: 'texture', files }))
  return { releaseDir, resources, directory }
}

describe('packaged MPV acceptance', () => {
  it('declares every desktop release target', () => {
    expect(PACKAGED_TARGETS).toEqual([
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['win32', 'x64'],
      ['linux', 'x64'],
      ['linux', 'arm64']
    ])
  })

  it.each(['x64', 'arm64'])('finds and verifies a packaged macOS %s app', (arch) => {
    const { releaseDir, resources, directory } = macFixture(arch)
    expect(packagedResourceRoots(releaseDir, 'darwin')).toEqual([resources])
    expect(verifyPackagedMpv(releaseDir, 'darwin', arch)).toBe(directory)
  })

  it('rejects a macOS package with the wrong renderer', () => {
    const { releaseDir, directory } = macFixture('x64')
    const manifestPath = path.join(directory, 'mpv-bundle-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, renderer: 'software' }))
    expect(() => verifyPackagedMpv(releaseDir, 'darwin', 'x64')).toThrow('Wrong packaged MPV manifest target or renderer')
  })
})
