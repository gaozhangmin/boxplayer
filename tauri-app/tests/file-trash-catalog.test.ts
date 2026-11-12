import {describe,it,expect} from 'vitest'
import {purgeDeletedCatalog} from '@/features/files/drive/trashCatalog'
import type {VideoItem} from '@/features/library/catalog'
describe('confirmed provider deletion and native video catalog',()=>{
 it('removes folder descendants and references without touching another account or unconfirmed entries',()=>{
  const items=[{id:'nested',sourceId:'selected',fileId:'movie',folderAncestors:['','folder','child']},{id:'direct',sourceId:'selected',fileId:'file'},{id:'failed',sourceId:'selected',fileId:'unconfirmed'},{id:'other',sourceId:'other',fileId:'file'}] as VideoItem[]
  const snapshot={items,playlists:{watch:['nested','direct','failed','other']},series:{series:['nested','failed']}}
  purgeDeletedCatalog(snapshot,'selected',[{file_id:'folder',isDir:true},{file_id:'file',isDir:false}])
  expect(snapshot.items.map(item=>item.id)).toEqual(['failed','other']);expect(snapshot.playlists.watch).toEqual(['failed','other']);expect(snapshot.series.series).toEqual(['failed'])
 })
})
