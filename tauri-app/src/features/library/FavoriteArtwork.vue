<script setup lang="ts">
import { computed, ref } from 'vue'
import { providerIcon } from '@/features/files/sourcePresentation'
import { Star } from 'lucide-vue-next'
import {libraryCategoryIcon} from './icons'
import ServerArtwork from '@/features/servers/ServerArtwork.vue'
import type {Account} from '@/features/sources/contracts'
const props=defineProps<{route?:string;server?:boolean;folder?:boolean;cover?:string;account?:Account;serverCover?:string}>()
const failedProvider=ref('')
const provider=computed(()=>props.server&&props.account?providerIcon(props.account.providerId):undefined)
</script>
<template><div class="favorite-art" :class="[route?.split('/')[0],{server,folder}]"><ServerArtwork v-if="account&&serverCover" :account="account" :path="serverCover" alt=""/><img v-else-if="cover" :src="cover" alt="" draggable="false"/><img v-else-if="provider&&failedProvider!==provider" class="favorite-provider-icon" :src="provider" alt="" draggable="false" @error="failedProvider=provider"/><component v-else :is="route?libraryCategoryIcon(route):Star" :size="48" :stroke-width="2.8" aria-hidden="true"/></div></template>
<style scoped>
.favorite-art{position:relative;aspect-ratio:1.8;border-radius:10% / 18%;display:flex;align-items:center;justify-content:center;color:#ffffffb8;background:linear-gradient(90deg,#ff5b00,#ff9600);overflow:hidden}.favorite-art.movies,.favorite-art.series{background:linear-gradient(90deg,#0075ff,#17c9e8)}.favorite-art.tv{background:linear-gradient(90deg,#ff1c61,#e434f1)}.favorite-art.other{background:linear-gradient(90deg,#20c866,#08dfc2)}.favorite-art.playlist{background:linear-gradient(90deg,#ff452c,#ff9f57)}.favorite-art.server{background:linear-gradient(90deg,#7229a7,#a32bf1)}.favorite-art.folder{background:linear-gradient(90deg,#ff8500,#ffc326)}.favorite-art :deep(img){position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.favorite-art img.favorite-provider-icon{position:static;width:48px;height:48px;object-fit:contain}.favorite-art :deep(svg){color:inherit;width:48px;height:48px}
</style>
