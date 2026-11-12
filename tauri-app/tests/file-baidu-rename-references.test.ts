import {it,expect} from 'vitest'
import {emptyFilePreferences} from '@/features/files/preferences'
import {applyBaiduModelRename,updateBaiduRenameCatalog,baiduRenamedPreferences} from '@/features/files/drive/baiduRenameReferences'
import type {BaiduRenameResult} from '@/features/files/drive/baiduRenameMutations'
const result:BaiduRenameResult={file_id:'101',parent_file_id:'',name:'New',isDir:true,path:'/New',previousPath:'/Old',description:'baidu_fsid:101;baidu_path:/New'}
it('updates physical paths while retaining stable IDs, other sources and similarly prefixed directories',()=>{
 const items:any[]=[{id:'keep',sourceId:'source',fileId:'child',fileName:'Movie.mkv',name:'Custom',watched:true,progress:12,favorite:true,folderPath:'/Old/Sub',folderAncestors:['101','/Old','/Old/Sub'],catalogRoots:['101','/Old'],collectionMovies:[{sourceId:'other',folderPath:'/Old'}],originalMetadata:{folderPath:'/Old',collectionMovies:[{folderPath:'/Old',driveFiles:[{id:'other',driveServerId:'other',path:'/Old/Movie.mkv'}]}],driveFiles:[{id:'child',driveServerId:'source',path:'/Old/Movie.mkv',parentFileId:'101'},{id:'other',driveServerId:'other',path:'/Old/Movie.mkv'}]}},{sourceId:'other',folderPath:'/Old'},{sourceId:'source',folderPath:'/OldOther'}]
 updateBaiduRenameCatalog(items,'source',[result]);expect(items[0]).toMatchObject({id:'keep',fileId:'child',name:'Custom',progress:12,favorite:true,watched:true,folderPath:'/New/Sub',folderAncestors:['101','/New','/New/Sub'],catalogRoots:['101','/New']});expect(items[0].originalMetadata.driveFiles[0]).toMatchObject({path:'/New/Movie.mkv',parentFileId:'101'});expect(items[0].originalMetadata.driveFiles[1].path).toBe('/Old/Movie.mkv');expect(items[0].originalMetadata.collectionMovies[0].folderPath).toBe('/Old');expect(items[0].collectionMovies[0].folderPath).toBe('/Old');expect(items[1].folderPath).toBe('/Old');expect(items[2].folderPath).toBe('/OldOther')
})
it('moves legacy bookmark IDs with their custom name, cover, hidden status and order while leaving stable-ID favorites alone',()=>{
 const preferences=emptyFilePreferences(),from=JSON.stringify(['source','/Old']),to=JSON.stringify(['source','/New'])
 preferences.favorites=[{id:from,sourceId:'source',path:'/Old',name:'Custom title',local:false},{id:'stable',sourceId:'source',path:'101',name:'Stable',local:false},{id:'other',sourceId:'other',path:'/Old',name:'Other',local:false}];preferences.names[from]='Custom override';preferences.covers[from]='https://fixture.test/cover';preferences.hiddenOnHome[from]=true;preferences.order=['other',from,'stable']
 const next=baiduRenamedPreferences(preferences,'source',[result]);expect(next.favorites[0]).toEqual({id:to,sourceId:'source',path:'/New',name:'Custom title',local:false});expect(next.names[to]).toBe('Custom override');expect(next.covers[to]).toBe('https://fixture.test/cover');expect(next.hiddenOnHome[to]).toBe(true);expect(next.order).toEqual(['other',to,'stable']);expect(next.favorites[1]!.path).toBe('101');expect(next.favorites[2]!.path).toBe('/Old');expect(preferences.favorites[0]!.path).toBe('/Old')
})
it('rejects local preference collisions without mutating the previous snapshot',()=>{
 const preferences=emptyFilePreferences();preferences.favorites=['/Old','/New'].map(path=>({id:JSON.stringify(['source',path]),sourceId:'source',path,name:path,local:false}));const before=JSON.stringify(preferences);expect(()=>baiduRenamedPreferences(preferences,'source',[result])).toThrow('冲突');expect(JSON.stringify(preferences)).toBe(before)
})
it('updates model path and description but keeps native stable identities and descendant names',()=>{
 const row:any={file_id:'child',name:'Movie.mkv',path:'/Old/Sub/Movie.mkv',parent_file_id:'202',description:'old'};applyBaiduModelRename(row,result);expect(row).toMatchObject({file_id:'child',name:'Movie.mkv',path:'/New/Sub/Movie.mkv',parent_file_id:'202',description:'baidu_fsid:child;baidu_path:/New/Sub/Movie.mkv'})
 const selected:any={file_id:'101',name:'Old',path:'/Old',parent_file_id:''};applyBaiduModelRename(selected,result);expect(selected).toMatchObject({file_id:'101',name:'New',path:'/New'})
})
