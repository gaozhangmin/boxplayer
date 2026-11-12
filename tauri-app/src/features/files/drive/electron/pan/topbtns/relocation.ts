import {message,usePanTreeStore,usePanFileStore,supportsCopy,supportsMove,modalSelectPanDir} from '@/features/files/drive/ports'
import {PanDAL,TreeStore,GetDriveID,isDriveRoot} from '@/features/files/drive/relocationUiPorts'
import AliFileCmd from '@/features/files/drive/fileCommands'
import type {IAliGetFileModel} from '../../aliapi/alimodels'

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
    if (!selectedData.isCurrent()) return
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
      if (!selectedData.isCurrent()) return
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
      if (!selectedData.isCurrent()) return
      if (istree) {
        await PanDAL.aReLoadOneDirToShow(selectedData.drive_id, selectedData.parentDirID, false)
      } else {
        usePanFileStore().mDeleteFiles(selectedData.dirID, successList, true)
      }
      if (!selectedData.isCurrent()) return
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
  if (isDriveRoot(movetodirid)) {
    to_drive_id = GetDriveID(selectedData.user_id, movetodirid)
    movetodirid = 'root'
  }
  return AliFileCmd.ApiMoveBatch(selectedData.user_id, selectedData.drive_id, file_idList, to_drive_id, movetodirid)
    .then(async (success: string[]) => {
      if (!selectedData.isCurrent()) return
      usePanFileStore().mDeleteFiles(selectedData.dirID, success, true)
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, selectedData.dirID)
      if (!selectedData.isCurrent()) return
      if (selectedData.drive_id != to_drive_id) {
        await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, to_drive_id, movetodirid)
      }
      if (!selectedData.isCurrent()) return
      await PanDAL.aReLoadOneDirToShow(to_drive_id, movetodirid, false)
      TreeStore.ClearDirSize(selectedData.drive_id, [movetodirid, ...selectedData.selectedParentKeys])
    })
}
