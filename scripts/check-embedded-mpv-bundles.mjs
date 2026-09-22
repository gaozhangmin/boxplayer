import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const TARGETS = [
  ['darwin', 'x64', 'libmpv.dylib'],
  ['darwin', 'arm64', 'libmpv.dylib'],
  ['win32', 'x64', 'libmpv-2.dll'],
  ['linux', 'x64', 'libmpv.so.2'],
  ['linux', 'arm64', 'libmpv.so.2']
]

export function binaryArchitecture(filePath, platform) {
  const data = readFileSync(filePath)
  if (platform === 'darwin') {
    if (data.length < 8 || data.readUInt32LE(0) !== 0xfeedfacf) return null
    const cpu = data.readUInt32LE(4)
    return cpu === 0x01000007 ? 'x64' : cpu === 0x0100000c ? 'arm64' : null
  }
  if (platform === 'linux') {
    if (data.length < 20 || data[0] !== 0x7f || data.toString('ascii', 1, 4) !== 'ELF' || data[4] !== 2) return null
    const machine = data[5] === 2 ? data.readUInt16BE(18) : data.readUInt16LE(18)
    return machine === 62 ? 'x64' : machine === 183 ? 'arm64' : null
  }
  if (platform === 'win32') {
    if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ') return null
    const peOffset = data.readUInt32LE(0x3c)
    if (peOffset + 6 > data.length || data.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return null
    const machine = data.readUInt16LE(peOffset + 4)
    return machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : null
  }
  return null
}

export function inspectBundle(root, platform, arch, libraryName) {
  const directory = path.join(root, 'static', 'engine', platform, arch, 'mpv-texture')
  const issues = []
  const manifestPath = path.join(directory, 'mpv-bundle-manifest.json')
  if (!existsSync(manifestPath)) return { directory, issues: ['missing mpv-bundle-manifest.json'] }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { directory, issues: [`invalid manifest: ${error.message}`] }
  }
  if (manifest.platform !== platform || manifest.arch !== arch) issues.push(`manifest target mismatch: ${manifest.platform}/${manifest.arch}`)
  const files = Array.isArray(manifest.files) ? manifest.files : []
  const addonName = ['mpv_texture.node', 'boxplayer-mpv-texture.node'].find((name) => files.some((file) => file.name === name))
  if (!addonName) issues.push('missing addon manifest entry')
  if (!files.some((file) => file.name === libraryName)) issues.push(`missing ${libraryName} manifest entry`)

  for (const file of files) {
    if (typeof file.name !== 'string' || path.basename(file.name) !== file.name) {
      issues.push('invalid manifest filename')
      continue
    }
    const filePath = path.join(directory, file.name)
    if (!existsSync(filePath)) {
      issues.push(`missing ${file.name}`)
      continue
    }
    const contents = readFileSync(filePath)
    if (file.bytes !== undefined && file.bytes !== contents.length) issues.push(`size mismatch: ${file.name}`)
    if (file.sha256 && file.sha256 !== createHash('sha256').update(contents).digest('hex')) issues.push(`hash mismatch: ${file.name}`)
  }

  for (const name of [addonName, libraryName]) {
    if (!name) continue
    const filePath = path.join(directory, name)
    if (existsSync(filePath)) {
      const actualArch = binaryArchitecture(filePath, platform)
      if (actualArch !== arch) issues.push(`wrong architecture: ${name} (${actualArch || 'unknown'}, expected ${arch})`)
    }
  }
  return { directory, issues }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selected = process.argv.slice(2)
  const targets = selected.length === 0 || selected.includes('--all') ? TARGETS : TARGETS.filter(([platform, arch]) => selected.includes(`${platform}/${arch}`))
  if (targets.length === 0) {
    console.error('Usage: node scripts/check-embedded-mpv-bundles.mjs [--all|darwin/arm64|darwin/x64|win32/x64|linux/arm64|linux/x64]')
    process.exitCode = 2
  } else {
    let failed = false
    for (const [platform, arch, libraryName] of targets) {
      const result = inspectBundle(repoRoot, platform, arch, libraryName)
      console.log(`${platform}/${arch}: ${result.issues.length ? result.issues.join('; ') : 'OK'}`)
      failed ||= result.issues.length > 0
    }
    if (failed) process.exitCode = 1
  }
}
