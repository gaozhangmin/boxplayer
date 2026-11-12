<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import MediaCollectionPicker from './MediaCollectionPicker.vue'
import { t } from '../i18n'
import { loadCustomSeries, saveCustomSeries, seriesMediaKey, toggleSeriesMember, type SeriesMedia, type CustomMediaSeries } from '../utils/customMediaSeries'
const item = ref<SeriesMedia | null>(null)
const groups = ref<CustomMediaSeries[]>([])
const editing = ref<string | null>(null)
const title = ref('')
const busy = ref(false)
const error = ref('')
function open(event: Event) { const target = (event as CustomEvent<SeriesMedia>).detail; if (!target?.id) return; groups.value = loadCustomSeries(); item.value = target; editing.value = null; error.value = '' }
onMounted(() => window.addEventListener('boxplayer:custom-series', open))
onUnmounted(() => window.removeEventListener('boxplayer:custom-series', open))
function start(id = '') { editing.value = id; title.value = groups.value.find(g => g.id === id)?.title || ''; error.value = '' }
async function commit(next: CustomMediaSeries[]) { if (busy.value) return; busy.value = true; error.value = ''; try { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); saveCustomSeries(next); groups.value = next; editing.value = null } catch { error.value = t('customSeries.saveError') } finally { busy.value = false } }
function confirm() { const name = title.value.trim(); if (!name || !item.value) return; if (groups.value.some(g => g.title.toLocaleLowerCase() === name.toLocaleLowerCase() && g.id !== editing.value)) { error.value = t('customSeries.duplicate'); return } const next = editing.value ? groups.value.map(g => g.id === editing.value ? { ...g, title: name } : g) : [...groups.value, { id: crypto.randomUUID(), title: name, members: [{ ...item.value }] }]; void commit(next) }
function toggle(group: CustomMediaSeries) { if (item.value) void commit(groups.value.map(g => g.id === group.id ? toggleSeriesMember(g, item.value!) : g)) }
function selected(group: CustomMediaSeries) { return !!item.value && group.members.some(m => seriesMediaKey(m) === seriesMediaKey(item.value!)) }
const rows = computed(() => groups.value.map(group => ({ id: group.id, title: group.title, count: group.members.length, selected: selected(group) })))
function toggleById(id: string) { const group = groups.value.find(group => group.id === id); if (group) toggle(group) }
</script>
<template>
  <MediaCollectionPicker :visible="!!item" heading="系列" :item-title="item?.title || ''" :rows="rows" :editing="editing" v-model:name="title" :busy="busy" :error="error" hint="选择条目即可加入或移出系列，修改会立即保存。" @close="item = null" @done="item = null" @create="start()" @rename="start" @toggle="toggleById" @cancel-name="editing = null" @confirm-name="confirm" />
</template>
