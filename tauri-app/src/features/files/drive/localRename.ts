import {nativeCall} from '@/platform/native'
import type {FilePreferences} from '../preferences'
import {recoverLocalOperations,type Recovery} from '../localRecovery'
interface Receipt {schemaVersion:1;sourceId:string;from:string;to:string;directory:boolean;operationId:string|null}
type Change={kind:'rename';name:string}|{kind:'move';parent:string}
export function renameLocalFile(store:{preferences:FilePreferences},sourceId:string,path:string,name:string,directory:boolean,onRecovered:(entry:Recovery)=>void=()=>{}){return changeLocalFile(store,sourceId,path,{kind:'rename',name},directory,onRecovered)}
export function moveLocalFile(store:{preferences:FilePreferences},sourceId:string,path:string,parent:string,directory:boolean,onRecovered:(entry:Recovery)=>void=()=>{}){return changeLocalFile(store,sourceId,path,{kind:'move',parent},directory,onRecovered)}
async function changeLocalFile(store:{preferences:FilePreferences},sourceId:string,path:string,change:Change,directory:boolean,onRecovered:(entry:Recovery)=>void){
 const label=change.kind==='rename'?'重命名':'移动'
 const name=change.kind==='rename'?change.name:path.split('/').at(-1)!
 let parent=change.kind==='move'?change.parent:''
 if(!path||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')||!name.trim()||/[\u0000-\u001f/\\]/.test(name)||name==='.'||name==='..')throw Error('本地'+label+'路径或名称无效')
 if(change.kind==='move'&&(parent.startsWith('/')||parent.includes('\\')||parent!==''&&parent.split('/').some(part=>!part||part==='.'||part==='..'||/[\u0000-\u001f]/.test(part))))throw Error('本地移动目标路径无效')
 const destination=()=>change.kind==='rename'?[...path.split('/').slice(0,-1),name].join('/'):[parent,path.split('/').at(-1)!].filter(Boolean).join('/')
 let to=destination()
 const reconcile=async()=>{const rows=await recoverLocalOperations(store);for(const row of rows)onRecovered(row);return rows}
 const matches=(rows:Recovery[])=>rows.find(row=>row.sourceId===sourceId&&row.from===path&&row.to===to&&row.directory===directory)
 const recovered=await reconcile();if(matches(recovered))return {path:to,name:to.split('/').at(-1)!}
 for(const row of recovered)if(row.sourceId===sourceId&&row.from&&row.to){if(path===row.from)path=row.to;else if(row.directory&&path.startsWith(row.from+'/'))path=row.to+path.slice(row.from.length);if(change.kind==='move'&&row.directory){if(parent===row.from)parent=row.to;else if(parent.startsWith(row.from+'/'))parent=row.to+parent.slice(row.from.length)}}
 to=destination()
 let receipt:Receipt
 try{receipt=await nativeCall<Receipt>(change.kind==='rename'?'local_file_rename':'local_file_move',{sourceId,operation:{path,...(change.kind==='rename'?{name}:{parent}),preferences:JSON.parse(JSON.stringify(store.preferences))}})}
 catch(cause){try{if(matches(await reconcile()))return {path:to,name:to.split('/').at(-1)!}}catch{/* Preserve the operation error; the durable log remains available for recovery. */}throw cause}
 if(receipt?.schemaVersion!==1||receipt.sourceId!==sourceId||receipt.from!==path||receipt.to!==to||receipt.directory!==directory||receipt.operationId!==null&&(typeof receipt.operationId!=='string'||!receipt.operationId))throw Error('本地'+label+'回执来源或路径不匹配，请刷新确认')
 if(receipt.operationId!==null){const confirmed=matches(await reconcile());if(!confirmed||confirmed.id!==receipt.operationId)throw Error('本地'+label+'已提交，但偏好确认尚未完成，请先恢复')}
 return {path:to,name:to.split('/').at(-1)!}
}
