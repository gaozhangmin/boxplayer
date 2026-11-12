import {expect,it} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {MAX_FRAME_BYTES} from '../protocol'

const binary=process.env.BOXPLAYER_TEST_BINARY||join(import.meta.dir,'../../../src-tauri/binaries',`boxplayer-host-${process.arch==='arm64'?'aarch64':'x86_64'}-${process.platform==='darwin'?'apple-darwin':process.platform==='win32'?'pc-windows-msvc':'unknown-linux-gnu'}${process.platform==='win32'?'.exe':''}`)
async function execute(input:string){
 const directory=mkdtempSync(join(tmpdir(),'boxplayer-process-'))
 try{
  const child=Bun.spawn([binary,directory],{stdin:new Blob([input]),stdout:'pipe',stderr:'pipe'})
  const [output,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
  expect(stderr).toBe('')
  return {output,exit}
 }finally{rmSync(directory,{recursive:true,force:true})}
}
it('bundles SQLite without a separately installed Bun or Electron native addon',async()=>{
 const result=await execute('{"id":1,"method":"status","args":{}}\n{"id":2,"method":"listRuns","args":{}}\n')
 expect(result.exit).toBe(0)
 expect(result.output.trim().split('\n').map(row=>JSON.parse(row))).toEqual([
  {id:1,result:{storageReady:true,engineReady:true,workerReady:false,reason:'原引擎已集成，原生账号与模型配置尚未接通，不能创建、重试或巡检获取任务'}},
  {id:2,result:[]}
 ])
})
it('ends cleanly on truncated input and refuses malformed JSON or oversized frames',async()=>{
 const truncated=await execute('{"id":1');expect(truncated.output).toBe('')
 const malformed=await execute('invalid\n');expect(malformed.exit).toBe(3)
 const oversized=await execute('x'.repeat(MAX_FRAME_BYTES+1)+'\n');expect(oversized.exit).toBe(3)
},15000)
