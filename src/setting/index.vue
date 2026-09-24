<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../store'
import SettingPlay from './SettingPlay.vue'
import SettingMediaServerPlayback from './SettingMediaServerPlayback.vue'
import SettingDanmaku from './SettingDanmaku.vue'
import SettingPan from './SettingPan.vue'
import SettingUI from './SettingUI.vue'
import SettingAccount from './SettingAccount.vue'
import SettingDown from './SettingDown.vue'
import SettingDebug from './SettingDebug.vue'
import SettingUpload from './SettingUpload.vue'
import SettingAria from './SettingAria.vue'
import SettingLog from './SettingLog.vue'
import SettingProxy from './SettingProxy.vue'
import SettingSecurity from './SettingSecurity.vue'
import SettingDownloadAdvanced from './SettingDownloadAdvanced.vue'
import SettingAPI from './SettingAPI.vue'
import { t } from '../i18n'

const appStore = useAppStore()
withDefaults(defineProps<{ sidebarVisible?: boolean }>(), { sidebarVisible: true })

let observer: any

const hideSetting = computed(() => appStore.appTab !== 'setting')
const settingSearch = ref('')
const settingSearchResults = ref<Array<{ label: string; element: HTMLElement }>>([])
const settingSearchAnchor = ref<HTMLElement>()
const settingSearchPopupStyle = ref<Record<string, string>>({})

const matchesSettingSearch = (text: string, query: string) => {
  const source = text.toLocaleLowerCase()
  const keyword = query.toLocaleLowerCase().replace(/\s+/g, '')
  if (!keyword) return true
  if (source.includes(keyword)) return true
  let position = 0
  return [...keyword].every((character) => {
    position = source.indexOf(character, position)
    if (position < 0) return false
    position += character.length
    return true
  })
}

const refreshSettingSearch = async () => {
  await nextTick()
  const query = settingSearch.value.trim()
  if (!query) {
    settingSearchResults.value = []
    return
  }
  const rows = Array.from(document.querySelectorAll<HTMLElement>('#SettingObserver .settingrow'))
  settingSearchResults.value = rows
    .filter((row) => matchesSettingSearch(row.innerText.replace(/\s+/g, ' '), query))
    .slice(0, 20)
    .map((element) => ({ label: element.innerText.replace(/\s+/g, ' ').trim(), element }))
  updateSettingSearchPopupPosition()
}

const updateSettingSearchPopupPosition = () => {
  const rect = settingSearchAnchor.value?.getBoundingClientRect()
  if (!rect) return
  settingSearchPopupStyle.value = {
    left: `${Math.round(rect.left)}px`,
    top: `${Math.round(rect.bottom + 8)}px`,
    width: `${Math.max(300, Math.round(rect.width))}px`
  }
}

const locateSettingSearchResult = (result: { element: HTMLElement }) => {
  result.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  result.element.classList.remove('settings-search-hit')
  window.requestAnimationFrame(() => result.element.classList.add('settings-search-hit'))
  window.setTimeout(() => result.element.classList.remove('settings-search-hit'), 1400)
}

const sectionMeta: Record<string, { title: string }> = {
  SettingUI: { title: 'settings.app' },
  SettingAccount: { title: 'settings.account' },
  SettingAPI: { title: 'settings.ai' },
  SettingSecurity: { title: 'settings.security' },
  SettingPlay: { title: 'settings.player' },
  SettingMediaServerPlayback: { title: 'nav.mediaServer' },
  SettingDanmaku: { title: 'settings.danmaku' },
  SettingPan: { title: 'settings.pan' },
  SettingDown: { title: 'settings.download' },
  SettingDownloadAdvanced: { title: 'settings.downloadAdvanced' },
  SettingUpload: { title: 'settings.upload' },
  SettingDebug: { title: 'settings.advanced' },
  SettingProxy: { title: 'settings.proxy' },
  SettingAria: { title: 'settings.remoteAria' },
  SettingLog: { title: 'settings.logs' }
}

onMounted(() => {
  window.addEventListener('resize', updateSettingSearchPopupPosition)
  const root = document.getElementById('SettingObserver')
  if (!root) return

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.length > 0 && entries[0].isIntersecting) {
        appStore.toggleTabSetting('setting', entries[0].target.id)
      }
    },
    {
      root,
      threshold: 0.5
    }
  )

  const sectionIds = [
    'SettingUI',
    'SettingAccount',
    'SettingSecurity',
    'SettingPlay',
    'SettingMediaServerPlayback',
    'SettingDanmaku',
    'SettingPan',
    'SettingDown',
    'SettingDownloadAdvanced',
    'SettingUpload',
    'SettingDebug',
    'SettingProxy',
    'SettingAria',
    'SettingAPI',
    'SettingLog'
  ]

  sectionIds.forEach((id) => {
    const element = document.getElementById(id)
    if (element instanceof Element) {
      observer.observe(element)
    }
  })
})

onUnmounted(() => {
  if (observer) observer.disconnect()
  window.removeEventListener('resize', updateSettingSearchPopupPosition)
})
</script>

<template>
  <a-layout class="settings-shell">
    <a-layout-sider v-show="sidebarVisible" hide-trigger :width="188" class="xbyleft settings-sider single-boundary-sidebar" tabindex="-1" @keydown.tab.prevent="() => true">
      <div class='headdesc settings-side-title'>
        <span class="settings-side-kicker">{{ t('settings.preferences') }}</span>
        <strong>{{ t('settings.center') }}</strong>
      </div>
      <div ref="settingSearchAnchor" class="settings-search">
        <a-input-search v-model="settingSearch" allow-clear :placeholder="t('settings.searchPlaceholder')" @input="refreshSettingSearch" @clear="refreshSettingSearch" />
      </div>
      <a-menu :selected-keys="[appStore.GetAppTabMenu]" :style="{ width: '100%' }" class="xbyleftmenu single-boundary-sidebar-menu"
              @update:selected-keys="appStore.toggleTabMenu('setting', $event[0])">
        <div class="settings-menu-group">{{ t('settings.group.general') }}</div>
        <a-menu-item key="SettingUI">
          <template #icon><IconFont name="iconui" /></template>
          {{ t('settings.app') }}
        </a-menu-item>
        <a-menu-item key="SettingAccount">
          <template #icon><IconFont name="iconrobot" /></template>
          {{ t('settings.account') }}
        </a-menu-item>
        <a-menu-item key="SettingAPI">
          <template #icon><IconFont name="iconlock" /></template>
          {{ t('settings.ai') }}
        </a-menu-item>
        <a-menu-item key="SettingSecurity">
          <template #icon><IconFont name="iconchrome" /></template>
          {{ t('settings.security') }}
        </a-menu-item>
        <div class="settings-menu-group">{{ t('settings.group.playback') }}</div>
        <a-menu-item key="SettingPlay">
          <template #icon><IconFont name="iconshipin" /></template>
          {{ t('settings.player') }}
        </a-menu-item>
        <a-menu-item key="SettingMediaServerPlayback">
          <template #icon><IconFont name="iconshipin" /></template>
          {{ t('nav.mediaServer') }}
        </a-menu-item>
        <a-menu-item key="SettingDanmaku">
          <template #icon><IconFont name="iconshipin" /></template>
          {{ t('settings.danmaku') }}
        </a-menu-item>
        <div class="settings-menu-group">{{ t('settings.group.driveTransfer') }}</div>
        <a-menu-item key="SettingPan">
          <template #icon><IconFont name="iconfile-folder" /></template>
          {{ t('settings.pan') }}
        </a-menu-item>
        <a-menu-item key="SettingDown">
          <template #icon><IconFont name="icondownload" /></template>
          {{ t('settings.download') }}
        </a-menu-item>
        <a-menu-item key="SettingDownloadAdvanced">
          <template #icon><IconFont name="iconcloud-download" /></template>
          {{ t('settings.downloadAdvanced') }}
        </a-menu-item>
        <a-menu-item key="SettingUpload">
          <template #icon><IconFont name="iconupload" /></template>
          {{ t('settings.upload') }}
        </a-menu-item>
        <div class="settings-menu-group">{{ t('settings.group.system') }}</div>
        <a-menu-item key="SettingDebug">
          <template #icon><IconFont name="iconlogoff" /></template>
          {{ t('settings.advanced') }}
        </a-menu-item>
        <a-menu-item key="SettingProxy">
          <template #icon><IconFont name="iconyuanduanfuzhi" /></template>
          {{ t('settings.proxy') }}
        </a-menu-item>
        <a-menu-item key="SettingAria">
          <template #icon><IconFont name="iconchuanshu" /></template>
          {{ t('settings.remoteAria') }}
        </a-menu-item>
        <a-menu-item key="SettingLog">
          <template #icon><IconFont name="icondebug" /></template>
          {{ t('settings.logs') }}
        </a-menu-item>
      </a-menu>
    </a-layout-sider>
    <Teleport to="body">
      <div v-if="settingSearch.trim()" class="settings-search-results settings-search-results-popup" :style="settingSearchPopupStyle">
        <button v-for="result in settingSearchResults" :key="result.label" type="button" @click="locateSettingSearchResult(result)">{{ result.label }}</button>
        <span v-if="!settingSearchResults.length">{{ t('settings.searchNoResults') }}</span>
      </div>
    </Teleport>
    <a-layout-content id="SettingObserver" class="xbyright fullscroll settings-content" tabindex="-1" @keydown.tab.prevent="() => true">
      <div id="SettingDiv" class="settings-content-inner">
<!--        <div class="settings-hero">-->
<!--          <div>-->
<!--            <div class="settings-hero-kicker">BoxPlayer Workspace</div>-->
<!--            <h2>按照你的使用方式定制整个 App</h2>-->
<!--            <p>从界面风格到播放方式、从网盘策略到安全控制，所有配置集中在这里完成。</p>-->
<!--          </div>-->
<!--          <div class="settings-hero-meta">-->
<!--            <span>12 个模块</span>-->
<!--            <span>即时生效</span>-->
<!--          </div>-->
<!--        </div>-->

        <section id="SettingUI" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingUI.title as Parameters<typeof t>[0]) }}</h2></div><SettingUI /></section>
        <section id="SettingAccount" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingAccount.title as Parameters<typeof t>[0]) }}</h2></div><SettingAccount /></section>
        <section id="SettingAPI" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingAPI.title as Parameters<typeof t>[0]) }}</h2></div><SettingAPI /></section>
        <section id="SettingSecurity" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingSecurity.title as Parameters<typeof t>[0]) }}</h2></div><SettingSecurity /></section>
        <section id="SettingPlay" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingPlay.title as Parameters<typeof t>[0]) }}</h2></div><SettingPlay /></section>
        <section id="SettingMediaServerPlayback" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingMediaServerPlayback.title as Parameters<typeof t>[0]) }}</h2></div><SettingMediaServerPlayback /></section>
        <section id="SettingDanmaku" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingDanmaku.title as Parameters<typeof t>[0]) }}</h2></div><SettingDanmaku /></section>
        <section id="SettingPan" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingPan.title as Parameters<typeof t>[0]) }}</h2></div><SettingPan /></section>
        <section id="SettingDown" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingDown.title as Parameters<typeof t>[0]) }}</h2></div><SettingDown /></section>
        <section id="SettingDownloadAdvanced" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingDownloadAdvanced.title as Parameters<typeof t>[0]) }}</h2></div><SettingDownloadAdvanced /></section>
        <section id="SettingUpload" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingUpload.title as Parameters<typeof t>[0]) }}</h2></div><SettingUpload /></section>
        <section id="SettingDebug" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingDebug.title as Parameters<typeof t>[0]) }}</h2></div><SettingDebug /></section>
        <section id="SettingProxy" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingProxy.title as Parameters<typeof t>[0]) }}</h2></div><SettingProxy /></section>
        <section id="SettingAria" class="settings-section"><div class="settings-section-header"><h2>{{ t(sectionMeta.SettingAria.title as Parameters<typeof t>[0]) }}</h2></div><SettingAria /></section>
        <section id="SettingLog" class="settings-section">
          <div class="settings-section-header"><h2>{{ t(sectionMeta.SettingLog.title as Parameters<typeof t>[0]) }}</h2></div>
          <div v-if="hideSetting" style="min-height: 602px"></div>
          <SettingLog v-else />
        </section>
        <div style="height: 28px"></div>
      </div>
    </a-layout-content>
  </a-layout>
</template>

<style>
.settings-shell {
  height: 100%;
  background:
    radial-gradient(circle at top left, rgba(106, 154, 255, 0.18), transparent 24%),
    radial-gradient(circle at top right, rgba(255, 197, 122, 0.14), transparent 22%),
    linear-gradient(180deg, #f5f7fb 0%, #eef2f7 100%);
}

#SettingObserver {
  background: transparent;
  padding: 0 26px 0 18px !important;
}

.settings-sider {
  padding: 20px 16px 20px 20px;
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(249, 251, 255, 0.84), rgba(239, 244, 252, 0.74)) !important;
  border-right: 1px solid rgba(148, 163, 184, 0.14);
  backdrop-filter: blur(26px) saturate(140%);
  box-shadow:
    inset -1px 0 0 rgba(255, 255, 255, 0.58),
    12px 0 32px rgba(148, 163, 184, 0.08);
}

.settings-side-title {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: auto;
  min-height: 92px;
  margin: 2px 4px 18px;
  padding: 16px 16px 18px;
  line-height: normal;
  white-space: normal;
  overflow: visible;
  border-radius: 24px;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.74), transparent 46%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(241, 246, 255, 0.68));
  border: 1px solid rgba(255, 255, 255, 0.92);
  box-shadow:
    0 20px 42px rgba(86, 104, 136, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.88);
}

.settings-side-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6d7c95;
}

.settings-side-title strong {
  font-size: 24px;
  line-height: 1.15;
  color: #162033;
  white-space: nowrap;
}

.settings-content {
  padding-block: 18px 28px !important;
}

.settings-content-inner {
  position: relative;
  width: min(1180px, 100%);
  margin: 0 auto;
}

.settings-search {
  position: relative;
  z-index: 3;
  margin: 0 4px 16px;
}

.settings-search .arco-input-wrapper {
  min-height: 36px;
  padding-inline: 10px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.settings-search .arco-input {
  color: #26364f;
  font-size: 12px;
}

.settings-search .arco-input::placeholder {
  color: #77869c;
  opacity: 1;
}

.settings-search-results {
  display: grid;
  gap: 6px;
  max-height: 200px;
  margin-top: 8px;
  padding: 6px;
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.78);
  box-shadow: 0 10px 22px rgba(78, 97, 128, 0.1);
}

.settings-search-results-popup {
  position: fixed;
  z-index: 1001;
  max-width: calc(100vw - 16px);
  max-height: min(360px, calc(100vh - 24px));
}

.settings-search-results button,
.settings-search-results span {
  overflow: hidden;
  padding: 8px 10px;
  color: #52627c;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  border-radius: 9px;
  background: rgba(241, 245, 249, 0.78);
}

.settings-search-results button { cursor: pointer; }
.settings-search-results button:hover { color: #1d4ed8; background: rgba(219, 234, 254, 0.9); }
.settings-search-hit { animation: settings-search-hit 1.4s ease-out; }

@keyframes settings-search-hit {
  0%, 45% { background: rgba(147, 197, 253, 0.32); }
  100% { background: transparent; }
}

.settings-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin: 2px 0 26px;
  padding: 24px 28px;
  border-radius: 30px;
  background:
    radial-gradient(circle at top left, rgba(109, 154, 255, 0.2), transparent 26%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.84), rgba(245, 248, 255, 0.66));
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow:
    0 24px 48px rgba(78, 97, 128, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(24px) saturate(130%);
}

.settings-hero-kicker {
  margin-bottom: 8px;
  color: #5670a5;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.settings-hero h2 {
  margin: 0;
  color: #182237;
  font-size: 34px;
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.settings-hero p {
  max-width: 720px;
  margin: 10px 0 0;
  color: #68758b;
  font-size: 15px;
  line-height: 1.8;
}

.settings-hero-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.settings-hero-meta span {
  padding: 8px 14px;
  border-radius: 999px;
  color: #2b3a59;
  font-size: 13px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.86);
}

.settings-section {
  position: relative;
  margin: 30px 0;
  padding: 28px 32px 30px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 28px;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.88), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(248, 250, 252, 0.72));
  box-shadow:
    0 22px 48px rgba(78, 97, 128, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(18px) saturate(128%);
}

.settings-section + .settings-section {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.settings-section-header {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 6px;
  margin: 0 auto 22px;
  padding: 0 18px 22px;
  text-align: center;
}

.settings-section-header::after {
  display: block;
  width: 72px;
  height: 3px;
  margin-top: 8px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.18), rgba(59, 130, 246, 0.86), rgba(125, 211, 252, 0.18));
  content: '';
}

.settings-section-header h2 {
  margin: 0;
  color: #111827;
  font-size: 23px;
  line-height: 1.2;
  font-weight: 850;
  letter-spacing: -0.025em;
}

.settingcard {
  padding: 26px 28px;
  margin: 18px 0;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
  user-select: none;
  -webkit-user-drag: none;
  box-shadow: 0 4px 16px rgba(78, 97, 128, 0.08);
}

#xbybody #SettingObserver .settingcard {
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

.settingcard .iconbulb,
.settingrow .iconbulb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  width: 20px;
  margin-left: 6px;
  border-radius: 999px;
  color: #b7791f;
  font-size: 13px;
  background: rgba(255, 196, 82, 0.18);
  cursor: help;
  flex-shrink: 0;
}
html.dark .settingcard .iconbulb,
html.dark .settingrow .iconbulb {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.14);
}

.settinghead {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
  padding: 0 0 12px 0;
  color: #1a2740;
  font-size: 16px;
  line-height: 1.4;
  font-weight: 700;
  user-select: none;
  word-break: keep-all;
}

.settinghead > :deep(*) {
  flex: 0 0 auto;
}

.settinghead::after {
  position: absolute;
  left: 0;
  bottom: 0;
  display: block;
  width: 112px;
  max-width: 100%;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.78), rgba(125, 211, 252, 0.22));
  opacity: 0.9;
  content: '';
}

.settingrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
  max-width: 760px;
  margin-right: auto;
  color: #4b5565;
  line-height: 1.75;
}

.settingspace {
  height: 22px;
  user-select: none;
}

.hrspace {
  padding-top: 8px;
}

.opred,
.oporg,
.opblue {
  padding: 0 2px;
  color: rgb(211, 80, 75);
  background: rgba(211, 80, 75, 0.1);
}

.arco-popover-content hr {
  opacity: 0.2;
  border-top: none;
}

.settings-sider .xbyleftmenu {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

.settings-sider .xbyleftmenu .arco-menu-inner {
  padding: 0 !important;
}

.settings-menu-group {
  margin: 18px 10px 8px;
  padding-top: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  color: #8492aa;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.settings-menu-group:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.settings-sider .xbyleftmenu .arco-menu-item {
  position: relative;
  height: 48px;
  margin-bottom: 6px !important;
  padding: 0 14px !important;
  border-radius: 18px;
  color: #4f5f79;
  font-weight: 800;
  letter-spacing: 0.01em;
  transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
}

.settings-sider .xbyleftmenu .arco-menu-item:hover {
  background: rgba(255, 255, 255, 0.72) !important;
  color: #1f2f4c !important;
  box-shadow: 0 10px 24px rgba(148, 163, 184, 0.12);
  transform: translateX(2px);
}

.settings-sider .xbyleftmenu .arco-menu-selected {
  background:
    linear-gradient(135deg, rgba(191, 219, 254, 0.9), rgba(255, 255, 255, 0.92)) !important;
  color: #1d4ed8 !important;
  box-shadow:
    0 14px 28px rgba(82, 140, 255, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.settings-sider .xbyleftmenu .arco-menu-selected::before {
  position: absolute;
  left: 10px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #3b82f6, #60a5fa);
  content: '';
}

.settings-sider .xbyleftmenu .arco-menu-icon {
  font-size: 17px;
  margin-right: 12px !important;
  opacity: 0.92;
}

.settingcard .arco-input-wrapper,
.settingcard .arco-input,
.settingcard .arco-select-view,
.settingcard .arco-textarea-wrapper,
.settingcard .arco-input-number,
.settingcard .arco-picker,
.settingcard .arco-picker-size-medium,
.settingcard .arco-input-group-wrapper,
.settingcard .arco-input-search {
  border-radius: 16px !important;
}

.settingcard .arco-input-wrapper,
.settingcard .arco-select-view,
.settingcard .arco-textarea-wrapper,
.settingcard .arco-input-number,
.settingcard .arco-picker,
.settingcard .arco-picker-size-medium {
  background: rgba(255, 255, 255, 0.66) !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.settingcard .arco-btn {
  border-radius: 14px;
  font-weight: 700;
}

.settingcard .arco-radio-group-button .arco-radio-button {
  border-radius: 14px;
  margin-right: 8px;
  border-color: rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.5);
}

.settingcard .arco-radio-group-button .arco-radio-button:hover {
  border-color: rgba(var(--primary-6), 0.35);
}

.settingcard .arco-radio-group-button .arco-radio-button.arco-radio-checked {
  background: rgb(var(--primary-6));
  border-color: rgb(var(--primary-6));
}

.settingcard .arco-radio-group-button .arco-radio-button-content {
  font-weight: 700;
  color: var(--color-text-2);
}

.settingcard .arco-radio-group-button .arco-radio-checked .arco-radio-button-content {
  color: #fff;
}

.settingcard .arco-switch {
  transform: translateY(1px);
}

.settingcard .arco-divider-text {
  padding: 0 10px;
  color: #2a3a56;
  font-size: 14px;
  font-weight: 700;
  background: transparent;
}

.settingcard .arco-divider-line {
  border-color: rgba(148, 163, 184, 0.18);
}

body:not([arco-theme='dark']) #xbybody .settings-shell {
  background: var(--color-bg-1) !important;
}

body:not([arco-theme='dark']) #xbybody .settings-sider {
  color: #111827;
  background: var(--color-bg-1) !important;
  border-right-color: var(--color-border-2) !important;
  box-shadow: none !important;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver {
  color: #111827;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .settingcard,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settinghead,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-section-header h2,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-divider-text,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-checkbox-label,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-radio-label,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-switch-text {
  color: #111827 !important;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .settingrow,
body:not([arco-theme='dark']) #xbybody #SettingObserver .helptxt,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-app-subtitle,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-panel-copy,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-proxy-copy,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-log-caption,
body:not([arco-theme='dark']) #xbybody #SettingObserver .feedback-text,
body:not([arco-theme='dark']) #xbybody #SettingObserver .acc-desc {
  color: #374151 !important;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-input,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-textarea,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-select-view-value,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-input-number-input {
  color: #111827 !important;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-input::placeholder,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-textarea::placeholder,
body:not([arco-theme='dark']) #xbybody #SettingObserver .arco-input-number-input::placeholder {
  color: #6b7280 !important;
  opacity: 1;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-app-badge,
body:not([arco-theme='dark']) #xbybody #SettingObserver .play-settings-kicker,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-panel-kicker,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-proxy-kicker,
body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-log-kicker {
  color: var(--color-primary-6) !important;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-section-header {
  background: transparent;
}

body:not([arco-theme='dark']) #xbybody #SettingObserver .settings-section {
  background: var(--color-bg-1);
  border-color: var(--color-border-2);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

body:not([arco-theme='dark']) #xbybody .settingcard {
  background: var(--color-bg-1) !important;
  border-color: var(--color-border-2);
  box-shadow: none;
}

body:not([arco-theme='dark']) #xbybody .settings-side-title {
  background: var(--color-bg-1) !important;
  border-color: var(--color-border-2);
  box-shadow: none;
  backdrop-filter: none;
}

body[arco-theme='dark'] .settings-shell {
  background:
    radial-gradient(circle at top left, rgba(74, 108, 179, 0.26), transparent 24%),
    radial-gradient(circle at top right, rgba(155, 116, 54, 0.18), transparent 22%),
    linear-gradient(180deg, #0e131a 0%, #121822 100%);
}

body[arco-theme='dark'] .settings-sider {
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(28, 32, 42, 0.9), rgba(20, 24, 33, 0.84)) !important;
  border-color: rgba(255, 255, 255, 0.06) !important;
  box-shadow:
    inset -1px 0 0 rgba(255, 255, 255, 0.04),
    12px 0 30px rgba(0, 0, 0, 0.22) !important;
  backdrop-filter: blur(24px) saturate(135%);
}

body[arco-theme='dark'] .settings-side-title {
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.08), transparent 42%),
    linear-gradient(180deg, rgba(28, 32, 42, 0.92), rgba(20, 24, 33, 0.86)) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  box-shadow:
    0 18px 36px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
}

body[arco-theme='dark'] .settings-search .arco-input-wrapper {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

body[arco-theme='dark'] .settings-search .arco-input {
  color: rgba(238, 244, 252, 0.94);
}

body[arco-theme='dark'] .settings-search .arco-input::placeholder {
  color: rgba(191, 201, 216, 0.56);
}

body[arco-theme='dark'] .settings-search-results {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(18, 24, 34, 0.9);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
}

body[arco-theme='dark'] .settings-search-results button,
body[arco-theme='dark'] .settings-search-results span {
  color: rgba(210, 221, 236, 0.8);
  background: rgba(255, 255, 255, 0.05);
}

body[arco-theme='dark'] .settings-search-results button:hover {
  color: #8ff5ea;
  background: rgba(0, 245, 212, 0.1);
}

body[arco-theme='dark'] .settings-hero {
  background: rgba(18, 24, 34, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.26),
    inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
}
body[arco-theme='dark'] .settingcard {
  background: rgba(255, 255, 255, 0.045) !important;
  border-color: rgba(255, 255, 255, 0.07) !important;
  box-shadow: 0 18px 48px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.052);
  backdrop-filter: blur(20px) saturate(1.12);
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu {
  background: transparent !important;
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu-inner {
  background: transparent !important;
}

body[arco-theme='dark'] .settings-side-kicker,
body[arco-theme='dark'] .settings-side-title small,
body[arco-theme='dark'] .settings-hero-kicker,
body[arco-theme='dark'] .settings-hero p,
body[arco-theme='dark'] .settingrow {
  color: rgba(191, 201, 216, 0.76) !important;
}

body[arco-theme='dark'] .settings-side-title strong,
body[arco-theme='dark'] .settings-hero h2,
body[arco-theme='dark'] .settings-section-header h2,
body[arco-theme='dark'] .settinghead,
body[arco-theme='dark'] .settingcard .arco-divider-text,
body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu-item {
  color: rgba(244, 247, 252, 0.96) !important;
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu-item {
  background: rgba(255, 255, 255, 0.04) !important;
  border: 0 !important;
  box-shadow: none;
}

body[arco-theme='dark'] .settinghead::after {
  background: linear-gradient(90deg, var(--app-mineradio-accent, #00f5d4), rgba(0,245,212,.18));
}

body[arco-theme='dark'] .settings-section + .settings-section {
  border-top-color: rgba(255, 255, 255, 0.08);
}

body[arco-theme='dark'] .settings-section-header {
  background: transparent;
}

body[arco-theme='dark'] .settings-section {
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(23, 28, 38, 0.9), rgba(17, 22, 31, 0.82));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 24px 54px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

body[arco-theme='dark'] .settings-section-header::after {
  background: linear-gradient(90deg, rgba(0,245,212,.12), var(--app-mineradio-accent, #00f5d4), rgba(0,245,212,.12));
}

body[arco-theme='dark'] .settings-menu-group {
  border-top-color: rgba(255, 255, 255, 0.08);
  color: rgba(191, 201, 216, 0.5);
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu-item:hover {
  background:
    linear-gradient(180deg, rgba(42, 48, 62, 0.8), rgba(29, 34, 46, 0.72)) !important;
  border-color: transparent !important;
  box-shadow: none;
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu-selected {
  background:
    linear-gradient(135deg, rgba(0,245,212,.10), rgba(8,9,11,.80)) !important;
  border-color: transparent !important;
  box-shadow: none !important;
}

body[arco-theme='dark'] .settings-sider .xbyleftmenu .arco-menu-selected::before {
  background: linear-gradient(180deg, var(--app-mineradio-accent, #00f5d4), #8ff5ea);
}

body[arco-theme='dark'] .settingcard .arco-input-wrapper,
body[arco-theme='dark'] .settingcard .arco-select-view,
body[arco-theme='dark'] .settingcard .arco-textarea-wrapper,
body[arco-theme='dark'] .settingcard .arco-input-number,
body[arco-theme='dark'] .settingcard .arco-picker,
body[arco-theme='dark'] .settingcard .arco-picker-size-medium {
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

body[arco-theme='dark'] .settingcard .arco-radio-group-button .arco-radio-button {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.1);
}
body[arco-theme='dark'] .settingcard .arco-radio-group-button .arco-radio-button:hover {
  border-color: rgba(var(--primary-6), 0.4);
}
body[arco-theme='dark'] .settingcard .arco-radio-group-button .arco-radio-button-content {
  color: rgba(220, 226, 240, 0.7);
}
body[arco-theme='dark'] .settingcard .arco-radio-group-button .arco-radio-checked {
  background: rgb(var(--primary-6));
  border-color: rgb(var(--primary-6));
}
body[arco-theme='dark'] .settingcard .arco-radio-group-button .arco-radio-checked .arco-radio-button-content {
  color: #fff;
}

@media (max-width: 1080px) {
  .settings-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  #SettingObserver {
    padding: 0 16px !important;
  }

  .settingrow {
    max-width: 100%;
  }
}
</style>
