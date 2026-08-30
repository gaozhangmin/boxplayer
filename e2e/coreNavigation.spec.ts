import { expect, test } from './fixtures/boxPlayer'

test('top navigation opens every core workspace', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const workspaces = ['media-server', 'search', 'ai-workspace', 'media', 'music', 'book', 'down', 'share', 'rss']

  for (const workspace of workspaces) {
    await test.step(workspace, async () => {
      const navItem = page.getByTestId(`top-nav-${workspace}`)
      await navItem.click()
      await expect(navItem).toHaveClass(/arco-menu-selected/)
      await expect(page.locator('#xbybody')).toBeVisible()
    })
  }

  await test.step('设置', async () => {
    await page.getByTestId('open-settings').click()
    await expect(page.locator('#SettingUI')).toBeVisible()
  })

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
