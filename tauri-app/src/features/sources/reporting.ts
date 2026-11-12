import type { PlayerSnapshot } from '@/platform/contracts'
import type { Account } from './contracts'
import { serverReport } from './mediaServer'
// Serialize updates so slow requests cannot reorder start/progress/stop reports.
export function createServerReporter(accounts:()=>Account[],onError:(error:unknown)=>void){
 let previous:PlayerSnapshot|undefined
 let lastAt=0
 let chain=Promise.resolve()
 let lastSequence=-1
 let active:PlayerSnapshot|undefined
 function send(snapshot:PlayerSnapshot,state:'start'|'progress'|'stop'){
  const account=accounts().find(a=>a.id===snapshot.sourceId&&['jellyfin','emby','plex'].includes(a.providerId));if(!account)return
  chain=chain.then(()=>serverReport(account,snapshot.itemId,state,snapshot.position,snapshot.state==='paused')).catch(onError)
 }
 return (snapshot:PlayerSnapshot)=>{
  if(snapshot.sequence<=lastSequence)return
  lastSequence=snapshot.sequence
  const changed=previous&&(snapshot.sessionId!==previous.sessionId||snapshot.itemId!==previous.itemId)
  if(changed&&active){send(active,'stop');active=undefined}
  if(['playing','paused'].includes(snapshot.state)){
   if(!active){send(snapshot,'start');lastAt=Date.now()}
   else if(Date.now()-lastAt>=5000||snapshot.state!==active.state){send(snapshot,'progress');lastAt=Date.now()}
   active={...snapshot}
  }else if(active&&snapshot.state!=='loading'){send({...active,position:snapshot.position,state:snapshot.state},'stop');active=undefined}
  previous={...snapshot}
 }
}
