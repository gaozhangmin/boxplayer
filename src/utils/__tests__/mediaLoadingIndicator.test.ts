import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

describe('shared media library loading indicator', () => {
  it('shows the existing ring immediately while the library code is loading', () => {
    const page = source('layout/PageMain.vue')
    expect(page).toContain('loadingComponent: MediaLibraryLoading, delay: 0')
    expect(source('components/MediaLibraryLoading.vue')).toContain('<MediaLoadingIndicator />')
    expect(source('views/UnifiedMediaLibraryView.vue')).toContain("section === 'home' && homeIsEmpty && refreshing")
  })
  it('removes native button padding so the avatar stays centered inside its circle', () => {
    expect(source('views/UnifiedMediaLibraryView.vue')).toContain('.unified-toolbar .round-button{padding:0;box-sizing:border-box;overflow:hidden;place-items:center}')
  })
  it('uses a 128 CSS pixel ring with accessible text and reduced motion support', () => {
    const component = source('components/MediaLoadingIndicator.vue')
    expect(component).toContain('size: 128')
    expect(component).toContain('loading-ring.png')
    expect(component).toContain('role="status"')
    expect(component).toContain('prefers-reduced-motion: reduce')
  })

  it.each(['views/MediaServerWorkspace.vue', 'views/UnifiedMediaLibraryView.vue', 'components/MediaLibrary.vue'])('uses the same loading icon in %s', file => {
    const page = source(file)
    expect(page).toContain('import MediaLoadingIndicator')
    expect(page).toContain('<MediaLoadingIndicator')
    expect(page).not.toContain('<a-spin')
    expect(page).not.toContain('<LoaderCircle')
  })

  it('keeps toolbar indicators compact without shrinking page loaders', () => {
    const page = source('views/UnifiedMediaLibraryView.vue')
    expect(page).toContain('<MediaLoadingIndicator v-if="refreshing" :size="18" />')
    expect(page).toContain('class="unified-loading-state"><MediaLoadingIndicator />')
  })
})
