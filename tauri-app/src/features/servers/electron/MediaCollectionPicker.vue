<script setup lang="ts">
import { Plus, Pencil, Circle, CircleCheck, Trash2 } from 'lucide-vue-next'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
const t=(key:string)=>key==='common.confirm'?'确定':'取消'

defineProps<{
  visible: boolean
  heading: string
  itemTitle: string
  rows: { id: string; title: string; count: number; selected: boolean }[]
  editing: string | null
  name: string
  busy?: boolean
  error?: string
  hint?: string
  removable?: boolean
  renamable?: boolean
}>()
defineEmits<{
  close: []
  done: []
  create: []
  rename: [id: string]
  toggle: [id: string]
  remove: [id: string]
  cancelName: []
  confirmName: []
  'update:name': [name: string]
}>()
</script>

<template>
  <ElectronModal v-if="visible" :title="itemTitle" :width="660" :busy="busy" class="media-collection-picker" @close="$emit('done')">
    <div class="collection-body">
      <button class="collection-create" :disabled="busy" @click="$emit('create')"><Plus :size="18" />{{ heading === '系列' ? '创建自定义系列' : '创建播放列表' }}</button>
      <div class="collection-list">
        <div v-for="row in rows" :key="row.id" class="collection-row">
          <button class="collection-choice" :disabled="busy" :aria-pressed="row.selected" @click="$emit('toggle', row.id)">
            <CircleCheck v-if="row.selected" class="selected" :size="20" /><Circle v-else :size="20" />
            <span class="collection-label">{{ row.title }}</span>
          </button>
          <button v-if="renamable !== false" :disabled="busy" :aria-label="`${row.title}：重命名`" @click="$emit('rename', row.id)"><Pencil :size="18" /></button>
          <button v-if="removable" :disabled="busy" :aria-label="`${row.title}：删除`" @click="$emit('remove', row.id)"><Trash2 :size="18" /></button>
        </div>
        <p v-if="!rows.length" class="collection-hint">暂无{{ heading }}，请先创建一个</p>
      </div>
      <p v-if="error" role="alert">{{ error }}</p><span v-if="busy" role="status">正在加载…</span>
    </div>
  </ElectronModal>
  <ElectronModal v-if="visible && editing !== null" :title="`${editing ? '重命名' : '新建'}${heading}`" :width="360" :busy="busy" @close="$emit('cancelName')">
    <form class="collection-name-form" @submit.prevent="$emit('confirmName')">
      <input :value="name" autofocus maxlength="120" :disabled="busy" :aria-label="heading+'名称'" @input="$emit('update:name',($event.target as HTMLInputElement).value)"/>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="!name.trim() || busy">{{ t('common.confirm') }}</button>
      <button type="button" :disabled="busy" @click="$emit('cancelName')">{{ t('common.cancel') }}</button>
    </form>
  </ElectronModal>
</template>

<style scoped>
.collection-body { height: 100%; box-sizing: border-box; padding: 28px 68px 24px; overflow-y: auto }
.collection-media-title { display: block; margin-bottom: 16px }
.collection-hint, .collection-count { color: var(--muted-text) }
.collection-create, .collection-row { display: flex; align-items: center; width: 100%; box-sizing: border-box; border-radius: 9px; background: var(--secondary); margin-bottom: 12px; min-height: 52px }
button { border: 0; cursor: pointer; background: transparent; color: var(--foreground); padding: 12px }
button:disabled { cursor: default; opacity: .6 }
.collection-create { gap: 12px; color: var(--primary) }
.collection-choice { display: flex; gap: 12px; align-items: center; flex: 1; min-width: 0; text-align: left }
.collection-choice svg { flex-shrink: 0 }
.collection-label { flex: 1; overflow-wrap: anywhere }
.collection-count { white-space: nowrap; font-size: 12px }
.collection-list { overflow: visible }
.selected { color: var(--primary) }
.collection-name-form { display: flex; flex-direction: column; gap: 12px }
p[role=alert] { color: rgb(var(--danger-6)) }
:global(.electron-modal.media-collection-picker) {
  width: 660px !important;
  max-width: calc(100vw - 32px) !important;
  height: 720px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 28px !important;
  overflow: hidden;
}
:global(body[arco-theme='dark'] .electron-modal.media-collection-picker) {
  background: var(--app-overlay-bg) !important;
  backdrop-filter: none !important;
}
:global(.electron-modal.media-collection-picker .electron-modal-header) {
  flex: 0 0 56px;
  height: 56px;
  box-sizing: border-box;
  border-bottom: 0 !important;
  padding: 0 60px;
}
:global(.electron-modal.media-collection-picker .electron-modal-title) {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
:global(.electron-modal.media-collection-picker .electron-modal-body) {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
:global(.electron-modal.media-collection-picker .electron-modal-close-btn) {
  left: 10px;
  right: auto;
  top: 9px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--color-border-2);
}
:global(.electron-modal.media-collection-picker .electron-modal-close-btn .arco-icon-hover) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
}
:global(.electron-modal.media-collection-picker .electron-modal-close-btn .arco-icon) { position: static }
:global(body[arco-theme='dark'] .media-collection-picker .collection-create),
:global(body[arco-theme='dark'] .media-collection-picker .collection-row) { background: #333 !important }
@media (max-width: 600px) {
  .collection-body { padding-right: 24px; padding-left: 24px }
}
</style>

<style>.media-collection-picker .electron-modal{height:720px;border-radius:28px;display:flex;flex-direction:column}.media-collection-picker .electron-modal-body{flex:1;min-height:0;padding:0;overflow:auto}.media-collection-picker .electron-modal-header{flex:0 0 56px;justify-content:center;border:0}.media-collection-picker .electron-modal-header>button{position:absolute;left:10px}.collection-name-form input{height:32px;background:var(--secondary);padding:4px 12px}.collection-name-form>button{height:32px;background:var(--secondary);border-radius:4px}</style>