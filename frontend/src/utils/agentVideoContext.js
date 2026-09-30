export function agentVideoContext(message) {
  if (!message?.videoUrl || message.failed || message.generating) return null
  const request = message.videoRequest || {}
  return {
    messageId: message.id,
    taskId: message.taskId || '',
    videoUrl: message.videoUrl,
    prompt: String(request.prompt || '').trim(),
    video: {
      model: request.model || message.model,
      ratio: request.ratio || message.ratio,
      resolution: request.resolution || message.resolution,
      duration: Number(request.duration || message.duration) || 15,
      referenceMode: request.referenceMode || 'shouweizhen',
      generateAudio: request.generateAudio !== false,
    },
    referenceImages: (request.referenceImages || []).filter((reference) => reference?.url),
  }
}

export function describeAgentVideoContext(context) {
  if (!context) return ''
  return [
    `已完成视频，消息ID：${context.messageId}`,
    `实际提交参数：${JSON.stringify(context.video)}`,
    context.prompt ? `实际提交脚本：\n${context.prompt}` : '原始脚本未保存，不要推测其内容。',
    '以上是生成记录，不是对成片的逐帧观察；不要声称已经看过视频。后续修改先给视频方案，仍需点击确认生成。',
  ].join('\n')
}
