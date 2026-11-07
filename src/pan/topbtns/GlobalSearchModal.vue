<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, X, File, Folder } from 'lucide-vue-next'
import { useModalStore, useAppStore } from '../../store'
import message from '../../utils/message'
import { humanSize } from '../../utils/format'
import { searchAllDrives, searchResultGroupTitle, type GlobalSearchResult } from '../../utils/globalSearch'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits(['close'])

const modalStore = useModalStore()
const appStore = useAppStore()
const keyword = ref('')
const inputRef = ref<HTMLInputElement>()
const results = ref<GlobalSearchResult[]>([])
const searching = ref(false)
const selectedIndex = ref(0)
const searchTimer = ref<ReturnType<typeof setTimeout>>()
const searchId = ref(0)

const groupedResults = computed(() => {
  const groups: { key: string; title: string; items: GlobalSearchResult[] }[] = []
  const map = new Map<string, GlobalSearchResult[]>()
  for (const r of results.value) {
    const key = searchResultGroupTitle(r)
    if (!map.has(key)) {
      map.set(key, [])
      groups.push({ key, title: key, items: map.get(key)! })
    }
    map.get(key)!.push(r)
  }
  return groups
})

const allItems = computed(() => {
  const items: { groupIndex: number; itemIndex: number; result: GlobalSearchResult }[] = []
  groupedResults.value.forEach((group, gi) => {
    group.items.forEach((result, ii) => {
      items.push({ groupIndex: gi, itemIndex: ii, result })
    })
  })
  return items
})

const hasInput = computed(() => keyword.value.trim().length >= 2)

let searchController: AbortController | undefined

function doSearch() {
  const q = keyword.value.trim()
  if (q.length < 2) {
    results.value = []
    selectedIndex.value = 0
    return
  }
  const id = ++searchId.value
  searching.value = true
  searchController?.abort()
  searchController = new AbortController()
  results.value = []
  const publish = (items: GlobalSearchResult[]) => {
    if (id !== searchId.value) return
    const selected = allItems.value[selectedIndex.value]?.result
    results.value = items
    const retained = selected ? allItems.value.findIndex(entry => entry.result.id === selected.id && entry.result.user_id === selected.user_id && entry.result.mediaServerId === selected.mediaServerId) : -1
    selectedIndex.value = retained >= 0 ? retained : items.length > 0 ? 0 : -1
  }
  searchAllDrives(q, { signal: searchController.signal, onUpdate: publish }).then(publish).catch(() => {}).finally(() => {
    if (id === searchId.value) searching.value = false
  })
}

watch(keyword, () => {
  searchId.value++
  searchController?.abort()
  results.value = []
  if (searchTimer.value) clearTimeout(searchTimer.value)
  selectedIndex.value = 0
  if (keyword.value.trim().length < 2) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer.value = setTimeout(doSearch, 300)
})

function handleClose() {
  searchId.value++
  searchController?.abort()
  modalStore.showModal('', {})
}

function handleClick(result: GlobalSearchResult) {
  if (result.source === 'media_server') {
    handleClose()
    nextTick(() => appStore.toggleTab('media-server'))
    return
  }

  handleClose()
  nextTick(async () => {
    appStore.toggleTab('pan')
    const { default: PanDAL } = await import('../../pan/pandal')
    await nextTick()
    PanDAL.aReLoadOneDirToShow(result.drive_id, result.parent_file_id || result.file_id, true)
  })
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    handleClose()
    return
  }
  const total = allItems.value.length
  if (!total) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % total
    scrollToSelected()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + total) % total
    scrollToSelected()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = allItems.value[selectedIndex.value]
    if (item) handleClick(item.result)
  }
}

function scrollToSelected() {
  nextTick(() => {
    const el = document.querySelector('.gs-result-item.selected')
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      keyword.value = ''
      results.value = []
      selectedIndex.value = 0
      searching.value = false
      nextTick(() => {
        const el = document.getElementById('gs-input')
        if (el) {
          el.focus()
          setTimeout(() => el.focus(), 50)
        }
      })
    }
  }
)

onMounted(() => {
  if (props.visible) {
    nextTick(() => {
      const el = document.getElementById('gs-input')
      if (el) {
        el.focus()
        setTimeout(() => el.focus(), 50)
      }
    })
  }
})

onUnmounted(() => {
  searchId.value++
  searchController?.abort()
  if (searchTimer.value) clearTimeout(searchTimer.value)
})

function getExtBadge(ext: string) {
  return ext.split('/')[0].toLowerCase()
}
</script>

<template>
  <a-modal
    :visible="props.visible"
    modal-class="globalsearch-modal"
    :footer="false"
    :unmount-on-close="true"
    :mask-closable="true"
    :closable="false"
    :width="'640px'"
    @cancel="handleClose"
  >
    <div class="gs-root" @keydown="handleKeyDown">
      <div class="gs-input-wrap">
        <Search :size="18" :stroke-width="1.8" class="gs-search-icon" />
        <input
          id="gs-input"
          ref="inputRef"
          v-model="keyword"
          type="text"
          class="gs-input"
          placeholder="搜索所有网盘和媒体服务器..."
          autocomplete="off"
          spellcheck="false"
        />
        <button v-if="keyword" class="gs-clear-btn" type="button" @click="keyword = ''">
          <X :size="16" :stroke-width="2" />
        </button>
      </div>

      <div v-if="searching && hasInput" class="gs-status">
        <span class="gs-spinner" /> 搜索中...
      </div>
      <div v-else-if="!hasInput" class="gs-status gs-hint">
        输入至少 2 个字符开始搜索
      </div>
      <div v-else-if="results.length === 0" class="gs-status">
        未找到与 "{{ keyword }}" 相关的结果
      </div>

      <div v-if="results.length > 0" class="gs-results">
        <div
          v-for="(group, gi) in groupedResults"
          :key="group.key"
          class="gs-group"
        >
          <div class="gs-group-title">{{ group.title }} ({{ group.items.length }})</div>
          <div
            v-for="(item, ii) in group.items"
            :key="item.id"
            class="gs-result-item"
            :class="{ selected: allItems.findIndex(i => i.groupIndex === gi && i.itemIndex === ii) === selectedIndex }"
            @click="handleClick(item)"
            @mouseenter="selectedIndex = allItems.findIndex(i => i.groupIndex === gi && i.itemIndex === ii)"
          >
            <div class="gs-result-icon">
              <Folder v-if="item.isDir && item.source === 'cloud'" :size="18" :stroke-width="1.5" />
              <File v-else-if="item.source === 'cloud'" :size="18" :stroke-width="1.5" />
              <span v-else class="gs-ms-icon">🎬</span>
            </div>
            <div class="gs-result-body">
              <div class="gs-result-name">{{ item.name }}</div>
              <div class="gs-result-meta">
                <span v-if="item.ext" class="gs-ext-badge">{{ getExtBadge(item.ext) }}</span>
                <span v-if="item.size > 0">{{ humanSize(item.size) }}</span>
                <span class="gs-source-tag">{{ item.source === 'media_server' ? item.providerName : item.providerName }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="gs-footer">
        <span>↑↓ 导航</span>
        <span>↵ 打开</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
:global(.globalsearch-modal) {
  border-radius: 8px;
}

:global(.globalsearch-modal .arco-modal-header) {
  display: none;
}

:global(.globalsearch-modal .arco-modal-body) {
  padding: 0;
}

.gs-root {
  color: var(--color-text-2);
  background: var(--color-bg-1);
  outline: none;
}

.gs-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 10px;
  border-bottom: 1px solid var(--color-border-2);
}

.gs-search-icon {
  flex-shrink: 0;
  color: var(--color-text-3);
}

.gs-input {
  flex: 1;
  padding: 0;
  color: var(--color-text-1);
  font-size: 17px;
  font-weight: 400;
  line-height: 32px;
  background: transparent;
  border: 0;
  outline: none;
}

.gs-input::placeholder {
  color: var(--color-text-4);
}

.gs-clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-3);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.gs-clear-btn:hover {
  background: var(--color-fill-2);
}

.gs-status {
  padding: 24px 20px;
  font-size: 13px;
  text-align: center;
  color: var(--color-text-3);
}

.gs-hint {
  padding-top: 48px;
  padding-bottom: 48px;
  font-size: 14px;
}

.gs-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border-2);
  border-top-color: rgb(var(--primary-6));
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 6px;
  animation: gs-spin 0.6s linear infinite;
}

@keyframes gs-spin {
  to { transform: rotate(360deg); }
}

.gs-results {
  max-height: 420px;
  overflow-y: auto;
  border-top: 1px solid var(--color-border-2);
}

.gs-results::-webkit-scrollbar {
  width: 6px;
}

.gs-results::-webkit-scrollbar-thumb {
  background: var(--color-border-2);
  border-radius: 3px;
}

.gs-group {
  border-bottom: 1px solid var(--color-border-2);
}

.gs-group:last-child {
  border-bottom: 0;
}

.gs-group-title {
  padding: 8px 20px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-3);
  text-transform: none;
  background: var(--color-fill-1);
  border-bottom: 1px solid var(--color-border-2);
}

.gs-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.1s;
}

.gs-result-item:hover,
.gs-result-item.selected {
  background: var(--color-fill-2);
}

.gs-result-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  color: var(--color-text-3);
}

.gs-ms-icon {
  font-size: 18px;
}

.gs-result-body {
  flex: 1;
  min-width: 0;
}

.gs-result-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 20px;
}

.gs-result-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-text-3);
}

.gs-ext-badge {
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  line-height: 17px;
  color: var(--color-text-2);
  background: var(--color-fill-2);
  border-radius: 3px;
  text-transform: uppercase;
}

.gs-source-tag {
  padding: 0 5px;
  font-size: 11px;
  line-height: 17px;
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.08);
  border-radius: 3px;
}

.gs-footer {
  display: flex;
  gap: 16px;
  padding: 8px 20px;
  font-size: 11px;
  color: var(--color-text-4);
  border-top: 1px solid var(--color-border-2);
  background: var(--color-fill-1);
}
</style>
