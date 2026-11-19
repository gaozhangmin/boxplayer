<script lang="ts">
interface DetailCard {
  id: string
  kind: string
  title: string
  selected?: boolean
  rows: { label: string; value: string }[]
}

</script>
<script setup lang="ts" generic="Card extends DetailCard">
import IconFont from '@/features/files/electron/IconFont.vue'

defineProps<{
  cards: Card[]
  file?: { source: string; name?: string; path?: string; summary?: string }
  interactive?: boolean
  selectable?: boolean
}>()
const emit = defineEmits<{ inspect: [card: Card]; select: [card: Card] }>()
</script>

<template>
  <section v-if="cards.length || file" class="scraped-media-info-section">
    <div class="section-header scraped-media-info-header">
      <h3>媒体</h3>
    </div>
    <div v-if="file" class="detail-file-bar">
      <div class="detail-file-source">在 {{ file.source }} 上</div>
      <div v-if="file.path" class="detail-file-path" :title="file.path">路径：{{ file.path }}</div>
      <div class="detail-file-name" :title="file.path">{{ file.name }}</div>
      <div v-if="file.summary" class="detail-file-meta">{{ file.summary }}</div>
    </div>

    <div class="detail-media-card-rail">
      <article
        v-for="card in cards"
        :key="card.id"
        class="detail-media-card"
        :class="[{ selected: card.selected }, `detail-media-card-${card.kind}`]"
        :data-media-kind="card.kind"
        :aria-pressed="selectable ? !!card.selected : undefined"
        :role="interactive ? 'button' : undefined"
        :tabindex="interactive ? 0 : undefined"
        @click="selectable ? emit('select', card) : interactive && emit('inspect', card)"
        @dblclick="selectable && emit('inspect', card)"
        @keydown.enter="selectable ? emit('select', card) : interactive && emit('inspect', card)"
        @keydown.space.prevent="selectable ? emit('select', card) : interactive && emit('inspect', card)"
      >
        <div v-if="card.selected" class="detail-media-card-selected-badge">
          <IconFont name="iconcheck" />
        </div>
        <div class="detail-media-card-title">
          <div class="detail-media-card-heading">
            <span class="detail-media-kind-badge">{{ card.kind === 'video' ? '影' : card.kind === 'audio' ? '声' : '字' }}</span>
            <span class="detail-media-card-title-text" :title="card.title">{{ card.title }}</span>
          </div>
        </div>
        <div class="detail-media-card-body">
          <div v-for="row in card.rows" :key="`${card.id}-${row.label}`" class="detail-media-row">
            <span>{{ row.label }}</span>
            <strong :title="row.value">{{ row.value }}</strong>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
