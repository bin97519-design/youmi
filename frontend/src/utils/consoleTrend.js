function pointForDay(row, day) {
  return (row?.daily || []).find((item) => item?.day === day)
}

function metricValue(point, metric) {
  return Number(point?.[metric] ?? point?.tasks ?? 0)
}

function totalMetricValue(row, metric) {
  return (row?.daily || []).reduce((sum, point) => sum + metricValue(point, metric), 0)
}

export function buildTotalTrendSeries(daily) {
  const points = Array.isArray(daily) ? daily : []
  return [
    {
      key: 'total',
      label: '总量',
      metric: 'tasks',
      color: '#18a8b8',
      totalTasks: totalMetricValue({ daily: points }, 'tasks'),
      daily: points,
    },
    {
      key: 'failed',
      label: '失败任务',
      metric: 'failedTasks',
      color: '#ed5f6d',
      dashed: true,
      totalTasks: totalMetricValue({ daily: points }, 'failedTasks'),
      daily: points,
    },
  ]
}

export function buildFixedTrendSeries(rows, days, limit = 1, metric = 'images') {
  const candidates = Array.isArray(rows) ? rows : []
  const visibleDays = Array.isArray(days) ? days : []
  const seriesLimit = Math.max(1, Number(limit) || 1)

  return candidates.slice(0, seriesLimit).map((row) => ({
    ...row,
    metric,
    daily: visibleDays.map((day) => {
      const point = pointForDay(row, day)
      if (point) return { ...point, day }
      return {
        day,
        tasks: 0,
        failedTasks: 0,
        images: 0,
        miCost: 0,
        moneyCost: 0,
        [metric]: 0,
      }
    }),
  }))
}

export function buildTopEntityTrendSeries(rows, days, limit = 5, metric = 'images') {
  const candidates = Array.isArray(rows) ? rows : []
  const visibleDays = Array.isArray(days) ? days : []
  const topLimit = Math.max(1, Number(limit) || 5)
  const rankingDay = [...visibleDays]
    .reverse()
    .find((day) => candidates.some((row) => metricValue(pointForDay(row, day), metric) > 0))

  if (!rankingDay) return []

  const rankedRows = candidates
    .map((row) => ({
      row,
      rankingValue: metricValue(pointForDay(row, rankingDay), metric),
      totalValue: totalMetricValue(row, metric),
    }))
    .filter((item) => item.rankingValue > 0)
    .sort(
      (left, right) =>
        right.rankingValue - left.rankingValue ||
        right.totalValue - left.totalValue ||
        String(left.row?.label || left.row?.key || '').localeCompare(
          String(right.row?.label || right.row?.key || ''),
          'zh-CN',
        ),
    )
    .slice(0, topLimit)
    .map((item) => item.row)

  return buildFixedTrendSeries(rankedRows, visibleDays, topLimit, metric).map((series) => ({
    ...series,
    rankingDay,
  }))
}
