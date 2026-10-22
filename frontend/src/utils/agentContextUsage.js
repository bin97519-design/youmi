export function estimateTextTokens(text = '') {
  let cjk = 0, other = 0
  for (const character of String(text)) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

const formatTokens = value => value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value)

export function formatAgentContextUsage(usage, pendingText = '') {
  if (!usage || !Number.isFinite(Number(usage.budgetTokens)) || Number(usage.budgetTokens) <= 0)
    return { label: '上下文 · 待计算', percent: 0,
      title: '发送后显示上下文 token 用量。优先使用模型回传统计；未回传时显示估算。本地预算不等于模型官方最大容量。' }
  const extra = estimateTextTokens(pendingText)
  const used = Math.max(0, Number(usage.inputTokens) || 0) + Math.max(0, Number(usage.outputTokens) || 0) + extra
  const budget = Number(usage.budgetTokens)
  const estimated = usage.estimated || extra > 0
  const percent = used / budget * 100
  return { label: `${estimated ? '≈' : ''}${percent.toFixed(1)}% · ${formatTokens(used)} / ${formatTokens(budget)}`,
    percent: Math.min(100, percent),
    title: `${estimated ? '估算上下文用量' : '模型回传的本轮输入与输出用量'}：${used.toLocaleString()} tokens\n`
      + `本地上下文预算：${budget.toLocaleString()} tokens，不代表模型官方最大容量。\n`
      + '较早历史会自动压缩为数据库摘要，近期对话与最新脚本继续保留原文。' }
}
