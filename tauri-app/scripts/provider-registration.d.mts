export const registrationKeys: string[]
export function parseRegistration(text: string): Record<string, string>
export function loadProviderRegistration(options: {root: string; env?: Record<string, string | undefined>; strict?: boolean}): {env: Record<string, string>; configured: string[]; missing: string[]}
