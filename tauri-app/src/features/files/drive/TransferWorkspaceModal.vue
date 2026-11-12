<script setup lang="ts">
import TransferWorkspace from './TransferWorkspace.vue'
import {t} from '@/features/files/electron/i18n'
defineProps<{visible:boolean}>()
const emit=defineEmits<{close:[]}>()
</script>
<template><a-modal modal-class="source-transfer-modal" :visible="visible" :title="t('transfer.title')" :width="840" :footer="false" unmount-on-close @cancel="emit('close')"><TransferWorkspace/></a-modal></template>
<style>
.arco-modal.source-transfer-modal{width:840px!important;max-width:calc(100vw - 40px)!important}
.source-transfer-modal>.arco-modal-body{height:min(72vh,640px);min-height:300px;padding:0!important;overflow:hidden}
</style>
