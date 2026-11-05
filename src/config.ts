import { BOXPLAYER_AI_API_URL, BOXPLAYER_API_URL } from './secrets.generated'

import { BOXPLAYER_API_ORIGIN } from '@shared/boxplayerApi'

export default class Config {
  // BoxPlayer Cloud AI API
  static BOXPLAYER_AI_API_URL = BOXPLAYER_AI_API_URL || BOXPLAYER_API_ORIGIN
  // Resource and AI routes share the unified Worker; explicit build overrides remain independent.
  static BOXPLAYER_API_URL = BOXPLAYER_API_URL || BOXPLAYER_API_ORIGIN

  // 网络请求配置
  static referer = 'https://www.aliyundrive.com/drive'
  static downAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4577.63 Safari/537.36'
  static userAgent = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) aDrive/4.12.0 Chrome/108.0.5359.215 Electron/22.3.24 Safari/537.36'
  static loginUrl = 'https://auth.aliyundrive.com/v2/oauth/authorize?login_type=custom&response_type=code&redirect_uri=https%3A%2F%2Fwww.aliyundrive.com%2Fsign%2Fcallback&client_id=25dzX3vbYqktVxyX&state=%7B%22origin%22%3A%22https%3A%2F%2Fwww.aliyundrive.com%2F%22%7D'
  static loginUrlAccount = 'https://passport.aliyundrive.com/mini_login.htm?lang=zh_cn&appName=aliyun_drive&appEntrance=web&styleType=auto&bizParams=&notLoadSsoView=false&notKeepLogin=false&isMobile=false&&rnd=0.1100330129139'
}
