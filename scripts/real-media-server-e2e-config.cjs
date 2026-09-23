'use strict'

function parseJsonObject(raw, name) {
  if (!raw || !String(raw).trim()) throw new Error(`${name} is required`)
  let value
  try {
    value = JSON.parse(String(raw))
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${name} must be a JSON object`)
  return value
}

function normalizeUrl(value) {
  const url = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Emby baseUrl must use http or https')
  return url.toString().replace(/\/$/, '')
}

function loadRealMediaServerE2EConfig(env = process.env) {
  const input = parseJsonObject(env.BOXPLAYER_E2E_EMBY_JSON, 'BOXPLAYER_E2E_EMBY_JSON')
  const required = ['accessToken', 'userId', 'mediaTitle']
  for (const key of required) {
    if (!String(input[key] || '').trim()) throw new Error(`BOXPLAYER_E2E_EMBY_JSON.${key} is required`)
  }
  return {
    type: 'emby',
    name: String(input.name || 'BoxPlayer E2E Emby').trim(),
    baseUrl: normalizeUrl(input.baseUrl),
    accessToken: String(input.accessToken).trim(),
    userId: String(input.userId).trim(),
    deviceId: String(input.deviceId || 'boxplayer-github-actions').trim(),
    mediaTitle: String(input.mediaTitle).trim()
  }
}

if (require.main === module) {
  try {
    const config = loadRealMediaServerE2EConfig()
    console.log(`Real media-server E2E coverage OK: ${config.type}, title configured`)
  } catch (error) {
    console.error(`Real media-server E2E preflight failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

module.exports = { loadRealMediaServerE2EConfig }
