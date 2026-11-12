import {expect,it,vi} from 'vitest'
import {playSource} from '@/features/sources/drivers'
import {nativeCall} from '@/platform/native'
import type {Account,SourceEntry} from '@/features/sources/contracts'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(async()=>true)}))
it('passes the visible playable siblings in order with the selected index, without eager link requests',async()=>{
 const entries:SourceEntry[]=[{id:'folder',name:'folder',isDirectory:true,playable:false,size:0},...['a','b'].map(id=>({id,name:id+'.mp4',isDirectory:false,playable:true,size:10}))]
 await playSource({id:'server',providerId:'jellyfin'} as Account,entries[2]!,entries)
 expect(nativeCall).toHaveBeenCalledTimes(1);expect(nativeCall).toHaveBeenCalledWith('player_open_source_queue',{accountId:'server',entries:[{fileId:'a',title:'a.mp4'},{fileId:'b',title:'b.mp4'}],index:1})
})
