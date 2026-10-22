import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideoTask,
  newProductVideo,
  newShot,
  buildPlanRequest,
  buildImageRequest,
  buildVideoRequest,
} from '../src/utils/productVideo.js'
import {
  ensureProductStudy,
  productStudySource,
  confirmProductStudy,
  productStudyIssue,
  buildProductAnalysisRequest,
  applyProductAnalysisState,
  creativePlanningBrief,
} from '../src/utils/productVideoProductAnalysis.js'

function fixture() {
  const task = newProductVideoTask('窗帘短视频')
  task.continuity.enabled = false
  task.brief = '换一个卧室场景，保留自然口播'
  task.references = [{ id: 'visual', url: 'https://assets.example/visual-original.png' }]
  const study = task.productStudy
  study.materials = [
    { id: 'poster', url: 'https://assets.example/marketing-original.png', name: '详情页.jpg' },
  ]
  study.notes = '主图上标注了遮光率，分析时注明资料来源'
  study.job = {
    id: 'study-job',
    sourceFingerprint: productStudySource(study),
    materialSnapshot: JSON.parse(JSON.stringify(study.materials)),
  }
  applyProductAnalysisState(task, {
    id: 'study-job',
    status: 'completed',
    stage: '商品分析完成',
    updatedAt: 10,
    analysis: {
      provider: 'test',
      model: 'gem-3-pro',
      productName: '棉麻窗帘',
      summary: '主图资料概述',
      sellingPoints: [
        {
          id: 'point-1',
          title: '遮光',
          description: '遮光面料适用于卧室休息',
          evidence: '图中文字',
          imageIndices: [1],
        },
        { id: 'point-2', title: '高温定型', description: '未选中的卖点内容', imageIndices: [1] },
      ],
      questions: ['隔音参数需要核对'],
    },
  })
  study.result.sellingPoints[1].selected = false
  confirmProductStudy(task)
  return { task, study }
}

test('analysis uses original marketing images and selected model without video references', () => {
  const { task } = fixture()
  task.planningModel = 'gem-3-pro'
  const payload = buildProductAnalysisRequest(task)
  assert.equal(payload.planningModel, 'gem-3-pro')
  assert.equal(payload.productionMode, 'product_analysis')
  assert.deepEqual(payload.images, ['https://assets.example/marketing-original.png'])
  assert.equal(payload.brief, task.productStudy.notes)
  assert.equal(payload.referenceVideo, undefined)
  assert.equal(payload.currentShot, undefined)
})

test('planning receives confirmed facts and the original video brief, never marketing images or unselected facts', () => {
  const { task } = fixture()
  const payload = buildPlanRequest(task, 4)
  assert.deepEqual(payload.images, [task.references[0].url])
  assert.ok(payload.brief.includes(task.brief))
  assert.match(payload.brief, /遮光面料适用于卧室休息/)
  assert.doesNotMatch(
    JSON.stringify(payload),
    /marketing-original|未选中的卖点内容|主图上标注了遮光率/,
  )
  const shot = newShot({ imagePrompt: '女子拉拢窗帘', motion: '女子顺滑地拉窗帘。' })
  shot.referenceIds = ['visual']
  task.shots.push(shot)
  assert.deepEqual(buildImageRequest(task, shot, 'image-test').image_urls, [task.references[0].url])
  shot.images = [{ id: 'frame', url: 'https://assets.example/generated.png', status: 'completed' }]
  shot.imageId = shot.approvedImageId = 'frame'
  const video = buildVideoRequest(task, shot, 'video-test')
  assert.deepEqual(video.image_urls, ['https://assets.example/generated.png'])
  assert.doesNotMatch(JSON.stringify(video), /marketing-original/)
})

test('facts survive JSON persistence and changes to video scenes, actors, models and reference images', () => {
  const { task } = fixture()
  const restored = JSON.parse(JSON.stringify(task))
  restored.brief = '换卧室和新人物，再生成一次'
  restored.references = [{ id: 'new', url: 'https://assets.example/new-room.png' }]
  restored.continuity.person = '年轻女性'
  restored.continuity.scene = '日式卧室'
  restored.planningModel = 'gpt-5.6-luna'
  assert.equal(productStudyIssue(restored), '')
  assert.match(creativePlanningBrief(restored), /遮光面料/)
  assert.equal(restored.productStudy.result.materials[0].name, '详情页.jpg')
})

test('editing sources or confirmed selling points requires explicit confirmation again without deleting results', () => {
  for (const update of [
    (study) => {
      study.notes += '新增参数'
    },
    (study) => {
      study.materials[0].url += '?changed=1'
    },
  ]) {
    const { task, study } = fixture()
    update(study)
    assert.match(productStudyIssue(task), /资料已变化/)
    assert.throws(() => confirmProductStudy(task))
    assert.ok(study.result)
    assert.equal(task.references.length, 1)
  }
  for (const update of [
    (study) => {
      study.result.sellingPoints[0].description = '用户改过的说明'
    },
    (study) => {
      study.result.sellingPoints[1].selected = true
    },
  ]) {
    const { task, study } = fixture()
    update(study)
    assert.match(productStudyIssue(task), /确认本次/)
    confirmProductStudy(task)
    assert.equal(productStudyIssue(task), '')
  }
})

test('late completion preserves original evidence mapping and does not overwrite user edits on repeat polling', () => {
  const { task, study } = fixture()
  const original = JSON.stringify(study)
  applyProductAnalysisState(task, {
    id: 'other-task',
    status: 'completed',
    updatedAt: 999,
    analysis: { sellingPoints: [] },
  })
  assert.equal(JSON.stringify(study), original)
  study.result.sellingPoints[0].description = '用户编辑后保留'
  applyProductAnalysisState(task, {
    id: 'study-job',
    status: 'completed',
    updatedAt: 11,
    analysis: { sellingPoints: [] },
  })
  assert.equal(study.result.sellingPoints[0].description, '用户编辑后保留')
  study.materials.splice(0, 1)
  assert.equal(study.result.materials[0].name, '详情页.jpg')
  assert.match(productStudyIssue(task), /资料已变化/)
})

test('new creative tasks require study confirmation, while old tasks and video recreation remain usable', () => {
  const task = newProductVideoTask()
  assert.throws(() => buildPlanRequest(task, 1), /分析卖点/)
  assert.throws(() => buildProductAnalysisRequest(task), /添加商品/)
  const old = newProductVideo()
  old.brief = '完整旧版脚本'
  assert.equal(creativePlanningBrief(old), old.brief)
  ensureProductStudy(old)
  old.planningSource = 'reference'
  assert.equal(productStudyIssue(old), '')
  assert.equal(creativePlanningBrief(old), old.brief)
})
