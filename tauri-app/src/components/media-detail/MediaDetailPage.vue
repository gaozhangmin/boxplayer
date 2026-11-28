<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StyleValue } from 'vue'
import IconFont from '@/features/files/electron/IconFont.vue'

const props = defineProps<{
  itemKey: string
  title: string
  backdropStyle?: StyleValue
  playLabel: string
  progress?: number | null
  playDisabled?: boolean
  hasVersion?: boolean
}>()
const emit = defineEmits<{ back: []; play: [] }>()
const content = ref<HTMLElement>()
watch(() => props.itemKey, () => { if (content.value) content.value.scrollTop = 0 })
</script>

<template>
  <div class="media-detail">
    <header class="detail-header">
      <button type="button" class="detail-back" :title="title" @click="emit('back')">
        <IconFont name="iconarrow-left-2-icon" />
        <span class="detail-back-title">{{ title }}</span>
      </button>
      <div class="detail-header-actions"><slot name="header-actions" /></div>
    </header>
    <div ref="content" class="detail-content">
      <div class="hero-section" :style="backdropStyle">
        <slot name="backdrop" />
        <div class="hero-content">
          <div v-if="$slots.poster" class="hero-poster"><slot name="poster" /></div>
          <div class="hero-info">
            <div class="hero-copy"><slot name="summary" /></div>
            <div class="hero-actions">
              <div class="hero-brand-title" :title="title">{{ title }}</div>
              <div class="actions-stack">
                <slot name="play-context" />
                <div class="play-row" :class="{ 'has-version': hasVersion }">
                  <button type="button" class="play-button" :class="{ 'has-resume': progress != null }"
                    :disabled="playDisabled" @click="emit('play')">
                    <span v-if="progress != null" class="play-button-progress" aria-hidden="true"
                      :style="{ width: `${progress}%` }" />
                    <span class="play-button-label">{{ playLabel }}</span>
                  </button>
                  <slot name="versions" />
                </div>
                <slot name="actions" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <slot />
    </div>
    <slot name="dialogs" />
  </div>
</template>

<style lang="less" src="./media-detail.less"></style>
