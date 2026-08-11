export function canCreateAgentDraft(response, prompts) {
  return response?.readyToGenerate === true && Array.isArray(prompts) && prompts.length > 0
}

export function totalAgentGenerationCount(models, count) {
  const uniqueModels = new Set((Array.isArray(models) ? models : [models]).filter(Boolean))
  const perModelCount = Math.max(1, Math.min(4, Number(count) || 1))
  return Math.max(1, uniqueModels.size) * perModelCount
}
