import is from 'electron-is'
import { ShowErrorAndExit } from './dialog'
import { app } from 'electron'

export default class exception {
  private constructor() {

  }

  static handler() {
    if (is.dev()) {
      return
    }
    process.on('unhandledRejection', (reason, p) => {
      console.log('Unhandled Rejection at:', p, 'reason:', reason)
    })
    process.on('uncaughtException', (err) => {
      console.error('[main] uncaught exception:', err)
      let { message, stack = '' } = err
      if (app.isReady()) {
        ShowErrorAndExit('发生未定义的异常', err.message + '\n' + stack)
      }
    })
  }
}
