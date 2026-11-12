import {cloud189Scope,cloud189IsRoot,forgetCloud189Files} from './cloud189Identity'
import {apiCloud189FileDetail,cloud189FormRequest,Cloud189BatchRejected} from '../../cloud189BatchTransport'
const message={error:(_value:string)=>{}}
const mutableScope = (id: string) => {
  const scope = cloud189Scope(id)
  if (cloud189IsRoot(id) || !scope.rawId) throw new Error('不能修改天翼空间根目录')
  return scope
}

const batch = async (user_id: string, type: 'DELETE' | 'MOVE' | 'COPY', ids: string[], target?: string): Promise<string[]> => {
  if (!ids.length) return []
  try {
    const scopes = ids.map(mutableScope)
    const familyId = scopes[0].familyId
    if (scopes.some(scope => scope.familyId !== familyId)) throw new Error('请在同一个天翼空间内操作')
    const destination = target === undefined ? undefined : cloud189Scope(target)
    if (destination && destination.familyId !== familyId) throw new Error('暂不支持个人空间与家庭空间之间或不同家庭之间移动、复制')
    if (destination && scopes.some(scope => scope.rawId === destination.rawId)) throw new Error('不能将文件夹移动或复制到自身')
    const taskInfos = []
    for (let index = 0; index < ids.length; index++) {
      const item = await apiCloud189FileDetail(user_id, ids[index])
      if (!item) throw new Error('文件不存在，请刷新目录')
      taskInfos.push({ fileId: scopes[index].rawId, fileName: item.name || item.fileName || item.folderName || '', isFolder: item.isFolder ? 1 : 0 })
    }
    const form: Record<string, string> = { type, taskInfos: JSON.stringify(taskInfos) }
    if (familyId) form.familyId = familyId
    if (destination?.rawId) form.targetFolderId = destination.rawId
    const created = await cloud189FormRequest(user_id, 'batch/createBatchTask.action', form, !!familyId)
    const taskId = String(created.taskId || created.data?.taskId || '')
    if (!taskId) throw new Error('天翼云盘未返回文件操作任务 ID')
    forgetCloud189Files(user_id)
    const deadline = Date.now() + 30000
    // Upstream checks batch progress with the personal session, even for family tasks.
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      const response = await cloud189FormRequest(user_id, 'batch/checkBatchTask.action', { type, taskId })
      const state = response.data || response
      if (Number(state.taskStatus) === 2) throw new Error('目标存在同名文件，操作未完成，请处理冲突后重试')
      if (Number(state.taskStatus) === 4) {
        forgetCloud189Files(user_id)
        if (Number(state.failedCount || 0) || Number(state.skipCount || 0)) {
          message.error('部分文件操作失败或被跳过，请刷新目录确认结果')
          const succeeded = Array.isArray(state.successedFileIdList) ? new Set(state.successedFileIdList.map(String)) : new Set<string>()
          return ids.filter((_, index) => succeeded.has(scopes[index].rawId))
        }
        return ids
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('天翼文件操作仍在处理中，请刷新目录确认，避免重复提交')
  } catch (error: any) {
    if(error instanceof Cloud189BatchRejected)throw error
    message.error(error?.message || '天翼文件操作失败')
    return []
  }
}

export const apiCloud189TrashBatch = (user_id: string, ids: string[]) => batch(user_id, 'DELETE', ids)

export const apiCloud189MoveBatch = (user_id: string, ids: string[], toParentId: string) => batch(user_id, 'MOVE', ids, toParentId)

export const apiCloud189CopyBatch = (user_id: string, ids: string[], toParentId: string) => batch(user_id, 'COPY', ids, toParentId)
