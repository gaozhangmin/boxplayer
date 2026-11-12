export interface IStateDownFile {
  DownID: string
  Info: IStateDownInfo

  Down: {
    DownState: string
    DownTime: number
    DownSize: number
    DownSpeed: number
    DownSpeedStr: string
    DownProcess: number
    IsStop: boolean
    IsDowning: boolean
    IsCompleted: boolean
    IsFailed: boolean
    FailedCode: number
    FailedMessage: string

    AutoTry: number

    DownUrl: string
  }
}

export interface IStateDownInfo {

  GID: string
  user_id: string

  DownSavePath: string
  ariaRemote: boolean

  file_id: string
  drive_id: string

  name: string
  cloudPath?: string

  size: number
  sizestr: string
  icon: string
  isDir: boolean
  encType: string

  sha1: string

  crc64: string

  localFilePath?: string
  downloadHeaders?: Record<string, string>
  externalHeaders?: string[]
  referer?: string
  userAgent?: string
  allProxy?: string
  sourceType?: 'url' | 'magnet' | 'torrent' | 'torrent-url'
  torrentBase64?: string
  torrentUrl?: string
  selectFile?: string
  split?: number
  offlineProvider?: 'cloud123' | 'pikpak' | 'guangya' | 'drive115' | 'dropbox'
  offlineTaskId?: string
  offlineDirId?: string
}
