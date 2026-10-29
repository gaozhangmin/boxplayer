<script setup lang="ts">
import useSettingStore, { DanmakuApiSetting, DanmakuMode } from './settingstore'
import MySwitch from '../layout/MySwitch.vue'
import { t } from '../i18n'

const settingStore = useSettingStore()

const update = (partial: Partial<typeof settingStore.$state>) => {
  settingStore.updateStore(partial)
}

const createId = () => {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `danmaku-api-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const updateApis = (apis: DanmakuApiSetting[]) => {
  update({ danmakuApis: apis })
}

const addApi = () => {
  updateApis([...settingStore.danmakuApis, { id: createId(), name: '', url: '' }])
}

const removeApi = (id: string) => {
  updateApis(settingStore.danmakuApis.filter((api) => api.id !== id))
}

const patchApi = (id: string, partial: Partial<DanmakuApiSetting>) => {
  updateApis(settingStore.danmakuApis.map((api) => api.id === id ? { ...api, ...partial } : api))
}

const modeOptions: Array<{ label: string, value: DanmakuMode }> = [
  { label: t('settings.danmaku.mode.scroll'), value: 0 },
  { label: t('settings.danmaku.mode.top'), value: 1 },
  { label: t('settings.danmaku.mode.bottom'), value: 2 }
]
</script>

<template>
  <div class="settingcard play-settings-card">
<!--    <div class="play-settings-intro">-->
<!--      <div class="play-settings-kicker">Danmaku</div>-->
<!--      <div class="play-settings-copy">配置弹幕库 API、自动匹配和 ArtPlayer 弹幕显示参数。</div>-->
<!--    </div>-->

    <div class="play-setting-group">
      <div class="play-setting-header">
        <div class="settinghead">{{ t('settings.danmaku.api') }}</div>
        <a-button type="primary" size="small" tabindex="-1" @click="addApi">{{ t('settings.danmaku.addApi') }}</a-button>
      </div>
      <div v-if="settingStore.danmakuApis.length === 0" class="settingrow play-setting-row">
        <span class="hitText">{{ t('settings.danmaku.emptyApi') }}</span>
      </div>
      <div v-for="(api, index) in settingStore.danmakuApis" :key="api.id" class="settingrow play-setting-row danmaku-api-row">
        <span class="opblue">#{{ index + 1 }}</span>
        <a-input
          tabindex="-1"
          :style="{ width: '180px' }"
          :placeholder="t('settings.danmaku.name')"
          :model-value="api.name"
          @update:model-value="patchApi(api.id, { name: $event })"
        />
        <a-input
          tabindex="-1"
          :style="{ width: '420px' }"
          placeholder="https://example.com"
          :model-value="api.url"
          @update:model-value="patchApi(api.id, { url: $event })"
        />
        <a-button type="outline" size="small" status="danger" tabindex="-1" @click="removeApi(api.id)">{{ t('file.delete') }}</a-button>
      </div>
    </div>

    <div class="play-setting-group">
      <div class="play-setting-header">
        <div class="settinghead">{{ t('settings.danmaku.display') }}</div>
      </div>
      <div class="settingrow play-setting-row danmaku-grid">
        <label>{{ t('settings.danmaku.duration') }}</label>
        <a-input-number mode="button" :min="1" :max="10" :step="1" :model-value="settingStore.danmakuSpeed" @update:model-value="update({ danmakuSpeed: Number($event) })" />
        <label>{{ t('settings.danmaku.marginTop') }}</label>
        <a-input-number mode="button" :min="0" :max="200" :step="1" :model-value="settingStore.danmakuMarginTop" @update:model-value="update({ danmakuMarginTop: Number($event) })" />
        <label>{{ t('settings.danmaku.marginBottom') }}</label>
        <a-input-number mode="button" :min="0" :max="String(settingStore.danmakuMarginBottom).includes('%') ? 100 : 200" :step="1" :model-value="parseFloat(settingStore.danmakuMarginBottom) || 0" @update:model-value="update({ danmakuMarginBottom: String($event ?? 0) + (String(settingStore.danmakuMarginBottom).includes('%') ? '%' : '') })">
          <template #suffix>{{ String(settingStore.danmakuMarginBottom).includes('%') ? '%' : 'px' }}</template>
        </a-input-number>
        <label>{{ t('settings.danmaku.opacity') }}</label>
        <a-input-number mode="button" :min="0" :max="1" :step="0.1" :model-value="settingStore.danmakuOpacity" @update:model-value="update({ danmakuOpacity: Number($event) })" />
        <label>{{ t('settings.danmaku.fontSize') }}</label>
        <a-input-number mode="button" :min="12" :max="80" :step="1" :model-value="settingStore.danmakuFontSize" @update:model-value="update({ danmakuFontSize: Number($event) })" />
        <label>{{ t('settings.danmaku.defaultColor') }}</label>
        <a-input tabindex="-1" :model-value="settingStore.danmakuColor" @update:model-value="update({ danmakuColor: $event })" />
        <label>{{ t('settings.danmaku.defaultMode') }}</label>
        <a-radio-group type="button" tabindex="-1" :model-value="settingStore.danmakuMode" @update:model-value="update({ danmakuMode: $event as DanmakuMode })">
          <a-radio v-for="mode in modeOptions" :key="mode.value" tabindex="-1" :value="mode.value">{{ mode.label }}</a-radio>
        </a-radio-group>
        <label>{{ t('settings.danmaku.visibleMode') }}</label>
        <a-checkbox-group tabindex="-1" :model-value="settingStore.danmakuModes" @update:model-value="update({ danmakuModes: $event as DanmakuMode[] })">
          <a-checkbox v-for="mode in modeOptions" :key="mode.value" tabindex="-1" :value="mode.value">{{ mode.label }}</a-checkbox>
        </a-checkbox-group>
        <label>{{ t('settings.danmaku.theme') }}</label>
        <a-radio-group type="button" tabindex="-1" :model-value="settingStore.danmakuTheme" @update:model-value="update({ danmakuTheme: $event })">
          <a-radio tabindex="-1" value="dark">Dark</a-radio>
          <a-radio tabindex="-1" value="light">Light</a-radio>
        </a-radio-group>
      </div>
      <div class="settingrow play-setting-row danmaku-switches">
        <MySwitch :value="settingStore.danmakuVisible" @update:value="update({ danmakuVisible: $event })">{{ t('settings.danmaku.visible') }}</MySwitch>
        <MySwitch :value="settingStore.danmakuAntiOverlap" @update:value="update({ danmakuAntiOverlap: $event })">{{ t('settings.danmaku.antiOverlap') }}</MySwitch>
        <MySwitch :value="settingStore.danmakuSynchronousPlayback" @update:value="update({ danmakuSynchronousPlayback: $event })">{{ t('settings.danmaku.syncPlayback') }}</MySwitch>
        <MySwitch :value="settingStore.danmakuHeatmap" @update:value="update({ danmakuHeatmap: $event })">{{ t('settings.danmaku.heatmap') }}</MySwitch>
      </div>
      <div class="settingrow play-setting-row play-setting-row--stack">
        <div class="settinghead">{{ t('settings.danmaku.filter') }}</div>
        <a-input
          tabindex="-1"
          :model-value="settingStore.danmakuFilterText"
          :placeholder="t('settings.danmaku.filterPlaceholder')"
          @update:model-value="update({ danmakuFilterText: $event })"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.danmaku-api-row {
  gap: 10px;
  align-items: center;
}

.danmaku-grid {
  display: grid;
  grid-template-columns: 92px minmax(160px, 1fr) 92px minmax(160px, 1fr);
  gap: 12px 16px;
  align-items: center;
}

.danmaku-grid label {
  color: #516070;
}

.danmaku-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
</style>
