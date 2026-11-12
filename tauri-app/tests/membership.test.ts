import { expect,it,vi } from 'vitest'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useMembershipStore,membershipTier,type Membership } from '@/stores/membership'
import { useFileSourcesStore } from '@/stores/fileSources'
import { nativeCall } from '@/platform/native'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(e:unknown)=>e}))
it('maps product identity before scope and never treats inherited keys as products',()=>{
 const value={isPro:true,productId:'com.macos.boxplayer.lifetimely',entitlementScope:'all',plan:'pro'} as Membership
 expect(membershipTier(value)).toBe('apple');expect(membershipTier({...value,productId:'constructor',entitlementScope:'android'})).toBe('android');expect(membershipTier({...value,isPro:false})).toBe('standard')
})
it('discards a former account response and clears membership on logout',async()=>{
 const pinia=createPinia(),sources=useFileSourcesStore(pinia),store=useMembershipStore(pinia)
 sources.accounts=['a','b'].map(id=>({id,providerId:'boxplayer',name:id,baseUrl:'https://site.test',authOrigins:['https://site.test']}));await nextTick()
 let resolve!:(value:unknown)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(done=>{resolve=done}))
 store.select('a');const pending=store.refresh();store.select('b');resolve({accountId:'a',isPro:true,entitlementScope:'all'});await pending;expect(store.membership).toBeUndefined()
 vi.mocked(nativeCall).mockResolvedValue({accountId:'b',isPro:true,entitlementScope:'android'});await store.refresh();expect(store.tier).toBe('android')
 sources.accounts=[];await nextTick();expect(store.membership).toBeUndefined();expect(store.selectedId).toBe('')
})
