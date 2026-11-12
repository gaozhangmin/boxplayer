import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import ServerRating from '@/features/servers/ServerRating.vue'
import ServerShare from '@/features/servers/ServerShare.vue'
import { normalizeItem } from '@/features/servers/workspace'
import { serverIdentity } from '@/features/servers/identity'
import { loadTraktStatus, personalTraktRatings, publicTraktRating, syncTrakt } from '@/features/trakt/client'
vi.mock('@/features/trakt/client',()=>({loadTraktStatus:vi.fn(),personalTraktRatings:vi.fn(),publicTraktRating:vi.fn(),syncTrakt:vi.fn(),traktError:()=> 'Trakt 请求失败'}))
beforeEach(()=>{vi.clearAllMocks();const entries=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value)});vi.mocked(loadTraktStatus).mockResolvedValue({connected:true,configured:true,settings:{enabled:true,range:-1}});vi.mocked(personalTraktRatings).mockResolvedValue([]);vi.mocked(publicTraktRating).mockResolvedValue({rating:8.5,votes:200,distribution:{}});vi.mocked(syncTrakt).mockResolvedValue()})
it('extracts exact Jellyfin/Emby IDs and Plex Guids without guessing from titles or ratingKey',()=>{
 expect(serverIdentity({ProviderIds:{Tmdb:'42',Imdb:'tt123'}},false)).toEqual({tmdbId:42,imdbId:'tt123'})
 expect(serverIdentity({Guid:[{id:'tmdb://42'},{id:'imdb://tt123'}]},true)).toEqual({tmdbId:42,imdbId:'tt123'})
 expect(serverIdentity({guid:'com.plexapp.agents.themoviedb://42?lang=en'},true).tmdbId).toBe(42)
 expect(serverIdentity({ratingKey:'42',title:'42'},true)).toEqual({tmdbId:undefined,imdbId:undefined});expect(serverIdentity({ProviderIds:{Tmdb:'0',Imdb:'bad'}},false)).toEqual({tmdbId:undefined,imdbId:undefined})
})
it('loads an exact personal episode rating, saves to Trakt and removes with the same episode identity',async()=>{
 const item=normalizeItem({Id:'ep',Type:'Episode',Name:'Episode',ProviderIds:{Tmdb:'42',Imdb:'tt123'}},false)
 vi.mocked(personalTraktRatings).mockResolvedValue([{rating:7,rated_at:'2026-11-07',episode:{ids:{tmdb:42}}}])
 const wrapper=mount(ServerRating,{props:{accountId:'account-a',item}});await flushPromises();expect(personalTraktRatings).toHaveBeenCalledWith('episodes',1);expect(wrapper.get('[aria-label="7 分"]').attributes('aria-checked')).toBe('true');await wrapper.get('[aria-label="9 分"]').trigger('click');await wrapper.find('form').trigger('submit');await flushPromises();expect(syncTrakt).toHaveBeenCalledWith({type:'episode',tmdbId:42,imdbId:'tt123'},'rating',9);expect(wrapper.emitted('rated')?.[0]).toEqual([9]);await wrapper.get('[aria-label="9 分"]').trigger('click');await wrapper.find('form').trigger('submit');await flushPromises();expect(syncTrakt).toHaveBeenLastCalledWith({type:'episode',tmdbId:42,imdbId:'tt123'},'rating-remove',undefined);wrapper.unmount()
})
it('offers exactly ten valid star choices and shows real Trakt failures without reporting success',async()=>{
 const wrapper=mount(ServerRating,{props:{accountId:'account-a',item:normalizeItem({Id:'m',Type:'Movie',Name:'Film',ProviderIds:{Tmdb:42}},false)}});await flushPromises();expect(wrapper.findAll('[role=radio]')).toHaveLength(10);expect(wrapper.find('[aria-label="11 分"]').exists()).toBe(false);expect(syncTrakt).not.toHaveBeenCalled();await wrapper.get('[aria-label="8 分"]').trigger('click');vi.mocked(syncTrakt).mockRejectedValueOnce(new Error('offline'));await wrapper.find('form').trigger('submit');await flushPromises();expect(wrapper.find('[role=alert]').text()).toContain('Trakt');expect(wrapper.emitted('rated')).toBeUndefined();wrapper.unmount()
})
it('shares server metadata through real clipboard copying even without a file link',async()=>{
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
 const wrapper=mount(ServerShare,{props:{accountId:'account-a',item:normalizeItem({Id:'m',Type:'Movie',Name:'Film',ProductionYear:2026,Overview:'Server overview'},false)}});await wrapper.findAll('button').find(button=>button.text()==='复制媒体介绍')!.trigger('click');await flushPromises();expect(writeText).toHaveBeenCalledWith('Film\n2026\nServer overview');expect(wrapper.get('textarea').element.value).toBe('Film\n2026\nServer overview');wrapper.unmount()
})

it('offline and disabled Trakt retain account-scoped local defaults and save without syncing',async()=>{
 const {readServerRatings,saveServerRating,serverRatingKey}=await import('@/features/servers/personalRatings');saveServerRating('account-a','m',6);saveServerRating('account-b','m',4)
 vi.mocked(loadTraktStatus).mockResolvedValue({configured:true,connected:false,settings:{enabled:true,range:-1}})
 const item=normalizeItem({Id:'m',Type:'Movie',Name:'Film'},false),wrapper=mount(ServerRating,{props:{accountId:'account-a',item}});await flushPromises();expect(wrapper.get('[aria-label="6 分"]').attributes('aria-checked')).toBe('true');await wrapper.get('[aria-label="8 分"]').trigger('click');await wrapper.find('form').trigger('submit');await flushPromises();expect(syncTrakt).not.toHaveBeenCalled();expect(readServerRatings()[serverRatingKey('account-a','m')]).toBe(8);expect(readServerRatings()[serverRatingKey('account-b','m')]).toBe(4)
 vi.mocked(loadTraktStatus).mockResolvedValue({configured:true,connected:true,settings:{enabled:false,range:-1}});await wrapper.get('[aria-label="9 分"]').trigger('click');await wrapper.find('form').trigger('submit');await flushPromises();expect(syncTrakt).not.toHaveBeenCalled();expect(readServerRatings()[serverRatingKey('account-a','m')]).toBe(9);wrapper.unmount()
})
it('Trakt sync errors preserve the prior local score atomically',async()=>{
 const {readServerRatings,saveServerRating,serverRatingKey}=await import('@/features/servers/personalRatings');saveServerRating('account-a','m',6);vi.mocked(syncTrakt).mockRejectedValueOnce(new Error('offline'))
 const wrapper=mount(ServerRating,{props:{accountId:'account-a',item:normalizeItem({Id:'m',Type:'Movie',Name:'Film',ProviderIds:{Tmdb:42}},false)}});await flushPromises();await wrapper.get('[aria-label="9 分"]').trigger('click');await wrapper.find('form').trigger('submit');await flushPromises();expect(readServerRatings()[serverRatingKey('account-a','m')]).toBe(6);expect(wrapper.emitted('rated')).toBeUndefined();wrapper.unmount()
})
