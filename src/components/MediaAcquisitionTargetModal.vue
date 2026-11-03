<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CreateMediaAcquisitionRunInput, MediaAcquisitionRequest, MediaAcquisitionState } from '@shared/types/mediaAcquisition'
import type { ITokenInfo } from '../user/userstore'
import UserDAL from '../user/userdal'
import { GetDriveID, GetDriveType, isDrive115User, isQuarkUser } from '../aliapi/utils'
import { modalSelectPanDir } from '../utils/modal'
import message from '../utils/message'
import { createMediaAcquisitionRun } from '../services/mediaAcquisition/client'
import { formatMediaAcquisitionCapability, getMediaAcquisitionCapability, isMediaryAcquisitionPlatform, normalizeMediaAcquisitionRootFolder } from '../services/mediaAcquisition/capabilities'
import { getDriveProviderIcon, getDriveProviderLabel } from '../utils/driveProvider'
import useSettingStore from '../setting/settingstore'
import { isPro, requireMediaAcquisitionPro } from '../utils/usageLimit'
import { t } from '../i18n'

const props = withDefaults(defineProps<{ visible: boolean; request: MediaAcquisitionRequest; states?: MediaAcquisitionState[] }>(), { states: () => [] })
const emit = defineEmits<{ 'update:visible': [value: boolean]; created: [] }>()

type EligibleAccount = { key: string; token: ITokenInfo; driveId: string; capabilityLabel: string; displayName: string; providerLabel: string; providerIcon: string }
const accounts = ref<EligibleAccount[]>([])
const selectedAccountKey = ref('')
const targetFolderId = ref('')
const targetFolderName = ref(t('media.root'))
const creating = ref(false)
const selectingFolder = ref(false)
const rememberTarget = ref(false)
const trackingScope = ref<'current' | 'all'>('current')
const skipNextFolderReset = ref(false)
const proAllowed = ref(false)
const settingStore = useSettingStore()

const selectedAccount = computed(() => accounts.value.find(account => account.key === selectedAccountKey.value))
const selectedCapability = computed(() => selectedAccount.value ? getMediaAcquisitionCapability(selectedAccount.value.token.tokenfrom) : null)
const isSeries = computed(() => ['tv', 'anime'].includes(props.request.mediaType))
const mediaKey = computed(() => props.request.tmdbId ? `${props.request.mediaType}:tmdb:${props.request.tmdbId}` : `${props.request.mediaType}:title:${props.request.title.trim().toLowerCase().replace(/\s+/g, ' ')}:${props.request.year || ''}`)

function accountState(account: EligibleAccount) {
  const matchesAccount = (state: MediaAcquisitionState) => state.targetUserId === account.token.user_id && state.targetDriveId === account.driveId && state.targetParentFileId === targetFolderId.value
  const exact = props.states.find(state => state.mediaKey === mediaKey.value && matchesAccount(state))
  if (exact) return exact
  const title = props.request.title.replace(/[\s\u3000]+/g, '').toLowerCase()
  return props.states.find(state => state.mediaType === props.request.mediaType && state.title.replace(/[\s\u3000]+/g, '').toLowerCase() === title && matchesAccount(state))
}
function isRetryableState(state?: MediaAcquisitionState) { return !state || ['failed', 'cancelled', 'no_coverage', 'partial'].includes(state.status) }
function isAccountBlocked(account: EligibleAccount) {
  const status = accountState(account)?.status
  return !!status && ['reserved', 'queued', 'searching', 'selecting', 'transferring', 'verifying', 'organizing', 'retry_wait'].includes(status)
}
function accountStatus(account: EligibleAccount) {
  const state = accountState(account)
  if (!state) return ''
  if (state.status === 'completed') return t('media.acquired')
  if (state.status === 'reserved') return t('media.reserved')
  return isRetryableState(state) ? t('media.retryable') : t('media.acquiring')
}

function isCompletedDuplicateError(error: unknown) {
  return /该媒体已加入媒体库|不能重复获取/.test(String((error as { message?: string })?.message || error || ''))
}

function close() { emit('update:visible', false) }

function resetFolder() {
  const account = selectedAccount.value
  if (!account) return
  const type = GetDriveType(account.token.user_id, account.driveId)
  targetFolderId.value = normalizeMediaAcquisitionRootFolder(account.token.tokenfrom, type.key || account.driveId)
  targetFolderName.value = t('media.root')
}

async function loadAccounts() {
  const tokens = await UserDAL.GetUserListFromDB()
  accounts.value = tokens.flatMap(token => {
    const capability = isMediaryAcquisitionPlatform(token.tokenfrom) ? getMediaAcquisitionCapability(token.tokenfrom) : null
    // 阿里云盘的 default_drive_id 通常是备份盘；Agent 入库固定使用资源盘。
    const driveId = GetDriveID(token.user_id, '') || token.resource_drive_id || token.default_drive_id
    return capability && driveId ? [{
      key: `${token.tokenfrom}:${token.user_id}:${driveId}`,
      token,
      driveId,
      capabilityLabel: formatMediaAcquisitionCapability(capability),
      displayName: token.nick_name || token.user_name || token.name || token.user_id,
      providerLabel: getDriveProviderLabel(token.tokenfrom),
      providerIcon: getDriveProviderIcon(token.tokenfrom)
    }] : []
  })
  rememberTarget.value = settingStore.mediaAcquisitionRememberTarget
  const rememberedAccount = settingStore.mediaAcquisitionRememberTarget
    ? accounts.value.find(account => account.token.user_id === settingStore.mediaAcquisitionTargetUserId && account.driveId === settingStore.mediaAcquisitionTargetDriveId)
    : undefined
  if (rememberedAccount && !isAccountBlocked(rememberedAccount) && settingStore.mediaAcquisitionTargetFolderId) {
    skipNextFolderReset.value = true
    selectedAccountKey.value = rememberedAccount.key
    targetFolderId.value = settingStore.mediaAcquisitionTargetFolderId
    targetFolderName.value = settingStore.mediaAcquisitionTargetFolderName || t('media.selectedFolder')
    return
  }
  selectedAccountKey.value = accounts.value.find(account => !isAccountBlocked(account))?.key || ''
  resetFolder()
}

async function chooseFolder() {
  const account = selectedAccount.value
  if (!account) return
  selectingFolder.value = true
  try {
    // 115 OpenAPI 的文件浏览直接使用当前 access_token；强制刷新会把仍可用的会话误判为失效。
    const cachedToken = UserDAL.GetUserToken(account.token.user_id)
    let ready: ITokenInfo | null
    if (isDrive115User(account.token) || isQuarkUser(account.token)) {
      ready = cachedToken?.access_token ? cachedToken : account.token
    } else {
      ready = await UserDAL.EnsureUserTokenReady(account.token.user_id, true)
    }
    if (!ready?.access_token) throw new Error('登录状态已失效，请重新登录该网盘')
    Object.assign(account.token, ready)
    account.driveId = GetDriveID(ready.user_id, '') || ready.resource_drive_id || ready.default_drive_id || account.driveId
    modalSelectPanDir('selectdir', targetFolderId.value, (_userId, _driveId, folder) => {
      targetFolderId.value = String(folder?.file_id || targetFolderId.value)
      targetFolderName.value = String(folder?.path || folder?.name || t('media.selectedFolder'))
    }, undefined, undefined, { user_id: ready.user_id, drive_id: account.driveId })
  } catch (error: any) {
    message.error(error?.message || t('media.refreshLoginFailed'))
  } finally {
    selectingFolder.value = false
  }
}

async function create() {
  const account = selectedAccount.value
  if (!account || !targetFolderId.value) {
    message.warning(t('media.selectTargetWarning'))
    return
  }
  creating.value = true
  try {
    requireMediaAcquisitionPro()
    await settingStore.updateStore(rememberTarget.value
      ? {
          mediaAcquisitionRememberTarget: true,
          mediaAcquisitionTargetUserId: account.token.user_id,
          mediaAcquisitionTargetDriveId: account.driveId,
          mediaAcquisitionTargetFolderId: targetFolderId.value,
          mediaAcquisitionTargetFolderName: targetFolderName.value
        }
      : {
          mediaAcquisitionRememberTarget: false,
          mediaAcquisitionTargetUserId: '',
          mediaAcquisitionTargetDriveId: '',
          mediaAcquisitionTargetFolderId: '',
          mediaAcquisitionTargetFolderName: ''
        })
    const target = {
      mediaLibraryItemId: props.request.mediaLibraryItemId, tmdbId: props.request.tmdbId,
      mediaType: props.request.mediaType, title: props.request.title, alternativeTitles: props.request.alternativeTitles, year: props.request.year, releaseDate: props.request.releaseDate,
      targetUserId: account.token.user_id, targetDriveId: account.driveId, targetPlatform: account.token.tokenfrom, targetParentFileId: targetFolderId.value,
      preferredQuality: settingStore.mediaAcquisitionPreferredQuality,
      fetchSubtitles: settingStore.mediaAcquisitionFetchSubtitles,
      preferredLanguage: settingStore.mediaAcquisitionFetchSubtitles ? settingStore.mediaAcquisitionSubtitleLanguage : undefined,
      trackingEnabled: isSeries.value
    }
    // mediary acquires the aired episodes of each requested season, then keeps tracking it.
    const validSeason = (season: unknown): season is number => Number.isInteger(season) && Number(season) > 0
    let seasonNumbers: number[]
    if (props.request.trackingOnly) {
      const allSeasons = [...new Set(props.request.trackingSeasonNumbers || [props.request.seasonNumber])].filter(validSeason)
      seasonNumbers = trackingScope.value === 'all' ? allSeasons : [props.request.seasonNumber || allSeasons[0]].filter(validSeason)
      if (!props.request.tmdbId || !seasonNumbers.length) throw new Error('缺少追更季信息')
    } else {
      const missingSeasons = [...new Set(props.request.missingSeasonNumbers || [])].filter(validSeason)
      seasonNumbers = isSeries.value ? (missingSeasons.length ? missingSeasons : [props.request.seasonNumber].filter(validSeason)) : []
    }
    const seasonTargets = seasonNumbers.map(seasonNumber => ({ seasonNumber, missingEpisodes: props.request.missingEpisodes?.find(gap => gap.seasonNumber === seasonNumber)?.missingEpisodes || [] }))
    const runInput: CreateMediaAcquisitionRunInput = { ...target, kind: isSeries.value ? 'season' : 'movie', seasonNumber: seasonTargets[0]?.seasonNumber, missingEpisodes: seasonTargets[0]?.missingEpisodes, seasonTargets }
    let run
    try {
      run = await createMediaAcquisitionRun(runInput)
    } catch (error) {
      if (!isCompletedDuplicateError(error)) throw error
      if (!window.confirm(`《${props.request.title}》已获取完成，确定再次创建获取任务吗？`)) return
      run = await createMediaAcquisitionRun({ ...runInput, force: true })
    }
    message.success(run.status === 'reserved' ? t('media.reserved') : props.request.trackingOnly ? (seasonNumbers.length > 1 ? `已追更 ${seasonNumbers.length} 季，Agent 将按已播缺集自动补全` : `已追更第 ${seasonNumbers[0]} 季`) : t('media.created'))
    emit('created')
    close()
  } catch (error: any) {
    message.error(error?.message || t('media.createFailed'))
  } finally {
    creating.value = false
  }
}

watch(() => props.visible, visible => { if (visible) { proAllowed.value = isPro(); trackingScope.value = 'current'; void loadAccounts() } }, { immediate: true })
watch(selectedAccountKey, () => {
  if (skipNextFolderReset.value) {
    skipNextFolderReset.value = false
    return
  }
  resetFolder()
})
</script>

<template>
  <a-modal :visible="visible" :footer="false" :width="560" unmount-on-close :title="request.trackingOnly ? t('media.trackTarget') : t('media.acquireTarget')" @cancel="close">
    <div class="acquisition-modal">
      <p class="acquisition-subtitle">{{ request.title }}<template v-if="request.missingSeasonNumbers?.length"> · 补全第 {{ request.missingSeasonNumbers.join('、') }} 季</template><template v-else-if="isSeries && request.seasonNumber"> · 第 {{ request.seasonNumber }} 季</template></p>
      <div v-if="!proAllowed" class="acquisition-pro-lock">{{ t('media.proOnly') }}</div>
      <template v-if="request.trackingOnly && (request.trackingSeasonNumbers?.length || 0) > 1">
        <label>{{ t('media.trackingScope') }}</label>
        <a-radio-group v-model="trackingScope" type="button">
          <a-radio value="current">{{ t('media.currentSeason') }} {{ request.seasonNumber }} {{ t('media.season') }}</a-radio>
          <a-radio value="all">{{ t('media.allSeasons') }} {{ request.trackingSeasonNumbers?.length }} {{ t('media.season') }}</a-radio>
        </a-radio-group>
      </template>
      <label>{{ t('media.targetDrive') }}</label>
      <a-select v-model="selectedAccountKey" :placeholder="t('media.selectTargetDrive')">
        <a-option v-for="account in accounts" :key="account.key" :value="account.key" :label="`${account.displayName} · ${account.providerLabel}`" :disabled="isAccountBlocked(account)">
          <span class="acquisition-account-option">
            <img v-if="account.providerIcon" :src="account.providerIcon" :alt="account.providerLabel" />
            <span v-else class="acquisition-account-icon-fallback">{{ account.providerLabel.slice(0, 1) }}</span>
            <strong class="acquisition-account-copy">{{ account.displayName }} · {{ account.providerLabel }}<small v-if="accountStatus(account)"> · {{ accountStatus(account) }}</small></strong>
          </span>
        </a-option>
      </a-select>
      <p v-if="selectedCapability" class="acquisition-note">{{ t('media.capabilityNotePrefix') }} {{ formatMediaAcquisitionCapability(selectedCapability) }} {{ t('media.capabilityNoteSuffix') }}</p>
      <label>{{ t('media.saveFolder') }}</label>
      <div class="acquisition-folder"><span>{{ targetFolderName }}</span><a-button type="outline" size="small" :loading="selectingFolder" :disabled="!selectedAccount" @click="chooseFolder">{{ t('media.selectFolder') }}</a-button></div>
      <a-checkbox v-model="rememberTarget">{{ t('media.rememberTarget') }}</a-checkbox>
      <div v-if="!accounts.length" class="acquisition-empty">{{ t('media.noSupportedAccount') }}</div>
      <div v-else-if="!selectedAccount" class="acquisition-empty">{{ t('media.accountBusy') }}</div>
      <div class="acquisition-actions"><a-button @click="close">{{ t('common.cancel') }}</a-button><a-button type="primary" :loading="creating" :disabled="!selectedAccount || !proAllowed" @click="create">{{ proAllowed ? request.trackingOnly ? t('media.startTracking') : t('media.createTask') : t('media.upgradePro') }}</a-button></div>
    </div>
  </a-modal>
</template>

<style scoped>
.acquisition-modal { display: grid; gap: 10px; }.acquisition-subtitle { margin: -4px 0 10px; color: var(--color-text-2); font-size: 15px; }.acquisition-modal label { color: var(--color-text-2); font-size: 13px; }.acquisition-note { margin: -2px 0 6px; color: var(--color-text-3); font-size: 12px; }.acquisition-folder { display: flex; align-items: center; justify-content: space-between; min-height: 34px; gap: 12px; padding: 0 8px 0 11px; border: 1px solid var(--color-border-2); border-radius: 4px; color: var(--color-text-2); }.acquisition-empty, .acquisition-pro-lock { padding: 10px; border-radius: 4px; color: rgb(var(--warning-6)); background: var(--color-fill-2); font-size: 13px; }.acquisition-pro-lock { color: rgb(var(--primary-6)); background: rgb(var(--primary-1)); }.acquisition-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }.acquisition-account-option { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 32px; }.acquisition-account-option img, .acquisition-account-icon-fallback { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; object-fit: contain; background: var(--color-fill-2); }.acquisition-account-copy { min-width: 0; overflow: hidden; color: var(--color-text-1); font-size: 14px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }:deep(.arco-select-option) { min-height: 44px; padding-top: 6px; padding-bottom: 6px; }
</style>
