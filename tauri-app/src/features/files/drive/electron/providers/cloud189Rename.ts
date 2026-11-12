import {cloud189Scope,cloud189IsRoot,rememberCloud189File,forgetCloud189Files} from './cloud189Identity'
import {apiCloud189FileDetail,cloud189PostRequest,cloud189Request,Cloud189RenameRejected} from '../../cloud189RenameTransport'
const message={error:(_value:string)=>{}}
const mutableScope = (id: string) => {
  const scope = cloud189Scope(id)
  if (cloud189IsRoot(id) || !scope.rawId) throw new Error('不能修改天翼空间根目录')
  return scope
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
    if(error instanceof Cloud189RenameRejected)throw error
    message.error(error?.message || '重命名失败')
    return { success: false, name, parent_file_id: '', isDir: false }
  }
}
