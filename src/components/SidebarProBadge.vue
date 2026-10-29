<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import BoxPlayerProBadge from './BoxPlayerProBadge.vue'
import { type BoxPlayerProTier } from '../utils/boxplayerProTier'
import { t } from '../i18n'
import { isLoggedIn, isPro } from '../utils/usageLimit'

defineProps<{ collapsed: boolean }>()
defineEmits<{ (event: 'upgrade'): void }>()
const active = ref(isLoggedIn() && isPro())
const tier = computed<BoxPlayerProTier>(() => active.value ? 'all' : 'standard')
const syncMembership = () => {
  active.value = isLoggedIn() && isPro()
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  syncMembership()
  window.addEventListener('storage', syncMembership)
  window.addEventListener('focus', syncMembership)
  window.addEventListener('boxplayer-auth-restored', syncMembership)
  // Same-window localStorage writes do not emit storage events (e.g. redeem/logout).
  timer = setInterval(syncMembership, 1000)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('storage', syncMembership)
  window.removeEventListener('focus', syncMembership)
  window.removeEventListener('boxplayer-auth-restored', syncMembership)
})
</script>

<template>
  <div v-if="active" class="member-card" :class="{ compact: collapsed }">
    <BoxPlayerProBadge :tier="tier" compact />
  </div>
  <button v-else class="sidebar-pro" :class="{ compact: collapsed }" :aria-label="t('upgrade.title')" @click="$emit('upgrade')"><span v-if="!collapsed">{{ t('membership.upgradeTo') }}</span><strong><ChevronRight v-if="collapsed" :size="18" /><template v-else>BoxPlayer PRO</template></strong><ChevronRight v-if="!collapsed" :size="18" /></button>
</template>

<style scoped>
.sidebar-pro{position:relative;display:flex!important;flex-direction:column;align-items:flex-start!important;width:100%;padding:14px 16px!important;border-radius:18px!important;background:linear-gradient(110deg,#f07800 0%,#ff8a00 55%,#ffad32 100%)!important;gap:4px!important}
.sidebar-pro span{font-size:12px;color:#fff}
.sidebar-pro strong{font-size:20px;color:#fff}
.sidebar-pro svg{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:#fff!important}
.sidebar-pro.compact{align-items:center!important;padding:12px 4px!important}
.member-card{display:flex;align-items:center;justify-content:center;gap:10px;min-height:56px;box-sizing:border-box;padding:12px 14px;border:0;border-radius:16px;background:linear-gradient(110deg,#f07800 0%,#ff8a00 55%,#ffad32 100%);color:#fff}
.member-seal{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex-shrink:0;width:42px;height:50px;border-radius:12px;background:linear-gradient(145deg,#ffe6a8,#dc9a32);color:#49300c;box-shadow:0 3px 10px rgba(174,106,18,.16)}
.member-seal b{font-size:9px;letter-spacing:1.5px;line-height:12px;padding-left:1.5px}
.member-copy{display:flex;flex-direction:column;gap:6px;min-width:0}
.member-copy strong{font-size:16px;line-height:20px;color:var(--color-text-1);white-space:nowrap}
.member-copy em{font-style:normal;font-size:11px;letter-spacing:.8px;color:var(--color-text-1)}
.member-copy span{font-size:11px;line-height:16px;color:var(--color-text-2)}
.member-card.compact{padding:8px 0;justify-content:center;border-radius:14px;min-height:68px;gap:0}
</style>

<style scoped>
.member-card.compact :deep(.bp-pro-badge) { padding: 0; }
</style>
