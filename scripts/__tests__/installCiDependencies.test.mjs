import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, access, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { downloadVerifiedElectronArchive, ensureVerifiedElectronArchive } from '../install-ci-dependencies.mjs'

const require = createRequire(import.meta.url)
const directories = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'boxplayer-electron-install-'))
  directories.push(dir)
  const bytes = Buffer.from('official archive fixture')
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ assets: [{ name: 'electron-v1.2.3-linux-x64.zip', url: 'https://api.github.com/repos/electron/electron/releases/assets/123' }] })))
    .mockResolvedValueOnce(new Response(bytes))
  return { version: '1.2.3', platform: 'linux', arch: 'x64', expectedSha256: createHash('sha256').update(bytes).digest('hex'), destination: join(dir, 'cache', 'electron.zip'), fetchImpl, bytes }
}
describe('verified CI Electron installation', () => {
  it('prepares an absent archive even when an executable could already be installed', async () => {
    const input = await fixture()
    await ensureVerifiedElectronArchive(input)
    expect(await readFile(input.destination)).toEqual(input.bytes)
    expect(input.fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('reuses only a checksum-valid archive without contacting the CDN', async () => {
    const input = await fixture()
    await mkdir(join(input.destination, '..'), { recursive: true })
    await writeFile(input.destination, input.bytes)
    await ensureVerifiedElectronArchive(input)
    expect(input.fetchImpl).not.toHaveBeenCalled()
  })

  it('passes pinned checksums through the installed electron-builder downloader', async () => {
    const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
    const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
    const electronGet = appBuilderRequire('@electron/get')
    const downloader = appBuilderRequire('./out/util/electronGet.js')
    const input = await fixture()
    await mkdir(join(input.destination, '..'), { recursive: true })
    await writeFile(input.destination, input.bytes)
    const download = vi.spyOn(electronGet, 'downloadArtifact').mockResolvedValue(input.destination)
    const builder = require('../../electron-builder.json')
    const { version } = require('electron/package.json')
    try {
      await downloader.downloadElectronArtifactZip({ electronDownload: builder.electronDownload, version, platformName: 'linux', arch: 'x64', artifactName: 'electron' })
      expect(download.mock.calls[0][0].checksums).toEqual(builder.electronDownload.checksums)
      expect(download.mock.calls[0][0].unsafelyDisableChecksums).not.toBe(true)
    } finally { download.mockRestore() }
  })

  it('pins the official package checksums for every packaged desktop architecture', () => {
    const { version } = require('electron/package.json')
    const official = require('electron/checksums.json')
    const builder = require('../../electron-builder.json')
    for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
      const name = `electron-v${version}-${platform}-${arch}.zip`
      expect(builder.electronDownload.checksums[name]).toBe(official[name])
      expect(builder.electronDownload.checksums[name]).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('downloads through the official asset API and caches only checksum-verified bytes', async () => {
    const input = await fixture()
    await downloadVerifiedElectronArchive(input)
    expect(await readFile(input.destination)).toEqual(input.bytes)
    expect(input.fetchImpl.mock.calls[1][0]).toMatch(/^https:\/\/api.github.com\/repos\/electron\/electron\/releases\/assets\/123\?retry=/)
    expect(input.fetchImpl.mock.calls[1][1].headers.Accept).toBe('application/octet-stream')
  })
  it('rejects corrupt archives without leaving an installable cache entry', async () => {
    const input = await fixture()
    await expect(downloadVerifiedElectronArchive({ ...input, expectedSha256: '0'.repeat(64) })).rejects.toThrow('checksum mismatch')
    await expect(access(input.destination)).rejects.toThrow()
    await expect(access(`${input.destination}.part`)).rejects.toThrow()
  })
  it('refuses asset URLs outside the official Electron repository', async () => {
    const input = await fixture()
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ assets: [{ name: 'electron-v1.2.3-linux-x64.zip', url: 'https://other.invalid/archive' }] })))
    await expect(downloadVerifiedElectronArchive({ ...input, fetchImpl, token: 'test-token' })).rejects.toThrow('Official Electron release asset not found')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
