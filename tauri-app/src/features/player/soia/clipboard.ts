// Clipboard access stays behind the platform boundary, never in vendored UI.
export async function readText(): Promise<string> { return navigator.clipboard.readText() }
export async function writeText(text: string): Promise<void> { await navigator.clipboard.writeText(text) }
