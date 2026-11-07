<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { t } from '../i18n'

const emit = defineEmits<{ unlocked: [] }>()
const password = ref('')
const busy = ref(false)
const failed = ref(false)
const systemUnlock = ref(false)
onMounted(async () => {
  try {
    const status = await window.WebStartupLock('status')
    systemUnlock.value = status.systemUnlockAvailable === true && status.systemUnlockEnabled === true
  } catch {}
})
async function unlockWithSystem() {
  if (busy.value) return
  busy.value = true; failed.value = false
  try {
    const result = await window.WebStartupLock('system-unlock')
    if (result.ok) emit('unlocked')
    else failed.value = true
  } catch { failed.value = true }
  finally { busy.value = false }
}

async function unlock() {
  if (busy.value || !/^[0-9]{4}$/.test(password.value)) return
  busy.value = true
  failed.value = false
  try {
    const result = await window.WebStartupLock('unlock', password.value)
    if (result.ok) emit('unlocked')
    else failed.value = true
  } catch {
    failed.value = true
  } finally {
    password.value = ''
    busy.value = false
  }
}
</script>

<template>
  <main class="startup-unlock">
    <form @submit.prevent="unlock">
      <h1>BoxPlayer</h1>
      <label for="startup-unlock-password">{{ t('startupLock.title') }}</label>
      <input id="startup-unlock-password" v-model="password" type="password" autocomplete="current-password" maxlength="4" inputmode="numeric" pattern="[0-9]{4}" autofocus />
      <button type="submit" :disabled="busy || password.length !== 4">{{ t('startupLock.unlock') }}</button>
      <button v-if="systemUnlock" type="button" :disabled="busy" @click="unlockWithSystem">{{ t('startupLock.systemUnlock') }}</button>
      <p v-if="failed" role="alert">{{ t('startupLock.failed') }}</p>
    </form>
  </main>
</template>

<style scoped>
.startup-unlock { min-height: 100vh; display: grid; place-items: center; -webkit-app-region: drag; }
form { width: min(20rem, 85vw); display: grid; gap: 12px; -webkit-app-region: no-drag; }
input, button { padding: 8px; }
</style>
