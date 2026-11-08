import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export async function downloadVerifiedElectronArchive({ version, platform, arch, expectedSha256, destination, fetchImpl = fetch, token }) {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 || '')) throw new Error('Electron package checksum is missing')
  const filename = `electron-v${version}-${platform}-${arch}.zip`
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'BoxPlayer-Release', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const metadata = await fetchImpl(`https://api.github.com/repos/electron/electron/releases/tags/v${version}`, { headers, signal: AbortSignal.timeout(60_000) })
  if (!metadata.ok) throw new Error(`Electron release metadata returned HTTP ${metadata.status}`)
  const asset = (await metadata.json()).assets?.find(item => item.name === filename)
  if (!asset || !/^https:\/\/api\.github\.com\/repos\/electron\/electron\/releases\/assets\/\d+$/.test(asset.url)) throw new Error('Official Electron release asset not found')
  const archive = await fetchImpl(`${asset.url}?retry=${Date.now()}`, { headers: { ...headers, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(60_000) })
  if (!archive.ok || !archive.body) throw new Error(`Electron archive returned HTTP ${archive.status}`)
  const partial = `${destination}.part`
  await mkdir(dirname(destination), { recursive: true })
  try {
    await pipeline(Readable.fromWeb(archive.body), createWriteStream(partial))
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(partial)) hash.update(chunk)
    if (hash.digest('hex') !== expectedSha256) throw new Error('Electron archive checksum mismatch')
    await rename(partial, destination)
    console.info(`Verified official Electron archive: ${filename}`)
  } finally { await rm(partial, { force: true }) }
}

async function installDependencies() {
  const pnpm = args => spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } }).status ?? 1
  let code = 1
  for (let attempt = 1; attempt <= 3; attempt++) {
    code = pnpm(['install', '--frozen-lockfile'])
    if (code === 0) break
    if (attempt < 3) await setTimeout(10_000)
  }
  if (code !== 0) return code
  try { require('electron'); return 0 } catch { /* Install Electron separately so its CDN cannot abort other dependency setup. */ }
  const packagePath = require.resolve('electron/package.json')
  const electronRequire = createRequire(packagePath)
  const { version } = electronRequire('./package.json')
  const platform = process.env.npm_config_platform || process.platform
  const arch = process.env.npm_config_arch || process.arch
  const filename = `electron-v${version}-${platform}-${arch}.zip`
  const { Cache } = electronRequire('@electron/get/dist/cjs/Cache.js')
  const destination = new Cache(process.env.electron_config_cache).getCachePath(`https://github.com/electron/electron/releases/download/v${version}/${filename}`, filename)
  const expectedSha256 = electronRequire('./checksums.json')[filename]
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await downloadVerifiedElectronArchive({ version, platform, arch, destination, expectedSha256, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN })
      const env = { ...process.env }
      delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
      const result = spawnSync(process.execPath, [resolve(dirname(packagePath), 'install.js')], { stdio: 'inherit', env })
      if (result.status !== 0) throw new Error('Electron extraction failed')
      require('electron')
      return 0
    } catch (error) {
      console.error(`Electron installation attempt ${attempt}/3: ${error.message}`)
      if (attempt < 3) await setTimeout(10_000)
    }
  }
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await installDependencies() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
