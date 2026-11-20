import {it,expect} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {developmentRunnerEnvironment} from '../scripts/development-signing.mjs'
import {signDevelopmentExecutable} from '../scripts/sign-development-executable.mjs'
const root=resolve(import.meta.dirname,'..')
const options={root,args:['dev'],platform:'darwin',runnerPath:'/tmp/signed-dev-fixture/run',nodePath:process.execPath,env:{APPLE_SIGNING_IDENTITY:'Apple Development: Fixture'}}
it('configures both Darwin runners only for macOS native dev, regardless of target source',()=>{
 const result=developmentRunnerEnvironment(options)
 expect(result.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER).toBe(options.runnerPath)
 expect(result.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER).toBe(options.runnerPath)
 expect(result.BOXPLAYER_DEV_NODE).toBe(process.execPath)
 expect(developmentRunnerEnvironment({...options,args:['dev','--release']})).toEqual(result)
 expect(developmentRunnerEnvironment({...options,args:['dev','--','--target','x86_64-apple-darwin']})).toEqual(result)
 expect(developmentRunnerEnvironment({...options,env:{...options.env,CARGO_BUILD_TARGET:'x86_64-apple-darwin'}})).toEqual(result)
 for(const change of [{platform:'linux'},{args:['build','--debug']},{args:['dev','--help']}])expect(developmentRunnerEnvironment({...options,...change})).toEqual({})
})
it('preserves application/Cargo arguments and rejects higher-priority runner overrides',()=>{
 const args=['dev','--target','x86_64-apple-darwin','--','--features','fixture','--','--config','file with spaces.mkv']
 const before=[...args]
 developmentRunnerEnvironment({...options,args})
 expect(args).toEqual(before)
 expect(()=>developmentRunnerEnvironment({...options,args:['dev','--','--config','target.x86_64-apple-darwin.runner="other"']})).toThrow('Cargo --config')
 expect(()=>developmentRunnerEnvironment({...options,args:['dev','--runner','other']})).toThrow('Custom Tauri runners')
})
it('fails closed for missing/adhoc identities or conflicting environment runners',()=>{
 for(const identity of [undefined,'','-','--force','bad\nidentity'])expect(()=>developmentRunnerEnvironment({...options,env:{APPLE_SIGNING_IDENTITY:identity}})).toThrow('stable signing identity')
 expect(()=>developmentRunnerEnvironment({...options,runnerPath:'/tmp/path with spaces/run'})).toThrow('without whitespace')
 for(const target of ['AARCH64_APPLE_DARWIN','X86_64_APPLE_DARWIN'])expect(()=>developmentRunnerEnvironment({...options,env:{...options.env,[`CARGO_TARGET_${target}_RUNNER`]:'custom'}})).toThrow('custom Cargo target runner')
})
it('signs with the configured identity and effective identifier, then verifies',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'dev-sign-fixture-'))
 try{
  mkdirSync(join(fixture,'src-tauri'));writeFileSync(join(fixture,'src-tauri/tauri.conf.json'),JSON.stringify({identifier:'com.fixture.base'}))
  const executable=join(fixture,'binary with spaces');writeFileSync(executable,'fixture')
  const calls:Array<{command:string;args:string[]}>=[]
  signDevelopmentExecutable({root:fixture,executable,env:{APPLE_SIGNING_IDENTITY:'Apple Development: Fixture',TAURI_CONFIG:JSON.stringify({identifier:'com.fixture.effective'})},run:(command:string,args:string[])=>{calls.push({command,args});return {status:0}}})
  expect(calls).toEqual([{command:'/usr/bin/codesign',args:['--force','--sign','Apple Development: Fixture','--identifier','com.fixture.effective','--timestamp=none',executable]},{command:'/usr/bin/codesign',args:['--verify','--strict',executable]}])
  writeFileSync(join(fixture,'src-tauri/tauri.macos.conf.json'),JSON.stringify({identifier:'com.fixture.platform'}))
  calls.length=0
  signDevelopmentExecutable({root:fixture,executable,env:options.env,run:(command:string,args:string[])=>{calls.push({command,args});return {status:0}}})
  expect(calls[0].args).toContain('com.fixture.platform')
  writeFileSync(join(fixture,'src-tauri/tauri.macos.conf.json'),JSON.stringify({identifier:'com.fixture.reloaded'}))
  calls.length=0
  signDevelopmentExecutable({root:fixture,executable,env:{...options.env,TAURI_CONFIG:JSON.stringify({identifier:'com.fixture.cli'})},run:(command:string,args:string[])=>{calls.push({command,args});return {status:0}}})
  expect(calls[0].args).toContain('com.fixture.cli')
  let count=0
  expect(()=>signDevelopmentExecutable({root:fixture,executable,env:options.env,run:()=>{count++;return {status:1}}})).toThrow('app was not started')
  expect(count).toBe(1)
 }finally{rmSync(fixture,{recursive:true,force:true})}
})
it('preserves spaced app arguments and never launches after a signer failure',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'dev runner spaces-'))
 try{
  const signer=join(fixture,'signer.mjs'),app=join(fixture,'app.sh'),trace=join(fixture,'trace')
  writeFileSync(signer,'import {appendFileSync} from "node:fs";appendFileSync(process.env.TRACE,"sign\\n");process.exit(Number(process.env.FAIL||0))')
  writeFileSync(app,'#!/bin/sh\nprintf "run:%s\\n" "$1" >> "$TRACE"\n',{mode:0o700})
  const args=[join(root,'scripts/macos-dev-runner.sh'),app,'literal $() with spaces']
  const invoke=(fail:string)=>spawnSync('/bin/sh',args,{env:{...process.env,TRACE:trace,FAIL:fail,BOXPLAYER_DEV_NODE:process.execPath,BOXPLAYER_DEV_SIGNER:signer},encoding:'utf8'})
  expect(invoke('7').status).toBe(7);expect(readFileSync(trace,'utf8')).toBe('sign\n')
  writeFileSync(trace,'');expect(invoke('0').status).toBe(0);expect(readFileSync(trace,'utf8')).toBe('sign\nrun:literal $() with spaces\n')
 }finally{rmSync(fixture,{recursive:true,force:true})}
})

it('rejects configured runners and unsupported platform configs before signing',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'dev-config-'))
 try{
  mkdirSync(join(fixture,'src-tauri'))
  writeFileSync(join(fixture,'src-tauri/tauri.conf.json'),JSON.stringify({identifier:'com.fixture.dev',build:{runner:'custom'}}))
  expect(()=>developmentRunnerEnvironment({...options,root:fixture})).toThrow('Custom Tauri runners')
  writeFileSync(join(fixture,'src-tauri/tauri.conf.json'),JSON.stringify({identifier:'com.fixture.dev'}))
  for(const args of [['dev','-r/custom'],['dev','--config','{"build":{"runner":"custom"}}'],['dev','-c{"build":{"runner":"custom"}}']])expect(()=>developmentRunnerEnvironment({...options,root:fixture,args})).toThrow('Custom Tauri runners')
  writeFileSync(join(fixture,'src-tauri/Tauri.macos.toml'),'identifier = "com.fixture.other"')
  let calls=0
  expect(()=>signDevelopmentExecutable({root:fixture,executable:'unused',env:options.env,run:()=>{calls++;return {status:0}}})).toThrow('requires JSON')
  expect(calls).toBe(0)
 }finally{rmSync(fixture,{recursive:true,force:true})}
})
