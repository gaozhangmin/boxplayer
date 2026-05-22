import { b64decode, Sleep } from '../utils/format'
import { getPkgVersion } from '../utils/utils'
import axios, { AxiosResponse } from 'axios'
import { IShareSiteGroupModel, IShareSiteModel, useServerStore, useSettingStore } from '../store'
import ShareDAL from '../share/share/ShareDAL'
import { modalShowPost, modalUpdate } from '../utils/modal'
import { getResourcesPath } from '../utils/electronhelper'
import { existsSync, readFileSync } from 'fs'
import message from '../utils/message'
import path from 'path'
import DebugLog from '../utils/debuglog'

export interface IServerRespData {
  state: string
  msg: string

  [k: string]: any
}

export interface IServerVerData {
  version: string
  verName: string
  verUrl: string
  verInfo: string
  verHtml: string
  fileExt: string
  fileSize: number
}

export default class ServerHttp {
  static baseApi = b64decode('aHR0cDovLzEyMS41LjE0NC44NDo1MjgyLw==')
  static configUrl = b64decode('aHR0cHM6Ly9naXRlZS5jb20vemhhbm5hby9yZXNvdXJjZS9yYXcvbWFzdGVyL3NoYXJlU2l0ZUNvbmZpZy5qc29u')
  static updateUrl = b64decode('aHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy9nYW96aGFuZ21pbi9ib3hwbGF5ZXIvcmVsZWFzZXMvbGF0ZXN0')

  static compareVer(version1: string, version2: string): number {
    // Split version strings into arrays of numbers
    const v1Parts = version1.split('.').map(Number)
    const v2Parts = version2.split('.').map(Number)

    // Pad the shorter version with zeros to make their lengths equal
    const maxLength = Math.max(v1Parts.length, v2Parts.length)
    v1Parts.push(...Array(maxLength - v1Parts.length).fill(0))
    v2Parts.push(...Array(maxLength - v2Parts.length).fill(0))

    // Compare each part of the version numbers
    for (let i = 0; i < maxLength; i++) {
      if (v1Parts[i] > v2Parts[i]) {
        return 1
      } else if (v1Parts[i] < v2Parts[i]) {
        return -1
      }
    }

    // Version numbers are equal
    return 0
  }

  static async Post(postData: any, isfirst = true): Promise<IServerRespData> {
    const url = ServerHttp.baseApi + 'xby2'
    return axios
      .post(url, postData, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {}
      })
      .then((response: AxiosResponse) => {
        if (response.status != 200) return { state: 'error', msg: '网络错误' }
        const buff = response.data as ArrayBuffer
        const uint8array = new Uint8Array(buff)
        for (let i = 0, maxi = uint8array.byteLength; i < maxi; i++) {
          uint8array[i] ^= 9 + (i % 200)
        }
        const str = new TextDecoder().decode(uint8array)
        return JSON.parse(str) as IServerRespData
      })
      .catch(() => {
        return { state: 'error', msg: '网络错误' }
      })
      .then(async (resp) => {
        if (resp.state == 'error' && resp.msg == '网络错误' && isfirst) {
          await Sleep(2000)
          return await ServerHttp.Post(postData, false)
        } else return resp
      })
  }


  static async PostToServer(postData: any): Promise<IServerRespData> {
    postData.appVersion = getPkgVersion()
    const str = JSON.stringify(postData)
    if (window.postdataFunc) {
      let enstr = ''
      try {
        enstr = window.postdataFunc(str)
        console.log(enstr)
      } catch {
        return { state: 'error', msg: '联网失败' }
      }
      return ServerHttp.Post(enstr).catch(() => {
        return { state: 'error', msg: '网络错误' }
      })
    } else {
      return { state: 'error', msg: '程序错误' }
    }
  }

  static async CheckConfigUpgrade(): Promise<void> {
    axios
      .get(ServerHttp.configUrl, {
        withCredentials: false,
        responseType: 'json',
        timeout: 30000
      })
      .then(async (response: AxiosResponse) => {
        console.log('CheckConfigUpgrade', response)
        let GroupList: IShareSiteGroupModel[] = []
        if (response.data.GroupList && response.data.GroupList.length > 0) {
          const list = response.data.GroupList
          for (let item of list) {
            GroupList.push({ group: item.group, title: item.title })
          }
          ShareDAL.SaveShareSiteGroup(GroupList)
        }
        if (response.data.SSList && response.data.SSList.length > 0) {
          const list: IShareSiteModel[] = []
          const SSList = response.data.SSList
          for (let item of SSList) {
            const add: any = {
              title: item.title,
              url: item.url,
              tip: item.tip,
              group: item.group,
              color: item.color,
              external: item.external
            }
            if (add.url.length > 0) list.push(add)
          }
          ShareDAL.SaveShareSite(list)
        }
        if (response.data.HELP && response.data.HELP.length > 0) {
          useServerStore().mSaveHelpUrl(response.data.HELP)
        }
        if (response.data.POST && response.data.POST.length > 0) {
          let postId = localStorage.getItem('postmodal')
          if (!postId || postId != response.data.POST_ID) {
            modalShowPost(response.data.POST, response.data.POST_ID)
          }
        }
      }).catch((err: any) => {
      DebugLog.mSaveDanger('CheckConfigUpgrade', err)
    })
  }

  static async CheckUpgrade(showMessage: boolean = true): Promise<void> {
    axios
      .get(ServerHttp.updateUrl, {
        withCredentials: false,
        responseType: 'json',
        timeout: 30000
      })
      .then(async (response: AxiosResponse) => {
        console.log('CheckUpgrade', response)
        if (!response.data || !response.data.assets || !response.data.html_url) {
          showMessage && message.error('获取新版本出错')
          return
        }
        let tagName = response.data.tag_name  // 版本号
        let remoteVer = tagName.replaceAll('v', '').trim()
        let verHtml = response.data.html_url // 详情
        let verInfo = response.data.body // 日志
        let verData: IServerVerData = {
          version: remoteVer,
          verName: '',
          verUrl: '',
          verInfo: verInfo,
          verHtml: verHtml,
          fileExt: '',
          fileSize: 0
        }
        let assets = response.data.assets     // 文件
        function isMatchingPlatformAndExtension(platform: string, fileName: string, extension: string): boolean {
          return platform === window.platform && fileName.indexOf(process.arch) > 0 && fileName.endsWith(extension)
        }

        for (let asset of assets) {
          if (asset.name.endsWith('.asar')) {
            verData.fileSize = asset.size
            verData.fileExt = path.extname(asset.name)
            verData.verUrl = asset.browser_download_url
            verData.verName = asset.name
            break
          }
          if (isMatchingPlatformAndExtension('win32', asset.name, '.exe') ||
            isMatchingPlatformAndExtension('darwin', asset.name, '.dmg')) {
            verData.fileSize = asset.size
            verData.fileExt = path.extname(asset.name)
            verData.verUrl = asset.browser_download_url
            verData.verName = asset.name
          }
        }
        if (remoteVer) {
          let configVer = getPkgVersion().replaceAll('v', '').trim()
          if (window.platform !== 'linux') {
            let localVersion = getResourcesPath('localVersion')
            if (localVersion && existsSync(localVersion)) {
              configVer = readFileSync(localVersion, 'utf-8').replaceAll('v', '').trim()
            }
          }
          if (useSettingStore().uiUpdateProxyEnable &&
            useSettingStore().uiUpdateProxyUrl.length > 0) {
            verData.verUrl = useSettingStore().uiUpdateProxyUrl + '/' + verData.verUrl
          }
          if (this.compareVer(remoteVer, configVer) > 0) {
            // 打开更新弹窗
            modalUpdate(verData)
          } else if (showMessage) {
            message.info('已经是最新版 ' + configVer, 6)
          }
        }
      })
      .catch((err: any) => {
        showMessage && message.info('检查更新失败，请检查网络是否正常')
        // DebugLog.mSaveDanger('CheckUpgrade', err)
      })
  }
}