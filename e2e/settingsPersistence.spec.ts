import { expect, test } from './fixtures/boxPlayer'

test.setTimeout(60_000)

test('application settings persist after the production renderer reloads', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer

  const openApplicationSettings = async () => {
    const loginDialog = page.locator('.userloginmodal')
    await loginDialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
    if (await loginDialog.isVisible()) {
      await page.keyboard.press('Escape')
      await loginDialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(async () => {
        if (await loginDialog.isVisible()) await loginDialog.getByRole('button', { name: 'Close' }).click({ force: true })
      })
    }
    await page.getByTestId('open-settings').click()
    const settings = page.locator('#SettingUI')
    await expect(settings).toBeVisible()
    return settings
  }

  let settings = await openApplicationSettings()
  const persistentSetting = () => settings.getByTestId('check-updates-setting').locator('.myswitch')
  const initialChecked = await persistentSetting().locator('.arco-switch').getAttribute('aria-checked')
  await persistentSetting().click()
  await expect(persistentSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  settings = await openApplicationSettings()
  await expect(persistentSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await persistentSetting().click()
  await expect(persistentSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked || 'false')
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('logging out resets the email verification flow', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const dismissLoginDialog = async () => {
    const loginDialog = page.locator('.userloginmodal')
    await loginDialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
    if (!(await loginDialog.isVisible())) return
    await page.keyboard.press('Escape')
    await loginDialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(async () => {
      if (await loginDialog.isVisible()) await loginDialog.getByRole('button', { name: 'Close' }).click({ force: true })
    })
  }

  await page.evaluate(() => {
    localStorage.setItem('app_user_authed', '1')
    localStorage.setItem('app_user_email', 'e2e@example.com')
  })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await dismissLoginDialog()
  await page.getByTestId('open-settings').click()
  const settings = page.locator('#SettingUI')
  await expect(settings).toBeVisible()
  await settings.locator('.setting-icon-btn.danger').click()
  const emailLogin = page.locator('button[title="邮箱"]')
  await expect(emailLogin).toBeVisible()
  await emailLogin.click()
  await expect(settings.locator('input[type="email"]')).toBeVisible()
  await expect(settings.getByText('验证码', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
