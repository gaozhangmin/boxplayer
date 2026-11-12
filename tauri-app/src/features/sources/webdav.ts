import type { Account, SourceDriver, SourcePage, SourceEntry } from './contracts'
import { request, text } from './transport'
import {originalDavModel,readonlySourceCheck} from '@/features/files/drive/readonlyDavMapping'
function tags(node: Document | Element, name: string): Element[] { return Array.from(node.getElementsByTagName('*')).filter(e=>e.localName.split(':').pop()===name) }
function decodedPath(url:URL){const path=decodeURIComponent(url.pathname);if(/[\u0000-\u001f\\]/.test(path)||path.split('/').some(part=>part==='.'||part==='..'))throw Error('WebDAV路径无效');return path}
function davUrl(account: Account, path: string) {
 const root=new URL(account.baseUrl.endsWith('/')?account.baseUrl:account.baseUrl+'/'),target=new URL(['','root','backup_root','/'].includes(path)?root.href:path,root)
 const rootPath=decodedPath(root).replace(/\/+$/,'')+'/',actual=decodedPath(target)
 if(!['http:','https:'].includes(root.protocol)||root.username||root.password||root.search||root.hash||target.username||target.password||target.search||target.hash||target.origin!==root.origin||!(actual===rootPath.slice(0,-1)||actual.startsWith(rootPath)))throw Error('WebDAV 路径超出来源范围')
 return target
}
export function parseDav(account: Account, path: string, xml: string): SourcePage {
 const target=davUrl(account,path)
 if(/<!DOCTYPE/i.test(xml))throw Error('WebDAV XML 不支持文档类型声明')
 const doc=new DOMParser().parseFromString(xml,'application/xml')
 if(doc.getElementsByTagName('parsererror').length)throw Error('WebDAV 返回了无效 XML')
 const entries:SourceEntry[]=[],seen=new Set<string>(),parent=decodedPath(target).replace(/\/+$/,'')
 for(const item of tags(doc,'response')){
  const href=tags(item,'href')[0]?.textContent;if(!href)continue
  const url=davUrl(account,new URL(href,target).href),location=decodedPath(url).replace(/\/+$/,'')
  if(location===parent)continue
  const props=tags(item,'propstat').find(row=>/\s200\s/.test(tags(row,'status')[0]?.textContent??''));if(!props)continue
  if(location.slice(0,location.lastIndexOf('/'))!==parent)throw Error('WebDAV目录包含非直接子项')
  if(seen.has(location))throw Error('WebDAV目录包含重复文件');seen.add(location)
  const name=tags(props,'displayname')[0]?.textContent||decodeURIComponent(url.pathname.replace(/\/$/,'').split('/').at(-1)||'')
  if(!name||/[\u0000-\u001f/\\]/.test(name))throw Error('WebDAV文件名称无效')
  const isDirectory=tags(props,'collection').length>0,sizeValue=tags(props,'getcontentlength')[0]?.textContent||'0',size=Number(sizeValue)
  if(!/^\d+$/.test(sizeValue)||!Number.isSafeInteger(size)||size<0)throw Error('WebDAV文件大小无效')
  const modified=tags(props,'getlastmodified')[0]?.textContent||'',mime=tags(props,'getcontenttype')[0]?.textContent||''
  if(modified&&!Number.isFinite(Date.parse(modified)))throw Error('WebDAV文件时间无效')
  const model=originalDavModel(account,{filename:url.pathname,basename:name,type:isDirectory?'directory':'file',size,mime,lastmod:modified})
  if(!Number.isFinite(model.time)||model.isDir!==isDirectory||model.size!==size)throw Error('WebDAV原文件模型无效')
  const electronModel={...model,drive_id:account.id,file_id:url.href,parent_file_id:path}
  entries.push({id:url.href,name:model.name,isDirectory:model.isDir,size:model.size,playable:!model.isDir&&['video','video2'].includes(model.category),modified:model.time,electronModel} as SourceEntry)
 }
 return {entries}
}
export const webdav: SourceDriver = {
 async list(account,parent,cursor){
  const check=readonlySourceCheck(account);check();if(account.providerId!=='webdav'||cursor)throw Error('WebDAV来源或分页位置无效')
  const url=davUrl(account,parent)
  const response=await request(account,'PROPFIND',url.href,'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/></d:prop></d:propfind>',{Depth:'1','Content-Type':'application/xml'})
  check();return parseDav(account,parent,text(response))
 },
 async resolve(account,entry){const check=readonlySourceCheck(account);check();if(account.providerId!=='webdav'||entry.isDirectory)throw Error('WebDAV文件无效');const url=davUrl(account,entry.id).href;return {schemaVersion:1,sourceId:account.id,accountId:account.id,fileId:entry.id,url,headers:{}}}
}
