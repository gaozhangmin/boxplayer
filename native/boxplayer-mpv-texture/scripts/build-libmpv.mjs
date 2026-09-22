import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { binaryArchitecture } from '../../../scripts/check-embedded-mpv-bundles.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const platform = process.platform
const arch = process.arch

if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported embedded libmpv build target: ${platform}/${arch}`)
}
if (platform === 'win32' && arch === 'arm64') {
  throw new Error('Windows ARM64 embedded libmpv support is deferred')
}

const headerPath = path.join(packageRoot, 'deps', 'mpv', 'include', 'mpv', 'client.h')
const macArchLibrary = path.join(packageRoot, 'deps', 'mpv', 'macos', arch, 'libmpv.dylib')
const macLegacyLibrary = path.join(packageRoot, 'deps', 'mpv', 'macos', 'libmpv.dylib')
const macLibrary = existsSync(macArchLibrary) ? macArchLibrary : arch === 'arm64' ? macLegacyLibrary : macArchLibrary
const linkLibrary = platform === 'darwin'
  ? macLibrary
  : platform === 'win32'
    ? path.join(packageRoot, 'deps', 'mpv', 'win32', arch, 'mpv.lib')
    : path.join(packageRoot, 'deps', 'mpv', 'linux', arch, 'libmpv.so')

for (const filePath of [headerPath, linkLibrary]) {
  if (!existsSync(filePath)) throw new Error(`Missing ${platform}/${arch} libmpv SDK file: ${filePath}`)
}
if (platform === 'darwin' && binaryArchitecture(linkLibrary, platform) !== arch) {
  throw new Error(`Wrong-architecture libmpv SDK: ${linkLibrary}; expected ${arch}`)
}

const pnpmStore = path.join(repoRoot, 'node_modules', '.pnpm')
const nodeGypPackage = existsSync(pnpmStore)
  ? readdirSync(pnpmStore).find((name) => name.startsWith('node-gyp@'))
  : undefined
const nodeGypBin = process.env.NODE_GYP_BIN || (nodeGypPackage && path.join(pnpmStore, nodeGypPackage, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'))
if (!nodeGypBin || !existsSync(nodeGypBin)) throw new Error('node-gyp is missing; run pnpm install in the repository root first')

const bundledNodeDir = path.resolve(path.dirname(process.execPath), '..')
const nodeDir = process.env.NODE_DIR || (existsSync(path.join(bundledNodeDir, 'include', 'node', 'node.h'))
  ? bundledNodeDir
  : platform === 'darwin' && process.env.HOME && existsSync(path.join(process.env.HOME, '.hermes', 'node', 'include', 'node', 'node.h'))
    ? path.join(process.env.HOME, '.hermes', 'node')
    : undefined)
const args = [nodeGypBin, 'rebuild', ...(nodeDir ? [`--nodedir=${nodeDir}`] : [])]
const macDir = path.relative(packageRoot, path.dirname(macLibrary)).split(path.sep).join('/')
const env = { ...process.env, GYP_DEFINES: [process.env.GYP_DEFINES, 'enable_libmpv=true', ...(platform === 'darwin' ? [`mac_libmpv_dir=${macDir}`] : [])].filter(Boolean).join(' ') }
const result = spawnSync(process.execPath, args, { cwd: packageRoot, stdio: 'inherit', env })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
if (result.status === 0 && platform !== 'darwin') {
  const runtimeName = platform === 'win32' ? 'libmpv-2.dll' : 'libmpv.so.2'
  const runtimeDir = path.join(packageRoot, 'deps', 'mpv', platform, arch)
  const runtimePath = path.join(runtimeDir, runtimeName)
  if (!existsSync(runtimePath)) throw new Error(`Missing ${platform}/${arch} runtime: ${runtimePath}`)
  copyFileSync(runtimePath, path.join(packageRoot, 'build', 'Release', runtimeName))
  if (platform === 'win32') {
    for (const name of readdirSync(runtimeDir).filter((file) => file.toLowerCase().endsWith('.dll'))) {
      copyFileSync(path.join(runtimeDir, name), path.join(packageRoot, 'build', 'Release', name))
    }
  }
}
