import {afterEach,beforeEach,describe,expect,it} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openHost,closeHost,getBoxPlayerRepository,saveDriveTarget,driveTargetId} from '../host'
import {dispatch,request} from '../protocol'
import {queueTrackingInitialization} from '../upstream/commands'
import type {MediaTitle,TrackedSeason} from '../upstream/domain'

let directory:string
const title:MediaTitle={id:'show-1',tmdbId:100,type:'tv',title:'Synthetic show',originalTitle:'Synthetic show',aliases:[],year:2026}
const season:TrackedSeason={id:'show-1-s1',mediaTitleId:title.id,seasonNumber:1,totalEpisodes:3,latestAiredEpisode:2,latestAiredSource:'metadata',storageDirectoryId:'',status:'active',qualityPreference:'4K'}
const target={platform:'quark',userId:'synthetic-account-a',driveId:'drive-a',folderId:'folder-a'}
async function queue(storage:string,run='run-a'){
 return queueTrackingInitialization({title,season,keyword:title.title,repository:getBoxPlayerRepository(),connectedStorageId:storage,createWorkflowRunId:()=>run})
}
beforeEach(async()=>{directory=mkdtempSync(join(tmpdir(),'tauri-boxplayer-'));await openHost(join(directory,'boxplayer.db'))})
afterEach(()=>{closeHost();rmSync(directory,{recursive:true,force:true})})
describe('original Electron boxplayer repository on native SQLite',()=>{
 it('persists queued tasks and projects the original UI contract across restart',async()=>{
  const drive=await saveDriveTarget(target);await queue(drive.id)
  closeHost();await openHost(join(directory,'boxplayer.db'))
  const rows=await dispatch('listRuns',{}) as any[]
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({id:'run-a',status:'queued',progress:0,target:{tmdbId:100,targetUserId:target.userId,targetDriveId:'drive-a',targetParentFileId:'folder-a'}})
  expect(await dispatch('status',{})).toMatchObject({storageReady:true,workerReady:false})
 })
 it('requeues an interrupted running task on restart without pretending it completed',async()=>{
  const drive=await saveDriveTarget(target);await queue(drive.id)
  const repository=getBoxPlayerRepository()
  const snapshot=(await repository.getWorkflowRunSnapshot('run-a'))!
  snapshot.workflowRun.status='running';await repository.saveWorkflowRunSnapshot(snapshot)
  closeHost();await openHost(join(directory,'boxplayer.db'))
  expect(await dispatch('getRun',{id:'run-a'})).toMatchObject({status:'queued'})
  expect(await dispatch('listNotifications',{})).toEqual([])
 })
 it('refuses duplicate work on the same drive but isolates the same title on another drive',async()=>{
  const first=await saveDriveTarget(target),second=await saveDriveTarget({...target,userId:'synthetic-account-b'})
  expect((await queue(first.id)).status).toBe('queued')
  expect((await queue(first.id,'duplicate')).status).toBe('already_running')
  expect((await queue(second.id,'run-b')).status).toBe('queued')
  const rows=await dispatch('listRuns',{}) as any[]
  expect(new Set(rows.map(row=>row.target.targetUserId))).toEqual(new Set(['synthetic-account-a','synthetic-account-b']))
 })
 it('cancels only queued work and preserves running work',async()=>{
  const drive=await saveDriveTarget(target);await queue(drive.id)
  expect(await dispatch('cancelRun',{id:'run-a'})).toBeNull()
  expect(await dispatch('getRun',{id:'run-a'})).toBeNull()
  expect(await dispatch('listRuns',{})).toEqual([])
  const second=await saveDriveTarget({...target,userId:'synthetic-account-b'});await queue(second.id,'run-b')
  const repository=getBoxPlayerRepository(),snapshot=(await repository.getWorkflowRunSnapshot('run-b'))!
  snapshot.workflowRun.status='running';await repository.saveWorkflowRunSnapshot(snapshot)
  await expect(dispatch('cancelRun',{id:'run-b'})).rejects.toThrow('任务已开始执行')
  expect(await dispatch('getRun',{id:'run-b'})).toMatchObject({status:'searching'})
 })
 it('rolls back all parts of an invalid snapshot instead of partially changing a task',async()=>{
  const drive=await saveDriveTarget(target);await queue(drive.id)
  const repository=getBoxPlayerRepository(),snapshot=(await repository.getWorkflowRunSnapshot('run-a'))!
  snapshot.title.title='Should not persist'
  snapshot.episodes.push({...snapshot.episodes[0]})
  await expect(repository.saveWorkflowRunSnapshot(snapshot)).rejects.toThrow()
  expect((await repository.getWorkflowRunSnapshot('run-a'))!.title.title).toBe('Synthetic show')
 })
 it('preserves scoped target identity and creation time when preferences change',async()=>{
  const first=await saveDriveTarget(target)
  const second=await saveDriveTarget({...target,preferredQuality:'4K'})
  expect(second.id).toBe(first.id);expect(second.createdAt).toBe(first.createdAt)
  expect(driveTargetId({...target,platform:'alipan',folderId:'root'})).toBe(driveTargetId({...target,platform:'aliyun',folderId:'root'}))
  expect(driveTargetId({...target,driveId:'drive-b'})).not.toBe(first.id)
 })
 it('rejects unavailable execution and invalid requests without changing storage',async()=>{
  for(const method of ['createRun','retryRun','runPatrol','sql','getCredentials'])expect(await request({id:1,method,args:{}})).toMatchObject({id:1,error:{code:'BOXPLAYER_STORAGE'}})
  expect(await request({id:2,method:'getRun',args:{id:''}})).toMatchObject({error:{message:'Invalid identity'}})
  expect(await request({id:3,method:'listRuns',args:{limit:10000}})).toMatchObject({error:{message:'Invalid limit'}})
  expect(await dispatch('listRuns',{})).toEqual([])
 })
})
