import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { planMusicDownload, isDownloadableMusicTrack } from '../musicDownload'
import { albumPinKey, loadMusicPins, saveMusicPins, toggleMusicPin, MUSIC_PINS_KEY } from '../musicPins'

const cloud = (file_id: string, user_id = 'u1') => ({ user_id, drive_id: 'd1', file_id, parent_file_id: 'p', file_name: `${file_id}.flac`, encType: '' })

describe('music library Apple Music style actions', () => {
  it('plans whole-list downloads for cloud tracks and skips local or media server tracks', () => {
    const plan = planMusicDownload([
      cloud('a'),
      cloud('a'),
      cloud('b'),
      { ...cloud('local-1', 'local'), drive_id: 'local', local_url: '/tmp/x.mp3' },
      { ...cloud('ms-1', 'media-server:s1'), drive_id: 'media-server:s1', media_server_id: 's1' }
    ])
    expect(plan.files.map(file => file.file_id)).toEqual(['a', 'b'])
    expect(plan.files[0]).toMatchObject({ user_id: 'u1', drive_id: 'd1', name: 'a.flac', ext: 'flac', category: 'audio', isDir: false })
    expect(plan.skipped).toBe(2)
    expect(isDownloadableMusicTrack(cloud('c'))).toBe(true)
  })

  it('toggles and persists pins', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    const key = albumPinKey('Artist', 'Album')
    let pins = toggleMusicPin([], { key, type: 'album', title: 'Album' }, 1)
    expect(pins).toEqual([{ key, type: 'album', title: 'Album', pinnedAt: 1 }])
    saveMusicPins(pins, storage)
    expect(store.has(MUSIC_PINS_KEY)).toBe(true)
    expect(loadMusicPins(storage)).toEqual(pins)
    pins = toggleMusicPin(pins, { key, type: 'album', title: 'Album' })
    expect(pins).toEqual([])
  })

  it('uses shuffle, play and download-all controls on the detail page', () => {
    const browser = readFileSync(new URL('../../layout/music/MusicLibraryBrowser.vue', import.meta.url), 'utf8')
    expect(browser).toMatch(/detail-actions">\s*<button class="detail-round" :aria-label="tt\('music\.lib\.shufflePlay'\)"[^>]*@click="shufflePlay"/)
    expect(browser).toContain('class="detail-play"')
    expect(browser).toContain('@click="downloadTracks(detailTracks)"')
    expect(browser).toContain('DownDAL.aAddDownload(files, savePath, false)')
    expect(browser).toMatch(/:global\(body\[arco-theme='dark'\] \.music-browser\)/)
    expect(browser).toContain('@click="downloadTracks(detailTracks)"><ArrowDown')
    expect(browser).toContain("@click=\"openMenu($event, 'home')\"")
    expect(browser).toContain("key: 'import-local'")
    expect(browser).toContain("appStore.toggleTab('down')")
    expect(browser).toMatch(/\.detail-capsule \{[^}]*padding:0 6px[^}]*color:var\(--color-text-1\)/)
  })
})
