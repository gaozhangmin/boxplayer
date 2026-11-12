import {cloud189Scope,cloud189FamilyId,rememberCloud189File} from './cloud189Identity'
import {cloud189PostRequest} from '../../cloud189FolderTransport'
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
