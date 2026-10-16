import { multiAnglePreset } from '../config/multiAngle.js'
import { IMAGE_TASK_ACTIVE_STATES } from '../config/imageTaskState.js'

// No network call: create/update one recoverable task draft only on explicit Generate.
export function createMultiAngleOutput(graph, sourceId, camera, { model, targetId } = {}) {
  const source = graph.nodes.find((n) => n.id === sourceId)
  if (!source?.data.assetUrl) throw new Error('参考图片已移除，请重新选择图片')
  const target = targetId ? graph.nodes.find((n) => n.id === targetId) : null
  if (targetId && (!target || target.data.editTemplate?.sourceNodeId !== sourceId))
    throw new Error('原编辑节点已变化，请关闭面板后重新打开')
  if (
    target &&
    (IMAGE_TASK_ACTIVE_STATES.includes(target.data.runState) ||
      ['uncertain', 'paused'].includes(target.data.runState) ||
      target.data.generation?.unresolvedTaskIds?.length)
  )
    throw new Error('原任务尚未结束，请先继续查询原任务，避免重复生成')
  if (!model) throw new Error('尚未配置可用的图片编辑模型')
  const preset = multiAnglePreset(camera)
  if (target) {
    graph.remember()
    graph.updateNodeData(target.id, {
      ...preset,
      prompt: target.data.prompt || '',
      model,
      params: { ...target.data.params, ...preset.params },
      editTemplate: { ...preset.editTemplate, sourceNodeId: sourceId },
    })
    return graph.nodes.find((n) => n.id === targetId)
  }
  const result = graph.createImageVariation(sourceId, preset)
  graph.updateNodeData(result.id, { model })
  return result
}
