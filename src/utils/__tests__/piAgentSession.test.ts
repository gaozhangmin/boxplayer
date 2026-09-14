import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { addAgentFeatureToPayload } from '../../services/agent/model'
import { formatAgentModelError, inferToolPermission, isLeakedAgentContext, runBoxPlayerAgent, shouldStopForRepeatedAgentToolSteps, toPiMessages, toPiTools } from '../../services/agent/session'

const { streamOpenAICompletions } = vi.hoisted(() => ({
  streamOpenAICompletions: vi.fn()
}))

vi.mock('@earendil-works/pi-ai/api/openai-completions', () => ({
  stream: streamOpenAICompletions
}))

function assistantMessage(content: any[], stopReason: 'toolUse' | 'stop') {
  return {
    role: 'assistant' as const,
    content,
    api: 'openai-completions' as const,
    provider: 'fake',
    model: 'fake',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: Date.now()
  }
}

describe('BoxPlayer PI Agent runtime', () => {
  it('adds the server-side feature without losing the OpenAI payload', () => {
    expect(addAgentFeatureToPayload({ model: 'deepseek/deepseek-v4-pro', stream: true }, 'document')).toEqual({
      model: 'deepseek/deepseek-v4-pro',
      stream: true,
      feature: 'document_analysis'
    })
  })

  it('forces write and destructive tools to execute sequentially', () => {
    expect(inferToolPermission('searchMyFiles')).toBe('read')
    expect(inferToolPermission('moveFiles')).toBe('write')
    expect(inferToolPermission('deleteFiles')).toBe('destructive')
  })

  it('maps a body-less cloud model error before emitting it to a surface', () => {
    expect(formatAgentModelError({ endpoint: '', modelId: 'cloud', apiKey: '', providerName: 'boxplayer-cloud' }, '500 status code (no body)')).toContain('模型服务执行失败')
  })

  it('rejects after reporting a model failure so visible surfaces can stop loading and show its cause', async () => {
    const events: any[] = []
    await expect(runBoxPlayerAgent({
      surface: 'document',
      model: { endpoint: '', modelId: 'cloud', apiKey: '', providerName: 'boxplayer-cloud' },
      systemPrompt: 'Answer from the document.',
      prompt: '总结文档',
      streamFn: () => { throw new Error('500 status code (no body)') },
      onEvent: event => { events.push(event) }
    })).rejects.toThrow('模型服务执行失败')
    expect(events).toContainEqual({ type: 'error', message: expect.stringContaining('模型服务执行失败') })
  })

  it('stops only repeated action-observation pairs, including A/B ping-pong', () => {
    expect(shouldStopForRepeatedAgentToolSteps(['inspect\u0000{}\u0000{"files":1}', 'inspect\u0000{}\u0000{"files":2}', 'inspect\u0000{}\u0000{"files":3}', 'inspect\u0000{}\u0000{"files":4}'], 4)).toBe(false)
    expect(shouldStopForRepeatedAgentToolSteps(Array(4).fill('inspect\u0000{}\u0000{"files":1}'), 4)).toBe(true)
    expect(shouldStopForRepeatedAgentToolSteps(['a\u0000{}\u00001', 'b\u0000{}\u00002', 'a\u0000{}\u00001', 'b\u0000{}\u00002', 'a\u0000{}\u00001', 'b\u0000{}\u00002'], 4)).toBe(true)
  })

  it('adapts existing Zod tools to PI Agent tools', async () => {
    const execute = vi.fn().mockResolvedValue({ count: 2 })
    const [tool] = toPiTools({
      searchMyFiles: {
        description: 'Search files',
        inputSchema: z.object({ keyword: z.string() }),
        execute
      }
    })

    expect(tool.name).toBe('searchMyFiles')
    expect(tool.executionMode).toBe('parallel')
    const result = await tool.execute('call-1', { keyword: 'movie' } as any)
    expect(execute).toHaveBeenCalledWith({ keyword: 'movie' }, expect.objectContaining({ reportProgress: expect.any(Function) }))
    expect(result.content).toEqual([{ type: 'text', text: '<tool-result trust="untrusted">{"count":2}</tool-result>' }])
    expect(result.details).toEqual({ count: 2 })
  })

  it('forwards cancellation and progress, and turns structured tool failures into PI errors', async () => {
    const progress = vi.fn()
    const controller = new AbortController()
    const [tool] = toPiTools({
      scan: {
        description: 'Scan files',
        inputSchema: z.object({}),
        execute: (_args, context) => {
          context?.reportProgress({ phase: 'listing', current: 1 })
          expect(context?.signal).toBe(controller.signal)
          return { error: 'provider unavailable' }
        }
      }
    })

    await expect(tool.execute('scan-1', {}, controller.signal, progress)).rejects.toThrow('provider unavailable')
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ details: { phase: 'listing', current: 1 } }))
  })

  it('can retain a structured tool error as Agent evidence when requested', async () => {
    const [tool] = toPiTools({
      inspectTargetDir: {
        description: 'Inspect target directory',
        inputSchema: z.object({}),
        allowErrorResult: true,
        execute: () => ({ error: 'temporary provider failure' })
      }
    })

    await expect(tool.execute('inspect-1', {} as any)).resolves.toEqual(expect.objectContaining({ details: { error: 'temporary provider failure' } }))
  })

  it('converts persisted UI history into PI-compatible messages', () => {
    const messages = toPiMessages([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' },
      { role: 'assistant', content: '   ' }
    ], {
      endpoint: 'https://example.com/v1',
      modelId: 'model',
      apiKey: 'key',
      providerName: 'test'
    })

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
  })

  it('drops leaked assistant prompt text from future agent context', () => {
    const model = { endpoint: 'https://example.com/v1', modelId: 'model', apiKey: 'key', providerName: 'test' }
    const leaked = 'Please refer to the above schema and always prefix your tool calls with <<|place__holder|>tool_calls>'

    expect(isLeakedAgentContext(leaked)).toBe(true)
    expect(toPiMessages([{ role: 'user', content: '分析存储空间' }, { role: 'assistant', content: leaked }], model)).toHaveLength(1)
  })

  it('does not trust a restored raw PI transcript', () => {
    const restored = [
      { role: 'user', content: '选择候选', timestamp: 1 },
      assistantMessage([{ type: 'toolCall', id: 'candidate-1', name: 'listCandidates', arguments: {} }], 'toolUse'),
      { role: 'toolResult', toolCallId: 'candidate-1', toolName: 'listCandidates', content: [{ type: 'text', text: '{"snapshotId":"snapshot-1"}' }], timestamp: 2 }
    ]

    expect(toPiMessages([], { endpoint: '', modelId: 'model', apiKey: '', providerName: 'test' }, restored)).toEqual([])
  })

  it('runs the PI tool loop with a fake model and streams the final answer', async () => {
    const execute = vi.fn().mockResolvedValue({ matches: 1 })
    const events: any[] = []
    let call = 0

    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: { endpoint: 'https://example.com/v1', modelId: 'fake', apiKey: 'key', providerName: 'fake' },
      systemPrompt: 'Use tools.',
      prompt: 'Find a file',
      tools: {
        searchMyFiles: {
          description: 'Search files',
          inputSchema: z.object({ keyword: z.string() }),
          execute
        }
      },
      streamFn: () => {
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          if (call++ === 0) {
            stream.push({ type: 'done', reason: 'toolUse', message: assistantMessage([{ type: 'toolCall', id: 'call-1', name: 'searchMyFiles', arguments: { keyword: 'movie' } }], 'toolUse') })
          } else {
            const started = assistantMessage([], 'stop')
            const partial = assistantMessage([{ type: 'text', text: '找到 1 个文件' }], 'stop')
            stream.push({ type: 'start', partial: started })
            stream.push({ type: 'text_start', contentIndex: 0, partial: assistantMessage([{ type: 'text', text: '' }], 'stop') })
            stream.push({ type: 'text_delta', contentIndex: 0, delta: '找到 1 个文件', partial })
            stream.push({ type: 'text_end', contentIndex: 0, content: '找到 1 个文件', partial })
            stream.push({ type: 'done', reason: 'stop', message: partial })
          }
        })
        return stream
      },
      onEvent: event => { events.push(event) }
    })

    expect(execute).toHaveBeenCalledWith({ keyword: 'movie' }, expect.objectContaining({ reportProgress: expect.any(Function) }))
    expect(events).toContainEqual({ type: 'text_delta', text: '找到 1 个文件' })
    expect(events.some(event => event.type === 'tool_start' && event.toolName === 'searchMyFiles')).toBe(true)
  })

  it('enforces one tool call per turn for observe-act workflows', async () => {
    const inspect = vi.fn().mockResolvedValue({ snapshotId: 'snapshot-1' })
    const extraInspect = vi.fn().mockResolvedValue({ files: [] })
    let call = 0

    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: { endpoint: 'https://example.com/v1', modelId: 'fake', apiKey: 'key', providerName: 'fake' },
      systemPrompt: 'Observe, then act.',
      prompt: 'Choose a resource',
      maxToolCallsPerTurn: 1,
      tools: {
        viewResourceSnapshot: { description: 'View candidates', inputSchema: z.object({}), execute: inspect },
        inspectTargetDir: { description: 'Inspect target', inputSchema: z.object({}), execute: extraInspect }
      },
      streamFn: () => {
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          if (call++ === 0) {
            stream.push({ type: 'done', reason: 'toolUse', message: assistantMessage([
              { type: 'toolCall', id: 'snapshot-1', name: 'viewResourceSnapshot', arguments: {} },
              { type: 'toolCall', id: 'target-1', name: 'inspectTargetDir', arguments: {} }
            ], 'toolUse') })
          } else {
            stream.push({ type: 'done', reason: 'stop', message: assistantMessage([{ type: 'text', text: 'done' }], 'stop') })
          }
        })
        return stream
      }
    })

    expect(inspect).toHaveBeenCalledOnce()
    expect(extraInspect).not.toHaveBeenCalled()
  })

  it('can require a tool action while disabling parallel tool batches', async () => {
    let capturedPayload: unknown

    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: { endpoint: 'https://example.com/v1', modelId: 'fake', apiKey: 'key', providerName: 'fake' },
      systemPrompt: 'Act with one tool.',
      prompt: 'Choose a resource',
      maxToolCallsPerTurn: 1,
      requireToolCall: true,
      tools: {
        reportNoCoverage: { description: 'Stop', inputSchema: z.object({}), execute: () => ({ noCoverage: true }) }
      },
      shouldStopAfterToolResult: ({ toolName }) => toolName === 'reportNoCoverage' ? 'done' : undefined,
      streamFn: (_model, _context, options) => {
        capturedPayload = options?.onPayload?.({ model: 'fake', stream: true }, _model)
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => stream.push({ type: 'done', reason: 'toolUse', message: assistantMessage([{ type: 'toolCall', id: 'stop-1', name: 'reportNoCoverage', arguments: {} }], 'toolUse') }))
        return stream
      }
    })

    expect(capturedPayload).toEqual(expect.objectContaining({ feature: 'ai_search', parallel_tool_calls: false, tool_choice: 'required' }))
  })

  it('exposes only terminal decision tools after a candidate observation', async () => {
    const payloadTools: string[][] = []
    let call = 0

    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: { endpoint: 'https://example.com/v1', modelId: 'fake', apiKey: 'key', providerName: 'fake' },
      systemPrompt: 'Observe and decide.',
      prompt: 'Choose a resource',
      requireToolCall: true,
      terminalToolsAfterObservation: {
        observationTools: ['viewResourceSnapshot'],
        terminalTools: ['transferCandidate', 'reportNoCoverage']
      },
      tools: {
        readSkill: { description: 'Read', inputSchema: z.object({}), execute: () => ({ body: 'rules' }) },
        viewResourceSnapshot: { description: 'Observe', inputSchema: z.object({}), execute: () => ({ snapshotId: 'snapshot-1' }) },
        transferCandidate: { description: 'Transfer', inputSchema: z.object({}), execute: () => ({ submitted: true }) },
        reportNoCoverage: { description: 'Stop', inputSchema: z.object({}), execute: () => ({ noCoverage: true }) }
      },
      shouldStopAfterToolResult: ({ toolName }) => toolName === 'transferCandidate' ? 'done' : undefined,
      streamFn: (_model, _context, options) => {
        const payload = options?.onPayload?.({
          model: 'fake',
          stream: true,
          tools: ['readSkill', 'viewResourceSnapshot', 'transferCandidate', 'reportNoCoverage'].map(name => ({ type: 'function', function: { name } }))
        }, _model) as any
        payloadTools.push(payload.tools.map((tool: any) => tool.function.name))
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          const toolCall = call++ === 0
            ? { type: 'toolCall', id: 'observe-1', name: 'viewResourceSnapshot', arguments: {} }
            : { type: 'toolCall', id: 'transfer-1', name: 'transferCandidate', arguments: {} }
          stream.push({ type: 'done', reason: 'toolUse', message: assistantMessage([toolCall], 'toolUse') })
        })
        return stream
      }
    })

    expect(payloadTools[0]).toEqual(['readSkill', 'viewResourceSnapshot', 'transferCandidate', 'reportNoCoverage'])
    expect(payloadTools[1]).toEqual(['transferCandidate', 'reportNoCoverage'])
  })

  it('uses the browser-safe OpenAI stream when no stream function is supplied', async () => {
    const events: any[] = []
    streamOpenAICompletions.mockImplementation(() => {
      const stream = createAssistantMessageEventStream()
      queueMicrotask(() => {
        const partial = assistantMessage([{ type: 'text', text: '工作台已就绪' }], 'stop')
        stream.push({ type: 'start', partial })
        stream.push({ type: 'text_delta', contentIndex: 0, delta: '工作台已就绪', partial })
        stream.push({ type: 'done', reason: 'stop', message: partial })
      })
      return stream
    })

    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: { endpoint: 'https://example.com/v1', modelId: 'fake', apiKey: 'key', providerName: 'fake' },
      systemPrompt: 'Respond briefly.',
      prompt: 'hello',
      onEvent: event => { events.push(event) }
    })

    expect(streamOpenAICompletions).toHaveBeenCalledOnce()
    expect(events).toContainEqual({ type: 'text_delta', text: '工作台已就绪' })
  })

  it('requires an approval event with a one-time argument hash before a write tool runs', async () => {
    const execute = vi.fn().mockResolvedValue('moved')
    const events: any[] = []
    const requestApproval = vi.fn().mockResolvedValue(true)
    let call = 0

    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: { endpoint: 'https://example.com/v1', modelId: 'fake', apiKey: 'key', providerName: 'fake' },
      systemPrompt: 'Use tools.',
      prompt: 'Move the file',
      tools: {
        moveFiles: { description: 'Move files', inputSchema: z.object({ target: z.string() }), permission: 'write', execute }
      },
      requestApproval,
      streamFn: () => {
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          if (call++ === 0) stream.push({ type: 'done', reason: 'toolUse', message: assistantMessage([{ type: 'toolCall', id: 'move-1', name: 'moveFiles', arguments: { target: '/Movies' } }], 'toolUse') })
          else stream.push({ type: 'done', reason: 'stop', message: assistantMessage([{ type: 'text', text: '完成' }], 'stop') })
        })
        return stream
      },
      onEvent: event => { events.push(event) }
    })

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval_required', request: expect.objectContaining({ toolName: 'moveFiles', risk: expect.any(String), approvalHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) }))
    expect(execute).toHaveBeenCalledWith({ target: '/Movies' }, expect.objectContaining({ reportProgress: expect.any(Function) }))
  })
})
