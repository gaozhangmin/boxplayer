import { expect, test } from './fixtures/boxPlayer'

test('top navigation opens every core workspace', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const activePane = page.locator('#xbybody .arco-tabs-pane:visible')
  const nav = page.locator('#xbyhead2 .arco-menu-item')

  const workspaces = [
    { nav: '媒体服务器', content: '媒体服务器' },
    { nav: '搜索', content: '搜索所有网盘和媒体服务器...', placeholder: true },
    { nav: 'AI 工作台', content: '智能工作台' },
    { nav: '视频', content: '首页' },
    { nav: '音乐', content: '资料库为空' },
    { nav: '书籍', content: '全部图书' },
    { nav: '传输', content: '传输文件' },
    { nav: '分享', content: '云盘分享' },
    { nav: '插件', content: '好玩的插件' }
  ]

  for (const workspace of workspaces) {
    await test.step(workspace.nav, async () => {
      await nav.getByText(workspace.nav, { exact: true }).click()
      const marker = workspace.placeholder ? activePane.getByPlaceholder(workspace.content) : activePane.getByText(workspace.content, { exact: true }).first()
      await expect(marker).toBeVisible()
    })
  }

  await test.step('设置', async () => {
    await page.getByTitle('设置 Alt+7').click()
    await expect(activePane.locator('#SettingUI')).toBeVisible()
  })

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
