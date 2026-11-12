import {usePanFileStore} from '@/features/files/drive/ports'
import {PanDAL} from '@/features/files/drive/relocationUiPorts'
import {message,DebugLog} from '@/features/files/drive/trashUiPorts'
import AliFileCmd from '@/features/files/drive/fileCommands'
const topbtnLock=new Set<string>()
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
    const file = files[i]!
    resumeList.push({
      drive_id: file.drive_id,
      file_id: file.file_id,
      content_hash: file.description,
      size: file.size,
      name: file.name
    })
    if (!selectParentKeys.includes(files[i]!.parent_file_id)) selectParentKeys.push(files[i]!.parent_file_id)
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
      oneTimeList.push(resumeList[i]!)
      if (oneTimeList.length > 99) {
        const data = await AliFileCmd.ApiRecoverBatch(selectedData.user_id, oneTimeList)
        if(!selectedData.isCurrent())throw Error('来源已切换')
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
      if(!selectedData.isCurrent())throw Error('来源已切换')
      if (Array.isArray(data)) {
        successList = successList.concat(data)
      } else {
        message.error(data, 3, loadingKey)
      }
      oneTimeList.length = 0
    }
    if (selectedData.isCurrent() && successList.length > 0) {
      message.success('文件恢复(' + successList.length + ') 成功!', 3, loadingKey)
      await PanDAL.aReLoadOneDirToRefreshTree(selectedData.user_id, selectedData.drive_id, 'root')
      usePanFileStore().mDeleteFiles('recover', successList, false)
    }
  } catch (err: any) {
    if(selectedData.isCurrent()){message.error(err.message, 3, loadingKey)
    DebugLog.mSaveDanger('topRecoverSelectedFile', err)}
  }
  topbtnLock.delete('topRecoverSelectedFile')
}
