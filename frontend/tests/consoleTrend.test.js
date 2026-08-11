import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyTopSeries, buildTotalTrendSeries } from '../src/utils/consoleTrend.js'

function trend(key, dailyImages) {
  return {
    key,
    label: key,
    daily: Object.entries(dailyImages).map(([day, images]) => ({ day, tasks: images, images })),
  }
}

test('builds five rank lines whose members can change every day', () => {
  const rows = [
    trend('A', { '2026-07-29': 10, '2026-07-30': 1 }),
    trend('B', { '2026-07-29': 9, '2026-07-30': 9 }),
    trend('C', { '2026-07-29': 8, '2026-07-30': 8 }),
    trend('D', { '2026-07-29': 7, '2026-07-30': 7 }),
    trend('E', { '2026-07-29': 6, '2026-07-30': 6 }),
    trend('F', { '2026-07-29': 1, '2026-07-30': 9 }),
  ]

  const result = buildDailyTopSeries(rows, ['2026-07-29', '2026-07-30'])

  assert.equal(result.length, 5)
  assert.equal(result[0].label, '第 1 名')
  assert.deepEqual(
    result[0].daily.map((point) => point.entityLabel),
    ['A', 'B'],
  )
  assert.deepEqual(
    result[1].daily.map((point) => point.entityLabel),
    ['B', 'F'],
  )
  assert.equal(result[0].todayLabel, 'B')
  assert.equal(result[0].todayValue, 9)
  assert.equal(result[0].dailyTopOnly, true)
})

test('does not add zero-task rows to a daily ranking', () => {
  const result = buildDailyTopSeries(
    [trend('A', { '2026-07-30': 3 }), trend('B', { '2026-07-30': 0 })],
    ['2026-07-30'],
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].daily[0].entityLabel, 'A')
  assert.equal(result[0].daily[0].value, 3)
})

test('ranks by generated image count instead of submitted task count', () => {
  const result = buildDailyTopSeries(
    [
      { key: 'A', label: 'A', daily: [{ day: '2026-07-30', tasks: 10, images: 1 }] },
      { key: 'B', label: 'B', daily: [{ day: '2026-07-30', tasks: 2, images: 4 }] },
    ],
    ['2026-07-30'],
  )

  assert.equal(result[0].daily[0].entityLabel, 'B')
  assert.equal(result[0].daily[0].value, 4)
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
