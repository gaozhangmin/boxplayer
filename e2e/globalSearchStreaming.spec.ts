import { createServer, type ServerResponse } from 'node:http'
import { expect, test } from './fixtures/boxPlayer'

test('server hits appear while another server is pending; failed and cancelled sources preserve new hits', async ({ boxPlayer }) => {
  const { page } = boxPlayer
  const pending: ServerResponse[] = []
  const requests: string[] = []
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Emby-Authorization, X-Emby-Token', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
  // Use real HTTP responses: a held intercepted Electron request can interfere
  // with the browser's other intercepted requests and obscure streaming behavior.
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    const source = url.pathname.split('/')[1]
    const query = url.searchParams.get('SearchTerm') || ''
    requests.push(`${request.method} ${source} ${query}`)
    if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return }
    if (source === 'slow' && query === 'first') { pending.push(response); return }
    if (source === 'failed') { response.writeHead(503, headers).end('Unavailable'); return }
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify({
      Items: query ? [{ Id: `${source}-${query}`, Name: `${source}-${query}`, Type: 'Movie' }] : []
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  try {
    const servers = ['slow', 'fast', 'failed'].map(id => ({
      id, name: id, type: 'jellyfin', baseUrl: `http://127.0.0.1:${address.port}/${id}`,
      accessToken: 'test-only', userId: 'user', deviceId: 'search-e2e', loginStatus: 'success'
    }))
    await page.evaluate(servers => localStorage.setItem('MediaServer_Registry', JSON.stringify(servers)), servers)
    await page.reload()
    const login = page.locator('.userloginmodal')
    await login.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
    if (await login.isVisible()) {
      await login.locator('.arco-modal-close-btn').click()
      await expect(login).toBeHidden()
    }
    await page.locator('#xbyhead2').getByTestId('top-nav-search').click()
    const input = page.locator('.gs-page input').first()
    await input.fill('first')
    const results = page.locator('.gs-page-results')
    await expect(results).toContainText('fast-first').catch(error => {
      throw new Error(`First streaming result missing; HTTP requests: ${JSON.stringify(requests)}`, { cause: error })
    })
    await expect(page.locator('.gs-page-status .gs-spinner')).toBeVisible()
    await expect.poll(() => pending.length).toBe(1)
    await input.fill('second')
    for (const response of pending) if (!response.destroyed) response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify({ Items: [{ Id: 'stale', Name: 'slow-first', Type: 'Movie' }] }))
    await expect(results).toContainText('fast-second')
    await expect(results).not.toContainText('first')
    await expect(page.locator('.gs-page-status .gs-spinner')).toHaveCount(0)
    await expect(results).toContainText('slow-second')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
