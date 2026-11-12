import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { nativeCall, asAppError } from '@/platform/native'
import { useFileSourcesStore } from './fileSources'
export interface Membership { accountId:string;isPro:boolean;plan:string;productId:string;entitlementScope:string;currentPeriodEnd:string|null }
export type ProTier='standard'|'all'|'android'|'apple'
// Same product identities as Electron src/utils/boxplayerProTier.ts and the website catalog.
const products:Record<string,ProTier>={
 'com.boxplayer.earlybird.lifetimely':'apple','com.boxplayer.lifetimely':'apple','com.ios.boxplayer.lifetimely':'apple','com.tvos.boxplayer.lifetimely':'apple','com.macos.boxplayer.lifetimely':'apple',
 'com.boxplayer.sub.year':'apple','com.boxplayer.sub.month':'apple','boxplayer.pro.monthly':'apple','boxplayer.pro.yearly':'apple','boxplayer.pro.lifetime':'apple',
 'com.boxplayer.account.pro':'all',web_monthly:'all',web_yearly:'all',lifetime:'all',android_lifetime:'android',pro:'all',
}
export function membershipTier(value?:Membership):ProTier {
 if(!value?.isPro)return 'standard'
 const lookup=(key:string)=>Object.hasOwn(products,key.trim().toLowerCase())?products[key.trim().toLowerCase()]:undefined
 const product=lookup(value.productId||'');if(product)return product
 const scope=(value.entitlementScope||'').toLowerCase();if(scope==='android')return 'android';if(scope==='apple'||scope.startsWith('apple_'))return 'apple';if(scope==='all')return 'all'
 return lookup(value.plan||'')||'all'
}
export const useMembershipStore=defineStore('membership',()=>{
 const sources=useFileSourcesStore(),selectedId=ref(''),membership=ref<Membership>(),loading=ref(false),error=ref('')
 const accounts=computed(()=>sources.accounts.filter(a=>a.providerId==='boxplayer'))
 let generation=0
 function invalidate(){++generation;membership.value=undefined;loading.value=false;error.value=''}
 function select(id:string){if(selectedId.value!==id){invalidate();selectedId.value=id}}
 watch(selectedId,()=>invalidate(),{flush:'sync'})
 watch(()=>accounts.value.map(a=>a.id),ids=>{if(!ids.includes(selectedId.value))select(ids[0]||'')},{immediate:true})
 async function refresh(){
  const id=selectedId.value
  if(!id||!accounts.value.some(a=>a.id===id)){invalidate();return}
  const current=++generation;membership.value=undefined;error.value='';loading.value=true
  try{const result=await nativeCall<Membership>('boxplayer_subscription',{accountId:id});if(result.accountId!==id)throw new Error('会员状态与账号不匹配');if(current===generation&&id===selectedId.value)membership.value=result}
  catch(cause){if(current===generation)error.value=asAppError(cause).message}
  finally{if(current===generation)loading.value=false}
 }
 const tier=computed(()=>membershipTier(membership.value))
 const label=computed(()=>tier.value==='android'?'BoxPlayer Pro · Android':tier.value==='apple'?'BoxPlayer Pro · Apple':'BoxPlayer Pro')
 return{selectedId,accounts,membership,loading,error,tier,label,select,refresh,invalidate}
})
