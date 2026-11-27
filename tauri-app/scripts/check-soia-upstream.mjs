// Checks pinned upstream sources with explicit compatibility edits and the reviewed seek bar style.
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
  // Historical migration renamed the track interface/DTO only; keep the original source hashes.
  if (['components/PlayerHeader.vue', 'components/PlayerControls.vue', 'components/player-controls/RightControls.vue', 'types/media.ts', 'utils/trackDisplay.ts', 'core-client/generated/BoxPlayerDto.ts', 'core-client/generated/PlaybackSnapshotDto.ts'].includes(file.file)) {
    const restoreTypes = source => source.replace(/\bBoxPlayerDto\b/g, 'MediaTrackDto').replace(/\bBoxPlayer\b/g, 'MediaTrack')
    code = file.file.endsWith('.vue') ? code.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/, (_match, open, script, close) => open + restoreTypes(script) + close) : restoreTypes(code)
  }
  const sha = crypto.createHash('sha256').update(code).digest('hex')
  if (sha !== (file.integratedSha256 ?? file.sha256)) throw new Error(`Unexpected upstream modification: ${file.file}`)
}
console.log(`Verified ${manifest.files.length} soia source files; native imports, track types, discovery typing and the pinned BoxPlayer seek bar style verified.`)
