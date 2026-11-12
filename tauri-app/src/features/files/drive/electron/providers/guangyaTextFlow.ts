// Original Electron in-memory upload algorithm; only hash/network/timer dependencies are injected.
export interface GuangyaTextUploadIo {
 md5(bytes:Uint8Array):Promise<string>
 token(name:string,size:number,parent:string,md5:string):Promise<{data?:{taskId:string};error:string}>
 info(task:string):Promise<{fileId:string;uploading:boolean;error:string}>
 put(task:string,bytes:Uint8Array):Promise<string>
 sleep(ms:number):Promise<void>
}
type Buffer=Uint8Array
export const apiGuangyaUploadBuffer = async (user_id: string, parentId: string, name: string, buff: Buffer, io: GuangyaTextUploadIo): Promise<{ file_id: string; error: string }> => {
  const md5 = await io.md5(buff)
  const tokenResp = await io.token(name, buff.length, parentId, md5)
  if (!tokenResp.data) return { file_id: '', error: tokenResp.error || '创建光鸭云盘文件失败' }
  let info = await io.info(tokenResp.data.taskId)
  if (info.fileId) return { file_id: info.fileId, error: '' }
  const ossError = await io.put(tokenResp.data.taskId, buff)
  if (ossError) return { file_id: '', error: ossError }
  for (let i = 0; i < 10; i++) {
    info = await io.info(tokenResp.data.taskId)
    if (info.fileId) return { file_id: info.fileId, error: '' }
    if (!info.uploading && info.error) return { file_id: '', error: info.error }
    await io.sleep(1000)
  }
  return { file_id: '', error: '光鸭云盘上传完成确认超时' }
}
