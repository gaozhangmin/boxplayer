import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { expect, test } from './fixtures/boxPlayer'

test('production renderer opens the main workspace from file://', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  await expect.poll(() => page.url()).toMatch(/^file:\/\//)
  await expect.poll(() => page.evaluate(() => Array.from(document.styleSheets).some((sheet) => sheet.href?.endsWith('/style.css') && sheet.cssRules.length > 0))).toBeTruthy()
  const header = page.locator('#xbyhead2')
  await expect(header.getByTestId('top-nav-pan')).toBeVisible()
  await expect(header.getByTestId('top-nav-media-server')).toBeVisible()
  const localResources = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLLinkElement | HTMLScriptElement>('link[rel="stylesheet"][href], script[src]'))
      .map((element) => new URL(element.href || element.src, window.location.href).href)
      .filter((url) => url.startsWith('file://'))
  )
  expect(localResources.filter((url) => !existsSync(fileURLToPath(url)))).toEqual([])
  await page.waitForTimeout(3_000)
  await expect(page.locator('.arco-message-content').filter({ hasText: /Aria2|secret=/i })).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
