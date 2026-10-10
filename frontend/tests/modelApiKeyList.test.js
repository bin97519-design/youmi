import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalModelApiProvider,
  filterModelApiKeys,
  joinModelApiEndpoint,
  modelApiRouteLabel,
  summarizeModelApiKeys,
} from '../src/utils/modelApiKeyList.js'

const rows = [
  {
    id: 3,
    name: 'GPT 快速',
    model: 'GPT-image2.5',
    modelType: 'image_generation',
    provider: 'youmi888',
    baseUrl: 'https://api.lk888.ai',
    generationPath: '/v1/media/generate',
    taskPath: '/v1/skills/task-status',
    apiKeyMasked: 'sk-a****1234',
    enabled: true,
    priority: 100,
  },
  {
    id: 4,
    name: 'GPT 备用',
    model: 'gpt-image2.5',
    modelType: 'image_generation',
    provider: 'model-api',
    baseUrl: 'https://backup.example.com/',
    generationPath: 'generate',
    taskPath: '/status',
    apiKeyMasked: 'sk-b****5678',
    enabled: true,
    priority: 50,
  },
  {
    id: 5,
    name: 'Banana',
    model: 'banana-2.1',
    modelType: 'video_generation',
    provider: 'LK888',
    baseUrl: 'https://api.lk888.ai',
    generationPath: '/v1/media/generate',
    taskPath: '/v1/skills/task-status',
    apiKeyMasked: 'sk-c****9999',
    enabled: false,
    priority: 80,
  },
]

test('灵科历史中转站标识在列表中归为同一组', () => {
  assert.equal(canonicalModelApiProvider('LK888'), 'lingke')
  assert.equal(canonicalModelApiProvider('youmi888'), 'lingke')
  assert.equal(canonicalModelApiProvider('model-api:42'), 'lingke')
  assert.deepEqual(summarizeModelApiKeys(rows), {
    total: 3,
    enabled: 2,
    disabled: 1,
    models: 2,
    providers: 1,
    imageGeneration: 2,
    videoGeneration: 1,
    visionReasoning: 0,
  })
})

test('密钥列表可按状态、中转站和全字段搜索', () => {
  assert.deepEqual(
    filterModelApiKeys(rows, { search: 'backup', status: 'enabled', provider: 'lingke' }).map(
      (row) => row.id,
    ),
    [4],
  )
  assert.deepEqual(
    filterModelApiKeys(rows, {
      search: '9999',
      status: 'disabled',
      modelType: 'video_generation',
    }).map((row) => row.id),
    [5],
  )
})

test('路由顺位与后端优先级和 ID 排序一致', () => {
  assert.equal(modelApiRouteLabel(rows[0], rows), '主线路')
  assert.equal(modelApiRouteLabel(rows[1], rows), '备用 1')
  assert.equal(modelApiRouteLabel(rows[2], rows), '未参与路由')
  assert.equal(joinModelApiEndpoint('https://api.lk888.ai/', 'v1/media/generate'), 'https://api.lk888.ai/v1/media/generate')
})
