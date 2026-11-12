import {it,expect} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {developmentSigning,developmentSigningConfig} from '../scripts/development-signing.mjs'
it('uses a local stable identity only for macOS native build commands and preserves explicit overrides',()=>{
 const root=mkdtempSync(join(tmpdir(),'boxplayer-signing-'))
 try{
  const options={root,env:{},platform:'darwin',command:'build'}
  expect(developmentSigning(options)).toEqual({})
  mkdirSync(join(root,'.local'));writeFileSync(join(root,'.local/macos-signing.json'),JSON.stringify({identity:'Apple Development: Fixture'}))
  expect(developmentSigning(options)).toEqual({APPLE_SIGNING_IDENTITY:'Apple Development: Fixture'})
  expect(developmentSigning({...options,env:{APPLE_SIGNING_IDENTITY:'Explicit'}})).toEqual({})
  expect(developmentSigning({...options,platform:'linux'})).toEqual({})
  expect(developmentSigning({...options,command:'info'})).toEqual({})
  writeFileSync(join(root,'.local/macos-signing.json'),JSON.stringify({identity:'-'}));expect(()=>developmentSigning(options)).toThrow('signing identity')
 }finally{rmSync(root,{recursive:true,force:true})}
})

it('preserves the prior debug player runtime policy without changing release policy',()=>{
 const options={platform:'darwin',command:'build',debug:true,identity:'Apple Development: Fixture'}
 expect(developmentSigningConfig(options)).toEqual({bundle:{macOS:{hardenedRuntime:false}}})
 expect(developmentSigningConfig({...options,debug:false})).toBeUndefined()
 expect(developmentSigningConfig({...options,identity:undefined})).toBeUndefined()
 expect(developmentSigningConfig({...options,platform:'win32'})).toBeUndefined()
})
