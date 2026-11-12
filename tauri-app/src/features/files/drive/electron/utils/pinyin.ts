import pinyinlite from './pinyinlite.js'
export function HanToPin(input: string): string {
  if (!input) return ''
  // eslint-disable-next-line no-undef
  const arr = pinyinlite(input, { keepUnrecognized: true })
  const strarr = new Array<string>(arr.length * 2 + 1)
  let l = false
  for (let p = 1, i = 0, maxi = arr.length; i < maxi; p += 2, i++) {
    strarr[p] = arr[i].join(' ')
    l = strarr[p].length > 1
    if (l) {
      strarr[p - 1] = ' '
      strarr[p + 1] = ' '
    } else {
      strarr[p + 1] = ''
    }
  }
  strarr[0] = ''
  return strarr.join('')
}
