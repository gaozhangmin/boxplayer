import {filePlatform} from '../creationPorts'

export function ClearFileName(fileName: string): string {
  if (!fileName) return ''

  fileName = fileName.replace(/[<>:"/\\|?*]+/g, '')
  fileName = fileName.replace(/[\f\n\r\t\v]/g, '')
  while (fileName.endsWith(' ') || fileName.endsWith('.')) fileName = fileName.substring(0, fileName.length - 1)
  while (fileName.startsWith(' ')) fileName = fileName.substring(1)
  if (filePlatform() == 'win32') {
    // donothing
  } else if (filePlatform() == 'darwin') {
    while (fileName.startsWith('.')) fileName = fileName.substring(1)
  } else if (filePlatform() == 'linux') {
    // donothing
  }
  return fileName
}


export function CheckFileName(fileName: string): string {
  if (!fileName) return '不能为空'

  if (fileName.match(/[<>:"/\\|?*]+/g)) return '不能包含 < > : " / \\ | ? * '
  if (fileName.match(/[\f\n\r\t\v]/g)) return '不能包含 \\f \\n \\r \\t \\v'
  if (fileName.endsWith(' ') || fileName.endsWith('.')) return '不能以空格或.结尾'
  if (fileName.startsWith(' ')) return '不能以空格开头'
  if (filePlatform() == 'win32') {
    // donothing
  } else if (filePlatform() == 'darwin') {
    if (fileName.startsWith('.')) return '不能以.开头'
  } else if (filePlatform() == 'linux') {
    // donothing
  }
  return ''
}


