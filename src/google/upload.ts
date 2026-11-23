import type { IUploadingUI } from '../utils/dbupload'
import { GOOGLE_DRIVE_READ_ONLY_MESSAGE } from './accessPolicy'

// Keep explicit rejections for old queue entries and any direct callers.
export const apiGoogleUploadBuffer = async (_userId: string, _parentId: string, _name: string, _buffer: Buffer) =>
  ({ file_id: '', error: GOOGLE_DRIVE_READ_ONLY_MESSAGE })

export default class GoogleUploadDisk {
  static async UploadOneFile(_fileui: IUploadingUI): Promise<string> {
    return GOOGLE_DRIVE_READ_ONLY_MESSAGE
  }
}
