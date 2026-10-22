export const MAIN_VIDEO_2 = 'main_video_2'
export const MAIN_VIDEO_2_STORAGE = 'productVideo2'
export function configureMainVideo2Task(task, models = [], videos = []) {
  task.planner = MAIN_VIDEO_2
  task.video2 = {
    productName: '',
    sellingPoints: '',
    videoType: '',
    revision: '',
    firstFrame: null,
    variant: 0,
    planningIntent: 'plan',
    allowReferenceStructureChanges: false,
    allowAudioChanges: false,
  }
  task.productionMode = 'single_video'
  task.generateAudio = task.keepOriginalAudio = true
  task.planningModel = models.some((option) => option.value === 'gem-3-pro')
    ? 'gem-3-pro'
    : 'default'
  task.videoModel =
    videos.find(
      (option) => option.value.includes('seedance-2-5') || option.value.includes('seedance-2.5'),
    )?.value || task.videoModel
  delete task.productStudy
  return task
}
export function buildMainVideo2Request(workflow) {
  const settings = workflow.video2 || {}
  const images = [
    ...new Set(
      [...workflow.references.map((item) => item.url), settings.firstFrame?.url].filter(Boolean),
    ),
  ]
  if (!images.length && !workflow.referenceVideo?.url) throw new Error('请添加产品图或参考视频')
  if (images.length > 8) throw new Error('产品图与可选首帧合计最多8张，请调整后再策划')
  const reference = workflow.referenceVideo
  if (
    reference &&
    (!Number.isFinite(Number(reference.duration)) ||
      reference.duration <= 0 ||
      reference.duration > 120.5)
  )
    throw new Error('请上传2分钟以内且可正常读取时长的参考视频')
  const planningIntent = settings.planningIntent || (settings.revision?.trim() ? 'revise' : 'plan')
  const previousScript = planningIntent === 'revise' ? workflow.shots.at(-1)?.motion || '' : ''
  const previousScripts =
    planningIntent === 'revise'
      ? workflow.shots
          .slice(-(reference ? Math.ceil(reference.duration / 30) : 1))
          .map((shot) => shot.motion || '')
      : []
  const previousCreative =
    planningIntent === 'variant'
      ? workflow.shots.slice(-3).map((shot) => {
          const [visual, voice = ''] = String(shot.motion || '').split('口播设计：')
          const scenes = visual.split(/^\s*分镜\d+\s*(?:[（(][^）)\r\n]+[）)]\s*)?[：:]/m).slice(1)
          return {
            opening: scenes[0]?.trim().slice(0, 350) || '',
            ending: scenes.at(-1)?.trim().slice(0, 250) || '',
            voice: voice
              .replace(/^\s*(?:口播\d+|无口播)(?:[（(][^）)\r\n]*[）)])?\s*[：:]/gm, '')
              .trim()
              .slice(0, 350),
          }
        })
      : []
  const brief = JSON.stringify({
    planningIntent,
    productName: settings.productName || '',
    sellingPoints: settings.sellingPoints || '',
    videoType: settings.videoType || '',
    requirements: workflow.brief || '',
    firstFrameUrl: settings.firstFrame?.url || '',
    revision: planningIntent === 'plan' ? '' : settings.revision || '',
    variant: Number(settings.variant || 0),
    allowReferenceStructureChanges: settings.allowReferenceStructureChanges === true,
    allowAudioChanges: settings.allowAudioChanges === true,
    previousScript,
    previousScripts,
    previousCreative,
    sourceAnalysisJobId: workflow.planJob?.id || '',
  })
  if (brief.length > 64000) throw new Error('商品资料和修改要求过长，请分次修改')
  return {
    productionMode: MAIN_VIDEO_2,
    brief,
    images,
    ratio: workflow.ratio,
    planningModel: workflow.planningModel || 'default',
    count: reference ? Math.ceil(reference.duration / 30) : 1,
    ...(reference
      ? {
          referenceVideo: {
            url: reference.url,
            name: reference.name || '',
            duration: Number(reference.duration),
            frames: [],
          },
        }
      : {}),
  }
}
