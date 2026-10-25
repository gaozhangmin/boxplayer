import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BoxPlayerProBadge from '../../components/BoxPlayerProBadge.vue'
import SidebarProBadge from '../../components/SidebarProBadge.vue'
import { t } from '../../i18n'
let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null })
})
afterEach(() => vi.unstubAllGlobals())
describe('one membership identity across platforms', () => {
  it('renders the same badge for every Pro entitlement and none for standard users', async () => {
    const expected = await renderToString(createSSRApp(BoxPlayerProBadge, { tier: 'all', compact: true }))
    for (const tier of ['android', 'apple', 'all'] as const) {
      const html = await renderToString(createSSRApp(BoxPlayerProBadge, { tier, compact: true }))
      expect(html).toBe(expected)
      expect(html).toContain('aria-label="BoxPlayer PRO"')
    }
    const standard = await renderToString(createSSRApp(BoxPlayerProBadge, { tier: 'standard' }))
    expect(standard).not.toContain('role="status"')
    expect(standard).not.toContain('PRO')
  })
  it('selects the right sidebar content on initial render for free and active Pro accounts', async () => {
    const free = await renderToString(createSSRApp(SidebarProBadge, { collapsed: false }))
    expect(free).not.toContain('role="status"')
    expect(free).toContain(t('membership.upgradeTo'))
    expect(free).toContain('BoxPlayer PRO')
    values.set('app_user_authed', '1'); values.set('app_user_pro', '1')
    const pro = await renderToString(createSSRApp(SidebarProBadge, { collapsed: false }))
    expect(pro).toContain('role="status"')
    expect(pro).not.toContain(t('membership.upgradeTo'))
    values.clear()
    const signedOut = await renderToString(createSSRApp(SidebarProBadge, { collapsed: false }))
    expect(signedOut).not.toContain('role="status"')
    expect(signedOut).toContain(t('membership.upgradeTo'))
  })
})
