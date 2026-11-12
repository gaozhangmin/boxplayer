// Extracted unchanged from Electron src/utils/utils.ts (MapValueToArray).
export function MapValueToArray<T>(map: Map<any, T>): T[] {
  const arr: T[] = []
  const keys = map.values()
  for (let i = 0, maxi = map.size; i < maxi; i++) {
    const value = keys.next().value
    if (value !== undefined) {
      arr.push(value)
    }
  }
  return arr
}
