import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyTopSeries } from '../src/utils/consoleTrend.js'

function trend(key, totalTasks, dailyTasks) {
  return {
    key,
    label: key,
    totalTasks,
    daily: Object.entries(dailyTasks).map(([day, tasks]) => ({ day, tasks })),
  }
}

test('keeps only each day top five while preserving changing leaders', () => {
  const rows = [
    trend('A', 11, { '2026-07-29': 10, '2026-07-30': 1 }),
    trend('B', 18, { '2026-07-29': 9, '2026-07-30': 9 }),
    trend('C', 16, { '2026-07-29': 8, '2026-07-30': 8 }),
    trend('D', 14, { '2026-07-29': 7, '2026-07-30': 7 }),
    trend('E', 12, { '2026-07-29': 6, '2026-07-30': 6 }),
    trend('F', 10, { '2026-07-29': 1, '2026-07-30': 9 }),
  ]

  const result = buildDailyTopSeries(rows, ['2026-07-29', '2026-07-30'])
  const byKey = new Map(result.map((row) => [row.key, row]))

  assert.equal(result.length, 5)
  assert.equal(byKey.has('A'), false)
  assert.deepEqual(
    byKey.get('F').daily.map((point) => point.day),
    ['2026-07-29', '2026-07-30'],
  )
  assert.equal(byKey.get('B').topDays, 2)
  assert.equal(byKey.get('B').dailyTopOnly, false)
  assert.equal(byKey.get('B').todayRank, 1)
  assert.equal(byKey.has('F'), true)
})

test('does not add zero-task rows to a daily ranking', () => {
  const result = buildDailyTopSeries(
    [trend('A', 3, { '2026-07-30': 3 }), trend('B', 0, { '2026-07-30': 0 })],
    ['2026-07-30'],
  )

  assert.deepEqual(
    result.map((row) => row.key),
    ['A'],
  )
})
