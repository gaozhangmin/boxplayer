<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { nativeCall } from '@/platform/native'
import type { Account, SourceEntry } from './contracts'
interface SpeedSnapshot { id:string;accountId:string;status:'running'|'complete'|'stopped'|'error';bytes:number;totalBytes?:number;elapsedMs:number;currentMbps:number;averageMbps:number;minimumMbps:number;samples:number[];error?:string }
const props=defineProps<{account:Account;entry:SourceEntry}>()
const emit=defineEmits<{back:[]}>()
const result=ref<SpeedSnapshot>(), preparing=ref(false), error=ref(''), message=ref('')
const running=computed(()=>preparing.value||result.value?.status==='running'&&!error.value)
const points=computed(()=>{const values=result.value?.samples||[];const max=Math.max(1,...values);return values.map((value,index)=>[8+index*624/Math.max(1,values.length-1),168-value/max*156])})
let jobId='',requestId='',generation=0,alive=true,timer:ReturnType<typeof setTimeout>|undefined
function clearTimer(){if(timer)clearTimeout(timer);timer=undefined}
function valid(snapshot:SpeedSnapshot,id=snapshot.id){if(snapshot.accountId!==props.account.id||snapshot.id!==id)throw new Error('测速结果与当前账号不匹配')}
async function poll(id:string,current:number){try{const snapshot=await nativeCall<SpeedSnapshot>('server_speed_state',{testId:id});if(!alive||current!==generation||id!==jobId)return;valid(snapshot,id);result.value=snapshot;if(snapshot.status==='running')timer=setTimeout(()=>void poll(id,current),300)}catch(cause){if(alive&&current===generation)error.value=(cause as {message?:string})?.message||'无法读取测速状态'}}
async function start(){
 if(running.value)return
 const current=++generation;clearTimer();preparing.value=true;error.value='';message.value='';result.value=undefined;requestId=crypto.randomUUID()
 try{
  if(jobId)await nativeCall('server_speed_cancel',{testId:jobId}).catch(()=>{})
  if(!alive||current!==generation)return
  const snapshot=await nativeCall<SpeedSnapshot>('server_speed_start',{requestId,accountId:props.account.id,itemId:props.entry.id})
  if(!alive||current!==generation){await nativeCall('server_speed_cancel',{testId:snapshot.id}).catch(()=>{});return}
  valid(snapshot);jobId=snapshot.id;result.value=snapshot;if(snapshot.status==='running')timer=setTimeout(()=>void poll(jobId,current),300)
 }catch(cause){if(alive&&current===generation)error.value=(cause as {message?:string})?.message||'文件测速失败'}finally{if(current===generation){preparing.value=false;requestId=''}}
}
async function stop(){const current=++generation;clearTimer();preparing.value=false;const pending=requestId;requestId='';if(pending)await nativeCall('auth_cancel',{requestId:pending}).catch(()=>{});if(jobId){try{const snapshot=await nativeCall<SpeedSnapshot>('server_speed_cancel',{testId:jobId});if(alive&&current===generation){valid(snapshot,jobId);result.value=snapshot}}catch(cause){if(alive)error.value=(cause as {message?:string})?.message||'停止测试失败'}}else if(alive)message.value='测试已停止'}
onUnmounted(()=>{alive=false;generation++;clearTimer();if(requestId)void nativeCall('auth_cancel',{requestId}).catch(()=>{});if(jobId)void nativeCall('server_speed_cancel',{testId:jobId}).catch(()=>{})})
</script>
<template>
 <section class="file-speed" aria-label="文件码率测试">
  <h3>{{entry.name}}</h3><p>读取所选媒体文件，最多测试 20 秒；数据不保存到磁盘。</p>
  <div class="speed-actions"><Button variant="outline" @click="emit('back')">返回</Button><Button v-if="!running" @click="start">开始测试</Button><Button v-else variant="outline" @click="stop">停止测试</Button></div>
  <p v-if="preparing" role="status">正在准备文件…</p><p v-if="message" role="status">{{message}}</p>
  <template v-if="result"><p role="status">{{result.status==='running'?'测试中':result.status==='complete'?'测试完成':result.status==='stopped'?'测试已停止':'测试失败'}} · {{(result.elapsedMs/1000).toFixed(1)}} 秒</p><p>{{(result.bytes/1048576).toFixed(1)}} MiB<span v-if="result.totalBytes"> / {{(result.totalBytes/1048576).toFixed(1)}} MiB</span></p><progress v-if="result.totalBytes" :value="result.bytes" :max="result.totalBytes"/>
   <div class="speed-metrics"><div>当前<strong>{{result.currentMbps.toFixed(2)}} Mbps</strong></div><div>平均<strong>{{result.averageMbps.toFixed(2)}} Mbps</strong></div><div>最低<strong>{{result.minimumMbps.toFixed(2)}} Mbps</strong></div></div>
   <svg viewBox="0 0 640 180" role="img" aria-label="文件吞吐量曲线"><path v-for="y in [12,64,116,168]" :key="y" :d="`M 8 ${y} H 632`" class="speed-grid"/><polyline :points="points.map(point=>point.join(',')).join(' ')"/><circle v-if="points.length===1" :cx="points[0]![0]" :cy="points[0]![1]" r="3"/></svg>
   <p v-if="result.error" role="alert">{{result.error}}</p>
  </template><p v-if="error" role="alert">{{error}}</p>
 </section>
</template>
<style scoped>
.file-speed{display:grid;gap:16px;font-size:14px}.file-speed h3,.file-speed p{margin:0}.file-speed p{color:var(--muted-text)}.speed-actions{display:flex;gap:8px}.speed-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.speed-metrics>div{border:1px solid var(--border);border-radius:8px;padding:12px}.speed-metrics strong{display:block;margin-top:8px;color:var(--primary);font-size:15px}.file-speed progress{width:100%;accent-color:var(--primary)}.file-speed svg{width:100%;height:180px;border:1px solid var(--border);border-radius:8px;background:var(--secondary)}.speed-grid{stroke:var(--border);stroke-width:1}.file-speed polyline{fill:none;stroke:var(--primary);stroke-width:2}.file-speed circle{fill:var(--primary)}.file-speed p[role=alert]{color:#c33}
</style>
