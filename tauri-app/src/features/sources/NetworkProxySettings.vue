<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {toast} from 'vue-sonner'
import {ChevronDown} from 'lucide-vue-next'
import {Button} from '@/components/ui/button'
import {useSettingsStore} from '@/stores/settings'
import {asAppError,nativeCall} from '@/platform/native'
import type {ProxySettings} from '@/platform/contracts'
const settings=useSettingsStore(),en=computed(()=>settings.value.language==='en')
const mode=ref<ProxySettings['mode']>('system'),url=ref(''),testing=ref(false),result=ref('')
watch(()=>settings.value.proxy,value=>{mode.value=value?.mode||'system';url.value=value?.url||''},{immediate:true})
function draft():ProxySettings{return {mode:mode.value,url:url.value.trim()}}
function valid(){if(mode.value!=='custom'&&!url.value.trim())return true;try{const value=new URL(url.value.trim());return ['http:','https:','socks5:','socks5h:'].includes(value.protocol)&&!!value.hostname&&!value.username&&!value.password&&!value.search&&!value.hash&&['','/'].includes(value.pathname)&&value.port!=='0'}catch{return false}}
async function save(){if(!valid()){toast.error(en.value?'Enter a valid proxy address':'请输入有效的代理地址');return}try{await settings.save({proxy:draft()});result.value='';toast.success(en.value?'Saved. New requests use this proxy setting.':'已保存，新请求将立即使用此代理设置')}catch(error){toast.error(asAppError(error).message)}}
async function test(){if(!valid()){toast.error(en.value?'Enter a valid proxy address':'请输入有效的代理地址');return}testing.value=true;result.value='';try{const value=await nativeCall<{milliseconds:number}>('network_proxy_test',{proxy:draft()});result.value=(en.value?'Dropbox is reachable · ':'Dropbox 连接正常 · ')+value.milliseconds+' ms'}catch(error){result.value=asAppError(error).message}finally{testing.value=false}}
</script>
<template>
 <section class="settings-section"><h2>{{en?'Proxy':'代理设置'}}</h2>
  <form @submit.prevent="save"><div class="settings-card">
   <label class="setting-row"><span>{{en?'Connection mode':'连接方式'}}</span><span class="settings-select"><select v-model="mode" data-testid="proxy-mode" :disabled="testing"><option value="system">{{en?'Follow system':'跟随系统'}}</option><option value="direct">{{en?'Direct connection':'直连'}}</option><option value="custom">{{en?'Custom proxy':'自定义代理'}}</option></select><ChevronDown :size="14"/></span></label>
   <label v-if="mode==='custom'" class="setting-row proxy-address"><span>{{en?'Proxy address':'代理地址'}}</span><input v-model="url" data-testid="proxy-url" placeholder="http://127.0.0.1:7890" :disabled="testing" autocomplete="off" spellcheck="false" /></label>
   <div class="settings-card-note"><p>{{en?'Applies to account sign-in, cloud-drive requests and remote playback. Local addresses, private LAN IPs and .local hosts connect directly. Changes apply to new requests without restarting.':'用于账号登录、网盘请求和远程播放。本机地址、局域网 IP 和 .local 域名保持直连，保存后对新请求立即生效，无需重启。'}}</p>
   <p v-if="mode==='custom'">{{en?'HTTP, HTTPS, SOCKS5 and SOCKS5H are supported. Enter an address without a username or password.':'支持 HTTP、HTTPS、SOCKS5、SOCKS5H；请填写不含用户名和密码的代理地址。'}}</p>
   </div><div class="setting-row proxy-actions"><span>{{en?'Connection settings':'连接设置'}}</span><div><Button type="submit" data-testid="proxy-save" :disabled="testing">{{en?'Save':'保存'}}</Button><Button type="button" variant="outline" :disabled="testing" data-testid="proxy-test" @click="test">{{testing?(en?'Testing…':'正在测试…'):(en?'Test Dropbox connection':'测试 Dropbox 连接')}}</Button></div></div></div>
   <p v-if="result" role="status">{{result}}</p>
  </form>
 </section>
</template>
<style scoped>
.proxy-address input{width:min(100%,300px);flex:1;max-width:300px}.proxy-actions>div{display:flex;gap:8px;flex-wrap:wrap}.proxy-actions button{border-radius:6px;font-size:12px;height:30px;padding:5px 12px}p[role=status]{font-size:12px;line-height:1.6;color:var(--muted-text)}
</style>
