import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function findClosingDiv(template: string, openingDivIndex: number): number {
  const divTagPattern = /<\/?div\b[^>]*>/g
  divTagPattern.lastIndex = openingDivIndex
  let depth = 0

  for (let match = divTagPattern.exec(template); match; match = divTagPattern.exec(template)) {
    const tag = match[0]
    if (tag.startsWith('</')) {
      depth--
      if (depth === 0) return match.index
    } else {
      depth++
    }
  }

  return -1
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)

  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThan(-1)
  expect(end, `missing end marker after ${startMarker}: ${endMarker}`).toBeGreaterThan(start)

  return source.slice(start, end)
}

describe('BookReaderModal template structure', () => {
  it('keeps the translation popup inside the fullscreen reader shell', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const shellIndex = source.indexOf('<div v-if="visible"')
    const shellCloseIndex = source.lastIndexOf('</Teleport>')
    const translationPopupIndex = source.indexOf('class="trans-popup-layer"')

    expect(shellIndex).toBeGreaterThan(-1)
    expect(shellCloseIndex).toBeGreaterThan(shellIndex)
    expect(translationPopupIndex).toBeGreaterThan(shellIndex)
    expect(translationPopupIndex).toBeLessThan(shellCloseIndex)
  })

  it('routes the right-side AI chat through the migrated bookAI services', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')

    expect(source).toContain('createBookAISettings')
    expect(source).toContain('selectRetrievalBackend')
    expect(source).toContain('loadAIConversationMessages')
    expect(source).toContain('migrateLegacyAIHistory')
    expect(source).toContain('replaceAIConversationMessages')
    expect(source).not.toContain('localStorage.setItem(aiHistoryKey()')
    expect(source).not.toContain('localStorage.getItem(aiHistoryKey()')
  })

  it('keeps migrated chat behavior safe for gateway, retry, and async history loading', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')

    expect(source).toContain('let aiHistoryLoadRequestId = 0')
    expect(source).toContain('aiStatusText')
    expect(source).toContain("cfg.providerName !== 'ai-gateway' && !isBoxPlayerCloudProvider(cfg.providerName)")
    expect(source).toContain('findLastIndex')
    expect(source).not.toContain('!cfg.endpoint || !cfg.modelId')
  })

  it('exposes Readest-style AI reader controls in the right settings panel', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')

    // AI settings are available through the global Settings modal (SettingAPI.vue) 
    // and the right-panel still uses settingStore for RAG/spoiler/chunks
    expect(source).toContain('settingStore')
    expect(source).toContain('createBookAISettings')
    expect(source).toContain('isAIConfigured')
    expect(source).toContain('openAIAssistant')
    expect(source).toContain('indexBookForAI')
  })

  it('shows the user chat message before collecting slow reader context', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const askStart = source.indexOf('async function askAI(question: string)')
    const askEnd = source.indexOf('async function retryLastAI()', askStart)
    const askSource = source.slice(askStart, askEnd)
    const appendUserIndex = askSource.indexOf('aiMessages.value = [...aiMessages.value, userMsg]')
    const readContextIndex = askSource.indexOf('getAudioText()')

    expect(appendUserIndex).toBeGreaterThan(-1)
    expect(readContextIndex).toBeGreaterThan(-1)
    expect(appendUserIndex).toBeLessThan(readContextIndex)
  })

  it('guards RAG context extraction with a timeout before chat completion', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const askStart = source.indexOf('async function askAI(question: string)')
    const askEnd = source.indexOf('async function retryLastAI()', askStart)
    const askSource = source.slice(askStart, askEnd)

    expect(askSource).toContain('withRetryAndTimeout(() => bookReader!.getBookAIContextSource')
  })

  it('scrolls iframe reader content when page buttons are used in scroll mode', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')

    expect(source).toContain("import { scrollReaderPageArea } from '../utils/bookReaderScroll'")
    expect(source).toContain('await scrollReaderPageArea(readerContainer.value, bookReader, direction)')
    expect(source).toContain('function syncScrollIframeHeight')
    expect(source).toContain('scrollReaderContentBy(-1)')
    expect(source).toContain('scrollReaderContentBy(1)')
  })

  it('supports Koodo synchronous getProgress when syncing footer page numbers', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const syncStart = source.indexOf('function syncReaderProgress')
    const syncEnd = source.indexOf('function bindReaderIframeEventListeners', syncStart)
    const syncSource = source.slice(syncStart, syncEnd)

    expect(syncSource).toContain('Promise.resolve(rendition.getProgress())')
    expect(syncSource).toContain('normalizeReaderPageProgress')
    expect(syncSource).toContain('estimateReaderPageProgressFromElement')
    expect(syncSource).not.toContain('rendition.getProgress().then')
  })

  it('keeps reflowable chapter pages separate from fixed-layout document pages', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const widgetSource = readFileSync(resolve(__dirname, '../../layout/book-reader/ReaderPageWidget.vue'), 'utf8')

    expect(source).toContain('isFixedLayoutBookFormat')
    expect(source).toContain(':is-fixed-layout="readerIsFixedLayout"')
    expect(source).toContain("readerIsFixedLayout ? '页码' : '本章'")
    expect(widgetSource).toContain('isFixedLayout: boolean')
    expect(widgetSource).toContain('Chapter ${props.currentChapter || 1}')
  })

  it('gives archive-based comic books their own layout and reading direction controls', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')

    expect(source).toContain('isComicBookFormat')
    expect(source).toContain("const comicLayoutMode = ref<BookReaderLayoutMode>('single')")
    expect(source).toContain("const comicReadingDirection = ref<'ltr' | 'rtl'>('ltr')")
    expect(source).toContain('activeReaderLayoutMode')
    expect(source).toContain("'viewer-comic': readerIsComic")
    expect(source).toContain('Comic layout')
    expect(source).toContain('Reading direction')
    expect(source).toContain('stage-reader-comic-rtl')
  })

  it('materializes system-opened local books before ReaderKit fetches them', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')

    expect(source).toContain('readLocalBookSource(props.sourceUrlOverride)')
    expect(source).toContain("window.require('fs')")
    expect(source).toContain('URL.createObjectURL(new Blob([new Uint8Array(bytes)]))')
    expect(source).toContain('URL.revokeObjectURL(localBookObjectUrl)')
  })

  it('refreshes page and chapter labels after any engine page change without accepting stale progress', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const hookStart = source.indexOf('function bindRenderedHook')
    const hookEnd = source.indexOf('async function loadReaderBookBook', hookStart)
    const hookSource = source.slice(hookStart, hookEnd)
    const syncStart = source.indexOf('function syncReaderProgress')
    const syncEnd = source.indexOf('function bindReaderIframeEventListeners', syncStart)
    const syncSource = source.slice(syncStart, syncEnd)

    expect(hookSource).toContain('syncReaderProgress(2)')
    expect(hookSource).toContain('scheduleBookPositionSave()')
    expect(syncSource).toContain('readerProgressRequestId')
    expect(syncSource).toContain('requestId !== readerProgressRequestId')
    expect(syncSource).toContain('position?.chapterDocIndex')
  })

  it('applies reader margin through live iframe content CSS instead of rerendering the book', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const styleStart = source.indexOf('const readerStageStyle')
    const styleEnd = source.indexOf('const selectionPopupStyle', styleStart)
    const styleSource = source.slice(styleStart, styleEnd)
    const rerenderWatchStart = source.indexOf('// Font/style changes: full re-render to apply')
    const rerenderWatchEnd = source.indexOf('watch([readerBackgroundColor, readerTextColor]', rerenderWatchStart)
    const rerenderWatchSource = source.slice(rerenderWatchStart, rerenderWatchEnd)

    expect(source).toContain("from '../utils/bookReaderLayout'")
    expect(styleSource).toContain('buildReaderStageStyle')
    expect(source).toContain('buildReaderContentMarginCss(readerMargin.value, activeReaderLayoutMode.value)')
    expect(source).toContain("marginStyle.id = 'reader-content-margin-override'")
    expect(source).toContain('watch([readerMargin], () => {')
    expect(source).toContain('applyReaderStyles()')
    expect(rerenderWatchSource).not.toContain('readerMargin,')
  })

  it('lets boxplayer drive single/scroll layouts and only enforces double-page columns', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const readerSource = readFileSync(resolve(__dirname, '../bookReader.ts'), 'utf8')
    const applyStart = source.indexOf('function applyReaderStyles')
    const applyEnd = source.indexOf('function buildCurrentReaderOptions', applyStart)
    const applySource = source.slice(applyStart, applyEnd)

    expect(source).toContain('applyDoublePageCss')
    expect(applySource).toContain('applyDoublePageCss(container, activeReaderLayoutMode.value)')
    // 双页模式仍需注入 column-count: 2，但不能污染单页引擎自己的分页样式。
    expect(readerSource).toContain("doc.documentElement.setAttribute('data-boxplayer-double-page', 'true')")
    expect(readerSource).toContain('kookit-double-page-override')
    expect(readerSource).not.toContain("for (const el of [doc.documentElement, doc.body])")
    // 单页/滚动模式不能强制 column-count:1 / overflow:hidden / width:100%（boxplayer
    // 的横向分页和容器滚动会被破坏，造成只显示部分文字）
    expect(readerSource).not.toMatch(/createElement\(['"]style['"]\)[\s\S]{0,80}kookit-single-page-override/)
    expect(readerSource).not.toContain("setProperty('column-count', '1'")
    expect(readerSource).not.toContain("setProperty('column-width', 'auto'")
    expect(readerSource).not.toContain("setProperty('overflow-y', 'hidden', 'important')")
    expect(readerSource).not.toContain('column-count: 1!important')
    expect(applySource).not.toContain("replace(/column-count")
    expect(readerSource).toContain("applyDoublePageCss(options.container, options.readerMode || 'single')")
  })

  it('configures the pdf.js worker before readerkit parses PDF files', () => {
    const readerSource = readFileSync(resolve(__dirname, '../bookReader.ts'), 'utf8')
    const createReaderSource = sliceBetween(readerSource, 'export async function createBookReader', '  const content = cachedContent')

    expect(readerSource).toContain("await import('pdfjs-dist')")
    expect(readerSource).toContain("import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.js?url'")
    expect(readerSource).toContain('pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl')
    expect(readerSource).toContain('scope.pdfjsLib')
    expect(createReaderSource).toContain('await configurePdfJsWorker()')
    expect(createReaderSource.indexOf('await configurePdfJsWorker()')).toBeLessThan(createReaderSource.indexOf("import('../vendor/reader/readerkit.min.js')"))
    expect(readerSource).toContain('await waitForReaderRender(rendition.goToPosition?.(')
  })

  it('does not reset custom reader colors when font size changes', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const themeWatchStart = source.indexOf('watch([readerMode')
    const themeWatchEnd = source.indexOf('watch([readerPageWidth]', themeWatchStart)
    const themeWatchSource = source.slice(themeWatchStart, themeWatchEnd)

    expect(themeWatchSource).toContain('readerBackgroundColor.value')
    expect(themeWatchSource).toContain('readerTextColor.value')
    expect(themeWatchSource).not.toContain('fontSize')
  })

  it('enters fullscreen automatically when the reader opens and exits on close', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const windowSource = readFileSync(resolve(__dirname, '../../../electron/main/core/window.ts'), 'utf8')
    const visibleWatchStart = source.indexOf('watch(\n  () => props.visible')
    const visibleWatchEnd = source.indexOf('watch(\n  () => props.book?.id', visibleWatchStart)
    const visibleWatchSource = source.slice(visibleWatchStart, visibleWatchEnd)
    const closeStart = source.indexOf('function close()')
    const closeEnd = source.indexOf('const isFullscreen', closeStart)
    const closeSource = source.slice(closeStart, closeEnd)

    expect(source).toContain('function enterReaderFullscreen')
    expect(source).toContain('function exitReaderFullscreen')
    expect(source).toContain("shouldEnter ? 'enterfullscreen' : 'exitfullscreen'")
    expect(visibleWatchSource).toContain('enterReaderFullscreen()')
    expect(closeSource).toContain('exitReaderFullscreen()')
    expect(source).toContain("document.addEventListener('fullscreenchange', syncFullscreenState)")
    expect(windowSource).toContain("data.cmd === 'enterfullscreen'")
    expect(windowSource).toContain("currentWin.setFullScreen(true)")
    expect(windowSource).toContain("data.cmd === 'exitfullscreen'")
    expect(windowSource).toContain("currentWin.setFullScreen(false)")
  })

  it('matches Koodo keyboard behavior in scroll mode', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const keyStart = source.indexOf('function handleKeyDown')
    const keyEnd = source.indexOf("} else if (key === 'escape')", keyStart)
    const keySource = source.slice(keyStart, keyEnd)
    const iframeKeyStart = source.indexOf('function handleReaderIframeKeyDown')
    const iframeKeyEnd = source.indexOf('let lastReaderWheelAt', iframeKeyStart)
    const iframeKeySource = source.slice(iframeKeyStart, iframeKeyEnd)

    expect(source).toContain('function scrollReaderByNativeArrow')
    expect(keySource).toContain('scrollReaderByNativeArrow(-1)')
    expect(keySource).toContain('scrollReaderByNativeArrow(1)')
    expect(keySource).toContain('scrollPageUp()')
    expect(keySource).toContain('scrollPageDown()')
    expect(keySource).toContain("key === 'arrowleft' || key === 'pageup'")
    expect(keySource).toContain("key === 'arrowright' || key === 'pagedown' || key === ' '")
    expect(keySource).not.toContain("key === 'arrowleft' || key === 'arrowup' || key === 'pageup'")
    expect(keySource).not.toContain("key === 'arrowright' || key === 'arrowdown' || key === 'pagedown' || key === ' '")
    expect(keySource).not.toContain('if (isScroll) return // native scroll')
    expect(iframeKeySource).toContain('handleKeyDown(event)')
    expect(iframeKeySource).not.toContain('滚动模式下让浏览器处理原生滚动按键')
  })

  it('keeps right panel controls from overlapping the visible settings panel', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const rightControlsStart = source.indexOf('const rightFloatingControlsStyle')
    const rightControlsEnd = source.indexOf('const readerStageStyle', rightControlsStart)
    const rightControlsSource = source.slice(rightControlsStart, rightControlsEnd)

    expect(source).toContain("['edge-trigger', 'trigger-right', isRightPanelVisible ? 'hidden' : '']")
    expect(source).toContain('<div v-show="!isRightPanelVisible" class="reader-topright-controls" :style="rightFloatingControlsStyle">')
    expect(source).toContain('<div class="page-turn-cluster" :style="rightPageTurnStyle">')
    expect(rightControlsSource).toContain('isRightPanelVisible.value')
    expect(rightControlsSource).toContain('rightPanelWidth.value')
    expect(rightControlsSource).not.toContain('lockedPanels.value.right')
  })

  it('captures right panel resize drags before the reader iframe can steal mouse events', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const resizeStart = source.indexOf("let panelDragState: { side: 'left' | 'right'")
    const resizeEnd = source.indexOf('function startTransResize', resizeStart)
    const resizeSource = source.slice(resizeStart, resizeEnd)

    expect(source).toContain('v-if="panelResizingSide" class="panel-resize-shield"')
    expect(source).toContain('@mousemove="updatePanelResize"')
    expect(source).toContain('@mouseup="finishPanelResize"')
    expect(source).toContain('finishPanelResize()')
    expect(resizeSource).toContain("const panelResizingSide = ref<'left' | 'right' | null>(null)")
    expect(resizeSource).toContain('panelResizingSide.value = side')
    expect(resizeSource).toContain("document.body.style.userSelect = 'none'")
    expect(resizeSource).toContain("document.removeEventListener('mousemove', updatePanelResize)")
    expect(resizeSource).toContain("window.removeEventListener('blur', finishPanelResize)")
    expect(resizeSource).not.toContain("document.addEventListener('mousemove', onMove)")
  })

  it('wires full-page translation through a dedicated controller and serialized rerender watchers', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const cleanupSource = sliceBetween(source, 'function cleanup() {', 'function readBookSelection()')
    const bindHookSource = sliceBetween(source, 'function bindRenderedHook()', 'async function loadReaderBookBook')
    const loadSource = sliceBetween(source, 'async function loadReaderBookBook', 'async function rerenderBookReader()')
    const rerenderSource = sliceBetween(source, 'async function rerenderBookReader()', 'function rgbaToHex')
    const modeWatchSource = sliceBetween(source, 'watch(readerFullTranslationMode,', 'watch([readerBackgroundColor, readerTextColor], () => {')
    const providerWatchSource = sliceBetween(source, 'watch(transProvider,', 'watch(transTarget,')
    const targetWatchSource = sliceBetween(source, 'watch(transTarget,', 'watch([readerVoiceLocale, readerVoiceURI, readerVoiceRate], () => {')

    expect(source).toContain("import { createBookFullTranslationController } from '../utils/bookFullTranslation'")
    expect(source).toContain("const fullTranslationLoading = ref(false)")
    expect(source).toContain("const fullTranslationError = ref('')")
    expect(source).toContain("const transTarget = ref(savedPreferences.readerTranslationTarget)")
    expect(source).toContain('const fullTranslationController = createBookFullTranslationController({')
    expect(source).toContain("checkUsage: (characters) => checkAndIncrement('readerTranslation', characters, { metered: false })")
    expect(source).toContain("import { isBoxPlayerCloudProvider, translateWithBoxPlayerCloud } from '../utils/boxplayerCloudAI'")
    expect(source).toContain('translate: (text, target) => translateWithBoxPlayerCloud(text, target)')
    expect(source).toContain('function scheduleFullTranslation()')
    expect(source).toContain("if (!bookReader || readerFullTranslationMode.value === 'no') return Promise.resolve()")
    expect(source).toContain('return fullTranslationController.schedule({')
    expect(source).toContain('let applyFullTranslationPromise = Promise.resolve()')
    expect(source).toContain('let readerRerenderPromise = Promise.resolve(true)')
    expect(source).toContain('function queueFullTranslationRerender()')
    expect(cleanupSource).toContain('cleanupReaderRenditionListeners()')
    expect(cleanupSource).toContain('fullTranslationController.clear()')
    expect(cleanupSource).toContain('readerRerenderPromise = Promise.resolve(true)')
    expect(loadSource).toContain('await scheduleFullTranslation().catch(() => {})')
    expect(rerenderSource).toContain('fullTranslationController.invalidate()')
    expect(rerenderSource).toContain('cleanupReaderRenditionListeners()')

    expect(bindHookSource).toContain('function handleRendered()')
    expect(bindHookSource).toContain('function handlePageChanged()')
    expect(bindHookSource).toContain("rendition.on('rendered', handleRendered)")
    expect(bindHookSource).toContain("rendition.on('page-changed', handlePageChanged)")
    expect(bindHookSource).toContain("rendition.off?.('rendered', handleRendered)")
    expect(bindHookSource).toContain("rendition.off?.('page-changed', handlePageChanged)")
    expect(bindHookSource).toContain('scheduleFullTranslation().catch(() => {})')

    expect(modeWatchSource).toContain('saveReaderPreferences()')
    expect(modeWatchSource).toContain('await queueFullTranslationRerender()')
    expect(modeWatchSource).not.toContain('applyFullTranslationPromise = applyFullTranslationPromise')
    expect(modeWatchSource).not.toContain('watch([')

    expect(providerWatchSource).toContain('setTranslator(transProvider.value)')
    expect(providerWatchSource).not.toContain('queueFullTranslationRerender')
    expect(targetWatchSource).toContain("if (readerFullTranslationMode.value === 'no') return")
    expect(targetWatchSource).toContain('saveReaderPreferences()')
    expect(targetWatchSource).toContain('await queueFullTranslationRerender()')
  })

  it('uses cloud translation API for full-page translation independent of the popup provider', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const fullTranslationSection = sliceBetween(source, "<div class=\"setting-section-title\">{{ t('full.text.translation') }} <span class=\"pro-pill\">Pro</span></div>", '<!-- Toggle Switches')
    const controllerSource = sliceBetween(source, 'const fullTranslationController = createBookFullTranslationController({', 'let applyFullTranslationPromise = Promise.resolve()')

    expect(source).toContain("import { isBoxPlayerCloudProvider, translateWithBoxPlayerCloud } from '../utils/boxplayerCloudAI'")
    expect(controllerSource).toContain('translate: (text, target) => translateWithBoxPlayerCloud(text, target)')
    expect(controllerSource).toContain("checkUsage: (characters) => checkAndIncrement('readerTranslation', characters, { metered: false })")
    expect(fullTranslationSection).not.toContain('v-model="transProvider"')
    expect(fullTranslationSection).not.toContain('translators.providers')
  })

  it('passes full translation mode through reader options', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const optionsSource = sliceBetween(source, 'function buildCurrentReaderOptions(): BookReaderOptions {', 'async function locateAnnotationTarget()')
    const readerSource = readFileSync(resolve(__dirname, '../bookReader.ts'), 'utf8')
    const styleConfigSource = sliceBetween(readerSource, 'export function createReaderStyleConfig', 'export function applyReaderDefaultCss')

    expect(optionsSource).toContain('fullTranslationMode: readerFullTranslationMode.value')
    expect(styleConfigSource).toContain("fullTranslationMode: options.fullTranslationMode || 'no'")
    expect(styleConfigSource).toContain("key === 'fullTranslationBooks' && fullTranslationEnabled ? [''] : []")
  })

  it('uses the bundled Koodo CSS layout identifiers', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const readerSource = readFileSync(resolve(__dirname, '../bookReader.ts'), 'utf8')

    expect(source).toContain("{ value: 'kookit', label: t('layout.recommended') }")
    expect(readerSource).toContain("bookLayout: options.bookLayout || ''")
  })

  it('guards full translation lifecycle with tokens across cleanup, load, and rerender queues', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const varsSource = sliceBetween(source, 'let bookReader: BookReaderHandle | null = null', 'const readingTimeSeconds = ref(0)')
    const cleanupSource = sliceBetween(source, 'function cleanup() {', 'function readBookSelection()')
    const queueSource = sliceBetween(source, 'function queueFullTranslationRerender()', 'function zoomBookImagePreview')
    const loadSource = sliceBetween(source, 'async function loadReaderBookBook', 'async function rerenderBookReader()')
    const rerenderSource = sliceBetween(source, 'async function rerenderBookReader()', 'function rgbaToHex')

    expect(varsSource).toContain('let readerLifecycleToken = 0')
    expect(varsSource).toContain('let fullTranslationRerenderRequestId = 0')
    expect(varsSource).not.toContain('let rerenderToken = 0')
    expect(source).toContain('let readerRerenderPromise = Promise.resolve(true)')

    expect(cleanupSource).toContain('readerLifecycleToken += 1')
    expect(cleanupSource).toContain('fullTranslationRerenderRequestId += 1')
    expect(cleanupSource).not.toContain('rerenderToken += 1')
    expect(cleanupSource).toContain('readerRerenderPromise = Promise.resolve(true)')

    expect(queueSource).toContain('const lifecycleToken = readerLifecycleToken')
    expect(queueSource).toContain('const requestId = ++fullTranslationRerenderRequestId')
    expect(queueSource).toContain('if (lifecycleToken !== readerLifecycleToken || requestId !== fullTranslationRerenderRequestId) return')
    expect(queueSource).toContain('const rerendered = await rerenderBookReader()')
    expect(queueSource).toContain('if (!rerendered) return')
    expect(queueSource).toContain('await scheduleFullTranslation().catch(() => {})')
    expect(queueSource.indexOf('if (!rerendered) return')).toBeLessThan(queueSource.indexOf('await scheduleFullTranslation().catch(() => {})'))

    expect(loadSource).toContain('const lifecycleToken = readerLifecycleToken')
    expect(loadSource).toContain('const currentBookId = props.book?.id || book?.id || \'\'')
    expect(loadSource).toContain('const currentReader = bookReader')
    expect(loadSource).toContain('const nextReader = await createBookReader(buildCurrentReaderOptions())')
    expect(loadSource).toContain('if (lifecycleToken !== readerLifecycleToken || !props.visible || bookReader !== currentReader || (props.book?.id || \'\') !== currentBookId)')
    expect(loadSource).toContain('nextReader.destroy()')
    expect(loadSource).toContain('bookReader = nextReader')

    expect(rerenderSource).toContain('const lifecycleToken = readerLifecycleToken')
    expect(rerenderSource).toContain('const queuedRerender = readerRerenderPromise')
    expect(rerenderSource).toContain('.catch(() => false)')
    expect(rerenderSource).toContain('if (lifecycleToken !== readerLifecycleToken || !bookReader || !readerContainer.value) return false')
    expect(rerenderSource).toContain('const currentReader = bookReader')
    expect(rerenderSource).toContain('const currentBookId = props.book?.id || \'\'')
    expect(rerenderSource).toContain('const nextReader = await createBookReader(buildCurrentReaderOptions(), cachedContent)')
    expect(rerenderSource).toContain('if (lifecycleToken !== readerLifecycleToken || !props.visible || bookReader !== currentReader || (props.book?.id || \'\') !== currentBookId)')
    expect(rerenderSource).not.toContain('activeRerenderToken')
    expect(rerenderSource).toContain('nextReader.destroy()')
    expect(rerenderSource).toContain('return true')
    expect(rerenderSource).toContain('readerRerenderPromise = queuedRerender')
    expect(rerenderSource).toContain('return queuedRerender')
    expect(rerenderSource).not.toContain('if (rerenderLock || !bookReader || !readerContainer.value) return')
    expect(rerenderSource).not.toContain('let rerenderLock = false')
  })

  it('shows target controls under full text translation settings and keeps provider controls in the selection popup', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const fullTranslationSection = sliceBetween(source, "<div class=\"setting-section-title\">{{ t('full.text.translation') }} <span class=\"pro-pill\">Pro</span></div>", '<!-- Toggle Switches')
    const popupSource = sliceBetween(source, '<div v-if="translateSource || translateResult" class="trans-popup-layer" @mousedown.stop>', '</Teleport>')

    expect(fullTranslationSection).toContain('v-if="readerFullTranslationMode !== \'no\'"')
    expect(fullTranslationSection).not.toContain('v-model="transProvider"')
    expect(fullTranslationSection).not.toContain('translators.providers')
    expect(fullTranslationSection).toContain('v-model="transTarget"')
    expect(fullTranslationSection).toContain('transLanguages')
    expect(fullTranslationSection).toContain('fullTranslationLoading')
    expect(fullTranslationSection).toContain('fullTranslationError')

    expect(popupSource).toContain('v-model="transProvider"')
    expect(popupSource).toContain('v-model="transTarget"')
  })

  it('uses a compact inline status for full text translation loading', () => {
    const source = readFileSync(resolve(__dirname, '../../layout/BookReaderModal.vue'), 'utf8')
    const fullTranslationSection = sliceBetween(source, "<div class=\"setting-section-title\">{{ t('full.text.translation') }} <span class=\"pro-pill\">Pro</span></div>", '<!-- Toggle Switches')

    expect(source).toContain('LoaderCircle,')
    expect(fullTranslationSection).toContain('class="full-translation-status"')
    expect(fullTranslationSection).toContain('class="full-translation-spinner"')
    expect(fullTranslationSection).toContain('<LoaderCircle v-if="fullTranslationLoading" class="full-translation-spinner" :size="12"')
    expect(fullTranslationSection).not.toContain('<a-spin')
    expect(fullTranslationSection).not.toContain('style="font-size: 11px')
  })
})
