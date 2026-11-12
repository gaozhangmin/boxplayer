import {usePanTreeStore,useSettingStore,message,supportsSearch,isAliyunUser,PanDAL,getDrivePane} from '../../../ports'
import {t} from '../../../../electron/i18n'
const modalSearchPan=(range:string[])=>getDrivePane().action('advancedSearch',[range])
export async function topSearchAll(word: string, inputsearchType: string[]) {
  if (!word) return
  if (word == 'topSearchAll高级搜索') {
    modalSearchPan(inputsearchType)
    return
  }
  const pantreeStore = usePanTreeStore()
  if (!pantreeStore.user_id || !inputsearchType || !pantreeStore.selectDir.file_id) {
    message.error('搜索失败 父文件夹错误')
    return
  }
  if (!supportsSearch(pantreeStore.user_id, pantreeStore.drive_id)) {
    const provider = getDrivePane().account?.name || '此来源'
    message.warning(t('pan.unsupportedFeature', { provider }))
    return
  }
  if (!isAliyunUser(pantreeStore.user_id)) {
    const keyword = word.trim()
    if (!keyword) {
      message.error('搜索失败 搜索关键字不能为空')
      return
    }
    const searchid = 'search' + keyword
    await PanDAL.aReLoadOneDirToShow('', searchid, false)
    return
  }
  if (inputsearchType.length > 0) {
    if (useSettingStore().securityHideBackupDrive) {
      inputsearchType = inputsearchType.filter((t) => t != 'backup')
    }
    if (useSettingStore().securityHideResourceDrive) {
      inputsearchType = inputsearchType.filter((t) => t != 'resource')
    }
    if (useSettingStore().securityHidePicDrive) {
      inputsearchType = inputsearchType.filter((t) => t != 'pic')
    }
    word += ' range:' + inputsearchType.join(',') + ' '
  } else {
    message.error('搜索失败 搜索范围不能为空')
    return
  }
  const searchid = 'search' + word
  await PanDAL.aReLoadOneDirToShow('', searchid, false)
}
