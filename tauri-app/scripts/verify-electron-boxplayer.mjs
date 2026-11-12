import {readFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {boxPlayerBranding} from './source-audit/branding.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')
const base=new URL('../',import.meta.url)
const manifest=JSON.parse(readFileSync(new URL('native/boxplayer/upstream.json',base),'utf8'))
for(const file of manifest.files){
 const target=readFileSync(new URL(file.target,base))
 if(hash(target)!==file.targetSha256)throw Error(`Unreviewed migration drift: ${file.target}`)
 const source=file.snapshot?readFileSync(new URL(file.snapshot,base)):target
 if(hash(source)!==file.sha256)throw Error(`Upstream source changed: ${file.source}`)
 if(file.policy==='branding-only'&&boxPlayerBranding(source.toString())!==target.toString())throw Error(`Business logic differs from original: ${file.target}`)
 if(file.policy==='exact'&&hash(target)!==file.sha256)throw Error(`Original file differs: ${file.target}`)
}
console.log(`Verified ${manifest.files.length} BoxPlayer engine mappings (${manifest.files.filter(file=>['branding-only','exact'].includes(file.policy)).length} original files with branding-only changes).`)
// Archived sources and provenance retain their factual names; runtime files do not.
const obsolete=/mediary|\bscou(?:n)?t\b/i
function verifyNames(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(entry.name==='source-audit'||entry.name==='upstream.json'||entry.name.endsWith('.source'))continue
  const path=new URL(entry.name+(entry.isDirectory()?'/':''),directory)
  if(obsolete.test(entry.name))throw Error(`Obsolete engine filename: ${path.pathname}`)
  if(entry.isDirectory())verifyNames(path)
  else if(obsolete.test(readFileSync(path,'utf8')))throw Error(`Obsolete engine branding: ${path.pathname}`)
 }
}
verifyNames(new URL('native/boxplayer/',base))
console.log('Verified BoxPlayer runtime naming; original audit records excluded.')
