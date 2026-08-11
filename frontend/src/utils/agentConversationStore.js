export function partitionConversationMessages(messages, activeConversationId = '') {
  const regularMessages = []
  const agentMessagesById = new Map()

  for (const message of Array.isArray(messages) ? messages : []) {
    const conversationId = String(
      message?.agentConversationId || (message?.agent ? activeConversationId : ''),
    ).trim()
    if (!conversationId) {
      regularMessages.push(message)
      continue
    }
    const group = agentMessagesById.get(conversationId) || []
    group.push({ ...message, agent: true, agentConversationId: conversationId })
    agentMessagesById.set(conversationId, group)
  }

  return { regularMessages, agentMessagesById }
}

export function stripAgentMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => !message?.agent && !message?.agentConversationId,
  )
}
