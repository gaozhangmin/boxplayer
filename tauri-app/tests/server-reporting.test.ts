import { it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createServerReporter } from '@/features/sources/reporting'
import { serverReport } from '@/features/sources/mediaServer'
import type { PlayerSnapshot } from '@/platform/contracts'
vi.mock('@/features/sources/mediaServer',()=>({serverReport:vi.fn(async()=>{})}))
it('orders reports, stops old sessions and ignores stale snapshots',async()=>{
 vi.mocked(serverReport).mockClear()
 const report=createServerReporter(()=>[{id:'a',providerId:'jellyfin',name:'test',baseUrl:'https://example.test',authOrigins:['https://example.test']}],()=>{})
 const snapshot={sourceId:'a',sessionId:'s',itemId:'one',state:'playing',position:0,sequence:1} as PlayerSnapshot
 report(snapshot);report({...snapshot,sequence:2,state:'paused',position:3});report({...snapshot,sequence:1,position:1});report({...snapshot,sequence:3,sessionId:'next',itemId:'two'});report({...snapshot,sequence:4,sessionId:'next',itemId:'two',state:'ended',position:9})
 await flushPromises()
 expect(vi.mocked(serverReport).mock.calls.map(c=>[c[1],c[2],c[3]])).toEqual([['one','start',0],['one','progress',3],['one','stop',3],['two','start',0],['two','stop',9]])
})
it('stops an ended episode once before the next episode starts',async()=>{
 vi.mocked(serverReport).mockClear()
 const report=createServerReporter(()=>[{id:'a',providerId:'emby',name:'test',baseUrl:'https://example.test',authOrigins:['https://example.test']}],()=>{})
 const snapshot={sourceId:'a',sessionId:'one',itemId:'one',state:'playing',position:8,sequence:1} as PlayerSnapshot
 report(snapshot);report({...snapshot,sequence:2,state:'ended',position:10});report({...snapshot,sequence:3,sessionId:'two',itemId:'two',state:'loading',position:0});report({...snapshot,sequence:4,sessionId:'two',itemId:'two',position:0})
 await flushPromises()
 expect(vi.mocked(serverReport).mock.calls.map(c=>[c[1],c[2],c[3]])).toEqual([['one','start',8],['one','stop',10],['two','start',0]])
})
it('does not send stop/start for buffering or HLS recovery within the same session',async()=>{
 vi.mocked(serverReport).mockClear()
 const report=createServerReporter(()=>[{id:'a',providerId:'jellyfin',name:'test',baseUrl:'https://example.test',authOrigins:['https://example.test']}],()=>{})
 const snapshot={sourceId:'a',sessionId:'one',itemId:'one',state:'playing',position:8,sequence:1} as PlayerSnapshot
 report(snapshot);report({...snapshot,sequence:2,state:'loading'});report({...snapshot,sequence:3,position:8.1});report({...snapshot,sequence:4,state:'idle',position:9})
 await flushPromises();expect(vi.mocked(serverReport).mock.calls.map(c=>[c[2],c[3]])).toEqual([['start',8],['stop',9]])
})
