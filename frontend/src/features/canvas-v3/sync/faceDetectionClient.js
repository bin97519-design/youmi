import { validFaceBox } from '../config/portraitEmotion.js'

export async function detectFaces(
  imageUrl,
  { fetcher = fetch, path = (v) => v, headers = {}, signal } = {},
) {
  const response = await fetcher(path('/api/image/detect-faces'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ imageUrl }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.code) {
    throw new Error(
      response.status === 404
        ? '人脸检测接口尚未加载，请更新后端后重试；也可以手动框选面部'
        : payload?.message || '面部识别失败，请重试或手动框选',
    )
  }
  if (!Array.isArray(payload.data?.faces)) throw new Error('面部检测返回格式无效，请重试或手动框选')
  return payload.data.faces
    .filter((face) => validFaceBox(face?.box))
    .slice(0, 20)
    .sort((a, b) => a.box[0] - b.box[0])
}
