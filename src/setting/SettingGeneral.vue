<script setup lang="ts">
import { generalPreferences, setGeneralPreference } from '../utils/seriesVersionPreferences'
import { isAnalyticsConfigured } from '../analytics/posthog'
import useSettingStore from './settingstore'
import { t } from '../i18n'
const setting = useSettingStore()
const modes = ['all', 'tv', 'movie', 'off']
const names = { all: 'generalEnabled', tv: 'generalTVOnly', movie: 'generalMoviesOnly', off: 'generalDisabled' } as const
const binaryScopes = [{ key: 'recentlyPlayed', title: 'generalRecentlyPlayed' }, { key: 'watchIndicators', title: 'generalWatchIndicators' }] as const
const scopes = [{ key: 'dailyPicks', title: 'generalDailyPicks' }, { key: 'logo', title: 'generalDisplayLogo' }, { key: 'ratings', title: 'generalExternalRatings' }] as const
const switches = [{ key: 'autoSubtitles', title: 'generalAutoSubtitles' }, { key: 'showFileNames', title: 'generalShowFileNames' }, { key: 'fileManagement', title: 'generalFileManagement' }, { key: 'posterTitles', title: 'generalPosterTitles' }, { key: 'hideSpoilers', title: 'hideSpoilers' }, { key: 'autoNext', title: 'generalAutoNext' }, { key: 'errorReports', title: 'generalErrorReports' }] as const
</script>
<template>
  <div class="settingcard general-settings">
    <div v-for="item in switches.filter(item => item.key !== 'errorReports' || isAnalyticsConfigured())" :key="item.key" class="settingrow">
      <a-checkbox :model-value="generalPreferences[item.key]" @change="(value: unknown) => setGeneralPreference(item.key, Boolean(value))">
        {{ item.key === 'hideSpoilers' ? t('general.generalHideSpoilers') : t(('general.' + item.title) as Parameters<typeof t>[0]) }}
      </a-checkbox>
    </div>

    <div class="settinghead">{{ t('general.generalTheme') }}</div>
    <div class="settingrow">
      <a-select :style="{ width: '280px', maxWidth: '100%' }" :model-value="setting.uiTheme" @change="(value: unknown) => setting.updateStore({ uiTheme: String(value) })">
        <a-option value="system">{{ t('general.generalAutomatic') }}</a-option>
        <a-option value="light">{{ t('general.generalLight') }}</a-option>
        <a-option value="dark">{{ t('general.generalDark') }}</a-option>
      </a-select>
    </div>

    <div class="settinghead">{{ t('general.generalSort') }}</div>
    <div class="settingrow">
      <a-select :style="{ width: '280px', maxWidth: '100%' }" :model-value="generalPreferences.sort" @change="(value: unknown) => setGeneralPreference('sort', String(value))">
        <a-option value="title">{{ t('general.generalTitle') }}</a-option>
        <a-option value="fileName">{{ t('general.generalShowFileNames') }}</a-option>
        <a-option value="addedAt">{{ t('general.generalDateAdded') }}</a-option>
      </a-select>
    </div>

    <template v-for="item in binaryScopes" :key="item.key">
      <div class="settinghead">{{ t(('general.' + item.title) as Parameters<typeof t>[0]) }}</div>
      <div class="settingrow">
        <a-select :style="{ width: '280px', maxWidth: '100%' }" :model-value="generalPreferences[item.key]" @change="(value: unknown) => setGeneralPreference(item.key, Boolean(value))">
          <a-option :value="true">{{ t('general.generalEnabled') }}</a-option>
          <a-option :value="false">{{ t('general.generalDisabled') }}</a-option>
        </a-select>
      </div>
    </template>

    <template v-for="item in scopes" :key="item.key">
      <div class="settinghead">{{ t(('general.' + item.title) as Parameters<typeof t>[0]) }}</div>
      <div class="settingrow">
        <a-select :style="{ width: '280px', maxWidth: '100%' }" :model-value="generalPreferences[item.key]" @change="(value: unknown) => setGeneralPreference(item.key, String(value))">
          <a-option v-for="mode in modes" :key="mode" :value="mode">
            {{ t(('general.' + (item.key === 'dailyPicks' && mode === 'all' ? 'generalMoviesAndTV' : names[mode as keyof typeof names])) as Parameters<typeof t>[0]) }}
          </a-option>
        </a-select>
      </div>
    </template>
  </div>
</template>
