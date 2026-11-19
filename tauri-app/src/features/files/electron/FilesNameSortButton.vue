<script setup lang="ts">
import {computed} from 'vue'
import {ArrowDown,ArrowUp} from 'lucide-vue-next'
import {Dsubmenu as ADsubmenu,Doption as ADoption} from '@arco-design/web-vue'
import {useLocale} from './i18n'
import {fileLabels} from '../fileLabels'
import type {FileSort,SourceSort} from '../fileSorting'
const props=withDefaults(defineProps<{descending:boolean;sort?:FileSort|SourceSort;manual?:boolean}>(),{sort:'name'})
const emit=defineEmits<{toggle:[];select:[value:FileSort|SourceSort]}>()
const locale=useLocale(),labels=computed(()=>fileLabels(locale.value))
const options=computed(()=>(props.manual?['name','modified','added','watched']:['name','modified','added','watched','size']) as Array<FileSort|SourceSort>)
</script>
<template>
 <ADsubmenu trigger="hover" class="file-sort-menu" data-file-sort-menu>
  <template #default><span class="arco-dropdown-option-icon"><ArrowDown v-if="descending" :size="14"/><ArrowUp v-else :size="14"/></span>{{labels.sort}} · {{labels[sort]}}</template>
  <template #content><ADoption v-for="option in options" :key="option" :data-file-sort="option" @click="option===sort?emit('toggle'):emit('select',option)"><template #icon><ArrowDown v-if="descending" :size="14" :style="{visibility:sort===option?'visible':'hidden'}"/><ArrowUp v-else :size="14" :style="{visibility:sort===option?'visible':'hidden'}"/></template><strong v-if="sort===option">{{labels[option]}}</strong><span v-else>{{labels[option]}}</span></ADoption></template>
 </ADsubmenu>
</template>
