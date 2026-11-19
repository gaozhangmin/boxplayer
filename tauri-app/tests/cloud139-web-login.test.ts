import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const script = readFileSync('src-tauri/src/cloud139_web.js', 'utf8')
const callback = 'https://yun.139.com/boxplayer-login/fixture'
const authorization = 'Basic cGM6Zml4dHVyZTp0b2tlbg=='

function install(response: { url: string; status: number }, origin = 'https://yun.139.com') {
  const location = { origin, replace: vi.fn() }
  const window = { top: {}, fetch: vi.fn(async (..._args: unknown[]) => response) }
  window.top = window
  runInNewContext(script.replace('__BOXPLAYER_CALLBACK__', JSON.stringify(callback)), {
    window, location, URL, Headers, Request,
    XMLHttpRequest: class { open() {} setRequestHeader() {} send() {} },
  })
  return { location, window }
}

describe('139 official login handoff', () => {
  it('forwards a successful cloud file-list credential once in a fragment', async () => {
    const { location, window } = install({ url: 'https://cloud-njs.yun.139.com/hcy/file/list', status: 200 })
    const request = new Request('https://cloud-njs.yun.139.com/hcy/file/list', { headers: { authorization } })
    await window.fetch(request)
    await window.fetch(request)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(callback + '#' + encodeURIComponent(authorization))
  })

  it.each([
    ['https://other.example/hcy/file/list', 200, 'https://yun.139.com'],
    ['https://yun.139.com/hcy/file/list', 401, 'https://yun.139.com'],
    ['https://yun.139.com/other', 200, 'https://yun.139.com'],
    ['https://yun.139.com/hcy/file/list', 200, 'https://other.example'],
  ])('ignores unrelated or unsuccessful requests', async (url, status, origin) => {
    const { location, window } = install({ url, status }, origin)
    await window.fetch(url, { headers: { authorization } })
    expect(location.replace).not.toHaveBeenCalled()
  })
})
