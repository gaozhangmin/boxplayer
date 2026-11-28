<script setup lang="ts">
import { ref, watch } from 'vue'
import {traktStatus,traktAccount,loadTraktStatus,loadTraktAccount,disconnectTrakt,setTraktSettings,openTraktPage,loadTraktPlayback,traktError,type PlaybackProgress} from './client'
import { useTraktDeviceLogin } from './useTraktDeviceLogin'
const props=withDefaults(defineProps<{visible?:boolean}>(),{visible:true})
const emit=defineEmits<{close:[];progress:[records:PlaybackProgress[]]}>()
const busy=ref(false),error=ref(''),avatarFailed=ref(false)
let generation=0
async function perform(action:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';const attempt=generation;try{await action()}catch(e){if(attempt===generation)error.value=traktError(e)}finally{if(attempt===generation)busy.value=false}}
async function sync(){if(traktStatus.value.settings.enabled&&traktStatus.value.connected){const records=await loadTraktPlayback();if(props.visible&&traktStatus.value.connected&&traktStatus.value.settings.enabled)emit('progress',records)}}
async function refresh(){await loadTraktStatus();if(!props.visible)return;if(traktStatus.value.connected){await loadTraktAccount();avatarFailed.value=false;await sync()}}
const { device, starting, start, cancel, openVerification } = useTraktDeviceLogin(
  () => perform(async () => { await setTraktSettings({...traktStatus.value.settings,enabled:true}); await refresh() }),
  cause => { error.value = traktError(cause) },
)
async function close(){generation++;await cancel();emit('close')}
async function disconnect(){await perform(disconnectTrakt)}
async function settings(enabled:boolean,range:number){await perform(async()=>{await setTraktSettings({enabled,range});await sync()})}
watch(()=>props.visible,visible=>{generation++;busy.value=false;if(visible)void perform(refresh);else void cancel()},{immediate:true})
defineExpose({refresh:()=>perform(refresh),sync:()=>perform(sync)})
</script>
<template>
 <div v-if="visible" class="trakt-mask" @click.self="close"><section class="trakt-account" role="dialog" aria-modal="true" aria-labelledby="trakt-title" @keydown.esc="close">
  <button class="close" aria-label="关闭 Trakt" @click="close">×</button>
  <template v-if="traktStatus.connected">
   <div class="avatar"><img v-if="traktAccount?.avatar&&!avatarFailed" :src="traktAccount.avatar" alt="Trakt 账户头像" referrerpolicy="no-referrer" @error="avatarFailed=true"/><span v-else aria-label="默认账户头像">{{(traktAccount?.name||'T').slice(0,1)}}</span></div>
   <span v-if="traktAccount?.vip" class="vip">Trakt VIP</span><button v-else class="vip" @click="perform(()=>openTraktPage('vip'))">开通 VIP ↗</button>
   <h2 id="trakt-title">{{traktAccount?.name||traktAccount?.username||'Trakt'}}</h2>
   <div class="stats" :aria-busy="busy"><div><strong>{{traktAccount?.episodes??'—'}}</strong><span>剧集</span></div><div><strong>{{traktAccount?.shows??'—'}}</strong><span>电视节目</span></div><div><strong>{{traktAccount?.movies??'—'}}</strong><span>电影</span></div></div>
   <label>同步记录<input type="checkbox" :checked="traktStatus.settings.enabled" :disabled="busy" @change="settings(($event.target as HTMLInputElement).checked,traktStatus.settings.range)"/></label>
   <p class="note">开启后导入匹配媒体的播放进度，并同步待看列表和个人评分。</p>
   <label>同步时间范围<select :value="traktStatus.settings.range" :disabled="busy" @change="settings(traktStatus.settings.enabled,Number(($event.target as HTMLSelectElement).value))"><option :value="-1">所有</option><option :value="7">最近一周</option><option :value="30">最近一个月</option><option :value="180">最近半年</option><option :value="365">最近一年</option></select></label>
   <footer><button :disabled="busy" @click="perform(refresh)">刷新与同步</button><button :disabled="busy" @click="disconnect">退出登录</button></footer>
  </template>
  <template v-else>
   <h2 id="trakt-title">Trakt</h2><p>连接 Trakt，同步待看列表和个人评分。</p>
   <template v-if="device">
    <p>在浏览器登录 Trakt，然后输入以下授权码。</p>
    <strong class="device-code">{{device.userCode}}</strong>
    <p role="status">等待浏览器授权…</p>
    <button @click="error = ''; openVerification()">打开授权网页</button>
    <button @click="error = ''; cancel()">取消授权</button>
   </template>
   <template v-else>
    <p v-if="!traktStatus.configured" class="note">Trakt 服务尚未配置。</p>
    <button :disabled="busy||starting||!traktStatus.configured" @click="error = ''; start()">连接 Trakt</button>
   </template>
  </template>
  <p v-if="busy||starting" role="status">正在处理…</p><div v-if="error" role="alert" class="error">{{error}}<button v-if="traktStatus.connected || !traktStatus.configured" :disabled="busy" @click="perform(refresh)">重试</button></div>
 </section></div>
</template>
<style scoped>
.trakt-mask{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center}.trakt-account{position:relative;box-sizing:border-box;width:min(384px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:28px 22px;border-radius:14px;background:var(--background,#202224);color:var(--foreground,#eee);display:flex;flex-direction:column;gap:16px}.close{position:absolute;right:10px;top:10px}.avatar{align-self:center;width:118px;height:118px;border-radius:50%;overflow:hidden;background:#383b40;display:grid;place-items:center;font-size:48px}.avatar img{width:100%;height:100%;object-fit:cover}.vip{align-self:center;font-size:12px}h2{margin:0;text-align:center;font-size:30px;overflow-wrap:anywhere}p{margin:0;line-height:1.5}.stats{display:grid;grid-template-columns:repeat(3,1fr);text-align:center}.stats div{display:flex;flex-direction:column;gap:8px}.stats strong{font-size:22px}label,footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.note{font-size:12px;opacity:.7}button,select{color:inherit;background:var(--muted,#303338);border:1px solid #8884;border-radius:7px;padding:8px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.error{color:#f88}.device-code{text-align:center;font-size:28px;letter-spacing:4px}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #fa8500;outline-offset:2px}
</style>
