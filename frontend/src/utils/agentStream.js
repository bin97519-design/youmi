import { agentProviderRejection, requireAgentResult, AGENT_PROVIDER_BLOCKED_MESSAGE } from './agentProviderError.js'

export const AGENT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

export function recoverInterruptedAgentMessage(message, now = Date.now()) {
  if ((message?.agent || message?.agentConversationId) && message.role === 'assistant' && agentProviderRejection(message))
    return { ...message, generating: false, failed: true, agentDraft: null,
      agentFailureCode: 'PROVIDER_CONTENT_BLOCKED', text: AGENT_PROVIDER_BLOCKED_MESSAGE }
  if (!message?.agent || message.role !== 'assistant' || !message.generating ||
      !message.createdAt || now - Number(message.createdAt) < AGENT_REQUEST_TIMEOUT_MS + 60000) return message
  return { ...message, generating: false, failed: true,
    text: '上次回复连接已中断，未保存完整结果。原输入和参考图已保留。' }
}

export async function readAgentStream(response, onEvent, readApiResponse) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (!response.ok || (contentType.includes('application/json') && !contentType.includes('ndjson')))
    return requireAgentResult(await readApiResponse(response))
  if (!response.body) throw new Error('回复连接未建立')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', result, finished = false
  const consume = (line) => {
    if (!line.trim()) return
    const event = JSON.parse(line)
    if (event.type === 'error') {
      const error = new Error(event.message || 'Agent 回复失败')
      error.code = event.code
      throw error
    }
    if (event.type === 'result') result = event.data
    else onEvent?.(event)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) consume(line)
      if (done) break
    }
    if (buffer.trim()) consume(buffer)
    if (!result) throw new Error('回复连接已中断，未收到完整方案；已显示的内容可保留参考')
    finished = true
    return requireAgentResult(result)
  } finally {
    if (!finished) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
