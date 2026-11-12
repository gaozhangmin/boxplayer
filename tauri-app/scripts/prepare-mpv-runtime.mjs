// Development-only reuse of an installed Frame Player's patched, open-source runtime.
// Release builds must use the pinned, source-built runtime described in migration docs.
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const source = resolve(process.argv[2] ?? '/Applications/Frame Player.app/Contents/Resources')
const target = resolve('.local/runtime/macos')
await mkdir(target, { recursive: true })
const files = (await readdir(join(source, 'lib'))).filter(name => (name.endsWith('.dylib') && name !== 'libmpv-wrapper.dylib') || name === 'MoltenVK_icd.json')
if (!files.includes('libmpv.dylib') || files.some(name => name.includes('soia'))) throw new Error('Expected Frame libmpv runtime without soia_utils')
const hashes = {}
for (const name of files) {
  const file = join(source, 'lib', name)
  await copyFile(file, join(target, name))
  hashes[name] = createHash('sha256').update(await readFile(file)).digest('hex')
}
for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) await copyFile(join(source, name), join(target, name))
await writeFile(join(target, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, purpose: 'M2 development verification only', source: 'Installed Frame Player application runtime', hashes }, null, 2))
console.log(`Prepared ${files.length} runtime files; no soia_utils and no wrapper loaded`)
