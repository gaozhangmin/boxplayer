<script lang="ts">
import type { Component } from 'vue'

export interface MusicMenuItem {
  key: string
  label: string
  icon: Component
  active?: boolean
  danger?: boolean
  disabled?: boolean
}
</script>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps<{ visible: boolean; anchor: DOMRect | null; top: MusicMenuItem[]; groups: MusicMenuItem[][]; label: string }>()
const emit = defineEmits<{ (e: 'select', key: string): void; (e: 'close'): void }>()
const menu = ref<HTMLElement | null>(null)
const position = ref({ left: 0, top: 0 })
const style = computed<CSSProperties>(() => ({ left: `${position.value.left}px`, top: `${position.value.top}px` }))

function place() {
  const rect = props.anchor
  const el = menu.value
  if (!rect || !el) return
  const width = el.offsetWidth
  const height = el.offsetHeight
  const margin = 12
  const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin)
  const below = rect.bottom + 8
  const top = below + height + margin > window.innerHeight ? Math.max(margin, rect.top - height - 8) : below
  position.value = { left, top }
}
function choose(item: MusicMenuItem) {
  if (item.disabled) return
  emit('select', item.key)
  emit('close')
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
watch(() => props.visible, async (visible) => {
  if (visible) {
    window.addEventListener('keydown', onKey)
    await nextTick()
    place()
    menu.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  } else window.removeEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="music-menu-layer" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div ref="menu" class="music-action-menu" role="menu" :aria-label="label" :style="style" @click.stop>
        <div v-if="top.length" class="music-menu-top">
          <button v-for="item in top" :key="item.key" role="menuitem" :class="{ active: item.active }" :disabled="item.disabled" @click="choose(item)">
            <component :is="item.icon" :size="20" :fill="item.active ? 'currentColor' : 'none'" />
            <span>{{ item.label }}</span>
          </button>
        </div>
        <div v-for="(group, index) in groups" :key="index" class="music-menu-group">
          <button v-for="item in group" :key="item.key" role="menuitem" :class="{ danger: item.danger }" :disabled="item.disabled" @click="choose(item)">
            <component :is="item.icon" :size="18" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.music-menu-layer { position:fixed; inset:0; z-index:3000; }
.music-action-menu {
  --music-menu-bg: rgba(249, 249, 251, .94);
  --music-menu-text: #1d1d1f;
  --music-menu-muted: #6e6e73;
  --music-menu-line: rgba(60, 60, 67, .14);
  --music-menu-hover: rgba(60, 60, 67, .08);
  --music-menu-accent: rgb(244, 102, 34);
  position:fixed; width:264px; padding:6px 0; border-radius:16px; color:var(--music-menu-text); background:var(--music-menu-bg);
  box-shadow:0 18px 50px rgba(0, 0, 0, .22), 0 0 0 .5px rgba(0, 0, 0, .12); backdrop-filter:blur(30px) saturate(180%);
  font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif; font-size:14px;
}
body[arco-theme='dark'] .music-action-menu {
  --music-menu-bg: rgba(36, 36, 38, .94);
  --music-menu-text: #f5f5f7;
  --music-menu-muted: #a1a1a6;
  --music-menu-line: rgba(235, 235, 245, .14);
  --music-menu-hover: rgba(235, 235, 245, .1);
  box-shadow:0 18px 50px rgba(0, 0, 0, .5), 0 0 0 .5px rgba(255, 255, 255, .1);
}
.music-action-menu button { display:flex; align-items:center; gap:12px; width:100%; border:0; background:transparent; color:inherit; font:inherit; cursor:pointer; text-align:left; }
.music-action-menu button:disabled { opacity:.4; cursor:default; }
.music-action-menu button:focus-visible { outline:2px solid var(--music-menu-accent); outline-offset:-2px; }
.music-menu-top { display:grid; grid-template-columns:repeat(3, 1fr); padding:2px 6px 8px; border-bottom:.5px solid var(--music-menu-line); }
.music-menu-top button { flex-direction:column; justify-content:center; gap:6px; padding:10px 4px; border-radius:10px; font-size:12px; text-align:center; }
.music-menu-top button.active { color:var(--music-menu-accent); }
.music-menu-group { padding:4px 0; }
.music-menu-group + .music-menu-group { border-top:.5px solid var(--music-menu-line); }
.music-menu-group button { padding:9px 18px; min-height:36px; }
.music-menu-group button svg { color:var(--music-menu-muted); flex-shrink:0; }
.music-menu-group button.danger, .music-menu-group button.danger svg { color:#ff3b30; }
.music-action-menu button:not(:disabled):hover { background:var(--music-menu-hover); }
</style>
