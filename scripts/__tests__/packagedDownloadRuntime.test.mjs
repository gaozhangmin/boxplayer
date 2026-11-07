import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it, expect } from 'vitest'
const require=createRequire(import.meta.url)
const asar=createRequire(require.resolve('electron-builder'))('@electron/asar')
const {verifyDownloadRuntime}=require('../check-packaged-download-runtime.cjs')
it('checks packaged entries and the transitive dependency closure, not only root declarations',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boxplayer-download-'))
 try {
 const source=path.join(root,'app'),archive=path.join(root,'app.asar')
 function pkg(name,dependencies={}){const dir=path.join(source,'node_modules',name);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,main:'index.js',dependencies}));writeFileSync(path.join(dir,'index.js'),'module.exports = {}')}
 pkg('aria2-lib',{ws:'1'});pkg('@motrix/nat-api');await asar.createPackage(source,archive)
 expect(()=>verifyDownloadRuntime(archive)).toThrow('missing dependency ws')
 pkg('ws');await asar.createPackage(source,archive);expect(verifyDownloadRuntime(archive)).toHaveLength(3)
 rmSync(path.join(source,'node_modules/@motrix/nat-api/index.js'));await asar.createPackage(source,archive)
 expect(()=>verifyDownloadRuntime(archive)).toThrow('missing entry point')
 } finally {rmSync(root,{recursive:true,force:true})}
})
