import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
await mkdir(new URL('./dist/', import.meta.url), { recursive: true })
const result = await build({ entryPoints: [new URL('./src/index.ts', import.meta.url).pathname], bundle: true, platform: 'browser', format: 'iife', globalName: 'BoxPlayerMusicHead', target: 'es2020', minify: true, legalComments: 'eof', footer: { js: 'globalThis.BoxPlayerMusicHead = BoxPlayerMusicHead;' }, write: false })
const bytes = result.outputFiles[0].contents
await writeFile(new URL('./dist/music-head.js', import.meta.url), bytes)
await writeFile(new URL('./dist/manifest.json', import.meta.url), JSON.stringify({ schemaVersion: 1, parser: 'music-metadata@12.5.0', maxHeadBytes: 1048576, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n')
// Ship dependency notices with every vendored copy, including transitive codecs.
const { readdir, readFile } = await import('node:fs/promises')
const { join } = await import('node:path')
const store = new URL('./node_modules/.pnpm/', import.meta.url).pathname
const notices = ['BoxPlayer shared local metadata core\n' + await readFile(new URL('./LICENSE', import.meta.url), 'utf8')]
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name)
    if (item.isDirectory()) await walk(file)
    else if (item.isFile() && /^(LICENSE|COPYING)(\.[^.]+)?$/i.test(item.name)) notices.push(`${file.slice(store.length)}\n${await readFile(file,'utf8')}`)
  }
}
await walk(store)
await writeFile(new URL('./dist/THIRD-PARTY-NOTICES.txt',import.meta.url), notices.sort().join('\n\n--------------------\n\n'))
