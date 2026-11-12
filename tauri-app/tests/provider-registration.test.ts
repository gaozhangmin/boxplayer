import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadProviderRegistration,parseRegistration,registrationKeys} from '../scripts/provider-registration.mjs'
const directories:string[]=[]
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})})
function fixture(){const base=mkdtempSync(join(tmpdir(),'boxplayer-registration-'));directories.push(base);const worktree=join(base,'tauri'),shared=join(base,'main'),root=join(worktree,'tauri-app');mkdirSync(root,{recursive:true});mkdirSync(join(shared,'src'),{recursive:true});return {root,worktree,shared}}
const generated=()=>registrationKeys.map(key=>`export const ${key} = ${JSON.stringify('synthetic-'+key)}`).join('\n')
it('loads shared-worktree app registration without copying account data or unrelated secrets',()=>{
 const {root,shared}=fixture();writeFileSync(join(shared,'src/secrets.generated.ts'),generated()+'\nexport const APPLE_PASSWORD = "must-not-import"\nexport const ACCOUNT_TOKEN = "must-not-import"')
 const result=loadProviderRegistration({root,sharedRoot:shared,env:{}})
 expect(result.missing).toEqual([]);expect(result.configured).toHaveLength(registrationKeys.length)
 expect(Object.keys(result.env)).not.toContain('BOXPLAYER_APPLE_PASSWORD');expect(Object.values(result.env)).not.toContain('must-not-import')
 expect(result.env.BOXPLAYER_GOOGLE_CLIENT_ID).toBe('synthetic-GOOGLE_CLIENT_ID')
})
it('keeps explicit environment and local-worktree overrides ahead of shared defaults',()=>{
 const {root,worktree,shared}=fixture();mkdirSync(join(worktree,'src'));writeFileSync(join(shared,'src/secrets.generated.ts'),generated());writeFileSync(join(worktree,'src/secrets.generated.ts'),'export const GOOGLE_CLIENT_ID = "local-id"\nexport const BOX_CLIENT_ID = ""')
 const result=loadProviderRegistration({root,sharedRoot:shared,env:{BOXPLAYER_ONEDRIVE_CLIENT_ID:'environment-id'}})
 expect(result.env.BOXPLAYER_ONEDRIVE_CLIENT_ID).toBe('environment-id');expect(result.env.BOXPLAYER_GOOGLE_CLIENT_ID).toBe('local-id');expect(result.env.BOXPLAYER_BOX_CLIENT_ID).toBe('synthetic-BOX_CLIENT_ID')
})
it('fails app builds on missing registration instead of shipping empty login defaults',()=>{
 const {root}=fixture();expect(()=>loadProviderRegistration({root,sharedRoot:null,env:{BOXPLAYER_GOOGLE_CLIENT_SECRET:'never-log-me'}})).toThrow('Missing application registration:')
 try{loadProviderRegistration({root,sharedRoot:null,env:{BOXPLAYER_GOOGLE_CLIENT_SECRET:'never-log-me'}})}catch(error){expect(String(error)).not.toContain('never-log-me')}
})
it('does not execute generated-file expressions while parsing registration',()=>{
 expect(parseRegistration('export const GOOGLE_CLIENT_ID = globalThis.malicious()\nexport const GOOGLE_CLIENT_SECRET = "synthetic";')).toEqual({GOOGLE_CLIENT_SECRET:'synthetic'})
})
