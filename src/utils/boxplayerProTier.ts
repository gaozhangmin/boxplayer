// Shared membership tier mapping for the BoxPlayer Pro badge.
// Mirrors boxplayer-site/functions/_shared/entitlementCatalog.json; the raw
// product id is only looked up, never rewritten.
export type BoxPlayerProTier = 'standard' | 'all' | 'android' | 'apple'

type CatalogScope = 'apple_all' | 'apple_mobile' | 'apple_tv' | 'apple_mac' | 'android' | 'all'

interface CatalogEntry { plan: 'lifetime' | 'yearly' | 'monthly' | 'account_pro'; scope: CatalogScope }

const CATALOG: Record<string, CatalogEntry> = {
  'com.boxplayer.earlybird.lifetimely': { plan: 'lifetime', scope: 'apple_all' },
  'com.boxplayer.lifetimely': { plan: 'lifetime', scope: 'apple_all' },
  'com.ios.boxplayer.lifetimely': { plan: 'lifetime', scope: 'apple_mobile' },
  'com.tvos.boxplayer.lifetimely': { plan: 'lifetime', scope: 'apple_tv' },
  'com.macos.boxplayer.lifetimely': { plan: 'lifetime', scope: 'apple_mac' },
  'com.boxplayer.sub.year': { plan: 'yearly', scope: 'apple_all' },
  'com.boxplayer.sub.month': { plan: 'monthly', scope: 'apple_all' },
  'boxplayer.pro.monthly': { plan: 'monthly', scope: 'apple_all' },
  'boxplayer.pro.yearly': { plan: 'yearly', scope: 'apple_all' },
  'boxplayer.pro.lifetime': { plan: 'lifetime', scope: 'apple_all' },
  'com.boxplayer.account.pro': { plan: 'account_pro', scope: 'all' },
  web_monthly: { plan: 'monthly', scope: 'all' },
  web_yearly: { plan: 'yearly', scope: 'all' },
  lifetime: { plan: 'lifetime', scope: 'all' },
  android_lifetime: { plan: 'lifetime', scope: 'android' },
  pro: { plan: 'account_pro', scope: 'all' },
}

export interface BoxPlayerProTierInput {
  signedIn: boolean
  pro: boolean
  plan?: string | null
  productId?: string | null
  source?: string | null
  /** Scope resolved by the backend from the same catalog. */
  entitlementScope?: string | null
}

export function resolveBoxPlayerProTier(input: BoxPlayerProTierInput): BoxPlayerProTier {
  if (!input.signedIn || !input.pro) return 'standard'
  const byProduct = lookup(input.productId)
  if (byProduct) return tierForScope(byProduct.scope)
  const scoped = tierForScopeName(input.entitlementScope)
  if (scoped) return scoped
  const byPlan = lookup(input.plan)
  if (byPlan) return tierForScope(byPlan.scope)
  // Unknown identifiers keep Pro but never claim a narrower tier.
  return 'all'
}

function lookup(value?: string | null): CatalogEntry | null {
  const key = (value || '').trim().toLowerCase()
  return key && Object.prototype.hasOwnProperty.call(CATALOG, key) ? CATALOG[key] : null
}

function tierForScope(scope: CatalogScope): BoxPlayerProTier {
  if (scope === 'android') return 'android'
  if (scope === 'all') return 'all'
  return 'apple'
}

function tierForScopeName(scope?: string | null): BoxPlayerProTier | null {
  switch ((scope || '').trim().toLowerCase()) {
    case 'android': return 'android'
    case 'all': return 'all'
    case 'apple':
    case 'apple_all':
    case 'apple_mobile':
    case 'apple_tv':
    case 'apple_mac':
      return 'apple'
    default:
      return null
  }
}

// Node-side smoke check: `node --experimental-strip-types src/utils/boxplayerProTier.ts`
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('boxplayerProTier.ts')) {
  const cases: Array<[BoxPlayerProTier, BoxPlayerProTierInput]> = [
    ['standard', { signedIn: false, pro: true, plan: 'lifetime' }],
    ['standard', { signedIn: true, pro: false, plan: 'lifetime' }],
    ['android', { signedIn: true, pro: true, plan: 'android_lifetime' }],
    ['android', { signedIn: true, pro: true, entitlementScope: 'android' }],
    ['android', { signedIn: true, pro: true, productId: 'configured-id', plan: 'pro', entitlementScope: 'android' }],
    ['all', { signedIn: true, pro: true, productId: 'constructor' }],
    ['apple', { signedIn: true, pro: true, productId: 'com.boxplayer.lifetimely' }],
    ['apple', { signedIn: true, pro: true, plan: 'yearly', productId: 'boxplayer.pro.yearly' }],
    ['all', { signedIn: true, pro: true, plan: 'lifetime' }],
    ['all', { signedIn: true, pro: true, plan: 'pro' }],
    ['all', { signedIn: true, pro: true, plan: 'legacy_pro', productId: 'com.example.super-lifetime' }],
  ]
  let failed = 0
  for (const [expected, input] of cases) {
    const actual = resolveBoxPlayerProTier(input)
    if (actual !== expected) { failed += 1; console.error('FAIL', JSON.stringify(input), actual) }
  }
  console.log(failed === 0 ? 'proTier smoke: OK' : `proTier smoke: ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}
