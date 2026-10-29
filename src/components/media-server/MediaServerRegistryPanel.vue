<template>
  <div class="media-server-registry-panel">
    <div v-if="embedded && submitting && !showServerModal && !showPlexResourcesModal" class="source-pending">
      <a-spin :size="32" />
      <p>{{ t('source.waiting') }}</p>
      <a-button @click="emit('close')">{{ t('unified.back') }}</a-button>
    </div>
    <AddMediaServerModal
      :embedded="embedded"
      v-model:visible="showServerModal"
      :loading="submitting"
      :editing-server="editingServer"
      :default-type="pendingType"
      @submit="handleSubmitServer"
      @remove="handleRemoveFromEditor"
    />
    <PlexResourcesModal
      :embedded="embedded"
      v-model:visible="showPlexResourcesModal"
      :resources="plexResources"
      :loading="submitting"
      @confirm="handleConfirmPlexResources"
    />

    <template v-if="!formOnly">
    <div class="toolbar">
      <div class="toolbar-left">
        <a-button class="toolbar-btn" @click="handleAddServer">
          <template #icon><span class="toolbar-symbol">+</span></template>
        </a-button>
        <a-button class="toolbar-btn" @click="toggleViewMode">
          <template #icon>
            <IconFont :name="registry.preferences.serverListView === 'grid' ? 'iconliebiaomoshi' : 'iconxiaotumoshi'" class="toolbar-iconfont" />
          </template>
        </a-button>
      </div>

      <div class="toolbar-right">
        <a-dropdown trigger="click">
          <a-button class="toolbar-btn more-btn">
            <template #icon><span class="toolbar-symbol">⋯</span></template>
          </a-button>
          <template #content>
            <a-doption @click="toggleSortOrder">
              {{ registry.preferences.serverSortOrder === 'desc' ? t('mediaServer.switchAsc') : t('mediaServer.switchDesc') }}
            </a-doption>
            <a-dsubmenu>
              <template #default>{{ t('mediaServer.sortBy') }}</template>
              <template #content>
                <a-doption @click="handleSortByChange('lastUsedAt')">{{ t('mediaServer.sortLastUsed') }}</a-doption>
                <a-doption @click="handleSortByChange('name')">{{ t('mediaServer.sortName') }}</a-doption>
                <a-doption @click="handleSortByChange('createdAt')">{{ t('mediaServer.sortCreated') }}</a-doption>
                <a-doption @click="handleSortByChange('updatedAt')">{{ t('mediaServer.sortUpdated') }}</a-doption>
              </template>
            </a-dsubmenu>
            <template v-if="registry.preferences.serverListView === 'list'">
              <a-doption @click="toggleListOption('showAddress')">{{ registry.preferences.showAddress ? '✓ ' : '' }}{{ t('mediaServer.showAddress') }}</a-doption>
              <a-doption @click="toggleListOption('showMediaStatistics')">{{ registry.preferences.showMediaStatistics ? '✓ ' : '' }}{{ t('mediaServer.showMediaStatistics') }}</a-doption>
              <a-doption @click="toggleListOption('showConnectionStatus')">{{ registry.preferences.showConnectionStatus ? '✓ ' : '' }}{{ t('mediaServer.showConnectionStatus') }}</a-doption>
              <a-doption @click="toggleListOption('showWatchTime')">{{ registry.preferences.showWatchTime ? '✓ ' : '' }}{{ t('mediaServer.showWatchTime') }}</a-doption>
            </template>
          </template>
        </a-dropdown>
      </div>
    </div>

    <div v-if="displayServers.length > 0" class="server-list" :class="{ grid: registry.preferences.serverListView === 'grid' }">
      <a-trigger
        v-for="server in displayServers"
        :key="`${server.id}-${registry.preferences.pinnedServerIds?.join(',') || 'normal'}`"
        trigger="contextMenu"
        align-point
        auto-fit-position
        :popup-offset="6"
        class="server-context-trigger"
      >
        <div
          class="server-row"
          :class="{ active: registry.currentServer?.id === server.id, grid: registry.preferences.serverListView === 'grid' }"
          @click="handleUseServer(server.id)"
        >
          <div class="server-leading">
            <div class="server-icon" :class="`type-${server.type}`">
              <img :src="serverDisplayIcon(server)" :alt="server.type" @error="handleServerIconError($event, server.type)" />
            </div>

            <div class="server-info">
              <div class="server-name-row">
                <h3>{{ server.name }}</h3>
                <div class="server-name-status">
                  <span
                    v-if="registry.preferences.serverListView === 'grid' || (registry.preferences.showConnectionStatus && (server.loginStatus === 'success' || server.loginStatus === 'failed'))"
                    class="server-login-dot"
                    :class="server.loginStatus"
                  />
                  <span
                    v-if="isServerPinned(server.id) && registry.preferences.serverListView !== 'grid'"
                    class="pinned-badge"
                  >
                    {{ t('mediaServer.pinned') }}
                  </span>
                  <span v-if="registry.currentServer?.id === server.id && registry.preferences.serverListView !== 'grid'" class="current-badge">{{ t('mediaServer.current') }}</span>
                </div>
              </div>
              <div v-if="registry.preferences.showAddress" class="server-subtitle">{{ server.type }} - {{ normalizeServerHost(server.baseUrl) }}</div>
              <div v-if="registry.preferences.serverListView === 'list' && registry.preferences.showMediaStatistics && serverStatistics[server.id]" class="server-subtitle">
                {{ t('mediaServer.statisticsSummary', { movies: serverStatistics[server.id]?.movieCount ?? 0, series: serverStatistics[server.id]?.seriesCount ?? 0 }) }}
              </div>
              <div v-if="registry.preferences.serverListView === 'list' && registry.preferences.showWatchTime" class="server-subtitle">
                {{ t('mediaServer.watchTime') }}: {{ formatRelativeTime(server.lastPlayedAt) }}
              </div>
              <div v-if="server.notes" class="server-notes">{{ server.notes }}</div>
            </div>
          </div>

          <div class="server-actions" @click.stop>
            <a-button class="action-btn" type="text" @click="handleEditServer(server.id)">
              <template #icon><IconFont name="iconedit-square" /></template>
            </a-button>
            <a-button class="action-btn danger" type="text" @click="handleDeleteServer(server.id)">
              <template #icon><IconFont name="icondelete" /></template>
            </a-button>
          </div>

          <div v-if="registry.preferences.serverListView === 'grid'" class="server-grid-meta">
            <span class="server-grid-note">{{ server.notes || t('mediaServer.noNotes') }}</span>
            <span class="server-grid-time">{{ formatRelativeTime(server.lastUsedAt || server.updatedAt || server.createdAt) }}</span>
          </div>
          <span v-if="registry.preferences.serverListView === 'grid' && isServerPinned(server.id)" class="pinned-badge pinned-badge-grid">{{ t('mediaServer.pinned') }}</span>
        </div>
        <template #content>
          <div class="server-context-menu">
            <button class="server-context-item" type="button" @click="handleEditServer(server.id)">
              <IconFont name="iconedit-square" />
              <span>{{ t('mediaServer.edit') }}</span>
            </button>
            <button class="server-context-item" type="button" @click="openRenameServer(server.id)">
              <IconFont name="iconedit-square" />
              <span>{{ t('mediaServer.rename') }}</span>
            </button>
            <button class="server-context-item" type="button" @click="openIconManager(server.id)">
              <IconFont name="icontupianyulan" />
              <span>{{ t('mediaServer.changeIcon') }}</span>
            </button>
            <button class="server-context-item" type="button" @click="toggleServerPinned(server.id)">
              <IconFont name="iconcrown2" />
              <span>{{ isServerPinned(server.id) ? t('mediaServer.unpin') : t('mediaServer.pinned') }}</span>
            </button>
            <button
              class="server-context-item"
              type="button"
              :disabled="!server.customIconUrl"
              @click="resetServerIcon(server.id)"
            >
              <IconFont name="iconreload-1-icon" />
              <span>{{ t('mediaServer.restoreDefaultIcon') }}</span>
            </button>
            <div class="server-context-divider" />
            <button class="server-context-item danger" type="button" @click="handleDeleteServer(server.id)">
              <IconFont name="icondelete" />
              <span>{{ t('common.delete') }}</span>
            </button>
          </div>
        </template>
      </a-trigger>
    </div>

    <div class="connect-section">
      <div class="connect-title">{{ t('mediaServer.connectDots') }}</div>

      <div class="provider-list">
        <button class="provider-item" @click="handleQuickAdd('jellyfin')">
          <div class="provider-icon jellyfin"><img :src="jellyfinIcon" alt="Jellyfin" /></div>
          <span>Jellyfin</span>
        </button>
        <button class="provider-item" @click="handleQuickAdd('emby')">
          <div class="provider-icon emby"><img :src="embyIcon" alt="Emby" /></div>
          <span>Emby</span>
        </button>
        <button class="provider-item" @click="handleQuickAdd('plex')">
          <div class="provider-icon plex"><img :src="plexIcon" alt="Plex" /></div>
          <span>Plex</span>
        </button>
      </div>
    </div>

    </template>
    <a-modal
      v-model:visible="renameModalVisible"
      :title="t('mediaServer.renameServer')"
      width="420px"
      :mask-closable="false"
      @cancel="closeRenameServer"
    >
      <a-input
        v-model="renameServerName"
        :placeholder="t('mediaServer.renamePlaceholder')"
        allow-clear
        @press-enter="confirmRenameServer"
      />
      <template #footer>
        <div class="rename-modal-footer">
          <a-button @click="closeRenameServer">{{ t('common.cancel') }}</a-button>
          <a-button type="primary" @click="confirmRenameServer">{{ t('common.save') }}</a-button>
        </div>
      </template>
    </a-modal>

    <a-modal
      v-model:visible="iconManagerVisible"
      :footer="false"
      width="980px"
      class="server-icon-manager-modal"
    >
      <div class="server-icon-manager">
        <div class="server-icon-manager-header">
          <div>
            <div class="server-icon-manager-title">{{ t('mediaServer.iconManagerTitle') }}</div>
            <div class="server-icon-manager-subtitle">
              {{ t('mediaServer.iconManagerSubtitle') }}
            </div>
          </div>
          <div class="server-icon-manager-actions">
            <a-input
              v-model="iconSearchText"
              allow-clear
              class="server-icon-search"
              :placeholder="t('mediaServer.searchIconPlaceholder')"
            />
            <a-button type="outline" @click="addIconSetVisible = true">{{ t('mediaServer.addIconSetUrl') }}</a-button>
          </div>
        </div>

        <div class="server-icon-manager-layout">
          <div class="server-icon-set-column">
            <div class="server-icon-column-heading">{{ t('mediaServer.iconSets') }}</div>
            <div v-if="iconSetsLoading" class="server-icon-empty">
              <a-spin size="small" />
              <span>{{ t('mediaServer.loadingIconSets') }}</span>
            </div>
            <div v-else-if="filteredIconSets.length === 0" class="server-icon-empty">
              <span>{{ iconSetError || t('mediaServer.noIconSets') }}</span>
            </div>
            <div v-else class="server-icon-set-list">
              <button
                v-for="iconSet in filteredIconSets"
                :key="iconSet.id"
                type="button"
                class="server-icon-set-card"
                :class="{ active: selectedIconSetId === iconSet.id }"
                @click="selectedIconSetId = iconSet.id"
              >
                <div class="server-icon-set-preview">
                  <img v-if="iconSet.previewImageURL" :src="iconSet.previewImageURL" :alt="iconSet.name" />
                  <div v-else class="server-icon-set-preview-empty">{{ t('mediaServer.icon') }}</div>
                </div>
                <div class="server-icon-set-meta">
                  <strong>{{ iconSet.name }}</strong>
                  <span>{{ iconSet.description || t('mediaServer.noDescription') }}</span>
                </div>
              </button>
            </div>
          </div>

          <div class="server-icon-grid-column">
            <div class="server-icon-grid-header">
              <div>
                <div class="server-icon-column-heading">{{ selectedIconSet?.name || t('mediaServer.icon') }}</div>
                <div v-if="selectedIconSet?.description" class="server-icon-grid-subtitle">
                  {{ selectedIconSet.description }}
                </div>
              </div>
              <div class="server-icon-grid-tools">
                <a-button v-if="selectedIconSet" type="text" size="small" @click="refreshIconSet(selectedIconSet)">{{ t('mediaServer.refreshIconSet') }}</a-button>
                <a-button v-if="selectedIconSet" type="text" size="small" status="danger" @click="removeIconSet(selectedIconSet.id)">{{ t('mediaServer.deleteIconSet') }}</a-button>
              </div>
            </div>
            <div v-if="!selectedIconSet" class="server-icon-empty">
              <span>{{ t('mediaServer.selectIconSetFirst') }}</span>
            </div>
            <div v-else-if="filteredSelectedIcons.length === 0" class="server-icon-empty">
              <span>{{ t('mediaServer.noMatchedIcons') }}</span>
            </div>
            <div v-else class="server-icon-grid">
              <button
                v-for="icon in filteredSelectedIcons"
                :key="icon.id"
                type="button"
                class="server-icon-item"
                :class="{ active: icon.url === currentIconServer?.customIconUrl }"
                @click="applyServerIcon(icon.url)"
              >
                <div class="server-icon-item-preview">
                  <img :src="icon.url" :alt="icon.name" />
                </div>
                <span>{{ icon.name }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </a-modal>

    <a-modal
      v-model:visible="addIconSetVisible"
      :footer="false"
      width="560px"
      class="server-icon-add-modal"
    >
      <div class="server-icon-add-panel">
        <div class="server-icon-manager-title">{{ t('mediaServer.addIconSetUrl') }}</div>
        <div class="server-icon-manager-subtitle">
          {{ t('mediaServer.iconSetJsonHint') }}
        </div>
        <a-input
          v-model="iconSetUrlInput"
          allow-clear
          class="server-icon-add-input"
          placeholder="https://example.com/iconset.json"
          @press-enter="submitIconSetUrl"
        />
        <div class="server-icon-add-footer">
          <a-button @click="addIconSetVisible = false">{{ t('common.cancel') }}</a-button>
          <a-button type="primary" :loading="iconSetAdding" @click="submitIconSetUrl">{{ t('mediaServer.importIconSet') }}</a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { Modal } from '@arco-design/web-vue'
import { computed, ref, watch } from 'vue'
import message from '../../utils/message'
import useMediaServerRegistryStore from '../../store/mediaServerRegistry'
import useMediaServerNavigationStore from '../../store/mediaServerNavigation'
import type { MediaServerConfig, MediaServerSortBy, MediaServerType } from '../../types/mediaServer'
import type { MediaServerHomeStatistics } from '../../types/mediaServerContent'
import { getMediaServerHomeShell, getMediaServerHomeStatistics } from '../../media-server/contentGateway'
import type { PlexResource } from '../../types/mediaServerPlex'
import jellyfinIcon from '../../assets/media-server/jellyfin.svg'
import embyIcon from '../../assets/media-server/emby.svg'
import plexIcon from '../../assets/media-server/plex.svg'
import AddMediaServerModal from './AddMediaServerModal.vue'
import PlexResourcesModal from './PlexResourcesModal.vue'
import { fetchMediaServerLoginProfile, signInMediaServer } from '../../media-server/auth'
import { createPlexServerConfigs, signInPlex, verifyPlexServerConfig } from '../../media-server/plexAuth'
import { t } from '../../i18n'

const props = defineProps<{ formOnly?: boolean; embedded?: boolean; defaultType?: MediaServerType }>()
const registry = useMediaServerRegistryStore()
type ListOption = 'showAddress' | 'showMediaStatistics' | 'showConnectionStatus' | 'showWatchTime'
const serverStatistics = ref<Record<string, MediaServerHomeStatistics>>({})
const toggleListOption = (option: ListOption) => {
  registry.preferences[option] = !registry.preferences[option]
  registry.save()
}
watch(() => [registry.preferences.serverListView, registry.preferences.showMediaStatistics, registry.servers.map((server) => server.id).join(',')], () => {
  if (registry.preferences.serverListView !== 'list' || !registry.preferences.showMediaStatistics) return
  for (const server of registry.servers) {
    if (serverStatistics.value[server.id]) continue
    getMediaServerHomeShell(server).then(async ({ statistics }) => {
      serverStatistics.value[server.id] = statistics
      if (server.type !== 'plex') serverStatistics.value[server.id] = await getMediaServerHomeStatistics(server, statistics.libraryCount)
    }).catch(() => { /* Offline servers have no current media counts. */ })
  }
}, { immediate: true })
const navigation = useMediaServerNavigationStore()
const emit = defineEmits<{ (event: 'open-server', id: string): void; (event: 'close'): void; (event: 'saved'): void }>()
const MEDIA_SERVER_ICON_SET_URLS_KEY = 'MediaServer_IconSetUrls'
const showServerModal = ref(!!props.embedded)
const showPlexResourcesModal = ref(false)
const editingServer = ref<MediaServerConfig | null>(null)
const pendingType = ref<MediaServerType>(props.defaultType || 'jellyfin')
const pendingPlexName = ref('')
const submitting = ref(false)
watch([showServerModal, showPlexResourcesModal, submitting], ([form, resources, busy]) => {
  if (props.embedded && !form && !resources && !busy) emit('close')
})
const renameModalVisible = ref(false)
const renameServerId = ref('')
const renameServerName = ref('')
const plexResources = ref<PlexResource[]>([])
const iconManagerVisible = ref(false)
const addIconSetVisible = ref(false)
const currentIconServerId = ref('')
const iconSearchText = ref('')
const iconSetUrlInput = ref('')
const iconSetUrls = ref<string[]>([])
const iconSetsLoading = ref(false)
const iconSetAdding = ref(false)
const iconSetError = ref('')
const selectedIconSetId = ref('')

type IconSetPayload = {
  name: string
  description: string
  icons: Array<{ name: string; url: string }>
}

type IconSet = {
  id: string
  sourceUrl: string
  name: string
  description: string
  previewImageURL: string
  icons: Array<{ id: string; name: string; url: string }>
}

const iconSets = ref<IconSet[]>([])
iconSetUrls.value = (() => {
  try {
    const raw = localStorage.getItem(MEDIA_SERVER_ICON_SET_URLS_KEY)
    const parsed = raw ? JSON.parse(raw) : ['https://raw.githubusercontent.com/lige47/QuanX-icon-rule/refs/heads/main/lige-emby-icon.json']
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
})()
const displayServers = computed(() => {
  const pinnedOrder = new Map((registry.preferences.pinnedServerIds || []).map((id, index) => [id, index]))
  const servers = registry.filteredServers
  const pinned = servers.filter((server) => pinnedOrder.has(server.id))
  const unpinned = servers.filter((server) => !pinnedOrder.has(server.id))
  return [
    ...pinned.sort((left, right) => pinnedOrder.get(left.id)! - pinnedOrder.get(right.id)!),
    ...unpinned
  ]
})
const normalizedIconSearchText = computed(() => iconSearchText.value.trim().toLowerCase())
const iconSetMatchesSearch = (iconSet: IconSet, keyword: string) => {
  if (!keyword) return true
  if (iconSet.name.toLowerCase().includes(keyword) || iconSet.description.toLowerCase().includes(keyword)) return true
  return iconSet.icons.some((icon) => icon.name.toLowerCase().includes(keyword))
}
const filteredIconSets = computed(() => {
  const keyword = normalizedIconSearchText.value
  return iconSets.value.filter((iconSet) => iconSetMatchesSearch(iconSet, keyword))
})
const selectedIconSet = computed(() => {
  if (!iconSets.value.length) return undefined
  return iconSets.value.find((iconSet) => iconSet.id === selectedIconSetId.value) || iconSets.value[0]
})
const filteredSelectedIcons = computed(() => {
  const iconSet = selectedIconSet.value
  if (!iconSet) return []
  const keyword = normalizedIconSearchText.value
  if (!keyword) return iconSet.icons
  return iconSet.icons.filter((icon) => icon.name.toLowerCase().includes(keyword))
})
const currentIconServer = computed(() => registry.servers.find((server) => server.id === currentIconServerId.value) || null)

const normalizeServerHost = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl)
    return url.host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '')
  }
}

const providerIcon = (type: MediaServerType) => {
  if (type === 'jellyfin') return jellyfinIcon
  if (type === 'emby') return embyIcon
  return plexIcon
}
const serverDisplayIcon = (server: MediaServerConfig) => server.customIconUrl || providerIcon(server.type)

const handleServerIconError = (event: Event, type: MediaServerType) => {
  const image = event.target as HTMLImageElement | null
  if (!image) return
  image.onerror = null
  image.src = providerIcon(type)
}

const formatRelativeTime = (value?: number) => {
  if (!value) return t('mediaServer.notWatched')
  const diff = Date.now() - value
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  if (diff < minute) return t('mediaServer.justNow')
  if (diff < hour) return t('mediaServer.minutesAgo', { count: Math.max(1, Math.floor(diff / minute)) })
  if (diff < day) return t('mediaServer.hoursAgo', { count: Math.max(1, Math.floor(diff / hour)) })
  if (diff < month) return t('mediaServer.daysAgo', { count: Math.max(1, Math.floor(diff / day)) })
  return t('mediaServer.monthsAgo', { count: Math.max(1, Math.floor(diff / month)) })
}

const handleAddServer = () => {
  editingServer.value = null
  pendingType.value = 'jellyfin'
  showServerModal.value = true
}

const handleQuickAdd = (type: MediaServerType) => {
  if (type === 'plex' && !props.embedded) {
    void handlePlexSignIn()
    return
  }
  editingServer.value = null
  pendingType.value = type
  showServerModal.value = true
}

const handleUseServer = (id: string) => {
  registry.setCurrentServer(id)
  navigation.goHome()
  emit('open-server', id)
}

const handleEditServer = (id: string) => {
  const server = registry.servers.find((item) => item.id === id)
  if (!server) return
  editingServer.value = server
  pendingType.value = server.type
  showServerModal.value = true
}

const handleDeleteServer = (id: string) => {
  const server = registry.servers.find((item) => item.id === id)
  if (!server) return
  Modal.confirm({
    title: t('mediaServer.deleteServerTitle'),
    content: t('mediaServer.deleteServerConfirm', { name: server.name }),
    onOk: () => {
      registry.removeServer(id)
      if (!registry.currentServer) navigation.openRegistry()
      message.success(t('mediaServer.serverDeleted'))
    }
  })
}

const handleRemoveFromEditor = (id: string) => {
  showServerModal.value = false
  handleDeleteServer(id)
}

const isServerPinned = (id: string) => {
  return (registry.preferences.pinnedServerIds || []).includes(id)
}

const toggleServerPinned = (id: string) => {
  const pinned = registry.preferences.pinnedServerIds || []
  const pinnedServerIds = pinned.includes(id)
    ? pinned.filter((serverId) => serverId !== id)
    : [id, ...pinned]
  registry.$patch({
    preferences: {
      ...registry.preferences,
      pinnedServerIds
    }
  })
  registry.save()
  message.success(isServerPinned(id) ? t('mediaServer.serverPinned') : t('mediaServer.serverUnpinned'))
}

const writeIconSetUrls = (items: string[]) => {
  localStorage.setItem(MEDIA_SERVER_ICON_SET_URLS_KEY, JSON.stringify(items))
}

const selectFirstAvailableIconSet = () => {
  if (!selectedIconSetId.value || !iconSets.value.some((iconSet) => iconSet.id === selectedIconSetId.value)) {
    selectedIconSetId.value = iconSets.value[0]?.id || ''
  }
}

const normalizeIconSet = (sourceUrl: string, payload: IconSetPayload): IconSet => ({
  id: sourceUrl,
  sourceUrl,
  name: payload.name?.trim() || t('mediaServer.unnamedIconSet'),
  description: payload.description?.trim() || '',
  previewImageURL: payload.icons[0]?.url || '',
  icons: (payload.icons || [])
    .filter((icon) => typeof icon?.url === 'string' && icon.url.trim())
    .map((icon, index) => ({
      id: `${sourceUrl}#${index}`,
      name: icon.name?.trim() || t('mediaServer.iconName', { index: index + 1 }),
      url: icon.url.trim()
    }))
})

const loadIconSetFromUrl = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as IconSetPayload
  if (!payload || !Array.isArray(payload.icons)) throw new Error(t('mediaServer.invalidIconSet'))
  const iconSet = normalizeIconSet(sourceUrl, payload)
  if (!iconSet.icons.length) throw new Error(t('mediaServer.emptyIconSet'))
  return iconSet
}

const loadAllIconSets = async () => {
  if (!iconSetUrls.value.length) {
    iconSets.value = []
    selectedIconSetId.value = ''
    return
  }
  iconSetsLoading.value = true
  iconSetError.value = ''
  const loaded: IconSet[] = []
  for (const sourceUrl of iconSetUrls.value) {
    try {
      loaded.push(await loadIconSetFromUrl(sourceUrl))
    } catch (error: any) {
      console.error(`failed to load media server icon set from ${sourceUrl}`, error)
      iconSetError.value = t('mediaServer.iconSetLoadPartialFailed', { message: error?.message || t('mediaServer.unknownError') })
    }
  }
  iconSets.value = loaded
  selectFirstAvailableIconSet()
  iconSetsLoading.value = false
}

const openIconManager = (id: string) => {
  currentIconServerId.value = id
  iconManagerVisible.value = true
  void loadAllIconSets()
}

const submitIconSetUrl = async () => {
  const sourceUrl = iconSetUrlInput.value.trim()
  if (!sourceUrl) {
    message.error(t('mediaServer.enterIconSetUrl'))
    return
  }
  if (iconSetUrls.value.includes(sourceUrl)) {
    message.info(t('mediaServer.iconSetImportedAlready'))
    addIconSetVisible.value = false
    iconSetUrlInput.value = ''
    return
  }
  iconSetAdding.value = true
  try {
    const iconSet = await loadIconSetFromUrl(sourceUrl)
    iconSetUrls.value = [...iconSetUrls.value, sourceUrl]
    writeIconSetUrls(iconSetUrls.value)
    iconSets.value = [...iconSets.value, iconSet]
    selectedIconSetId.value = iconSet.id
    addIconSetVisible.value = false
    iconSetUrlInput.value = ''
    iconSetError.value = ''
    message.success(t('mediaServer.iconSetImported'))
  } catch (error: any) {
    message.error(t('mediaServer.importFailed', { message: error?.message || t('mediaServer.unknownError') }))
  } finally {
    iconSetAdding.value = false
  }
}

const refreshIconSet = async (iconSet: IconSet) => {
  try {
    const refreshed = await loadIconSetFromUrl(iconSet.sourceUrl)
    iconSets.value = iconSets.value.map((item) => item.id === iconSet.id ? refreshed : item)
    if (selectedIconSetId.value === iconSet.id) selectedIconSetId.value = refreshed.id
    message.success(t('mediaServer.iconSetRefreshed'))
  } catch (error: any) {
    message.error(t('mediaServer.refreshFailed', { message: error?.message || t('mediaServer.unknownError') }))
  }
}

const removeIconSet = (iconSetId: string) => {
  const target = iconSets.value.find((item) => item.id === iconSetId)
  if (!target) return
  iconSets.value = iconSets.value.filter((item) => item.id !== iconSetId)
  iconSetUrls.value = iconSetUrls.value.filter((url) => url !== target.sourceUrl)
  writeIconSetUrls(iconSetUrls.value)
  if (selectedIconSetId.value === iconSetId) selectedIconSetId.value = iconSets.value[0]?.id || ''
  message.success(t('mediaServer.iconSetDeleted'))
}

const applyServerIcon = (iconUrl: string) => {
  if (!currentIconServerId.value) return
  registry.updateServer(currentIconServerId.value, { customIconUrl: iconUrl })
  message.success(t('mediaServer.iconUpdated'))
}

const resetServerIcon = (id: string) => {
  registry.updateServer(id, { customIconUrl: '' })
  message.success(t('mediaServer.defaultIconRestored'))
}

const openRenameServer = (id: string) => {
  const server = registry.servers.find((item) => item.id === id)
  if (!server) return
  renameServerId.value = id
  renameServerName.value = server.name
  renameModalVisible.value = true
}

const closeRenameServer = () => {
  renameModalVisible.value = false
  renameServerId.value = ''
  renameServerName.value = ''
}

const confirmRenameServer = () => {
  const name = renameServerName.value.trim()
  if (!renameServerId.value || !name) {
    message.error(t('mediaServer.enterServerName'))
    return
  }
  registry.updateServer(renameServerId.value, {
    name,
    nameCustomized: true
  })
  closeRenameServer()
  message.success(t('mediaServer.serverRenamed'))
}

const handleSortByChange = (value: MediaServerSortBy) => {
  registry.setServerSorting(value, registry.preferences.serverSortOrder)
}

const toggleSortOrder = () => {
  registry.setServerSorting(
    registry.preferences.serverSortBy,
    registry.preferences.serverSortOrder === 'desc' ? 'asc' : 'desc'
  )
}

const toggleViewMode = () => {
  registry.setServerListView(registry.preferences.serverListView === 'grid' ? 'list' : 'grid')
}

const handlePlexSignIn = async () => {
  try {
    submitting.value = true
    const resources = await signInPlex()
    plexResources.value = resources
    showPlexResourcesModal.value = true
  } catch (error: any) {
    console.error('Plex 登录失败:', error)
    message.error(error?.message || t('mediaServer.plexLoginFailed'))
  } finally {
    submitting.value = false
  }
}

const runBackgroundServerLogin = async (serverId: string, payload: {
  type: MediaServerType
  name: string
  baseUrl: string
  notes?: string
  host?: string
  port?: string
  path?: string
  username?: string
  password?: string
  useHttps?: boolean
  libraryMode?: boolean
  syncFlag?: boolean
  backupAddresses?: Record<string, string>
  nameCustomized?: boolean
}) => {
  if (payload.type === 'plex' || !payload.username?.trim() || !payload.password?.trim()) return
  try {
    const authResult = await signInMediaServer(payload)
    const current = registry.servers.find((item) => item.id === serverId)
    if (!current) return
    const profile = await fetchMediaServerLoginProfile({
      type: payload.type,
      baseUrl: authResult.normalizedBaseUrl,
      accessToken: authResult.accessToken
    })
    registry.updateServer(serverId, {
      baseUrl: authResult.normalizedBaseUrl,
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
      userId: authResult.userId,
      deviceId: authResult.deviceId,
      selectedResourceId: authResult.selectedResourceId,
      selectedResourceName: authResult.selectedResourceName,
      name: current.nameCustomized ? current.name : (profile.serverName || current.name),
      loginStatus: 'success',
      lastLoginCheckedAt: Date.now()
    })
  } catch (error) {
    console.error('媒体服务器静默登录失败:', error)
    registry.updateServer(serverId, {
      loginStatus: 'failed',
      lastLoginCheckedAt: Date.now()
    })
  }
}

const handleConfirmPlexResources = async (resources: PlexResource[]) => {
  try {
    submitting.value = true
    const servers = createPlexServerConfigs(resources)
    if (servers.length === 0) {
      message.error(t('mediaServer.noPlexServerToSave'))
      return
    }
    let firstServerId = ''
    let savedCount = 0
    let failedCount = 0
    for (const server of servers) {
      try {
        const serverName = await verifyPlexServerConfig(server)
        const saved = registry.addServer({
          ...server,
          name: pendingPlexName.value || (server.nameCustomized ? server.name : (serverName || server.name)),
          nameCustomized: !!pendingPlexName.value || server.nameCustomized,
          loginStatus: 'success',
          lastLoginCheckedAt: Date.now()
        })
        savedCount += 1
        if (!firstServerId) firstServerId = saved.id
      } catch (error) {
        failedCount += 1
        console.warn('跳过不可连接的 Plex 服务器:', server.name, error)
      }
    }
    if (savedCount === 0) {
      message.error(t('mediaServer.selectedPlexUnavailable'))
      return
    }
    if (firstServerId && !props.embedded) {
      registry.setCurrentServer(firstServerId)
      navigation.goHome()
      emit('open-server', firstServerId)
    }
    showPlexResourcesModal.value = false
    plexResources.value = []
    emit('saved')
    message.success(failedCount > 0 ? t('mediaServer.plexServersAddedPartial', { saved: savedCount, failed: failedCount }) : t('mediaServer.plexServersAdded', { saved: savedCount }))
  } catch (error: any) {
    console.error('保存 Plex 服务器失败:', error)
    message.error(error?.message || t('mediaServer.savePlexFailed'))
  } finally {
    submitting.value = false
  }
}

const handleSubmitServer = async (payload: {
  type: MediaServerType
  name: string
  baseUrl: string
  notes?: string
  host?: string
  port?: string
  path?: string
  username?: string
  password?: string
  useHttps?: boolean
  libraryMode?: boolean
  syncFlag?: boolean
  backupAddresses?: Record<string, string>
  nameCustomized?: boolean
}) => {
  try {
    submitting.value = true
    if (payload.type === 'plex' && !editingServer.value) {
      pendingPlexName.value = payload.nameCustomized ? payload.name : ''
      showServerModal.value = false
      await handlePlexSignIn()
      return
    }
    if (payload.type === 'plex' && editingServer.value) {
      const accessToken = editingServer.value.accessToken
      if (!accessToken) {
        message.error(t('mediaServer.plexMissingToken'))
        return
      }
      await verifyPlexServerConfig({
        baseUrl: payload.baseUrl,
        accessToken
      })
    }

    const shouldVerifyInBackground = payload.type !== 'plex'
      && !!payload.username?.trim()
      && !!payload.password?.trim()

    const savedPayload = {
      ...payload,
      nameCustomized: !!payload.nameCustomized,
      loginStatus: payload.type === 'plex'
        ? 'success' as const
        : (shouldVerifyInBackground
            ? 'checking' as const
            : (editingServer.value?.loginStatus ?? undefined)),
      lastLoginCheckedAt: editingServer.value?.lastLoginCheckedAt
    }

    let savedServer: MediaServerConfig | null = null
    if (editingServer.value) {
      registry.updateServer(editingServer.value.id, savedPayload)
      savedServer = registry.servers.find((item) => item.id === editingServer.value?.id) || null
    } else {
      savedServer = registry.addServer(savedPayload)
    }

    if (payload.type === 'plex') {
      message.success(t('mediaServer.serverSaved'))
    } else if (shouldVerifyInBackground) {
      message.success(t('mediaServer.serverSavedChecking'))
    } else {
      message.success(t('mediaServer.serverSaved'))
    }

    showServerModal.value = false
    editingServer.value = null
    emit('saved')

    if (savedServer && shouldVerifyInBackground) {
      void runBackgroundServerLogin(savedServer.id, payload)
    }
  } catch (error: any) {
    console.error('保存媒体服务器失败:', error)
    message.error(error?.message || t('mediaServer.saveServerFailed'))
  } finally {
    submitting.value = false
  }
}
defineExpose({ openAddServer: handleAddServer, openProvider: handleQuickAdd, editServer: handleEditServer, deleteServer: handleDeleteServer, openIconManager })
</script>

<style scoped>
.source-pending{display:flex;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:32px;color:var(--color-text-2)}
.media-server-registry-panel {
  height: 100%;
  overflow: auto;
  padding: 10px 0 28px;
  background: #fff;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 18px 14px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.toolbar-left,
.toolbar-right {
  display: flex;
  gap: 10px;
  align-items: center;
}

.toolbar-btn {
  width: 46px;
  height: 46px;
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.toolbar-iconfont {
  font-size: 18px;
  line-height: 1;
  color: #4b5563;
}

.more-btn {
  width: 52px;
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 16px;
}

.server-list.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 260px);
  justify-content: flex-start;
  gap: 14px;
}

.server-context-trigger {
  display: block;
  min-width: 0;
}

.server-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.server-row:hover {
  background: rgba(255, 255, 255, 0.04);
  transform: translateY(-1px);
}

.server-row.active {
  background: rgba(22, 119, 255, 0.06);
  border-color: rgba(22, 119, 255, 0.18);
  box-shadow: 0 18px 36px rgba(22, 119, 255, 0.12);
}

.server-row.grid {
  position: relative;
  display: block;
  min-height: 172px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  padding: 16px 18px;
}

.server-leading {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  flex: 1;
}

.server-icon,
.provider-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background: #fff;
}

.server-icon img,
.provider-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.server-icon.type-jellyfin,
.provider-icon.jellyfin {
  background: rgba(124, 92, 255, 0.08);
}

.server-icon.type-emby,
.provider-icon.emby {
  background: rgba(76, 175, 80, 0.08);
}

.server-icon.type-plex,
.provider-icon.plex {
  background: rgba(255, 176, 32, 0.08);
}

.server-info {
  min-width: 0;
}

.server-row.grid .server-leading {
  align-items: flex-start;
}

.server-row.grid .server-icon {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 42px;
  height: 42px;
  border-radius: 14px;
}

.server-row.grid .server-info {
  display: flex;
  flex-direction: column;
  min-height: 122px;
  width: 100%;
}

.server-row.grid .server-name-row {
  max-width: calc(100% - 152px);
  padding-right: 0;
}

.server-row.grid .server-subtitle {
  display: none;
}

.server-row.grid .server-notes {
  display: none;
}

.server-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
  min-width: 0;
}

.server-name-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex: 0 0 auto;
}

.server-name-row h3 {
  min-width: 0;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-login-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
  flex-shrink: 0;
  box-shadow: 0 0 0 0 currentColor;
  animation: server-login-pulse 1.8s ease-out infinite;
}

.server-login-dot.success {
  color: #22c55e;
  background: currentColor;
}

.server-login-dot.failed {
  color: #ef4444;
  background: currentColor;
}

.server-row.grid .server-name-row h3 {
  font-size: 15px;
  line-height: 1.35;
  max-width: 100%;
}

.current-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.1);
  color: #1677ff;
  font-size: 11px;
  font-weight: 700;
}

.pinned-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 176, 32, 0.16);
  color: #d97706;
  font-size: 11px;
  font-weight: 800;
}

.pinned-badge-grid {
  position: absolute;
  top: 66px;
  right: 16px;
}

.server-subtitle {
  font-size: 14px;
  color: #6b7280;
}

.server-notes {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: #7b8494;
}

.server-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: #7b7b7b;
}

.action-btn.danger {
  color: #ff5f57;
}

.server-row.grid .server-actions {
  position: absolute;
  top: 14px;
  right: 78px;
}

.server-grid-meta {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: #6b7280;
}

.server-grid-note,
.server-grid-time {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-grid-note {
  font-weight: 600;
  color: #7a7f89;
}

.server-grid-time {
  flex-shrink: 0;
}

.connect-section {
  position: relative;
  margin: 18px 16px 0;
  padding: 22px 12px 0;
}

.server-context-menu {
  min-width: 150px;
  padding: 7px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--app-overlay-bg);
  box-shadow: 0 22px 48px rgba(35, 28, 21, 0.18);
  backdrop-filter: none;
}

.server-context-item {
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  color: var(--app-mineradio-ink, #e8ecef);
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.server-context-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.server-context-item:disabled {
  opacity: 0.46;
  cursor: not-allowed;
}

.server-context-item i {
  width: 18px;
  font-size: 16px;
  text-align: center;
  color: var(--app-mineradio-ink, #e8ecef); opacity: 0.56;
}

.server-context-item.danger,
.server-context-item.danger i {
  color: #ef4444;
}

.server-context-divider {
  height: 1px;
  margin: 6px 8px;
  background: rgba(24, 24, 24, 0.12);
}

.rename-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.server-icon-manager {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.server-icon-manager-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.server-icon-manager-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--app-mineradio-ink, #e8ecef);
}

.server-icon-manager-subtitle,
.server-icon-grid-subtitle {
  margin-top: 6px;
  color: rgba(71, 85, 105, 0.78);
  line-height: 1.5;
}

.server-icon-manager-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.server-icon-search {
  width: 280px;
}

.server-icon-manager-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  min-height: 420px;
  max-height: 68vh;
}

.server-icon-set-column,
.server-icon-grid-column,
.server-icon-add-panel {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 22px 44px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
}

.server-icon-set-column,
.server-icon-grid-column {
  padding: 18px;
}

.server-icon-column-heading {
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}

.server-icon-set-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
  max-height: 454px;
  overflow: auto;
}

.server-icon-set-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: 0.18s ease;
}

.server-icon-set-card:hover,
.server-icon-set-card.active {
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 16px 30px rgba(37, 99, 235, 0.12);
}

.server-icon-set-preview {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.14);
  flex: 0 0 auto;
}

.server-icon-set-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.server-icon-set-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(71, 85, 105, 0.72);
  font-size: 12px;
  font-weight: 700;
}

.server-icon-set-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  text-align: left;
}

.server-icon-set-meta strong,
.server-icon-item span {
  color: #0f172a;
}

.server-icon-set-meta span {
  color: rgba(71, 85, 105, 0.76);
  font-size: 12px;
  line-height: 1.5;
}

.server-icon-grid-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.server-icon-grid-tools {
  display: flex;
  gap: 8px;
}

.server-icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 14px;
  max-height: 420px;
  overflow: auto;
  padding-right: 4px;
}

.server-icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: 0.18s ease;
}

.server-icon-item:hover,
.server-icon-item.active {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 16px 28px rgba(37, 99, 235, 0.12);
}

.server-icon-item-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  border-radius: 22px;
  background: rgba(148, 163, 184, 0.14);
}

.server-icon-item-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.server-icon-item span {
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  line-height: 1.45;
}

.server-icon-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 240px;
  color: rgba(71, 85, 105, 0.72);
}

.server-icon-add-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px;
}

.server-icon-add-input {
  width: 100%;
}

.server-icon-add-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.connect-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: -12px;
  right: -12px;
  height: 1px;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.28), rgba(148, 163, 184, 0));
}

.connect-title {
  margin-bottom: 18px;
  color: #6b7280;
  font-size: 15px;
  font-weight: 600;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border: none;
  background: transparent;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  cursor: pointer;
  text-align: left;
}

@keyframes server-login-pulse {
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 8px rgba(0, 0, 0, 0);
    opacity: 0.92;
  }
  100% {
    box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
    opacity: 1;
  }
}

[arco-theme='dark'] .server-row.grid {
  background: linear-gradient(180deg, rgba(34, 38, 49, 0.96), rgba(26, 30, 40, 0.94));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.26);
}

[arco-theme='dark'] .media-server-registry-panel {
  background: linear-gradient(180deg, #0f141c 0%, #0b1017 100%);
}

[arco-theme='dark'] .toolbar {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .toolbar-btn {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .toolbar-iconfont,
[arco-theme='dark'] .connect-title,
[arco-theme='dark'] .server-grid-note,
[arco-theme='dark'] .server-grid-time {
  color: rgba(191, 201, 216, 0.76);
}

[arco-theme='dark'] .server-row {
  border-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(23, 29, 39, 0.94), rgba(18, 24, 34, 0.92));
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.2);
}

[arco-theme='dark'] .server-row:hover {
  background: linear-gradient(180deg, rgba(28, 35, 47, 0.96), rgba(21, 28, 39, 0.94));
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24);
}

[arco-theme='dark'] .server-row.active {
  background: linear-gradient(180deg, rgba(29, 44, 68, 0.96), rgba(24, 38, 58, 0.94));
  border-color: rgba(96, 165, 250, 0.22);
  box-shadow: 0 18px 38px rgba(30, 64, 175, 0.22);
}

[arco-theme='dark'] .server-name-row h3,
[arco-theme='dark'] .provider-item {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .server-icon,
[arco-theme='dark'] .provider-icon {
  background: rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .server-grid-meta,
[arco-theme='dark'] .server-notes,
[arco-theme='dark'] .server-subtitle {
  color: rgba(218, 224, 235, 0.72);
}

[arco-theme='dark'] .server-context-menu {
  background: var(--app-overlay-bg);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.36);
}

[arco-theme='dark'] .server-context-item {
  color: rgba(238, 243, 250, 0.94);
}

[arco-theme='dark'] .server-context-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .server-context-item i {
  color: rgba(238, 243, 250, 0.72);
}

[arco-theme='dark'] .server-context-divider {
  background: rgba(255, 255, 255, 0.1);
}

[arco-theme='dark'] .server-icon-manager-title,
[arco-theme='dark'] .server-icon-column-heading,
[arco-theme='dark'] .server-icon-set-meta strong,
[arco-theme='dark'] .server-icon-item span {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .server-icon-manager-subtitle,
[arco-theme='dark'] .server-icon-grid-subtitle,
[arco-theme='dark'] .server-icon-set-meta span,
[arco-theme='dark'] .server-icon-empty,
[arco-theme='dark'] .server-icon-set-preview-empty {
  color: rgba(191, 201, 216, 0.72);
}

[arco-theme='dark'] .server-icon-set-column,
[arco-theme='dark'] .server-icon-grid-column,
[arco-theme='dark'] .server-icon-add-panel {
  border-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(24, 29, 40, 0.96), rgba(17, 21, 30, 0.92));
  box-shadow: 0 24px 52px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .server-icon-set-card,
[arco-theme='dark'] .server-icon-item {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
}

[arco-theme='dark'] .server-icon-set-card:hover,
[arco-theme='dark'] .server-icon-set-card.active,
[arco-theme='dark'] .server-icon-item:hover,
[arco-theme='dark'] .server-icon-item.active {
  border-color: rgba(96, 165, 250, 0.3);
  background: linear-gradient(180deg, rgba(31, 49, 78, 0.92), rgba(24, 40, 66, 0.88));
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.3);
}

[arco-theme='dark'] .server-icon-set-preview,
[arco-theme='dark'] .server-icon-item-preview {
  background: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .pinned-badge {
  background: rgba(255, 176, 32, 0.16);
  color: #fbbf24;
}

[arco-theme='dark'] .connect-section::before {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(148, 163, 184, 0.16), rgba(255, 255, 255, 0));
}
</style>
