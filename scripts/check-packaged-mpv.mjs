import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { binaryArchitecture } from './check-embedded-mpv-bundles.mjs'

const [platform, arch] = process.argv.slice(2)
if (!((platform === 'win32' && arch === 'x64') || (platform === 'linux' && ['x64', 'arm64'].includes(arch)))) {
  throw new Error('Usage: node scripts/check-packaged-mpv.mjs win32 x64 | linux x64 | linux arm64')
}
const releaseDir = path.resolve('release')
if (!existsSync(releaseDir)) throw new Error(`Missing electron-builder output: ${releaseDir}`)
const targets = readdirSync(releaseDir)
  .map((name) => path.join(releaseDir, name))
  .filter((candidate) => statSync(candidate).isDirectory())
  .map((candidate) => path.join(candidate, 'resources', 'engine', platform, arch, 'mpv-texture'))
  .filter(existsSync)
if (targets.length !== 1) throw new Error(`Expected one packaged ${platform}/${arch} MPV bundle; found ${targets.length}`)

const directory = targets[0]
const manifest = JSON.parse(readFileSync(path.join(directory, 'mpv-bundle-manifest.json'), 'utf8'))
if (manifest.platform !== platform || manifest.arch !== arch || manifest.renderer !== 'software') {
  throw new Error(`Wrong packaged MPV manifest target or renderer: ${JSON.stringify({ platform: manifest.platform, arch: manifest.arch, renderer: manifest.renderer })}`)
}
const library = platform === 'win32' ? 'libmpv-2.dll' : 'libmpv.so.2'
const names = new Set(manifest.files?.map((file) => file.name) || [])
if (!names.has('mpv_texture.node') || !names.has(library)) throw new Error('Packaged MPV manifest lacks addon or libmpv')
if (platform === 'linux' && (!names.has('mpv-node-host') || !names.has('mpv-host.cjs'))) throw new Error('Packaged Linux MPV manifest lacks isolated host')
for (const file of manifest.files) {
  if (typeof file.name !== 'string' || path.basename(file.name) !== file.name) throw new Error('Unsafe manifest filename')
  const target = path.join(directory, file.name)
  if (!existsSync(target)) throw new Error(`Missing packaged MPV dependency: ${file.name}`)
  const bytes = readFileSync(target)
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`Packaged MPV dependency changed: ${file.name}`)
  }
  if (file.name !== 'mpv-host.cjs' && binaryArchitecture(target, platform) !== arch) throw new Error(`Wrong packaged architecture: ${file.name}`)
}
console.log(`Packaged MPV ${platform}/${arch} verified: ${directory}`)
