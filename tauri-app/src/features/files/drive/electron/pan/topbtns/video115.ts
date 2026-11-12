import {usePanFileStore,usePanTreeStore,isDrive115User,message} from '../../../ports'
import {getDrive115PickCode,video115Scope} from '../../../video115Transport'
import {apiDrive115VideoPush} from '../../providers/video115'

export async function menuDrive115VideoPush(op: 'vip_push' | 'pay_push') {
  const selected = usePanFileStore().GetSelected()
  const first = selected[0]
  if (selected.length !== 1 || !first || first.isDir) {
    message.warning('请选择一个 115 视频文件')
    return
  }
  const userId = (first as any).user_id || usePanTreeStore().user_id
  if (!isDrive115User(userId) && first.drive_id !== 'drive115') return

  const scope = video115Scope(userId)
  const meta = await getDrive115PickCode(userId, first.file_id)
  scope.check()
  if (!meta?.pick_code) {
    message.error(meta?.error || '获取 115 视频提取码失败')
    return
  }
  const result = await apiDrive115VideoPush(userId, meta.pick_code, op)
  scope.check()
  if (result.success) message.success(result.message)
  else message.error(result.message)
}
