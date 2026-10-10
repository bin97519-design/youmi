export function formatMiValue(value) {
  const amount = Number(value)
  return (Number.isFinite(amount) ? amount : 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
