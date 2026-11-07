<script setup lang="ts">
import MySwitch from '../layout/MySwitch.vue'
import useSettingStore from './settingstore'
import { modalPassword } from '../utils/modal'
import { computed, onMounted, ref } from 'vue'
import PanDAL from '../pan/pandal'
import { t } from '../i18n'

const settingStore = useSettingStore()
const cb = async (val: any) => {
  await settingStore.updateStore(val)
}

const handlerPassword = (optType: string, event: any) => {
  modalPassword(optType, (success) => {
    if (optType == 'confirm' && success) {
      cb(event)
      // 刷新目录
      if (settingStore.securityHideBackupDrive) {
        PanDAL.aReLoadOneDirToShow('', 'resource_root', true)
      } else if (settingStore.securityHideResourceDrive) {
        PanDAL.aReLoadOneDirToShow('', 'backup_root', true)
      }
    }
  })
}
const disabled = computed(() => {
  return !settingStore.securityPassword
})

const systemUnlockAvailable = ref(false)
const systemUnlockEnabled = ref(false)
const startupEnabled = ref(false)
const startupReady = ref(false)
const startupBusy = ref(false)
const startupFeedback = ref<'' | 'startupLock.failed' | 'startupLock.saved' | 'startupLock.mismatch'>('')
const startupCurrent = ref('')
const startupNew = ref('')
const startupConfirmation = ref('')

onMounted(async () => {
  if (!window.WebStartupLock) return
  try {
    const status = await window.WebStartupLock('status')
    startupEnabled.value = status.enabled === true
    systemUnlockAvailable.value = status.systemUnlockAvailable === true
    systemUnlockEnabled.value = status.systemUnlockEnabled === true
    startupReady.value = true
  } catch {
    startupFeedback.value = 'startupLock.failed'
  }
})

const verificationAction = ref<'disable' | 'system-setting' | ''>('')
const verificationPassword = ref('')
const verificationFailed = ref(false)
const verificationVisible = computed(() => verificationAction.value !== '')
function requestVerification(action: 'disable' | 'system-setting') {
  if (startupBusy.value) return
  verificationPassword.value = ''
  verificationFailed.value = false
  startupFeedback.value = ''
  verificationAction.value = action
}
function closeVerification() {
  if (startupBusy.value) return
  verificationAction.value = ''
  verificationPassword.value = ''
  verificationFailed.value = false
}
async function verifyStartupAction() {
  if (startupBusy.value || !verificationAction.value || !/^[0-9]{4}$/.test(verificationPassword.value)) return
  const action = verificationAction.value
  startupBusy.value = true
  verificationFailed.value = false
  try {
    const result = await window.WebStartupLock(action, verificationPassword.value, action === 'system-setting' ? !systemUnlockEnabled.value : undefined)
    if (!result.ok) { verificationFailed.value = true; return }
    if (action === 'disable') { startupEnabled.value = false; systemUnlockEnabled.value = false }
    else systemUnlockEnabled.value = !systemUnlockEnabled.value
    verificationAction.value = ''
    startupFeedback.value = 'startupLock.saved'
  } catch { verificationFailed.value = true }
  finally { startupBusy.value = false; verificationPassword.value = '' }
}

async function updateStartupLock(action: 'save') {
  if (startupBusy.value) return
  if (action === 'save' && startupNew.value !== startupConfirmation.value) {
    startupFeedback.value = 'startupLock.mismatch'
    return
  }
  startupBusy.value = true
  try {
    const result = await window.WebStartupLock(action, startupCurrent.value, startupNew.value)
    if (result.ok) {
      startupEnabled.value = action === 'save'
      startupFeedback.value = 'startupLock.saved'
    } else startupFeedback.value = 'startupLock.failed'
  } catch {
    startupFeedback.value = 'startupLock.failed'
  } finally {
    startupCurrent.value = startupNew.value = startupConfirmation.value = ''
    startupBusy.value = false
  }
}
</script>

<template>
  <div class='settingcard'>
    <a-modal :visible="verificationVisible" :title="t('startupLock.verifyTitle')" :footer="false" :width="380" :mask-closable="!startupBusy" :esc-to-close="!startupBusy" :closable="!startupBusy" :unmount-on-close="true" @cancel="closeVerification">
      <form class="startup-verification" role="dialog" aria-modal="true" :aria-label="t('startupLock.verifyTitle')" @submit.prevent="verifyStartupAction">
        <p>{{ t('startupLock.verifyHint') }}</p>
        <a-input-password v-model="verificationPassword" :disabled="startupBusy" :max-length="4" :input-attrs="{ autocomplete: 'current-password', inputmode: 'numeric', pattern: '[0-9]{4}' }" :aria-label="t('startupLock.current')" :placeholder="t('startupLock.current')" autofocus />
        <p v-if="verificationFailed" role="alert">{{ t('startupLock.failed') }}</p>
        <div class="startup-lock-actions"><a-button :disabled="startupBusy" @click="closeVerification">{{ t('common.cancel') }}</a-button><a-button html-type="submit" type="primary" :loading="startupBusy" :disabled="!/^[0-9]{4}$/.test(verificationPassword)">{{ t('common.confirm') }}</a-button></div>
      </form>
    </a-modal>
    <div v-if="startupReady || startupFeedback">
      <div class="settinghead">{{ t('startupLock.title') }}</div>
      <p>{{ t('startupLock.description') }}</p>
      <form v-if="startupReady" class="startup-lock-form" @submit.prevent="updateStartupLock('save')">
        <label v-if="startupEnabled" class="startup-lock-field"><span>{{ t('startupLock.current') }}</span><a-input-password v-model="startupCurrent" :disabled="startupBusy" :max-length="4" :input-attrs="{ autocomplete: 'current-password', inputmode: 'numeric', pattern: '[0-9]{4}' }" :placeholder="t('startupLock.current')" :aria-label="t('startupLock.current')" /></label>
        <label class="startup-lock-field"><span>{{ t('startupLock.new') }}</span><a-input-password v-model="startupNew" :disabled="startupBusy" :max-length="4" :input-attrs="{ autocomplete: 'new-password', inputmode: 'numeric', pattern: '[0-9]{4}' }" :placeholder="t('startupLock.new')" :aria-label="t('startupLock.new')" /></label>
        <label class="startup-lock-field"><span>{{ t('startupLock.confirm') }}</span><a-input-password v-model="startupConfirmation" :disabled="startupBusy" :max-length="4" :input-attrs="{ autocomplete: 'new-password', inputmode: 'numeric', pattern: '[0-9]{4}' }" :placeholder="t('startupLock.confirm')" :aria-label="t('startupLock.confirm')" /></label>
        <div class="startup-lock-actions"><a-button html-type="submit" type="primary" :loading="startupBusy" :disabled="!/^[0-9]{4}$/.test(startupNew) || startupNew !== startupConfirmation || (startupEnabled && !/^[0-9]{4}$/.test(startupCurrent))">{{ t('startupLock.save') }}</a-button><a-button v-if="startupEnabled" status="danger" :disabled="startupBusy" @click="requestVerification('disable')">{{ t('startupLock.disable') }}</a-button></div>
      </form>
      <div v-if="startupEnabled && systemUnlockAvailable" class="startup-lock-system">
        <div class="startup-lock-system-row"><span>{{ t('startupLock.systemUnlock') }}</span><MySwitch :value="systemUnlockEnabled" :disabled="startupBusy" @change="requestVerification('system-setting')" /></div>
        <p>{{ t('startupLock.systemHint') }}</p>
      </div>
      <p v-if="startupFeedback" role="status">{{ t(startupFeedback) }}</p>
      <div class="settingspace"></div>
    </div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.defaultAlgorithm') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div style="width: 320px">
            {{ t('settings.defaultValue') }}<span class="opred">AES-CTR</span>
            <hr />
            {{ t('settings.security.aesTip') }}<br />
            {{ t('settings.security.rc4Tip') }}<br />
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.performanceTip') }}<br /></span>
            {{ t('settings.security.performanceNoBottleneck') }}<br />
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.securityEncType'
                     @update:model-value='cb({ securityEncType: $event })'>
        <a-radio tabindex='-1' value='aesctr'>AES-CTR</a-radio>
        <a-radio tabindex='-1' value='rc4md5'>RC4-MD5</a-radio>
      </a-radio-group>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class="settinghead">
        {{ t('settings.security.defaultPassword') }}
        <span class="opblue" style="margin-left: 0; padding: 0 8px">{{ t('settings.security.passwordUsage') }}</span>
      </div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultValue') }}<span class="opred">{{ t('settings.security.empty') }}</span>
            <hr />
            {{ t('settings.security.passwordUsage') }}，<span class="opred">{{ t('settings.security.passwordStored') }}</span><br />
            <div class="hrspace"></div>
            {{ t('settings.security.passwordRule1') }}<span class="oporg">{{ t('settings.security.passwordRule1Note') }}</span><br />
            {{ t('settings.security.passwordRule2') }}<br />
            {{ t('settings.security.passwordRule3') }}<span class="oporg">{{ t('settings.security.passwordRule3Note') }}</span><br />
          </div>
        </template>
      </a-popover>
    </div>
    <div class="settingrow">
      <a-button v-if='!settingStore.securityPassword' type='outline' size='small' tabindex='-1'
                @click='handlerPassword("new", "")'>
        {{ t('settings.security.setPassword') }}
      </a-button>
      <a-button v-else type='outline' size='small' tabindex='-1'                @click='handlerPassword("modify", "")'>
        {{ t('settings.security.modifyPassword') }}
      </a-button>
      <a-popconfirm v-if='settingStore.securityPassword' :content="t('settings.security.confirmDeletePassword')" @ok="handlerPassword('del', '')">
        <a-button type="outline" size="small" tabindex="-1" status="danger" style="margin-right: 16px">
          {{ t('settings.security.deletePassword') }}
        </a-button>
      </a-popconfirm>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.encryptFileNameTitle') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOn') }}
            <hr />
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.note') }}</span>{{ t('settings.security.encryptFileNameTip') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityEncFileName'
                @update:value='cb({ securityEncFileName: $event })'
                :disabled="disabled">
        {{ t('settings.security.encryptFileNameSwitch') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.hideExtTitle') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOff') }}
            <hr />
            {{ t('settings.security.hideExtTip') }}
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.note') }}</span>{{ t('settings.security.hideExtNote') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityEncFileNameHideExt'
                @update:value='cb({ securityEncFileNameHideExt: $event })'
                :disabled="disabled">
        {{ t('settings.security.hideExtSwitch') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.confirmPasswordTitle') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOff') }}
            <hr />
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.note') }}</span>{{ t('settings.security.confirmPasswordTip') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityPasswordConfirm'
                @change="handlerPassword('confirm', { securityPasswordConfirm: $event })" :disabled="disabled">
        {{ t('settings.security.confirmPasswordSwitch') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.autoDecryptNameTitle') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOn') }}
            <hr />
            {{ t('settings.security.autoDecryptNameTip1') }}<br />
            {{ t('settings.security.autoDecryptNameTip2') }}
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.note') }}</span>{{ t('settings.security.autoDecryptNameNote') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityFileNameAutoDecrypt'
                @change="handlerPassword('confirm', { securityFileNameAutoDecrypt: $event })" :disabled="disabled">
        {{ t('settings.security.autoDecryptNameSwitch') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.autoDecryptFileTitle') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOn') }}
            <hr />
            {{ t('settings.security.autoDecryptFileTitle') }}
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.note') }}</span>{{ t('settings.security.autoDecryptFileNote') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityPreviewAutoDecrypt'
                @change="handlerPassword('confirm', { securityPreviewAutoDecrypt: $event })" :disabled="disabled">
        {{ t('settings.security.autoDecryptFileSwitch') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class="security-setting-header">
      <div class='settinghead'>{{ t('settings.security.privacyTitle') }}</div>
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOff') }}
            <hr />
            {{ t('settings.security.privacyTip') }}
            <div class="hrspace"></div>
            <span class="oporg">{{ t('settings.security.note') }}</span>{{ t('settings.security.privacyNote') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityHideBackupDrive'
                @change="handlerPassword('confirm', { securityHideBackupDrive: $event })" :disabled="disabled">
        {{ t('settings.security.hideBackupDrive') }}
      </MySwitch>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityHideResourceDrive'
                @change="handlerPassword('confirm', { securityHideResourceDrive: $event })" :disabled="disabled">
        {{ t('settings.security.hideResourceDrive') }}
      </MySwitch>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.securityHidePicDrive'
                @change="handlerPassword('confirm', { securityHidePicDrive: $event })" :disabled="disabled">
        {{ t('settings.security.hidePicDrive') }}
      </MySwitch>
    </div>
  </div>
</template>

<style scoped>
.security-setting-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.security-setting-header :deep(.settinghead) {
  margin-bottom: 0;
}
.startup-lock-system { max-width:740px;margin-top:20px; }
.startup-lock-system-row { display:flex;align-items:center;justify-content:space-between;gap:16px; }
.startup-lock-form { display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,220px));gap:16px;max-width:740px;margin-top:18px; }
.startup-lock-field { display:grid;gap:8px;min-width:0;color:var(--color-text-2);font-size:13px; }
.startup-lock-field :deep(.arco-input-wrapper) { width:100%;border-radius:8px;min-height:36px; }
.startup-lock-field :deep(input) { min-width:0;font-size:14px; }
.startup-lock-actions { grid-column:1/-1;display:flex;flex-wrap:wrap;gap:12px;margin-top:2px; }
.startup-lock-actions :deep(.arco-btn) { border-radius:8px;min-height:34px;padding:0 18px; }
</style>
