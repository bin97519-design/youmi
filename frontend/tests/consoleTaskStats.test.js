import test from 'node:test'
import assert from 'node:assert/strict'
import { consoleTaskStatsUrl, mergeConsoleTaskStats, normalizeConsoleTaskStats } from '../src/utils/consoleTaskStats.js'

test('each task category requests its own stats with the selected date range', () => {
  assert.equal(consoleTaskStatsUrl('image', '', ''), '/api/admin/image-stats')
  assert.equal(consoleTaskStatsUrl('video', '2026-10-01', '2026-10-10'),
    '/api/admin/video-stats?taskType=VIDEO&dateFrom=2026-10-01&dateTo=2026-10-10')
  assert.equal(consoleTaskStatsUrl('enhance', '', ''), '/api/admin/video-stats?taskType=VIDEO_ENHANCE')
  assert.throws(() => consoleTaskStatsUrl('all', '', ''), /Unknown task stats category/)
})

test('video results do not become image thumbnails or fabricate completed status', () => {
  const result = normalizeConsoleTaskStats({ tasks: [
    { taskType: 'VIDEO', status: 'persisting', videoUrls: ['https://assets.test/clip.mp4'] },
    { taskType: 'VIDEO_ENHANCE', status: 'completed', videoUrls: ['https://assets.test/hd.mp4', 'https://assets.test/hd.mp4'] },
    { taskType: 'VIDEO', status: 'failed', videoUrls: ['https://assets.test/failed.mp4'] },
  ] })
  assert.deepEqual(result.tasks[0].previewUrls, [])
  assert.equal(result.tasks[0].status, 'persisting')
  assert.deepEqual(result.tasks[1].videoPreviewUrls, ['https://assets.test/hd.mp4'])
  assert.deepEqual(result.tasks[2].videoPreviewUrls, [])
})

test('image persistence normalization remains unchanged', () => {
  const result = normalizeConsoleTaskStats({ tasks: [
    { status: 'running', imageUrls: '["https://assets.test/original.png"]', resultUrls: '["https://assets.test/saved.png"]' },
    { status: 'failed', imageUrls: ['https://assets.test/failed.png'] },
  ] })
  assert.equal(result.tasks[0].status, 'completed')
  assert.equal(result.tasks[0].persistStatus, 'DONE')
  assert.deepEqual(result.tasks[0].previewUrls, ['https://assets.test/saved.png'])
  assert.equal(result.tasks[1].status, 'failed')
})

test('overall statistics sum all three categories and weight provider success by finished tasks', () => {
  const image = {
    summary: { totalTasks: 10, completedTasks: 8, failedTasks: 1, processingTasks: 1, todayTasks: 3, totalImages: 12, totalMiCost: 80 },
    models: [{ model: 'image-model', tasks: 10, images: 12, miCost: 80 }],
    providers: [{ provider: 'shared', totalTasks: 10, successfulTasks: 8, failedTasks: 1, finishedTasks: 9, successRate: 88.9 }],
  }
  const video = {
    summary: { totalTasks: 4, completedTasks: 1, failedTasks: 1, processingTasks: 2, todayTasks: 1, totalVideos: 1, totalMiCost: 75 },
    providers: [{ provider: 'shared', totalTasks: 4, successfulTasks: 1, failedTasks: 1, finishedTasks: 2, successRate: 50 }],
  }
  const enhance = {
    summary: { totalTasks: 2, completedTasks: 1, failedTasks: 1, todayTasks: 2, totalVideos: 1, totalMiCost: 20 },
    providers: [{ provider: 'shared', totalTasks: 2, successfulTasks: 1, failedTasks: 1, finishedTasks: 2, successRate: 50 },
      { provider: 'unfinished', totalTasks: 1, successfulTasks: 0, failedTasks: 0, finishedTasks: 0, successRate: null }],
  }
  const result = mergeConsoleTaskStats(image, video, enhance)
  assert.deepEqual(result.summary, {
    totalTasks: 16, completedTasks: 10, failedTasks: 3, processingTasks: 3, todayTasks: 6,
    totalImages: 12, totalVideos: 2, totalMiCost: 175, totalMoneyCost: 0,
  })
  assert.equal(result.providers[0].totalTasks, 16)
  assert.equal(result.providers[0].finishedTasks, 13)
  assert.equal(result.providers[0].successRate, 10 * 100 / 13)
  assert.equal(result.providers[1].successRate, null)
})

test('overall trends merge shared models, accounts and shops by key and align daily points', () => {
  const point = { day: '2026-10-10', tasks: 2, failedTasks: 1, images: 3, miCost: 10 }
  const next = { day: '2026-10-10', tasks: 4, failedTasks: 1, videos: 2, miCost: 20 }
  const earlier = { day: '2026-10-09', tasks: 1, videos: 1, miCost: 5 }
  const image = {
    daily: [point], models: [{ model: 'shared', tasks: 2, images: 3, miCost: 10 }],
    userTrends: [{ key: 'user', label: 'Account', totalTasks: 2, daily: [point] }],
    shopTrends: [{ key: 7, label: 'Shop', totalTasks: 2, daily: [point] }],
    modelTrends: [{ key: 'shared', label: 'shared', totalTasks: 2, daily: [point] }],
  }
  const video = {
    daily: [next, earlier], models: [{ model: 'shared', tasks: 5, videos: 3, miCost: 25 }],
    userTrends: [{ key: 'user', label: 'Account', totalTasks: 5, daily: [next, earlier] }],
    shopTrends: [{ key: '7', label: 'Shop', totalTasks: 5, daily: [next, earlier] }],
    modelTrends: [{ key: 'shared', label: 'shared', totalTasks: 5, daily: [next, earlier] }],
  }
  const original = structuredClone(image)
  const result = mergeConsoleTaskStats(image, video, {})
  assert.equal(result.models.length, 1)
  assert.deepEqual(result.models[0], { model: 'shared', tasks: 7, images: 3, videos: 3, miCost: 35, moneyCost: 0 })
  assert.deepEqual(result.daily.map((row) => row.day), ['2026-10-09', '2026-10-10'])
  assert.deepEqual(result.daily[1], { day: '2026-10-10', tasks: 6, failedTasks: 2, images: 3, videos: 2, miCost: 30, moneyCost: 0 })
  for (const field of ['userTrends', 'shopTrends', 'modelTrends']) {
    assert.equal(result[field].length, 1)
    assert.equal(result[field][0].totalTasks, 7)
    assert.deepEqual(result[field][0].daily, result.daily)
  }
  assert.deepEqual(image, original)
})

test('overall task list retains media types and is capped after sorting all categories together', () => {
  const tasks = Array.from({ length: 500 }, (_, index) => ({ taskId: `image:${index}`, createdAt: '2026-10-09T09:00:00' }))
  const image = { tasks }
  const video = { tasks: [{ taskId: 'video', createdAt: '2026-10-10T09:00:00', status: 'completed', videoUrls: ['https://assets.test/video.mp4'] }] }
  const enhance = { tasks: [{ taskId: 'hd', createdAt: '2026-10-10T10:00:00', status: 'completed', videoUrls: ['https://assets.test/hd.mp4'] }] }
  const result = normalizeConsoleTaskStats(mergeConsoleTaskStats(image, video, enhance))
  assert.equal(result.tasks.length, 500)
  assert.deepEqual(result.tasks.slice(0, 3).map((task) => task.taskType), ['VIDEO_ENHANCE', 'VIDEO', 'IMAGE'])
  assert.equal(result.tasks[0].taskId, 'hd')
  assert.deepEqual(result.tasks[1].videoPreviewUrls, ['https://assets.test/video.mp4'])
  assert.deepEqual(result.tasks[2].previewUrls, [])
  assert.equal(image.tasks[0].taskType, undefined)
})

test('overall model chart includes image models omitted from the top-model endpoint', () => {
  const image = { summary: { totalTasks: 100, totalImages: 80, totalMiCost: 900 },
    models: [{ model: 'top-image', tasks: 90, images: 75, miCost: 850 }] }
  const result = mergeConsoleTaskStats(image, {}, {})
  assert.equal(result.models.reduce((sum, model) => sum + model.tasks, 0), 100)
  assert.equal(result.models[1].tasks, 10)
  assert.equal(result.models[1].images, 5)
  assert.equal(result.models[1].miCost, 50)
  assert.equal(image.models.length, 1)
  assert.equal(mergeConsoleTaskStats().summary.totalTasks, 0)
})
