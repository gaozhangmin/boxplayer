import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryAccount from '@/features/library/electron/TraktAccountModal.vue'
import SettingsAccount from '@/features/trakt/TraktAccount.vue'
import { traktAccount, traktStatus } from '@/features/trakt/client'
import { nativeCall } from '@/platform/native'

vi.mock('@/platform/native', async importOriginal => ({
  ...await importOriginal<typeof import('@/platform/native')>(),
  nativeCall: vi.fn(),
}))

const disconnected = { configured: true, connected: false, settings: { enabled: true, range: -1 } }
const connected = { ...disconnected, connected: true }
const profile = { username: 'viewer', name: 'Test Viewer', vip: true, episodes: 0, shows: 0, movies: 0 }
let expiresAt: number
const call = vi.mocked(nativeCall)

beforeEach(() => {
  vi.useFakeTimers()
  expiresAt = Date.now() + 60_000
  traktStatus.value = disconnected
  traktAccount.value = undefined
  call.mockImplementation(async command => {
    switch (command) {
      case 'trakt_status': return disconnected
      case 'trakt_connect_device_auth': return { userCode: 'ABCD1234', expiresAt, interval: 5 }
      case 'trakt_account': return profile
      case 'trakt_settings': return connected
      case 'trakt_playback_progress': return []
      case 'trakt_open': case 'trakt_cancel': return undefined
      default: throw new Error(`Unexpected command ${command}`)
    }
  })
})
afterEach(() => vi.useRealTimers())

function button(wrapper: VueWrapper, text: string) {
  const match = wrapper.findAll('button').find(item => item.text() === text)
  if (!match) throw new Error(`Missing button ${text}`)
  return match
}

describe.each([['library', LibraryAccount], ['settings', SettingsAccount]] as const)('%s Trakt login', (_, component) => {
  async function render() {
    const wrapper = mount(component, {
      props: { visible: true },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    return wrapper
  }

  it('shows a device code and opens Trakt activation, then waits at the server interval', async () => {
    let polls = 0
    const current = call.getMockImplementation()!
    call.mockImplementation(async (command, args) => {
      if (command === 'trakt_status' && polls === 2) return connected
      if (command !== 'trakt_poll') return current(command, args)
      return ++polls === 1 ? { state: 'pending', interval: 10 } : { state: 'connected', status: connected }
    })
    const wrapper = await render()
    await button(wrapper, '连接 Trakt').trigger('click')
    await flushPromises()
    expect(wrapper.get('.device-code').text()).toBe('ABCD1234')
    expect(call).toHaveBeenCalledWith('trakt_connect_device_auth')
    expect(call).toHaveBeenCalledWith('trakt_open', { target: 'verification' })
    expect(call.mock.calls.map(([command]) => command)).not.toContain('trakt_web_start')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(polls).toBe(1)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(polls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.text()).toContain('Test Viewer')
    expect(wrapper.find('.device-code').exists()).toBe(false)
  })

  it('expires the displayed code before the next poll and lets the user retry', async () => {
    expiresAt = Date.now() + 3_000
    const wrapper = await render()
    await button(wrapper, '连接 Trakt').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(wrapper.get('[role="alert"]').text()).toContain('授权码已失效')
    expect(call).toHaveBeenCalledWith('trakt_cancel')
    expect(call.mock.calls.map(([command]) => command)).not.toContain('trakt_poll')
    expect(button(wrapper, '连接 Trakt').attributes('disabled')).toBeUndefined()
  })
})
