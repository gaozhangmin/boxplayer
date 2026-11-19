import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ServerPlaylistPicker from '@/features/servers/ServerPlaylistPicker.vue'
import { listServerPlaylists } from '@/features/sources/playlists'
import { normalizeItem } from '@/features/servers/workspace'

vi.mock('@/features/sources/playlists', () => ({
 listServerPlaylists: vi.fn(() => new Promise(() => {})),
 createServerPlaylist: vi.fn(),
 deleteServerPlaylist: vi.fn(),
 serverPlaylistMembership: vi.fn(),
 setServerPlaylistMembership: vi.fn()
}))

it.each(['button', 'Escape'])('dismisses and cancels a pending playlist read via %s', async action => {
 const wrapper = mount(ServerPlaylistPicker, { props: {
  account: { id: 'emby', providerId: 'emby', name: 'Emby', baseUrl: 'https://emby.test', authOrigins: [] },
  item: normalizeItem({ Id: 'film', Name: 'Film', Type: 'Movie' }, false)
 } })
 await flushPromises()
 const close = wrapper.get('button[aria-label="关闭"]')
 expect(close.attributes('disabled')).toBeUndefined()
 const signal = vi.mocked(listServerPlaylists).mock.lastCall?.[1]
 expect(signal?.aborted).toBe(false)
 if (action === 'button') await close.trigger('click')
 else await close.trigger('keydown', { key: 'Escape' })
 expect(wrapper.emitted('close')).toHaveLength(1)
 wrapper.unmount()
 expect(signal?.aborted).toBe(true)
})
