import DebugLog from '../utils/debuglog'
import { onHideRightMenu } from '../utils/keyboardhelper'
import { defineStore } from 'pinia'
import { IAliGetFileModel } from '../aliapi/alimodels'

export interface IPageOffice {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  preview_url: string
  access_token: string
}

export interface IPagePdf {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  preview_url: string
}

export interface IPageEpub {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  preview_url: string
}

export interface IPageDocx {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  preview_url: string
}

export interface IPageSheet {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  preview_url: string
}

export interface IPageCode {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  file_size: number
  code_ext: string
  encType: string
  password: string
}

export interface IPageImage {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
  mode: string
  password: string
  imageList: IAliGetFileModel[]
}

export interface IPageVideoXBT {
  user_id: string
  drive_id: string
  file_id: string
  file_name: string
}

export interface IPageVideoPlaylistEntry {
  user_id: string
  tokenfrom?: string
  drive_id: string
  file_id: string
  parent_file_id: string
  file_name: string
  html: string
  ext?: string
  description?: string
  play_cursor?: number
  password?: string
  encType?: string
}

export interface IPageVideoSubtitleFile {
  file_id: string
  name: string
  parent_file_id: string
  drive_id: string
  user_id?: string
  ext?: string
}

export interface IPageVideo {
  user_id: string
  tokenfrom?: string
  drive_id: string
  file_id: string
  parent_file_id: string
  parent_file_name: string
  file_name: string
  html: string
  encType: string
  password: string
  expire_time: number
  play_cursor: number
  play_esposide?: number
  media_url?: string
  media_headers?: Record<string, string>
  media_subtitle_sources?: Array<{ url: string, title?: string, streamIndex?: number }>
  media_server_tracks_selectable?: boolean
  media_server_id?: string
  media_server_item_id?: string
  media_server_source_id?: string
  media_server_source_label?: string
  media_server_play_session_id?: string
  media_server_source_options?: Array<{ id: string, label: string, subLabel?: string }>
  media_server_video_label?: string
  media_server_audio_label?: string
  media_server_subtitle_label?: string
  media_server_video_options?: Array<{ streamIndex: number, label: string }>
  media_server_audio_options?: Array<{ streamIndex: number, label: string }>
  media_server_subtitle_options?: Array<{ streamIndex: number, label: string }>
  media_server_playlist_label?: string
  media_server_episode_playlist?: Array<{ id: string, title: string }>
  media_server_chapters?: Array<{ start: number, end: number, title: string }>
  custom_playlist_label?: string
  custom_playlist?: IPageVideoPlaylistEntry[]
  library_subtitle_files?: IPageVideoSubtitleFile[]
}

export interface IPageMusicTrack {
  user_id: string
  tokenfrom?: string
  drive_id: string
  file_id: string
  parent_file_id: string
  file_name: string
  ext?: string
  size?: number
  category?: string
  icon?: string
  thumbnail?: string
  description?: string
  duration_ms?: number
  encType?: string
  password?: string
  local_url?: string
  media_server_id?: string
  media_server_item_id?: string
  media_server_source_id?: string
}

export interface IPageMusic {
  user_id: string
  tokenfrom?: string
  drive_id: string
  file_id: string
  parent_file_id: string
  parent_file_name: string
  file_name: string
  encType: string
  password: string
  playlist: IPageMusicTrack[]
}

export interface AppState {
  appTheme: string

  appPage: string

  appTab: string

  appTabMenuMap: Map<string, string>
  appDark: boolean
  appShutDown: boolean


  pageOffice?: IPageOffice
  pagePdf?: IPagePdf
  pageEpub?: IPageEpub
  pageDocx?: IPageDocx
  pageSheet?: IPageSheet
  pageCode?: IPageCode
  pageImage?: IPageImage
  pageVideoXBT?: IPageVideoXBT
  pageVideo?: IPageVideo
  pageMusic?: IPageMusic
}

const useAppStore = defineStore('app', {
  state: (): AppState => ({
    appTheme: 'light',
    appPage: 'PageLoading',
    appTab: 'pan',
    appTabMenuMap: new Map<string, string>([
      ['pan', 'wangpan'],
      ['down', 'DowningRight'],
      ['share', 'ShareSiteRight'],
      ['rss', 'RssXiMa'],
      ['media', 'MediaLibrary'],
      ['media-server', 'MediaServerWorkspace'],
      ['music', 'MusicLibrary'],
      ['book', 'BookLibrary'],
      ['setting', 'SettingUI']
    ]),
    appDark: false,
    appShutDown: false
  }),

  getters: {
    GetAppTabMenu(state: AppState): string {
      return state.appTabMenuMap.get(state.appTab)!
    }
  },

  actions: {
    updateStore(partial: Partial<AppState>) {
      this.$patch(partial)
    },

    toggleTheme(theme: string) {
      // console.log('toggleTheme', theme, this)
      this.appTheme = theme
      if (this.appTheme == 'dark' || (this.appTheme == 'system' && this.appDark)) {
        document.body.setAttribute('arco-theme', 'dark')
      } else {
        document.body.removeAttribute('arco-theme')
      }
    },

    toggleDark(dark: boolean) {
      console.log('toggleDark', dark, this)
      this.appDark = dark
      if (this.appTheme == 'dark' || (this.appTheme == 'system' && dark)) {
        document.body.setAttribute('arco-theme', 'dark')
      } else {
        document.body.removeAttribute('arco-theme')
      }
    },

    togglePage(page: string) {
      if (page == this.appPage) return
      this.appPage = page
    },
    resetTab(defaultTab = 'pan') {
      this.$patch({
        appTab: defaultTab,
        appTabMenuMap: new Map<string, string>([
          ['pan', 'wangpan'],
          ['down', 'DowningRight'],
          ['share', 'ShareSiteRight'],
          ['rss', 'RssXiMa'],
          ['media', 'MediaLibrary'],
          ['media-server', 'MediaServerWorkspace'],
          ['music', 'MusicLibrary'],
          ['book', 'BookLibrary'],
          ['setting', 'SettingUI']
        ])
      })
    },

    toggleTab(tab: string) {
      if (this.appTab != tab) {
        this.appTab = tab
        if (tab == 'setting') DebugLog.aLoadFromDB()
        onHideRightMenu()
      }
    },

    toggleTabMenu(tab: string, menu: string) {
      if (this.appTab != tab) {
        this.appTab = tab
        if (tab == 'setting') DebugLog.aLoadFromDB()
      }
      this.appTabMenuMap.set(tab, menu)
      if (tab == 'setting') document.getElementById(menu)?.scrollIntoView()
      onHideRightMenu()
    },

    toggleTabSetting(tab: string, menu: string) {
      if (tab == this.appTab && this.appTabMenuMap.get(tab) == menu) return
      if (this.appTab != tab) {
        this.appTab = tab
      }
      if (menu) {
        this.appTabMenuMap.set(tab, menu)
      }
    },

    toggleTabNext() {
      switch (this.appTab) {
        case 'pan': {
          this.appTab = 'down'
          break
        }
        case 'down': {
          this.appTab = 'share'
          break
        }
        case 'share': {
          this.appTab = 'rss'
          break
        }
        case 'rss': {
          this.appTab = 'media'
          break
        }
        case 'media': {
          this.appTab = 'media-server'
          break
        }
        case 'media-server': {
          this.appTab = 'music'
          break
        }
        case 'music': {
          this.appTab = 'book'
          break
        }
        case 'book': {
          this.appTab = 'setting'
          DebugLog.aLoadFromDB()
          break
        }
        case 'setting': {
          this.appTab = 'pan'
          break
        }
      }
      onHideRightMenu()
    },

    toggleTabNextMenu() {
      const next = function(map: Map<string, string>, tab: string, menuList: string[]) {
        const menu = map.get(tab)!
        for (let i = 0, maxi = menuList.length; i < maxi; i++) {
          if (menuList[i] == menu) {
            if (i + 1 >= menuList.length) map.set(tab, menuList[0])
            else map.set(tab, menuList[i + 1])
          }
        }
      }

      switch (this.appTab) {
        case 'pan': {
          next(this.appTabMenuMap, this.appTab, ['wangpan', 'kuaijie'])
          break
        }
        case 'down': {
          next(this.appTabMenuMap, this.appTab, ['DowningRight', 'DownedRight', 'UploadingRight', 'UploadedRight', 'SyncRight'])
          break
        }
        case 'share': {
          next(this.appTabMenuMap, this.appTab, ['ShareSiteRight', 'OtherShareRight', 'MyShareRight', 'ShareHistoryRight', 'MyTransferShareRight', 'ShareBottleFishRight', 'MyFollowingRight', 'OtherFollowingRight'])
          break
        }
        case 'rss': {
          next(this.appTabMenuMap, this.appTab, ['RssXiMa', 'RssJiaMi', 'RssEmptyDirs', 'AppSame', 'RssScanClean', 'RssScanSame', 'RssScanPunish', 'RssScanEnmpty', 'RssDriveCopy'])
          break
        }
        case 'setting': {
          next(this.appTabMenuMap, this.appTab, ['SettingUI', 'SettingAccount', 'SettingSecurity', 'SettingPlay', 'SettingPan', 'SettingDown', 'SettingUpload', 'SettingDebug', 'SettingProxy', 'SettingAria', 'SettingDownloadAdvanced', 'SettingAPI', 'SettingLog'])
          const menu = this.appTabMenuMap.get('setting')!
          document.getElementById(menu)?.scrollIntoView()
          break
        }
      }

      onHideRightMenu()
    }
  }
})

export default useAppStore
