import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('limits the shared glass material to media detail actions', () => {
  const css = readFileSync(resolve('src/styles/glass-controls.css'), 'utf8')
  const materialRule = css.match(/^(:root:root[^{}]+)\{\s*border-width: var\(--app-control-border-width/m)?.[1]
  const inclusion = materialRule?.match(/:where\(\s*(\.media-detail :is\([^()]+\))\s*\):not/)?.[1]
  expect(inclusion).toBeDefined()
  const fixture = document.createElement('div')
  fixture.innerHTML = `
    <section class="media-host">
      <button id="music-back">Return to music library</button>
      <button id="music-play" class="ctrl-btn">Play</button>
    </section>
    <section class="settings-card">
      <button id="help" class="bp-glass-control" data-button-variant="outline">Open help</button>
    </section>
    <section class="na-workspace"><button id="recipe">Recipe</button></section>
    <section class="source-window-content"><button id="source">New folder</button></section>
    <section class="media-detail">
      <button id="play" class="play-button">Play</button>
      <button id="detail-back" class="detail-back">Back</button>
      <button id="episode" class="episode-card">Episode</button>
    </section>`
  document.body.append(fixture)
  try {
    const controls = Array.from(fixture.querySelectorAll('button'))
    expect(controls.filter(button => button.matches(inclusion!)).map(button => button.id))
      .toEqual(['play', 'detail-back'])
  } finally {
    fixture.remove()
  }
})
