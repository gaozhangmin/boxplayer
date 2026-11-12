import type { IAliGetFileModel } from '../aliapi/alimodels'
import { apiGuangyaFileList, mapGuangyaFileToAliModel } from './dirfilelist'

export const apiGuangyaSearch = async (user_id: string, keyword: string, limit = 30): Promise<IAliGetFileModel[]> => {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return []
  const items = await apiGuangyaFileList(user_id, '*', Math.max(limit, 200))
  return items
    .map((item) => mapGuangyaFileToAliModel(item, 'guangya', item.parentId || item.parentFileId || 'guangya_root'))
    .filter((item) => item.name.toLowerCase().includes(normalized))
    .slice(0, limit)
}
