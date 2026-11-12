// Verifies that the integrated UI remains upstream, apart from explicit native imports.
import fs from 'node:fs'
import crypto from 'node:crypto'
const root = new URL('../src/vendor/soia/', import.meta.url)
const manifest = JSON.parse(fs.readFileSync(new URL('upstream-manifest.json', root), 'utf8'))
for (const file of manifest.files) {
  let code = fs.readFileSync(new URL(file.file, root), 'utf8')
  if (file.file === 'components/PlayerHeader.vue' || file.file === 'components/player-controls/RightControls.vue') {
    code = code.replace('from "@/features/player/soia/native"', 'from "@tauri-apps/api/core"').replace('from "@/features/player/soia/clipboard"', 'from "@tauri-apps/plugin-clipboard-manager"')
  }
  if (file.file === 'composables/useCasting.ts') code = code.replace('const discover = (showProgress: boolean | Event = true)', 'const discover = (showProgress = true)')
  const sha = crypto.createHash('sha256').update(code).digest('hex')
  if (sha !== file.sha256) throw new Error(`Unexpected upstream modification: ${file.file}`)
}
console.log(`Verified ${manifest.files.length} soia source files; UI templates/styles unchanged; only native imports and discovery event typing adapted.`)
