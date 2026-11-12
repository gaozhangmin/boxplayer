import type { ResolvedMedia, SourceDriver } from './contracts'
import { nativeCall } from '@/platform/native'
export const pikpak: SourceDriver = {
  async list(account,parent,cursor){const {listPikPak}=await import('@/features/files/drive/pikpakListing');return listPikPak(account,parent,cursor)},
  async resolve(account, entry) {
    if (account.providerId !== 'pikpak' || entry.isDirectory || !entry.id) throw new Error('PikPak 文件无效')
    return nativeCall<ResolvedMedia>('resolve_protected_media', { accountId: account.id, fileId: entry.id })
  },
}
