import { listBoxItems } from '../box/adapter'
import { listBaiduItems } from '../cloudbaidu/adapter'
import { listCloud123Items } from '../cloud123/adapter'
import { listCloud139Items } from '../cloud139/adapter'
import { listAllCloud189Items, listCloud189Items } from '../cloud189/adapter'
import { listDrive115Items } from '../cloud115/adapter'
import { listDropboxItems } from '../dropbox/adapter'
import { listGoogleItems } from '../google/adapter'
import { listGuangyaItems } from '../guangya/adapter'
import { listOneDriveItems } from '../onedrive/adapter'
import { listPikPakItems } from '../pikpak/adapter'
import { listQuarkItems } from '../quark/adapter'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { DriveProvider } from '../utils/driveProvider'

export type ProviderListResult = {
  items: IAliGetFileModel[]
  total: number
  error?: string
  nextCursor?: string
}

export type ProviderListOptions = { skipThumbnailHydration?: boolean; strict?: boolean }

/** Thin registry for provider-owned directory, search, and thumbnail adapters. */
export const listProviderItems = (provider: DriveProvider, userId: string, driveId: string, dirId: string, includeFiles: boolean, cursor = '', options?: ProviderListOptions): Promise<ProviderListResult> | undefined => {
  switch (provider) {
    case 'baidu': return listBaiduItems(userId, driveId, dirId, includeFiles, Number(cursor) || 0, options?.strict)
    case 'cloud123': return listCloud123Items(userId, driveId, dirId, includeFiles, cursor, options?.strict)
    case '139': return listCloud139Items(userId, driveId, dirId, includeFiles, cursor, options?.strict)
    case '189': return includeFiles
      ? listCloud189Items(userId, driveId, dirId, true, Number(cursor) || 1, options?.strict)
      : listAllCloud189Items(userId, driveId, dirId, false).then(items => ({ items, total: items.length, nextCursor: '' }))
    case 'guangya': return listGuangyaItems(userId, driveId, dirId, includeFiles, Number(cursor) || 0)
    case '115': return listDrive115Items(userId, driveId, dirId, includeFiles, Number(cursor) || 0, options?.strict)
    case 'pikpak': return listPikPakItems(userId, driveId, dirId, includeFiles, cursor, options?.strict)
    case 'quark': return listQuarkItems(userId, driveId, dirId, includeFiles, Number(cursor) || 1, options?.strict)
    case 'box': return options?.skipThumbnailHydration ? listBoxItems(userId, driveId, dirId, includeFiles, Number(cursor) || 0, false, options?.strict) : listBoxItems(userId, driveId, dirId, includeFiles, Number(cursor) || 0, true, options?.strict)
    case 'dropbox': return options?.skipThumbnailHydration ? listDropboxItems(userId, driveId, dirId, includeFiles, cursor, false, options?.strict) : listDropboxItems(userId, driveId, dirId, includeFiles, cursor, true, options?.strict)
    case 'onedrive': return listOneDriveItems(userId, driveId, dirId, includeFiles, cursor, options?.strict)
    case 'google': return listGoogleItems(userId, driveId, dirId, includeFiles, cursor, options?.strict)
    default: return undefined
  }
}
