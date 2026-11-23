import { GOOGLE_DRIVE_READ_ONLY_MESSAGE } from './accessPolicy'

export const apiGoogleMkdir = async (_userId: string, _parentId: string, _name: string) =>
  ({ file_id: '', error: GOOGLE_DRIVE_READ_ONLY_MESSAGE })

export const apiGoogleTrashBatch = async (_userId: string, fileIds: string[]) => fileIds
export const apiGoogleTrashRestoreBatch = async (_userId: string, _fileIds: string[]): Promise<string[]> => []
export const apiGoogleDeleteBatch = async (_userId: string, _fileIds: string[]): Promise<string[]> => []
export const apiGoogleMoveBatch = async (_userId: string, _fileIds: string[], _newParentId: string): Promise<string[]> => []
export const apiGoogleCopyBatch = async (_userId: string, _fileIds: string[], _parentId: string): Promise<string[]> => []
