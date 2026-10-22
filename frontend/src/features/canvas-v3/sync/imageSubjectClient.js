import { imageAssetSourceUrl } from '../config/imageAssetCollections.js'

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('已取消', 'AbortError')
}

function subjectText(value, depth = 0) {
  if (depth > 3) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value
      .slice(0, 20)
      .map((item) => (typeof item === 'string' ? item : item?.core_subject || ''))
      .filter((item) => typeof item === 'string')
      .join('；')
  if (value && typeof value === 'object')
    return typeof value.core_subject === 'string'
      ? value.core_subject
      : subjectText(value.core_subject, depth + 1)
  return ''
}

/** Only identified subject facts are used, never an unrelated full generation prompt. */
export function subjectDescriptionFromAnalysis(data) {
  const value = subjectText(data?.promptJson?.subject_and_elements)
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (
    normalized.length < 2 ||
    normalized.length > 20000 ||
    [...normalized].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    ) ||
    /^(?:未知|不详|未识别|无法识别|没有主体|无主体|N\/A|unknown)[。.!！]?$/i.test(normalized)
  )
    throw new Error('服务未返回可用的主体特征，请手动填写主体描述')
  return normalized.slice(0, 100).replace(/[\uD800-\uDBFF]$/, '')
}

/** Uses the existing configured vision service. Calling this helper never saves or generates an image. */
export async function generateSubjectDescription(
  { imageUrl, signal } = {},
  { path = (value) => value, headers = () => ({}), fetcher = fetch } = {},
) {
  const source = imageAssetSourceUrl(imageUrl)
  if (!source) throw new Error('主体图片地址无效，无法识别主体特征')
  abortIfNeeded(signal)
  const auth = typeof headers === 'function' ? headers() : headers
  const response = await fetcher(path('/api/prompt/analyze-image'), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(auth instanceof Headers ? Object.fromEntries(auth.entries()) : auth || {}),
    },
    body: JSON.stringify({
      category: 'general',
      ...(source.startsWith('data:') ? { imageBase64: source } : { imageUrl: source }),
      thinkingEnabled: false,
    }),
  })
  abortIfNeeded(signal)
  const payload = await response.json().catch(() => null)
  abortIfNeeded(signal)
  if (!response.ok || payload?.code !== 0 || !payload.data) {
    throw new Error(
      typeof payload?.message === 'string' && payload.message
        ? payload.message
        : `主体特征识别失败（${response.status || '网络异常'}）`,
    )
  }
  return subjectDescriptionFromAnalysis(payload.data)
}
