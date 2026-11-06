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
    startupEnabled.value = (await window.WebStartupLock('status')).enabled === true
    startupReady.value = true
  } catch {
    startupFeedback.value = 'startupLock.failed'
  }
})

async function updateStartupLock(action: 'save' | 'disable') {
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
    <div v-if="startupReady || startupFeedback">
      <div class="settinghead">{{ t('startupLock.title') }}</div>
      <p>{{ t('startupLock.description') }}</p>
      <form v-if="startupReady" class="startup-lock-form" @submit.prevent="updateStartupLock('save')">
        <input v-if="startupEnabled" v-model="startupCurrent" type="password" autocomplete="current-password"
               maxlength="4" inputmode="numeric" pattern="[0-9]{4}" :placeholder="t('startupLock.current')" :aria-label="t('startupLock.current')" />
        <input v-model="startupNew" type="password" autocomplete="new-password" maxlength="4" inputmode="numeric" pattern="[0-9]{4}"
               :placeholder="t('startupLock.new')" :aria-label="t('startupLock.new')" />
        <input v-model="startupConfirmation" type="password" autocomplete="new-password" maxlength="4" inputmode="numeric" pattern="[0-9]{4}"
               :placeholder="t('startupLock.confirm')" :aria-label="t('startupLock.confirm')" />
        <button type="submit" :disabled="startupBusy || startupNew.length !== 4 || startupConfirmation.length !== 4 || (startupEnabled && startupCurrent.length !== 4)">
          {{ t('startupLock.save') }}
        </button>
        <button v-if="startupEnabled" type="button" :disabled="startupBusy || startupCurrent.length !== 4"
                @click="updateStartupLock('disable')">{{ t('startupLock.disable') }}</button>
      </form>
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
.startup-lock-form { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.startup-lock-form input { width: 160px; }
</style>
