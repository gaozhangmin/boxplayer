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
  const maximizeSetting = () => settings.getByTestId('launch-maximized-setting').locator('.myswitch')
  const initialChecked = await maximizeSetting().locator('.arco-switch').getAttribute('aria-checked')
  await maximizeSetting().click()
  await expect(maximizeSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  settings = await openApplicationSettings()
  await expect(maximizeSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked === 'true' ? 'false' : 'true')

  await maximizeSetting().click()
  await expect(maximizeSetting().locator('.arco-switch')).toHaveAttribute('aria-checked', initialChecked || 'false')
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
