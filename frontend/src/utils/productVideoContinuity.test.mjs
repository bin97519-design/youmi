import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideo,
  newShot,
  buildImageRequest,
  buildPlanRequest,
  buildVideoRequest,
  pickImage,
  removeImage,
} from './productVideo.js'
import {
  continuityEnabled,
  continuitySettings,
  setContinuitySetting,
  continuityImageBlocked,
  continuityBaseShot,
  continuityAnchor,
  continuityPrompt,
  approveProductVideoFrame,
  setContinuityAnchor,
  setContinuityReference,
  planningContinuityReferences,
  productReferenceUrls,
} from './productVideoContinuity.js'

function fixture() {
  const data = newProductVideo()
  data.brief = '白色纱帘'
  data.references = [{ id: 'product', url: 'https://assets.example/product.jpg' }]
  data.shots = ['全景', '手部特写', '收尾'].map((title) => ({
    ...newShot({ title, imagePrompt: '窗边同一女性白色上衣', motion: '轻抚布面' }),
    referenceIds: ['product'],
  }))
  const first = data.shots[0]
  first.images.push({
    id: 'approved',
    url: 'https://assets.example/scene.jpg',
    status: 'completed',
  })
  first.imageId = 'approved'
  return { data, first, next: data.shots[1] }
}

test('creative shots wait for a manually approved anchor and then share its actual image', () => {
  const { data, first, next } = fixture()
  assert.deepEqual(buildImageRequest(data, first, 'first').image_urls, [data.references[0].url])
  assert.throws(() => buildImageRequest(data, next, 'blocked'), /先确认.*基准/)
  assert.throws(() => setContinuityAnchor(data, first), /请先确认/)
  approveProductVideoFrame(data, first)
  const image = buildImageRequest(data, next, 'next')
  assert.equal(first.approvedImageId, 'approved')
  assert.deepEqual(image.image_urls, [data.references[0].url, first.images[0].url])
  assert.match(image.prompt, /图2是全片已确认的场景、人物和商品基准/)
  assert.match(image.prompt, /图1是商品外观依据/)
  assert.match(image.prompt, /不复制基准图的构图/)
  assert.match(image.prompt, /纯商品特写不强行加入人物/)
  assert.throws(() => buildVideoRequest(data, next, 'unapproved'), /先确认当前分镜/)
})

test('anchor is an immutable snapshot across selection, approvals, deletion, reordering and reload', () => {
  const { data, first, next } = fixture()
  approveProductVideoFrame(data, first)
  const snapshot = JSON.stringify(data.continuity.anchor)
  first.images.push({ id: 'new', url: 'https://assets.example/new.jpg', status: 'completed' })
  pickImage(first, 'new')
  first.imagePrompt = 'Changed draft'
  approveProductVideoFrame(data, first)
  next.images = [{ id: 'detail', url: 'https://assets.example/detail.jpg' }]
  next.imageId = 'detail'
  approveProductVideoFrame(data, next)
  removeImage(first, 'approved')
  data.shots.reverse()
  assert.equal(JSON.stringify(data.continuity.anchor), snapshot)
  const restored = JSON.parse(JSON.stringify(data))
  restored.shots = restored.shots.filter((shot) => shot.id !== first.id)
  assert.equal(continuityAnchor(restored).url, 'https://assets.example/scene.jpg')
  assert.equal(
    buildImageRequest(restored, restored.shots[0], 'restored').image_urls.at(-1),
    'https://assets.example/scene.jpg',
  )
  setContinuityAnchor(data, next)
  assert.equal(continuityAnchor(data).url, 'https://assets.example/detail.jpg')
  data.continuity.anchor = null
  assert.equal(continuityAnchor(data), null)
})

test('scene, person and product settings reach initial planning, refinement and image generation separately from brief', () => {
  const { data, first, next } = fixture()
  Object.assign(data.continuity, {
    scene: '客厅木地板',
    person: '黑发白衣女性',
    product: '白色纱帘',
  })
  const before = JSON.stringify(data)
  for (const request of [buildPlanRequest(data, 3), buildPlanRequest(data, 1, next)]) {
    assert.equal(request.brief, data.brief)
    assert.match(request.continuity, /固定场景：客厅木地板/)
    assert.match(request.continuity, /固定人物：黑发白衣女性/)
    assert.match(request.continuity, /固定商品：白色纱帘/)
  }
  assert.match(buildImageRequest(data, first, 'image').prompt, /客厅木地板/)
  assert.equal(JSON.stringify(data), before)
  approveProductVideoFrame(data, first)
  assert.match(buildPlanRequest(data, 1, next).continuity, /已确认基准画面的设定/)
  for (const field of ['scene', 'person', 'product']) data.continuity[field] = '字'.repeat(300)
  data.continuity.anchor.imagePrompt = '字'.repeat(3000)
  assert.ok(continuityPrompt(data).length <= 5000)
})

test('whole-video prompts keep all timing text and use the confirmed shot frame without adding unsupported video references', () => {
  const { data, first } = fixture()
  first.productionMode = 'single_video_30'
  first.motion = '画'.repeat(1800)
  approveProductVideoFrame(data, first)
  const request = buildVideoRequest(data, first, 'video')
  assert.deepEqual(request.image_urls, [first.images[0].url])
  assert.equal(request.first_frame_url, first.images[0].url)
  assert.match(request.prompt, /允许按脚本切换场景或角色/)
  assert.match(request.prompt, /商品始终不变/)
  assert.ok(request.prompt.includes(first.motion))
  assert.ok(request.prompt.length <= 2400)
})

test('whole videos default to independent scenes and people while retaining product references and their own frame approval', () => {
  for (const mode of ['single_video', 'single_video_30']) {
    const { data, first, next } = fixture()
    approveProductVideoFrame(data, first)
    const savedAnchor = JSON.stringify(data.continuity.anchor)
    setContinuityReference(data, 'product', { url: 'https://assets.example/fixed-product.png' })
    setContinuityReference(data, 'person', { url: 'https://assets.example/fixed-person.png' })
    approveProductVideoFrame(data, first)
    next.productionMode = mode
    next.images.push({
      id: 'whole-frame',
      url: 'https://assets.example/whole-frame.png',
      status: 'completed',
    })
    next.imageId = 'whole-frame'
    data.productionMode = mode
    assert.equal(continuityEnabled(data), false)
    assert.equal(continuityAnchor(data), null)
    assert.equal(continuityImageBlocked(data, next), false)
    const request = buildPlanRequest(data, 1, next)
    assert.match(request.continuity, /场景与人物未锁定/)
    assert.match(request.continuity, /整片商品外观约束/)
    assert.ok(request.images.includes('https://assets.example/fixed-product.png'))
    assert.ok(!request.images.includes('https://assets.example/fixed-person.png'))
    const image = buildImageRequest(data, next, 'whole-image')
    assert.doesNotMatch(image.prompt, /本图将作为全片基准候选|是全片已确认的场景/)
    assert.ok(!image.image_urls.includes(first.images[0].url))
    assert.throws(() => buildVideoRequest(data, next, 'whole-video'), /请先确认/)
    approveProductVideoFrame(data, next)
    assert.equal(JSON.stringify(data.continuity.anchor), savedAnchor)
    assert.deepEqual(buildVideoRequest(data, next, 'whole-video').image_urls, [next.images[0].url])
    assert.throws(() => setContinuityAnchor(data, next), /仅用于/)
  }
})

test('optional whole-video settings are isolated from storyboard settings and never require or replace a shared anchor', () => {
  const { data, first, next } = fixture()
  data.continuity.scene = '多分镜卧室'
  approveProductVideoFrame(data, first)
  const original = JSON.stringify(data.continuity)
  data.productionMode = 'single_video'
  next.productionMode = 'single_video_30'
  next.images.push({
    id: 'whole-frame',
    url: 'https://assets.example/whole-frame.png',
    status: 'completed',
  })
  next.imageId = 'whole-frame'
  setContinuitySetting(data, 'enabled', true)
  setContinuitySetting(data, 'scene', '整片客厅')
  setContinuityReference(data, 'scene', { url: 'https://assets.example/whole-room.png' })
  assert.equal(continuityEnabled(data, next), true)
  assert.equal(continuityImageBlocked(data, next), false)
  assert.equal(continuityAnchor(data, next), null)
  assert.match(buildPlanRequest(data, 1, next).continuity, /固定场景：整片客厅/)
  assert.ok(
    buildImageRequest(data, next, 'image').image_urls.includes(
      'https://assets.example/whole-room.png',
    ),
  )
  approveProductVideoFrame(data, next)
  assert.match(buildVideoRequest(data, next, 'video').prompt, /固定场景人物已开启/)
  assert.equal(JSON.stringify(data.continuity), original)
  assert.equal(continuityAnchor(data, first).shotId, first.id)
  data.productionMode = 'storyboard'
  assert.equal(continuitySettings(data).scene, '多分镜卧室')
  assert.equal(continuityEnabled(data), true)
  setContinuitySetting(data, 'enabled', false)
  assert.equal(continuityEnabled(data, next), true)
  const restored = JSON.parse(JSON.stringify(data))
  assert.equal(continuitySettings(restored, next).scene, '整片客厅')
  assert.equal(continuitySettings(restored, first).scene, '多分镜卧室')
})

test('mixed workflows choose the first storyboard as base and ignore legacy whole-video anchors', () => {
  const { data, first, next } = fixture()
  first.productionMode = 'single_video'
  data.continuity.anchor = { shotId: first.id, imageId: first.imageId, url: first.images[0].url }
  assert.equal(continuityAnchor(data, next), null)
  assert.equal(continuityBaseShot(data).id, next.id)
  assert.equal(continuityImageBlocked(data, next), false)
  data.productionMode = 'single_video_30'
  assert.equal(continuityEnabled(data, next), true)
  assert.match(buildPlanRequest(data, 1, next).continuity, /全片固定设定/)
  assert.ok(
    !buildImageRequest(data, next, 'storyboard-image').image_urls.includes(first.images[0].url),
  )
  next.images.push({
    id: 'storyboard-base',
    url: 'https://assets.example/storyboard.png',
    status: 'completed',
  })
  next.imageId = 'storyboard-base'
  approveProductVideoFrame(data, next)
  assert.equal(data.continuity.anchor.shotId, next.id)
  assert.equal(continuityAnchor(data, first), null)
  assert.equal(continuityImageBlocked(data, first), false)
})

test('reference-video workflows and explicitly disabled continuity retain original shot independence', () => {
  const { data, first, next } = fixture()
  for (const type of ['reference', 'disabled']) {
    data.planningSource = type === 'reference' ? 'reference' : 'creative'
    data.continuity.enabled = type !== 'disabled'
    assert.equal(continuityEnabled(data), false)
    approveProductVideoFrame(data, first)
    assert.equal(continuityAnchor(data), null)
    assert.equal(buildPlanRequest(data, 3).continuity, undefined)
    assert.deepEqual(buildImageRequest(data, next, 'independent').image_urls, [
      data.references[0].url,
    ])
  }
})

test('legacy tasks get consistent defaults without auto-approving old frames; reference URLs are deduplicated without dropping product images', () => {
  const { data, first, next } = fixture()
  delete data.continuity
  assert.equal(continuityEnabled(data), true)
  assert.equal(continuityAnchor(data), null)
  data.references = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    url: `https://assets.example/${i}.jpg`,
  }))
  first.referenceIds = next.referenceIds = data.references.map((item) => item.id)
  approveProductVideoFrame(data, first)
  assert.equal(buildImageRequest(data, next, 'all').image_urls.length, 7)
  data.references[0].url = first.images[0].url
  assert.equal(buildImageRequest(data, next, 'dedup').image_urls.length, 6)
  const second = newProductVideo()
  second.continuity.scene = 'different'
  assert.notEqual(second.continuity.scene, data.continuity.scene)
})

test('uploaded role images work without fixed-setting text and reach planning, refinement and first-frame generation', () => {
  const { data, first } = fixture()
  data.references = []
  first.referenceIds = []
  for (const role of ['scene', 'person', 'product']) {
    setContinuityReference(data, role, {
      id: role,
      url: `https://assets.example/${role}.png`,
      name: `${role}.png`,
    })
    assert.equal(data.continuity[role], '')
  }
  const expected = [
    'https://assets.example/product.png',
    'https://assets.example/scene.png',
    'https://assets.example/person.png',
  ]
  assert.deepEqual(productReferenceUrls(data, first), expected.slice(0, 1))
  for (const request of [buildPlanRequest(data, 3), buildPlanRequest(data, 1, first)]) {
    assert.deepEqual(request.images, expected)
    assert.match(request.continuity, /图1是固定商品图/)
    assert.match(request.continuity, /图2是固定场景图/)
    assert.match(request.continuity, /图3是固定人物图/)
    assert.match(request.continuity, /对应文字可以留空/)
    assert.match(request.continuity, /不照搬背景或手持商品/)
  }
  const image = buildImageRequest(data, first, 'image-only')
  assert.deepEqual(image.image_urls, expected)
  assert.match(image.prompt, /图3是固定人物图/)
  const restored = JSON.parse(JSON.stringify(data))
  assert.deepEqual(buildPlanRequest(restored, 3).images, expected)
})

test('replacing or removing a role image clears the old anchor but preserves all existing media and optional text', () => {
  const { data, first } = fixture()
  setContinuityReference(data, 'scene', { url: 'https://assets.example/room.png', name: 'room' })
  data.continuity.scene = '保留这条补充要求'
  approveProductVideoFrame(data, first)
  const oldMedia = JSON.stringify(data.shots)
  setContinuityReference(data, 'scene', { url: 'https://assets.example/room.png', name: 'same' })
  assert.ok(continuityAnchor(data))
  setContinuityReference(data, 'scene', { url: 'https://assets.example/other.png' })
  assert.equal(continuityAnchor(data), null)
  assert.equal(data.continuity.scene, '保留这条补充要求')
  approveProductVideoFrame(data, first)
  setContinuityReference(data, 'scene', null)
  assert.equal(continuityAnchor(data), null)
  assert.equal(data.continuity.images.scene, null)
  assert.equal(JSON.stringify(data.shots), oldMedia)
  assert.throws(
    () => setContinuityReference(data, 'unknown', { url: 'https://assets.example/x.jpg' }),
    /不支持/,
  )
})

test('role images deduplicate with product references, never disappear silently at the planning limit, and remain isolated by mode', () => {
  const { data, first, next } = fixture()
  data.references = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    url: `https://assets.example/${i}.jpg`,
  }))
  first.referenceIds = data.references.map((item) => item.id)
  for (const role of ['scene', 'person', 'product'])
    setContinuityReference(data, role, { url: `https://assets.example/${role}.jpg` })
  assert.throws(() => buildPlanRequest(data, 3), /最多使用 8 张图片/)
  setContinuityReference(data, 'product', { url: data.references[0].url })
  const request = buildPlanRequest(data, 3)
  assert.equal(request.images.length, 8)
  assert.equal(request.images[0], data.references[0].url)
  assert.match(request.continuity, /图7是固定场景图/)
  assert.match(request.continuity, /图8是固定人物图/)
  for (const role of ['scene', 'person', 'product']) data.continuity[role] = '字'.repeat(300)
  first.imagePrompt = '字'.repeat(3000)
  approveProductVideoFrame(data, first)
  assert.ok(planningContinuityReferences(data).instruction.length <= 5000)
  assert.equal(buildImageRequest(data, first, 'regenerate').image_urls.length, 8)
  data.continuity.enabled = false
  assert.equal(buildPlanRequest(data, 3).images.length, 6)
  assert.equal(buildPlanRequest(data, 3).continuity, undefined)
  data.continuity.enabled = true
  data.planningSource = 'reference'
  assert.equal(buildPlanRequest(data, 3).images.length, 6)
  next.referenceIds = []
  assert.throws(() => buildImageRequest(data, next, 'reference'), /商品参考图/)
})
