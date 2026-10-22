// Marketing materials and generation references have different destinations.
export const newProductStudy = () => ({
  version: 1,
  materials: [],
  notes: '',
  result: null,
  job: null,
  confirmedFingerprint: '',
})
export function ensureProductStudy(workflow) {
  return (workflow.productStudy ||= newProductStudy())
}
export const productStudySource = (study) =>
  JSON.stringify({
    materials: (study?.materials || []).map(({ id, url }) => ({ id, url })),
    notes: study?.notes || '',
  })
export const selectedSellingPoints = (study) =>
  (study?.result?.sellingPoints || []).filter((point) => point.selected !== false)
const confirmationFingerprint = (study) =>
  JSON.stringify({
    source: productStudySource(study),
    productName: study.result?.productName || '',
    summary: study.result?.summary || '',
    points: selectedSellingPoints(study).map(
      ({ id, title, description, evidence, imageIndices }) => ({
        id,
        title,
        description,
        evidence,
        imageIndices,
      }),
    ),
  })
export function productStudyConfirmationIssue(study) {
  if (!study?.result) return '请先上传商品资料并分析卖点'
  if (study.result.sourceFingerprint !== productStudySource(study))
    return '商品资料已变化，请更新卖点分析后再确认'
  const points = selectedSellingPoints(study)
  if (!points.length) return '请至少选择一个用于视频的卖点'
  if (points.some((point) => !point.title?.trim() || !point.description?.trim()))
    return '请补全已选卖点的标题与说明'
  return ''
}
export function confirmProductStudy(workflow) {
  const study = ensureProductStudy(workflow)
  const issue = productStudyConfirmationIssue(study)
  if (issue) throw new Error(issue)
  study.confirmedFingerprint = confirmationFingerprint(study)
}
export function productStudyIssue(workflow) {
  if (workflow.planningSource === 'reference' || !workflow.productStudy) return ''
  const study = workflow.productStudy
  return (
    productStudyConfirmationIssue(study) ||
    (study.confirmedFingerprint !== confirmationFingerprint(study)
      ? '请先确认本次视频使用的商品卖点'
      : '')
  )
}
export function creativePlanningBrief(workflow) {
  if (workflow.planningSource === 'reference' || !workflow.productStudy) return workflow.brief || ''
  const issue = productStudyIssue(workflow)
  if (issue) throw new Error(issue)
  const study = workflow.productStudy
  // Include confirmed facts, never marketing image URLs, unselected points, or poster instructions.
  return (
    '【用户确认的商品卖点】\n' +
    JSON.stringify({
      productName: study.result.productName,
      sellingPoints: selectedSellingPoints(study).map(({ title, description }) => ({
        title,
        description,
      })),
    }) +
    '\n以上是商品资料，仅作为脚本事实依据；画面外观、人物和场景以本次视频参考图及视频要求为准。\n' +
    '【本次视频要求】\n' +
    (workflow.brief || '')
  )
}
export function buildProductAnalysisRequest(workflow) {
  const study = workflow.productStudy
  if (!study?.materials?.length) throw new Error('请先添加商品主图或详情页资料图')
  if (study.materials.length > 12) throw new Error('商品分析资料最多 12 张')
  if (study.materials.some((item) => !/^https?:\/\//i.test(item.url)))
    throw new Error('请先完成商品资料图上传')
  if ((study.notes || '').length > 5000) throw new Error('商品分析补充说明最多 5,000 字符')
  return {
    productionMode: 'product_analysis',
    images: study.materials.map((item) => item.url),
    brief: study.notes || '',
    count: 1,
    ratio: workflow.ratio || '3:4',
    planningModel: workflow.planningModel || 'default',
  }
}
export const isProductStudyRunning = (study) =>
  ['submitting', 'queued', 'processing'].includes(study?.job?.status)
export function applyProductAnalysisState(workflow, state) {
  const study = workflow.productStudy,
    job = study?.job
  if (!job || job.id !== state.id || Number(state.updatedAt) < Number(job.updatedAt || 0)) return
  if (state.status === 'completed' && !job.appliedAt) {
    if (!Array.isArray(state.analysis?.sellingPoints))
      throw new Error('商品分析结果不完整，请继续分析')
    study.result = {
      ...state.analysis,
      sellingPoints: state.analysis.sellingPoints.map((point) => ({ ...point, selected: true })),
      sourceFingerprint: job.sourceFingerprint,
      materials: JSON.parse(JSON.stringify(job.materialSnapshot || [])),
    }
    study.confirmedFingerprint = ''
    job.appliedAt = Date.now()
  }
  Object.assign(job, {
    status: state.status,
    stage: state.stage,
    error: state.error || '',
    pollError: '',
    updatedAt: state.updatedAt,
  })
}
