export const buildGoogleMultipartUploadBody = (parentId: string, name: string, contentType: string, bytes: Uint8Array, boundary: string) => {
  const parent = parentId === 'google_root' ? 'root' : parentId
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  const tail = `\r\n--${boundary}--\r\n`
  return new Blob([head, new Uint8Array(Array.from(bytes)), tail], { type: `multipart/related; boundary=${boundary}` })
}
