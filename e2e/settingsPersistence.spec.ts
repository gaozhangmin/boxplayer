import type { Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures/boxPlayer'

test.setTimeout(60_000)

async function openApplicationSettings(page: Page) {
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

test('account settings render and WebDAV settings stay hidden', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  await openApplicationSettings(page)
  const sidebar = page.locator('.settings-sider')

  await expect(sidebar.getByText('WebDAV', { exact: true })).toHaveCount(0)
  await sidebar.getByTestId('settings-account-menu').click()
  const accountSettings = page.locator('#SettingAccount')
  await expect(accountSettings).toBeVisible()
  await expect(accountSettings.getByTestId('account-import-export-heading')).toBeVisible()
  await expect(accountSettings.getByTestId('export-account-button')).toBeVisible()
  await expect(page.locator('#SettingWebDav')).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('application settings persist after the production renderer reloads', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer

  let settings = await openApplicationSettings(page)
  const persistentSetting = () => settings.getByTestId('check-updates-setting').locator('.myswitch')
  const initialChecked = await persistentSetting().locator('.arco-switch').getAttribute('aria-checked')
  await persistentSetting().click()
  await expect(persistentSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  settings = await openApplicationSettings(page)
  await expect(persistentSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await persistentSetting().click()
  await expect(persistentSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked || 'false')
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('AI scraping preference persists after the production renderer reloads', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  await openApplicationSettings(page)
  let setting = page.locator('#SettingAPI').getByTestId('ai-media-scrape-setting')
  await setting.scrollIntoViewIfNeeded()
  await expect(setting).toBeVisible()

  const toggle = setting.locator('.arco-switch')
  const initialChecked = await toggle.getAttribute('aria-checked')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await openApplicationSettings(page)
  setting = page.locator('#SettingAPI').getByTestId('ai-media-scrape-setting')
  const reloadedToggle = setting.locator('.arco-switch')
  await expect(reloadedToggle).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await reloadedToggle.click()
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('embedded MPV capability matches the macOS x64 bundle in the production app', async ({ boxPlayer }) => {
  const { page } = boxPlayer
  const capability = await page.evaluate(() => window.WebMpvEmbeddedCapability())

  if (process.platform === 'darwin' && process.arch === 'x64') {
    const bundlePath = path.resolve('static/engine/darwin/x64/mpv-texture/mpv-bundle-manifest.json')
    if (existsSync(bundlePath)) {
      expect(capability.enabled, capability.reason).toBe(true)
    } else {
      expect(capability.enabled).toBe(false)
      expect(capability.reason).toContain('macOS x64')
    }
  } else {
    expect(typeof capability.enabled).toBe('boolean')
  }
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
  const emailLogin = settings.locator('button.sa-provider.sa-em')
  await expect(emailLogin).toBeVisible()
  await emailLogin.click()
  await expect(settings.locator('input[type="email"]')).toBeVisible()
  await expect(settings.getByText('验证码', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
