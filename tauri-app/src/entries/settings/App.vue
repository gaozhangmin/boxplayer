<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FolderOpen, SlidersHorizontal, AppWindow, Globe, Database, HardDrive, ArrowLeft, ChevronsLeft, ChevronsRight, Monitor, Sun, Moon, ChevronRight, ChevronDown } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { toast } from 'vue-sonner'
import NetworkProxySettings from '@/features/sources/NetworkProxySettings.vue'
import AppFrame from '@/components/AppFrame.vue'
import WindowBar from '@/components/WindowBar.vue'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { useI18n } from '@/lib/i18n'
import { asAppError, isNative, revealData, runtimeInfo, exportMigration, importMigration,inspectMigration } from '@/platform/native'
import type { RuntimeInfo, SettingsPatch, Theme, Language } from '@/platform/contracts'
const settings = useSettingsStore()
const { t } = useI18n()
const migrationResult=ref('')
async function inspect(){try{const result=await inspectMigration();if(result)migrationResult.value=`${result.sourceVersion} · `+Object.entries(result.tables).map(([name,count])=>`${name}: ${count}`).join(' · ')}catch(error){toast.error(asAppError(error).message)}}
const selectedPanel = ref<'general'|'launch'|'migration'|'storage'|'network'>('general')
const panels = [{id:'general',label:'general',icon:SlidersHorizontal},{id:'launch',label:'launch',icon:AppWindow},{id:'network',label:'network',icon:Globe},{id:'migration',label:'dataMigration',icon:Database},{id:'storage',label:'storage',icon:HardDrive}] as const
const collapsed=ref(false)
const activePanel=computed(()=>panels.find(panel=>panel.id===selectedPanel.value)!)
const en=computed(()=>settings.value.language==='en')
async function close() { if(isNative()) {try {await getCurrentWindow().close()} catch(e) {toast.error(asAppError(e).message)}} }
const info = ref<RuntimeInfo>()
async function save(patch: SettingsPatch) { try { await settings.save(patch); toast.success(t('saved')) } catch (e) { toast.error(asAppError(e).message) } }
async function migrate(kind: 'import' | 'export') { try { const result = kind === 'import' ? await importMigration() : await exportMigration(); if (result) { if(typeof result==='object')migrationResult.value=`${result.applied?'已导入':'已导入过，未重复写入'} · ${result.mediaCount||0} 个视频 · ${result.sourceCount} 个本地来源 · ${result.positionCount} 条进度`;if(typeof result==='object'&&result.preferences){for(const [key,value]of Object.entries(result.preferences)){if(localStorage.getItem(key)===null)localStorage.setItem(key,value)}window.dispatchEvent(new Event('boxplayer:series-preferences'));window.dispatchEvent(new Event('boxplayer:general-preferences'))}toast.success(t('migrationDone')) } } catch (e) { toast.error(asAppError(e).message) } }
async function reveal() { try { await revealData() } catch (e) { toast.error(asAppError(e).message) } }
onMounted(async () => { if (isNative()) { try { info.value = await runtimeInfo() } catch (e) { toast.error(asAppError(e).message) } } })
</script>
<template>
  <AppFrame>
    <div class="settings-layout" :class="{'settings-collapsed':collapsed}">
      <aside class="settings-nav">
        <WindowBar :controls="false" class="settings-brand-header"><div class="settings-brand-title"><img src="/app-icon.png" alt="" width="25" height="25"/><strong v-if="!collapsed">BoxPlayer</strong><button class="settings-collapse" :aria-label="collapsed?t('expand'):t('collapse')" @click="collapsed=!collapsed"><component :is="collapsed?ChevronsRight:ChevronsLeft" :size="17"/></button></div></WindowBar>
        <button class="settings-back" :title="t('back')" @click="close"><ArrowLeft :size="17"/><span v-if="!collapsed">{{t('back')}}</span></button>
        <div v-if="!collapsed" class="settings-nav-caption">{{t('settings')}}</div>
        <nav :aria-label="t('preferences')"><button v-for="panel in panels" :key="panel.id" class="settings-tab" :class="{ active: selectedPanel === panel.id }" :title="t(panel.label)" :aria-label="t(panel.label)" :aria-current="selectedPanel === panel.id ? 'page' : undefined" @click="selectedPanel=panel.id"><component :is="panel.icon" :size="19"/><span v-if="!collapsed">{{ t(panel.label) }}</span></button></nav>
        <div class="settings-brand"><span v-if="!collapsed">BoxPlayer <span v-if="info?.version">v{{info.version}}</span></span></div>
      </aside>
      <main class="settings-pane">
        <WindowBar :controls="true" class="settings-pane-title"><component :is="activePanel.icon" :size="21"/><h1>{{t(activePanel.label)}}</h1></WindowBar>
        <div class="settings-scroll"><div class="settings-body">
          <p v-if="!settings.ready">{{ t('settingsLoading') }}</p>
          <fieldset :disabled="settings.preview || !settings.ready || settings.saving">
            <template v-if="selectedPanel==='general'">
              <section class="settings-section"><h2>{{t('appearance')}}</h2><div class="settings-card">
                <label class="setting-row"><span>{{t('language')}}</span><span class="settings-select"><select :value="settings.value.language" data-testid="language" @change="save({ language: ($event.target as HTMLSelectElement).value as Language })"><option value="zh-CN">简体中文</option><option value="en">English</option></select><ChevronDown :size="14"/></span></label>
                <div class="setting-row"><span>{{t('theme')}}</span><div class="settings-segment" role="radiogroup" :aria-label="t('theme')"><button v-for="option in ([{value:'system',label:t('system'),icon:Monitor},{value:'light',label:t('light'),icon:Sun},{value:'dark',label:t('dark'),icon:Moon}] as const)" :key="option.value" type="button" role="radio" :aria-checked="settings.value.theme===option.value" :data-testid="'theme-'+option.value" @click="save({theme:option.value as Theme})"><component :is="option.icon" :size="15"/>{{option.label}}</button></div></div>
              </div></section>
              <section class="settings-section"><h2>{{en?'Accounts & library':'账号与媒体库'}}</h2><div class="settings-card">
                <label class="setting-row"><span>{{en?'Automatically check in to Aliyun web accounts':'自动签到阿里网页账号'}}</span><SwitchRoot class="settings-switch" :model-value="!!settings.value.autoSign" @update:model-value="save({autoSign:$event})"><SwitchThumb class="settings-switch-thumb"/></SwitchRoot></label>
                <label class="setting-row"><span>{{en?'Library incremental scan':'媒体库增量扫描'}}</span><span class="settings-select"><select :value="settings.value.libraryScanMinutes||0" @change="save({libraryScanMinutes:Number(($event.target as HTMLSelectElement).value)})"><option :value="0">{{en?'Off':'关闭'}}</option><option :value="15">15 {{en?'minutes':'分钟'}}</option><option :value="60">1 {{en?'hour':'小时'}}</option><option :value="1440">{{en?'Daily':'每天'}}</option></select><ChevronDown :size="14"/></span></label>
              </div></section>
            </template>
            <NetworkProxySettings v-if="selectedPanel==='network'" />
            <section v-if="selectedPanel==='launch'" class="settings-section"><h2>{{t('launch')}}</h2><div class="settings-card">
              <label class="setting-row"><span>{{t('launchAtLogin')}}</span><SwitchRoot class="settings-switch" :model-value="settings.value.launchAtLogin" @update:model-value="save({launchAtLogin:$event})"><SwitchThumb class="settings-switch-thumb"/></SwitchRoot></label>
              <label class="setting-row"><span>{{t('closeToTray')}}</span><SwitchRoot class="settings-switch" :model-value="settings.value.closeToTray" @update:model-value="save({closeToTray:$event})"><SwitchThumb class="settings-switch-thumb"/></SwitchRoot></label>
              <label class="setting-row"><span>{{t('startHidden')}}</span><SwitchRoot class="settings-switch" :model-value="settings.value.startHidden" @update:model-value="save({startHidden:$event})"><SwitchThumb class="settings-switch-thumb"/></SwitchRoot></label>
            </div></section>
          </fieldset>
          <section v-if="selectedPanel==='migration'" class="settings-section"><h2>{{t('dataMigration')}}</h2><div class="settings-card">
            <div class="settings-card-note">{{en?'Transfer videos, playlists, custom series, watch progress and favorites. Existing records are preserved. Failed imports are rolled back.':'支持视频、播放列表、自定义系列、观看进度与收藏布局。已有目标记录保留，失败时事务回滚。'}}</div>
            <div class="setting-row"><span>{{en?'Inspect a migration file':'检查迁移文件'}}</span><Button variant="ghost" :disabled="settings.preview" @click="inspect">{{en?'Choose file':'检查迁移文件'}}<ChevronRight :size="16"/></Button></div>
            <div class="setting-row"><span>{{t('exportData')}}</span><Button variant="outline" :disabled="settings.preview" @click="migrate('export')">{{t('exportData')}}</Button></div>
            <div class="setting-row"><span>{{t('importData')}}</span><Button variant="outline" :disabled="settings.preview" @click="migrate('import')">{{t('importData')}}</Button></div>
          </div><p v-if="migrationResult" class="settings-feedback" role="status">{{migrationResult}}</p></section>
          <section v-if="selectedPanel==='storage'" class="settings-section"><h2>{{en?'Application':'应用信息'}}</h2><div class="settings-card"><div class="setting-row"><span>{{t('version')}}</span><span class="setting-value">{{info?.version??'—'}}</span></div></div><h2 class="settings-subheading">{{t('storage')}}</h2><div class="settings-card"><div class="settings-card-note"><span>{{t('dataDirectory')}}</span><code class="data-path">{{info?.dataDirectory??'—'}}</code></div><div class="setting-row"><span>{{t('reveal')}}</span><Button variant="outline" :disabled="settings.preview" @click="reveal"><FolderOpen :size="16"/>{{t('reveal')}}</Button></div></div></section>
        </div></div>
      </main>
    </div>
  </AppFrame>
</template>
