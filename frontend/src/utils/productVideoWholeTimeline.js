const whole = (shot) => ['single_video', 'single_video_30'].includes(shot?.productionMode)
export const wholeSeconds = (shot) => (shot?.productionMode === 'single_video_30' ? 30 : 15)
export function selectProductionMode(workflow, mode) {
  const old = workflow.productionMode
  if (old === mode) return
  workflow.wholeTimelineCounts ||= {}
  if (whole({ productionMode: old })) workflow.wholeTimelineCounts[old] = workflow.timelineCount
  workflow.productionMode = mode
  if (whole({ productionMode: mode }) && workflow.planningSource !== 'reference')
    workflow.timelineCount =
      workflow.wholeTimelineCounts[mode] ?? (mode === 'single_video_30' ? 6 : 4)
}
export const WHOLE_TRANSITIONS = [
  { value: 'opening', label: '开场' },
  { value: 'continue', label: '动作接续' },
  { value: 'match_cut', label: '景别匹配' },
  { value: 'time_cut', label: '时间转场' },
  { value: 'scene_cut', label: '场景转场' },
]
const lines = (value) =>
  String(value || '')
    .replace(/\\+r\\+n|\\+[rn]/g, '\n')
    .replace(/\r\n?/g, '\n')
const range =
  /^\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-~～—–至到]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)\s*[:：,，、]\s*/i

export function parseWholeMotion(value) {
  const beats = [],
    suffix = []
  let current = null,
    after = false
  for (const line of lines(value).split('\n')) {
    if (/^\s*全片连续性\s*[:：]/.test(line)) {
      after = true
      current = null
    }
    const found = !after && range.exec(line)
    if (found) {
      current = {
        start: Number(found[1]),
        end: Number(found[2]),
        description: line.slice(found[0].length).trim(),
      }
      beats.push(current)
    } else if (current) current.description += `${current.description ? '\n' : ''}${line}`
    else if (line.trim()) suffix.push(line)
  }
  return {
    beats: beats.map((beat) => ({ ...beat, description: beat.description.trim() })),
    suffix: suffix.join('\n'),
  }
}

export function wholeTimeline(shot) {
  const parsed = parseWholeMotion(shot?.motion)
  const source = shot?.timeline?.length ? shot.timeline : parsed.beats
  return source.map((beat, index) => {
    const text = parsed.beats[index]
    return {
      ...beat,
      transitionType: beat.transitionType || (index ? 'match_cut' : 'opening'),
      startState: beat.startState || '',
      endState: beat.endState || '',
      description:
        text && text.start === Number(beat.start) && text.end === Number(beat.end)
          ? text.description
          : beat.description ||
            [beat.action, beat.camera, beat.transition].filter(Boolean).join('；'),
    }
  })
}

export function validateWholeTimeline(beats, seconds) {
  if (!Array.isArray(beats) || !beats.length || beats.length > 8)
    throw new Error('整片需有 1 至 8 个时段')
  let previous = 0
  for (const [index, beat] of beats.entries()) {
    if (
      !Number.isFinite(Number(beat.start)) ||
      !Number.isFinite(Number(beat.end)) ||
      Math.abs(Number(beat.start) - previous) > 0.001 ||
      Number(beat.end) - Number(beat.start) < 1 ||
      Number(beat.end) > seconds
    )
      throw new Error(`第 ${index + 1} 时段时间无效，需连续覆盖 0 至 ${seconds} 秒`)
    for (const [key, max] of Object.entries({
      action: 180,
      camera: 140,
      transition: 120,
      startState: 120,
      endState: 120,
      description: 1800,
    }))
      if (String(beat[key] || '').length > max) throw new Error(`第 ${index + 1} 时段内容过长`)
    if (!String(beat.description || '').trim()) throw new Error(`第 ${index + 1} 时段缺少执行描述`)
    if (
      beat.transitionType &&
      !WHOLE_TRANSITIONS.some((item) => item.value === beat.transitionType)
    )
      throw new Error('整片转场类型无效')
    if (beat.transitionType && (index === 0) !== (beat.transitionType === 'opening'))
      throw new Error('只有首时段可以使用开场方式')
    previous = Number(beat.end)
  }
  if (Math.abs(previous - seconds) > 0.001) throw new Error(`整片时间轴需覆盖到第 ${seconds} 秒`)
}

export function wholeTimelineIssue(shot) {
  if (!whole(shot)) return ''
  if (!shot.timeline?.length && !parseWholeMotion(shot.motion).beats.length) return ''
  try {
    const beats = wholeTimeline(shot),
      parsed = parseWholeMotion(shot.motion)
    validateWholeTimeline(beats, wholeSeconds(shot))
    if (
      parsed.beats.length !== beats.length ||
      beats.some(
        (beat, i) =>
          Number(beat.start) !== parsed.beats[i]?.start ||
          Number(beat.end) !== parsed.beats[i]?.end,
      )
    )
      return '时间轴与提示词不同步，请核对整片时段'
    if (shot.timelineCount != null && Number(shot.timelineCount) !== beats.length)
      return '整片分镜数量与时间轴不一致'
    return ''
  } catch (error) {
    return error.message
  }
}

export function setWholeMotion(shot, value) {
  const motion = lines(value),
    parsed = parseWholeMotion(motion)
  if (parsed.beats.length) {
    try {
      validateWholeTimeline(parsed.beats, wholeSeconds(shot))
      const old = wholeTimeline(shot)
      if (old[0]?.description !== parsed.beats[0]?.description) shot.approvedImageId = ''
      shot.timeline = parsed.beats.map((beat, index) => {
        const prior = old.find(
          (item) => Number(item.start) === beat.start && Number(item.end) === beat.end,
        )
        const unchanged = prior?.description === beat.description
        return {
          ...(unchanged ? prior : {}),
          ...beat,
          action: unchanged ? prior.action : '',
          camera: unchanged ? prior.camera : '',
          transition: unchanged ? prior.transition : '',
          startState: unchanged ? prior.startState : '',
          endState: unchanged ? prior.endState : '',
          transitionType: unchanged ? prior.transitionType : index ? 'match_cut' : 'opening',
        }
      })
      shot.timelineCount = shot.timeline.length
    } catch {
      /* Invalid edits remain visible and cannot be submitted. */
    }
  }
  shot.motion = motion
}

export function updateWholeTimeline(shot, next) {
  validateWholeTimeline(next, wholeSeconds(shot))
  const suffix = parseWholeMotion(shot.motion).suffix
  const motion =
    next
      .map((beat) => `${Number(beat.start)}-${Number(beat.end)} 秒：${beat.description.trim()}`)
      .join('\n') + (suffix ? `\n${suffix}` : '')
  if (motion.length > 1800) throw new Error('整片执行提示词超过 1800 字，请精简当前时段')
  shot.timeline = next.map((beat) => ({
    ...beat,
    start: Number(beat.start),
    end: Number(beat.end),
  }))
  shot.timelineCount = next.length
  shot.motion = motion
}

export function moveWholeBoundary(shot, index, end) {
  const next = wholeTimeline(shot).map((beat) => ({ ...beat }))
  if (!next[index + 1]) throw new Error('末时段结束时间固定为整片时长')
  next[index].end = Number(end)
  next[index + 1].start = Number(end)
  updateWholeTimeline(shot, next)
}

export function wholeStatePrompt(shot) {
  if (!whole(shot)) return ''
  const states = wholeTimeline(shot).filter((beat) => beat.startState || beat.endState)
  if (!states.length) return ''
  return (
    '内部状态承接（拍摄资料；状态改变须有可见原因）：\n' +
    states
      .map(
        (beat) =>
          `${beat.start}-${beat.end}秒 ${WHOLE_TRANSITIONS.find((item) => item.value === beat.transitionType)?.label || '景别匹配'}：${beat.startState || '按本段描述'} → ${beat.endState || '按本段描述'}`,
      )
      .join('\n')
  )
}
