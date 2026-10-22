import { imageEditTemplate } from '../config/imageEditPresets.js'
import { IMAGE_TASK_ACTIVE_STATES } from '../config/imageTaskState.js'

export const imageSourceId = (node) =>
  node.data.sourceImageNodeId || node.data.editTemplate?.sourceNodeId

export function imageReferences(node, nodes, edges, { draft = false, strict = false } = {}) {
  const sourceId = imageSourceId(node)
  const source = sourceId ? nodes.find((item) => item.id === sourceId) : null
  if (strict && sourceId && (sourceId === node.id || !source?.data.assetUrl))
    throw new Error('原参考图片已移除或不可用，请重新连接参考图；未提交生成任务')
  const incoming = edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => nodes.find((item) => item.id === edge.source))
    .filter(Boolean)
  // The module can be configured on an uploaded image before its output exists.
  const current = draft && node.data.assetUrl && !sourceId ? [node] : []
  return [
    ...new Map(
      [...current, ...(source ? [source] : []), ...incoming].map((n) => [n.id, n]),
    ).values(),
  ]
}

function unresolved(node) {
  return (
    IMAGE_TASK_ACTIVE_STATES.includes(node.data.runState) ||
    ['paused', 'uncertain'].includes(node.data.runState) ||
    node.data.generation?.unresolvedTaskIds?.length
  )
}

// Repair legacy in-place jobs without changing their provider task/client IDs.
// Moving ownership is not a new submission; keep querying the original request.
export function preserveLegacyImageTask(graph, nodeId) {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (
    node?.data.kind !== 'image' ||
    !node?.data.assetUrl ||
    imageSourceId(node) ||
    !node.data.generation?.clientTaskId ||
    !['submitting', 'queued', 'running', 'paused', 'uncertain'].includes(node.data.runState) ||
    node.data.generation.results?.includes(node.data.assetUrl)
  )
    return node
  const { runState, generation, progress, statusText, error, consumedMi } = node.data
  const output = graph.createImageVariation(node.id, {
    title: imageEditTemplate(node.data.editTemplate?.id)?.label || '编辑结果',
    prompt: node.data.prompt || '',
    params: { ...node.data.params },
    editTemplate: node.data.editTemplate,
    inheritReferences: true,
  })
  graph.updateNodeData(output.id, {
    runState,
    generation,
    progress,
    statusText,
    error,
    consumedMi,
    legacyReferenceNotice:
      '此旧任务已提交，无法补传原图；这里只继续查询原任务，没有重新提交或扣费。',
  })
  graph.updateNodeData(node.id, {
    runState: 'idle',
    generation: undefined,
    progress: null,
    statusText: '',
    error: '',
  })
  return output
}

// Preparing an edit never turns the source media into a generation placeholder.
// Existing linked outputs keep their own retry/resume lifecycle.
export function imageGenerationTarget(graph, nodeId) {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (!node || node.data.kind !== 'image') return null
  if (!node.data.assetUrl || imageSourceId(node) || unresolved(node)) return node
  const signature = JSON.stringify({
    model: node.data.model,
    prompt: node.data.prompt,
    params: node.data.params,
    editTemplate: node.data.editTemplate,
    stylePreset: node.data.stylePreset,
    inputs: imageReferences(node, graph.nodes, graph.edges).map((n) => [
      n.id,
      n.data.assetUrl,
      n.data.prompt,
    ]),
  })
  const pending = graph.nodes.find(
    (item) =>
      item.data.editDraft?.sourceId === node.id &&
      item.data.editDraft.signature === signature &&
      unresolved(item),
  )
  if (pending) return pending
  const output = graph.createImageVariation(node.id, {
    title: imageEditTemplate(node.data.editTemplate?.id)?.label || `${node.data.title} · 编辑结果`,
    prompt: node.data.prompt || '',
    params: { ...node.data.params },
    editTemplate: node.data.editTemplate,
    stylePreset: node.data.stylePreset,
    inheritReferences: true,
  })
  graph.updateNodeData(output.id, { editDraft: { sourceId: node.id, signature } })
  return output
}
