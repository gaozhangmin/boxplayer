<script setup lang="ts">
import {computed} from 'vue'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import {useLocale} from '@/features/files/electron/i18n'
defineProps<{message:string}>();const emit=defineEmits<{close:[]}>(),locale=useLocale(),confirm=computed(()=>locale.value.startsWith('en')?'OK':'确认')
</script>
<template><ElectronModal :label="message" :width="320" @close="emit('close')"><div class="connection-failure"><strong role="alert">{{message}}</strong><button type="button" @click="emit('close')">{{confirm}}</button></div></ElectronModal></template>
<style scoped>.connection-failure{display:grid;gap:20px;text-align:center}.connection-failure strong{font-size:14px}.connection-failure button{border:0;border-radius:20px;min-height:34px;background:var(--secondary);color:var(--foreground);font:inherit;cursor:pointer}</style>
