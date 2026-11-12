import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const hash=value=>createHash('sha256').update(value).digest('hex')
const manifest=JSON.parse(readFileSync(new URL('../src/features/files/electron/upstream.json',import.meta.url),'utf8'))
const base=new URL('../',import.meta.url)
function template(text){const start=text.indexOf('<template>');if(start<0)return '';let end=text.indexOf('<script',start);if(end<0)end=text.indexOf('<style',start);return text.slice(start,end<0?undefined:end).trim()}
for(const file of manifest.files){
 const raw=readFileSync(new URL(file.snapshot,base)),target=readFileSync(new URL(file.target,base))
 if(hash(raw)!==file.sha256)throw Error(`Upstream snapshot changed: ${file.source}`)
 if(hash(target)!==file.targetSha256)throw Error(`Unreviewed migration drift: ${file.target}`)
 if(file.sourceAppend!==undefined&&!Buffer.concat([raw,Buffer.from(file.sourceAppend)]).equals(target))throw Error(`Wrapped source differs from Electron: ${file.target}`)
 if(Array.isArray(file.extraction)){
  const upstream=ts.createSourceFile(file.source,raw.toString(),ts.ScriptTarget.Latest,true)
  const migrated=ts.createSourceFile(file.target,target.toString(),ts.ScriptTarget.Latest,true)
  const statement=(file,name)=>file.statements.find(node=>node.name?.getText(file)===name||node.declarationList?.declarations.some(declaration=>declaration.name.getText(file)===name))?.getText(file)
  for(const name of file.extraction){
   let expected=statement(upstream,name)
   if(!expected)throw Error(`Missing upstream declaration ${name}: ${file.source}`)
   for(const replacement of file.extractedReplacements||[])expected=expected.replaceAll(replacement.from,replacement.to)
   if(expected!==statement(migrated,name))throw Error(`Extracted declaration differs from Electron: ${file.target}:${name}`)
  }
 }
 if(Array.isArray(file.ifBranchExtractions)){
  const upstream=ts.createSourceFile(file.source,raw.toString(),ts.ScriptTarget.Latest,true),migrated=ts.createSourceFile(file.target,target.toString(),ts.ScriptTarget.Latest,true)
  for(const extraction of file.ifBranchExtractions){
   const branches=[];const visit=node=>{if(ts.isIfStatement(node)&&node.expression.getText(upstream)===extraction.condition)branches.push(node);ts.forEachChild(node,visit)};visit(upstream)
   if(branches.length!==1)throw Error(`Missing or ambiguous upstream branch: ${file.source}`)
   let expected=branches[0].getText(upstream)
   for(const replacement of extraction.replacements||[]){if(!expected.includes(replacement.from))throw Error(`Missing branch replacement: ${file.target}`);expected=expected.replaceAll(replacement.from,replacement.to)}
   const actual=migrated.statements.find(node=>node.name?.getText(migrated)===extraction.targetName)?.getText(migrated)
   if(expected!==actual)throw Error(`Extracted branch differs from Electron: ${file.target}`)
  }
 }
 if(Array.isArray(file.classMemberExtractions)){
  const upstream=ts.createSourceFile(file.source,raw.toString(),ts.ScriptTarget.Latest,true),migrated=ts.createSourceFile(file.target,target.toString(),ts.ScriptTarget.Latest,true)
  for(const extraction of file.classMemberExtractions){
   const owner=upstream.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.getText(upstream)===extraction.className)
   let expected=owner?.members.find(node=>node.name?.getText(upstream)===extraction.member)?.getText(upstream)
   if(!expected)throw Error(`Missing upstream class method: ${file.source}:${extraction.member}`)
   for(const replacement of extraction.replacements||[])expected=expected.replaceAll(replacement.from,replacement.to)
   const actual=migrated.statements.find(node=>node.name?.getText(migrated)===extraction.targetName||node.declarationList?.declarations.some(declaration=>declaration.name.getText(migrated)===extraction.targetName))?.getText(migrated)
   if(expected!==actual)throw Error(`Extracted class method differs from Electron: ${file.target}:${extraction.member}`)
  }
 }
 if(file.templatePolicy==='exact'&&template(raw.toString())!==template(target.toString()))throw Error(`Template differs from Electron: ${file.target}`)
 if(file.templatePolicy==='pruned'||file.templatePolicy==='extended'){
  let expected=template(raw.toString())
  for(const node of file.removedTemplateNodes||[]){if(!expected.includes(node.source))throw Error(`Missing declared source node: ${file.target}`);expected=expected.replace(node.source,'')}
  for(const replacement of file.templateReplacements||[])expected=expected.replaceAll(replacement.from,replacement.to)
  if(expected.trim()!==template(target.toString()))throw Error(`Retained template differs from Electron after declared exclusions: ${file.target}`)
 }
}
for(const asset of manifest.assets)if(hash(readFileSync(new URL(asset.target,base)))!==asset.sha256)throw Error(`Asset differs: ${asset.target}`)
console.log(`Verified ${manifest.files.length} Electron source mappings, ${manifest.files.filter(file=>file.templatePolicy==='exact').length} exact component templates, and ${manifest.assets.length} assets.`)
