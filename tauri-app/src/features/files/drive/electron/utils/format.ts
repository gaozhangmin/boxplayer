const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function humanSize(bytes: number | string | undefined): string {
  if (!bytes && bytes != 0) return ''
  if (typeof bytes === 'string') bytes = parseInt(bytes)
  let u = 0
  while (bytes >= 1024 && u < units.length - 1) {
    bytes /= 1024
    ++u
  }
  return `${bytes.toFixed(2)}${units[u]}`
}

export function humanDateTimeDateStr(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  const y = date.getFullYear().toString()
  if (y == 'NaN') return ''
  let m: number | string = date.getMonth() + 1
  m = m < 10 ? '0' + m.toString() : m.toString()
  let d: number | string = date.getDate()
  d = d < 10 ? '0' + d.toString() : d.toString()
  let h: number | string = date.getHours()
  h = h < 10 ? '0' + h.toString() : h.toString()
  let minute: number | string = date.getMinutes()
  minute = minute < 10 ? '0' + minute.toString() : minute.toString()
  let second: number | string = date.getSeconds()
  second = second < 10 ? '0' + second.toString() : second.toString()
  return y + '-' + m + '-' + d + ' ' + h + ':' + minute + ':' + second 
}

export function humanTime(value: number | string | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') value = parseInt(value)
  const hours = Math.floor(value / 3600)
  value = value % 3600
  const minutes = Math.floor(value / 60)
  value = value % 60
  const seconds = Math.floor(value)

  const hourStr = (hours < 10 ? '0' : '') + String(hours)
  const minStr = (minutes < 10 ? '0' : '') + String(minutes)
  const secStr = (seconds < 10 ? '0' : '') + String(seconds)
  return hourStr + ':' + minStr + ':' + secStr
}

export function humanDateTime(value: number | string | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') value = parseInt(value)
  if (value > 1000000000 && value < 10000000000) value = value * 1000
  const date = new Date(value)
  const y = date.getFullYear().toString()
  if (y == 'NaN') return ''
  let m: number | string = date.getMonth() + 1
  m = m < 10 ? '0' + m.toString() : m.toString()
  let d: number | string = date.getDate()
  d = d < 10 ? '0' + d.toString() : d.toString()
  let h: number | string = date.getHours()
  h = h < 10 ? '0' + h.toString() : h.toString()
  let minute: number | string = date.getMinutes()
  minute = minute < 10 ? '0' + minute.toString() : minute.toString()
  let second: number | string = date.getSeconds()
  second = second < 10 ? '0' + second.toString() : second.toString()
  return y + '-' + m + '-' + d + ' ' + h + ':' + minute + ':' + second 
}

export function humanExpiration(expiration: string | undefined, timenow: number = new Date().getTime()): string {
  if (expiration) {
    const date = Math.floor((new Date(expiration).getTime() - timenow) / 1000) 
    if (date <= 0) return '过期失效'
    else if (date < 60) return date + '秒后'
    else if (date < 3600) return (date / 60).toFixed(1) + '分钟'
    else if (date < 3600 * 24) return (date / 3600).toFixed(1) + '小时'
    else return (date / 3600 / 24).toFixed(1) + '天后'
  } else {
    return '永久'
  }
}

const pk = 'abcDEfgFGHJIdeoOPQpyzABqwxC5678KLhijklmnMNWXYZ012rstuv34RSTUV99'

export function randomSharePassword(): string {
  return 'xxxx'.replace(/[x]/g, function (c) {
    const r = Math.floor((Math.random() * 169) | 0) % (pk.length - 1)
    return pk.substring(r, r + 1)
  })
}
