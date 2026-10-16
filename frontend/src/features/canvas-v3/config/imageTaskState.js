export const IMAGE_TASK_ACTIVE_STATES = Object.freeze([
  'preparing',
  'submitting',
  'queued',
  'running',
])
export const IMAGE_TASK_POLLABLE_STATES = Object.freeze(['submitting', 'queued', 'running'])

export function imageTaskFeedback(data) {
  if (data.runState === 'preparing') return data.statusText || '正在准备生成任务…'
  if (data.runState === 'submitting') return '正在提交生成任务…'
  if (data.runState === 'queued') return '任务已提交，排队中…'
  return data.progress == null ? '生成中…' : `生成中 ${data.progress}%...`
}
