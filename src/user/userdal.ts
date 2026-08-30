import DB from '../utils/db'
import AliUser from '../aliapi/user'
import message from '../utils/message'
import useUserStore, { ITokenInfo } from './userstore'
import {
  useAppStore,
  useFootStore,
  useMyFollowingStore,
  useMyShareStore,
  useOtherFollowingStore,
  usePanFileStore,
  usePanTreeStore,
  useSettingStore
} from '../store'
import PanDAL from '../pan/pandal'
import DebugLog from '../utils/debuglog'
import { refreshGuangyaAccessToken } from '../guangya/auth'
import { applyProviderQuota, ensureProviderAccessToken, ensureProviderSession, refreshProviderAccountInfo } from '../drive/providerAuth'
import { isBaiduUser, isBoxUser, isCloud123User, isCloud139User, isCloud189User, isDrive115User, isDropboxUser, isGoogleUser, isGuangyaUser, isNonAliyunProvider, isOneDriveUser, isPikPakUser, isQuarkUser, isRemoteDriveUser } from '../utils/driveIdentity'
import { promptAutoScanForUser } from '../utils/libraryAutoScanPrompt'
import { getWebDavConnection, getWebDavConnectionId, getWebDavConnections } from '../utils/webdavClient'
import { createRemoteDriveAccount } from '../utils/remoteDriveAccount'
import { supportsAliyunAutoSign } from './autoSignPolicy'
import { getStoredTokenProvider } from '../utils/driveProvider'
import { captureProviderLogin } from '../analytics/posthog'
import { withStartupTimeout } from '../utils/startupTask'
import { loadInitialProviderRoot, selectInitialAliyunRoot, shouldRetryInitialRootLoad } from './startupProviderRootLoad'

export const UserTokenMap = new Map<string, ITokenInfo>()

const getTokenRefreshState = (token: ITokenInfo) => [token.access_token, token.refresh_token, token.expires_in, token.expire_time, token.token_type, token.default_drive_id].join('\u0000')

export default class UserDAL {
  private static cliSyncTimer: ReturnType<typeof setTimeout> | undefined

  private static toCliProvider(token: ITokenInfo): string {
    return token.tokenfrom === 'aliyun' || token.tokenfrom === 'unknown' ? 'aliyun' : token.tokenfrom
  }

  private static toCliAccount(token: ITokenInfo) {
    const provider = this.toCliProvider(token)
    const accountId = provider === 'aliyun' ? `aliyun_${token.user_id}` : token.user_id
    return {
      provider,
      accountId,
      displayName: token.nick_name || token.user_name || token.name || token.user_id,
      token: {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type || 'Bearer',
        expires_in: token.expires_in,
        expire_time: token.expire_time,
        device_id: token.device_id,
        signature: token.signature,
        user_id: token.user_id,
        user_name: token.user_name,
        nick_name: token.nick_name,
        default_drive_id: token.default_drive_id,
        default_sbox_drive_id: token.default_sbox_drive_id,
        resource_drive_id: token.resource_drive_id,
        backup_drive_id: token.backup_drive_id,
        sbox_drive_id: token.sbox_drive_id,
        pic_drive_id: token.pic_drive_id,
        open_api_access_token: token.open_api_access_token,
        open_api_refresh_token: token.open_api_refresh_token,
        open_api_token_type: token.open_api_token_type,
      },
    }
  }

  static async SyncCliAccountsToCli(): Promise<{ ok?: boolean; exported?: number; path?: string; error?: string } | null> {
    if (!window.TvBoxInvoke) return null
    const userList = await DB.getUserAll()
    const accounts = userList
      .filter((token) => token.user_id && !isRemoteDriveUser(token))
      .map((token) => this.toCliAccount(token))
    return await window.TvBoxInvoke('ExportCliTokens', { accounts }) as { ok?: boolean; exported?: number; path?: string; error?: string } | null
  }

  private static scheduleCliAccountSync() {
    if (!window.TvBoxInvoke) return
    if (this.cliSyncTimer) clearTimeout(this.cliSyncTimer)
    this.cliSyncTimer = setTimeout(() => {
      this.cliSyncTimer = undefined
      this.SyncCliAccountsToCli().catch((err: any) => {
        DebugLog.mSaveWarning('SyncCliAccountsToCli', err?.message || err)
      })
    }, 1000)
  }

  private static async ensureTokenReady(token: ITokenInfo, force = false): Promise<ITokenInfo | null> {
    try {
      const previousRefreshState = getTokenRefreshState(token)
      const oauthToken = await ensureProviderAccessToken(token, force)
      if (oauthToken !== undefined) {
        if (!oauthToken) return null
        if (oauthToken !== token || getTokenRefreshState(oauthToken) !== previousRefreshState) this.SaveUserToken(oauthToken)
        return oauthToken
      }
      const sessionToken = await ensureProviderSession(token, force)
      if (sessionToken !== undefined) {
        if (!sessionToken) return null
        if (sessionToken !== token || getTokenRefreshState(sessionToken) !== previousRefreshState) this.SaveUserToken(sessionToken)
        return sessionToken
      }
      if (isGuangyaUser(token)) {
        token.default_drive_id = token.default_drive_id || 'guangya'
        const expireTime = new Date(token.expire_time || 0).getTime()
        if (force || !token.access_token || (expireTime && expireTime <= Date.now())) {
          const refreshed = await refreshGuangyaAccessToken(token)
          if (!refreshed?.access_token) return null
          this.SaveUserToken(refreshed)
          return refreshed
        }
        return token.user_id && token.access_token ? token : null
      }
      if (isRemoteDriveUser(token)) {
        return getWebDavConnection(getWebDavConnectionId(token.default_drive_id)) ? token : null
      }
      const ok = !!(token.user_id && (await AliUser.ApiTokenRefreshAccount(token, false)))
      return ok ? token : null
    } catch (err: any) {
      DebugLog.mSaveDanger('ensureTokenReady', err)
      return null
    }
  }

  static async aLoadFromDB() {
    const tokenList = await DB.getUserAll()
    for (const connection of getWebDavConnections()) {
      const token = createRemoteDriveAccount(connection).token
      if (tokenList.some((item) => item.user_id === token.user_id)) continue
      await DB.saveUser(token)
      tokenList.push(token)
    }
    const defaultUser = await DB.getValueString('uiDefaultUser')
    UserTokenMap.clear()
    // 先把所有账号塞进 UserTokenMap，保证 UserInfo 历史账号列表 + 切换可用，
    // 不受“默认账号加载失败”影响
    for (const token of tokenList) {
      if (token?.user_id) UserTokenMap.set(token.user_id, token)
    }

    // 排序：默认账号优先；其次按 used_size（getUserAll 已倒序，即“最常用”）
    const orderedTokens: ITokenInfo[] = []
    if (defaultUser) {
      const idx = tokenList.findIndex((t) => t.user_id === defaultUser)
      if (idx >= 0) {
        orderedTokens.push(tokenList[idx])
        for (let i = 0; i < tokenList.length; i++) {
          if (i !== idx) orderedTokens.push(tokenList[i])
        }
      } else {
        orderedTokens.push(...tokenList)
      }
    } else {
      orderedTokens.push(...tokenList)
    }

    let hasLogin = false
    let defaultUserLoaded = false
    let loadedIndex = -1
    for (let index = 0; index < orderedTokens.length; index++) {
      const token = orderedTokens[index]
      // 还未选出可登录账号：依次尝试。任意一步失败都 fallback 到下一个
      try {
        const prepared = await withStartupTimeout(this.ensureTokenReady(token), `账号 ${token?.user_id || ''} 初始化`)
        if (!prepared?.user_id) continue
        await this.UserLogin(prepared)
        hasLogin = true
        loadedIndex = index
        if (defaultUser && prepared.user_id === defaultUser) defaultUserLoaded = true
        break
      } catch (err: any) {
        DebugLog.mSaveDanger('aLoadFromDB userLogin ' + (token?.user_id || ''), err)
        // 失败的账号 token 已在 UserTokenMap 中（顶部统一塞过），
        // UserInfo.vue 仍可列出并支持手动切换
      }
    }
    if (loadedIndex >= 0) {
      const pendingTokens = orderedTokens.slice(loadedIndex + 1)
      void (async () => {
        for (const token of pendingTokens) {
          try {
            const prepared = await withStartupTimeout(this.ensureTokenReady(token), `后台刷新账号 ${token?.user_id || ''}`)
            if (prepared?.user_id) await this.UserAutoSign(prepared)
          } catch (err: any) {
            DebugLog.mSaveDanger('aLoadFromDB autoSign ' + (token?.user_id || ''), err)
          }
        }
      })()
    }
    if (defaultUser && !defaultUserLoaded) {
      console.log('aLoadFromDB defaultUser failed, fallback used. defaultUser=', defaultUser)
    }
    if (!hasLogin) {
      useUserStore().userShowLogin = true
    }
    this.scheduleCliAccountSync()
  }


  static async aRefreshAllUserToken() {
    const tokenList = await DB.getUserAll()
    const dateNow = new Date().getTime()
    for (let i = 0, maxi = tokenList.length; i < maxi; i++) {
      const token = tokenList[i]
      try {
        const previousRefreshState = getTokenRefreshState(token)
        const expireTime = new Date(token.expire_time || 0).getTime()
        const providerToken = await ensureProviderAccessToken(token, !!expireTime && expireTime - dateNow <= 1000 * 60 * 5)
        if (providerToken !== undefined) {
          if (providerToken && (providerToken !== token || getTokenRefreshState(providerToken) !== previousRefreshState)) UserDAL.SaveUserToken(providerToken)
          continue
        }
        const sessionToken = await ensureProviderSession(token, !!expireTime && expireTime - dateNow <= 1000 * 60 * 5)
        if (sessionToken !== undefined) {
          if (sessionToken && (sessionToken !== token || getTokenRefreshState(sessionToken) !== previousRefreshState)) UserDAL.SaveUserToken(sessionToken)
          continue
        }
        if (isGuangyaUser(token)) {
          const expireTime = new Date(token.expire_time || 0).getTime()
          if (expireTime && expireTime - dateNow <= 1000 * 60 * 5) {
            const refreshed = await refreshGuangyaAccessToken(token)
            if (refreshed) {
              UserTokenMap.set(refreshed.user_id, refreshed)
              await DB.saveUser(refreshed)
            }
          }
          continue
        }
        if (isNonAliyunProvider(token)) {
          continue
        }
        const expire_time = new Date(token.expire_time).getTime()
        const session_expire_time = new Date(token.session_expires_in).getTime()
        // 自动刷新Token(过期前5分钟)
        if (expire_time - dateNow <= 1000 * 60 * 5) {
          await AliUser.ApiTokenRefreshAccount(token, false, true)
          await AliUser.OpenApiTokenRefreshAccount(token, false, true)
        }
        if (session_expire_time - dateNow <= 1000 * 60) {
          await AliUser.ApiSessionRefreshAccount(token, false, true)
        }
      } catch (err: any) {
        DebugLog.mSaveDanger('aRefreshAllUserToken', err)
      }
    }
  }

  static GetUserToken(user_id: string): ITokenInfo {
    if (user_id && UserTokenMap.has(user_id)) {
      const token = UserTokenMap.get(user_id)!
      const provider = getStoredTokenProvider(token)
      if (provider !== 'unknown' && token.tokenfrom !== provider) token.tokenfrom = provider
      return token
    }

    return {
      tokenfrom: 'unknown',
      access_token: '',
      refresh_token: '',

      session_expires_in: 0,
      open_api_token_type: '',
      open_api_access_token: '',
      open_api_refresh_token: '',
      open_api_expires_in: 0,

      expires_in: 0,
      token_type: '',
      user_id: '',
      user_name: '',
      avatar: '',
      nick_name: '',
      default_drive_id: '',
      default_sbox_drive_id: '',
      resource_drive_id: '',
      backup_drive_id: '',
      sbox_drive_id: '',
      role: '',
      status: '',
      expire_time: '',
      state: '',
      pin_setup: false,
      is_first_login: false,
      need_rp_verify: false,
      name: '',
      spu_id: '',
      is_expires: false,
      used_size: 0,
      total_size: 0,
      free_size: 0,
      space_expire: false,
      spaceinfo: '',
      vipname: '',
      vipexpire: '',
      vipIcon: '',
      pic_drive_id: '',
      device_id: '',
      signature: '',
      signInfo: {
        signMon: -1,
        signDay: -1
      }
    }
  }

  static async GetUserTokenFromDB(user_id: string) {
    if (!user_id) return undefined
    if (UserTokenMap.has(user_id)) return UserTokenMap.get(user_id)
    const user = await DB.getUser(user_id)
    if (user) UserTokenMap.set(user.user_id, user)
    return user
  }

  static async EnsureUserTokenReady(user_id: string, force = false): Promise<ITokenInfo | null> {
    if (!user_id) return null
    const token = UserTokenMap.get(user_id) || await this.GetUserTokenFromDB(user_id)
    return token ? this.ensureTokenReady(token, force) : null
  }


  static async ClearUserTokenMap() {
    UserTokenMap.clear()
  }

  static GetUserList() {
    const list: ITokenInfo[] = []
    // eslint-disable-next-line no-unused-vars
    for (const [_, token] of UserTokenMap) {
      list.push(token)
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }

  static async GetUserListFromDB(): Promise<ITokenInfo[]> {
    const list = await DB.getUserAll()
    for (const token of list) {
      if (token.user_id && !UserTokenMap.has(token.user_id)) {
        UserTokenMap.set(token.user_id, token)
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }


  static SaveUserToken(token: ITokenInfo) {
    if (token.user_id) {
      UserTokenMap.set(token.user_id, token)
      DB.saveUser(token)
        .then(() => {
          window.WinMsgToUpload({ cmd: 'ClearUserToken' })
          window.WinMsgToDownload({ cmd: 'ClearUserToken' })
          UserDAL.scheduleCliAccountSync()
        })
        .catch(() => {
        })
    }
  }


  static async UserLogin(token: ITokenInfo, isInteractive: boolean = false) {
    const loadingKey = 'userlogin_' + Date.now().toString()
    message.loading('加载用户信息中...', 0, loadingKey)
    const initialUserId = token.user_id
    if (initialUserId) {
      await DB.saveValueString('uiDefaultUser', initialUserId)
      useUserStore().userLogin(initialUserId)
      UserTokenMap.set(initialUserId, token)
    }
    const refreshAccountInfo = async () => {
      const sessionToken = await ensureProviderSession(token)
      if (sessionToken && sessionToken !== token) Object.assign(token, sessionToken)
      const quotaApplied = await applyProviderQuota(token)
      const accountInfoRefreshed = quotaApplied === undefined ? await refreshProviderAccountInfo(token) : undefined
      if (quotaApplied !== undefined || accountInfoRefreshed !== undefined) return
      if (isNonAliyunProvider(token)) return
      await Promise.all([
        AliUser.ApiUserInfo(token),
        AliUser.ApiUserDriveInfo(token),
        AliUser.ApiUserPic(token),
        AliUser.ApiUserVip(token),
        AliUser.ApiSessionRefreshAccount(token, false),
        AliUser.OpenApiTokenRefreshAccount(token, false),
        UserDAL.UserAutoSign(token)
      ])
    }
    if (isInteractive || !initialUserId) {
      await withStartupTimeout(refreshAccountInfo(), `账号 ${initialUserId || ''} 用户信息`)
    } else {
      void withStartupTimeout(refreshAccountInfo(), `后台刷新账号 ${initialUserId} 用户信息`)
        .then(() => UserDAL.SaveUserToken(token))
        .catch((err: any) => DebugLog.mSaveWarning('UserLogin refreshAccountInfo ' + initialUserId, err?.message || err))
    }
    if (token.user_id && token.user_id !== initialUserId) {
      if (initialUserId) {
        UserTokenMap.delete(initialUserId)
        await DB.deleteUser(initialUserId)
      }
      await DB.saveValueString('uiDefaultUser', token.user_id)
      useUserStore().userLogin(token.user_id)
    } else if (token.user_id) {
      useUserStore().userLogin(token.user_id)
    }
    UserDAL.SaveUserToken(token)
    window.WebUserToken({
      user_id: token.user_id,
      name: token.user_name,
      access_token: token.access_token,
      open_api_access_token: token.open_api_access_token,
      tokenfrom: token.tokenfrom,
      login: true
    })
    // 已保存账号优先进入网盘，目录和账号资料在后台补全，避免任一网盘阻塞启动。
    const loadPanData = UserDAL.LoadPanData(token)
    if (isInteractive) await loadPanData
    else void loadPanData.catch((err: any) => DebugLog.mSaveWarning('UserLogin LoadPanData ' + token.user_id, err?.message || err))
    if (isInteractive && token.tokenfrom !== 'unknown') captureProviderLogin(token.tokenfrom)
    // 刷新所有状态
    PanDAL.aReLoadQuickFile(token.user_id)
    useAppStore().resetTab(useSettingStore().uiDefaultTab || 'pan')
    useMyShareStore().$reset()
    useMyFollowingStore().$reset()
    useOtherFollowingStore().$reset()
    useFootStore().mSaveUserInfo(token)
    message.success('加载用户成功!', 2, loadingKey)
    if (isInteractive && token.user_id) {
      const label = token.nick_name || token.user_name || token.user_id
      promptAutoScanForUser(token.user_id, label).catch(() => { /* ignore */ })
    }
  }

  static async LoadPanData(token: ITokenInfo) {
    console.warn('LoadPanData....')
    const loadSingleRootDrive = async (reload: () => Promise<void>, provider = '') => {
      try {
        await loadInitialProviderRoot(shouldRetryInitialRootLoad(provider), reload)
      } finally {
        useFootStore().mSaveLoading('')
      }
    }
    if (isCloud123User(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadCloudDrive(token))
      return
    }
    if (isBaiduUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadBaiduDrive(token), 'baidu')
      return
    }
    if (isDrive115User(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadDrive115(token))
      return
    }
    if (isPikPakUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadPikPakDrive(token))
      return
    }
    if (isQuarkUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadQuarkDrive(token))
      return
    }
    if (isCloud139User(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadCloud139Drive(token), '139')
      return
    }
    if (isCloud189User(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadCloud189Drive(token))
      return
    }
    if (isGuangyaUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadGuangyaDrive(token))
      return
    }
    if (isDropboxUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadDropboxDrive(token))
      return
    }
    if (isOneDriveUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadOneDrive(token))
      return
    }
    if (isBoxUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadBoxDrive(token))
      return
    }
    if (isGoogleUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadGoogleDrive(token))
      return
    }
    if (isRemoteDriveUser(token)) {
      await loadSingleRootDrive(() => PanDAL.aReLoadWebDavDrive(token))
      return
    }
    const setting = useSettingStore()
    const backupDriveId = setting.securityHideBackupDrive ? '' : token.backup_drive_id
    const resourceDriveId = setting.securityHideResourceDrive ? '' : token.resource_drive_id
    const rootLoads: Promise<void>[] = []
    if (backupDriveId) rootLoads.push(PanDAL.aReLoadBackupDrive(token))
    if (resourceDriveId) rootLoads.push(PanDAL.aReLoadResourceDrive(token))
    await Promise.all(rootLoads)
    const initialRoot = selectInitialAliyunRoot(setting.uiShowPanRootFirst, backupDriveId, resourceDriveId)
    if (initialRoot.driveId) await PanDAL.aReLoadOneDirToShow(initialRoot.driveId, initialRoot.rootId, true)
  }

  static async UserLogOff(user_id: string): Promise<boolean> {
    await DB.deleteUser(user_id)
    UserTokenMap.delete(user_id)

    let newUserID = ''
    for (const [user_id] of UserTokenMap) {
      const token = await this.EnsureUserTokenReady(user_id)
      if (token) {
        await this.UserLogin(token)
        newUserID = user_id
        break
      }
    }
    if (!newUserID) {
      useUserStore().userLogOff()
      usePanTreeStore().$reset()
      usePanFileStore().$reset()
      useUserStore().userShowLogin = true
    }
    return newUserID != ''
  }

  static async UserClearFromDB(user_id: string): Promise<void> {
    DB.deleteUser(user_id)
    UserTokenMap.delete(user_id)
  }


  static async UserChange(user_id: string): Promise<boolean> {
    const token = await this.EnsureUserTokenReady(user_id)
    if (!token) {
      message.warning('该账号需要重新登陆[' + (UserTokenMap.get(user_id)?.name || user_id) + ']')
      return false
    }
    await this.UserLogin(token).catch()
    return true
  }


  static async UserRefreshByUserFace(user_id: string, force: boolean): Promise<boolean> {
    const token = UserDAL.GetUserToken(user_id)
    if (!token || !token.access_token) {
      return false
    }
    const expiresIn = new Date(token.expire_time).getTime() - token.expires_in * 1000
    const time = Date.now() - expiresIn
    const refreshProviderInfo = async () => {
      const quotaApplied = await applyProviderQuota(token)
      if (quotaApplied !== undefined) return
      const accountInfoRefreshed = await refreshProviderAccountInfo(token)
      if (accountInfoRefreshed !== undefined) return
      if (isNonAliyunProvider(token)) return
      await Promise.all([
        AliUser.ApiUserInfo(token),
        AliUser.ApiUserPic(token),
        AliUser.ApiUserVip(token)
      ])
    }
    if (!force || time / 1000 < 600) {
      await refreshProviderInfo()
      UserDAL.SaveUserToken(token)
      return true
    }
    if (!token.user_id) return false
    const providerToken = await ensureProviderAccessToken(token, true)
    if (providerToken !== undefined) {
      if (!providerToken) return false
      Object.assign(token, providerToken)
    }
    const sessionToken = await ensureProviderSession(token, true)
    if (sessionToken !== undefined) {
      if (!sessionToken) return false
      Object.assign(token, sessionToken)
    }
    if (providerToken === undefined && sessionToken === undefined && !isNonAliyunProvider(token)) {
      const isToken = await AliUser.ApiTokenRefreshAccount(token, true)
      if (!isToken) return false
      await AliUser.ApiSessionRefreshAccount(token, true)
      await AliUser.OpenApiTokenRefreshAccount(token, true)
    }
    await refreshProviderInfo()
    useUserStore().userLogin(token.user_id)
    UserDAL.SaveUserToken(token)
    return true
  }

  static async UserAutoSign(token: ITokenInfo) {
    // 自动签到
    if (!supportsAliyunAutoSign(token)) {
      UserDAL.SaveUserToken(token)
      return
    }
    if (token.user_id && useSettingStore().uiLaunchAutoSign) {
      const nowMonth = new Date().getMonth() + 1
      const nowDay = new Date().getDate()
      if (!token.signInfo) token.signInfo = { signMon: -1, signDay: -1 }
      const signInfo = token.signInfo
      if (signInfo.signMon !== nowMonth || signInfo.signDay !== nowDay) {
        const signDay = await AliUser.ApiUserSign(token)
        if (signDay) {
          signInfo.signMon = nowMonth
          signInfo.signDay = signDay
        }
      }
    }
    UserDAL.SaveUserToken(token)
  }
}
