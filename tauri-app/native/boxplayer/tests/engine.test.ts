import {afterEach,expect,it} from 'bun:test'
import {MockLanguageModelV3} from 'ai/test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openHost,closeHost,getBoxPlayerRepository,saveDriveTarget} from '../host'
import {tick,stopBoxPlayerHost,createAccountContextResolver} from '../engine'
import {bindBoxPlayerRuntime,unbindBoxPlayerRuntime} from '../runtimeBindings'
import {queueTrackingInitialization} from '../upstream/commands'
import {FakeStorageExecutor} from '../upstream/fakes'
import type {MediaTitle,TrackedSeason} from '../upstream/domain'

let directory:string|undefined
const title:MediaTitle={id:'synthetic-title',tmdbId:42,type:'tv',title:'Show',originalTitle:'Show',aliases:[],year:2026}
const season:TrackedSeason={id:'synthetic-season',mediaTitleId:title.id,seasonNumber:1,status:'active',qualityPreference:'4K',storageDirectoryId:'show-s1',totalEpisodes:2,latestAiredEpisode:1,latestAiredSource:'metadata'}
const config={model:null,boxplayerApiBaseURL:'https://synthetic.invalid'}
afterEach(()=>{stopBoxPlayerHost();unbindBoxPlayerRuntime();closeHost();if(directory)rmSync(directory,{recursive:true,force:true});directory=undefined})
async function setup(){directory=mkdtempSync(join(tmpdir(),'boxplayer-engine-'));await openHost(join(directory,'boxplayer.db'));const target=await saveDriveTarget({platform:'quark',userId:'synthetic-a',driveId:'drive-a',folderId:'folder-a'});await queueTrackingInitialization({title,season,keyword:'Show',repository:getBoxPlayerRepository(),connectedStorageId:target.id,createWorkflowRunId:()=> 'synthetic-run'});return target}
it('runs the original host, worker and AI tool loop against native SQLite with private injected ports',async()=>{
 const target=await setup();let resolved='';let modelCalls=0;let resourceCalls=0
 const storage=new FakeStorageExecutor()
 const model=new MockLanguageModelV3({doGenerate:async()=>{
  modelCalls++
  return {content:[{type:'tool-call' as const,toolCallId:'no-coverage',toolName:'reportNoCoverage',input:JSON.stringify({reason:'Synthetic fixture has no resources'})}],finishReason:{unified:'tool-calls' as const,raw:'tool-calls'},usage:{inputTokens:{total:0,noCache:0,cacheRead:0,cacheWrite:0},outputTokens:{total:0,text:0,reasoning:0}},warnings:[]}
 }})
 bindBoxPlayerRuntime({requestConfig:async()=>config,resolveStorage:entry=>{resolved=entry.id;return storage},requestResource:async()=>{resourceCalls++;return {ok:true,status:200,data:{code:0,data:{results:{}}}}},createModel:()=>model})
 const context=await createAccountContextResolver(config)('acct_default',target.id)
 expect(context.storageParentDirectoryId).toBe('folder-a')
 await tick()
 expect(resolved).toBe(target.id);expect(resourceCalls).toBeGreaterThan(0);expect(modelCalls).toBeGreaterThan(0)
 const snapshot=await getBoxPlayerRepository().getWorkflowRunSnapshot('synthetic-run')
 expect(snapshot!.workflowRun.status).toBe('no_coverage')
 expect(snapshot!.notifications.length).toBeGreaterThan(0)
 expect(snapshot!.episodes.every(episode=>!episode.obtained)).toBe(true)
},20000)
it('leaves queued tasks untouched while native runtime ports are unbound',async()=>{
 await setup();await tick()
 expect((await getBoxPlayerRepository().getWorkflowRunSnapshot('synthetic-run'))!.workflowRun.status).toBe('queued')
})
