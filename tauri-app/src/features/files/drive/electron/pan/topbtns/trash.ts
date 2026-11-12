import {usePanTreeStore,usePanFileStore,supportsTrashMove,supportsTrashPermanentDelete,canClearTrash} from '@/features/files/drive/ports'
import {PanDAL,TreeStore,isDriveRoot} from '@/features/files/drive/relocationUiPorts'
import {message,DebugLog,Sleep,AliAlbum,nativeEmptyTrash} from '@/features/files/drive/trashUiPorts'
import AliFileCmd from '@/features/files/drive/fileCommands'
const topbtnLock=new Set<string>()

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

    if (!selectedData.isCurrent()) return
    if (istree) {
      await PanDAL.aReLoadOneDirToShow(selectedData.drive_id, selectedData.parentDirID, false)
    } else {
      usePanFileStore().mDeleteFiles(selectedData.dirID, successList, selectedData.dirID !== 'trash')
      if (selectedData.dirID !== 'trash') {
        await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, selectedData.dirID, selectedData.albumId)
        TreeStore.ClearDirSize(selectedData.drive_id, selectedData.selectedParentKeys)
      }
    }
    // Native file command synchronizes confirmed deletions with the video catalog before returning IDs.
  } catch (err: any) {
    if (!selectedData.isCurrent()) return
    message.error(err.message)
    DebugLog.mSaveDanger('menuTrashSelectFile', err)
  } finally { topbtnLock.delete('menuTrashSelectFile') }
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
    const restored = await AliFileCmd.ApiTrashRestoreBatch(selectedData.user_id, selectedData.drive_id, true, selectedData.selectedKeys)
    if (!selectedData.isCurrent()) return
    if (usePanTreeStore().selectDir.file_id == 'trash') {

      usePanFileStore().mDeleteFiles('trash', restored, false)
    } else {

      PanDAL.aReLoadOneDirToShow('', 'refresh', false)
    }
    await Sleep(2000)
    if (!selectedData.isCurrent()) return
    const dirList = await AliFileCmd.ApiGetFileBatch(selectedData.user_id, selectedData.drive_id, diridList.filter(id=>restored.includes(id)))
    if (!selectedData.isCurrent()) return

    const pset = new Set<string>()
    for (let i = 0, maxi = dirList.length; i < maxi; i++) {
      let parent_file_id = dirList[i].parent_file_id
      if (isDriveRoot(parent_file_id)) parent_file_id = 'root'
      if (pset.has(parent_file_id)) continue
      pset.add(parent_file_id)
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, parent_file_id)
    }
    TreeStore.ClearDirSize(selectedData.drive_id, Array.from(pset))
  } catch (err: any) {
    if (!selectedData.isCurrent()) return
    message.error(err.message)
    DebugLog.mSaveDanger('topRestoreSelectedFile', err)
  } finally { topbtnLock.delete('topRestoreSelectedFile') }
}

export async function topTrashDeleteAll(){
 const selectedData=PanDAL.GetPanSelectedData(false)
 if(selectedData.isError||!canClearTrash(selectedData.user_id,selectedData.drive_id)){message.error('当前网盘暂不支持清空回收站');return}
 if(topbtnLock.has('topTrashDeleteAll'))return
 topbtnLock.add('topTrashDeleteAll');const loadingKey='cleartrash_'+Date.now()
 const progress=message.loading('清空回收站执行中...',60,loadingKey)
 try{
  await nativeEmptyTrash(selectedData.user_id,selectedData.drive_id)
  if(!selectedData.isCurrent())return
  message.success('清空回收站 成功!',3,loadingKey)
  if(usePanTreeStore().selectDir.file_id==='trash')await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
 }catch(cause){if(selectedData.isCurrent())message.error(cause instanceof Error?cause.message:'清空回收站失败',3,loadingKey)}
 finally{if(!selectedData.isCurrent())progress.close();topbtnLock.delete('topTrashDeleteAll')}
}
