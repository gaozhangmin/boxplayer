import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('115 subtitle playback', () => {
  it('routes every authenticated MPV quality through the MPV-only proxy without changing web playback', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain('const useAuthenticatedMpvProxy = !pageVideo.encType && hasPlaybackHeaders(defaultHeaders)')
    expect(source).toContain("useAuthenticatedMpvProxy ? 'mpv' : ''")
    expect(source).toContain("const resolveRawMpvQualitySource = (data: IRawUrl")
    expect(source).toContain("const defaultUrl = resolveHeaderAwareVideoUrl(defaultQuality.url, defaultHeaders, data.size, defaultQuality.quality || '', useAuthenticatedMpvProxy")
    expect(source).toContain('const mpvHeaders = defaultUrl === defaultQuality.url ? defaultHeaders : undefined')
    expect(source).toContain('headers: mpvHeaders')
    expect(source).toContain("const defaultUrl = resolveHeaderAwareVideoUrl(defaultQuality.url, defaultHeaders, data.size, defaultQuality.quality || '')")
    expect(source).not.toContain('const use115OriginProxy')
    expect(source).not.toContain('proxy_url: directUrl')
  })

  it('proxies web playback whenever a provider requires download headers', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain('if (!pageVideo.encType && !hasPlaybackHeaders(headers)) return url')
    expect(source).toContain('proxy_headers: hasPlaybackHeaders(headers) ? JSON.stringify(headers) : undefined')
  })

  it('loads the default embedded subtitle and passes its format to Artplayer', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain('const ext = getSubtitleItemExt(item)')
    expect(source).toContain('decodeSubtitleBuffer(await response.arrayBuffer())')
    expect(source).toContain('await loadSubtitleUrlToPlayer(art, embedSubSelector[0])')
    expect(source).toContain('ext: getSubtitleExtension(subtitle.url)')
    expect(source).not.toContain('art.subtitle.url = embedSubSelector[0].url')
  })

  it('loads the bundled CJK font before creating an ASS track and raises subtitles above the player edge', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain("import JASSUBCjkFont from '../assets/fonts/NotoSansCJKsc-Regular.otf?url'")
    expect(source).toContain('const getJassubCjkFont = async')
    expect(source).toContain('const cjkFont = await getJassubCjkFont()')
    expect(source).toContain("availableFonts['microsoft yahei'] = cjkFont")
    expect(source).toContain('fonts: cjkFont ? [cjkFont] : []')
    expect(source).toContain('transform: translateY(-5%)')
    expect(existsSync(resolve(process.cwd(), 'src/assets/fonts/NotoSansCJKsc-Regular.otf'))).toBe(true)
  })

  it('refreshes a newly loaded subtitle track and returns the selected label', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain("art.once('subtitleLoad', finish)")
    expect(source).not.toContain("art.off('subtitleLoad', finish)")
    expect(source).toContain('if (textTrack?.activeCues != null)')
    expect(source).toContain('await refreshCurrentSubtitleCue(art)')
    expect(source).toContain('onSelect: async (selector: any, element: HTMLElement, event: Event) =>')
    expect(source).toContain('return await loadSubtitleItem(art, item)')
  })

  it('dispatches embedded and cloud subtitle candidates through their matching loaders', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain('const loadSubtitleItem = async (art: Artplayer, item: selectorItem)')
    expect(source).toContain('? loadOnlineSub(art, item)')
    expect(source).toContain(': loadSubtitleUrlToPlayer(art, item)')
    expect(source).toContain('await loadSubtitleItem(art, subSelector[similarity.index])')
  })

  it('routes embedded MPV external subtitles through the authenticated cloud subtitle resolver', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain("const subtitleFiles = await getSubtitleFileList(useSettingStore().mediaLibrarySubtitleScope === 'include-subfolders')")
    expect(source).toContain('const subtitleUrl = await resolveCloudSubtitleUrl(subtitleFile)')
    expect(source).toContain('mpvEmbeddedSubtitleSources.value = subtitleSources')
  })

  it('applies the subtitle folder scope without reloading the active subtitle', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain('const getSubtitleFileList = async (includeSubfolders = false)')
    expect(source).toContain('if (includeSubfolders) {')
    expect(source).toContain('const getSubTitleList = async (art: Artplayer, autoLoad = true)')
    expect(source).toContain("useSettingStore().mediaLibrarySubtitleScope === 'include-subfolders'")
    expect(source).not.toContain('subTitleListMode')
    expect(source).toContain('if (!autoLoad && onlineSubData.name)')
  })

  it('places cloud and embedded subtitle selection beside the audio-track control', () => {
    const source = readSource('src/layout/PageVideo.vue')

    expect(source).toContain("name: 'subtitleListControl'")
    expect(source).toContain("position: 'right'")
    expect(source).toContain('selector: subSelector')
    expect(source).not.toContain("html: t('video.singleSubtitle')")
  })

  it('uses the shared 115 user-agent when the subtitle proxy requests upstream data', () => {
    const playerSource = readSource('src/layout/PageVideo.vue')
    const source = readSource('src/utils/proxyhelper.ts')

    expect(playerSource).toContain('const userId = item.user_id || pageVideo.user_id')
    expect(playerSource).toContain('await DriveFile.ApiFileDownloadUrl(userId, driveId, item.file_id, 14400, tokenfrom)')
    expect(playerSource).toContain("proxy_kind: 'subtitle'")
    expect(playerSource).toContain('const playbackHeaders = useMacEmbeddedMpv ? mergeMpvPlaybackHeaders(provider, data.headers) : data.headers')
    expect(playerSource).toContain('proxy_headers: hasPlaybackHeaders(playbackHeaders) ? JSON.stringify(playbackHeaders) : undefined')
    expect(playerSource).not.toContain('const data = await AliFile.ApiFileDownText(pageVideo.user_id, pageVideo.drive_id, item.file_id')
    expect(source).toContain("import { DRIVE115_DOWN_AGENT } from '@shared/drive115'")
    expect(source).toContain("upstreamHeaders['user-agent'] = DRIVE115_DOWN_AGENT")
  })

  it('preserves provider download headers for web and external-player subtitles', () => {
    const cloud139Source = readSource('src/cloud139/adapter.ts')
    const cloud189Source = readSource('src/cloud189/adapter.ts')
    const playerSource = readSource('src/utils/playerhelper.ts')

    expect(cloud139Source).toContain('headers: cloud139DownloadHeaders()')
    expect(cloud189Source).toContain('headers: cloud189DownloadHeaders()')
    expect(playerSource).toContain("proxy_kind: 'subtitle'")
    expect(playerSource).toContain('proxy_headers: headers && Object.values(headers).some(Boolean) ? JSON.stringify(headers) : undefined')
    expect(playerSource).toContain('subTitleUrl = await resolveExternalSubtitleUrl(token.user_id, subTitleFile)')
    expect(playerSource).toContain('const subtitleUrl = await resolveExternalSubtitleUrl(token.user_id, subTitleFile)')
    expect(playerSource).toContain('buildExternalSubtitleProxyUrl(token.user_id, file.drive_id, file.file_id, subTitleData.url, 0, subTitleData.headers)')
  })

  it('keeps the real cloud parent directory in media-library scan records', () => {
    const scannerSource = readSource('src/utils/mediaScanner.ts')
    const detailSource = readSource('src/components/MediaDetail.vue')

    expect(scannerSource).toContain('parentFileId: item.parent_file_id || folder.file_id')
    expect(detailSource).toContain('driveFile.parentFileId ||')
  })
})
