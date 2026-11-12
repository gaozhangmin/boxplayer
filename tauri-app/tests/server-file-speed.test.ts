import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Speed from '@/features/sources/ServerFileSpeed.vue'
import { nativeCall } from '@/platform/native'
vi.mock('@/platform/native', () => ({ nativeCall: vi.fn() }))
const account={id:'plex-a',providerId:'plex' as const,name:'Plex',baseUrl:'https://server.test',authOrigins:['https://server.test']}
const entry={id:'video',name:'Film',isDirectory:false,playable:true,size:1024}
const snapshot={id:'test-a',accountId:account.id,status:'running',bytes:1024,totalBytes:4096,elapsedMs:250,currentMbps:8,averageMbps:7,minimumMbps:6,samples:[6,8],error:null}
let wrapper:ReturnType<typeof mount>|undefined
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers()})
afterEach(()=>{wrapper?.unmount();vi.useRealTimers()})
it('starts only on user action, polls metrics, and keeps the source account bound',async()=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='server_speed_start'?snapshot:command==='server_speed_state'?{...snapshot,status:'complete',bytes:4096}:snapshot)
 wrapper=mount(Speed,{props:{account,entry}});expect(nativeCall).not.toHaveBeenCalled();await wrapper.findAll('button').find(button=>button.text()==='开始测试')!.trigger('click');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('server_speed_start',expect.objectContaining({accountId:account.id,itemId:entry.id,requestId:expect.any(String)}));await vi.advanceTimersByTimeAsync(300);await flushPromises();expect(wrapper.text()).toContain('测试完成');expect(wrapper.text()).toContain('7.00 Mbps');expect(wrapper.get('svg polyline').attributes('points')).toContain(',');expect(vi.mocked(nativeCall).mock.calls.map(call=>call[0])).not.toContain('player_open_remote')
})
it('cancels a start result that returns after the dialog was closed',async()=>{
 let resolve!:(value:unknown)=>void;vi.mocked(nativeCall).mockImplementation(command=>command==='server_speed_start'?new Promise(done=>{resolve=done}):Promise.resolve(snapshot))
 wrapper=mount(Speed,{props:{account,entry}});await wrapper.findAll('button').find(button=>button.text()==='开始测试')!.trigger('click');await flushPromises();const request=vi.mocked(nativeCall).mock.calls[0]![1] as {requestId:string};wrapper.unmount();await flushPromises();expect(nativeCall).toHaveBeenCalledWith('auth_cancel',{requestId:request.requestId});resolve(snapshot);await flushPromises();expect(nativeCall).toHaveBeenCalledWith('server_speed_cancel',{testId:snapshot.id})
})
it('stopping cancels the running job and stops further polling',async()=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='server_speed_cancel'?{...snapshot,status:'stopped'}:snapshot)
 wrapper=mount(Speed,{props:{account,entry}});await wrapper.findAll('button').find(button=>button.text()==='开始测试')!.trigger('click');await flushPromises();await wrapper.findAll('button').find(button=>button.text()==='停止测试')!.trigger('click');await flushPromises();expect(wrapper.text()).toContain('测试已停止');await vi.advanceTimersByTimeAsync(1000);expect(nativeCall).not.toHaveBeenCalledWith('server_speed_state',expect.anything())
})
