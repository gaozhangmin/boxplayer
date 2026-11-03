import type { ZodType } from 'zod'

export type AgentSurface = 'ai_search' | 'workspace' | 'reader' | 'document'
/** `unknown` is never declared by a tool: it marks an undeclared, unrecognized tool, which is approved like a write. */
export type AgentPermission = 'read' | 'navigate' | 'write' | 'destructive' | 'unknown'
export type AgentApprovalPermission = Extract<AgentPermission, 'write' | 'destructive' | 'unknown'>
export type AgentExecutionMode = 'parallel' | 'sequential'
export type AgentMessageInput = { role: 'user' | 'assistant'; content: string }

export interface AgentToolExecutionContext {
  toolCallId: string
  signal?: AbortSignal
  reportProgress: (progress: unknown) => void
}

export interface BoxPlayerAgentModelConfig {
  endpoint: string
  modelId: string
  apiKey: string
  providerName: string
}

/** Stable public configuration for every BoxPlayer PI Agent session. */
export interface AgentSessionConfig {
  surface: AgentSurface
  session?: { id?: string; messages?: AgentMessageInput[] }
  model: BoxPlayerAgentModelConfig
  systemPrompt: string
  /** Trusted application metadata only. Never place document or user text here. */
  context?: Record<string, unknown>
  /** User-controlled or retrieved data, appended as data to the user turn. */
  untrustedContext?: Record<string, unknown>
  toolAllowlist?: string[]
  /** Global scheduling mode for one Agent turn. Media acquisition needs strict observe-act-verify ordering. */
  toolExecution?: AgentExecutionMode
  maxTurns?: number
  maxToolCalls?: number
  /** Enforce observe-act sequencing even when a compatible model emits a tool batch. */
  maxToolCallsPerTurn?: number
  /** Require a tool action instead of accepting a prose-only turn. */
  requireToolCall?: boolean
  /** After an observation succeeds, expose only the tools that can conclude that decision. */
  terminalToolsAfterObservation?: { observationTools: string[]; terminalTools: string[] }
  /** Abort a tool loop when the same tool is called with the same input too many times. */
  maxRepeatedToolCalls?: number
  /** Idempotent context tools that should not contribute to the repeated-action fuse. */
  repeatedToolCallExemptions?: string[]
  maxContextChars?: number
}

export interface AgentTool {
  /** The registration key is the canonical name when tools are supplied as a record. */
  name?: string
  description: string
  inputSchema: ZodType
  /** Every registered tool must declare this; an undeclared tool needs approval before it runs. */
  permission?: Exclude<AgentPermission, 'unknown'>
  executionMode?: AgentExecutionMode
  /** Keep a structured `{ error }` result in the model context instead of throwing the tool call. */
  allowErrorResult?: boolean
  execute: (args: any, context?: AgentToolExecutionContext) => Promise<unknown> | unknown
}

/** @deprecated Use AgentTool. Kept while existing surfaces migrate their registrations. */
export type BoxPlayerAgentTool = AgentTool

export interface ApprovalRequest {
  toolCallId: string
  toolName: string
  permission: AgentApprovalPermission
  args: unknown
  argsSummary: string
  risk: string
  /** SHA-256 hash of the tool name and canonicalized arguments; valid for this call only. */
  approvalHash: string
}

/** @deprecated Use ApprovalRequest. */
export type AgentApprovalRequest = ApprovalRequest

export interface Citation {
  sourceId: string
  sourceFile: string
  section?: string
  page?: number
  location?: string
  startChar?: number
  endChar?: number
  text: string
}

export interface AgentUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cost?: number
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_progress'; toolCallId: string; toolName: string; progress: unknown }
  | { type: 'tool_complete'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'approval_required'; request: ApprovalRequest }
  | { type: 'citation'; citation: Citation }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'turn_end' }
  | { type: 'error'; message: string }
  | { type: 'end' }

/** @deprecated Use AgentEvent. */
export type BoxPlayerAgentEvent = AgentEvent
