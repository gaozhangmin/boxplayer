import * as views from './views'

export const MAX_FRAME_BYTES=1024*1024
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid request')
 return value as Record<string,unknown>
}
function id(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>256)throw new Error('Invalid identity')
 return value
}
function limit(value:unknown,fallback:number,max:number):number{
 if(value===undefined)return fallback
 if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>max)throw new Error('Invalid limit')
 return Number(value)
}
/** Deliberately no arbitrary SQL, path, credentials, task creation, or provider API. */
export async function dispatch(method:string,input:unknown){
 const args=object(input??{})
 switch(method){
  case 'status':return {storageReady:true,engineReady:true,workerReady:false,reason:'原引擎已集成，原生账号与模型配置尚未接通，不能创建、重试或巡检获取任务'}
  case 'listRuns':return views.listBoxPlayerRunViews(limit(args.limit,50,100))
  case 'getRun':return views.getBoxPlayerRunView(id(args.id))
  case 'listStates':return views.listBoxPlayerStates()
  case 'listTracking':return views.listBoxPlayerTracking()
  case 'listNotifications':return views.listBoxPlayerNotifications(limit(args.limit,100,200))
  case 'cancelRun':return views.cancelBoxPlayerRun(id(args.id))
  case 'endTracking':return views.endBoxPlayerTracking(id(args.id))
  case 'clearCompletedRuns':return views.clearCompletedBoxPlayerRuns()
  case 'clearNotifications':return views.clearBoxPlayerNotifications()
  case 'markNotificationsRead':{
   if(args.ids!==undefined&&(!Array.isArray(args.ids)||args.ids.length>500))throw new Error('Invalid notification identities')
   return views.markBoxPlayerNotificationsRead((args.ids as unknown[]|undefined)?.map(id))
  }
  default:throw new Error('Unsupported boxplayer operation')
 }
}
export async function request(frame:unknown){
 let requestId:unknown=null
 try{
  const data=object(frame);requestId=data.id
  if(!Number.isSafeInteger(requestId)||Number(requestId)<1)throw new Error('Invalid request identity')
  if(typeof data.method!=='string')throw new Error('Invalid operation')
  return {id:requestId,result:await dispatch(data.method,data.args)??null}
 }catch(error){
  // No provider/model secrets are handled in this phase. Keep unexpected engine
  // exceptions out of the renderer and process logs, preserving only known errors.
  const message=error instanceof Error?error.message:''
  const publicMessage=/^(Invalid |Unsupported boxplayer|任务已开始|该作品正在)/.test(message)?message:'媒体获取存储操作失败'
  return {id:Number.isSafeInteger(requestId)?requestId:null,error:{code:'BOXPLAYER_STORAGE',message:publicMessage,retryable:false}}
 }
}
