import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const home = readFileSync('src/views/UnifiedMediaLibraryView.vue', 'utf8')
const row = readFileSync('src/components/UnifiedMediaRow.vue', 'utf8')
const posters = readFileSync('src/styles/mediaPosters.css', 'utf8')
describe('compact media library home cards', () => {
  it('applies compact portrait sizing across grid, search, server, legacy and recommendation pages', () => {
    expect(readFileSync('src/main.ts', 'utf8')).toContain("import './styles/mediaPosters.css'")
    expect(posters).toContain('--media-poster-width: 110px')
    expect(posters).toContain('--media-poster-height: 165px')
    expect(posters).toContain('--media-poster-radius: 16px')
    for (const selector of ['.media-grid.media-grid-portrait', '.search-media-grid', '.library-shell-grid', '.library-card-portrait .library-cover', '.list-poster', '.poster-tile-portrait', '.detail-recommendation-poster', '.media-library-integration .poster', '.media-search-poster']) expect(posters).toContain(selector)
    expect(row).toContain('grid-template-columns: repeat(auto-fill, 110px)')
    expect(row).not.toContain('repeat(8, minmax(0, 1fr))')
    expect(row).toContain('.mode-list .landscape .artwork { width: 160px; height: 90px; }')
  })
  it('matches the reference favorite card proportions, gutters and captions', () => {
    expect(home).toMatch(/\.favorite-shortcut\{[^}]*width:172px/)
    expect(home).toMatch(/\.favorite-shortcut-art\{[^}]*aspect-ratio:1\.8;[^}]*border-radius:10% \/ 18%/)
    expect(home).toContain('.source-shortcuts .horizontal-row{gap:24px}')
    expect(home).toMatch(/\.favorite-shortcut strong\{[^}]*margin-top:8px;[^}]*font-size:14px/)
    expect(home).not.toContain('.favorite-shortcut{width:240px}')
  })
  it('uses the same poster ratio at every horizontal-row breakpoint', () => {
    expect(row).toMatch(/\.media-card \{ width: 110px;/)
    expect(row).toMatch(/\.artwork \{ height: 165px;[^}]*border-radius: 16px/)
    expect(row).toMatch(/\.horizontal-row \{[^}]*gap: 24px/)
    expect(row).not.toContain('width: 140px')
    expect(row).toContain('.mode-grid .artwork { height: auto; aspect-ratio: 2 / 3; }')
    expect(row).toContain('.media-card.landscape { width: 280px; }')
  })
  it('preserves provider icons, image loading and menu/navigation behavior', () => {
    expect(home).toContain('<MediaServerIcon v-else-if="sourceServer(card.key)"')
    expect(row).toContain('@click="!reordering && clickCard(card)"')
    expect(row).toContain('@contextmenu="openMenu($event, card)"')
    expect(row).toContain('loading="lazy"')
    expect(home).toContain("showCatalog('favorites')")
  })
})
