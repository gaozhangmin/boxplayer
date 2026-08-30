/* eslint-disable no-unused-vars */
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production'
    readonly VITE_DEV_SERVER_HOST: string
    readonly VITE_DEV_SERVER_PORT: string
  }
}
declare interface Window {
  Electron: any
  platform: any
  WebIsE2E: boolean
  WebE2EAllowTransfers: boolean
  WebGetPathForFile: (file: File) => string
  WinMsg: any
  WebToElectron: any
  WebToWindow: any
  WebToElectronCB: any
  WebSpawnSync: any
  WebExecSync: any
  WebShowOpenDialogSync: any
  WebShowOpenDialog: (config: Electron.OpenDialogOptions) => Promise<string[]>
  WebShowSaveDialogSync: any
  WebShowItemInFolder: any
  WebPlatformSync: any
  WebClearCookies: any
  WebClearCache: any
  WebUserToken: any
  WebSaveTheme: any
  WebReload: any
  WebRelaunch: any
  WebRelaunchAria: () => Promise<number>
  AutoUpdateGetState: () => Promise<any>
  AutoUpdateCheck: (force?: boolean) => Promise<any>
  AutoUpdateInstall: () => Promise<boolean>
  AutoUpdateOnStateChanged: (callback: (state: any) => void) => () => void
  WebSetProgressBar: any
  WebGetCookies: any
  WebQuarkAccountInfo: any
  WebQuarkFileList: any
  WebQuarkDownloadUrl: any
  WebSetCookies: any
  WebOpenWindow: any
  onExternalFileOpen: (callback: (payload: { filePath: string; fileUrl: string }) => void) => void
  WebOpenLyric: any
  WebSendLyric: any
  WebCloseLyric: any
  WebConfigureGlobalHotkeys: any
  WebOnGlobalHotkey: any
  WebOpenUrl: any
  WebShutDown: any
  WebSetProxy: any
  WebMpvEmbeddedCapability: () => Promise<any>
  WebMpvEmbeddedLoad: (data: any) => Promise<any>
  WebMpvEmbeddedControl: (data: any) => Promise<any>
  WebMpvEmbeddedStatus: () => Promise<any>
  WebMpvSharedTextureCapability: () => { available: boolean; platform: string; reason?: string }
  WebMpvSharedTexture: {
    isAvailable: () => boolean
    onFrame: (callback: (videoFrame: VideoFrame, index: number) => void) => void
    removeFrameListener: () => void
    onClear: (callback: () => void) => void
    removeClearListener: () => void
  }
  MsImageCacheSyncConfig: any
  MsImageCacheStats: () => Promise<{ totalBytes: number; servers: unknown[] }>
  MsImageCacheClear: (serverId?: string) => Promise<{ cleared: number }>
  TvBoxInvoke: (channel: string, data?: unknown) => Promise<unknown>
  IsMainPage: boolean
  onExternalDownloadOpen: (callback: (payload: string) => void) => void
}
