// Native FFmpeg/mpv errors may contain signed source URLs or request headers.
export function sanitizeMpvDiagnostic(value: unknown): string {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => /(?:authorization|cookie|access[_-]?token|refresh[_-]?token|signature)\s*[:=]/i.test(line)
      ? '[redacted source diagnostic]'
      : line.replace(/https?:\/\/[^\s<>"']+/gi, '[media URL]'))
    .join('\n').trim().slice(0, 2000)
}
