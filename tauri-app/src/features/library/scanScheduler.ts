export interface ScanTarget{sourceId:string;root:string}
export function scanTargets(items:Array<{sourceId:string;catalogRoots?:string[]}>,favorites:Array<{sourceId:string;path:string}>,available:Set<string>):ScanTarget[]{
 const result=new Map<string,ScanTarget>()
 for(const item of items)for(const root of item.catalogRoots||[''])if(available.has(item.sourceId))result.set(JSON.stringify([item.sourceId,root]),{sourceId:item.sourceId,root})
 for(const favorite of favorites)if(available.has(favorite.sourceId))result.set(JSON.stringify([favorite.sourceId,favorite.path]),{sourceId:favorite.sourceId,root:favorite.path})
 return [...result.values()]
}
/** One scan at a time, successful checkpoints only. Failures use bounded retry
 * backoff; stopping/disabling prevents later targets from the old pass. */
export function createScanScheduler(ports:{targets:()=>ScanTarget[];interval:()=>number;busy:()=>boolean;scan:(target:ScanTarget)=>Promise<void>;now:()=>number;read:(key:string)=>number;write:(key:string,time:number)=>void;error:(error:unknown)=>void}){
 let running=false,stopped=false,generation=0
 const retry=new Map<string,number>()
 async function tick(){if(stopped||running||ports.busy()||ports.interval()<=0)return;running=true;const pass=generation
 try{for(const target of ports.targets()){
  if(stopped||pass!==generation||ports.interval()<=0||ports.busy())return
  const key=JSON.stringify([target.sourceId,target.root]),now=ports.now()
  if(now-ports.read(key)<ports.interval()*60000||now<(retry.get(key)||0))continue
  try{await ports.scan(target);if(stopped||pass!==generation)return;ports.write(key,ports.now());retry.delete(key)}catch(error){retry.set(key,ports.now()+60000);ports.error(error)}
 }}finally{running=false}}
 return{tick,stop(){stopped=true;generation++},invalidate(){generation++}}
}
