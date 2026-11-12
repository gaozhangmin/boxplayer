import {PanDAL} from '@/features/files/drive/relocationUiPorts'
import {message,DebugLog} from '@/features/files/drive/trashUiPorts'
import AliFileCmd from '@/features/files/drive/fileCommands'
const topbtnLock=new Set<string>()
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
    if(selectedData.isCurrent()){message.error(err.message)
    DebugLog.mSaveDanger('menuFileColorChange', err)}
  }
  topbtnLock.delete('menuFileColorChange')
}
