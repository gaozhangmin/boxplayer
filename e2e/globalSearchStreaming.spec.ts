import { expect, test } from './fixtures/boxPlayer'

test('server hits appear while another server is pending; failed and cancelled sources preserve new hits', async ({ boxPlayer }) => {
  const { page } = boxPlayer
  const servers = ['slow', 'fast', 'failed'].map(id => ({
    id, name: id, type: 'jellyfin', baseUrl: `https://${id}.search.invalid`,
    accessToken: 'test-only', userId: 'user', deviceId: 'search-e2e', loginStatus: 'success'
  }))
  await page.evaluate(servers => localStorage.setItem('MediaServer_Registry', JSON.stringify(servers)), servers)
  await page.reload()
  const pending: Array<() => Promise<void>> = []
  await page.route('https://*.search.invalid/**', async route => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get('SearchTerm')
    if (!query) { await route.fulfill({ json: { Items: [] } }); return }
    if (url.hostname.startsWith('failed')) { await route.fulfill({ status: 503, body: 'Unavailable' }); return }
    const respond = async () => { await route.fulfill({ json: { Items: [{ Id: `${url.hostname}-${query}`, Name: `${url.hostname}-${query}`, Type: 'Movie' }] } }).catch(() => {}) }
    if (url.hostname.startsWith('slow') && query === 'first') pending.push(respond)
    else await respond()
  })
  await page.locator('#xbyhead2').getByTestId('top-nav-search').click()
  const input = page.locator('.gs-page input').first()
  await input.fill('first')
  const results = page.locator('.gs-page-results')
  await expect(results).toContainText('fast.search.invalid-first')
  await expect(page.locator('.gs-page-status').filter({ has: page.locator('.gs-spinner') })).toBeVisible()
  await expect.poll(() => pending.length).toBe(1)
  await input.fill('second')
  for (const respond of pending) await respond()
  await expect(results).toContainText('fast.search.invalid-second')
  await expect(results).not.toContainText('first')
  await expect(page.locator('.gs-page-status .gs-spinner')).toHaveCount(0)
  await expect(results).toContainText('slow.search.invalid-second')
})
