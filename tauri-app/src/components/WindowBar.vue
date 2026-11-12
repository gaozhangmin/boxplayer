<script setup lang="ts">
import { Minus, Square, X } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Button } from '@/components/ui/button'
import { isNative } from '@/platform/native'
import { useI18n } from '@/lib/i18n'
import { toast } from 'vue-sonner'
withDefaults(defineProps<{ controls?: boolean }>(), { controls: true })
const { t } = useI18n()
const isMac = /Mac/.test(navigator.platform)
async function action(kind: 'minimize' | 'maximize' | 'close') {
  if (!isNative()) return
  try {
    const win = getCurrentWindow()
    if (kind === 'minimize') await win.minimize()
    if (kind === 'maximize') await win.toggleMaximize()
    if (kind === 'close') await win.close()
  } catch (error) { toast.error(String(error)) }
}
async function drag(event: MouseEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,a')) return
  if (isNative()) { try { await getCurrentWindow().startDragging() } catch (error) { toast.error(String(error)) } }
}
</script>
<template>
  <header class="window-bar" :class="{ 'mac-bar': isMac }" @mousedown="drag">
    <div class="window-bar-content"><slot /></div>
    <div v-if="controls && !isMac && isNative()" class="window-controls">
      <Button variant="ghost" size="icon" :aria-label="t('minimize')" @click="action('minimize')"><Minus :size="15" /></Button>
      <Button variant="ghost" size="icon" :aria-label="t('maximize')" @click="action('maximize')"><Square :size="13" /></Button>
      <Button variant="ghost" size="icon" :aria-label="t('close')" @click="action('close')"><X :size="16" /></Button>
    </div>
  </header>
</template>
