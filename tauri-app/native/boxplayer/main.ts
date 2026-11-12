import {mkdirSync,chmodSync} from 'node:fs'
import {isAbsolute,join} from 'node:path'
import {openHost,closeHost} from './host'
import {MAX_FRAME_BYTES,request} from './protocol'
import {startBoxPlayerHost,stopBoxPlayerHost} from './engine'

// Library debug output must never share the JSON protocol or log account data.
console.log=console.warn=console.error=()=>{}
process.env.BOXPLAYER_AGENT_LOG='0'

// Rust supplies the application data directory as an argv entry, never a
// renderer-supplied database path. stdout is exclusively bounded JSON frames.
const directory=process.argv[2]
if(!directory||!isAbsolute(directory))process.exit(2)
mkdirSync(directory,{recursive:true,mode:0o700})
const path=join(directory,'boxplayer.db')
await openHost(path)
startBoxPlayerHost()
if(process.platform!=='win32')chmodSync(path,0o600)
try{
 let pending=Buffer.alloc(0)
 for await(const chunk of Bun.stdin.stream()){
  pending=Buffer.concat([pending,Buffer.from(chunk)])
  let newline:number
  while((newline=pending.indexOf(10))>=0){
   if(newline>MAX_FRAME_BYTES)process.exit(3)
   const line=pending.subarray(0,newline).toString('utf8');pending=pending.subarray(newline+1)
   let frame:unknown
   try{frame=JSON.parse(line)}catch{process.exit(3)}
   const reply=JSON.stringify(await request(frame))
   if(Buffer.byteLength(reply)>MAX_FRAME_BYTES){await Bun.write(Bun.stdout,JSON.stringify({id:(frame as {id:unknown}).id,error:{code:'BOXPLAYER_LIMIT',message:'任务记录过大',retryable:false}})+'\n')}
   else await Bun.write(Bun.stdout,reply+'\n')
  }
  if(pending.length>MAX_FRAME_BYTES)process.exit(3)
 }
}finally{stopBoxPlayerHost();closeHost()}
