import { existsSync } from 'fs'
import { tmpdir } from 'os'
import message from './message'
import is from 'electron-is'
import { spawn, SpawnOptions } from 'child_process'
import mpvAPI from '../module/node-mpv'
import AliFile from '../aliapi/file'
import DriveFile from '../drive/file'
import AliFileCmd from '../aliapi/filecmd'
import levenshtein from 'fast-levenshtein'
import AliDirFileList from '../aliapi/dirfilelist'
import { ITokenInfo, usePanFileStore, useSettingStore } from '../store'
import { createTmpFile, delTmpFile, GetExpiresTime } from './utils'
import { IAliGetFileModel } from '../aliapi/alimodels'
import { getEncType, getProxyUrl } from './proxyhelper'
import { CleanStringForCmd } from './filehelper'
import Db from './db'
import { humanTime } from './format'
import { IPageVideo } from '../store/appstore'
import { Input, InputNumber, Modal } from '@arco-design/web-vue'
import { h } from 'vue'
import path from 'path'
import { isBaiduUser, isBoxUser, isCloud123User, isDrive115User, isDropboxUser, isGoogleUser, isGuangyaUser, isOneDriveUser, isPikPakUser, isQuarkUser } from '../aliapi/utils'
import { apiDrive115FileDetailResult } from '../cloud115/filecmd'
import { apiDrive115VideoHistory } from '../cloud115/video'
import { mapDrive115DetailToAliModel } from '../cloud115/dirfilelist'
import { listProviderItems } from '../drive/providerList'
import { listAllCloud189Items } from '../cloud189/adapter'
import { resolveDriveProvider } from './driveProvider'
import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory } from './webdavClient'
import { buildDirectPlayerInvocation, buildPlayerCommand, formatPlayerArg, isMpvCommand, parsePlayerParams, redactMpvArgs } from './mpvPlayerPolicy'
import UserDAL from '../user/userdal'

const currentPlayerPlatform = () => (is.windows() ? 'win32' : is.macOS() ? 'darwin' : is.linux() ? 'linux' : process.platform)
const createMpvSocketPath = () => {
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return is.windows() ? `\\\\.\\pipe\\boxplayer-mpv-${id}` : path.join(tmpdir(), `boxplayer-mpv-${id}.sock`)
}

const buildExternalSubtitleProxyUrl = (userId: string, driveId: string, fileId: string, url: string, size = 0, headers?: Record<string, string>) => {
  return getProxyUrl({
    user_id: userId,
    drive_id: driveId,
    file_id: fileId,
    file_size: size,
    quality: 'Origin',
    proxy_kind: 'subtitle',
    proxy_url: url,
    proxy_headers: headers && Object.values(headers).some(Boolean) ? JSON.stringify(headers) : undefined
  })
}

const resolveExternalSubtitleUrl = async (userId: string, subtitleFile: IAliGetFileModel) => {
  const data = await DriveFile.ApiFileDownloadUrl(userId, subtitleFile.drive_id, subtitleFile.file_id, 14400)
  if (typeof data === 'string' || !data.url) return ''
  return buildExternalSubtitleProxyUrl(userId, subtitleFile.drive_id, subtitleFile.file_id, data.url, data.size, data.headers)
}

const PlayerUtils = {
  filterSubtitleFile(name: string, subTitlesList: IAliGetFileModel[]) {
    // 自动加载同名字幕
    const findName = path.parse(name).name
    const similarity: any = subTitlesList.reduce(
      (min: any, item, index) => {
        // 莱文斯坦距离算法(计算相似度)
        const matchName = path.parse(item.name).name
        const distance = levenshtein.get(findName, matchName, { useCollator: true })
        if (distance < min.distance) {
          min.distance = distance
          min.index = index
        }
        return min
      },
      { distance: Infinity, index: -1 }
    )
    return similarity.index !== -1 ? subTitlesList[similarity.index] : undefined
  },

  async getVideoDanmuList(pageVideo: IPageVideo, option: any, pos: number) {
    let name = ''
    // console.log('getVideoDanmuList', pageVideo, option, pos)
    if (option.matchType === 'folder') {
      name = pageVideo.parent_file_name
    } else {
      name = pageVideo.file_name
    }
    let searchName = name
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/\b(360p|480p|720p|1080p|2160p|\d+K)\b/gi, '')
      .replace(path.extname(name), '')
      .replace('.', '')
    let numMatch = searchName.match(/(\d{1,3}).*/) || searchName.match(/S(\d+)E(\d+)/i)
    let num = numMatch ? parseInt(numMatch[1] || numMatch[2]) : pos + 1
    console.log('search', searchName, num)
    pageVideo.play_esposide = num
    if (option.sourceType == 'auto' && option.matchEsp == 'auto') {
      return { name: searchName, pos: num }
    }
    if (option.sourceType == 'input') {
      return new Promise((resolve) => {
        let sourceUrl = ''
        // 输入网址
        Modal.open({
          title: '输入弹幕的网址（支持主流视频网址）',
          bodyStyle: {
            minWidth: '500px'
          },
          content: () =>
            h(Input, {
              type: 'text',
              tabindex: '-1',
              allowClear: true,
              placeholder: '输入弹幕的网址',
              onChange(value, ev) {
                sourceUrl = value
              }
            }),
          okText: '确认',
          cancelText: '取消',
          onOk: async (e: any) => {
            console.log('sourceUrl', sourceUrl)
            resolve(sourceUrl)
            return true
          },
          onCancel(e: any) {
            resolve('')
            return true
          }
        })
      })
    }
    if (option.sourceType == 'search') {
      return new Promise((resolve) => {
        let name = ''
        Modal.open({
          title: '输入搜索的关键字，空格分割集数',
          bodyStyle: {
            minWidth: '400px'
          },
          content: () =>
            h(Input, {
              type: 'text',
              tabindex: '-1',
              allowClear: true,
              placeholder: '输入搜索的关键字，空格分割集数',
              onChange(value, ev) {
                name = value
              }
            }),
          okText: '确认',
          cancelText: '取消',
          onOk: async (e: any) => {
            let pos = parseInt(name.split(' ')[1]) || 1
            pageVideo.play_esposide = pos
            resolve({ name, pos })
            return true
          },
          onCancel(e: any) {
            resolve({})
            return true
          }
        })
      })
    }
    if (option.matchEsp == 'input') {
      return new Promise((resolve) => {
        let espisode: any = 1
        Modal.open({
          title: '输入需要匹配的集数',
          bodyStyle: {
            minWidth: '400px'
          },
          content: () =>
            h(InputNumber, {
              defaultValue: pageVideo.play_esposide ? pageVideo.play_esposide : 1,
              tabindex: '-1',
              allowClear: true,
              mode: 'button',
              step: 1,
              placeholder: '输入需要匹配的集数',
              onChange(value, ev) {
                espisode = value
              }
            }),
          okText: '确认',
          cancelText: '取消',
          onOk: async (e: any) => {
            pageVideo.play_esposide = espisode
            resolve({ name, pos: espisode })
            return true
          },
          onCancel(e: any) {
            pageVideo.play_esposide = num
            resolve({ name: searchName, pos: num })
            return true
          }
        })
      })
    }
  },

  async getPlayCursor(user_id: string, drive_id: string, file_id: string) {
    if (drive_id === 'media_server') return undefined
    if (isWebDavDrive(drive_id)) return undefined
    if (isCloud123User(user_id) || drive_id === 'cloud123') return undefined
    if (isBaiduUser(user_id) || drive_id === 'baidu') return undefined
    if (isPikPakUser(user_id) || drive_id === 'pikpak') return undefined
    if (isQuarkUser(user_id) || drive_id === 'quark') return undefined
    if (isDropboxUser(user_id) || drive_id === 'dropbox') return undefined
    if (isOneDriveUser(user_id) || drive_id === 'onedrive') return undefined
    if (isBoxUser(user_id) || drive_id === 'box') return undefined
    if (isGoogleUser(user_id) || drive_id === 'google') return undefined
    if (isGuangyaUser(user_id) || drive_id === 'guangya') return undefined
    if (isDrive115User(user_id) || drive_id === 'drive115') {
      const { detail, error } = await apiDrive115FileDetailResult(user_id, file_id)
      if (!detail) {
        if (error) message.error(error)
        return undefined
      }
      const info = mapDrive115DetailToAliModel(detail, drive_id)
      const play_duration = Number(detail.play_long || 0)
      let play_cursor = await apiDrive115VideoHistory(user_id, detail.pick_code)
      if (play_duration > 0 && play_cursor >= play_duration - 10) {
        play_cursor = play_duration - 10
      }
      return { info, play_duration, play_cursor }
    }
    // 获取文件信息
    const info = await AliFile.ApiFileInfo(user_id, drive_id, file_id)
    if (info && typeof info == 'string') {
      message.error('在线预览失败 获取文件信息出错：' + info)
      return undefined
    }
    let play_duration: number = 0
    if (info?.video_media_metadata) {
      play_duration = info?.video_media_metadata.duration
    } else if (info?.user_meta) {
      play_duration = info?.user_meta.duration
    }
    let play_cursor: number = 0
    if (info?.play_cursor) {
      play_cursor = info?.play_cursor
    } else if (info?.user_meta) {
      const meta = JSON.parse(info?.user_meta)
      if (meta.play_cursor) {
        play_cursor = parseFloat(meta.play_cursor)
      }
    }
    // 防止意外跳转
    if (play_duration > 0 && play_duration > 0 && play_cursor >= play_duration - 10) {
      play_cursor = play_duration - 10
    }
    return { info, play_duration, play_cursor }
  },
  async getDirFileList(user_id: string, drive_id: string, parent_file_id: string, tokenfrom?: string) {
    let items: IAliGetFileModel[] = []
    if (isWebDavDrive(drive_id)) {
      const connection = getWebDavConnection(getWebDavConnectionId(drive_id))
      if (connection) {
        items = await listWebDavDirectory(connection, parent_file_id || '/')
      }
    } else {
      const route = resolveDriveProvider(user_id, drive_id, tokenfrom || UserDAL.GetUserToken(user_id)?.tokenfrom)
      const providerResult = route.isValid && route.provider !== 'aliyun'
        ? route.provider === '189'
          ? { items: await listAllCloud189Items(user_id, drive_id, parent_file_id) }
          : await listProviderItems(route.provider, user_id, drive_id, parent_file_id, true)
        : undefined
      if (providerResult) {
        items = providerResult.items
      } else if (route.isValid && route.provider === 'aliyun') {
        const dir = await AliDirFileList.ApiDirFileList(user_id, drive_id, parent_file_id, '', 'name asc', '')
        items = dir.items
      } else {
        console.warn('[PlayerUtils] skip unknown or mismatched drive source', { user_id, drive_id, parent_file_id, error: route.error })
      }
    }
    const curDirFileList: IAliGetFileModel[] = []
    for (let item of items) {
      if (item.isDir) continue
      curDirFileList.push(item)
    }
    return curDirFileList.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  },
  async createPlayListFile(
    user_id: string, file_id: string,
    quality: string, fileExt: string,
    fileList: IAliGetFileModel[], play_referer: string) {
    let contentStr = ''
    if (fileExt.includes('m3u8')) {
      let header = `#EXTM3U\r\n#EXT-X-ALLOW-CACHE:NO\r\n#EXTVLCOPT:http-referrer=${play_referer}\r\n#EXTVLCOPT:http-user-agent=custom-user-agent\r\n`
      let end = '#EXT-X-ENDLIST\r\n'
      let list = ''
      for (let item of fileList) {
        const encType = getEncType(item)
        const url = getProxyUrl({
          user_id: user_id,
          drive_id: item.drive_id,
          file_id: item.file_id,
          file_size: item.size,
          weifa: item.icon === 'weifa' ? 1 : 0,
          encType: encType,
          quality: quality
        })
        list += '#EXTINF:0,' + item.name + '\r\n' + url + '\r\n'
      }
      contentStr = header + list + end
    }
    if (fileExt == 'dpl') {
      let header = 'DAUMPLAYLIST'
      let playname = ''
      let topindex = 'topindex=0'
      let saveplaypos = `saveplaypos=0`
      let list = ''
      for (let index = 0; index < fileList.length; index++) {
        const item = fileList[index]
        const start = index + 1
        const encType = getEncType(item)
        const url = getProxyUrl({
          user_id: user_id,
          drive_id: item.drive_id,
          file_id: item.file_id,
          file_size: item.size,
          weifa: item.icon === 'weifa' ? 1 : 0,
          encType: encType,
          quality: quality
        })
        let title = CleanStringForCmd(item.name.trim())
        let listStr = `${start}*file*${url}\r\n${start}*title*${title}\r\n${start}*played*0\r\n`
        if (item.file_id === file_id) {
          playname = 'playname=' + url
        }
        list += listStr
      }
      contentStr = `${header}\r\n${playname}\r\n${topindex}\r\n${saveplaypos}\r\n${list}`
    }
    return createTmpFile(contentStr, 'play_list' + '.' + fileExt)
  },
  async mpvPlayer(token: ITokenInfo, binary: string, playArgs: any, otherArgs: any, options: SpawnOptions, exitCallBack: any) {
    let { file, fileList, playList } = otherArgs
    let {
      uiAutoColorVideo,
      uiVideoPlayerHistory,
      uiVideoPlayerExit,
      uiVideoSubtitleMode
    } = useSettingStore()
    let currentTime = 0
    let currentPlayIndex = otherArgs.currentPlayIndex
    let currentFileInfo = file
    let lastUpdateRecordTime = Date.now()
    let mpv: mpvAPI = new mpvAPI(
      {
        debug: false,
        verbose: false,
        binary: binary,
        socket: createMpvSocketPath(),
        auto_restart: false,
        start_timeout: 10000,
        spawnOptions: {
          ...options,
          shell: false,
          windowsVerbatimArguments: false
        }
      },
      playArgs
    )
    try {
      await mpv.start()
      mpv.on('status', async (status: { property: string; value: any }) => {
        // console.error('status', status)
        if (status.property == 'duration' && status.value > 0) {
          if (uiVideoPlayerHistory && playList.length > 0) {
            let proxyInfo: any = await Db.getValueObject('ProxyInfo')
            if (proxyInfo && proxyInfo.play_cursor) {
              await mpv.seek(proxyInfo.play_cursor, 'absolute')
            } else {
              let playCursorInfo = await this.getPlayCursor(token.user_id, currentFileInfo.drive_id, currentFileInfo.file_id)
              if (playCursorInfo && playCursorInfo.play_cursor > 0) {
                await mpv.seek(playCursorInfo.play_cursor, 'absolute')
              }
            }
          }
        } else if (status.property == 'filename' && status.value) {
          // 自动加载字幕
          if (uiVideoSubtitleMode === 'auto') {
            if (otherArgs.subTitleFile && otherArgs.subTitleFile.subTitleUrl) {
              let { subTitleUrl, subTitleName } = otherArgs.subTitleFile
              await mpv.addSubtitles(subTitleUrl, 'select', subTitleName)
            } else {
              let subTitlesList = fileList.filter((file: any) => /srt|vtt|ass/.test(file.ext))
              if (subTitlesList.length > 0) {
                let subTitleFile = this.filterSubtitleFile(currentFileInfo.name, subTitlesList)
                if (subTitleFile) {
                  const subtitleUrl = await resolveExternalSubtitleUrl(token.user_id, subTitleFile)
                  if (subtitleUrl) await mpv.addSubtitles(subtitleUrl, 'select', subTitleFile.name || currentFileInfo.name)
                }
              }
            }
          }
        } else if (playList.length && status.property === 'playlist-pos' && status.value != -1) {
          // 保存历史
          if (uiVideoPlayerHistory && currentPlayIndex != status.value) {
            AliFile.ApiUpdateVideoTime(token.user_id, currentFileInfo.drive_id, currentFileInfo.file_id, currentTime)
          }
          if (otherArgs.subTitleFile) {
            delete otherArgs.subTitleFile
          }
          currentPlayIndex = status.value
          currentFileInfo = playList[status.value] || currentFileInfo
          // 自动标记
          const { drive_id, file_id, description } = currentFileInfo
          if (uiAutoColorVideo && !isPikPakUser(token) && !isQuarkUser(token) && !isDropboxUser(token) && !isOneDriveUser(token) && !isBoxUser(token) && !isGuangyaUser(token) && drive_id !== 'pikpak' && drive_id !== 'quark' && drive_id !== 'dropbox' && drive_id !== 'onedrive' && drive_id !== 'box' && drive_id !== 'guangya' && (!description || !description.includes('ce74c3c'))) {
            AliFileCmd.ApiFileColorBatch(token.user_id, drive_id, description, 'ce74c3c', [file_id])
          }
        }
      })
      mpv.on('seek', async (timePosition) => {
        // console.log('seek', timePosition)
        if (!await mpv.isPaused()) return
        if (currentFileInfo.file_id && uiVideoPlayerHistory) {
          let recordTime = Date.now()
          if (recordTime - lastUpdateRecordTime > 2000) {
            lastUpdateRecordTime = recordTime
            AliFile.ApiUpdateVideoTime(token.user_id, currentFileInfo.drive_id, currentFileInfo.file_id, timePosition.end)
          }
        }
      })
      mpv.on('timeposition', (timeposition: number) => {
        // console.log('timeposition', currentTime)
        currentTime = timeposition
      })
      mpv.on('quit', async () => {
        await AliFile.ApiUpdateVideoTime(token.user_id, currentFileInfo.drive_id, currentFileInfo.file_id, currentTime)
        exitCallBack()
      })
      mpv.on('crashed', () => {
        message.error('MPV 播放器异常退出，请检查播放器日志或启动参数')
        exitCallBack()
      })
      if (uiVideoPlayerExit) {
        mpv.on('stopped', async () => {
          message.info('播放完毕，自动退出软件', 8)
          await AliFile.ApiUpdateVideoTime(token.user_id, currentFileInfo.drive_id, currentFileInfo.file_id, currentTime)
          await mpv.quit()
        })
      }
    } catch (error: any) {
      console.error(error)
      if (error.errcode == 6) {
        message.error('播放失败，重复运行MPV播放器', 8)
      } else {
        message.error(`播放失败，${error.verbose || error.errmessage || error.message || String(error)}`)
      }
      exitCallBack()
    }
  },

  commandSpawn(commandStr: string, playArgs: any, options: SpawnOptions, exitCallBack: any) {
    const childProcess: any = spawn(commandStr, playArgs, {
      shell: true,
      windowsVerbatimArguments: true,
      ...options
    })
    if (options.detached) childProcess.unref()
    let stderr = ''
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      exitCallBack?.()
    }
    childProcess.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + String(chunk)).slice(-2000)
    })
    childProcess.once('error', (error: Error) => {
      message.error(`播放器启动失败：${error.message}`)
      finish()
    })
    childProcess.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code && code !== 0) {
        const detail = stderr.trim() || `退出码 ${code}${signal ? `，信号 ${signal}` : ''}`
        message.error(`播放器异常退出：${detail}`)
      }
      finish()
    })
  },

  async startPlayer(token: ITokenInfo, command: string, otherArgs: any) {
    if (!command) {
      message.error('请先在设置中选择或填写自定义播放器')
      return
    }
    if ((is.windows() || is.macOS()) && !existsSync(command)) {
      message.error(`启动失败，找不到文件, ${command}`)
      return
    }
    const isMPV = isMpvCommand(command)
    const isPotplayer = command.toLowerCase().includes('potplayer')
    const directMpvControl = isMPV
    const argsToStr = (args: string) => formatPlayerArg(currentPlayerPlatform(), args, directMpvControl)
    const commandStr = buildPlayerCommand(currentPlayerPlatform(), command)
    const directInvocation = buildDirectPlayerInvocation(currentPlayerPlatform(), command)
    // 构造播放参数
    let { file, subTitleFile, rawData, quality } = otherArgs
    const resolvedSource = otherArgs.resolvedSource === true
    let encType = resolvedSource ? '' : getEncType(file)
    let play_url = ''
    let play_referer = resolvedSource ? '' : token.open_api_access_token ? 'https://openapi.alipan.com/' : 'https://www.aliyundrive.com/'
    let {
      uiVideoEnablePlayerList,
      uiVideoPlayerExit,
      uiVideoPlayerHistory,
      uiVideoPlayerParams
    } = useSettingStore()
    if (resolvedSource) uiVideoEnablePlayerList = false
    let playerArgs: any = []
    let options: SpawnOptions = { detached: !uiVideoPlayerExit }
    let subTitleUrl = resolvedSource ? otherArgs.subtitleUrl || '' : ''
    let rawHeaders: Record<string, string> = {}
    const headerFields = () => Object.entries(rawHeaders)
      .filter(([key, value]) => !!key && !!value)
      .map(([key, value]) => `${key}: ${value}`)
    if (rawData) {
      // 加载转码的内嵌字幕
      if (rawData.subtitles && quality != 'Origin') {
        let subTitleData = rawData.subtitles.find((sub: any) => sub.language === 'chi') || rawData.subtitles[0]
        if (subTitleData?.url) {
          subTitleUrl = buildExternalSubtitleProxyUrl(token.user_id, file.drive_id, file.file_id, subTitleData.url, 0, subTitleData.headers)
        }
      }
      if (rawData.qualities) {
        const selectedQuality = rawData.qualities.find((q: any) => q.quality === quality) || rawData.qualities[0]
        play_url = selectedQuality?.url || ''
        rawHeaders = selectedQuality?.headers || rawData.headers || {}
      }
    }
    if (resolvedSource) play_referer = Object.entries(rawHeaders).find(([key]) => key.toLowerCase() === 'referer')?.[1] || ''
    // 优先加载网盘内字幕文件
    if (subTitleFile && !subTitleFile.isDir) {
      subTitleUrl = await resolveExternalSubtitleUrl(token.user_id, subTitleFile)
    }
    // 获取播放进度
    let play_cursor = resolvedSource ? Math.max(0, Number(otherArgs.playCursor) || 0) : 0
    if (uiVideoPlayerHistory && !resolvedSource) {
      let playCursorInfo = await PlayerUtils.getPlayCursor(token.user_id, file.drive_id, file.file_id)
      if (playCursorInfo) {
        play_cursor = playCursorInfo.play_cursor
      } else {
        play_cursor = file.media_play_cursor ? parseInt(file.media_play_cursor) : 0
      }
    }
    otherArgs.subTitleFile = { subTitleUrl: subTitleUrl, subTitleName: subTitleFile?.name || 'chi' }
    if (isPotplayer) {
      playerArgs = [
        '/new',
        '/autoplay',
        ...(play_referer ? [`/referer=${argsToStr(play_referer)}`] : []),
        `/title=${argsToStr(file.name)}`
      ]
      if (!uiVideoEnablePlayerList) {
        if (play_cursor > 0 && uiVideoPlayerHistory) {
          playerArgs.push(`/seek=${argsToStr(humanTime(play_cursor))}`)
        }
        if (subTitleUrl.length > 0) {
          playerArgs.push(`/sub=${argsToStr(subTitleUrl)}`)
        }
      }
      if (rawHeaders['User-Agent']) playerArgs.push(`/user_agent=${argsToStr(rawHeaders['User-Agent'])}`)
      const potHeaders = headerFields().filter(header => !/^user-agent\s*:/i.test(header))
      if (potHeaders.length) playerArgs.push(`/headers=${argsToStr(potHeaders.join('\\r\\n'))}`)
    } else if (isMPV) {
      playerArgs = [
        '--force-window=immediate',
        '--hwdec=auto',
        '--geometry=50%',
        '--autofit-larger=100%x100%',
        '--autofit-smaller=640',
        '--audio-pitch-correction=yes',
        '--keep-open-pause=no',
        '--alang=[en,eng,zh,chi,chs,sc,zho]',
        '--slang=[zh,chi,chs,sc,zho,en,eng]',
        `--force-media-title=${argsToStr(file.name)}`,
        ...(play_referer ? [`--referrer=${argsToStr(play_referer)}`] : []),
        `--title=${argsToStr(file.name)}`
      ]
      if (!uiVideoEnablePlayerList) {
        if (play_cursor > 0 && uiVideoPlayerHistory) {
          playerArgs.push(`--start=${play_cursor}`)
        }
        if (subTitleUrl.length > 0) {
          playerArgs.push(`--sub-file=${argsToStr(subTitleUrl)}`)
        }
      }
      const mpvHeaders = headerFields().filter(header => !/^user-agent\s*:/i.test(header))
      if (rawHeaders['User-Agent']) playerArgs.push(`--user-agent=${argsToStr(rawHeaders['User-Agent'])}`)
      if (mpvHeaders.length) playerArgs.push(`--http-header-fields=${argsToStr(mpvHeaders.join(','))}`)
    }
    if (uiVideoPlayerParams.length > 0) {
      playerArgs.push(...parsePlayerParams(uiVideoPlayerParams))
    }
    const playArgs: any[] = [...Array.from(new Set(playerArgs))]
    let fileList: IAliGetFileModel[] = []
    if (uiVideoEnablePlayerList) {
      if (file.compilation_id) {
        fileList = await this.getDirFileList(token.user_id, file.drive_id, file.parent_file_id, token.tokenfrom)
      } else {
        fileList = usePanFileStore().ListDataRaw
      }
      otherArgs.fileList = fileList
      // console.log('getDirFileList', fileList)
      otherArgs.playList = fileList.filter((v: any) => v.category.includes('video'))
      otherArgs.playFileListPath = await this.createPlayListFile(
        token.user_id, file.file_id,
        quality, isPotplayer ? 'dpl' : 'm3u8',
        otherArgs.playList, play_referer
      )
      // console.log('tmpFile', tmpFile)
      if (isMPV) {
        otherArgs.currentPlayIndex = Math.max(0, otherArgs.playList.findIndex((v: any) => v.file_id == file.file_id))
        playArgs.unshift('--playlist-start=' + otherArgs.currentPlayIndex)
        playArgs.unshift('--playlist=' + otherArgs.playFileListPath)
      } else {
        playArgs.unshift(otherArgs.playFileListPath)
      }
    } else {
      playArgs.unshift(argsToStr(play_url))
    }
    console.warn('playArgs', redactMpvArgs(playArgs))
    let cleaned = false
    const exitCallBack = () => {
      if (cleaned) return
      cleaned = true
      if (uiVideoEnablePlayerList) {
        delTmpFile(otherArgs.playFileListPath)
      }
      otherArgs = {}
    }
    if (!resolvedSource && !encType && play_url) {
      let info: any = {
        user_id: token.user_id,
        drive_id: file.drive_id,
        file_id: file.file_id,
        file_size: file.size,
        encType: encType,
        videoQuality: quality,
        expires_time: GetExpiresTime(play_url),
        proxy_url: play_url,
        proxy_headers: Object.keys(rawHeaders).length ? JSON.stringify(rawHeaders) : undefined,
        play_cursor: play_cursor
      }
      await Db.saveValueObject('ProxyInfo', info)
    }
    if (directMpvControl && resolvedSource) {
      this.commandSpawn(directInvocation.binary, [...directInvocation.args, ...playArgs], { ...options, shell: false, windowsVerbatimArguments: false }, exitCallBack)
    } else if (directMpvControl) {
      await this.mpvPlayer(token, directInvocation.binary, [...directInvocation.args, ...playArgs], otherArgs, options, exitCallBack)
    } else {
      if (currentPlayerPlatform() === 'linux') {
        this.commandSpawn(directInvocation.binary, [...directInvocation.args, ...playArgs], { ...options, shell: false, windowsVerbatimArguments: false }, exitCallBack)
      } else {
        this.commandSpawn(commandStr, playArgs, options, exitCallBack)
      }
    }
  }
}
export default PlayerUtils
