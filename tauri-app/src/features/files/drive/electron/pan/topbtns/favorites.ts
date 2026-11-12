import {usePanFileStore,usePanTreeStore} from '@/features/files/drive/ports'
import {PanDAL} from '@/features/files/drive/relocationUiPorts'
import {message,DebugLog} from '@/features/files/drive/trashUiPorts'
import {AliTrash,NewIAliFileResp,ArrayKeyList,type IAliFileResp} from '@/features/files/drive/favoriteClearPorts'
import AliFileCmd from '@/features/files/drive/fileCommands'
const topbtnLock=new Set<string>()
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
    if(!selectedData.isCurrent())throw Error('来源已切换')
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
    if(selectedData.isCurrent()){message.error(err.message)
    DebugLog.mSaveDanger('menuFavSelectFile', err)}
  }
  topbtnLock.delete('menuFavSelectFile')
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
      if(!selectedData.isCurrent())throw Error('来源已切换')
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
    if(selectedData.isCurrent()){message.error(err.message)
    DebugLog.mSaveDanger('topFavorDeleteAll', err)}
  }
  topbtnLock.delete('topFavorDeleteAll')
}
