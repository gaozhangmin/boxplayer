<script setup lang="ts">
import { seriesPreferences, setSeriesPreference, type VersionMode } from '../utils/seriesVersionPreferences'
import { t } from '../i18n'
const modes: VersionMode[] = ['auto', 'largest', 'smallest']
const modeLabels = { auto: 'seriesVersionAuto', largest: 'seriesVersionLargest', smallest: 'seriesVersionSmallest' } as const
</script>
<template>
  <div class="settingcard series-settings">
    <div class="settingrow">
      <a-checkbox :model-value="seriesPreferences.showMovies" @change="(value: unknown) => setSeriesPreference('showMovies', Boolean(value))">{{ t('seriesVersions.seriesShowMovies') }}</a-checkbox>
    </div>
    <div class="settingrow">
      <a-checkbox :model-value="seriesPreferences.showTV" @change="(value: unknown) => setSeriesPreference('showTV', Boolean(value))">{{ t('seriesVersions.seriesShowTV') }}</a-checkbox>
    </div>
    <div class="settingrow">
      <a-checkbox :model-value="seriesPreferences.useTMDB" @change="(value: unknown) => setSeriesPreference('useTMDB', Boolean(value))">{{ t('seriesVersions.seriesUseTMDB') }}</a-checkbox>
    </div>
    <div class="settingrow">
      <a-checkbox :model-value="seriesPreferences.useCustom" @change="(value: unknown) => setSeriesPreference('useCustom', Boolean(value))">{{ t('seriesVersions.seriesUseCustom') }}</a-checkbox>
    </div>
    <div class="settingrow">
      <a-checkbox :model-value="seriesPreferences.openDetail" @change="(value: unknown) => setSeriesPreference('openDetail', Boolean(value))">{{ t('seriesVersions.seriesOpenDetail') }}</a-checkbox>
    </div>
    <div class="settingrow">
      <a-checkbox :model-value="seriesPreferences.mergeVersions" @change="(value: unknown) => setSeriesPreference('mergeVersions', Boolean(value))">{{ t('seriesVersions.seriesMergeVersions') }}</a-checkbox>
    </div>

    <div class="settinghead">{{ t('seriesVersions.seriesDefaultVersion') }}</div>
    <div class="settingrow">
      <a-select :style="{ width: '280px', maxWidth: '100%' }" :model-value="seriesPreferences.defaultVersion" :disabled="!seriesPreferences.mergeVersions" @change="(value: unknown) => setSeriesPreference('defaultVersion', value as VersionMode)">
        <a-option v-for="mode in modes" :key="mode" :value="mode">{{ t(('seriesVersions.' + modeLabels[mode]) as Parameters<typeof t>[0]) }}</a-option>
      </a-select>
    </div>
    <div class="settinghead">{{ t('seriesVersions.seriesPlaybackVersion') }}</div>
    <div class="settingrow">
      <a-select :style="{ width: '280px', maxWidth: '100%' }" :model-value="seriesPreferences.playbackVersion" @change="(value: unknown) => setSeriesPreference('playbackVersion', value as VersionMode)">
        <a-option v-for="mode in modes" :key="mode" :value="mode">{{ t(('seriesVersions.' + modeLabels[mode]) as Parameters<typeof t>[0]) }}</a-option>
      </a-select>
    </div>
  </div>
</template>
