import { expect, test } from './fixtures/boxPlayer'

test('PikPak region restriction is shown in the login dialog', async ({ boxPlayer }) => {
  const { page } = boxPlayer
  await page.route(/https:\/\/user\.mypikpak\.com\/v1\/(?:shield\/captcha\/init|auth\/signin)/, async route => {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (new URL(route.request().url()).pathname === '/v1/shield/captcha/init') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ captcha_token: 'e2e-captcha' }) })
      return
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'invalid_grant',
        error_code: 4126,
        error_description: 'AccessProhibited',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'PROHIBITED:CN:112.10.230.184:test', domain: '', metadata: {} },
          { '@type': 'type.googleapis.com/google.rpc.LocalizedMessage', locale: 'zh', message: '对不起，PikPak 在当前地区 (中国大陆) 不可用。' }
        ]
      })
    })
  })

  await page.evaluate(() => localStorage.setItem('login_provider', 'pikpak'))
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  const loginDialog = page.locator('.userloginmodal')
  await expect(loginDialog).toBeVisible()
  await loginDialog.getByPlaceholder('PikPak 邮箱 / 手机号 / 用户名').fill('e2e@example.com')
  await loginDialog.getByPlaceholder('PikPak 密码').fill('secret')
  await loginDialog.getByRole('button', { name: '登录 PikPak' }).click()

  await expect(page.locator('.arco-message-content').filter({ hasText: '对不起，PikPak 在当前地区 (中国大陆) 不可用。' })).toBeVisible()
  await expect(loginDialog).toBeVisible()
})
