import { buildGenerationReplay } from './elementEditPrompt.js'

export function agentImageContext(message) {
  if (!message?.imageUrl || message.videoUrl || message.failed || message.generating) return null
  const replay = buildGenerationReplay({ assistantMessage: message })
  return {
    messageId: message.id,
    imageUrl: message.imageUrl,
    prompt: replay.prompt,
    image: {
      model: replay.model,
      ratio: replay.ratio,
      resolution: replay.resolution,
      generationOptions: replay.generationOptions,
    },
    referenceImages: [...new Set([message.imageUrl, ...replay.referenceImageUrls])].map(
      (url, index) => ({
        url,
        name: index === 0 ? '本次要调整的成图' : `图片原参考图 ${index}`,
      }),
    ),
  }
}

export function describeAgentImageContext(context) {
  if (!context) return ''
  return [
    `已完成图片，消息ID：${context.messageId}`,
    `实际提交参数：${JSON.stringify(context.image)}`,
    context.prompt ? `实际提交提示词：\n${context.prompt}` : '原始提示词未保存，不要推测其内容。',
    '这是图片生成记录。只依据本轮实际提供的图片判断画面，后续修改先出图片方案，仍需点击确认生图。',
  ].join('\n')
}
