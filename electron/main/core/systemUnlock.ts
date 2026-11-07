import { systemPreferences } from 'electron'

// Other desktops expose no trusted authentication adapter yet. Hide their control.
export function canUseSystemUnlock(): boolean {
  try { return process.platform === 'darwin' && systemPreferences.canPromptTouchID() }
  catch { return false }
}

export async function authenticateSystemUnlock(): Promise<boolean> {
  if (!canUseSystemUnlock()) return false
  try {
    await systemPreferences.promptTouchID('unlock BoxPlayer')
    return true
  } catch { return false }
}
