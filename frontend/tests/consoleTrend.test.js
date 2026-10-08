import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFixedTrendSeries,
  buildTopEntityTrendSeries,
  buildTotalTrendSeries,
} from '../src/utils/consoleTrend.js'

function trend(key, dailyImages) {
  return {
    key,
    label: key,
    daily: Object.entries(dailyImages).map(([day, images]) => ({ day, tasks: images, images })),
  }
}

test('builds a fixed user line and fills missing days with zero', () => {
  const result = buildFixedTrendSeries(
    [trend('王慕怡', { '2026-09-19': 37 })],
    ['2026-09-19', '2026-09-20', '2026-09-21'],
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].label, '王慕怡')
  assert.deepEqual(
    result[0].daily.map((point) => point.images),
    [37, 0, 0],
  )
  assert.equal(result[0].dailyTopOnly, undefined)
})

test('keeps top entities fixed across the whole trend', () => {
  const result = buildTopEntityTrendSeries(
    [
      trend('A', { '2026-09-18': 20, '2026-09-19': 2 }),
      trend('B', { '2026-09-18': 1, '2026-09-19': 12 }),
      trend('C', { '2026-09-18': 8, '2026-09-19': 9 }),
    ],
    ['2026-09-18', '2026-09-19', '2026-09-20'],
    2,
  )

  assert.deepEqual(
    result.map((series) => series.label),
    ['B', 'C'],
  )
  assert.deepEqual(
    result[0].daily.map((point) => point.images),
    [1, 12, 0],
  )
  assert.equal(result[0].rankingDay, '2026-09-19')
  assert.equal(result[0].dailyTopOnly, undefined)
})

test('builds total and failed task lines from real daily metrics', () => {
  const result = buildTotalTrendSeries([
    { day: '2026-08-10', tasks: 12, failedTasks: 2 },
    { day: '2026-08-11', tasks: 9, failedTasks: 1 },
  ])

  assert.deepEqual(result.map((series) => series.label), ['总量', '失败任务'])
  assert.equal(result[0].totalTasks, 21)
  assert.equal(result[1].totalTasks, 3)
  assert.equal(result[1].metric, 'failedTasks')
  assert.equal(result[1].dashed, true)
})
