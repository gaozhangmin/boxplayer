<script setup lang="ts">
import {computed} from 'vue'
import {ArrowDown,ArrowUp} from 'lucide-vue-next'
import {Dropdown as ADropdown,Doption as ADoption} from '@arco-design/web-vue'
import {useLocale} from './i18n'
import {fileLabels} from '../fileLabels'
import type {FileSort,SourceSort} from '../fileSorting'
const props=withDefaults(defineProps<{descending:boolean;sort?:FileSort|SourceSort;manual?:boolean}>(),{sort:'name'})
const emit=defineEmits<{toggle:[];select:[value:FileSort|SourceSort]}>()
const locale=useLocale(),labels=computed(()=>fileLabels(locale.value))
const options=computed(()=>(props.manual?['name','modified','added','watched']:['name','modified','added','watched','size']) as Array<FileSort|SourceSort>)
</script>
<template>
 <ADropdown trigger="click" position="br">
  <button type="button" class="files-name-sort" :aria-label="`${labels.sort} · ${labels[sort]} · ${descending?labels.descending:labels.ascending}`"><span>{{labels[sort]}}</span><ArrowDown v-if="descending" :size="16"/><ArrowUp v-else :size="16"/></button>
  <template #content><div class="file-sort-options"><ADoption v-for="option in options" :key="option" :data-file-sort="option" @click="option===sort?emit('toggle'):emit('select',option)"><template #icon><ArrowDown v-if="descending" :size="14" :style="{opacity:sort===option?1:0.4}"/><ArrowUp v-else :size="14" :style="{opacity:sort===option?1:0.4}"/></template><strong v-if="sort===option">{{labels[option]}}</strong><span v-else>{{labels[option]}}</span></ADoption></div></template>
 </ADropdown>
</template>
<style scoped>.file-sort-options{min-width:150px}.files-name-sort{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 12px;flex-shrink:0;white-space:nowrap;border:1px solid var(--color-border-2);border-radius:20px;background:var(--color-fill-3);color:var(--primary)}</style>
