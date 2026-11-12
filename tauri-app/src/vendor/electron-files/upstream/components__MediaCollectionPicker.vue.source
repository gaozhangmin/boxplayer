<script setup lang="ts">
import { Plus, Pencil, Circle, CircleCheck, Trash2 } from 'lucide-vue-next'
import { t } from '../i18n'

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
  <a-modal :visible="visible" :width="660" :z-index="3000" :title="itemTitle" :footer="false" :mask-closable="!busy" :esc-to-close="!busy" modal-class="media-collection-picker" @cancel="!busy && $emit('done')">
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
      <p v-if="error" role="alert">{{ error }}</p><a-spin v-if="busy" />
    </div>
  </a-modal>
  <a-modal :visible="visible && editing !== null" :width="360" :z-index="3100" :footer="false" :title="`${editing ? '重命名' : '新建'}${heading}`" :mask-closable="!busy" :esc-to-close="!busy" @cancel="!busy && $emit('cancelName')">
    <form class="collection-name-form" @submit.prevent="$emit('confirmName')">
      <a-input :model-value="name" autofocus :max-length="120" :disabled="busy" :input-attrs="{ 'aria-label': `${heading}名称` }" @update:model-value="$emit('update:name', $event)" />
      <p v-if="error" role="alert">{{ error }}</p>
      <a-button long html-type="submit" :disabled="!name.trim() || busy">{{ t('common.confirm') }}</a-button>
      <a-button long :disabled="busy" @click="$emit('cancelName')">{{ t('common.cancel') }}</a-button>
    </form>
  </a-modal>
</template>

<style scoped>
.collection-body { height: 100%; box-sizing: border-box; padding: 28px 68px 24px; overflow-y: auto }
.collection-media-title { display: block; margin-bottom: 16px }
.collection-hint, .collection-count { color: var(--color-text-3) }
.collection-create, .collection-row { display: flex; align-items: center; width: 100%; box-sizing: border-box; border-radius: 9px; background: var(--color-fill-3); margin-bottom: 12px; min-height: 52px }
button { border: 0; cursor: pointer; background: transparent; color: var(--color-text-1); padding: 12px }
button:disabled { cursor: default; opacity: .6 }
.collection-create { gap: 12px; color: #ff8800 }
.collection-choice { display: flex; gap: 12px; align-items: center; flex: 1; min-width: 0; text-align: left }
.collection-choice svg { flex-shrink: 0 }
.collection-label { flex: 1; overflow-wrap: anywhere }
.collection-count { white-space: nowrap; font-size: 12px }
.collection-list { overflow: visible }
.selected { color: #ff8800 }
.collection-name-form { display: flex; flex-direction: column; gap: 12px }
p[role=alert] { color: rgb(var(--danger-6)) }
:global(.arco-modal.media-collection-picker) {
  width: 660px !important;
  max-width: calc(100vw - 32px) !important;
  height: 720px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 28px !important;
  overflow: hidden;
}
:global(body[arco-theme='dark'] .arco-modal.media-collection-picker) {
  background: var(--app-overlay-bg) !important;
  backdrop-filter: none !important;
}
:global(.arco-modal.media-collection-picker .arco-modal-header) {
  flex: 0 0 56px;
  height: 56px;
  box-sizing: border-box;
  border-bottom: 0 !important;
  padding: 0 60px;
}
:global(.arco-modal.media-collection-picker .arco-modal-title) {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
:global(.arco-modal.media-collection-picker .arco-modal-body) {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
:global(.arco-modal.media-collection-picker .arco-modal-close-btn) {
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
:global(.arco-modal.media-collection-picker .arco-modal-close-btn .arco-icon-hover) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
}
:global(.arco-modal.media-collection-picker .arco-modal-close-btn .arco-icon) { position: static }
:global(body[arco-theme='dark'] .media-collection-picker .collection-create),
:global(body[arco-theme='dark'] .media-collection-picker .collection-row) { background: #333 !important }
@media (max-width: 600px) {
  .collection-body { padding-right: 24px; padding-left: 24px }
}
</style>
