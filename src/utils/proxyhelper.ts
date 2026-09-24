import { useSettingStore } from '../store'
import FlowEnc from '../module/flow-enc'
import http, { Agent as HttpAgent, IncomingMessage, Server, ServerResponse } from 'http'
import Db from './db'
import https, { Agent as HttpsAgent } from 'https'
import { GetExpiresTime } from './utils'
import { decodeName } from '../module/flow-enc/utils'
import { IAliFileItem, IAliGetFileModel } from '../aliapi/alimodels'
import AliFile from '../aliapi/file'
import DriveFile from '../drive/file'
import path from 'path'
import { localPwd } from './aria2c'
import os from 'os'
import DebugLog from './debuglog'
import message from './message'
import UserDAL, { UserTokenMap } from '../user/userdal'
import { buildUpstreamProxyHeaders, ensureInlinePreviewRange, normalizeProxyRangeHeaders, normalizeProxyStatusCode, type ProxyResponseHeaders } from './proxyHeaders'
import { MEDIA_SERVER_DRIVE_ID, shouldRefreshProxyUrl } from './proxyCache'
import { isAliyunUser, isQuarkUser } from '../aliapi/utils'
import { isWebDavDrive } from './webdavClient'
import { QUARK_DOWNLOAD_AGENT, readQuarkCookieStringFromElectron } from '../quark/auth'
import { DRIVE115_DOWN_AGENT } from '@shared/drive115'
import { mergeQuarkCookieHeaders } from '@shared/quarkCookies'
import { createMpvProxyContext, isM3u8Response, resolveMpvProxyUri, rewriteMpvProxyPlaylist } from './proxyMediaRewrite'

// 默认maxFreeSockets=256
const httpsAgent = new HttpsAgent({ keepAlive: true })
const httpAgent = new HttpAgent({ keepAlive: true })

const detectProxyVideoType = (url: string) => {
  const lower = String(url || '').split('?')[0].split('#')[0].toLowerCase()
  if (lower.endsWith('.m3u8')) return 'm3u8'
  if (lower.endsWith('.mpd')) return 'mpd'
  if (lower.endsWith('.ts')) return 'ts'
  return ''
}

export interface IRawUrl {
  drive_id: string
  file_id: string
  url: string
  size: number
  headers?: Record<string, string>
  qualities: {
    html: string
    quality: string
    height: number
    width: number
    label: string
    value: string
    url: string
    type?: string
    headers?: Record<string, string>
  }[]
  subtitles: {
    language: string
    url: string
    headers?: Record<string, string>
  }[]
}

interface FileInfo {
  user_id: string
  drive_id?: string
  file_id?: string
  file_size?: number
  encType?: string
  proxy_headers?: string

  [key: string]: string | number | undefined
}

const hasQuarkLoginCookie = (cookie = '') => /(?:^|;\s*)__pus=/.test(cookie) && /(?:^|;\s*)(?:__uid|__kps)=/.test(cookie)

const isUsableQuarkToken = (token: any) => token?.tokenfrom === 'quark' && hasQuarkLoginCookie(token.access_token || '')

async function getQuarkProxyToken(userId: string) {
  const directToken = UserDAL.GetUserToken(userId)
  if (isUsableQuarkToken(directToken)) return directToken

  const quarkUserId = userId && !userId.startsWith('quark_') ? `quark_${userId}` : ''
  if (quarkUserId) {
    const prefixedToken = UserDAL.GetUserToken(quarkUserId)
    if (isUsableQuarkToken(prefixedToken)) return prefixedToken
  }

  if (userId) {
    const dbDirectToken = await UserDAL.GetUserTokenFromDB(userId)
    if (isUsableQuarkToken(dbDirectToken)) return dbDirectToken
  }
  if (quarkUserId) {
    const dbPrefixedToken = await UserDAL.GetUserTokenFromDB(quarkUserId)
    if (isUsableQuarkToken(dbPrefixedToken)) return dbPrefixedToken
  }

  for (const [storedUserId, token] of UserTokenMap) {
    if (!isUsableQuarkToken(token)) continue
    if (!userId || storedUserId === userId || storedUserId === quarkUserId || storedUserId.endsWith(userId)) {
      return token
    }
  }

  const dbTokens = await Db.getUserAll().catch(() => [])
  for (const token of dbTokens) {
    if (!isUsableQuarkToken(token)) continue
    const storedUserId = token.user_id || ''
    if (!userId || storedUserId === userId || storedUserId === quarkUserId || storedUserId.endsWith(userId)) {
      UserTokenMap.set(storedUserId, token)
      return token
    }
  }
  const fallback = dbTokens.find(isUsableQuarkToken)
  if (fallback?.user_id) {
    UserTokenMap.set(fallback.user_id, fallback)
    return fallback
  }
  return undefined
}

function getQuarkProxyCookieKeys(cookie = '') {
  return cookie
    .split(';')
    .map((item) => item.trim().split('=')[0])
    .filter(Boolean)
}

function getQuarkUrlPath(proxyUrl: string) {
  try {
    return new URL(proxyUrl).pathname
  } catch {
    return ''
  }
}

export function getIPAddress() {
  let ipv4 = ''
  const interfaces = os.networkInterfaces()
  for (const dev in interfaces) {
    let device = interfaces[dev]
    if (device) {
      device.forEach((details, alias) => {
        if (dev.includes('以太网') || dev == 'WLAN') {
          if (details.family == 'IPv4' && !details.internal
            && details.address.startsWith('192.168')) {
            ipv4 = details.address
            return
          }
        }
      })
    }
  }
  // console.log(ipv4)
  return ipv4 || '127.0.0.1'
}

export function getEncType(file: IAliGetFileModel | IAliFileItem | { description: string }): string {
  let description = file.description
  if (description) {
    if (description.includes('xbyEncrypt1')) {
      return 'xbyEncrypt1'
    } else if (description.includes('xbyEncrypt2')) {
      return 'xbyEncrypt2'
    }
  }
  return ''
}

export function getEncPassword(user_id: string, encType: string, inputpassword: string = ''): string {
  if (encType) {
    if (inputpassword) {
      return inputpassword
    }
    let settingStore = useSettingStore()
    if (encType == 'xbyEncrypt1') {
      let ecnPassword = decodeName(localPwd, settingStore.securityEncType, settingStore.securityPassword)
      if (!ecnPassword) {
        ecnPassword = decodeName(user_id, settingStore.securityEncType, settingStore.securityPassword)
      }
      return ecnPassword || ''
    }
    return user_id
  }
  return ''
}

export function getFlowEnc(user_id: string, fileSize: number, encType: string, password: string = '') {
  if (!encType) return null
  let settingStore = useSettingStore()
  const securityPassword = getEncPassword(user_id, encType, password)
  const securityEncType = settingStore.securityEncType
  return new FlowEnc(securityPassword, securityEncType, fileSize)
}

export function getProxyUrl(info: FileInfo) {
  let { debugProxyHost, debugProxyPort } = useSettingStore()
  let proxyUrl = `http://${debugProxyHost}:${debugProxyPort}/proxy`
  let params = Object.keys(info).filter(v => info[v])
    .map((key: string) => `${encodeURIComponent(key)}=${encodeURIComponent(info[key]!!)}`)
  return `${proxyUrl}?${params.join('&')}`
}

export function getRedirectUrl(info: FileInfo) {
  let { debugProxyHost, debugProxyPort } = useSettingStore()
  let redirectUrl = `http://${debugProxyHost}:${debugProxyPort}/redirect`
  let params = Object.keys(info).filter(v => info[v])
    .map((key: string) => `${encodeURIComponent(key)}=${encodeURIComponent(info[key]!!)}`)
  return `${redirectUrl}?${params.join('&')}`
}

export async function getRawUrl(
  user_id: string,
  drive_id: string,
  file_id: string,
  encType: string = '',
  password: string = '',
  weifa: boolean = false,
  preview_type: string = '',
  quality: string = '',
  promotionSkuCode = '',
  tokenfrom = ''
): Promise<string | IRawUrl> {
  let data: any = {
    drive_id: drive_id,
    file_id: file_id,
    url: '',
    size: 0,
    qualities: [],
    subtitles: []
  }
  if (drive_id === MEDIA_SERVER_DRIVE_ID) return data
  let { uiVideoQuality, uiVideoPlayer, securityPreviewAutoDecrypt } = useSettingStore()
  // 违规视频也使用转码播放
  if (!encType && preview_type) {
    if (weifa || preview_type === 'video' || (preview_type === 'other' && quality != 'Origin')) {
      let proxyInfo = await Db.getValueObject('ProxyInfo') as any
      if (proxyInfo && proxyInfo.encType && proxyInfo.file_id === file_id) {
        // 加密视频通过下载链接播放
      } else {
        let previewData = await AliFile.ApiVideoPreviewUrl(user_id, drive_id, file_id, promotionSkuCode)
        if (typeof previewData != 'string') {
          Object.assign(data, previewData)
          if (quality && quality != 'Origin') {
            const selectedQuality = data.qualities.find((q: any) => q.quality === quality) || data.qualities[0]
            data.url = selectedQuality?.url || ''
            if (selectedQuality?.headers) data.headers = selectedQuality.headers
            if (selectedQuality?.type) data.type = selectedQuality.type
          } else if (data.qualities.length > 0 && (drive_id === 'drive115' || drive_id === 'cloud123')) {
            data.url = data.qualities[0].url
            if (data.qualities[0].headers) data.headers = data.qualities[0].headers
            if (data.qualities[0].type) data.type = data.qualities[0].type
          } else if (data.qualities.length > 0 && !data.url) {
            data.url = data.qualities[0].url
            if (data.qualities[0].headers) data.headers = data.qualities[0].headers
            if (data.qualities[0].type) data.type = data.qualities[0].type
          }
        } else if (drive_id === 'drive115') {
          return previewData
        }
      }
    } else if (preview_type === 'audio') {
      // 仅阿里云盘有音频转码接口，其他网盘（115/百度/123/PikPak/Dropbox/OneDrive/Box/WebDAV 等）直接走原始下载链接
      if (isAliyunUser(user_id) && !isWebDavDrive(drive_id)) {
        let audioData = await AliFile.ApiAudioPreviewUrl(user_id, drive_id, file_id)
        if (typeof audioData != 'string') {
          data.url = audioData.url
        }
      }
    }
  }
  // 违规文件无法获取地址
  const needOriginQuality = !encType && preview_type === 'video' && !data.qualities.some((q: any) => q.quality === 'Origin')
  if ((!weifa && !data.url) || uiVideoPlayer == 'web' || needOriginQuality) {
    let downUrl = await DriveFile.ApiFileDownloadUrl(user_id, drive_id, file_id, 14400, tokenfrom)
    if (typeof downUrl != 'string') {
      if (!encType && preview_type && !data.qualities.some((q: any) => q.quality === 'Origin')) {
        data.qualities.unshift({ quality: 'Origin', html: '原画', label: '原画', value: '', url: downUrl.url, type: detectProxyVideoType(downUrl.url) })
      }
      if (!data.url || quality === 'Origin' || uiVideoQuality === 'Origin') {
        data.url = downUrl.url
      }
      data.size = downUrl.size
      const useQuarkSessionInterceptor = (preview_type === 'video' || preview_type === 'audio') && uiVideoPlayer === 'web' && !encType && (drive_id === 'quark' || isQuarkUser(user_id))
      if (downUrl.headers && !useQuarkSessionInterceptor) data.headers = downUrl.headers
    } else {
      return downUrl as string
    }
  }
  if (preview_type == 'other') {
    return data
  }  else if (encType && securityPreviewAutoDecrypt) {
    // 代理播放
    data.url = getProxyUrl({
      user_id, drive_id, file_id, encType, password,
      file_size: data.size, quality: quality || uiVideoQuality,
      proxy_url: data.url
    })
    data.qualities.unshift({ quality: 'Origin', html: '原画', label: '原画', value: '', url: data.url })
  }
  return data
}

export function getUrlFileName(url: string) {
  let fileNameMatch = decodeURIComponent(url).match(/filename\*?=[^=;]*;?''([^&]+)/)
  if (fileNameMatch && fileNameMatch[1]) {
    return fileNameMatch[1]
  }
  return ''
}

export async function createProxyServer(port: number) {
  const url = require('url')
  const proxyServer: Server = http.createServer(async (clientReq: IncomingMessage, clientRes: ServerResponse) => {
    const { pathname, query } = url.parse(clientReq.url, true)
    const { user_id, drive_id, file_id, file_size, encType, password, weifa, quality, proxy_url, proxy_headers, proxy_kind, content_disposition, file_name } = query
    if (pathname === '/proxy') {
      const driveId = String(drive_id || '')
      const fileId = String(file_id || '')
      const isAuthenticatedMpvProxy = String(proxy_kind || '') === 'mpv'
      const mpvProxyContext = createMpvProxyContext({ user_id, drive_id, file_id, file_size, quality, proxy_headers, proxy_kind })
      const buildMpvProxyUrl = (target: string) => getProxyUrl({
        user_id: mpvProxyContext.user_id,
        drive_id: mpvProxyContext.drive_id,
        file_id: mpvProxyContext.file_id,
        file_size: Number(mpvProxyContext.file_size) || undefined,
        quality: mpvProxyContext.quality,
        proxy_headers: mpvProxyContext.proxy_headers,
        proxy_kind: mpvProxyContext.proxy_kind,
        proxy_url: target
      })
      const isMediaServerProxy = driveId === MEDIA_SERVER_DRIVE_ID
      let proxyInfo: any = isMediaServerProxy ? undefined : await Db.getValueObject('ProxyInfo')
      let proxyUrl = proxy_url || (proxyInfo && proxyInfo.proxy_url || '') || ''
      let { uiVideoQuality, securityEncType, securityFileNameAutoDecrypt } = useSettingStore()
      let selectQuality = quality || uiVideoQuality
      let subtitle_url = ''
      if (proxy_kind !== 'mpv' && proxy_kind !== 'quark-download' && shouldRefreshProxyUrl({
        driveId,
        fileId,
        proxyUrl: String(proxyUrl || ''),
        selectQuality: String(selectQuality || ''),
        proxyInfo
      })) {
        // 获取地址
        const refreshQuality = content_disposition === 'inline' ? 'Origin' : selectQuality
        let data = await getRawUrl(user_id, drive_id, file_id, encType, '', weifa, 'other', refreshQuality)
        if (typeof data != 'string' && data.url) {
          let subtitleData = data.subtitles.find((sub: any) => sub.language === 'chi') || data.subtitles[0]
          subtitle_url = subtitleData && subtitleData.url || ''
          proxyUrl = data.url
          proxyInfo = undefined
        }
      }
      if (!proxyUrl) {
        clientRes.writeHead(404, { 'Content-Type': 'text/plain' })
        clientRes.end()
        await Db.deleteValueObject('ProxyInfo')
        return
      } else if (!proxyInfo && !isMediaServerProxy && proxy_kind !== 'subtitle' && proxy_kind !== 'mpv' && proxy_kind !== 'quark-download') {
        let info: FileInfo = {
          user_id, drive_id, file_id, file_size, encType,
          videoQuality: selectQuality,
          expires_time: GetExpiresTime(proxyUrl),
          proxy_url: proxyUrl,
          subtitle_url: subtitle_url
        }
        await Db.saveValueObject('ProxyInfo', info)
      }
      // 转码文件302重定向
      if (proxyUrl.includes('.aliyuncs.com') && !isAuthenticatedMpvProxy) {
        clientRes.writeHead(302, { 'Location': proxyUrl })
        clientRes.end()
        return
      }
      // 是否需要解密
      let decryptTransform: any = null
      if (encType) {
        // 要定位请求文件的位置 bytes=xxx-
        const range = clientReq.headers.range
        const start = range ? parseInt(range.replace('bytes=', '').split('-')[0]) : 0
        const flowEnc = getFlowEnc(user_id, file_size, encType, password)!!
        decryptTransform = flowEnc.decryptTransform()
        if (start) {
          await flowEnc.setPosition(start)
        }
      }
      const upstreamHeaders = ensureInlinePreviewRange(
        buildUpstreamProxyHeaders(clientReq.headers, String(proxy_headers || '')),
        content_disposition === 'inline'
      )
      if (query.drive_id === 'baidu') {
        upstreamHeaders['user-agent'] = 'pan.baidu.com'
        upstreamHeaders['referer'] = 'https://pan.baidu.com/'
        const token = UserDAL.GetUserToken(String(query.user_id || ''))
        if (token?.access_token && !upstreamHeaders['authorization']) {
          upstreamHeaders['authorization'] = `Bearer ${token.access_token}`
        }
      }
      if (query.drive_id === 'drive115') {
        const token = UserDAL.GetUserToken(String(query.user_id || ''))
        if (token?.access_token) {
          upstreamHeaders.authorization = `Bearer ${token.access_token}`
        }
        upstreamHeaders['user-agent'] = DRIVE115_DOWN_AGENT
      }
      if (query.drive_id === 'google') {
        const token = await UserDAL.EnsureUserTokenReady(String(query.user_id || ''))
        if (token?.tokenfrom === 'google' && token.access_token) {
          upstreamHeaders.authorization = `Bearer ${token.access_token}`
        }
      }
      if (query.drive_id === 'quark' || isQuarkUser(String(query.user_id || ''))) {
        const token = await getQuarkProxyToken(String(query.user_id || ''))
        const sessionCookie = await readQuarkCookieStringFromElectron().catch(() => '')
        // The signed-download endpoint can rotate __pus and returns its newest
        // value through proxy_headers.  Do not replace it with the persisted
        // login cookie here: the latter still works for listing/upload but the
        // CDN rejects it for the newly issued signed URL with 403.
        const signedDownloadCookie = String(upstreamHeaders.cookie || '')
        const storedCookie = hasQuarkLoginCookie(token?.access_token || '') ? token?.access_token || '' : ''
        const quarkCookie = mergeQuarkCookieHeaders(signedDownloadCookie, mergeQuarkCookieHeaders(sessionCookie, storedCookie))
        if (quarkCookie) {
          upstreamHeaders.cookie = quarkCookie
        }
        upstreamHeaders.accept = '*/*'
        upstreamHeaders.origin = 'https://pan.quark.cn'
        upstreamHeaders.referer = 'https://pan.quark.cn/'
        upstreamHeaders['user-agent'] = QUARK_DOWNLOAD_AGENT
        upstreamHeaders['accept-language'] = 'zh-CN,zh;q=0.9'
        upstreamHeaders['sec-fetch-dest'] = 'video'
        upstreamHeaders['sec-fetch-mode'] = 'no-cors'
        upstreamHeaders['sec-fetch-site'] = 'cross-site'
        upstreamHeaders['sec-ch-ua'] = '"Not;A=Brand";v="99", "Chromium";v="106"'
        upstreamHeaders['sec-ch-ua-mobile'] = '?0'
        upstreamHeaders['sec-ch-ua-platform'] = '"macOS"'
        delete upstreamHeaders['content-type']
        if (!upstreamHeaders.range) upstreamHeaders.range = 'bytes=0-'
        const urlPath = getQuarkUrlPath(String(proxyUrl || ''))
        if (urlPath) upstreamHeaders['x-urlp'] = urlPath
        const cookieKeys = getQuarkProxyCookieKeys(quarkCookie)
        clientRes.setHeader('x-quark-proxy-has-cookie', quarkCookie ? '1' : '0')
        clientRes.setHeader('x-quark-proxy-has-session-cookie', sessionCookie ? '1' : '0')
        clientRes.setHeader('x-quark-proxy-cookie-keys', cookieKeys.join(','))
        clientRes.setHeader('x-quark-proxy-referer', String(upstreamHeaders.referer || ''))
        clientRes.setHeader('x-quark-proxy-x-urlp', String(upstreamHeaders['x-urlp'] || ''))
        console.warn('proxy.quark.upstreamHeaders', {
          hasCookie: !!quarkCookie,
          hasSignedDownloadCookie: !!signedDownloadCookie,
          hasSessionCookie: !!sessionCookie,
          cookieKeys,
          origin: upstreamHeaders.origin,
          referer: upstreamHeaders.referer,
          userAgent: upstreamHeaders['user-agent'],
          xUrlp: upstreamHeaders['x-urlp'] || ''
        })
      }
      await new Promise((resolve) => {
        let isFinished = false
        const finishResponse = (endClient = false) => {
          if (isFinished) return
          isFinished = true
          if (endClient && !clientRes.writableEnded) clientRes.end()
          resolve(true)
        }
        // 处理请求，让下载的流量经过代理服务器
        const httpRequest = ~proxyUrl.indexOf('https') ? https : http
        const agentServer = httpRequest.request(proxyUrl, {
          method: clientReq.method,
          headers: upstreamHeaders,
          rejectUnauthorized: false,
          agent: ~proxyUrl.indexOf('https') ? httpsAgent : httpAgent
        }, (httpResp: any) => {
          if (isAuthenticatedMpvProxy && Number(httpResp.statusCode || 0) >= 400) {
            console.error('[MPV proxy] upstream HTTP status', Number(httpResp.statusCode || 0))
          }
          const quarkErrorChunks: Buffer[] = []
          let quarkErrorLength = 0
          const shouldReportQuarkError = (query.drive_id === 'quark' || isQuarkUser(String(query.user_id || ''))) && httpResp.statusCode >= 400
          let didReportQuarkError = false
          const reportQuarkError = () => {
            if (didReportQuarkError || !quarkErrorChunks.length) return
            didReportQuarkError = true
            console.error('proxy.quark.upstreamError', Buffer.concat(quarkErrorChunks).toString('utf8'))
          }
          if (shouldReportQuarkError) {
            httpResp.on('data', (chunk: Buffer) => {
              if (quarkErrorLength >= 8192) return
              const limitedChunk = chunk.subarray(0, 8192 - quarkErrorLength)
              quarkErrorChunks.push(limitedChunk)
              quarkErrorLength += limitedChunk.length
            })
          }
          const responseHeaders = normalizeProxyRangeHeaders({ ...httpResp.headers } as ProxyResponseHeaders)
          const statusCode = Number(httpResp.statusCode || 0)
          const shouldRewritePlaylist = isAuthenticatedMpvProxy && statusCode >= 200 && statusCode < 300 && isM3u8Response(String(proxyUrl), String(responseHeaders['content-type'] || '')) && ['', 'identity'].includes(String(responseHeaders['content-encoding'] || '').toLowerCase())
          if (isAuthenticatedMpvProxy && statusCode >= 300 && statusCode < 400 && typeof responseHeaders.location === 'string') {
            responseHeaders.location = resolveMpvProxyUri(responseHeaders.location, String(proxyUrl), mpvProxyContext, target => buildMpvProxyUrl(target))
          }
          if (shouldRewritePlaylist) {
            delete responseHeaders['content-length']
            delete responseHeaders['transfer-encoding']
            delete responseHeaders['content-range']
            delete responseHeaders['accept-ranges']
            delete responseHeaders.etag
            delete responseHeaders['content-md5']
            delete responseHeaders.digest
            delete responseHeaders['last-modified']
            responseHeaders['content-type'] = 'application/vnd.apple.mpegurl; charset=utf-8'
          }
          clientRes.statusCode = normalizeProxyStatusCode(statusCode, responseHeaders['content-range'])
          for (const key in responseHeaders) {
            const value = responseHeaders[key]
            if (value !== undefined) clientRes.setHeader(key, value)
          }
          if (content_disposition === 'inline') {
            const inlineFileName = String(file_name || getUrlFileName(proxyUrl) || 'preview')
            clientRes.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(inlineFileName)};`)
          }
          if (statusCode % 300 < 5) {
            // Redirect and not-modified responses retain the proxy URL for encrypted streams.
            if (decryptTransform) {
              // Referer
              httpResp.headers.location = getProxyUrl({
                user_id, drive_id, file_id, password, weifa,
                file_size, encType, quality, proxy_url
              })
            }
          }
          // 解密文件名
          if (clientReq.method === 'GET' && clientRes.statusCode === 200 && encType && securityFileNameAutoDecrypt) {
            let fileName = getUrlFileName(proxyUrl)
            if (fileName) {
              let ext = path.extname(fileName)
              let securityPassword = getEncPassword(user_id, encType, password)
              let decName = decodeName(securityPassword, securityEncType, fileName.replace(ext, '')) || ''
              clientRes.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(decName + ext)};`)
            }
          }
          if (shouldRewritePlaylist) {
            const chunks: Buffer[] = []
            const maxPlaylistBytes = 2 * 1024 * 1024
            let playlistBytes = 0
            let playlistAborted = false
            httpResp.on('data', (chunk: Buffer | string) => {
              if (playlistAborted) return
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              playlistBytes += buffer.length
              if (playlistBytes > maxPlaylistBytes) {
                playlistAborted = true
                httpResp.destroy()
                clientRes.destroy(new Error('HLS playlist exceeds size limit'))
                resolve(false)
                return
              }
              chunks.push(buffer)
            })
            httpResp.on('end', () => {
              if (playlistAborted) return
              reportQuarkError()
              const playlist = Buffer.concat(chunks).toString('utf8')
              clientRes.end(rewriteMpvProxyPlaylist(playlist, String(proxyUrl), mpvProxyContext, target => buildMpvProxyUrl(target)))
              finishResponse()
            })
          } else {
            httpResp.on('end', () => {
              reportQuarkError()
              finishResponse()
            })
            if (decryptTransform) {
              httpResp.pipe(decryptTransform).pipe(clientRes)
            } else {
              httpResp.pipe(clientRes)
            }
          }
          httpResp.on('aborted', () => {
            reportQuarkError()
            finishResponse(true)
          })
          httpResp.on('error', () => {
            reportQuarkError()
            finishResponse(true)
          })
          httpResp.on('close', () => {
            reportQuarkError()
            if (!httpResp.complete) finishResponse(true)
          })
        })
        clientReq.pipe(agentServer)
        // 关闭解密流
        agentServer.on('close', async () => {
          decryptTransform && decryptTransform.destroy()
        })
        agentServer.on('error', (e: Error) => {
          finishResponse(true)
          console.log('proxyServer socket error: ' + e)
        })
        // 重定向的请求 关闭时 关闭被重定向的请求
        clientRes.on('close', async () => {
          agentServer.destroy()
        })
      })
      clientReq.on('error', (e: Error) => {
        console.log('client socket error: ' + e)
      })
    }
  })
  proxyServer.listen(port)
  proxyServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      proxyServer.close()
      proxyServer.removeAllListeners('error')
      DebugLog.mSaveDanger(`端口：${port}已被占用，请前往【高级选项->刷新端口】`)
      message.error(`端口：${port}已被占用，请前往【高级选项->刷新端口】`, 5)
    }
  })
  return proxyServer
}
