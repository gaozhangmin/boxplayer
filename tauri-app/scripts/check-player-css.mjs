// Verify the built player has no main-shell reset; this catches cross-entry CSS leaks.
import fs from 'node:fs'
const html = fs.readFileSync('dist/player.html', 'utf8')
const sheets = [...html.matchAll(/href="([^\"]+\.css)"/g)].map(match => match[1])
if (!sheets.length) throw new Error('Player has no stylesheet')
for (const sheet of sheets) {
  const css = fs.readFileSync(`dist${sheet}`, 'utf8')
  if (css.includes('@layer base') || css.includes('.nav-item') || /button,input,select\{font:inherit\}/.test(css)) throw new Error(`Main shell CSS leaked into player: ${sheet}`)
}
console.log('Player CSS is isolated from Tailwind preflight and main-shell button styles.')
