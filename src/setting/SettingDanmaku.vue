<script setup lang="ts">
import { ref } from 'vue'
import useSettingStore, { DanmakuApiSetting } from './settingstore'
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

const editingAPI = ref(false)
const reset = () => update({ danmakuEnabled: true, danmakuSearchHistory: true, danmakuMatchYear: false,
  danmakuSkipShort: true, danmakuFontFamily: 'system-ui', danmakuChinese: 'none',
  danmakuFixedToScroll: false, danmakuFilterText: '', danmakuLastQuery: '' })
</script>
<template>
  <div class="global-danmaku">
    <section><div class="row"><span>{{ t('globalDan.enabled') }}</span><MySwitch :value="settingStore.danmakuEnabled" @update:value="update({danmakuEnabled: $event})" /></div></section>
    <p class="hint">{{ t('globalDan.offHint') }}</p>
    <section>
      <div class="row"><span>{{ t('globalDan.history') }}</span><MySwitch :value="settingStore.danmakuSearchHistory" @update:value="update({danmakuSearchHistory: $event, ...(!$event ? {danmakuLastQuery: ''} : {})})" /></div>
      <div class="row"><span>{{ t('globalDan.year') }}</span><MySwitch :value="settingStore.danmakuMatchYear" @update:value="update({danmakuMatchYear: $event})" /></div>
      <div class="row unsupported" :title="t('globalDan.pipHint')"><span>{{ t('globalDan.pip') }}</span><input type="checkbox" disabled :checked="false" /></div>
    </section>
    <section><button class="row link" @click="editingAPI = true"><span>{{ t('globalDan.api') }}</span><span>›</span></button></section>
    <section>
      <label class="row"><span>{{ t('globalDan.font') }}</span><select :value="settingStore.danmakuFontFamily" @change="update({danmakuFontFamily: ($event.target as HTMLSelectElement).value})"><option value="system-ui">{{ t('globalDan.systemFont') }}</option><option value="sans-serif">Sans Serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select></label>
      <label class="row"><span>{{ t('globalDan.chinese') }}</span><select :value="settingStore.danmakuChinese" @change="update({danmakuChinese: ($event.target as HTMLSelectElement).value as 'none' | 'simplified' | 'traditional'})"><option value="none">{{ t('globalDan.none') }}</option><option value="simplified">{{ t('globalDan.simplified') }}</option><option value="traditional">{{ t('globalDan.traditional') }}</option></select></label>
      <div class="row"><span>{{ t('globalDan.fixed') }}</span><MySwitch :value="settingStore.danmakuFixedToScroll" @update:value="update({danmakuFixedToScroll: $event})" /></div>
      <div class="row"><span>{{ t('globalDan.short') }}<small>{{ t('globalDan.shortHint') }}</small></span><MySwitch :value="settingStore.danmakuSkipShort" @update:value="update({danmakuSkipShort: $event})" /></div>
      <button class="row link reset" @click="reset">{{ t('globalDan.reset') }}</button>
    </section>
    <h3>{{ t('globalDan.keywords') }}</h3>
    <section><textarea :aria-label="t('globalDan.keywords')" :value="settingStore.danmakuFilterText" @input="update({danmakuFilterText: ($event.target as HTMLTextAreaElement).value})" /></section>
    <p class="hint">{{ t('globalDan.keywordHint') }}</p>
    <h3>{{ t('globalDan.aboutTitle') }}</h3>
    <section class="about">{{ t('globalDan.about') }}</section>
    <a-modal v-model:visible="editingAPI" :title="t('globalDan.api')" :footer="false" width="min(800px, 90vw)">
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

    </a-modal>
  </div>
</template>
<style scoped>
.global-danmaku { max-width:760px; margin:auto; padding:24px 16px; color:var(--color-text-1); }
section { background:var(--color-bg-2); border-radius:22px; padding:0 20px; margin-top:28px; }
.row { display:flex; align-items:center; justify-content:space-between; gap:16px; width:100%; min-height:54px; box-sizing:border-box; border-bottom:1px solid var(--color-border-1); }
.row:last-child { border-bottom:0; }
select { max-width:45%; color:var(--color-text-2); background:transparent; border:0; }
.link { background:transparent; color:inherit; border:0; cursor:pointer; text-align:left; font:inherit; }
.reset { color:rgb(var(--primary-6)); }
small,.hint { display:block; color:var(--color-text-3); font-size:13px; margin:8px 0; }
h3 { color:var(--color-text-3); margin:28px 20px -12px; font-size:14px; }
textarea { width:100%; box-sizing:border-box; min-height:120px; padding:12px 0; color:inherit; background:transparent; border:0; resize:vertical; }
.about { white-space:pre-line; padding:20px; }
.unsupported { opacity:.45; }
.danmaku-api-row { gap:8px; flex-wrap:wrap; }
</style>
