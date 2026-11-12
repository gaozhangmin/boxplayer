const toExpireDays = (expiration: string) => {
  if (!expiration) return 0
  const target = new Date(expiration).getTime()
  if (Number.isNaN(target)) return 0
  const days = Math.ceil(Math.max(0, target - Date.now()) / 86400000)
  return days <= 1 ? 1 : days <= 7 ? 7 : 30
}
export {toExpireDays}
