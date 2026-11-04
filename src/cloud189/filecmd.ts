import message from '../utils/message'
import { apiCloud189FileDetail, cloud189Scope, cloud189FamilyId, cloud189IsRoot, cloud189FormRequest, cloud189PostRequest, cloud189Request, rememberCloud189File, forgetCloud189Files } from './dirfilelist'

const mutableScope = (id: string) => {
  const scope = cloud189Scope(id)
  if (cloud189IsRoot(id) || !scope.rawId) throw new Error('不能修改天翼空间根目录')
  return scope
}
export const apiCloud189Mkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  try {
    const scope = cloud189Scope(parentId)
    const params: Record<string, string> = { folderName: name, relativePath: '' }
    if (scope.familyId) { params.familyId = scope.familyId; params.parentId = scope.rawId }
    else params.parentFolderId = scope.rawId
    const data = await cloud189PostRequest(user_id, `${scope.familyId ? 'family/file/' : ''}createFolder.action`, params, !!scope.familyId)
    const folder = data.data || data
    const id = String(folder.folderId || folder.id || folder.folder?.id || '')
    if (!id) throw new Error('新建文件夹未返回 ID')
    rememberCloud189File(user_id, { id, name, isFolder: true, familyId: scope.familyId, parentId })
    return { file_id: scope.familyId ? cloud189FamilyId(scope.familyId, id) : id, error: '' }
  } catch (error: any) { return { file_id: '', error: error?.message || '新建文件夹失败' } }
}

export const apiCloud189Rename = async (user_id: string, fileId: string, name: string): Promise<{ success: boolean; name: string; parent_file_id: string; isDir: boolean }> => {
  try {
    const scope = mutableScope(fileId)
    const item = await apiCloud189FileDetail(user_id, fileId)
    if (!item) throw new Error('文件不存在，请刷新目录')
    const params: Record<string, string> = item.isFolder ? { folderId: scope.rawId, destFolderName: name } : { fileId: scope.rawId, destFileName: name }
    if (scope.familyId) params.familyId = scope.familyId
    const request = scope.familyId ? cloud189Request : cloud189PostRequest
    await request(user_id, `${scope.familyId ? 'family/file/' : ''}${item.isFolder ? 'renameFolder' : 'renameFile'}.action`, params, !!scope.familyId)
    forgetCloud189Files(user_id)
    rememberCloud189File(user_id, { ...item, name })
    return { success: true, name, parent_file_id: item.parentId || item.parentFolderId || '', isDir: !!item.isFolder }
  } catch (error: any) {
    message.error(error?.message || '重命名失败')
    return { success: false, name, parent_file_id: '', isDir: false }
  }
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
    message.error(error?.message || '天翼文件操作失败')
    return []
  }
}
export const apiCloud189TrashBatch = (user_id: string, ids: string[]) => batch(user_id, 'DELETE', ids)
export const apiCloud189MoveBatch = (user_id: string, ids: string[], toParentId: string) => batch(user_id, 'MOVE', ids, toParentId)
export const apiCloud189CopyBatch = (user_id: string, ids: string[], toParentId: string) => batch(user_id, 'COPY', ids, toParentId)
