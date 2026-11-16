import { musicHeadQueue, retryAfterMs } from '../utils/musicAccountQueue'
import { ITokenInfo } from '../user/userstore'
import UserDAL from '../user/userdal'
import { AxiosResponse } from 'axios'
import axios from '../axios'
import jschardet from 'jschardet'
import AliUser from './user'
import message from '../utils/message'
import DebugLog from '../utils/debuglog'
import { v4 } from 'uuid'
import { isNonAliyunProvider } from '../utils/driveIdentity'

export interface IUrlRespData {
  code: number
  header: string
  body: any
}

const nonAliyunRequest = (userId: string): IUrlRespData | undefined => {
  if (!userId || !isNonAliyunProvider(userId)) return undefined
  return { code: 403, header: '', body: '当前网盘账号不能调用阿里云盘 API' }
}

function BlobToString(body: Blob, encoding: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsText(body, encoding)
    reader.onload = function() {
      resolve((reader.result as string) || '')
    }
  })
}

function BlobToBuff(body: Blob): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsArrayBuffer(body)
    reader.onload = function() {
      resolve(reader.result as ArrayBuffer)
    }
  })
}

function Sleep(msTime: number): Promise<{ success: true; time: number }> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          success: true,
          time: msTime
        }),
      msTime
    )
  )
}

const IsDebugHttp = false
export default class AliHttp {
  static baseApi = 'https://api.aliyundrive.com/'
  static baseOpenApi = 'https://openapi.alipan.com/'

  static IsSuccess(code: number): Boolean {
    return code >= 200 && code <= 300
  }

  static HttpCodeBreak(code: number): Boolean {
    if (code >= 200 && code <= 300) return true
    if (code == 400) return true
    // if (code == 401) return true
    if (code > 402 && code <= 428) return true
    if (code == 409) return true
    return false
  }

  static async CatchError(error: any, token: ITokenInfo | undefined): Promise<IUrlRespData> {
    try {
      if (IsDebugHttp) console.log('CALLURLError ', error)
      const errorMessage = error.display_message || error.message || ''
      if (error.response) {
        let { code, status, config, data = undefined, headers = undefined } = error.response
        if (status === 429 && token?.user_id) musicHeadQueue.cool(token.user_id, retryAfterMs(headers?.['retry-after'] || headers?.['Retry-After']))
        if (code == 'ERR_NETWORK' || (status == 0 && !headers)) {
          DebugLog.mSaveWarning('HttpError0 message=' + errorMessage)
          return { code: 600, header: '', body: 'NetError 网络无法连接' } as IUrlRespData
        }
        let isNeedLog = true
        if (status == 429 || status == 504 || status == 500) isNeedLog = false
        if (data && data.code) {
          let errCode = [
            'NotFound.File',
            'InvalidParameter.Limit',
            'ForbiddenFileInTheRecycleBin',
            'PreHashMatched',
            'InvalidResource.SharePwd',
            'ShareLink.Expired',
            'FileShareNotAllowed',
            'CannotFollowYourself',
            'FeatureTemporaryDisabled',
            'InvalidParameter.RefreshToken',
            'UserDeviceIllegality',
            'UserDeviceOffline',
            'DeviceSessionSignatureInvalid',
            'AccessTokenInvalid',
            'AccessTokenExpired'
          ]
          if (errCode.includes(data.code)) isNeedLog = false
          // 自动刷新Token
          if (data.code == 'AccessTokenInvalid' || data.code == 'AccessTokenExpired') {
            if (token) {
              if (isNonAliyunProvider(token)) {
                return {
                  code: error.response.status || 403,
                  header: JSON.stringify(error.response.headers || {}),
                  body: error.response.data || 'NetError 当前网盘接口请求错误'
                } as IUrlRespData
              }
              const isOpenApi = config.url.includes('openapi.alipan.com') || config.url.includes('adrive/v1.0') || config.url.includes('adrive/v1.1')
              if (!isOpenApi) {
                return await AliUser.ApiTokenRefreshAccount(token, true, true).then((isLogin: boolean) => {
                  if (isLogin) {
                    return { code: 401, header: '', body: '' } as IUrlRespData
                  }
                  return { code: 403, header: '', body: 'NetError 账号需要重新登录' } as IUrlRespData
                })
              } else {
                return await AliUser.OpenApiTokenRefreshAccount(token, true, true).then((flag: boolean) => {
                  if (flag) {
                    return { code: 401, header: '', body: '' } as IUrlRespData
                  }
                  return { code: 403, header: '', body: 'NetError 账号需要重新登录' } as IUrlRespData
                })
              }
            } else {
              return { code: 402, header: '', body: 'NetError 账号需要重新登录' } as IUrlRespData
            }
          }

          // 自动刷新Session
          if (data.code == 'UserDeviceIllegality'
            || data.code == 'UserDeviceOffline'
            || data.code == 'DeviceSessionSignatureInvalid') {
            if (token) {
              if (isNonAliyunProvider(token)) {
                return {
                  code: error.response.status || 403,
                  header: JSON.stringify(error.response.headers || {}),
                  body: error.response.data || 'NetError 当前网盘接口请求错误'
                } as IUrlRespData
              }
              return await AliUser.ApiSessionRefreshAccount(token, true, true).then((flag: boolean) => {
                if (flag) {
                  return { code: 401, header: '', body: '' } as IUrlRespData
                }
                return { code: 403, header: '', body: '刷新Session失败' } as IUrlRespData
              })
            } else {
              return { code: 402, header: '', body: 'NetError 账号需要重新登录' } as IUrlRespData
            }
          }
        }
        if (isNeedLog) {
          DebugLog.mSaveWarning('HttpError4 status=' + status + ' code=' + data?.code + ' message=' + errorMessage)
        }

        return {
          code: error.response.status,
          header: JSON.stringify(error.response.headers),
          body: error.response.data
        } as IUrlRespData

      } else if (error.request) {
        const url = error.config?.url || ''
        if (error.code == 'ECONNABORTED' && (url.indexOf('/batch') > 0 || url.indexOf('/search') > 0 || url.indexOf('/list') > 0)) {

        } else if (url.indexOf('items(size)') > 0) {

        } else {
          console.log('error.request', error)
          message.error('网络请求超时，似乎网络不太顺畅')
          DebugLog.mSaveWarning('HttpError1 message=' + errorMessage)
        }
        return { code: 601, header: '', body: 'NetError ' + errorMessage } as IUrlRespData
      } else if (error.message) {
        DebugLog.mSaveWarning('HttpError3 status=' + error.response?.status || '' + ' message=' + errorMessage)
        return { code: 603, header: '', body: 'NetError ' + errorMessage } as IUrlRespData
      } else {

        DebugLog.mSaveWarning('HttpError2 message=' + errorMessage)
        return { code: 602, header: '', body: 'NetError ' + errorMessage } as IUrlRespData
      }
    } catch (err: any) {
      DebugLog.mSaveWarning('HttpError5', err)
      return { code: 605, header: '', body: 'NetError catch=' + (err.message || '') } as IUrlRespData
    }
  }

  static async Get(url: string, user_id: string, params?: any): Promise<IUrlRespData> {
    const blocked = nonAliyunRequest(user_id)
    if (blocked) return blocked
    if (!url.startsWith('http') && !url.startsWith('https')) {
      if (url.includes('adrive/v1.0') || url.includes('adrive/v1.1')) {
        url = AliHttp.baseOpenApi + url
      } else {
        url = AliHttp.baseApi + url
      }
    }
    for (let i = 0; i <= 5; i++) {
      const resp = await AliHttp._Get(url, user_id, params)
      if (AliHttp.HttpCodeBreak(resp.code)) return resp
      else if (i == 5) return resp
      else await Sleep(2000)
    }
    return { code: 607, header: '', body: 'NetError GetLost' }
  }

  static _Get(url: string, user_id: string, params?: any): Promise<IUrlRespData> {
    return UserDAL.GetUserTokenFromDB(user_id).then((token) => {
      const headers: any = {}
      if (token) {
        let token_type = token.token_type
        let access_token = token.access_token
        let need_open_api = url.includes('openapi')
        if (need_open_api && token.open_api_access_token) {
          token_type = token.open_api_token_type || 'Bearer'
          access_token = token.open_api_access_token
        } else {
          headers['x-device-id'] = token.device_id
          headers['x-signature'] = token.signature
          headers['x-request-id'] = v4().toString()
        }
        headers['Authorization'] = token_type + ' ' + access_token
      }
      return axios
        .get(url, {
          params: params,
          withCredentials: false,
          responseType: 'json',
          timeout: 30000,
          headers
        })
        .then((response: AxiosResponse) => {
          return {
            code: response.status,
            header: JSON.stringify(response.headers),
            body: response.data
          } as IUrlRespData
        })
        .catch(function(err: any) {
          return AliHttp.CatchError(err, token)
        })
    })
  }


  static async GetString(url: string, user_id: string, fileSize: number, maxSize: number, requestHeaders: Record<string, string> = {}, allowProviderUrl: boolean = false): Promise<IUrlRespData> {
    const blocked = nonAliyunRequest(user_id)
    if (blocked && !allowProviderUrl) return blocked
    if (!url.startsWith('http') && !url.startsWith('https')) {
      if (url.includes('adrive/v1.0') || url.includes('adrive/v1.1')) {
        url = AliHttp.baseOpenApi + url
      } else {
        url = AliHttp.baseApi + url
      }
    }
    for (let i = 0; i <= 5; i++) {
      const resp = await AliHttp._GetString(url, user_id, fileSize, maxSize, requestHeaders)
      if (AliHttp.HttpCodeBreak(resp.code)) return resp
      else if (i == 5) return resp
      else await Sleep(2000)
    }
    return { code: 609, header: '', body: 'NetError GetStringLost' }
  }

  private static _GetString(url: string, user_id: string, fileSize: number, maxSize: number, requestHeaders: Record<string, string> = {}): Promise<IUrlRespData> {
    return UserDAL.GetUserTokenFromDB(user_id).then((token) => {
      const headers: any = { ...requestHeaders }
      if (token && !isNonAliyunProvider(token)) {
        let token_type = token.token_type
        let access_token = token.access_token
        let need_open_api = url.includes('openapi')
        if (need_open_api && token.open_api_access_token) {
          token_type = token.open_api_token_type || 'Bearer'
          access_token = token.open_api_access_token
        } else {
          headers['x-device-id'] = token.device_id
          headers['x-signature'] = token.signature
          headers['x-request-id'] = v4().toString()
        }
        headers['Authorization'] = token_type + ' ' + access_token
      }
      headers.Range = 'bytes=0-' + (Math.min(fileSize, maxSize) - 1).toString()

      return axios
        .get(url, {
          withCredentials: false,
          responseType: 'blob',
          timeout: 30000,
          headers
        })
        .then((response: AxiosResponse) => {
          const data = response.data as Blob
          if (data.size == 0) {
            response.data = '文件是空的'
            return response
          }
          const test = data.slice(0, data.size > 10240 ? 10240 : data.size - 1)
          return BlobToBuff(test).then((abuff: ArrayBuffer | undefined) => {
            let encoding = 'utf-8'
            if (abuff && abuff.byteLength > 3) {
              const buff = Buffer.from(abuff)
              if (buff[0].toString(16).toLowerCase() == 'ef' && buff[1].toString(16).toLowerCase() == 'bb' && buff[2].toString(16).toLowerCase() == 'bf') {

                encoding = 'utf-8'
              } else if (buff[0] == 239 && buff[1] == 191 && buff[2] == 189) {
                encoding = 'GB2312'
              } else {
                try {
                  const info = jschardet.detect(buff)
                  encoding = info.encoding
                  if (encoding == 'ascii') encoding = 'utf-8'
                } catch {
                  encoding = 'utf-8'
                }
              }
            }
            return BlobToString(data, encoding).then((str) => {
              response.data = str
              return response
            })
          })
        })
        .then((response: AxiosResponse) => {
          const resp: IUrlRespData = {
            code: response.status,
            header: JSON.stringify(response.headers),
            body: response.data
          }

          if (typeof resp.body === 'string' && resp.body.length > 5) {

            const sub = resp.body.substring(0, Math.min(200, resp.body.length))
            if (sub.indexOf('{') >= 0 && sub.indexOf(':') > 0 && sub.indexOf('}') > 0 && sub.indexOf('"') > 0) {

              try {
                resp.body = JSON.stringify(JSON.parse(resp.body), undefined, 2)
              } catch {
              }
            }
          }
          return resp
        })
        .catch(function(err: any) {
          return AliHttp.CatchError(err, token)
        })
    })
  }


  static async GetBlob(url: string, user_id: string): Promise<IUrlRespData> {
    const blocked = nonAliyunRequest(user_id)
    if (blocked) return blocked
    if (!url.startsWith('http') && !url.startsWith('https')) {
      if (url.includes('adrive/v1.0') || url.includes('adrive/v1.1')) {
        url = AliHttp.baseOpenApi + url
      } else {
        url = AliHttp.baseApi + url
      }
    }
    for (let i = 0; i <= 5; i++) {
      const resp = await AliHttp._GetBlob(url, user_id)
      if (AliHttp.HttpCodeBreak(resp.code)) return resp
      else if (i == 5) return resp
      else await Sleep(2000)
    }
    return { code: 611, header: '', body: 'NetError GetBlobLost' } as IUrlRespData
  }

  private static _GetBlob(url: string, user_id: string): Promise<IUrlRespData> {
    return UserDAL.GetUserTokenFromDB(user_id).then((token) => {
      const headers: any = {}
      if (token) {
        let token_type = token.token_type
        let access_token = token.access_token
        let need_open_api = url.includes('openapi')
        if (need_open_api && token.open_api_access_token) {
          token_type = token.open_api_token_type || 'Bearer'
          access_token = token.open_api_access_token
        } else {
          headers['x-device-id'] = token.device_id
          headers['x-signature'] = token.signature
          headers['x-request-id'] = v4().toString()
        }
        headers['Authorization'] = token_type + ' ' + access_token
      }
      return axios
        .get(url, {
          withCredentials: false,
          responseType: 'blob',
          timeout: 30000,
          headers
        })
        .then((response: AxiosResponse) => {
          return {
            code: response.status,
            header: JSON.stringify(response.headers),
            body: response.data
          } as IUrlRespData
        })
        .catch(function(err: any) {
          return AliHttp.CatchError(err, token)
        })
    })
  }

  static async Post(url: string, postData: any, user_id: string, share_token: string): Promise<IUrlRespData> {
    const blocked = nonAliyunRequest(user_id)
    if (blocked) return blocked
    if (!url.startsWith('http') && !url.startsWith('https')) {
      if (url.includes('adrive/v1.0') || url.includes('adrive/v1.1')) {
        url = AliHttp.baseOpenApi + url
      } else {
        url = AliHttp.baseApi + url
      }
    }
    for (let i = 0; i <= 5; i++) {
      const resp = await AliHttp._Post(url, postData, user_id, share_token)
      if (resp.code == 429
        && resp.body.display_message
        && !url.includes('getDownloadUrl')
        && !url.includes('get_download_url')) {
        return resp
      }
      if (resp.code == 400 &&
        (url.includes('/file/search')
          || url.includes('/file/list')
          || url.includes('/file/walk')
          || url.includes('/file/scan'))) {
        await Sleep(2000)
      } else if (AliHttp.HttpCodeBreak(resp.code)) return resp
      else if (i == 5) return resp
      else await Sleep(2000)
    }
    return { code: 608, header: '', body: 'NetError PostLost' } as IUrlRespData
  }

  private static _Post(url: string, postData: any, user_id: string, share_token: string): Promise<IUrlRespData> {
    return UserDAL.GetUserTokenFromDB(user_id).then((token) => {
      const headers: any = {}
      if (url.includes('aliyundrive') || url.includes('alipan')) {
        headers['Content-Type'] = 'application/json'
      }
      if (token) {
        let token_type = token.token_type
        let access_token = token.access_token
        let need_open_api = url.includes('openapi')
        if (need_open_api && token.open_api_access_token) {
          token_type = token.open_api_token_type || 'Bearer'
          access_token = token.open_api_access_token
        } else {
          headers['x-device-id'] = token.device_id
          headers['x-signature'] = token.signature
          headers['x-request-id'] = v4().toString()
        }
        headers['Authorization'] = 'Bearer' + ' ' + access_token
      }
      if (share_token) {
        headers['x-share-token'] = share_token
      }
      let timeout = 30000
      if (url.includes('/batch')) timeout = 60000
      return axios
        .post(url, postData, {
          withCredentials: false,
          responseType: 'json',
          timeout,
          headers
        })
        .then((response: AxiosResponse) => {
          return {
            code: response.status,
            header: JSON.stringify(response.headers),
            body: response.data
          } as IUrlRespData
        })
        .catch(function(err: any) {
          return AliHttp.CatchError(err, token)
        })
    })
  }

  static async PostString(url: string, postData: any, user_id: string, share_token: string): Promise<IUrlRespData> {
    const blocked = nonAliyunRequest(user_id)
    if (blocked) return blocked
    if (!url.startsWith('http') && !url.startsWith('https')) {
      if (url.includes('adrive/v1.0') || url.includes('adrive/v1.1')) {
        url = AliHttp.baseOpenApi + url
      } else {
        url = AliHttp.baseApi + url
      }
    }
    for (let i = 0; i <= 5; i++) {
      const resp = await AliHttp._PostString(url, postData, user_id, share_token)
      if (AliHttp.HttpCodeBreak(resp.code)) return resp
      else if (i == 5) return resp
      else await Sleep(2000)
    }
    return { code: 610, header: '', body: 'NetError PostStringLost' } as IUrlRespData
  }

  private static _PostString(url: string, postData: any, user_id: string, share_token: string): Promise<IUrlRespData> {
    const headers: any = {}
    return UserDAL.GetUserTokenFromDB(user_id).then((token) => {
      if (token) {
        let token_type = token.token_type
        let access_token = token.access_token
        let need_open_api = url.includes('openapi')
        if (need_open_api && token.open_api_access_token) {
          token_type = token.open_api_token_type || 'Bearer'
          access_token = token.open_api_access_token
        } else {
          headers['x-device-id'] = token.device_id
          headers['x-signature'] = token.signature
          headers['x-request-id'] = v4().toString()
        }
        headers['Authorization'] = token_type + ' ' + access_token
      }
      if (share_token) {
        headers['x-share-token'] = share_token
      }

      return axios
        .post(url, postData, {
          withCredentials: false,
          responseType: 'text',
          timeout: 50000,
          headers
        })
        .then((response: AxiosResponse) => {
          return {
            code: response.status,
            header: JSON.stringify(response.headers),
            body: response.data
          } as IUrlRespData
        })
        .catch(function(err: any) {
          return AliHttp.CatchError(err, token)
        })
    })
  }
}
