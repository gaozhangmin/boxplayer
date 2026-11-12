import { MouseMessage } from '@/features/files/drive/ports'

export function TestButton(button: number, event: MouseMessage, fun: any): boolean {
  if (event.button == button && !event.Ctrl && !event.Shift && !event.Alt) {
    fun()
    return true
  }
  return false
}

export function TestButtonAlt(button: number, event: MouseMessage, fun: any): boolean {
  if (event.button == button &&  event.Alt) {
    fun()
    return true
  }
  return false
}