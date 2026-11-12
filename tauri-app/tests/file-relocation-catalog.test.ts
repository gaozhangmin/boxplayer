import {describe,expect,it} from 'vitest'
import {updateMovedCatalogItems} from '@/features/files/drive/relocationCatalog'
import type {VideoItem} from '@/features/library/catalog'
const item=(fileId:string,ancestors:string[])=>({id:'stable-'+fileId,sourceId:'selected',fileId,fileName:fileId+'.mkv',name:'Manual title',metadataSource:'manual',folderPath:ancestors.at(-1),folderAncestors:ancestors,catalogRoots:['scan-root'],watched:true,progress:32,genres:[],size:1,type:'movie',local:false,addedAt:'fixture'} as VideoItem)
describe('stable remote IDs after a confirmed move',()=>{
 it('updates descendant ancestry using the deepest independently moved folder and preserves metadata',()=>{
  const descendant=item('movie',['','a','b','leaf']),other={...item('other',['','a']),sourceId:'other-account'}
  updateMovedCatalogItems([descendant,other],'selected',[{file_id:'a',isDir:true},{file_id:'b',isDir:true}],'target',['','target'])
  expect(descendant).toMatchObject({id:'stable-movie',folderPath:'leaf',folderAncestors:['','target','b','leaf'],name:'Manual title',metadataSource:'manual',watched:true,progress:32,catalogRoots:['scan-root']})
  expect(other.folderAncestors).toEqual(['','a'])
 })
 it('applies the confirmed automatic filename without overwriting manual titles or IDs',()=>{
  const manual=item('manual',['','old']),unmatched={...item('plain',['','old']),type:'unmatched',metadataSource:'filename',name:'plain.mkv'} as VideoItem
  updateMovedCatalogItems([manual,unmatched],'selected',[{file_id:'manual',isDir:false,name:'manual (1).mkv'},{file_id:'plain',isDir:false,name:'plain (1).mkv'}],'target',['','target'])
  expect(manual).toMatchObject({id:'stable-manual',fileName:'manual (1).mkv',name:'Manual title',folderPath:'target'})
  expect(unmatched).toMatchObject({id:'stable-plain',fileName:'plain (1).mkv',name:'plain (1).mkv',folderPath:'target'})
 })
 it('updates nested collection members and direct file parents without changing stable IDs',()=>{
  const child=item('file',['','old']),collection={...item('group',['']),collectionMovies:[child]}
  updateMovedCatalogItems([collection],'selected',[{file_id:'file',isDir:false}],'target',['','target'])
  expect(child).toMatchObject({id:'stable-file',folderPath:'target',folderAncestors:['','target'],catalogRoots:['scan-root'],progress:32})
  expect(collection.folderAncestors).toEqual([''])
 })
})
