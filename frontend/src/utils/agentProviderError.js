export const AGENT_PROVIDER_BLOCKED_MESSAGE =
  '模型通道的内容审核拦截了本次请求，没有返回分析结果。原输入和素材已保留；通道未说明具体触发原因。'

export function isProviderRejectionText(value) {
  const text = String(value || '').trim().replace(/^error:\s*/i, '').toLowerCase()
  return text.startsWith('the prompt could not be submitted') &&
    (text.includes('sensitive words') || text.includes('generative ai prohibited use policy'))
}

export function agentProviderRejection(value) {
  if (!value || typeof value !== 'object') return isProviderRejectionText(value)
  const texts = [value.text, value.reply, value.prompt, value.draftPrompt,
    ...(Array.isArray(value.prompts) ? value.prompts : []),
    ...(Array.isArray(value.draftPrompts) ? value.draftPrompts : []),
    ...(Array.isArray(value.items) ? value.items.map(item => item?.prompt) : [])]
  return texts.some(isProviderRejectionText) ||
    (value.agentDraft ? agentProviderRejection(value.agentDraft) : false)
}

export function requireAgentResult(value) {
  if (agentProviderRejection(value)) {
    const error = new Error(AGENT_PROVIDER_BLOCKED_MESSAGE)
    error.code = 'PROVIDER_CONTENT_BLOCKED'
    throw error
  }
  return value
}
