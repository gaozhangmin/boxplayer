import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadVerifiedElectronArchive } from '../install-ci-dependencies.mjs'

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
