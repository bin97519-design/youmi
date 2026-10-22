import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'
import { videoTaskRequest } from '../src/features/canvas-v3/sync/videoTaskClient.js'
import { WANXIANG_MODEL } from '../src/features/canvas-v3/config/wanxiangParameters.js'
import { resolveWanxiangRoute } from '../src/features/canvas-v3/sync/wanxiangTaskRequest.js'

test('Wanxiang preserves one menu identity backed by the documented API and dedicated integration', () => {
  const entries = VIDEO_MODEL_CATALOG.filter((option) => option.value === '万相 3.0')
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], {
    value: '万相 3.0',
    label: '万相 3.0 全能',
    icon: 'modelWanxiang',
    description: '多模态参考 · 标准 / 高速 · 2～30秒 / 智能时长 · 最高1080P',
  })
  assert.equal(entries[0].model, undefined)
})

test('Wanxiang dropdown and selected model share their label and local icon', () => {
  const values = ['Kling 3.0', '万相 3.0']
  const before = structuredClone(values)
  const options = videoModelOptions(values)
  const wanxiang = options.find((option) => option.value === '万相 3.0')
  const selected = modelPresentation(wanxiang, 'video')
  assert.equal(selected.value, '万相 3.0')
  assert.equal(selected.label, '万相 3.0 全能')
  assert.equal(selected.icon, 'modelWanxiang')
  assert.equal(selected.uiOnly, false)
  assert.equal(selected.latency, '')
  assert.equal(options.find((option) => option.value === 'Kling 3.0').label, '可灵-Omni')
  assert.deepEqual(values, before)
})

test('Wanxiang display rename preserves saved identity, parameters and icon', () => {
  const saved = {
    value: '万相 3.0',
    label: '万相 3.0',
    params: { ratio: '9:16', duration: 8 },
  }
  const before = structuredClone(saved)
  const displayed = modelPresentation(saved, 'video')
  assert.equal(displayed.label, '万相 3.0 全能')
  assert.equal(displayed.value, saved.value)
  assert.equal(displayed.icon, 'modelWanxiang')
  assert.deepEqual(displayed.params, saved.params)
  assert.deepEqual(saved, before)
})

test('Wanxiang legacy menu alias cannot submit before an exact managed route is resolved', () => {
  const node = {
    id: 'wanxiang-test',
    data: { kind: 'video', model: '万相 3.0', prompt: '镜头缓慢推进', params: {} },
  }
  assert.throws(() => videoTaskRequest(node, [], 'wanxiang-test'), /请选择模型管理中已配置/)
})

test('Wanxiang configured routes retain branding and never borrow another API through its editable label', () => {
  const configured = [
    { value: 'model-api-key:wan', model: WANXIANG_MODEL, label: '我的线路' },
    { value: 'model-api-key:not-wan', model: 'other-api', label: '万相 3.0 全能' },
  ]
  const before = structuredClone(configured)
  const options = videoModelOptions(['万相 3.0'], configured)
  assert.deepEqual(
    options.map((item) => item.value),
    ['model-api-key:wan'],
  )
  assert.equal(options[0].label, '万相 3.0 全能')
  const selected = modelPresentation(configured[0], 'video')
  assert.equal(selected.label, '万相 3.0 全能')
  assert.equal(selected.icon, 'modelWanxiang')
  assert.equal(selected.uiOnly, false)
  assert.equal(resolveWanxiangRoute('万相 3.0', configured), configured[0])
  assert.deepEqual(configured, before)
})
