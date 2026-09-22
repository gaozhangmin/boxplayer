import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { getEmbeddedMpvCapability } from '../../mpv/embeddedMpvCapability'
import { DisabledEmbeddedMpvBridge } from '../../mpv/embeddedMpvBridge'
import { getEmbeddedMpvNativeAddonRelativePaths, getEmbeddedMpvNativeResourceStatus, loadEmbeddedMpvNativeAddon } from '../../mpv/embeddedMpvNativeAddon'

describe('embedded MPV capability', () => {
  it('enables macOS embedded MPV when native addon and resources are complete', () => {
    const capability = getEmbeddedMpvCapability({
      platform: 'darwin',
      electronVersion: '21.4.4',
      nativeAddonAvailable: true,
      nativeResourcesComplete: true
    })

    expect(capability.enabled).toBe(true)
    expect(capability.status).toBe('available')
  })

  it('recognizes Linux x64 as a planned target but never enables an absent renderer', () => {
    const capability = getEmbeddedMpvCapability({
      platform: 'linux',
      electronVersion: '40.0.0',
      featureFlag: '1',
      nativeAddonAvailable: true
    })

    expect(capability.enabled).toBe(false)
    expect(capability.status).toBe('disabled')
    expect(capability.reason).toContain('Linux')
  })

  it.each([['win32', 'x64'], ['linux', 'x64'], ['linux', 'arm64']])('enables %s %s only with a verified software renderer and complete bundle', (platform, arch) => {
    const inputs = { platform, arch, nativeAddonAvailable: true, nativeResourcesComplete: true }
    expect(getEmbeddedMpvCapability(inputs).enabled).toBe(false)
    expect(getEmbeddedMpvCapability({ ...inputs, rendererAvailable: true }).enabled).toBe(true)
  })

  it.each([
    ['darwin', 'x64'], ['darwin', 'arm64'],
    ['win32', 'x64'],
    ['linux', 'x64'], ['linux', 'arm64']
  ])('locates the native addon for %s %s without crossing architectures', (platform, arch) => {
    const candidates = getEmbeddedMpvNativeAddonRelativePaths(platform, arch)
    expect(candidates).toHaveLength(2)
    expect(candidates.every((candidate) => candidate.includes(path.join('engine', platform, arch, 'mpv-texture')))).toBe(true)
  })

  it('does not accept unsupported architectures', () => {
    expect(getEmbeddedMpvNativeAddonRelativePaths('win32', 'ia32')).toEqual([])
    expect(getEmbeddedMpvNativeAddonRelativePaths('win32', 'arm64')).toEqual([])
    expect(getEmbeddedMpvCapability({ platform: 'linux', arch: 'arm' }).status).toBe('unsupported-platform')
  })

  it.each([
    ['win32', 'libmpv-2.dll'],
    ['linux', 'libmpv.so.2']
  ])('requires the correct %s libmpv binary and manifest entry', (platform, libraryName) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-resources-'))
    const addonPath = path.join(dir, 'mpv_texture.node')
    writeFileSync(addonPath, '')
    expect(getEmbeddedMpvNativeResourceStatus([addonPath], platform).missing).toContain(path.join(dir, libraryName))
    writeFileSync(path.join(dir, libraryName), '')
    const files = [{ name: 'mpv_texture.node' }, { name: libraryName }]
    if (platform === 'linux') {
      for (const name of ['mpv-node-host', 'mpv-host.cjs']) {
        writeFileSync(path.join(dir, name), '')
        files.push({ name })
      }
    }
    writeFileSync(path.join(dir, 'mpv-bundle-manifest.json'), JSON.stringify({ files }))
    expect(getEmbeddedMpvNativeResourceStatus([addonPath], platform).complete).toBe(true)
    expect(getEmbeddedMpvCapability({ platform, arch: 'x64', nativeAddonAvailable: true, nativeResourcesComplete: true }).enabled).toBe(false)
  })

  it('requires native addon and complete resources on macOS', () => {
    expect(getEmbeddedMpvCapability({ platform: 'darwin', electronVersion: '40.0.0' }).status).toBe('disabled')
    expect(getEmbeddedMpvCapability({ platform: 'darwin', electronVersion: '40.0.0', nativeAddonAvailable: true }).status).toBe('disabled')
    expect(getEmbeddedMpvCapability({ platform: 'darwin', electronVersion: '40.0.0', nativeAddonAvailable: true, nativeResourcesComplete: true }).status).toBe('available')
  })

  it('identifies a missing architecture-specific native bundle', () => {
    const capability = getEmbeddedMpvCapability({
      platform: 'darwin',
      arch: 'x64',
      nativeResourcesMissing: ['/app/engine/darwin/x64/mpv-texture/mpv_texture.node']
    })

    expect(capability.enabled).toBe(false)
    expect(capability.reason).toContain('macOS x64')
    expect(capability.reason).toContain('缺少')
  })

  it('reports a native loader failure separately from a missing bundle', () => {
    const capability = getEmbeddedMpvCapability({
      platform: 'darwin',
      arch: 'arm64',
      nativeAddonError: 'dlopen failed',
      nativeResourcesMissing: []
    })

    expect(capability.reason).toContain('dlopen failed')
  })

  it('requires a complete macOS native resource bundle before enabling embedded MPV', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-resources-'))
    const addonPath = path.join(dir, 'boxplayer-mpv-texture.node')
    writeFileSync(addonPath, '')

    const incomplete = getEmbeddedMpvNativeResourceStatus([addonPath])
    expect(incomplete.complete).toBe(false)
    expect(incomplete.missing).toContain(path.join(dir, 'libmpv.dylib'))
    expect(incomplete.missing).toContain(path.join(dir, 'mpv-bundle-manifest.json'))

    writeFileSync(path.join(dir, 'libmpv.dylib'), '')
    writeFileSync(path.join(dir, 'mpv-bundle-manifest.json'), JSON.stringify({ files: [{ name: 'boxplayer-mpv-texture.node' }] }))

    const missingManifestEntry = getEmbeddedMpvNativeResourceStatus([addonPath])
    expect(missingManifestEntry.complete).toBe(false)
    expect(missingManifestEntry.missing).toEqual(['mpv-bundle-manifest.json:libmpv.dylib'])
  })

  it('accepts a complete macOS native resource bundle manifest', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-resources-'))
    const addonPath = path.join(dir, 'boxplayer-mpv-texture.node')
    writeFileSync(addonPath, '')
    writeFileSync(path.join(dir, 'libmpv.dylib'), '')
    writeFileSync(
      path.join(dir, 'mpv-bundle-manifest.json'),
      JSON.stringify({
        files: [
          { name: 'boxplayer-mpv-texture.node', sha256: 'node-sha' },
          { name: 'libmpv.dylib', sha256: 'libmpv-sha' }
        ]
      })
    )

    const result = getEmbeddedMpvNativeResourceStatus([addonPath])
    expect(result.complete).toBe(true)
    expect(result.directory).toBe(dir)
    expect(result.missing).toEqual([])
  })

  it('checks later complete resource bundles when an earlier candidate is incomplete', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-resources-'))
    const incompletePath = path.join(dir, 'mpv_texture.node')
    const completeDir = path.join(dir, 'complete')
    mkdirSync(completeDir)
    const completePath = path.join(completeDir, 'boxplayer-mpv-texture.node')
    writeFileSync(incompletePath, '')
    writeFileSync(completePath, '')
    writeFileSync(path.join(completeDir, 'libmpv.dylib'), '')
    writeFileSync(path.join(completeDir, 'mpv-bundle-manifest.json'), JSON.stringify({ files: [{ name: 'boxplayer-mpv-texture.node' }, { name: 'libmpv.dylib' }] }))

    const result = getEmbeddedMpvNativeResourceStatus([incompletePath, completePath])
    expect(result.complete).toBe(true)
    expect(result.directory).toBe(completeDir)
  })

  it('disabled bridge refuses to load and returns capability context', async () => {
    const bridge = new DisabledEmbeddedMpvBridge()
    const result = await bridge.load({ url: 'https://example.test/video.mkv' })

    expect(result.ok).toBe(false)
    expect(result.capability.enabled).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('disabled bridge refuses control and status calls with capability context', async () => {
    const bridge = new DisabledEmbeddedMpvBridge()

    const controlResult = await bridge.control({ action: 'pause' })
    const statusResult = await bridge.getStatus()

    expect(controlResult.ok).toBe(false)
    expect(controlResult.capability.enabled).toBe(false)
    expect(controlResult.error).toBeTruthy()
    expect(statusResult.ok).toBe(false)
    expect(statusResult.capability.enabled).toBe(false)
    expect(statusResult.error).toBeTruthy()
  })

  it('reports missing native addon candidates without throwing', () => {
    const result = loadEmbeddedMpvNativeAddon(['/missing/boxplayer-mpv-texture.node'])

    expect(result.addon).toBeUndefined()
    expect(result.error).toContain('未找到')
    expect(result.searchedPaths).toEqual(['/missing/boxplayer-mpv-texture.node'])
  })

  it('rejects native addon modules with an incomplete interface', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-addon-'))
    const addonPath = path.join(dir, 'incomplete.cjs')
    writeFileSync(addonPath, 'module.exports = { mpvTexture: {} }')

    const result = loadEmbeddedMpvNativeAddon([addonPath])

    expect(result.addon).toBeUndefined()
    expect(result.addonPath).toBe(addonPath)
    expect(result.error).toContain('接口不完整')
  })

  it('rejects native addon modules without control/status methods', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-addon-'))
    const addonPath = path.join(dir, 'missing-status.cjs')
    writeFileSync(addonPath, `
      module.exports = {
        mpvTexture: {
          create() {},
          load() {},
          play() {},
          pause() {},
          stop() {},
          seek() {},
          setVolume() {},
          setSpeed() {},
          setAudioTrack() {},
          setSubtitleTrack() {},
          addSubtitle() {},
          pollEvents() {},
          destroy() {},
          onFrame() {},
          onStatus() {},
          onError() {}
        }
      }
    `)

    const result = loadEmbeddedMpvNativeAddon([addonPath])

    expect(result.addon).toBeUndefined()
    expect(result.addonPath).toBe(addonPath)
    expect(result.error).toContain('接口不完整')
  })

  it('loads native addon modules with the expected mpvTexture shape', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-addon-'))
    mkdirSync(dir, { recursive: true })
    const addonPath = path.join(dir, 'complete.cjs')
    writeFileSync(addonPath, `
      module.exports = {
        mpvTexture: {
          create() {},
          load() {},
          play() {},
          pause() {},
          stop() {},
          seek() {},
          setVolume() {},
          setSpeed() {},
          setAudioTrack() {},
          setSubtitleTrack() {},
          addSubtitle() {},
          pollEvents() {},
          getStatus() {},
          getTrackStatus() {},
          destroy() {},
          onFrame() {},
          onStatus() {},
          onError() {},
          isInitialized() {}
        }
      }
    `)

    const result = loadEmbeddedMpvNativeAddon([addonPath])

    expect(result.addon).toBeTruthy()
    expect(result.addonPath).toBe(addonPath)
    expect(result.error).toBeUndefined()
  })

  it('tries a compatible legacy addon after an incompatible first candidate', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-addon-'))
    const incompatiblePath = path.join(dir, 'mpv_texture.cjs')
    const compatiblePath = path.join(dir, 'boxplayer-mpv-texture.cjs')
    writeFileSync(incompatiblePath, 'module.exports = { mpvTexture: {} }')
    writeFileSync(compatiblePath, `
      module.exports = { mpvTexture: {
        create() {}, load() {}, play() {}, pause() {}, stop() {}, seek() {},
        setVolume() {}, getStatus() {}, destroy() {}, onFrame() {},
        onStatus() {}, onError() {}
      } }
    `)

    const result = loadEmbeddedMpvNativeAddon([incompatiblePath, compatiblePath])
    expect(result.addon).toBeTruthy()
    expect(result.addonPath).toBe(compatiblePath)
  })

  it('uses the speed property on older native addons and keeps status in sync', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-speed-'))
    const addonPath = path.join(dir, 'legacy-speed.cjs')
    writeFileSync(addonPath, `
      module.exports = { mpvTexture: {
        create() {}, load() {}, play() {}, pause() {}, stop() {}, seek() {},
        setVolume() {}, getStatus() { return { volume: Number(this.requestedSpeed || 0) } },
        setVideoProperty(name, value) { if (name === 'speed') this.requestedSpeed = value },
        destroy() {}, onFrame() {}, onStatus() {}, onError() {}
      } }
    `)

    const addon = loadEmbeddedMpvNativeAddon([addonPath]).addon?.mpvTexture
    expect(addon?.setSpeed).toBeTypeOf('function')
    addon?.setSpeed?.(1.5)
    expect(addon?.getStatus()).toMatchObject({ speed: 1.5, volume: 1.5 })
    expect(() => addon?.setSpeed?.(Infinity)).toThrow(RangeError)
  })
})
