<script setup lang="ts">
import {computed} from 'vue'
import {Dsubmenu as ADsubmenu,Doption as ADoption} from '@arco-design/web-vue'
import {ListFilter,Check} from 'lucide-vue-next'
import {useLocale} from './electron/i18n'
import {fileLabels} from './fileLabels'
import type {FileFilter} from './fileSorting'
defineProps<{modelValue:FileFilter}>()
const emit=defineEmits<{ 'update:modelValue':[value:FileFilter] }>()
const locale=useLocale(),labels=computed(()=>fileLabels(locale.value))
const filters:FileFilter[]=['all','video','image','document','subtitle']
</script>
<template><ADsubmenu trigger="hover" class="file-type-menu"><template #default><span class="arco-dropdown-option-icon"><ListFilter :size="14"/></span>{{labels.filter}} · {{labels[modelValue]}}</template><template #content><ADoption v-for="filter in filters" :key="filter" :data-file-filter="filter" @click="emit('update:modelValue',filter)"><template #icon><Check :size="14" :style="{visibility:modelValue===filter?'visible':'hidden'}"/></template>{{labels[filter]}}</ADoption></template></ADsubmenu></template>
