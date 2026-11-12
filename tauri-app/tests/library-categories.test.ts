import {describe,it,expect} from 'vitest'
import {categoryItems,categoryGroups} from '@/features/library/categories'
import type {VideoItem} from '@/features/library/catalog'
const item=(id:string,patch:Partial<VideoItem>={}):VideoItem=>({id,sourceId:'source',fileId:id,fileName:id,name:id,type:'movie',local:true,addedAt:'2026-01-01',genres:[],size:1,...patch})
describe('Electron video category semantics',()=>{
 it('keeps special types strict instead of inferring them from file names',()=>{
  const rows=[item('Mini concert short S01E01',{type:'tv'}),item('confirmed',{type:'tv',isMiniseries:true})]
  expect(categoryItems(rows,'tv/mini').map(item=>item.id)).toEqual(['confirmed'])
  expect(categoryItems(rows,'movies/concerts')).toEqual([])
 })
 it('uses fixed score and decade order and canonical child routes',()=>{
  const rows=[item('old',{year:'1930',rating:5}),item('new',{year:'2026',rating:9}),item('middle',{year:'2001',rating:7})]
  expect(categoryGroups(rows,'movies/years').map(group=>decodeURIComponent(group.route.split('/').at(-1)!))).toEqual(['year:newest','2020+','2000s','year:earlier'])
  expect(categoryGroups(rows,'movies/ratings').map(group=>decodeURIComponent(group.route.split('/').at(-1)!))).toEqual(['rating:top30','rating:8-10','rating:7','rating:5'])
  expect(categoryItems(rows,'movies/ratings/rating%3A8-10').map(item=>item.id)).toEqual(['new'])
 })
 it('separates movie and TV facets and unwatched state',()=>{
  const rows=[item('movie',{genres:['Drama'],watched:true}),item('tv',{type:'tv',genres:['Drama']})]
  expect(categoryItems(rows,'movies/genres/Drama').map(item=>item.id)).toEqual(['movie'])
  expect(categoryItems(rows,'unwatched').map(item=>item.id)).toEqual(['tv'])
 })
})

it('supports resolution facets without making unknown videos SD',()=>{
 const rows=[item('4K',{fileName:'Film.2160p.mkv'}),item('unknown'),item('HD',{height:1080})]
 expect(categoryGroups(rows,'movies/resolution').map(group=>group.title)).toEqual(['4K','1080p'])
 expect(categoryItems(rows,'movies/resolution/4K').map(item=>item.id)).toEqual(['4K'])
 expect(categoryItems(rows,'movies/resolution/SD')).toEqual([])
})
