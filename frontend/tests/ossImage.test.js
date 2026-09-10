import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOssThumbnailUrl } from '../src/utils/ossImage.js'

const ossImage = 'https://huami-canvas.oss-cn-shanghai.aliyuncs.com/users/1/example.png'

test('builds a resized OSS WebP URL for list thumbnails', () => {
  const result = buildOssThumbnailUrl(ossImage, { width: 640, height: 480, quality: 76 })

  assert.match(result, /x-oss-process=image\/resize,m_lfit,w_640,h_480/)
  assert.match(result, /quality,q_76\/format,webp/)
})

test('does not rewrite signed or non-OSS image URLs', () => {
  const signed = `${ossImage}?Expires=123&OSSAccessKeyId=test&Signature=test`
  const external = 'https://example.com/image.png'

  assert.equal(buildOssThumbnailUrl(signed), signed)
  assert.equal(buildOssThumbnailUrl(external), external)
})

test('does not append a second OSS image process', () => {
  const processed = `${ossImage}?x-oss-process=image/resize,w_320`
  assert.equal(buildOssThumbnailUrl(processed), processed)
})
