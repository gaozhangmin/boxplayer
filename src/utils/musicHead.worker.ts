import { parseLocalMusicHead, parseLocalMusicFile } from '../module/music-head/client'
let requestSerial = 0
const reads = new Map<number, {resolve:(value:string)=>void;reject:(error:Error)=>void}>()
self.onmessage = async (event: MessageEvent<any>) => {
  const data = event.data
  if (data.mode === 'range-result') {
    const pending = reads.get(data.requestId); reads.delete(data.requestId)
    if (data.error) pending?.reject(new Error('Local read failed')); else pending?.resolve(data.base64)
    return
  }
  try {
    const result = data.mode === 'local' ? await parseLocalMusicFile(data.size, data.name, (position,length) => new Promise((resolve,reject) => {
      const requestId = ++requestSerial; reads.set(requestId,{resolve,reject})
      self.postMessage({mode:'local-range',id:data.id,requestId,position,length})
    })) : await parseLocalMusicHead(data.base64)
    self.postMessage({id:data.id,result})
  } catch { self.postMessage({id:data.id,error:'Local tag parse failed'}) }
}
