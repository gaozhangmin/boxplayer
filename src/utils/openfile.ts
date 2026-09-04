import { IAliGetFileModel } from '../aliapi/alimodels'
import AliArchive from '../aliapi/archive'
import AliFile from '../aliapi/file'
import AliFileCmd from '../aliapi/filecmd'
import ServerHttp from '../aliapi/server'
import { ITokenInfo, useAppStore, useFootStore, usePanFileStore, usePanTreeStore, useSettingStore, useUserStore } from '../store'
import { IPageCode, IPageDocx, IPageImage, IPageMusic, IPageMusicTrack, IPageOffice, IPagePdf, IPageSheet, IPageVideo, IPageVideoPlaylistEntry, IPageVideoSubtitleFile } from '../store/appstore'
import UserDAL from '../user/userdal'
import { clickWait } from './debounce'
import DebugLog from './debuglog'
import message from './message'
import { modalArchive, modalArchivePassword, modalSelectPanDir, modalSelectVideoQuality } from './modal'
import PlayerUtils from './playerhelper'
import { getEncType, getProxyUrl, getRawUrl } from './proxyhelper'
import { getLocalVideoProgress } from './videoProgress'
import { isVideoFile } from './videoFile'
import { isAliyunUser, isBaiduUser, isBoxUser, isCloud123User, isCloud139User, isCloud189User, isDrive115User, isDropboxUser, isGoogleUser, isGuangyaUser, isOneDriveUser, isPikPakUser, isQuarkUser } from '../aliapi/utils'
import { resolveDriveFileToken } from '../drive/account'
import { parseBookMeta } from './bookFilenameMeta'
import { isReaderFormat, normalizeBookExt } from './bookReaderCapabilities'
import type { IBookItem } from '../types/book'

async function resolveTokenForFile(file: IAliGetFileModel): Promise<ITokenInfo | undefined> {
  return resolveDriveFileToken(file as IAliGetFileModel & { user_id?: string }, useUserStore().user_id)
}

function buildSiblingVideoPlaylist(file: IAliGetFileModel, userId: string, tokenfrom: string, provided?: IPageVideoPlaylistEntry[]): IPageVideoPlaylistEntry[] {
  if (provided && provided.length > 0) return provided.map((item) => ({ ...item, tokenfrom: item.tokenfrom || tokenfrom }))
  const rawItems = usePanFileStore().ListDataRaw || []
  const visibleItems = rawItems.filter((item: any) => !item.isDir)
  const sameDirectory = visibleItems.filter((item: any) => item.parent_file_id === file.parent_file_id)
  const candidates = (sameDirectory.length > 1 ? sameDirectory : visibleItems).filter(isVideoFile)
  if (!candidates.some((item: any) => item.file_id === file.file_id)) candidates.push(file)
  if (candidates.length <= 1) return []
  return candidates
    .sort((left: any, right: any) => String(left.name || left.file_name || '').localeCompare(String(right.name || right.file_name || ''), undefined, { numeric: true, sensitivity: 'base' }))
    .map((item: any): IPageVideoPlaylistEntry => ({
      user_id: userId,
      tokenfrom,
      drive_id: item.drive_id || file.drive_id,
      file_id: item.file_id,
      parent_file_id: item.parent_file_id || file.parent_file_id,
      file_name: item.name || item.file_name || item.html,
      html: item.name || item.file_name || item.html,
      ext: item.ext,
      description: item.description,
      play_cursor: item.play_cursor,
      password: item.file_id === file.file_id ? undefined : ''
    }))
}

const TEXT_PREVIEW_EXTS = new Set(['txt', 'text', 'log', 'csv', 'tsv', 'nfo', 'srt', 'vtt', 'ass', 'ssa'])
const PDF_PREVIEW_DRIVES = new Set(['cloud123', 'drive115', 'baidu', 'pikpak', 'dropbox', 'onedrive', 'box', 'google', 'quark', 'guangya', 'cloud139', 'cloud189'])
const DOCX_PREVIEW_DRIVES = PDF_PREVIEW_DRIVES
const OFFICE_TO_PDF_DRIVES = PDF_PREVIEW_DRIVES
const SHEET_PREVIEW_DRIVES = PDF_PREVIEW_DRIVES
const SHEET_PREVIEW_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'tsv'])
const OFFICE_TO_PDF_EXTS = new Set(['doc', 'docm', 'dot', 'dotm', 'dotx', 'rtf', 'odt', 'ott', 'wps', 'wpt', 'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'ods', 'ots', 'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'odp', 'dps', 'dpt'])

function getPreviewTheme(): 'light' | 'dark' {
  const appStore = useAppStore()
  return appStore.appTheme === 'dark' || (appStore.appTheme === 'system' && appStore.appDark) ? 'dark' : 'light'
}

function TextPreviewExt(fileExt: string): string {
  return TEXT_PREVIEW_EXTS.has((fileExt || '').toLowerCase().replace('.', '').trim()) ? 'plain' : ''
}

function getBookFileExt(file: IAliGetFileModel): string {
  return normalizeBookExt(file.ext || file.name?.split('.').pop() || '')
}

async function Book(file: IAliGetFileModel): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线阅读失败，账号失效，操作取消')
    return
  }
  const ext = getBookFileExt(file)
  const metadata = parseBookMeta(file.name || '未命名书籍')
  const book: IBookItem = {
    id: `cloud:${token.user_id}:${file.drive_id}:${file.file_id}`,
    user_id: token.user_id,
    tokenfrom: token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom,
    drive_id: file.drive_id,
    file_id: file.file_id,
    parent_file_id: file.parent_file_id,
    file_name: file.name || '未命名书籍',
    ext,
    size: file.size || 0,
    category: ['cbz', 'cbr', 'cbt', 'cb7'].includes(ext) ? 'comic' : 'book',
    thumbnail: file.thumbnail,
    description: file.description,
    ...metadata,
    scanned_at: Date.now(),
    updated_at: Date.now()
  }
  window.WebOpenWindow({ page: 'PageBookReader', data: book, theme: 'dark' })
}

export async function menuOpenFile(
  file: IAliGetFileModel,
  password: string = '',
  options?: {
    customPlaylistLabel?: string
    customPlaylist?: IPageVideoPlaylistEntry[]
  }
): Promise<void> {
  if (clickWait('menuOpenFile', 500)) return
  if (!file.drive_id) file = { ...file, drive_id: usePanTreeStore().drive_id }
  const file_id = file.file_id
  let parent_file_id = file.parent_file_id
  if (parent_file_id.includes('root')) parent_file_id = 'root'
  const drive_id = file.drive_id
  if (file.ext == 'zip' || file.ext == 'rar' || file.ext == '7z') {
    if (file.description && file.description.includes('xbyEncrypt')) {
      message.error('不支持在线预览该格式的加密文件')
      return
    }
    Archive(file.drive_id, file.file_id, file.name, file.parent_file_id, file.icon == 'iconweifa')
    return
  }
  // All reader-supported formats use the provider-neutral download gateway
  // inside BookReaderModal, so they work for every supported cloud drive.
  // Keep PDF on its dedicated viewer because it provides page navigation and
  // the document AI sidebar.
  const bookFileExt = getBookFileExt(file)
  if (bookFileExt !== 'pdf' && bookFileExt !== 'docx' && isReaderFormat(bookFileExt)) {
    await Book(file)
    return
  }

  if (file.category.startsWith('doc')) {
    const textExt = TextPreviewExt(file.ext)
    if (textExt) {
      await Code(file, textExt, password)
      return
    }
    // PDF.js uses the provider-neutral download proxy below, so PDFs from
    // Aliyun and every third-party drive must take the same local preview
    // route. Falling through here opens the legacy remote Office iframe,
    // which cannot host the BoxPlayer AI sidebar.
    if ((file.ext || '').toLowerCase() === 'pdf') {
      await Pdf(file, password)
      return
    }
    if ((file.ext || '').toLowerCase() === 'docx' && DOCX_PREVIEW_DRIVES.has(file.drive_id || '')) {
      await Docx(file, password)
      return
    }
    if (SHEET_PREVIEW_EXTS.has((file.ext || '').toLowerCase()) && SHEET_PREVIEW_DRIVES.has(file.drive_id || '')) {
      await Sheet(file, password)
      return
    }
    if (OFFICE_TO_PDF_EXTS.has((file.ext || '').toLowerCase()) && OFFICE_TO_PDF_DRIVES.has(file.drive_id || '')) {
      await OfficePdf(file, password)
      return
    }
    if (file.description && file.description.includes('xbyEncrypt')) {
      const codeExt = PrismExt(file.ext) || TextPreviewExt(file.ext)
      if (file.size < 512 * 1024 || (file.size < 5 * 1024 * 1024 && codeExt)) {
        await Code(file, codeExt, password)
        return
      } else {
        message.error('不支持在线预览该格式的加密文件')
        return
      }
    }
    await Office(file)
    return
  }

  if (file.category == 'image' || file.category == 'image2') {
    await Image(file, password)
    return
  }
  if (file.category == 'image3') {
    message.info('此格式暂不支持预览')
    return
  }
  if (isVideoFile(file)) {
    const token = await resolveTokenForFile(file)
    if (!token || !token.access_token) {
      message.error('在线预览失败 账号失效，操作取消')
      return
    }
    // 选择字幕
    let subTitleFile: any
    const { uiVideoPlayer, uiVideoSubtitleMode } = useSettingStore()
    const useMacEmbeddedMpv = uiVideoPlayer === 'mpv' && window.platform === 'darwin'
    const listDataRaw: IAliGetFileModel[] = usePanFileStore().ListDataRaw || []
    const subTitlesList: IAliGetFileModel[] = listDataRaw.filter((file) => /srt|vtt|ass/.test(file.ext))
    if (uiVideoPlayer !== 'web' && !useMacEmbeddedMpv) {
      if (uiVideoSubtitleMode === 'auto') {
        subTitleFile = PlayerUtils.filterSubtitleFile(file.name, subTitlesList)
      } else if (uiVideoSubtitleMode === 'select') {
        modalSelectPanDir(
          'select',
          parent_file_id,
          async (_user_id: string, _drive_id: string, selectFile: any) => {
            await Video(token, file, selectFile, password, options)
          },
          '',
          /srt|vtt|ass/
        )
        return
      }
    }
    await Video(token, file, subTitleFile, password, options)
    return
  }
  if (file.category.startsWith('audio')) {
    await Audio(file, password)
    return
  }
  const codeExt = PrismExt(file.ext) || TextPreviewExt(file.ext)
  if (file.size < 512 * 1024 || (file.size < 5 * 1024 * 1024 && codeExt)) {
    await Code(file, codeExt, password)
    return
  }
  message.info('此格式暂不支持预览')
}

async function Archive(drive_id: string, file_id: string, file_name: string, parent_file_id: string, weifa: boolean): Promise<void> {
  if (weifa) {
    message.error('违规文件，操作取消')
    return
  }
  const user_id = useUserStore().user_id
  const token = await UserDAL.GetUserTokenFromDB(user_id)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  const info = await AliFile.ApiFileInfo(user_id, drive_id, file_id)
  if (info && typeof info == 'string') {
    message.error('在线预览失败 获取文件信息出错：' + info)
    return
  }
  let password = ''
  let resp = await AliArchive.ApiArchiveList(user_id, drive_id, file_id, info.domain_id, info.file_extension || '', password)

  if (!resp) {
    message.error('在线预览失败 获取解压信息出错，操作取消')
    return
  }

  if (resp.state == '密码错误' && useSettingStore().yinsiZipPassword) {
    password = await ServerHttp.PostToServer({
      cmd: 'GetZipPwd',
      sha1: info.content_hash,
      size: info.size
    }).then((serdata) => {
      if (serdata.password) return serdata.password
      return ''
    })
    if (password) resp = await AliArchive.ApiArchiveList(user_id, drive_id, file_id, info.domain_id, info.file_extension || '', password)
  }

  if (!resp) {
    message.error('在线预览失败 获取解压信息出错，操作取消')
    return
  }

  if (resp.state == '密码错误') {
    modalArchivePassword(user_id, drive_id, file_id, file_name, parent_file_id, info.domain_id, info.file_extension || '')
  } else if (resp.state == 'Succeed' || resp.state == 'Running') {
    modalArchive(user_id, drive_id, file_id, file_name, parent_file_id, password)
  } else {
    message.error('在线解压失败 ' + resp.state + '，操作取消')
    DebugLog.mSaveDanger('在线解压失败 ' + resp.state, drive_id + ' ' + file_id)
  }
}

async function Video(
  token: ITokenInfo,
  file: IAliGetFileModel,
  subTitleFile: any,
  password: string = '',
  options?: {
    customPlaylistLabel?: string
    customPlaylist?: IPageVideoPlaylistEntry[]
  }
): Promise<void> {
  if (file.icon == 'iconweifa') {
    message.error('在线预览失败 无法预览违规文件')
    return
  }
  let desc = file.description
  const {
    uiAutoColorVideo,
    uiVideoQuality,
    uiVideoQualityTips,
    uiVideoEnablePlayerList,
    uiVideoPlayer,
    uiVideoPlayerPath
  } = useSettingStore()
  if (uiVideoPlayer === 'mpv' && window.platform !== 'darwin') {
    useSettingStore().updateStore({ uiVideoPlayer: 'other' })
    message.error('内置 MPV 仅支持 macOS，请在设置中选择“自定义播放软件”并指定播放器路径。')
    return
  }
  if (uiAutoColorVideo && !isPikPakUser(token) && !isDropboxUser(token) && !isOneDriveUser(token) && !isBoxUser(token) && file.drive_id !== 'pikpak' && file.drive_id !== 'dropbox' && file.drive_id !== 'onedrive' && file.drive_id !== 'box' && (!desc || !desc.includes('ce74c3c'))) {
    AliFileCmd.ApiFileColorBatch(token.user_id, file.drive_id, file.description, 'ce74c3c', [file.file_id])
  }
  if (uiVideoPlayer == 'web' || (uiVideoPlayer === 'mpv' && window.platform === 'darwin')) {
    let play_cursor = 0
    let playCursorInfo = await PlayerUtils.getPlayCursor(token.user_id, file.drive_id, file.file_id)
    if (playCursorInfo) {
      play_cursor = playCursorInfo.play_cursor
    } else {
      play_cursor = file.media_play_cursor ? parseInt(file.media_play_cursor) : 0
    }
    play_cursor = Math.max(play_cursor, getLocalVideoProgress(token.user_id, file.drive_id, file.file_id))
    // 获取文件夹信息
    const info = await AliFile.ApiFileInfo(token.user_id, file.drive_id, file.parent_file_id)
    let parent_file_name = ''
    if (info && typeof info !== 'string') {
      parent_file_name = info.name
    }
    const librarySubtitleFiles: IPageVideoSubtitleFile[] = ((file as any).library_subtitle_files || []).map((subtitle: any) => ({
      file_id: subtitle.id,
      name: subtitle.name,
      parent_file_id: subtitle.parentFileId || file.parent_file_id,
      drive_id: subtitle.driveId || file.drive_id,
      user_id: subtitle.userId || token.user_id,
      ext: subtitle.name?.split('.').pop()
    }))
    const pageVideo: IPageVideo = {
      user_id: token.user_id,
      tokenfrom: token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom,
      file_name: file.name,
      html: file.name,
      drive_id: file.drive_id,
      file_id: file.file_id,
      parent_file_id: file.parent_file_id,
      parent_file_name: parent_file_name,
      expire_time: 0,
      password: password,
      encType: getEncType(playCursorInfo?.info || ''),
      play_cursor: play_cursor,
      custom_playlist_label: options?.customPlaylistLabel || '',
      custom_playlist: buildSiblingVideoPlaylist(file, token.user_id, token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom, options?.customPlaylist),
      library_subtitle_files: librarySubtitleFiles
    }
    window.WebOpenWindow({ page: 'PageVideo', data: pageVideo, theme: 'dark' })
    return
  }
  message.loading('加载中...', 2)
  const isWindows = window.platform === 'win32'
  const isMacOrLinux = ['darwin', 'linux'].includes(window.platform)
  if (!isWindows && !isMacOrLinux) {
    message.error('不支持的系统，操作取消')
    return
  }
  if (uiVideoPlayer === 'other' && !uiVideoPlayerPath.trim()) {
    message.error('请先在设置中选择或填写自定义播放器')
    return
  }
  let rawData: any = undefined
  let encType = getEncType(file)
  if (uiVideoQualityTips || !uiVideoEnablePlayerList) {
    rawData = await getRawUrl(token.user_id, file.drive_id, file.file_id, encType, password, file.icon == 'iconweifa', 'video')
    if (typeof rawData == 'string') {
      message.error('视频地址解析失败，操作取消')
      return
    }
    if (rawData.url.indexOf('x-oss-additional-headers=referer') > 0) {
      message.error('用户token已过期，请点击头像里退出按钮后重新登录账号')
      return
    }
  }
  let otherArgs: any = {
    file, subTitleFile,
    playList: [],
    fileList: [],
    playFileListPath: '',
    rawData, password,
    quality: uiVideoQuality
  }
  // 清晰度选择
  if (uiVideoQualityTips && !encType) {
    if (rawData) {
      modalSelectVideoQuality(file, rawData, async (quality: any) => {
        otherArgs.quality = quality
        await PlayerUtils.startPlayer(token, uiVideoPlayerPath, otherArgs)
      })
    } else {
      message.error('视频地址解析失败，操作取消')
    }
  } else {
    await PlayerUtils.startPlayer(token, uiVideoPlayerPath, otherArgs)
  }
}

async function Image(file: IAliGetFileModel, password: string = ''): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  const fileList = usePanFileStore().ListDataRaw
  const imageList = fileList.filter((v) => v.category == 'image' || v.category == 'image2')
  if (imageList.length == 0) {
    message.error('获取文件预览链接失败，操作取消')
    return
  }

  const pageImage: IPageImage = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_name: file.name,
    mode: useSettingStore().uiImageMode,
    password: password,
    imageList: imageList
  }
  window.WebOpenWindow({ page: 'PageImage', data: pageImage, theme: 'dark' })
}

async function Pdf(file: IAliGetFileModel, password: string = ''): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  const rawData = await getRawUrl(token.user_id, file.drive_id, file.file_id, getEncType(file), password, file.icon == 'iconweifa', 'other', 'Origin')
  if (typeof rawData === 'string' || !rawData.url) {
    message.error(typeof rawData === 'string' ? rawData : '获取 PDF 预览链接失败，操作取消')
    return
  }
  const pagePdf: IPagePdf = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_name: file.name,
    preview_url: getProxyUrl({
      user_id: token.user_id,
      drive_id: file.drive_id,
      file_id: file.file_id,
      file_size: rawData.size || file.size,
      proxy_url: rawData.url,
      proxy_headers: JSON.stringify(rawData.headers || {}),
      content_disposition: 'inline',
      file_name: file.name
    })
  }
  window.WebOpenWindow({ page: 'PagePdf', data: pagePdf, theme: getPreviewTheme(), appTheme: useAppStore().appTheme })
}

async function Docx(file: IAliGetFileModel, password: string = ''): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  const rawData = await getRawUrl(token.user_id, file.drive_id, file.file_id, getEncType(file), password, file.icon == 'iconweifa', 'other', 'Origin')
  if (typeof rawData === 'string' || !rawData.url) {
    message.error(typeof rawData === 'string' ? rawData : '获取 Word 预览链接失败，操作取消')
    return
  }
  const pageDocx: IPageDocx = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_name: file.name,
    preview_url: getProxyUrl({
      user_id: token.user_id,
      drive_id: file.drive_id,
      file_id: file.file_id,
      file_size: rawData.size || file.size,
      proxy_url: rawData.url,
      proxy_headers: JSON.stringify(rawData.headers || {}),
      content_disposition: 'inline',
      file_name: file.name
    })
  }
  window.WebOpenWindow({ page: 'PageDocx', data: pageDocx, theme: 'dark' })
}

async function OfficePdf(file: IAliGetFileModel, password: string = ''): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('正在转换文档...', 2)
  const rawData = await getRawUrl(token.user_id, file.drive_id, file.file_id, getEncType(file), password, file.icon == 'iconweifa', 'other', 'Origin')
  if (typeof rawData === 'string' || !rawData.url) {
    message.error(typeof rawData === 'string' ? rawData : '获取文档预览链接失败，操作取消')
    return
  }
  const sourceUrl = getProxyUrl({
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_size: rawData.size || file.size,
    proxy_url: rawData.url,
    proxy_headers: JSON.stringify(rawData.headers || {}),
    content_disposition: 'inline',
    file_name: file.name
  })
  const converted = await window.TvBoxInvoke('OfficePreview:convertToPdf', {
    sourceUrl,
    fileName: file.name
  }) as { ok: boolean; pdfUrl?: string; error?: string }
  if (!converted?.ok || !converted.pdfUrl) {
    message.error(converted?.error || '文档转换 PDF 失败，操作取消')
    return
  }
  const pagePdf: IPagePdf = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    // Keep the original extension in the preview context. The converted
    // preview is PDF, but Document AI must download and parse the source file.
    file_name: file.name,
    preview_url: converted.pdfUrl
  }
  window.WebOpenWindow({ page: 'PagePdf', data: pagePdf, theme: getPreviewTheme(), appTheme: useAppStore().appTheme })
}

async function Sheet(file: IAliGetFileModel, password: string = ''): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  const rawData = await getRawUrl(token.user_id, file.drive_id, file.file_id, getEncType(file), password, file.icon == 'iconweifa', 'other', 'Origin')
  if (typeof rawData === 'string' || !rawData.url) {
    message.error(typeof rawData === 'string' ? rawData : '获取表格预览链接失败，操作取消')
    return
  }
  const pageSheet: IPageSheet = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_name: file.name,
    preview_url: getProxyUrl({
      user_id: token.user_id,
      drive_id: file.drive_id,
      file_id: file.file_id,
      file_size: rawData.size || file.size,
      proxy_url: rawData.url,
      proxy_headers: JSON.stringify(rawData.headers || {}),
      content_disposition: 'inline',
      file_name: file.name
    })
  }
  window.WebOpenWindow({ page: 'PageSheet', data: pageSheet, theme: 'dark' })
}

async function Office(file: IAliGetFileModel): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  let data = await AliFile.ApiOfficePreViewUrl(token.user_id, file.drive_id, file.file_id)
  if (!data?.preview_url && !isAliyunUser(token)) {
    const rawData = await getRawUrl(token.user_id, file.drive_id, file.file_id, getEncType(file), '', file.icon == 'iconweifa', 'other', 'Origin')
    if (typeof rawData !== 'string' && rawData.url) {
      data = {
        drive_id: file.drive_id,
        file_id: file.file_id,
        preview_url: rawData.url,
        access_token: ''
      }
    }
  }
  if (!data?.preview_url) {
    message.error('获取文件预览链接失败，操作取消')
    return
  }
  const pageOffice: IPageOffice = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_name: file.name,
    preview_url: data.preview_url,
    access_token: data.access_token
  }
  window.WebOpenWindow({ page: 'PageOffice', data: pageOffice })
}

async function Audio(file: IAliGetFileModel, password: string = ''): Promise<void> {
  const weifa = file.icon == 'iconweifa'
  if (weifa) {
    message.error('在线预览失败 无法预览违规文件')
    return
  }

  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }

  const ext = file.ext || (file.name?.split('.')?.pop() || '')
  const listRaw = usePanFileStore().ListDataRaw || []
  const audioList = listRaw.filter((v) => !v.isDir && (v.category === 'audio' || v.category === 'audio2'))
  const sourceList = audioList.length > 0 ? audioList : [file]

  const playlist: IPageMusicTrack[] = sourceList.map((item) => ({
    user_id: ((item as any).user_id as string) || token.user_id,
    tokenfrom: token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom,
    drive_id: item.drive_id,
    file_id: item.file_id,
    parent_file_id: item.parent_file_id,
    file_name: item.name,
    ext: item.ext,
    size: item.size,
    category: item.category,
    icon: item.icon,
    thumbnail: item.thumbnail,
    description: item.description,
    encType: getEncType(item),
    password: item.file_id === file.file_id ? password : ''
  }))

  if (!playlist.find((t) => t.file_id === file.file_id)) {
    playlist.unshift({
      user_id: ((file as any).user_id as string) || token.user_id,
      tokenfrom: token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom,
      drive_id: file.drive_id,
      file_id: file.file_id,
      parent_file_id: file.parent_file_id,
      file_name: file.name,
      ext: file.ext,
      size: file.size,
      category: file.category,
      icon: file.icon,
      thumbnail: file.thumbnail,
      description: file.description,
      encType: getEncType(file),
      password
    })
  }

  const pageMusic: IPageMusic = {
    user_id: token.user_id,
    tokenfrom: token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom,
    drive_id: file.drive_id,
    file_id: file.file_id,
    parent_file_id: file.parent_file_id,
    parent_file_name: usePanFileStore().DirName || '',
    file_name: file.name,
    encType: getEncType(file),
    password,
    playlist
  }

  if (typeof ext === 'string' && ext.length > 0) {
    // ext intentionally captured for future use; no-op
  }

  if (typeof window !== 'undefined' && (window as any).WebOpenWindow) {
    const appStore = useAppStore()
    const theme = appStore.appTheme === 'system' ? (appStore.appDark ? 'dark' : 'light') : appStore.appTheme
    ;(window as any).WebOpenWindow({ page: 'PageMusic', data: pageMusic, theme })
  } else {
    // 兜底：旧版底部播放器
    const data = await getRawUrl(token.user_id, file.drive_id, file.file_id, getEncType(file), password, weifa, 'audio')
    if (typeof data != 'string') {
      useFootStore().mSaveAudioUrl(data.url)
    } else {
      message.error(data)
    }
  }
}

async function Code(file: IAliGetFileModel, codeExt: string, password: string = ''): Promise<void> {
  const token = await resolveTokenForFile(file)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('加载中...', 2)
  const pageCode: IPageCode = {
    user_id: token.user_id,
    drive_id: file.drive_id,
    file_id: file.file_id,
    file_name: file.name,
    code_ext: codeExt,
    file_size: file.size,
    encType: getEncType(file),
    password: password
  }
  window.WebOpenWindow({ page: 'PageCode', data: pageCode, theme: 'dark' })
}

export function PrismExt(fileExt: string): string {
  const ext = '.' + fileExt.toLowerCase() + '.'
  const fext = fileExt.toLowerCase()
  let iscode = false
  let codeext = ''
  iscode = iscode || ';.markup.html.xml.svg.mathml.ssml.atom.rss.css.clike.javascript.js.abap.'.indexOf(ext) > 0
  iscode = iscode || ';.actionscript.ada.agda.al.antlr4.g4.apacheconf.apex.apl.applescript.abnf.'.indexOf(ext) > 0
  iscode = iscode || ';.aql.arduino.arff.asciidoc.adoc.aspnet.asm6502.autohotkey.autoit.bash.shell.'.indexOf(ext) > 0
  iscode = iscode || ';.basic.batch.bbcode.shortcode.birb.bison.bnfrbnf.brainfuck.brightscript.'.indexOf(ext) > 0
  iscode = iscode || ';.bro.bsl.oscript.c.csharp.cs.dotnet.cpp.cfscript.cfc.chaiscript.cil.clojure.cmake.'.indexOf(ext) > 0
  iscode = iscode || ';.cobol.coffeescript.coffee.concurnas.conc.csp.coq.crystal.css-extras.csv.cypher.n4jsd.'.indexOf(ext) > 0
  iscode = iscode || ';.d.dart.dataweave.dax.dhall.diff.django.jinja2.dns-zone-file.dns-zone..purs.purescript.'.indexOf(ext) > 0
  iscode = iscode || ';.docker.dockerfile.dot.gv.ebnf.editorconfig.eiffel.ejs.eta.elixir.elm.etlua.erb.erlang.'.indexOf(ext) > 0
  iscode = iscode || ';.fsharp.factor.false.firestore-security-rules.flow.fortran.ftl.gml.gamemakerlanguage.'.indexOf(ext) > 0
  iscode = iscode || ';.gcode.gdscript.gedcom.gherkin.git.glsl.go.graphql.groovy.haml.handlebars.hbs.'.indexOf(ext) > 0
  iscode = iscode || ';.haskell.hs.haxe.hcl.hlsl.hoon.http.hpkp.hsts.ichigojam.icon.icu-message-format.'.indexOf(ext) > 0
  iscode = iscode || ';.idris.idr.ignore.gitignore.hgignore.npmignore.inform7.ini.io.j.java.javadoc.javadoclike.'.indexOf(ext) > 0
  iscode = iscode || ';.javastacktrace.jexl.jolie.jq.jsdoc.js-extras.json.webmanifest.json5.jsonp.jsstacktrace.px.'.indexOf(ext) > 0
  iscode = iscode || ';.js-templates.julia.keyman.kotlin.kt.kts.kumir.kum.latex.tex.context.latte.less.lilypond.ly.'.indexOf(ext) > 0
  iscode = iscode || ';.liquid.lisp.emacs.elisp.emacs-lisp.livescript.llvm.log.lolcode.lua.makefile.markdown.md.'.indexOf(ext) > 0
  iscode = iscode || ';.markup-templating.matlab.mel.mizar.mongodb.monkey.moonscript.moon.n1ql.n4js.'.indexOf(ext) > 0
  iscode = iscode || ';.nand2tetris-hdl.naniscript.nani.nasm.neon.nevod.nginx.nim.nix.nsis.objectivec.objc.'.indexOf(ext) > 0
  iscode = iscode || ';.ocaml.opencl.openqasm.qasm.oz.parigp.parser.pascal.objectpascal.pascaligo.psl.pcaxis.'.indexOf(ext) > 0
  iscode = iscode || ';.peoplecode.pcode.perl.php.phpdoc.php-extras.plsql.powerquery.pq.mscript.powershell.'.indexOf(ext) > 0
  iscode = iscode || ';.processing.prolog.promql.properties.protobuf.pug.puppet.pure.purebasic.pbfasm.twig.'.indexOf(ext) > 0
  iscode = iscode || ';.python.py.qsharp.qs.q.qml.qore.r.racket.rkt.jsx.tsx.reason.regex.rego.renpy.rpy.rest.rip.'.indexOf(ext) > 0
  iscode = iscode || ';.robotframework.robot.ruby.rb.rust.sas.sass.scss.scala.scheme.shell-session.sh-session.sql.'.indexOf(ext) > 0
  iscode = iscode || ';.smali.smalltalk.smarty.sml.smlnj.solidity.sol.solution-file.sln.soy.sparql.rq.splunk-spl.sqf.'.indexOf(ext) > 0
  iscode = iscode || ';.squirrel.stan.iecst.stylus.swift.t4-templating.t4-cs.t4.t4-vb.tap.tcl.tt2.textile.toml.turtle.trig.'.indexOf(ext) > 0
  iscode = iscode || ';.typescript.ts.typoscript.tsconfig.unrealscript.uscript.uc.uri.url.v.vala.vbnet.velocity.verilog.'.indexOf(ext) > 0
  iscode = iscode || ';.vim.visual-basic.vb.vba.warpscript.wasm.wiki.wolfram.mathematica.nb.wl.xeora.xeoracube.'.indexOf(ext) > 0
  iscode = iscode || ';.xml-doc.xojo.xquery.yaml.yml.yang.zig.excel-formula.xlsx.xls.shellsession.roboconf.vhdl.'.indexOf(ext) > 0

  if (iscode) {
    codeext = fext
  } else {
    switch (fext) {
      case 'prettierrc':
        codeext = 'json'
        break
      case 'vue':
        codeext = 'javascript'
        break
      case 'h':
        codeext = 'c'
        break
      case 'as':
        codeext = 'actionscript'
        break
      case 'sh':
        codeext = 'bash'
        break
      case 'zsh':
        codeext = 'bash'
        break
      case 'bf':
        codeext = 'brainfuck'
        break
      case 'hpp':
        codeext = 'cpp'
        break
      case 'cc':
        codeext = 'cpp'
        break
      case 'hh':
        codeext = 'cpp'
        break
      case 'c++':
        codeext = 'cpp'
        break
      case 'h++':
        codeext = 'cpp'
        break
      case 'cxx':
        codeext = 'cpp'
        break
      case 'hxx':
        codeext = 'cpp'
        break
      case 'cson':
        codeext = 'coffeescript'
        break
      case 'iced':
        codeext = 'coffeescript'
        break
      case 'dns':
        codeext = 'dns-zone'
        break
      case 'zone':
        codeext = 'dns-zone'
        break
      case 'bind':
        codeext = 'dns-zone'
        break
      case 'plist':
        codeext = 'xml'
        break
      case 'xhtml':
        codeext = 'html'
        break
      case 'iml':
        codeext = 'xml'
        break
      case 'mk':
        codeext = 'makefile'
        break
      case 'mak':
        codeext = 'makefile'
        break
      case 'make':
        codeext = 'makefile'
        break
      case 'mkdown':
        codeext = 'markdown'
        break
      case 'mkd':
        codeext = 'markdown'
        break
      case 'nginxconf':
        codeext = 'nginx'
        break
      case 'nimrod':
        codeext = 'nim'
        break
      case 'mm':
        codeext = 'objectivec'
        break
      case 'obj-c':
        codeext = 'objectivec'
        break
      case 'obj-c++':
        codeext = 'objectivec'
        break
      case 'objective-c++':
        codeext = 'objectivec'
        break
      case 'ps':
        codeext = 'powershell'
        break
      case 'ps1':
        codeext = 'powershell'
        break
      case 'gyp':
        codeext = 'python'
        break
      case 'rs':
        codeext = 'rust'
        break
      case 'vb':
        codeext = 'vbnet'
        break
      case 'conf':
        codeext = 'ini'
        break
    }
  }
  return codeext
}
