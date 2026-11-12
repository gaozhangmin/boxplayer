const encodePathSegment = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/')

export const buildOneDriveSmallUploadPath = (parentId: string, fileName: string): string => {
  const name = encodePathSegment(fileName)
  if (!parentId || parentId === 'onedrive_root') return `/me/drive/root:/${name}:/content`
  return `/me/drive/items/${encodeURIComponent(parentId)}:/${name}:/content`
}
