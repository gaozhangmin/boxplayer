import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { binaryArchitecture } from '../../../scripts/check-embedded-mpv-bundles.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const { platform, arch } = process
if (!((platform === 'win32' && arch === 'x64') || (platform === 'linux' && ['x64', 'arm64'].includes(arch)))) {
  throw new Error(`Software MPV bundle target not supported: ${platform}/${arch}`)
}

const sdkDir = path.join(packageRoot, 'deps', 'mpv', platform, arch)
const addon = path.join(packageRoot, 'build', 'Release', 'mpv_texture.node')
const libmpvName = platform === 'win32' ? 'libmpv-2.dll' : 'libmpv.so.2'
const libmpv = path.join(sdkDir, libmpvName)
const output = path.join(repoRoot, 'static', 'engine', platform, arch, 'mpv-texture')
for (const file of [addon, libmpv]) {
  if (!existsSync(file)) throw new Error(`Missing bundle input: ${file}`)
  if (binaryArchitecture(file, platform) !== arch) throw new Error(`Wrong architecture: ${file}`)
}

mkdirSync(output, { recursive: true })
const copied = []
const inputs = [addon, libmpv]
const linuxNames = new Map()
for (const name of readdirSync(sdkDir)) {
  if (name === libmpvName || name === 'libmpv.so' || name === 'mpv.lib') continue
  if (platform === 'win32' && name.toLowerCase().endsWith('.dll')) inputs.push(path.join(sdkDir, name))
  if (platform === 'linux' && /^.*\.so(?:\.[\d.]+)?$/.test(name)) inputs.push(path.join(sdkDir, name))
}

if (platform === 'linux') {
  const seen = new Set(inputs.map((input) => path.basename(input)))
  const baseSystemLibraries = /^(?:libc|libm|libdl|libpthread|librt|libresolv|libnss_[^.]*)\.so\./
  for (let index = 0; index < inputs.length; index++) {
    const result = spawnSync('ldd', [inputs[index]], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`ldd failed for ${inputs[index]}: ${result.stderr || result.stdout}`)
    for (const line of result.stdout.split('\n')) {
      const match = line.match(/^\s*(\S+\.so(?:\.[\d.]+)?)\s+=>\s+(\S+)/)
      if (!match) continue
      const [, name, resolved] = match
      if (resolved === 'not') throw new Error(`Unresolved Linux dependency ${name} of ${inputs[index]}`)
      if (baseSystemLibraries.test(name) || seen.has(name)) continue
      if (!existsSync(resolved)) throw new Error(`Missing Linux dependency ${name}: ${resolved}`)
      seen.add(name)
      inputs.push(resolved)
      linuxNames.set(resolved, name)
    }
  }
}

for (const input of inputs) {
  const name = input === addon ? 'mpv_texture.node' : (linuxNames.get(input) ?? path.basename(input))
  if (binaryArchitecture(input, platform) !== arch) throw new Error(`Wrong architecture: ${input}`)
  const destination = path.join(output, name)
  copyFileSync(input, destination)
  if (platform === 'linux') {
    const patch = spawnSync('patchelf', ['--set-rpath', '$ORIGIN', destination], { encoding: 'utf8' })
    if (patch.status !== 0) throw new Error(`patchelf failed for ${destination}: ${patch.stderr}`)
  }
  const bytes = readFileSync(destination)
  copied.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
writeFileSync(path.join(output, 'mpv-bundle-manifest.json'), `${JSON.stringify({ platform, arch, renderer: 'software', files: copied }, null, 2)}\n`)
console.log(`Staged ${platform}/${arch} software MPV candidate: ${output}`)
