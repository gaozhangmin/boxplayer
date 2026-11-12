export type FileSourceOverrides = Record<string, { name?: string; cover?: string; order?: number; hiddenOnHome?: boolean }>

export function reorderFileSourceIds(ids: string[], dragged: string, target: string): string[] {
  const from = ids.indexOf(dragged)
  const to = ids.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...ids]
  const reordered = [...ids]
  reordered.splice(from, 1)
  reordered.splice(to, 0, dragged)
  return reordered
}

export function applyFileSourceOrder(overrides: FileSourceOverrides, ids: string[]): FileSourceOverrides {
  const next = { ...overrides }
  ids.forEach((id, order) => { next[id] = { ...overrides[id], order } })
  return next
}
