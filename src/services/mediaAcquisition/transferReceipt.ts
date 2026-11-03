import type { AgentReceiptStatus } from '@shared/types/agentControl'

/**
 * Maps a transferCandidate tool result to the Agent V1 receipt it should leave.
 * Videos already in staging prove the transfer worked; an accepted task that has not landed is still running at the provider.
 */
export function mediaTransferReceiptOutcome(result: unknown): { status: AgentReceiptStatus; message: string } {
  const value = (result && typeof result === 'object' ? result : {}) as { submitted?: unknown; error?: unknown; staging?: { primaryVideos?: unknown[] } }
  if (value.submitted === true) {
    return value.staging?.primaryVideos?.length
      ? { status: 'succeeded', message: '网盘转存已落盘，等待整理核验' }
      : { status: 'pending', message: '网盘转存已提交，等待落盘核验' }
  }
  const error = String(value.error || '网盘未提交候选转存')
  // The provider may have accepted the transfer even though BoxPlayer never saw it take over the candidate.
  if (error.startsWith('SANDBOX_TRANSFER_NOT_CLAIMED')) return { status: 'unknown', message: error }
  return { status: 'failed', message: error }
}
