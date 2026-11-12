<script setup lang="ts">
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import { computed, ref } from 'vue'
import type { ServerItem } from './workspace'
const props = defineProps<{ item: ServerItem }>(), emit = defineEmits<{ close: [] }>()
const result = ref(''), error = ref(''), busy = ref(false)
const text = computed(() => [props.item.name, props.item.year, props.item.overview].filter(Boolean).join('\n'))
async function copy() { busy.value = true; error.value = ''; try { await navigator.clipboard.writeText(text.value); result.value = text.value; } catch { error.value = '复制失败，请选择下方文本手动复制。' } finally { busy.value = false } }
</script>
<template><ElectronModal title="分享" :width="480" :busy="busy" @close="emit('close')"><div class="media-share"><strong>{{item.name}}</strong><p>分享媒体名称、年份和简介。</p><button :disabled="busy" @click="copy">复制媒体介绍</button><p>此来源不支持公开文件链接，可复制媒体介绍。</p><template v-if="result"><textarea :value="result" aria-label="媒体分享信息" readonly rows="4"/><button :disabled="busy" @click="copy">复制分享内容</button></template><p v-if="error" role="alert">{{error}}</p></div></ElectronModal></template><style scoped>.media-share{display:flex;flex-direction:column;gap:12px}.media-share p{margin:0;color:var(--muted-text)}button,textarea{padding:6px 12px;background:var(--secondary);border-radius:4px}textarea{width:100%}[role=alert]{color:#ef6868}</style>