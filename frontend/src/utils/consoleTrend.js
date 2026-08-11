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

export function buildDailyTopSeries(rows, days, limit = 5, metric = 'images') {
  const candidates = Array.isArray(rows) ? rows : []
  const visibleDays = Array.isArray(days) ? days : []
  const topLimit = Math.max(1, Number(limit) || 5)

  const rankings = visibleDays.map((day) =>
    candidates
      .map((row) => {
        const point = pointForDay(row, day)
        return {
          row,
          point,
          value: metricValue(point, metric),
        }
      })
      .filter((item) => item.value > 0)
      .sort(
        (left, right) =>
          right.value - left.value ||
          totalMetricValue(right.row, metric) - totalMetricValue(left.row, metric) ||
          String(left.row?.label || left.row?.key || '').localeCompare(
            String(right.row?.label || right.row?.key || ''),
            'zh-CN',
          ),
      )
      .slice(0, topLimit),
  )

  return Array.from({ length: topLimit }, (_, index) => {
    const rank = index + 1
    const daily = visibleDays.map((day, dayIndex) => {
      const ranked = rankings[dayIndex]?.[index]
      if (!ranked) {
        return {
          day,
          value: null,
          tasks: 0,
          images: 0,
          entityKey: '',
          entityLabel: '',
          rank,
        }
      }
      return {
        ...(ranked.point || {}),
        day,
        value: ranked.value,
        entityKey: String(ranked.row?.key || ''),
        entityLabel: ranked.row?.label || ranked.row?.key || '',
        rank,
      }
    })
    const today = daily[daily.length - 1]

    return {
      key: `daily-rank-${rank}`,
      label: `第 ${rank} 名`,
      rank,
      daily,
      dailyTopOnly: true,
      todayLabel: today?.entityLabel || '',
      todayValue: Number(today?.value || 0),
      totalValue: daily.reduce((sum, point) => sum + Number(point.value || 0), 0),
    }
  }).filter((series) => series.daily.some((point) => point.value != null))
}
