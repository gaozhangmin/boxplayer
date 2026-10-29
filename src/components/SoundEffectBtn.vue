<template>
  <span class="sound-effect-wrapper">
    <a-popover
      trigger="click"
      position="top"
      content-class="sound-effect-popover"
      :popup-visible="quickVisible"
      @popup-visible-change="(v: boolean) => quickVisible = v"
    >
      <a-button
        type="text"
        shape="circle"
        :class="['se-trigger', hasActiveEffect ? 'active' : '']"
        :title="t('sound.effect')"
      >
        <SlidersHorizontal :size="18" :stroke-width="1.8" />
        <span v-if="hasActiveEffect" class="se-trigger-dot"></span>
      </a-button>
      <template #content>
        <div class="se-quick">
          <div class="se-quick-head">
            <div>
              <div class="se-quick-kicker">{{ t('sound.current') }}</div>
              <div class="se-quick-title">{{ currentPresetLabel }}</div>
            </div>
            <span :class="['se-state-pill', hasActiveEffect ? 'on' : '']">{{ hasActiveEffect ? t('sound.enabled') : t('sound.off') }}</span>
          </div>

          <div class="se-quick-presets">
            <button
              v-for="p in freqsPreset"
              :key="p.name"
              :class="['se-preset', activePresetName === p.name ? 'active' : '']"
              @click="handleEqPreset(p)"
            >{{ presetLabel(p.name) }}</button>
          </div>

          <div class="se-quick-switch">
            <div>
              <span>{{ t('sound.panner') }}</span>
              <small>{{ settings.panner.enabled ? t('sound.pannerOn') : t('sound.pannerOff') }}</small>
            </div>
            <a-switch
              :model-value="settings.panner.enabled"
              size="small"
              @change="handlePannerEnabled"
            />
          </div>

          <div class="se-quick-actions">
            <button class="se-quick-btn" @click="handleResetAll">
              <RotateCcw :size="14" :stroke-width="1.8" />
              <span>{{ t('sound.reset') }}</span>
            </button>
            <button class="se-quick-btn primary" @click="openAdvanced">
              <SlidersHorizontal :size="14" :stroke-width="1.8" />
              <span>{{ t('sound.advanced') }}</span>
            </button>
          </div>
        </div>
      </template>
    </a-popover>
    <Teleport to="body">
      <a-modal
        v-model:visible="visible"
        :footer="false"
        :width="640"
        :modal-style="{ maxHeight: '84vh', overflow: 'hidden', padding: 0 }"
        modal-class="soundEffectModal"
      >
        <template #title>
          <div class="se-modal-title">
            <SlidersHorizontal :size="18" :stroke-width="1.8" />
            <span>{{ t('sound.console') }}</span>
            <em v-if="hasActiveEffect">{{ t('sound.enabled') }}</em>
          </div>
        </template>
        <a-tabs v-model:active-key="activeTab" size="small">
          <a-tab-pane key="eq" :title="t('sound.equalizer')">
            <div class="se-section">
              <div class="se-hero">
                <div>
                  <div class="se-kicker">10-Band Equalizer</div>
                  <div class="se-title">{{ t('sound.equalizer') }}</div>
                </div>
                <div class="se-hero-actions">
                  <span :class="['se-state-pill', eqActive ? 'on' : '']">{{ eqActive ? t('sound.tuned') : t('sound.flat') }}</span>
                  <button class="se-icon-action" :title="t('sound.resetEq')" @click="handleResetEq">
                    <RotateCcw :size="15" :stroke-width="1.8" />
                  </button>
                </div>
              </div>

              <div class="se-eq-board">
                <div class="se-db-scale">
                  <span>+15</span>
                  <span>0</span>
                  <span>-15</span>
                </div>
                <div v-for="freq in freqLabels" :key="freq.hz" class="se-eq-item">
                  <span class="se-eq-value">{{ formatDb(settings.eq[freq.key]) }}</span>
                  <input
                    type="range"
                    class="se-eq-slider"
                    :min="-15"
                    :max="15"
                    :value="settings.eq[freq.key]"
                    :style="eqSliderStyle(settings.eq[freq.key])"
                    :aria-label="`${freq.label} Hz`"
                    @input="handleEqChange(freq.hz, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="se-eq-label">{{ freq.label }}</span>
                </div>
              </div>

              <div class="se-eq-summary">
                <div v-for="bar in eqSummaryBars" :key="bar.key" class="se-summary-bar">
                  <span :style="{ height: bar.height, transform: bar.offset }"></span>
                </div>
              </div>

              <div class="se-presets">
                <button
                  v-for="p in freqsPreset"
                  :key="p.name"
                  :class="['se-preset', activePresetName === p.name ? 'active' : '']"
                  @click="handleEqPreset(p)"
                >{{ presetLabel(p.name) }}</button>
              </div>
            </div>
          </a-tab-pane>

          <a-tab-pane key="panner" :title="t('sound.spatial')">
            <div class="se-section">
              <div class="se-hero">
                <div>
                  <div class="se-kicker">Spatial Motion</div>
                  <div class="se-title">{{ t('sound.panner') }}</div>
                </div>
                <a-switch
                  :model-value="settings.panner.enabled"
                  size="small"
                  @change="handlePannerEnabled"
                />
              </div>
              <div class="se-card-grid" :class="{ disabled: !settings.panner.enabled }">
                <div class="se-control-card">
                  <div class="se-card-head">
                    <Waves :size="16" :stroke-width="1.8" />
                    <span>{{ t('sound.speed') }}</span>
                    <strong>{{ settings.panner.speed }}</strong>
                  </div>
                  <input
                    type="range"
                    class="se-horizontal-slider"
                    :min="1"
                    :max="50"
                    :value="settings.panner.speed"
                    :disabled="!settings.panner.enabled"
                    @input="handlePannerSpeed(Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="se-control-card">
                  <div class="se-card-head">
                    <Gauge :size="16" :stroke-width="1.8" />
                    <span>{{ t('sound.range') }}</span>
                    <strong>{{ settings.panner.soundR }}</strong>
                  </div>
                  <input
                    type="range"
                    class="se-horizontal-slider"
                    :min="1"
                    :max="30"
                    :value="settings.panner.soundR"
                    :disabled="!settings.panner.enabled"
                    @input="handlePannerSoundR(Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
              </div>
            </div>
          </a-tab-pane>

          <a-tab-pane key="pitch" :title="t('sound.pitch')">
            <div class="se-section">
              <div class="se-hero">
                <div>
                  <div class="se-kicker">Pitch Shifter</div>
                  <div class="se-title">{{ t('sound.pitchNoSpeed') }}</div>
                </div>
                <button class="se-icon-action" :title="t('sound.resetPitch')" @click="handleResetPitch">
                  <RotateCcw :size="15" :stroke-width="1.8" />
                </button>
              </div>
              <div class="se-control-card wide">
                <div class="se-card-head">
                  <Music2 :size="16" :stroke-width="1.8" />
                  <span>{{ t('sound.pitchRate') }}</span>
                  <strong>{{ settings.pitchShifter.playbackRate.toFixed(2) }}x</strong>
                </div>
                <div class="se-pitch-row">
                  <input
                    type="range"
                    class="se-horizontal-slider"
                    :min="50"
                    :max="150"
                    :value="Math.round(settings.pitchShifter.playbackRate * 100)"
                    @input="handlePitchChange(Number(($event.target as HTMLInputElement).value))"
                  />
                  <button class="se-preset active" @click="handleSetPitch(1.0)">1.0x</button>
                </div>
              </div>
            </div>
          </a-tab-pane>
        </a-tabs>
      </a-modal>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Gauge, Music2, RotateCcw, SlidersHorizontal, Waves } from 'lucide-vue-next'
import {
  effectSettings,
  setEqBand,
  setEqPreset,
  resetEq,
  setPannerEnabled,
  setPannerSoundR,
  setPannerSpeed,
  setPitchShifterPlaybackRate,
  freqs,
  freqsPreset,
  ensureInit,
} from '../module/audioplayer/index'
import { t } from '../i18n'

ensureInit()

const visible = ref(false)
const quickVisible = ref(false)
const activeTab = ref('eq')
const settings = effectSettings

const freqLabels = freqs.map(hz => ({
  hz,
  key: `hz${hz}` as const,
  label: hz < 1000 ? `${hz}` : `${hz / 1000}k`,
}))

const presetNameKeys: Record<string, Parameters<typeof t>[0]> = {
  pop: 'sound.pop',
  dance: 'sound.dance',
  rock: 'sound.rock',
  classical: 'sound.classical',
  vocal: 'sound.vocal',
  slow: 'sound.slow',
  electronic: 'sound.electronic',
  subwoofer: 'sound.subwoofer',
  soft: 'sound.soft',
}

const hasActiveEffect = computed(() => {
  const eqActive = Object.values(settings.eq).some(v => v !== 0)
  return eqActive || settings.panner.enabled || settings.pitchShifter.playbackRate !== 1.0
})
const eqActive = computed(() => Object.values(settings.eq).some(v => v !== 0))
const activePresetName = computed(() => {
  const current = JSON.stringify(settings.eq)
  const preset = freqsPreset.find(p => {
    const eq = Object.fromEntries(freqs.map(freq => [`hz${freq}`, (p as any)[`hz${freq}`] ?? 0]))
    return JSON.stringify(eq) === current
  })
  return preset?.name || ''
})
const currentPresetLabel = computed(() => {
  if (activePresetName.value) return presetLabel(activePresetName.value)
  return eqActive.value ? t('sound.customEq') : t('sound.flat')
})
const eqSummaryBars = computed(() => freqLabels.map(freq => {
  const value = settings.eq[freq.key]
  return {
    key: freq.key,
    height: `${Math.max(8, Math.abs(value) / 15 * 46)}px`,
    offset: value >= 0 ? 'translateY(-50%)' : 'translateY(50%)',
  }
}))

function formatDb(value: number) {
  return `${value > 0 ? '+' : ''}${value}`
}

function eqSliderStyle(value: number) {
  const pct = ((value + 15) / 30) * 100
  return {
    '--eq-pct': `${pct}%`,
    '--eq-color': value === 0 ? 'rgba(252, 60, 68, .78)' : value > 0 ? '#20c997' : '#ff6b6b',
  }
}

function presetLabel(name: string) {
  const key = presetNameKeys[name]
  return key ? t(key) : name
}

// EQ
function handleEqChange(hz: number, value: number) {
  setEqBand(hz as any, value)
}

function handleEqPreset(preset: typeof freqsPreset[number]) {
  setEqPreset(preset)
}

function handleResetEq() {
  resetEq()
}

function handleResetAll() {
  resetEq()
  setPannerEnabled(false)
  setPitchShifterPlaybackRate(1.0)
}

function openAdvanced() {
  quickVisible.value = false
  visible.value = true
}

// Panner
function handlePannerSpeed(val: number) {
  setPannerSpeed(val)
}

function handlePannerSoundR(val: number) {
  setPannerSoundR(val)
}

// use a watcher for panner enabled - we detect change from the switch
function handlePannerEnabled(val: boolean) {
  setPannerEnabled(val)
}

// Pitch Shifter
function handlePitchChange(value: number) {
  const rate = parseFloat((value / 100).toFixed(2))
  setPitchShifterPlaybackRate(rate)
}

function handleSetPitch(rate: number) {
  setPitchShifterPlaybackRate(rate)
}

function handleResetPitch() {
  setPitchShifterPlaybackRate(1.0)
}
</script>

<style scoped>
.sound-effect-wrapper {
  display: inline-flex;
  align-items: center;
}

.se-trigger {
  position: relative;
}

.se-trigger.active {
  color: #fc3c44;
  background: rgba(252, 60, 68, .12);
}

.se-trigger-dot {
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fc3c44;
  box-shadow: 0 0 0 2px rgba(18, 18, 24, .96);
}

:global(.sound-effect-popover) {
  padding: 0 !important;
  border: 1px solid rgba(255, 255, 255, .12) !important;
  border-radius: 12px !important;
  background: var(--app-overlay-bg) !important;
  box-shadow: 0 18px 48px rgba(0, 0, 0, .45), inset 0 0 0 1px rgba(255, 255, 255, .04) !important;
  backdrop-filter: none;
}

:global(.sound-effect-popover .arco-popover-popup-content),
:global(.sound-effect-popover .arco-popover-content) {
  padding: 0;
  background: transparent;
  box-shadow: none;
}

:global(.sound-effect-popover .arco-popover-arrow) {
  background: var(--app-overlay-bg);
  border-color: rgba(255, 255, 255, .12);
}

:global(.soundEffectModal) {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 14px;
  background: var(--app-overlay-bg);
  color: rgba(255, 255, 255, .86);
  box-shadow: 0 24px 70px rgba(0, 0, 0, .48), inset 0 0 0 1px rgba(255, 255, 255, .04);
  backdrop-filter: none;
}

:global(.soundEffectModal .arco-modal-header),
:global(.soundEffectModal .arco-modal-body) {
  background: transparent;
}

:global(.soundEffectModal .arco-modal-header) {
  border-bottom-color: rgba(255, 255, 255, .08);
}

:global(.soundEffectModal .arco-modal-title),
:global(.soundEffectModal .arco-modal-close-btn) {
  color: rgba(255, 255, 255, .9);
}

:global(.soundEffectModal .arco-modal-close-btn:hover) {
  background: rgba(255, 255, 255, .08);
}

:global(.soundEffectModal .arco-tabs-nav-tab) {
  background: rgba(255, 255, 255, .04);
}

:global(.soundEffectModal .arco-tabs-tab) {
  color: rgba(255, 255, 255, .56);
}

:global(.soundEffectModal .arco-tabs-tab-active) {
  color: #fff;
}

:global(.soundEffectModal .arco-tabs-nav-ink) {
  background: #fc3c44;
}

:global(.soundEffectModal .arco-switch-checked) {
  background-color: #fc3c44;
}

.se-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 650;
}

.se-modal-title em {
  margin-left: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-style: normal;
  color: #fff;
  background: rgba(252, 60, 68, .18);
}

.se-quick {
  width: 272px;
  padding: 12px;
  border-radius: 12px;
  color: rgba(255, 255, 255, .86);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .025)),
    rgba(18, 18, 24, .94);
}

.se-quick-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.se-quick-kicker {
  margin-bottom: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, .42);
}

.se-quick-title {
  max-width: 154px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
  color: rgba(255, 255, 255, .92);
}

.se-quick-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.se-quick-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  background: rgba(255, 255, 255, .06);
}

.se-quick-switch span {
  display: block;
  margin-bottom: 2px;
  font-size: 13px;
  font-weight: 650;
  color: rgba(255, 255, 255, .86);
}

.se-quick-switch small {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, .42);
}

.se-quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.se-quick-btn {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .72);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}

.se-quick-btn:hover {
  color: #fff;
  border-color: rgba(252, 60, 68, .46);
  background: rgba(252, 60, 68, .12);
}

.se-quick-btn.primary {
  color: #fff;
  background: rgba(252, 60, 68, .18);
  border-color: rgba(252, 60, 68, .5);
  font-weight: 650;
}

.se-quick .se-state-pill,
.se-quick .se-preset {
  border-color: rgba(255, 255, 255, .1);
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .68);
}

.se-quick .se-state-pill.on {
  color: #fff;
  border-color: rgba(252, 60, 68, .48);
  background: rgba(252, 60, 68, .18);
}

.se-quick .se-preset:hover,
.se-quick .se-preset.active {
  color: #fff;
  border-color: rgba(252, 60, 68, .48);
  background: rgba(252, 60, 68, .16);
}

.se-section {
  padding: 4px 2px 2px;
}

.se-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(252, 60, 68, .18), transparent 46%),
    rgba(255, 255, 255, .055);
}

.se-kicker {
  margin-bottom: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, .42);
  font-variant-numeric: tabular-nums;
}

.se-title {
  font-size: 18px;
  line-height: 1.2;
  font-weight: 700;
  color: rgba(255, 255, 255, .92);
}

.se-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.se-state-pill,
.se-preset,
.se-icon-action {
  border: 1px solid rgba(255, 255, 255, .1);
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .7);
  font-family: inherit;
}

.se-state-pill {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
}

.se-state-pill.on {
  color: #fff;
  border-color: rgba(252, 60, 68, .48);
  background: rgba(252, 60, 68, .18);
}

.se-icon-action {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  cursor: pointer;
}

.se-icon-action:hover,
.se-preset:hover {
  color: #fff;
  border-color: rgba(252, 60, 68, .46);
  background: rgba(252, 60, 68, .12);
}

.se-eq-board {
  position: relative;
  display: grid;
  grid-template-columns: 34px repeat(10, minmax(34px, 1fr));
  align-items: stretch;
  gap: 8px;
  min-height: 226px;
  padding: 12px 10px 10px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  background:
    linear-gradient(to bottom, transparent 49.5%, rgba(255, 255, 255, .14) 49.5%, rgba(255, 255, 255, .14) 50.5%, transparent 50.5%),
    rgba(255, 255, 255, .04);
}

.se-db-scale {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 24px 0 23px;
  color: rgba(255, 255, 255, .34);
  font-size: 10px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.se-eq-item {
  min-width: 0;
  display: grid;
  grid-template-rows: 24px 150px 22px;
  justify-items: center;
  gap: 7px;
}

.se-eq-label,
.se-eq-value {
  font-size: 11px;
  color: rgba(255, 255, 255, .42);
  font-variant-numeric: tabular-nums;
}

.se-eq-value {
  color: rgba(255, 255, 255, .72);
}

.se-eq-slider {
  width: 150px;
  height: 28px;
  align-self: center;
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  cursor: pointer;
  transform: rotate(-90deg);
  transform-origin: center;
  border-radius: 999px;
  background:
    linear-gradient(to right, rgba(255,255,255,.12), rgba(255,255,255,.12)),
    linear-gradient(to right, var(--eq-color), var(--eq-color));
  background-size: 100% 4px, var(--eq-pct) 4px;
  background-repeat: no-repeat;
  background-position: center;
}

.se-eq-slider::-webkit-slider-thumb,
.se-horizontal-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 3px solid rgba(18, 18, 24, .96);
  background: var(--eq-color, #fc3c44);
  cursor: pointer;
  box-shadow: 0 1px 5px rgba(0,0,0,.24);
}

.se-eq-summary {
  height: 58px;
  margin: 10px 0 2px 42px;
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, .045);
}

.se-summary-bar {
  position: relative;
  height: 46px;
}

.se-summary-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(128,128,128,.2);
}

.se-summary-bar span {
  position: absolute;
  left: 35%;
  top: 50%;
  width: 30%;
  min-height: 4px;
  border-radius: 999px;
  background: #fc3c44;
  opacity: .86;
}

.se-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
}

.se-preset {
  min-height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
}

.se-preset.active {
  color: #fff;
  border-color: rgba(252, 60, 68, .5);
  background: rgba(252, 60, 68, .16);
  font-weight: 650;
}

.se-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.se-card-grid.disabled {
  opacity: .42;
}

.se-control-card {
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  background: rgba(255, 255, 255, .045);
}

.se-control-card.wide {
  max-width: none;
}

.se-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: rgba(255, 255, 255, .66);
}

.se-card-head span {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.se-card-head strong {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, .9);
  font-variant-numeric: tabular-nums;
}

.se-horizontal-slider {
  width: 100%;
  height: 24px;
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  cursor: pointer;
  background: linear-gradient(to right, #fc3c44, rgba(252, 60, 68, .28));
  background-size: 100% 4px;
  background-repeat: no-repeat;
  background-position: center;
  border-radius: 999px;
}

.se-horizontal-slider:disabled {
  cursor: not-allowed;
}

.se-pitch-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}
</style>
