import { expect, test } from './fixtures/boxPlayer'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import type { Page, Response } from '@playwright/test'

test.setTimeout(180_000)

function fileListItem(page: Page, name: string) {
  return page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ has: page.getByText(name, { exact: true }) }).first()
}

async function switchToGuangya(page: Page): Promise<void> {
  const trigger = page.locator('.user-avatar-trigger')
  await expect(trigger).toBeVisible({ timeout: 45_000 })
  if ((await trigger.getAttribute('title')) === '光鸭云盘') return

  await trigger.hover()
  const row = page.locator('.userlist .user-list-row').filter({ hasText: '光鸭云盘' }).first()
  await expect(row, '真实账号配置中必须包含光鸭云盘账号').toBeVisible({ timeout: 15_000 })
  const accountSwitch = row.locator('.arco-switch')
  if (!(await accountSwitch.getAttribute('class'))?.includes('arco-switch-checked')) await accountSwitch.click()
  await expect(trigger).toHaveAttribute('title', '光鸭云盘', { timeout: 45_000 })
  await page.keyboard.press('Escape')
}

async function openCloudRoot(page: Page): Promise<void> {
  const cloudNav = page.locator('#xbyhead2 .arco-menu-item').getByText('网盘', { exact: true })
  if (await cloudNav.isVisible()) await cloudNav.click()
  const root = page.locator('.dirtree:visible .dirtitle').getByText('根目录', { exact: true })
  if (await root.isVisible()) await root.click()
  await expect(page.locator('.toppannavitem:visible').last()).toHaveAttribute('title', '根目录', { timeout: 45_000 })
}

function waitForUploadTokenResponse(pages: Page[], fileName: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`未捕获 ${fileName} 的光鸭上传凭证请求`)), 60_000)
    for (const target of pages) {
      target.on('response', response => {
        if (!response.url().includes('/nd.bizuserres.s/v1/get_res_center_token')) return
        const body = response.request().postData() || ''
        if (!body.includes(fileName)) return
        clearTimeout(timer)
        resolve(response)
      })
    }
  })
}

test('uploads a small file through the real Guangya API', async ({ boxPlayer }) => {
  const { app, page } = boxPlayer
  const temp = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-guangya-upload-'))
  const name = `BoxPlayer-Guangya-${Date.now()}.txt`
  const local = path.join(temp, name)
  writeFileSync(local, `BoxPlayer Guangya upload regression ${Date.now()}`)

  try {
    await switchToGuangya(page)
    await openCloudRoot(page)
    const tokenResponsePromise = waitForUploadTokenResponse(app.windows(), name)

    await page.evaluate(uploadPath => {
      window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath])
    }, local)
    await page.keyboard.press('Control+u')

    const tokenResponse = await tokenResponsePromise
    expect(tokenResponse.status()).toBe(200)
    const tokenPayload = await tokenResponse.json()
    expect(tokenPayload?.data?.taskId || tokenPayload?.taskId).toBeTruthy()

    await expect.poll(async () => {
      await page.locator('#xbybody').getByTitle('刷新 F5').click()
      await page.waitForTimeout(1_000)
      return fileListItem(page, name).count()
    }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000] }).toBeGreaterThan(0)
  } finally {
    const uploaded = fileListItem(page, name)
    if (await uploaded.count()) {
      const cancel = page.getByRole('button', { name: '取消已选', exact: true })
      if (await cancel.isVisible()) await cancel.click()
      await uploaded.locator('button.select').click()
      await page.locator('#xbybody').getByRole('button', { name: '删除', exact: true }).hover()
      await page.getByText('放回收站', { exact: true }).click()
      await expect(uploaded).toHaveCount(0, { timeout: 45_000 })
    }
    rmSync(temp, { recursive: true, force: true })
  }
})
