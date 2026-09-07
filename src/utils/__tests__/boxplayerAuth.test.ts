import { describe, expect, it } from 'vitest'
import { buildProPurchaseUrl } from '../boxplayerAuth'

describe('BoxPlayer website purchase flow', () => {
  it('opens the website login flow and returns to the pricing page', () => {
    const url = new URL(buildProPurchaseUrl())
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/pricing/')
    expect(url.searchParams.get('redirect_uri')).toBe('boxplayer-auth://callback')
    expect(url.searchParams.get('source')).toBe('boxplayer-desktop')
  })

  it('passes the current session through a URL fragment without exposing it to the server', () => {
    const url = new URL(buildProPurchaseUrl({ accessToken: 'access-token', refreshToken: 'refresh-token' }))
    expect(url.searchParams.get('access_token')).toBeNull()
    expect(url.hash).toBe('#access_token=access-token&refresh_token=refresh-token')
  })
})
