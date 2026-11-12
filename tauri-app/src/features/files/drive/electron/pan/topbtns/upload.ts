import {usePanTreeStore,usePanFileStore,useSettingStore,message,supportsLocalUpload,modalUpload,modalPassword} from '../../../ports'
import {showTransferFileDialog} from '../../../transferEntry'
export function handleUpload(uploadType: string, encType: string = '') {
  const pantreeStore = usePanTreeStore()
  const panfileStore = usePanFileStore()
  const currentDirId = panfileStore.DirID || pantreeStore.selectDir.file_id
  if (!pantreeStore.user_id || !pantreeStore.drive_id || !currentDirId) {
    message.error('上传操作失败 父文件夹错误')
    return
  }
  if (!supportsLocalUpload(pantreeStore.user_id, pantreeStore.drive_id)) {
    message.warning('当前网盘为只读，不能上传文件')
    return
  }
  if (encType == 'xbyEncrypt1') {
    if (!useSettingStore().securityPassword) {
      modalPassword('new', (success) => {
        success && handleUpload(uploadType, encType)
      })
      return
    }
  }
  if (uploadType == 'file') {
    showTransferFileDialog({
      title: '选择多个文件上传到网盘',
      buttonLabel: `${encType == 'xbyEncrypt1' ? '加密' : encType == 'xbyEncrypt2' ? '私密' : ''}上传选中的文件`,
      properties: ['openFile', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
    }, (files: string[] | undefined) => {
      if (files && files.length > 0) {
        return modalUpload(currentDirId, files, false, encType)
      }
    })
  } else if (uploadType == 'folder') {
    showTransferFileDialog({
      title: '选择多个文件夹上传到网盘',
      buttonLabel: `${encType == 'xbyEncrypt1' ? '加密' : encType == 'xbyEncrypt2' ? '私密' : ''}上传文件夹`,
      properties: ['openDirectory', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
    }, (files: string[] | undefined) => {
      if (files && files.length > 0) {
        return modalUpload(currentDirId, files, false, encType)
      }
    })
  } else if (uploadType == 'pic_file') {
    showTransferFileDialog({
      title: '选择多个照片/视频上传到网盘',
      buttonLabel: '上传选中的照片/视频',
      filters: [
        { name: 'Images', extensions: ['jfif', 'pjpeg', 'pjp', 'jpg', 'jpeg', 'png', 'heic', 'gif', '3gp'] },
        { name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'mpg', 'mpeg', 'm4v', 'webm', 'wmv'] }
      ],
      properties: ['openFile', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
    }, (files: string[] | undefined) => {
      if (files && files.length > 0) {
        return modalUpload('pic_root', files, true, encType)
      }
    })
  }
}
