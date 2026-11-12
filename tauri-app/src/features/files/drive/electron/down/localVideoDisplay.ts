function displayPathExtension(value:string){const name=value.split(/[\\/]/).pop()||'',dot=name.lastIndexOf('.');return dot>0?name.slice(dot):''}
const LOCAL_VIDEO_EXTENSIONS = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ts', 'webm', 'wmv'])

export function isLocalVideoPath(filePath: string): boolean {
  const extension = displayPathExtension(filePath).slice(1).toLowerCase()
  return LOCAL_VIDEO_EXTENSIONS.has(extension)
}
