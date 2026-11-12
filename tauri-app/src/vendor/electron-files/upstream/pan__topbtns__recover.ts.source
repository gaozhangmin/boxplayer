import { IAliGetFileModel } from '../../aliapi/alimodels'
import AliFile from '../../aliapi/file'
import AliFileCmd from '../../aliapi/filecmd'
import { handleFilesDeleted } from '../../utils/libraryDeleteHooks'
import { IAliFileResp, NewIAliFileResp } from '../../aliapi/dirfilelist'
import AliTrash from '../../aliapi/trash'
import { IPageVideoXBT } from '../../store/appstore'
import DebugLog from '../../utils/debuglog'
import message from '../../utils/message'
import {
  modalCopyFileTree,
  modalCreatNewShareLink,
  modalDLNAPlayer,
  modalDownload,
  modalM3U8Download,
  modalMoveToAlbum,
  modalPassword,
  modalSearchPan,
  modalSelectPanDir,
  modalUpload
} from '../../utils/modal'
import { ArrayKeyList } from '../../utils/utils'
import PanDAL from '../pandal'
import usePanTreeStore from '../pantreestore'
import usePanFileStore from '../panfilestore'
import { useDowningStore, useSettingStore } from '../../store'
import { Sleep } from '../../utils/format'
import TreeStore from '../../store/treestore'
import { copyToClipboard } from '../../utils/electronhelper'
import DownDAL from '../../down/DownDAL'
import { isEmpty } from 'lodash'
import { GetDriveID, isAliyunUser, isBoxUser, isCloud123User, isDrive115User, isDropboxUser, isPikPakUser } from '../../aliapi/utils'
import AliAlbum from '../../aliapi/album'
import { getEncType } from '../../utils/proxyhelper'
import { supportsCopy, supportsCreateShare, supportsLocalUpload, supportsMove, supportsSearch, supportsTrashMove, supportsTrashPermanentDelete } from '../../drive/providerFeatures'
import { getDriveProviderLabel } from '../../utils/driveProvider'
import UserDAL from '../../user/userdal'
import { t } from '../../i18n'
import { Modal, Option, Select } from '@arco-design/web-vue'
import { h } from 'vue'
import { apiCloud123TrashDeleteAll } from '../../cloud123/filecmd'
import { apiDrive115TrashClear } from '../../cloud115/trash'
import { apiDrive115VideoPush, getDrive115PickCode } from '../../cloud115/video'
import { apiPikPakFileList } from '../../pikpak/dirfilelist'
import { apiPikPakTrashDelete } from '../../pikpak/filecmd'
import { apiBoxTrashListPage, apiBoxTrashPurge } from '../../box/filecmd'
import { apiBoxCreateZip, apiBoxWaitZip } from '../../box/zip'
import { apiDropboxZipDownload } from '../../dropbox/zip'

const topbtnLock = new Set()


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
    window.WebShowOpenDialogSync({
      title: '选择多个文件上传到网盘',
      buttonLabel: `${encType == 'xbyEncrypt1' ? '加密' : encType == 'xbyEncrypt2' ? '私密' : ''}上传选中的文件`,
      properties: ['openFile', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
    }, (files: string[] | undefined) => {
      if (files && files.length > 0) {
        modalUpload(currentDirId, files, false, encType)
      }
    })
  } else if (uploadType == 'folder') {
    window.WebShowOpenDialogSync({
      title: '选择多个文件夹上传到网盘',
      buttonLabel: `${encType == 'xbyEncrypt1' ? '加密' : encType == 'xbyEncrypt2' ? '私密' : ''}上传文件夹`,
      properties: ['openDirectory', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
    }, (files: string[] | undefined) => {
      if (files && files.length > 0) {
        modalUpload(currentDirId, files, false, encType)
      }
    })
  } else if (uploadType == 'pic_file') {
    window.WebShowOpenDialogSync({
      title: '选择多个照片/视频上传到网盘',
      buttonLabel: '上传选中的照片/视频',
      filters: [
        { name: 'Images', extensions: ['jfif', 'pjpeg', 'pjp', 'jpg', 'jpeg', 'png', 'heic', 'gif', '3gp'] },
        { name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'mpg', 'mpeg', 'm4v', 'webm', 'wmv'] }
      ],
      properties: ['openFile', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
    }, (files: string[] | undefined) => {
      if (files && files.length > 0) {
        modalUpload('pic_root', files, true, encType)
      }
    })
  }
}


export async function menuDownload(istree: boolean, tips: boolean = true) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isError) {
    message.error('下载操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以下载的文件')
    return
  }
  const settingStore = useSettingStore()
  const panTreeStore = usePanTreeStore()
  const savePath = settingStore.AriaIsLocal ? settingStore.downSavePath : settingStore.ariaSavePath
  const savePathFull = settingStore.downSavePathFull
  const downSavePathDefault = settingStore.downSavePathDefault
  if (isEmpty(savePath)) {
    message.error('未设置保存路径')
    modalDownload(istree)
    return
  }
  if (topbtnLock.has('menuDownload')) return
  topbtnLock.add('menuDownload')
  let files: IAliGetFileModel[] = []
  if (istree) {
    files = [{
      ...panTreeStore.selectDir,
      isDir: true,
      ext: '',
      mime_extension: '',
      mime_type: '',
      category: '',
      icon: '',
      sizeStr: '',
      timeStr: '',
      starred: false,
      thumbnail: ''
    }]
  } else {
    files = usePanFileStore().GetSelected()
  }
  try {
    if (downSavePathDefault || !tips) {
      if ((isBoxUser(selectedData.user_id) || selectedData.drive_id === 'box') && (files.length > 1 || files.some(file => file.isDir))) {
        const zipItems = files.map(file => ({ id: file.file_id, type: file.isDir ? 'folder' as const : 'file' as const }))
        const zipName = (files.length === 1 ? files[0].name : 'Box 下载') || 'Box 下载'
        const created = await apiBoxCreateZip(selectedData.user_id, zipItems, zipName)
        if (created.error || !created.data) throw new Error(created.error || '创建 Box ZIP 下载失败')
        const ready = await apiBoxWaitZip(selectedData.user_id, created.data)
        if (ready.error || !ready.url) throw new Error(ready.error || 'Box ZIP 下载失败')
        DownDAL.aAddUrlDownload({ user_id: selectedData.user_id, drive_id: 'box', file_id: `zip:${Date.now()}`, url: ready.url, headers: ready.headers, savePath, fileName: `${zipName}.zip`, icon: 'iconfile-zip' })
      } else if ((isDropboxUser(selectedData.user_id) || selectedData.drive_id === 'dropbox') && files.length === 1 && files[0].isDir) {
        const zip = await apiDropboxZipDownload(selectedData.user_id, files[0].file_id)
        if (zip.error) throw new Error(zip.error)
        DownDAL.aAddUrlDownload({ user_id: selectedData.user_id, drive_id: 'dropbox', file_id: `zip:${files[0].file_id}`, url: zip.url, headers: zip.headers, savePath, fileName: `${files[0].name || 'Dropbox'}.zip`, icon: 'iconfile-zip' })
      } else {
        await DownDAL.aAddDownload(files, savePath, savePathFull)
      }
      if (useDowningStore().ListDataRaw.length > 0) {
        message.success(`成功创建下载任务`)
      }
    } else {
      modalDownload(istree)
    }
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('menuDownload', err)
  }
  topbtnLock.delete('menuDownload')
}

export async function menuFavSelectFile(istree: boolean, isFavor: boolean) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isError) {
    message.error('收藏操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以收藏的文件')
    return
  }

  if (topbtnLock.has('menuFavSelectFile')) return
  topbtnLock.add('menuFavSelectFile')
  try {
    const successList = await AliFileCmd.ApiFavorBatch(selectedData.user_id, selectedData.drive_id, isFavor, true, selectedData.selectedKeys)
    if (isFavor) {

      if (usePanTreeStore().selectDir.file_id == 'favorite') {
        PanDAL.aReLoadOneDirToShow('', 'refresh', false)
      } else {
        usePanFileStore().mFavorFiles(isFavor, successList)
      }
    } else {

      if (usePanTreeStore().selectDir.file_id == 'favorite') {
        usePanFileStore().mDeleteFiles('favorite', successList, false)
      } else {
        usePanFileStore().mFavorFiles(isFavor, successList)
      }
    }
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('menuFavSelectFile', err)
  }
  topbtnLock.delete('menuFavSelectFile')
}


export async function menuTrashSelectFile(istree: boolean, isDelete: boolean, ispic: boolean = false) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isError) {
    message.error('删除操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以删除的文件')
    return
  }
  if (!ispic && !(isDelete ? supportsTrashPermanentDelete(selectedData.user_id, selectedData.drive_id) : supportsTrashMove(selectedData.user_id, selectedData.drive_id))) {
    message.warning('当前网盘为只读，不能删除文件')
    return
  }
  if (selectedData.dirID.startsWith('video')) {
    message.error('请不要在放映室里删除文件')
    return
  }
  console.log('selectedData', selectedData)
  if (topbtnLock.has('menuTrashSelectFile')) return
  topbtnLock.add('menuTrashSelectFile')
  try {
    let successList: string[] = []
    if (ispic) {
      if (!isDelete) {
        const drive_file_list: { drive_id: string, file_id: string }[] = []
        selectedData.selectedKeys.forEach(key => {
          drive_file_list.push({
            drive_id: selectedData.drive_id,
            file_id: key
          })
        })
        let data = await AliAlbum.ApiAlbumDeleteFiles(selectedData.user_id, selectedData.dirID, drive_file_list)
        if (data) {
          message.success('移出相册成功')
        } else {
          message.error('移出相册失败')
        }
      } else {
        let result = []
        for (const album_id of selectedData.selectedKeys) {
          let res = await AliAlbum.ApiAlbumDelete(selectedData.user_id, album_id)
          result.push(res)
        }
        if (result.length > 0) {
          message.success('删除相册成功')
        } else {
          message.error('删除相册失败')
        }
      }
    } else {
      if (isDelete) {
        successList = await AliFileCmd.ApiDeleteBatch(selectedData.user_id, selectedData.drive_id, selectedData.selectedKeys)
      } else {
        successList = await AliFileCmd.ApiTrashBatch(selectedData.user_id, selectedData.drive_id, selectedData.selectedKeys)
      }
    }

    if (istree) {
      await PanDAL.aReLoadOneDirToShow(selectedData.drive_id, selectedData.parentDirID, false)
    } else {
      usePanFileStore().mDeleteFiles(selectedData.dirID, successList, selectedData.dirID !== 'trash')
      if (selectedData.dirID !== 'trash') {
        await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, selectedData.dirID, selectedData.albumId)
        TreeStore.ClearDirSize(selectedData.drive_id, selectedData.selectedParentKeys)
      }
    }
    if (!ispic && successList && successList.length > 0) {
      handleFilesDeleted(selectedData.user_id, selectedData.drive_id, successList).catch(() => { /* ignore */ })
    }
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('menuTrashSelectFile', err)
  }
  topbtnLock.delete('menuTrashSelectFile')
}

export async function menuAddAlbumSelectFile() {
  const selectedData = PanDAL.GetPanSelectedData(false)
  if (selectedData.isErrorSelected) return
  if (selectedData.isError) {
    message.error('添加到相册操作失败 父文件夹错误')
    return
  }
  const selectedFiles = usePanFileStore().GetSelected()
  if (selectedFiles.length == 0) {
    message.error('没有可以添加到相册的文件！')
    return
  }
  modalMoveToAlbum()
}

export async function topRestoreSelectedFile() {
  const selectedData = PanDAL.GetPanSelectedData(false)
  if (selectedData.isError) {
    message.error('还原文件操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以还原的文件')
    return
  }

  const panfileStore = usePanFileStore()
  const diridList: string[] = []
  panfileStore
    .GetSelected()
    .filter((t) => t.isDir)
    .map((t) => diridList.push(t.file_id))

  if (topbtnLock.has('topRestoreSelectedFile')) return
  topbtnLock.add('topRestoreSelectedFile')
  try {
    await AliFileCmd.ApiTrashRestoreBatch(selectedData.user_id, selectedData.drive_id, true, selectedData.selectedKeys)
    if (usePanTreeStore().selectDir.file_id == 'trash') {

      usePanFileStore().mDeleteFiles('trash', selectedData.selectedKeys, false)
    } else {

      PanDAL.aReLoadOneDirToShow('', 'refresh', false)
    }
    await Sleep(2000)
    const dirList = await AliFileCmd.ApiGetFileBatch(selectedData.user_id, selectedData.drive_id, diridList)
    console.log(diridList, dirList)

    const pset = new Set<string>()
    for (let i = 0, maxi = dirList.length; i < maxi; i++) {
      let parent_file_id = dirList[i].parent_file_id
      if (parent_file_id.includes('root')) parent_file_id = 'root'
      if (pset.has(parent_file_id)) continue
      pset.add(parent_file_id)
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, parent_file_id)
    }
    TreeStore.ClearDirSize(selectedData.drive_id, Array.from(pset))
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('topRestoreSelectedFile', err)
  }
  topbtnLock.delete('topRestoreSelectedFile')
}


export function menuCopySelectedFile(istree: boolean, copyby: string) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isError) {
    message.error('复制移动操作失败 父文件夹错误')
    return
  }
  const isSupported = copyby === 'copy'
    ? supportsCopy(selectedData.user_id, selectedData.drive_id)
    : supportsMove(selectedData.user_id, selectedData.drive_id)
  if (!isSupported) {
    message.warning(`当前网盘为只读，不能${copyby === 'copy' ? '复制' : '移动'}文件`)
    return
  }
  if (selectedData.dirID.startsWith('video')) {
    message.error('请不要在放映室里移动文件文件')
    return
  }

  let files: IAliGetFileModel[] = []
  if (istree) {
    files = [{
      ...usePanTreeStore().selectDir,
      isDir: true,
      ext: '',
      category: '',
      icon: '',
      sizeStr: '',
      timeStr: '',
      starred: false,
      thumbnail: ''
    } as IAliGetFileModel]
  } else {
    files = usePanFileStore().GetSelected()
  }
  if (files.length == 0) {
    message.error('没有选择要复制移动的文件！')
    return
  }
  const parent_file_id = files[0].parent_file_id

  const file_idList: string[] = []
  const diridList: string[] = []
  for (let i = 0, maxi = files.length; i < maxi; i++) {
    if (files[i].isDir && !diridList.includes(files[i].parent_file_id)) diridList.push(files[i].parent_file_id)
    file_idList.push(files[i].file_id)
  }

  if (file_idList.length == 0) {
    message.error('没有可以复制移动的文件')
    return
  }
  modalSelectPanDir(copyby, parent_file_id, async function(user_id: string, drive_id: string, selectFile: any) {
    if (!drive_id || !selectFile.drive_id || !selectFile.file_id) return
    if (parent_file_id == selectFile.file_id) {
      message.error('不能移动复制到原位置！')
      return
    }
    let successList: string[]
    if (copyby == 'copy') {
      successList = await AliFileCmd.ApiCopyBatch(
        user_id,
        drive_id,
        file_idList,
        selectFile.drive_id,
        selectFile.path || selectFile.file_id,
        selectFile.description || ''
      )
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectFile.drive_id, selectFile.file_id)
      TreeStore.ClearDirSize(selectedData.drive_id, [selectFile.file_id])
    } else {
      successList = await AliFileCmd.ApiMoveBatch(
        user_id,
        drive_id,
        file_idList,
        selectFile.drive_id,
        selectFile.path || selectFile.file_id,
        selectFile.description || ''
      )
      if (istree) {
        await PanDAL.aReLoadOneDirToShow(selectedData.drive_id, selectedData.parentDirID, false)
      } else {
        usePanFileStore().mDeleteFiles(selectedData.dirID, successList, true)
      }
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectFile.drive_id, selectFile.file_id)
      TreeStore.ClearDirSize(drive_id, [selectFile.file_id, ...selectedData.selectedParentKeys])
    }
  })
}


export function dropMoveSelectedFile(drive_id: string, movetodirid: string, istree: boolean) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isErrorSelected) return
  if (selectedData.isError) {
    message.error('复制移动操作失败 父文件夹错误！')
    return
  }
  if (!supportsMove(selectedData.user_id, selectedData.drive_id)) {
    message.warning('当前网盘为只读，不能移动文件')
    return
  }

  if (selectedData.dirID == 'trash') {
    message.error('回收站内文件不支持移动！')
    return
  }
  if (!movetodirid) {
    message.error('没有选择要移动到的位置！')
    return
  }
  if (movetodirid == selectedData.dirID) {
    message.error('不能移动到原位置！')
    return
  }

  const file_idList: string[] = []
  const filenameList: string[] = []
  const selectedFile = usePanFileStore().GetSelected()
  if (selectedFile.length == 0) {
    message.error('没有选择要拖放移动的文件！')
    return
  }
  for (let i = 0, maxi = selectedFile.length; i < maxi; i++) {
    file_idList.push(selectedFile[i].file_id)
    filenameList.push(selectedFile[i].name)
  }

  if (file_idList.includes(movetodirid)) {
    if (file_idList.length == 1) message.info('取消移动')
    else message.error('不能移动到原位置！')
    return
  }

  let to_drive_id = drive_id || selectedData.drive_id
  // 获取父节点
  if (movetodirid.includes('root')) {
    to_drive_id = GetDriveID(selectedData.user_id, movetodirid)
    movetodirid = 'root'
  }
  AliFileCmd.ApiMoveBatch(selectedData.user_id, selectedData.drive_id, file_idList, to_drive_id, movetodirid)
    .then(async (success: string[]) => {
      usePanFileStore().mDeleteFiles(selectedData.dirID, success, true)
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, selectedData.dirID)
      if (selectedData.drive_id != to_drive_id) {
        await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, to_drive_id, movetodirid)
      }
      await PanDAL.aReLoadOneDirToShow(to_drive_id, movetodirid, false)
      TreeStore.ClearDirSize(selectedData.drive_id, [movetodirid, ...selectedData.selectedParentKeys])
    })
}

export async function menuFileEncTypeChange(istree: boolean) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  const description = selectedData.fileDescription || selectedData.parentDirDescription || ''
  if (selectedData.isError) {
    message.error('标记加密文件操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以标记加密的文件')
    return
  }
  if (topbtnLock.has('menuFileEncTypeChange')) return
  topbtnLock.add('menuFileEncTypeChange')
  let encType = 'xbyEncrypt1'
  Modal.open({
    title: '标记加密',
    okText: '标记',
    bodyStyle: { minWidth: '340px' },
    content: () => h(Select, {
      tabindex: '-1',
      defaultValue: 'xbyEncrypt1',
      onChange: (value: any) => encType = value
    }, () => [
      h(Option, { tabindex: '-1', value: 'notEncrypt', label: '未加密' }),
      h(Option, { tabindex: '-1', value: 'xbyEncrypt1', label: '加密文件' }),
      h(Option, { tabindex: '-1', value: 'xbyEncrypt2', label: '私密文件' })
    ]),
    onOk: async () => {
      try {
        await AliFileCmd.ApiFileColorBatch(selectedData.user_id, selectedData.drive_id, description, encType, selectedData.selectedKeys)
      } catch (err: any) {
        message.error(err.message)
        DebugLog.mSaveDanger('menuFileEncTypeChange', err)
      }
    },
    onCancel: () => {
      topbtnLock.delete('menuFileEncTypeChange')
    }
  })
  topbtnLock.delete('menuFileEncTypeChange')
}

export async function menuFileClearHistory(istree: boolean) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isError) {
    message.error('清除历史操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以清除历史的文件')
    return
  }
  if (topbtnLock.has('menuFileClearHistory')) return
  topbtnLock.add('menuFileClearHistory')
  await AliFileCmd.ApiFileHistoryBatch(selectedData.user_id, selectedData.drive_id, selectedData.selectedKeys)
  await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
  usePanFileStore().mCancelSelect()
  topbtnLock.delete('menuFileClearHistory')
}

export async function menuFileColorChange(istree: boolean, color: string) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  const description = selectedData.fileDescription || selectedData.parentDirDescription
  color = color.toLowerCase().replace('#', 'c')
  if (selectedData.isError) {
    message.error('标记文件操作失败 父文件夹错误')
    return
  }
  if (selectedData.isErrorSelected) {
    message.error('没有可以标记的文件')
    return
  }
  if (color && description.includes(color)) {
    message.error('不能标记相同的颜色')
    return
  }
  if (topbtnLock.has('menuFileColorChange')) return
  topbtnLock.add('menuFileColorChange')
  try {
    await AliFileCmd.ApiFileColorBatch(selectedData.user_id, selectedData.drive_id, description, color, selectedData.selectedKeys)
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('menuFileColorChange', err)
  }
  topbtnLock.delete('menuFileColorChange')
}


export function menuCreatShare(istree: boolean, shareby: string, driveType: string) {
  const selectedData = PanDAL.GetPanSelectedData(istree)
  if (selectedData.isError) {
    message.error('创建分享操作失败 父文件夹错误')
    return
  }
  if (!supportsCreateShare(selectedData.user_id, selectedData.drive_id)) {
    message.warning('当前网盘为只读，不能创建分享')
    return
  }

  let list: IAliGetFileModel[] = []
  if (istree) {
    const dir = usePanTreeStore().selectDir
    list = [
      {
        __v_skip: true,
        drive_id: dir.drive_id,
        file_id: dir.file_id,
        parent_file_id: dir.parent_file_id,
        name: dir.name,
        namesearch: dir.namesearch,
        ext: '',
        mime_type: '',
        mime_extension: '',
        category: '',
        icon: 'iconfile-folder',
        size: 0,
        sizeStr: '',
        time: 0,
        timeStr: '',
        starred: false,
        isDir: true,
        thumbnail: '',
        description: dir.description
      }
    ]
  } else {
    list = usePanFileStore().GetSelected()
  }
  if (list.length == 0) {
    message.error('没有可以分享的文件！')
    return
  }
  let encFiles = list.filter(l => getEncType(l) == 'xbyEncrypt2')
  if (encFiles.length > 0) {
    Modal.open({
      title: '存在私密的文件，是否继续分享？',
      bodyStyle: {
        minWidth: '340px',
        minHeight: '100px'
      },
      closable: false,
      content: encFiles.map(v => v.name).join(','),
      okText: '确认',
      cancelText: '取消',
      onOk(e) {
        modalCreatNewShareLink(shareby, driveType, list)
      }
    })
  } else {
    modalCreatNewShareLink(shareby, driveType, list)
  }
}


export async function topFavorDeleteAll() {
  const selectedData = PanDAL.GetPanSelectedData(false)
  if (selectedData.isError) {
    message.error('清空收藏夹操作失败 父文件夹错误')
    return
  }
  if (topbtnLock.has('topFavorDeleteAll')) return
  topbtnLock.add('topFavorDeleteAll')
  try {
    const loadingKey = 'cleartrash_' + Date.now().toString()
    message.loading('清空收藏夹执行中...', 60, loadingKey)
    let count = 0
    while (true) {
      const resp: IAliFileResp = NewIAliFileResp(selectedData.user_id, selectedData.drive_id, 'favorite', '收藏夹')
      await AliTrash.ApiFavorFileListOnePageForClean('updated_at', 'DESC', resp)
      if (resp.items.length > 0) {
        const selectkeys = ArrayKeyList<string>('file_id', resp.items)
        const successList = await AliFileCmd.ApiFavorBatch(selectedData.user_id, selectedData.drive_id, false, false, selectkeys)
        count += successList.length
        message.loading('清空收藏夹执行中...(' + count.toString() + ')', 60, loadingKey)
      } else {
        break
      }
    }
    message.success('清空收藏夹 成功!', 3, loadingKey)
    if (usePanTreeStore().selectDir.file_id == 'favorite') PanDAL.aReLoadOneDirToShow('', 'refresh', false)
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('topFavorDeleteAll', err)
  }
  topbtnLock.delete('topFavorDeleteAll')
}


export function canClearTrash(user_id: string, drive_id: string): boolean {
  return isAliyunUser(user_id) || isCloud123User(user_id) || drive_id === 'cloud123' || isDrive115User(user_id) || drive_id === 'drive115' || isPikPakUser(user_id) || drive_id === 'pikpak'
}

export async function topTrashDeleteAll() {
  const selectedData = PanDAL.GetPanSelectedData(false)
  if (selectedData.isError) {
    message.error('清空回收站操作失败 父文件夹错误')
    return
  }
  if (!canClearTrash(selectedData.user_id, selectedData.drive_id)) {
    message.error('当前网盘暂不支持清空回收站')
    return
  }

  if (topbtnLock.has('topTrashDeleteAll')) return
  topbtnLock.add('topTrashDeleteAll')
  const loadingKey = 'cleartrash_' + Date.now().toString()
  try {
    message.loading('清空回收站执行中...', 60, loadingKey)
    let count = 0
    if (isCloud123User(selectedData.user_id) || selectedData.drive_id === 'cloud123') {
      if (!await apiCloud123TrashDeleteAll(selectedData.user_id)) throw new Error('清空 123 云盘回收站失败')
      message.success('清空回收站 成功!', 3, loadingKey)
      if (usePanTreeStore().selectDir.file_id == 'trash') PanDAL.aReLoadOneDirToShow('', 'refresh', false)
      return
    }
    if (isDrive115User(selectedData.user_id) || selectedData.drive_id === 'drive115') {
      if (!await apiDrive115TrashClear(selectedData.user_id)) throw new Error('清空 115 网盘回收站失败')
      message.success('清空回收站 成功!', 3, loadingKey)
      if (usePanTreeStore().selectDir.file_id == 'trash') PanDAL.aReLoadOneDirToShow('', 'refresh', false)
      return
    }
    if (isPikPakUser(selectedData.user_id) || selectedData.drive_id === 'pikpak') {
      let pageToken = ''
      const trashIds: string[] = []
      do {
        const page = await apiPikPakFileList(selectedData.user_id, 'pikpak_root', 100, pageToken, true)
        trashIds.push(...page.items.map(item => item.id).filter(Boolean))
        pageToken = page.nextPageToken
      } while (pageToken)
      for (let offset = 0; offset < trashIds.length; offset += 100) {
        const ids = trashIds.slice(offset, offset + 100)
        if (ids.length > 0) {
          const deleted = await apiPikPakTrashDelete(selectedData.user_id, ids)
          if (deleted.length !== ids.length) throw new Error('部分 PikPak 回收站文件删除失败')
          count += deleted.length
          message.loading('清空回收站执行中...(' + count.toString() + ')', 0, loadingKey)
        }
      }
      message.success('清空回收站 成功!', 3, loadingKey)
      if (usePanTreeStore().selectDir.file_id == 'trash') PanDAL.aReLoadOneDirToShow('', 'refresh', false)
      return
    }
    if (isBoxUser(selectedData.user_id) || selectedData.drive_id === 'box') {
      let marker = ''
      do {
        const page = await apiBoxTrashListPage(selectedData.user_id, marker)
        for (const item of page.items) {
          if (!item.id || (item.type !== 'file' && item.type !== 'folder')) continue
          if (!await apiBoxTrashPurge(selectedData.user_id, item.id, item.type)) throw new Error(`彻底删除 Box 回收站项目失败：${item.name || item.id}`)
          count++
        }
        marker = page.nextMarker
        message.loading('清空回收站执行中...(' + count.toString() + ')', 0, loadingKey)
      } while (marker)
      message.success('清空回收站 成功!', 3, loadingKey)
      if (usePanTreeStore().selectDir.file_id == 'trash') PanDAL.aReLoadOneDirToShow('', 'refresh', false)
      return
    }
    while (true) {

      const resp: IAliFileResp = NewIAliFileResp(selectedData.user_id, selectedData.drive_id, 'trash', '回收站')
      await AliTrash.ApiTrashFileListOnePageForClean('updated_at', 'DESC', resp)
      if (resp.items.length > 0) {

        const selectkeys = ArrayKeyList<string>('file_id', resp.items)
        const successList = await AliFileCmd.ApiTrashCleanBatch(selectedData.user_id, selectedData.drive_id, false, selectkeys)
        count += successList.length

        message.loading('清空回收站执行中...(' + count.toString() + ')', 0, loadingKey)
      } else {
        break
      }
    }
    message.success('清空回收站 成功!', 3, loadingKey)
    if (usePanTreeStore().selectDir.file_id == 'trash') PanDAL.aReLoadOneDirToShow('', 'refresh', false)
  } catch (err: any) {
    message.error(err.message, 3, loadingKey)
    DebugLog.mSaveDanger('topTrashDeleteAll', err)
  } finally {
    topbtnLock.delete('topTrashDeleteAll')
  }
}


export async function topRecoverSelectedFile() {
  const selectedData = PanDAL.GetPanSelectedData(false)
  if (selectedData.isError) {
    message.error('恢复文件操作失败 父文件夹错误')
    return
  }


  const files = usePanFileStore().GetSelected()
  if (files.length == 0) {
    message.error('没有选择要恢复的文件！')
    return
  }

  const resumeList: { drive_id: string; file_id: string; content_hash: string; size: number; name: string }[] = []
  const selectParentKeys: string[] = ['root', 'recover']
  for (let i = 0, maxi = files.length; i < maxi; i++) {
    const file = files[i]
    resumeList.push({
      drive_id: file.drive_id,
      file_id: file.file_id,
      content_hash: file.description,
      size: file.size,
      name: file.name
    })
    if (!selectParentKeys.includes(files[i].parent_file_id)) selectParentKeys.push(files[i].parent_file_id)
  }

  if (resumeList.length == 0) {
    message.error('没有可以恢复的文件')
    return
  }

  if (topbtnLock.has('topRecoverSelectedFile')) return
  topbtnLock.add('topRecoverSelectedFile')

  const loadingKey = 'recover_' + Date.now().toString()
  try {
    message.loading('文件恢复执行中...', 60, loadingKey)
    let successList: string[] = []
    let oneTimeList: { drive_id: string; file_id: string; content_hash: string; size: number; name: string }[] = []
    for (let i = 0, maxi = resumeList.length; i < maxi; i++) {
      oneTimeList.push(resumeList[i])
      if (oneTimeList.length > 99) {
        const data = await AliFileCmd.ApiRecoverBatch(selectedData.user_id, oneTimeList)
        if (Array.isArray(data)) {
          successList = successList.concat(data)
        } else {
          oneTimeList = []
          message.error(data, 3, loadingKey)
          break
        }
        oneTimeList.length = 0
        message.loading('文件恢复执行中...(' + i.toString() + ')', 60, loadingKey)
      }
    }
    if (oneTimeList.length > 0) {
      const data = await AliFileCmd.ApiRecoverBatch(selectedData.user_id, oneTimeList)
      if (Array.isArray(data)) {
        successList = successList.concat(data)
      } else {
        message.error(data, 3, loadingKey)
      }
      oneTimeList.length = 0
    }
    if (successList.length > 0) {
      message.success('文件恢复(' + successList.length + ') 成功!', 3, loadingKey)
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, 'root')
      usePanFileStore().mDeleteFiles('recover', successList, false)
    }
  } catch (err: any) {
    message.error(err.message, 3, loadingKey)
    DebugLog.mSaveDanger('topRecoverSelectedFile', err)
  }
  topbtnLock.delete('topRecoverSelectedFile')
}


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
    const provider = getDriveProviderLabel(UserDAL.GetUserToken(pantreeStore.user_id)?.tokenfrom)
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


export async function menuJumpToDir() {
  let panTreeStore = usePanTreeStore()
  let first = usePanFileStore().GetSelectedFirst()
  if (first && !first.parent_file_id) {
    first = await AliFile.ApiGetFile(panTreeStore.user_id, first.drive_id, first.file_id)
  }
  if (!first) {
    message.error('没有选中任何文件')
    return
  }
  PanDAL.aReLoadOneDirToShow(first.drive_id, first.parent_file_id, true).then(() => {
    usePanFileStore().mKeyboardSelect(first!.file_id, false, false)
    usePanFileStore().mSaveFileScrollTo(first!.file_id)
  })
}

export function menuVideoXBT() {
  const first = usePanFileStore().GetSelectedFirst()
  if (!first) {
    message.error('没有选中任何文件')
    return
  }
  if (first.description && first.description.includes('xbyEncrypt')) {
    message.error('加密视频无法获取雪碧图')
    return
  }
  if (first.icon == 'iconweifa') {
    message.error('违规视频无法预览')
    return
  }
  const pageVideoXBT: IPageVideoXBT = {
    user_id: usePanTreeStore().user_id,
    drive_id: first.drive_id,
    file_id: first.file_id,
    file_name: first.name
  }
  window.WebOpenWindow({ page: 'PageVideoXBT', data: pageVideoXBT, theme: 'dark' })
}

export function menuDLNA() {
  const first = usePanFileStore().GetSelectedFirst()
  if (!first) {
    message.error('没有选中任何文件')
    return
  }
  modalDLNAPlayer()
}

export function menuM3U8Download() {
  const first = usePanFileStore().GetSelectedFirst()
  if (!first) {
    message.error('没有选中任何文件')
    return
  }
  modalM3U8Download()
}

export async function menuDrive115VideoPush(op: 'vip_push' | 'pay_push') {
  const selected = usePanFileStore().GetSelected()
  const first = selected[0]
  if (selected.length !== 1 || !first || first.isDir) {
    message.warning('请选择一个 115 视频文件')
    return
  }
  const userId = (first as any).user_id || usePanTreeStore().user_id
  if (!isDrive115User(userId) && first.drive_id !== 'drive115') return

  const meta = await getDrive115PickCode(userId, first.file_id)
  if (!meta?.pick_code) {
    message.error(meta?.error || '获取 115 视频提取码失败')
    return
  }
  const result = await apiDrive115VideoPush(userId, meta.pick_code, op)
  if (result.success) message.success(result.message)
  else message.error(result.message)
}

export function menuCopyFileName() {
  const list: IAliGetFileModel[] = usePanFileStore().GetSelected()
  if (list.length == 0) {
    message.error('没有选择要复制文件名的文件！')
    return
  }

  if (topbtnLock.has('menuCopyFileName')) return
  topbtnLock.add('menuCopyFileName')
  try {
    const nameList: string[] = []
    for (let i = 0, maxi = list.length; i < maxi; i++) {
      nameList.push(list[i].name)
    }
    const fullStr = nameList.join('\r\n')
    copyToClipboard(fullStr)
    message.success('选中文件的文件名已复制到剪切板')
  } catch (err: any) {
    message.error(err.message)
    DebugLog.mSaveDanger('menuCopyFileName', err)
  }
  topbtnLock.delete('menuCopyFileName')
}

export function menuCopyFileTree() {
  const list: IAliGetFileModel[] = usePanFileStore().GetSelected()
  if (list.length == 0) {
    message.error('没有选中任何文件！')
    return
  }
  modalCopyFileTree(list)
}
