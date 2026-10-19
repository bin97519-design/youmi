const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value) => (typeof value === 'string' ? value.trim() : '')
const identifier = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

function timestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const source = text(value)
  if (!source) return null
  if (/^[+-]?\d+(?:\.\d+)?$/.test(source)) {
    const numeric = Number(source)
    return Number.isFinite(numeric) ? numeric : null
  }
  const parsed = Date.parse(source)
  return Number.isFinite(parsed) ? parsed : null
}

function hasUserContent(message) {
  return (
    [message.content, message.display, message.raw].some(text) ||
    [message.parts, message.attachments].some((items) => Array.isArray(items) && items.length > 0)
  )
}

function hasAssistantContent(run) {
  if (!isRecord(run) || !identifier(run.id)) return false
  if ([run.reply, run.error, run.thinkingText].some(text)) return true
  if ([run.questions, run.thinking].some((items) => Array.isArray(items) && items.length > 0))
    return true
  for (const draft of [run.draft, run.proposal]) {
    if (!isRecord(draft)) continue
    if (text(draft.prompt) || (Array.isArray(draft.prompts) && draft.prompts.some(text)))
      return true
  }
  return ['planning', 'streaming', 'submitting', 'submitted'].includes(run.phase)
}

/** Server-scoped lists can omit canvasId; explicit foreign-canvas rows never restore. */
export function latestDirectorConversation(conversations, canvasId) {
  const requestedCanvas = identifier(canvasId)
  let latest = null
  let latestTimestamp = null
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    if (!isRecord(conversation) || !identifier(conversation.id)) continue
    const conversationCanvas = identifier(conversation.canvasId)
    if (conversationCanvas && requestedCanvas && conversationCanvas !== requestedCanvas) continue
    const messages = Array.isArray(conversation.messages) ? conversation.messages : []
    const displayable = messages.some(
      (message) =>
        isRecord(message) &&
        ((message.role === 'user' && hasUserContent(message)) ||
          (message.role === 'assistant' && hasAssistantContent(message.run))),
    )
    if (!displayable) continue
    const updated = timestamp(conversation.updatedAt) ?? timestamp(conversation.createdAt)
    if (!latest || (updated !== null && (latestTimestamp === null || updated > latestTimestamp))) {
      latest = conversation
      latestTimestamp = updated
    }
  }
  return latest
}

/** Keep rich original messages and clarification metadata when the panel remounts. */
export function directorMessagesFromRuns(runs) {
  const messages = []
  const indexById = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!isRecord(run) || run.role) continue
    const original = isRecord(run.message) ? run.message : null
    const originalId = identifier(original?.id)
    const id = originalId || identifier(run.clientMessageId) || identifier(run.id)
    if (!id) continue
    const message = originalId
      ? { ...original, id }
      : {
          ...(original || {}),
          id,
          content: original?.content ?? run.instruction ?? run.display ?? '',
          display: original?.display ?? run.display ?? original?.content ?? run.instruction ?? '',
          raw: original?.raw ?? run.instruction ?? original?.content ?? run.display ?? '',
          parts: Array.isArray(original?.parts) ? original.parts : [],
          dryRunIntent: original?.dryRunIntent ?? run.dryRun !== false,
          context: isRecord(original?.context) ? original.context : {},
        }
    const previousIndex = indexById.get(id)
    if (previousIndex === undefined) {
      indexById.set(id, messages.length)
      messages.push(message)
    } else {
      messages.splice(previousIndex, 1, message)
    }
  }
  return messages
}

/** Saving replies must not erase restored user turns that never received a run. */
export function mergeDirectorConversationMessages(originalUserMessages, pairs) {
  const pairEntries = []
  const pairIndexById = new Map()
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(pair) || !isRecord(pair[0]) || (pair[0].role && pair[0].role !== 'user'))
      continue
    const user = { ...pair[0] }
    const id = identifier(user.id)
    if (id) user.id = id
    const entry = { user, assistant: isRecord(pair[1]) ? { ...pair[1] } : null, id }
    const previousIndex = id ? pairIndexById.get(id) : undefined
    if (previousIndex === undefined) {
      if (id) pairIndexById.set(id, pairEntries.length)
      pairEntries.push(entry)
    } else {
      pairEntries.splice(previousIndex, 1, entry)
    }
  }

  const originalUsers = []
  const originalIndexById = new Map()
  for (const message of Array.isArray(originalUserMessages) ? originalUserMessages : []) {
    if (!isRecord(message) || (message.role && message.role !== 'user')) continue
    const user = { ...message }
    const id = identifier(user.id)
    if (id) user.id = id
    const previousIndex = id ? originalIndexById.get(id) : undefined
    if (previousIndex === undefined) {
      if (id) originalIndexById.set(id, originalUsers.length)
      originalUsers.push(user)
    } else {
      originalUsers.splice(previousIndex, 1, user)
    }
  }

  const result = []
  const consumed = new Set()
  for (const original of originalUsers) {
    const pairIndex = pairIndexById.get(identifier(original.id))
    if (pairIndex === undefined) {
      result.push(original)
      continue
    }
    const entry = pairEntries[pairIndex]
    const newFields = Object.fromEntries(
      Object.entries(entry.user).filter(([, value]) => value !== undefined),
    )
    result.push({ ...original, ...newFields })
    if (entry.assistant) result.push(entry.assistant)
    consumed.add(pairIndex)
  }
  for (const [index, entry] of pairEntries.entries()) {
    if (consumed.has(index)) continue
    result.push(entry.user)
    if (entry.assistant) result.push(entry.assistant)
  }
  return result
}
