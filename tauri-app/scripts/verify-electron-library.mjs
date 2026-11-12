import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const hash=value=>createHash('sha256').update(value).digest('hex')
const manifest=JSON.parse(readFileSync(new URL('../src/features/library/electron/upstream.json',import.meta.url),'utf8'))
const base=new URL('../',import.meta.url)
function template(text){const start=text.indexOf('<template>');if(start<0)return '';let end=text.indexOf('<script',start);if(end<0)end=text.indexOf('<style',start);return text.slice(start,end<0?undefined:end).trim()}
for(const file of manifest.files){const raw=readFileSync(new URL(file.snapshot,base)),target=readFileSync(new URL(file.target,base));if(hash(raw)!==file.sha256)throw Error(`Upstream snapshot changed: ${file.source}`);if(hash(target)!==file.targetSha256)throw Error(`Unreviewed migration drift: ${file.target}`);if(file.templatePolicy==='exact'&&template(raw.toString())!==template(target.toString()))throw Error(`Template differs from Electron: ${file.target}`)}
for(const asset of manifest.assets)if(hash(readFileSync(new URL(asset.target,base)))!==asset.sha256)throw Error(`Asset differs: ${asset.target}`)
console.log(`Verified ${manifest.files.length} Electron source mappings, ${manifest.files.filter(file=>file.templatePolicy==='exact').length} exact component templates, and ${manifest.assets.length} assets.`)
