import {describe,it,expect} from 'vitest'
import {prepareAliCrossDriveReferences,type AliCrossDriveReferenceInput} from '@/features/files/drive/aliCrossDriveReferences'
import {emptyFilePreferences} from '@/features/files/preferences'
import type {VideoItem} from '@/features/library/catalog'
const source='ali',id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),old=(file:string)=>id('resource',file),next=(file:string)=>id('backup',file),media=(file:string)=>JSON.stringify([source,file])
function fixture(){
 const before=[{id:old('folder'),parent:old('root'),name:'Folder',isDirectory:true,size:0},{id:old('video'),parent:old('folder'),name:'movie.mkv',isDirectory:false,size:10}],after=[{id:next('folder2'),parent:next('target'),name:'Folder (1)',isDirectory:true,size:0},{id:next('video2'),parent:next('folder2'),name:'movie.mkv',isDirectory:false,size:10}]
 const input:AliCrossDriveReferenceInput={sourceId:source,before,after,selected:[old('folder')],destination:next('target'),destinationAncestors:['',next('root'),next('target')],pairs:before.map((row,index)=>({from:row.id,to:after[index]!.id}))}
 const item={id:media(old('video')),sourceId:source,fileId:old('video'),fileName:'movie.mkv',name:'My title',type:'movie',local:false,addedAt:'2026-01-01',genres:['Drama'],size:10,metadataSource:'manual',watched:true,progress:42,personalRating:9,folderPath:old('folder'),folderAncestors:['',old('root'),old('folder')],catalogRoots:[old('folder'),old('root')],originalMetadata:{id:media(old('video')),name:'My title',folderId:old('folder'),folderPath:old('folder'),lastPlayedFileId:media(old('video')),driveFiles:[{id:media(old('video')),userId:source,driveId:source,driveServerId:source,path:old('video'),parentFileId:old('folder'),name:'movie.mkv',sourceFolderIds:[old('folder')]}]}} as unknown as VideoItem
 const catalog={schemaVersion:1,revision:7,items:[item],playlists:{Mix:[item.id]},series:{Series:[item.id]}},preferences=emptyFilePreferences(),favorite=media(old('folder'))
 preferences.favorites=[{id:favorite,sourceId:source,path:old('folder'),name:'My folder label',local:false}];preferences.names[favorite]='Renamed';preferences.covers[favorite]='cover';preferences.hiddenOnHome[favorite]=true;preferences.order=[favorite]
 return {input,catalog,preferences,item}
}
const prepare=(value:ReturnType<typeof fixture>)=>prepareAliCrossDriveReferences(value.catalog,value.preferences,value.input)
describe('detached reference drafts for a verified full Ali cross-drive identity map',()=>{
 it('moves catalog IDs, ancestry, collection membership and folder bookmarks without losing metadata',()=>{
  const value=fixture(),previous=JSON.stringify(value),result=prepare(value),item=result.catalog.items[0]!,favorite=media(next('folder2'))
  expect(item).toMatchObject({id:media(next('video2')),fileId:next('video2'),folderPath:next('folder2'),folderAncestors:['',next('root'),next('target'),next('folder2')],catalogRoots:[next('folder2'),old('root')],name:'My title',watched:true,progress:42,personalRating:9,metadataSource:'manual'})
  expect(result.catalog.playlists.Mix).toEqual([item.id]);expect(result.catalog.series.Series).toEqual([item.id]);expect(result.catalog.revision).toBe(7)
  expect(result.preferences.favorites[0]).toMatchObject({id:favorite,path:next('folder2'),name:'My folder label'});expect(result.preferences.names[favorite]).toBe('Renamed');expect(result.preferences.covers[favorite]).toBe('cover');expect(result.preferences.hiddenOnHome[favorite]).toBe(true);expect(result.preferences.order).toEqual([favorite]);expect(JSON.stringify(value)).toBe(previous)
  expect(result.identityMoves).toContainEqual({sourceId:source,from:old('video'),to:next('video2')})
 })
 it('updates retained original metadata and drive-file parent/last-played references',()=>{
  const item=prepare(fixture()).catalog.items[0]!.originalMetadata as any
  expect(item).toMatchObject({id:media(next('video2')),folderId:next('folder2'),folderPath:next('folder2'),lastPlayedFileId:media(next('video2'))})
  expect(item.driveFiles[0]).toMatchObject({id:media(next('video2')),path:next('video2'),parentFileId:next('folder2'),sourceFolderIds:[next('folder2')]})
 })
 it('leaves other accounts and local bookmarks unchanged even with matching paths',()=>{
  const value=fixture();const other={...value.item,id:'other',sourceId:'other'};value.catalog.items.push(other);value.preferences.favorites.push({id:'other',sourceId:'other',path:old('folder'),name:'Other',local:false},{id:'local',sourceId:source,path:old('folder'),name:'Local',local:true});const result=prepare(value);expect(result.catalog.items[1]).toEqual(other);expect(result.preferences.favorites.slice(1)).toEqual(value.preferences.favorites.slice(1))
 })
 it('preserves non-derived legacy media IDs and their group references',()=>{const value=fixture();value.item.id='legacy';value.catalog.playlists.Mix=['legacy'];value.catalog.series.Series=['legacy'];const result=prepare(value);expect(result.catalog.items[0]!.id).toBe('legacy');expect(result.catalog.playlists.Mix).toEqual(['legacy']);expect(result.catalog.items[0]!.fileId).toBe(next('video2'))})
 it('does not rewrite foreign-account original metadata with identical remote locations',()=>{
  const value=fixture(),metadata=value.item.originalMetadata as any
  metadata.collectionMovies=[{id:'foreign',folderId:old('folder'),folderPath:old('folder'),lastPlayedFileId:old('video'),driveFiles:[{id:'foreign-file',path:old('video'),parentFileId:old('folder'),userId:'other',driveId:'other',driveServerId:'other'}]}]
  expect((prepare(value).catalog.items[0]!.originalMetadata as any).collectionMovies).toEqual(metadata.collectionMovies)
 })
 it('updates nested collection members while retaining the collection parent',()=>{const value=fixture();const child=value.item;value.catalog.items=[{...child,id:'collection',sourceId:'other',fileId:'group',collectionMovies:[child]}];value.catalog.playlists.Mix=['collection'];value.catalog.series.Series=['collection'];const result=prepare(value);expect(result.catalog.items[0]!.id).toBe('collection');expect(result.catalog.items[0]!.collectionMovies![0]!.fileId).toBe(next('video2'))})
 it('rejects target catalog and favorites collisions without modifying input',()=>{
  const value=fixture();value.catalog.items.push({...value.item,id:media(next('video2')),fileId:next('video2'),folderPath:next('folder2'),folderAncestors:['',next('target'),next('folder2')]});const original=JSON.stringify(value);expect(()=>prepare(value)).toThrow('媒体库身份');expect(JSON.stringify(value)).toBe(original)
  const other=fixture();other.preferences.favorites.push({id:media(next('folder2')),sourceId:source,path:next('folder2'),name:'Exists',local:false});expect(()=>prepare(other)).toThrow('已有收藏')
 })
 it('rejects conflicting display settings instead of merging user labels',()=>{const value=fixture();value.preferences.names[media(next('folder2'))]='Existing';expect(()=>prepare(value)).toThrow('显示设置冲突')})
 it('rejects missing media descendants and malformed destination ancestry',()=>{
  const value=fixture();value.input.before=value.input.before.slice(0,1);value.input.after=value.input.after.slice(0,1);value.input.pairs=value.input.pairs.slice(0,1);expect(()=>prepare(value)).toThrow('遗漏媒体库后代')
  const other=fixture();other.input.destinationAncestors=['',old('root'),next('target')];expect(()=>prepare(other)).toThrow('目标盘不匹配')
 })
})
