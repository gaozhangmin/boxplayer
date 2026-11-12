import { getDrivePane } from './ports'
export {CheckFileName,ClearFileName} from './electron/fileNames'
export function filePlatform(){return /Mac/i.test(navigator.platform)?'darwin':/Win/i.test(navigator.platform)?'win32':'linux'}
export const modalCloseAll=()=>getDrivePane().action('closeDialog',[])
export const DriveUploadMem={UploadMem:(...args:unknown[]):Promise<string>=>getDrivePane().action('createTextDirect',args)}
