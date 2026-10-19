function directorRunMessageKey(run) {
  return String(run?.clientMessageId || run?.message?.id || '').trim()
}

/**
 * A Director turn has exactly one current Agent run. Older clients could persist
 * more than one assistant run for the same user message, so keep the newest
 * record while preserving the original turn position.
 */
export function dedupeDirectorAgentRuns(runs) {
  const result = []
  const indexByKey = new Map()

  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run !== 'object') continue
    const messageKey = directorRunMessageKey(run)
    const runId = String(run.id || '').trim()
    const key = messageKey ? `message:${messageKey}` : runId ? `run:${runId}` : ''

    if (!key) {
      result.push(run)
      continue
    }

    const previousIndex = indexByKey.get(key)
    if (previousIndex === undefined) {
      indexByKey.set(key, result.length)
      result.push(run)
    } else {
      result.splice(previousIndex, 1, run)
    }
  }

  return result
}

/** Questionnaire answers belong to the inline record, not a second user bubble. */
export function directorConversationItems(messages, runs) {
  const items = []
  const agentRuns = dedupeDirectorAgentRuns(runs)
  const runsByMessageId = new Map(
    agentRuns
      .filter((run) => directorRunMessageKey(run))
      .map((run) => [directorRunMessageKey(run), run]),
  )
  const renderedRuns = new Set()
  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    if (!message?.context?.clarification?.sourceRunId)
      items.push({ type: 'user', key: message?.id || `user-${index}`, message })
    const run = message?.id ? runsByMessageId.get(message.id) : null
    if (run) {
      items.push({ type: 'agent', key: run.id, run })
      renderedRuns.add(run.id)
    }
  }
  for (const run of agentRuns)
    if (!renderedRuns.has(run.id)) items.push({ type: 'agent', key: run.id, run })
  return items
}

export function directorRunDisplayText(run) {
  const draft = run?.draft || run?.proposal
  const prompts = Array.isArray(draft?.prompts) ? draft.prompts : [draft?.prompt]
  return [
    ...new Set([run?.reply, ...prompts].map((text) => String(text || '').trim()).filter(Boolean)),
  ].join('\n\n')
}

/** Explicitly uploaded clarification media may extend references, never paid parameters. */
export function directorClarificationAssetsIntent(intent, additions) {
  const added = (Array.isArray(additions) ? additions : []).filter(
    (asset) => asset?.url && (asset.layerId || asset.id),
  )
  if (!added.length) return intent
  const merge = (assets) =>
    Object.freeze(
      [...new Map(assets.map((asset) => [asset.layerId || asset.id, asset])).values()].map(
        (asset) => Object.freeze({ ...asset }),
      ),
    )
  return Object.freeze({
    ...intent,
    attachments: merge([...(intent.attachments || []), ...added]),
    referenceAssets: merge([
      ...(intent.referenceAssets || []),
      ...added.filter((asset) => asset.kind === 'image'),
    ]),
    referenceLayerIds: Object.freeze([
      ...new Set([
        ...(intent.referenceLayerIds || []),
        ...added.map((asset) => asset.layerId || asset.id),
      ]),
    ]),
  })
}

/** Retain questions and full drafts so the next turn can continue the actual work. */
export function directorRunReplyContext(run) {
  const questions = (Array.isArray(run?.questions) ? run.questions : [])
    .map((question) => {
      const title = String(question?.question || '').trim()
      if (!title) return ''
      const options = (Array.isArray(question.options) ? question.options : [])
        .map((option) => String(option || '').trim())
        .filter(Boolean)
      return options.length ? `${title}\n可选方向：${options.join('；')}` : title
    })
    .filter(Boolean)
  const draft = run?.draft || run?.proposal
  const drafts = Array.isArray(draft?.prompts) ? draft.prompts : draft?.prompt ? [draft.prompt] : []
  return [
    String(run?.reply || '').trim(),
    questions.length ? `本轮提出的需求问题：\n${questions.join('\n\n')}` : '',
    drafts.length ? `本轮完整创作草稿：\n${drafts.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Clarification continues from the submitted media snapshot, even after a node changes. */
export function directorRequestContextLayers(currentLayers, intent) {
  const layers = (Array.isArray(currentLayers) ? currentLayers : []).map((layer) => ({ ...layer }))
  const indexById = new Map(layers.map((layer, index) => [layer.id, index]))
  const references = [
    ...(Array.isArray(intent?.referenceAssets) ? intent.referenceAssets : []),
    ...(Array.isArray(intent?.attachments) ? intent.attachments : []),
  ]
  for (const reference of references) {
    const id = String(reference?.layerId || reference?.id || '').trim()
    if (!id || !reference.url) continue
    const index = indexById.get(id)
    const current = index === undefined ? null : layers[index]
    const unchanged = current?.url === reference.url
    const layer = {
      id,
      name: reference.name || current?.name || '参考素材',
      type: reference.kind || current?.type || 'image',
      url: reference.url,
      width: unchanged ? current.width : null,
      height: unchanged ? current.height : null,
      x: current?.x || 0,
      y: current?.y || 0,
    }
    if (index === undefined) {
      indexById.set(id, layers.length)
      layers.push(layer)
    } else {
      layers.splice(index, 1, layer)
    }
  }
  return intent?.imageSourceMode === 'text'
    ? layers.map((layer) => (layer.type === 'image' ? { ...layer, url: '' } : layer))
    : layers
}
