/** Window whole grid rows so spacers never shift a card into another column. */
export function virtualCardRange(count: number, columns: number, stride: number, top: number, height: number, overscan = 3) {
  columns = Math.max(1, Math.floor(columns))
  stride = Math.max(1, stride)
  const rows = Math.ceil(count / columns)
  const first = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor(top / stride) - overscan))
  const last = Math.min(rows, Math.max(first + 1, Math.ceil((Math.max(0, top) + height) / stride) + overscan))
  return { start: first * columns, end: Math.min(count, last * columns), top: first * stride, bottom: (rows - last) * stride }
}
