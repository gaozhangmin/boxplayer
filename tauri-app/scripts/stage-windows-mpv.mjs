import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [source, destination, readobj, system32] = process.argv.slice(2)
if (!source || !destination || !readobj || !system32) {
  throw new Error('Usage: stage-windows-mpv.mjs <MSYS2 bin> <destination> <llvm-readobj> <System32>')
}

const files = new Map(
  readdirSync(source, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.dll'))
    .map(entry => [entry.name.toLowerCase(), entry.name]),
)
const mpv = 'libmpv-2.dll'
if (!files.has(mpv)) throw new Error(`Missing ${mpv} in ${source}`)

// mpv can load the Vulkan loader and VapourSynth at runtime.
const dynamic = ['vulkan-1.dll', 'libvapoursynth-script-0.dll'].filter(name => files.has(name))
const pending = [mpv, ...dynamic]
const staged = new Set()
while (pending.length > 0) {
  const name = pending.pop()
  if (staged.has(name)) continue

  const path = join(source, files.get(name))
  const report = execFileSync(readobj, ['--coff-imports', path], { encoding: 'utf8' })
  if (!report.includes('Format: COFF-')) throw new Error(`Expected a PE/COFF DLL: ${path}`)
  staged.add(name)

  // llvm-readobj reports both eager and delay-loaded imports with a Name field.
  for (const [, imported] of report.matchAll(/^\s*Name: (\S+\.dll)\s*$/gim)) {
    const dependency = imported.toLowerCase()
    if (files.has(dependency)) {
      pending.push(dependency)
    } else if (!/^(api|ext)-ms-win-/.test(dependency) && !existsSync(join(system32, imported))) {
      throw new Error(`${name} imports missing DLL ${imported}`)
    }
  }
}

mkdirSync(destination, { recursive: true })
if (readdirSync(destination).length !== 0) throw new Error(`Runtime staging directory is not empty: ${destination}`)
let bytes = 0
for (const name of [...staged].sort()) {
  const file = files.get(name)
  const path = join(source, file)
  copyFileSync(path, join(destination, file))
  bytes += statSync(path).size
}
console.log(`Staged ${staged.size} of ${files.size} DLLs for libmpv (${bytes} bytes)`)
