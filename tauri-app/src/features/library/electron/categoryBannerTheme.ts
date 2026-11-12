/** Stable semantic accents shared by all category banner entry points. */
export function categoryBannerStyle(title: string): Record<string, string> {
  const name = title.toLowerCase()
  const palettes = [['#142f62', '#3989b5'], ['#49215d', '#9b5489'], ['#24524b', '#57a397'], ['#65421d', '#c19a4c'], ['#492444', '#ae5370']]
  let colors = palettes[Array.from(title).reduce((sum, char) => sum + char.codePointAt(0)!, 0) % palettes.length]
  if (name.includes('netflix')) colors = ['#650c19', '#b41c36']
  else if (/prime|amazon/.test(name)) colors = ['#07336c', '#1285b3']
  else if (name.includes('hbo')) colors = ['#101e3d', '#386b9d']
  else if (/动作|動作|action/.test(name)) colors = ['#6b2510', '#d77a2f']
  else if (/科幻|sci/.test(name)) colors = ['#092d68', '#298dd3']
  else if (/冒险|冒險|adventure/.test(name)) colors = ['#41421b', '#a58a32']
  else if (/纪录|紀錄|document/.test(name)) colors = ['#123f69', '#66a6c4']
  return { '--banner-start': colors[0], '--banner-end': colors[1] }
}

/** Bundled marks remain available offline and do not depend on the artwork CDN. */
export function categoryNetworkLogo(title: string): string | undefined {
  const names: Record<string, string> = {
    netflix: 'netflix', hbo: 'hbo', 'prime video': 'prime', 'amazon prime video': 'prime',
    hulu: 'hulu', 'disney+': 'disney', 'disney plus': 'disney', max: 'max', 'hbo max': 'max'
  }
  const name = names[title.trim().toLowerCase()]
  return name ? `${import.meta.env.BASE_URL}images/network-logos/${name}.png` : undefined
}
