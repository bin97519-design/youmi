function taskCountForDay(row, day) {
  const point = (row?.daily || []).find((item) => item?.day === day)
  return Number(point?.tasks || 0)
}

export function buildDailyTopSeries(rows, days, limit = 5) {
  const candidates = Array.isArray(rows) ? rows : []
  const visibleDays = Array.isArray(days) ? days : []
  const topLimit = Math.max(1, Number(limit) || 5)
  const rankings = new Map()

  visibleDays.forEach((day) => {
    const ranked = candidates
      .map((row) => ({ row, tasks: taskCountForDay(row, day) }))
      .filter((item) => item.tasks > 0)
      .sort(
        (left, right) =>
          right.tasks - left.tasks ||
          Number(right.row?.totalTasks || 0) - Number(left.row?.totalTasks || 0) ||
          String(left.row?.label || left.row?.key || '').localeCompare(
            String(right.row?.label || right.row?.key || ''),
            'zh-CN',
          ),
      )
      .slice(0, topLimit)

    rankings.set(
      day,
      new Map(
        ranked.map((item, index) => [String(item.row.key), { rank: index + 1, tasks: item.tasks }]),
      ),
    )
  })

  // Use today's ranking as the stable selection for the 14-day trend.
  const anchorDay = visibleDays[visibleDays.length - 1]
  const anchorRanking = rankings.get(anchorDay)
  if (!anchorRanking) return []

  const selectedKeys = new Set([...anchorRanking.keys()].slice(0, topLimit))

  return candidates
    .filter((row) => selectedKeys.has(String(row?.key || '')))
    .map((row) => {
      const key = String(row?.key || '')
      const rankedToday = anchorRanking.get(key)
      const rankedDaily = visibleDays.map((day) => {
        const point = (row.daily || []).find((item) => item?.day === day)
        return point ? { ...point } : { day, tasks: 0 }
      })
      const activeDaily = rankedDaily.filter((point) => Number(point.tasks || 0) > 0)

      return {
        ...row,
        daily: rankedDaily,
        dailyTopOnly: false,
        todayRank: rankedToday?.rank || 0,
        todayTasks: rankedToday?.tasks || 0,
        topDays: activeDaily.length,
        topTasks: activeDaily.reduce((sum, point) => sum + Number(point.tasks || 0), 0),
      }
    })
    .filter((row) => row.topDays > 0)
    .sort(
      (left, right) =>
        Number(left.todayRank || Number.MAX_SAFE_INTEGER) -
          Number(right.todayRank || Number.MAX_SAFE_INTEGER) ||
        Number(right.totalTasks || 0) - Number(left.totalTasks || 0),
    )
}
