import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { binaryArchitecture } from './check-embedded-mpv-bundles.mjs'

export const PACKAGED_TARGETS = [
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['win32', 'x64'],
  ['linux', 'x64'],
  ['linux', 'arm64']
]

function isDirectory(candidate) {
  return existsSync(candidate) && statSync(candidate).isDirectory()
}

export function packagedResourceRoots(releaseDir, platform) {
  const outputs = readdirSync(releaseDir)
    .map((name) => path.join(releaseDir, name))
    .filter(isDirectory)

  if (platform !== 'darwin') return outputs.map((output) => path.join(output, 'resources'))

  const apps = []
  for (const output of outputs) {
    if (output.endsWith('.app')) apps.push(output)
    for (const name of readdirSync(output)) {
      const candidate = path.join(output, name)
      if (name.endsWith('.app') && isDirectory(candidate)) apps.push(candidate)
    }
  }
  return apps.map((app) => path.join(app, 'Contents', 'Resources'))
}

export function verifyPackagedMpv(releaseDir, platform, arch) {
  if (!PACKAGED_TARGETS.some(([targetPlatform, targetArch]) => targetPlatform === platform && targetArch === arch)) {
    throw new Error('Usage: node scripts/check-packaged-mpv.mjs darwin x64 | darwin arm64 | win32 x64 | linux x64 | linux arm64')
  }
  if (!existsSync(releaseDir)) throw new Error(`Missing electron-builder output: ${releaseDir}`)

  const targets = packagedResourceRoots(releaseDir, platform)
    .map((resources) => path.join(resources, 'engine', platform, arch, 'mpv-texture'))
    .filter(existsSync)
  if (targets.length !== 1) throw new Error(`Expected one packaged ${platform}/${arch} MPV bundle; found ${targets.length}`)

  const directory = targets[0]
  const manifest = JSON.parse(readFileSync(path.join(directory, 'mpv-bundle-manifest.json'), 'utf8'))
  const expectedRenderer = platform === 'darwin' ? 'texture' : 'software'
  if (manifest.platform !== platform || manifest.arch !== arch || manifest.renderer !== expectedRenderer) {
    throw new Error(`Wrong packaged MPV manifest target or renderer: ${JSON.stringify({ platform: manifest.platform, arch: manifest.arch, renderer: manifest.renderer })}`)
  }

  const library = platform === 'win32' ? 'libmpv-2.dll' : platform === 'darwin' ? 'libmpv.dylib' : 'libmpv.so.2'
  const files = Array.isArray(manifest.files) ? manifest.files : []
  const names = new Set(files.map((file) => file.name))
  if (!names.has('mpv_texture.node') || !names.has(library)) throw new Error('Packaged MPV manifest lacks addon or libmpv')
  if (platform === 'linux' && (!names.has('mpv-node-host') || !names.has('mpv-host.cjs'))) throw new Error('Packaged Linux MPV manifest lacks isolated host')
  for (const file of files) {
    if (typeof file.name !== 'string' || path.basename(file.name) !== file.name) throw new Error('Unsafe manifest filename')
    const target = path.join(directory, file.name)
    if (!existsSync(target)) throw new Error(`Missing packaged MPV dependency: ${file.name}`)
    const bytes = readFileSync(target)
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`Packaged MPV dependency changed: ${file.name}`)
    }
    if (file.name !== 'mpv-host.cjs' && binaryArchitecture(target, platform) !== arch) throw new Error(`Wrong packaged architecture: ${file.name}`)
  }
  return directory
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, arch] = process.argv.slice(2)
  const directory = verifyPackagedMpv(path.resolve('release'), platform, arch)
  console.log(`Packaged MPV ${platform}/${arch} verified: ${directory}`)
}
