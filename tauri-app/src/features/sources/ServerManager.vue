<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import { X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ServerPlaybackSettings from './ServerPlaybackSettings.vue'
import ServerFileSpeed from './ServerFileSpeed.vue'
import type { Account, SourceEntry } from './contracts'
import { createServerPlaylist, deleteServerMedia, deleteServerPlaylist, listServerPlaylists, serverPlaylistMembership, setServerPlaylistMembership, type ServerPlaylist } from './playlists'
const props = defineProps<{ account: Account; entry?: SourceEntry }>()
const emit = defineEmits<{ close: []; openPlaylist: [id: string]; changed: [] }>()
const owner = props.account, target = props.entry
const profileMode=ref(false),speedMode=ref(false),loading=ref(false)
const playlists = ref<ServerPlaylist[]>([]), selected = ref<ServerPlaylist>()
const membership = ref<boolean>(), title = ref(''), busy = ref(false), error = ref(''), status = ref('')
const deletion = ref<{kind:'media'|'playlist';id:string;title:string}>()
let alive = true, sequence = 0
onUnmounted(() => { alive = false;sequence++ })
async function run(action: () => Promise<void>) { if (busy.value) return;busy.value = true;error.value = '';status.value = '';try { await action() } catch (cause) { if (alive) error.value = (cause as {message?:string})?.message || '服务器操作失败' } finally { busy.value = false } }
async function load() { const current = ++sequence;loading.value=true;try{const rows = await listServerPlaylists(owner);if (alive && current === sequence) { playlists.value = rows;selected.value = undefined;membership.value = undefined }}finally{if(alive&&current===sequence)loading.value=false} }
onMounted(() => void load().catch(cause=>{if(alive)error.value=(cause as {message?:string})?.message||'播放列表读取失败'}))
async function choose(playlist: ServerPlaylist) { await run(async () => { const member = target?.playable ? await serverPlaylistMembership(owner, playlist.id, target.id) : undefined;if (alive) { selected.value = playlist;membership.value = member } }) }
async function create() { await run(async () => { if (!target?.playable) return;await createServerPlaylist(owner, title.value, target.id);if (alive) { title.value = '';await load();status.value = '播放列表已创建';emit('changed') } }) }
async function toggle() { await run(async () => { const list = selected.value;if (!target?.playable || !list || membership.value === undefined) return;const next = !membership.value;await setServerPlaylistMembership(owner, list.id, target.id, next);if (alive) { membership.value = next;status.value = next ? '已加入播放列表' : '已从播放列表移除';emit('changed') } }) }
async function remove() { const confirmed = deletion.value;if (!confirmed) return;await run(async () => { if (confirmed.kind === 'playlist') await deleteServerPlaylist(owner, confirmed.id);else { if (!target || target.id !== confirmed.id) throw new Error('媒体目标已改变');await deleteServerMedia(owner, target) }if (alive) { deletion.value = undefined;emit('changed');if (confirmed.kind === 'media') emit('close');else await load() } }) }
function close() { if (!busy.value) emit('close') }
</script>
<template>
 <DialogRoot :open="true" @update:open="value=>{if(!value)close()}"><DialogPortal><DialogOverlay class="server-overlay"/><DialogContent class="server-dialog" @escape-key-down="event=>{if(busy)event.preventDefault()}" @pointer-down-outside="event=>{if(busy)event.preventDefault()}">
  <header><DialogTitle>{{ speedMode ? '文件码率测试' : profileMode ? '播放设置' : target?.name || '播放列表' }}</DialogTitle><button type="button" aria-label="关闭服务器管理" :disabled="busy" @click="close"><X :size="20"/></button></header>
  <DialogDescription>{{ owner.name }}</DialogDescription>
  <template v-if="deletion">
   <p>确认从「{{ owner.name }}」删除「{{ deletion.title }}」？</p><p v-if="deletion.kind==='media'">此操作会删除服务器上的媒体文件，无法在应用内撤销。</p><p v-else>此操作删除播放列表，保留其中的媒体文件。</p>
   <div class="server-actions"><Button variant="outline" :disabled="busy" @click="deletion=undefined">取消删除</Button><Button :disabled="busy" @click="remove">确认删除</Button></div>
  </template>
  <ServerFileSpeed v-else-if="speedMode&&target" :account="owner" :entry="target" @back="speedMode=false"/>
  <ServerPlaybackSettings v-else-if="profileMode" :account="owner" @back="profileMode=false"/>
  <template v-else>
   <Button v-if="owner.providerId!=='plex'" variant="outline" :disabled="busy" @click="profileMode=true">播放设置与码率测试</Button>
   <Button v-if="target?.playable" variant="outline" :disabled="busy" @click="speedMode=true;error=''">文件码率测试</Button>
   <h3>播放列表</h3><p v-if="(busy||loading)&&!playlists.length" role="status">正在连接…</p>
   <div class="playlist-list"><button v-for="list in playlists" :key="list.id" type="button" :disabled="busy" :aria-pressed="selected?.id===list.id" @click="choose(list)"><strong>{{ list.title }}</strong><span>{{ list.count }} 项</span></button><p v-if="!playlists.length&&!busy&&!loading&&!error">暂无播放列表</p></div>
   <div v-if="selected" class="server-actions"><Button variant="outline" :disabled="busy" @click="emit('openPlaylist',selected.id)">打开播放列表</Button><Button v-if="target?.playable" :disabled="busy||membership===undefined" @click="toggle">{{ membership ? '从播放列表移除' : '加入播放列表' }}</Button><Button variant="ghost" :disabled="busy" @click="deletion={kind:'playlist',id:selected.id,title:selected.title}">删除播放列表…</Button></div>
   <form v-if="target?.playable" class="playlist-create" @submit.prevent="create"><label>新播放列表<input v-model="title" :disabled="busy" required autocomplete="off" /></label><Button :disabled="busy||!title.trim()">创建并加入</Button></form>
   <Button v-if="target" variant="outline" :disabled="busy" @click="deletion={kind:'media',id:target.id,title:target.name}">删除服务器媒体…</Button>
  </template>
  <p v-if="error&&!profileMode&&!speedMode" role="alert">{{ error }}</p><p v-if="status&&!profileMode&&!speedMode" role="status">{{ status }}</p>
 </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.server-overlay{position:fixed;inset:0;z-index:100;background:#0002;backdrop-filter:blur(1px)}
.server-dialog{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:101;width:min(620px,90vw);max-height:85vh;overflow:auto;padding:24px;display:grid;gap:16px;background:var(--background);color:var(--foreground);border:1px solid var(--control-border);border-radius:18px;box-shadow:0 24px 65px #0004;font-size:14px;outline:none}
header{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600}header button{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--border);border-radius:50%;background:var(--control-surface);color:inherit}
h3,p{margin:0}h3{font-size:14px}.playlist-list{max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:10px}.playlist-list>button{width:100%;display:flex;justify-content:space-between;padding:12px;border:0;border-bottom:1px solid var(--border);background:transparent;color:inherit;text-align:left}.playlist-list>button[aria-pressed=true]{background:var(--muted)}.playlist-list span{color:var(--muted-text)}.playlist-list p{padding:12px;color:var(--muted-text)}
.server-actions{display:flex;gap:8px;flex-wrap:wrap}.playlist-create{display:flex;gap:12px;align-items:end}.playlist-create label{display:grid;gap:6px;flex:1}.playlist-create input{min-width:0;border:1px solid var(--border);border-radius:6px;background:var(--control-surface);color:inherit;padding:7px}p[role=alert]{color:#c33}
</style>
