<script setup lang="ts">
import {computed} from 'vue'
import {useLocale} from './electron/i18n'
import {fileLabels} from './fileLabels'
import {ArrowDown,ArrowUp,ListFilter} from 'lucide-vue-next'
import {Dropdown as ADropdown,Doption as ADoption} from '@arco-design/web-vue'
const props=defineProps<{sort:string;descending:boolean;options:readonly {value:string;label:string;directional?:boolean}[];label?:string;disabled?:boolean}>()
const emit=defineEmits<{select:[value:string];toggle:[]}>()
const locale=useLocale(),labels=computed(()=>fileLabels(locale.value))
const selected=computed(()=>props.options.find(option=>option.value===props.sort))
function choose(option:typeof props.options[number]){if(option.value===props.sort&&option.directional!==false)emit('toggle');else emit('select',option.value)}
</script>
<template><ADropdown trigger="click" position="br"><button type="button" class="app-sort-button" :disabled="disabled" :aria-label="`${label||labels.sort} · ${selected?.label} · ${selected?.directional===false?'':descending?labels.descending:labels.ascending}`"><span>{{selected?.label}}</span><ListFilter v-if="selected?.directional===false" :size="16"/><ArrowDown v-else-if="descending" :size="16"/><ArrowUp v-else :size="16"/></button><template #content><div class="app-sort-options"><ADoption v-for="option in options" :key="option.value" :data-sort-field="option.value" @click="choose(option)"><template #icon><ListFilter v-if="option.directional===false" :size="14"/><ArrowDown v-else-if="descending" :size="14" :style="{opacity:sort===option.value?1:0.4}"/><ArrowUp v-else :size="14" :style="{opacity:sort===option.value?1:0.4}"/></template><strong v-if="sort===option.value">{{option.label}}</strong><span v-else>{{option.label}}</span></ADoption></div></template></ADropdown></template>
<style scoped>.app-sort-button{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px;border:1px solid var(--color-border-2);border-radius:20px;background:var(--color-fill-3);color:var(--primary);white-space:nowrap}.app-sort-options{min-width:150px}</style>
