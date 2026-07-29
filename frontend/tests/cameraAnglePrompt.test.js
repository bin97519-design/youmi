import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCameraAnglePrompt,
  describeDistance,
  describeHorizontalAngle,
  describeSurfaceVisibility,
  describeVerticalAngle,
  getCameraAngleSpec,
  normalizeHorizontalAngle,
} from '../src/utils/cameraAnglePrompt.js'

test('normalizes signed horizontal angles into the 0-359 coordinate system', () => {
  assert.equal(normalizeHorizontalAngle(-50), 310)
  assert.equal(normalizeHorizontalAngle(370), 10)
})

test('describes the sample camera parameters without losing precision', () => {
  const spec = getCameraAngleSpec({
    horizontalAngle: -50,
    verticalAngle: -17,
    distance: 1,
  })

  assert.equal(spec.horizontal.normalizedAngle, 310)
  assert.equal(spec.horizontal.name, '左前方')
  assert.equal(spec.vertical.name, '低机位仰拍')
  assert.equal(spec.distance.name, '中景')
  assert.match(spec.summary, /左前方 50°/)
})

test('clamps vertical angle and distance to supported UI ranges', () => {
  assert.equal(describeVerticalAngle(-80).angle, -30)
  assert.equal(describeVerticalAngle(90).angle, 60)
  assert.equal(describeDistance(-1).distance, 0)
  assert.equal(describeDistance(9).distance, 2)
})

test('turns arbitrary angles into measurable visible-surface constraints', () => {
  assert.match(describeSurfaceVisibility(-50), /左侧面约占主体可见表面的54%/)
  assert.match(describeSurfaceVisibility(-50), /正面约占46%/)
  assert.match(describeSurfaceVisibility(90), /右侧面为主要可见面/)
})

test('builds a strict image-edit prompt with coordinate definitions', () => {
  const prompt = buildCameraAnglePrompt({
    horizontalAngle: -50,
    verticalAngle: -17,
    distance: 1,
    additionalPrompt: '使用纯白摄影棚背景',
  })

  assert.match(prompt, /horizontal_angle：-50°，归一化为 310°/)
  assert.match(prompt, /从主体正面向左环绕 50°/)
  assert.match(prompt, /vertical_angle：-17°/)
  assert.match(prompt, /distance：1/)
  assert.match(prompt, /主体固定在原地且朝向不变/)
  assert.match(prompt, /严禁直接旋转、拉伸、镜像或透视扭曲/)
  assert.match(prompt, /主体约占画面宽高的60%到72%/)
  assert.match(prompt, /背景透视、地面消失点、投影方向和遮挡关系必须随新机位同步重建/)
  assert.match(prompt, /使用纯白摄影棚背景/)
})

test('keeps horizontal descriptors stable at the back-view boundary', () => {
  assert.equal(describeHorizontalAngle(180).name, '正后方')
  assert.equal(describeHorizontalAngle(-180).name, '正后方')
})
