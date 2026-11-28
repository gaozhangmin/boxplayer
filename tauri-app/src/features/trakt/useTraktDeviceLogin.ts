import { onUnmounted, ref } from 'vue'
import {
  cancelTraktLogin, connectDeviceAuth, openTraktPage, pollDeviceAuth, traktStatus, type DeviceLogin,
} from './client'

export function useTraktDeviceLogin(onConnected: () => Promise<void>, onError: (cause: unknown) => void) {
  const device = ref<DeviceLogin>()
  const starting = ref(false)
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function reset() {
    generation++
    clearTimeout(timer)
    device.value = undefined
    starting.value = false
  }

  async function cancel() {
    const active = starting.value || !!device.value
    reset()
    if (active) await cancelTraktLogin().catch(() => undefined)
  }

  function schedule(attempt: number, interval: number, expiresAt: number) {
    const delay = Math.min(Math.max(1, interval) * 1000, Math.max(0, expiresAt - Date.now()))
    timer = setTimeout(() => void poll(attempt, expiresAt), delay)
  }

  async function poll(attempt: number, expiresAt: number) {
    if (attempt !== generation) return
    try {
      if (Date.now() >= expiresAt) throw { code: 'TRAKT_EXPIRED', message: 'Authorization code expired' }
      const result = await pollDeviceAuth()
      if (attempt !== generation) return
      if (result.state === 'pending') {
        schedule(attempt, result.interval, expiresAt)
        return
      }
      device.value = undefined
      starting.value = false
      traktStatus.value = result.status
      await onConnected()
    } catch (cause) {
      if (attempt !== generation) return
      void cancel()
      onError(cause)
    }
  }

  async function openVerification() {
    const attempt = generation
    try {
      await openTraktPage('verification')
    } catch (cause) {
      if (attempt === generation) onError(cause)
    }
  }

  async function start() {
    if (starting.value || device.value) return
    const attempt = ++generation
    starting.value = true
    try {
      const result = await connectDeviceAuth()
      if (attempt !== generation) return
      device.value = result
      schedule(attempt, result.interval, result.expiresAt)
      await openVerification()
    } catch (cause) {
      if (attempt === generation) onError(cause)
    } finally {
      if (attempt === generation) starting.value = false
    }
  }

  onUnmounted(() => { void cancel() })
  return { device, starting, start, cancel, openVerification }
}
