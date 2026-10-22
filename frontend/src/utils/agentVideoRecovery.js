const failedStates = new Set(['failed', 'canceled', 'cancelled', 'aborted', 'expired'])

// Only a confirmed terminal provider response may unlock a submitted, billable task.
export function recoverAgentVideoDraft(message, taskId, task) {
  if (!taskId || !failedStates.has(String(task?.status || '').toLowerCase()) ||
      message?.agentDraft?.generationType !== 'video') return message
  const draft = message.agentDraft
  const recover = (item) => item?.status === 'submitted' && item.taskId === taskId
    ? { ...item, status: 'failed', failureMessage: String(task.error || '视频生成失败') }
    : item
  if (Array.isArray(draft.items)) {
    const items = draft.items.map(recover)
    return items.some((item, index) => item !== draft.items[index])
      ? { ...message, agentDraft: { ...draft, items } } : message
  }
  const recovered = recover(draft)
  return recovered === draft ? message : { ...message, agentDraft: recovered }
}

export async function recoverFailedAgentVideoDrafts(messages, fetchTask) {
  const candidates = new Set()
  const failedReceipts = new Set(messages.filter(message => message.role === 'assistant' &&
    message.videoGeneration && message.failed && !message.generating && !message.videoUrl && message.taskId)
    .map(message => message.taskId))
  for (const message of messages) {
    if (message?.agentDraft?.generationType !== 'video') continue
    for (const item of message.agentDraft.items || [message.agentDraft]) {
      if (item.status === 'submitted' && failedReceipts.has(item.taskId)) candidates.add(item.taskId)
    }
  }
  const results = await Promise.allSettled([...candidates].map(async taskId => ({ taskId, task: await fetchTask(taskId) })))
  let recovered = messages
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const { taskId, task } = result.value
    recovered = recovered.map(message => recoverAgentVideoDraft(message, taskId, task))
  }
  return recovered
}
