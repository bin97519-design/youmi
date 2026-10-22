const safeMessage = (value, fallback) =>
  typeof value === 'string' && value.trim()
    ? value
        .replace(/sk-[A-Za-z0-9_-]+/g, '[已隐藏]')
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [已隐藏]')
        .slice(0, 300)
    : fallback

// This endpoint is a read-only estimate operation, not a generation submission.
// Never expose the upstream model key or send a request directly to a provider.
export function createCanvasPricingClient({
  fetcher = (...args) => fetch(...args),
  path = (value) => value,
  headers = () => ({}),
} = {}) {
  return {
    async estimate(body, { signal } = {}) {
      const response = await fetcher(path('/api/canvas-pricing/estimate'), {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || (payload.code != null && payload.code !== 0)) {
        const error = new Error(
          safeMessage(payload?.message, `暂时无法查询预估米值（${response.status}）`),
        )
        error.status = response.status
        throw error
      }
      return payload.data ?? payload
    },
  }
}

function decimalText(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null
    value = String(value)
    const exponent = /^(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(value)
    if (exponent) {
      const digits = exponent[1] + (exponent[2] || '')
      const position = exponent[1].length + Number(exponent[3])
      if (position <= 0) value = `0.${'0'.repeat(-position)}${digits}`
      else if (position >= digits.length) value = digits + '0'.repeat(position - digits.length)
      else value = `${digits.slice(0, position)}.${digits.slice(position)}`
    }
  }
  if (typeof value !== 'string' || value.length > 100 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    return null
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}

function decimalCompare(left, right) {
  const [leftWhole, leftFraction = ''] = left.split('.')
  const [rightWhole, rightFraction = ''] = right.split('.')
  if (leftWhole.length !== rightWhole.length) return leftWhole.length < rightWhole.length ? -1 : 1
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1
  const length = Math.max(leftFraction.length, rightFraction.length)
  const a = leftFraction.padEnd(length, '0'),
    b = rightFraction.padEnd(length, '0')
  return a === b ? 0 : a < b ? -1 : 1
}

const timestamp = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN

export function normalizeCanvasPricingQuote(payload, now = Date.now()) {
  const unavailable = (message) => ({
    available: false,
    message: safeMessage(message, '当前参数暂无可靠报价'),
  })
  if (payload?.available !== true) return unavailable(payload?.message)
  if (payload.unit !== '米值' || !['estimate', 'precharge'].includes(payload.kind))
    return unavailable('报价单位或类型无效，暂不显示估算值')
  const amount = decimalText(payload.amount)
  const minAmount = decimalText(payload.minAmount),
    maxAmount = decimalText(payload.maxAmount)
  if (
    amount == null &&
    (minAmount == null || maxAmount == null || decimalCompare(minAmount, maxAmount) > 0)
  )
    return unavailable('报价数值无效，暂不显示估算值')
  const providedExpiry = payload.expiresAt == null ? now + 30000 : timestamp(payload.expiresAt)
  if (!Number.isFinite(providedExpiry) || providedExpiry <= now)
    return unavailable('报价已过期，请稍后重新查询')
  return {
    available: true,
    amount,
    minAmount: amount == null ? minAmount : amount,
    maxAmount: amount == null ? maxAmount : amount,
    unit: '米值',
    kind: payload.kind,
    message: safeMessage(payload.message, ''),
    source: safeMessage(payload.source, ''),
    model: safeMessage(payload.model, ''),
    pricingUpdatedAt: Number.isFinite(timestamp(payload.pricingUpdatedAt))
      ? timestamp(payload.pricingUpdatedAt)
      : null,
    expiresAt: Math.min(providedExpiry, now + 300000),
    platformUnit: safeMessage(payload.platformUnit, ''),
    sourceAmount: decimalText(payload.sourceAmount),
    sourceMinAmount: decimalText(payload.sourceMinAmount),
    sourceMaxAmount: decimalText(payload.sourceMaxAmount),
    conversionMultiplier: decimalText(payload.conversionMultiplier),
  }
}

export function canvasPricingDisplay(quote) {
  if (quote?.available !== true) return '—'
  if (quote.amount != null) return fixedTwo(quote.amount)
  const minimum = fixedTwo(quote.minAmount),
    maximum = fixedTwo(quote.maxAmount)
  return minimum === maximum ? minimum : `${minimum}–${maximum}`
}

// Decimal-string rounding avoids binary floating point changing a displayed
// amount (and always retains two places, including integer and zero estimates).
function fixedTwo(value) {
  const [whole, fraction = ''] = value.split('.')
  const digits = fraction.padEnd(3, '0')
  let cents = BigInt(whole) * 100n + BigInt(digits.slice(0, 2))
  if (digits[2] >= '5') cents += 1n
  const text = cents.toString().padStart(3, '0')
  return `${text.slice(0, -2)}.${text.slice(-2)}`
}

export function canvasPricingTitle(quote) {
  if (quote?.available !== true) return safeMessage(quote?.message, '当前参数暂无可靠报价')
  return [
    `${quote.kind === 'precharge' ? '预计预扣' : '预计消耗'} ${canvasPricingDisplay(quote)} 米值，以实际结算为准`,
    quote.platformUnit && quote.conversionMultiplier
      ? `平台${quote.platformUnit}按现有记账比例 ×${quote.conversionMultiplier}换算为米值`
      : '',
    quote.message,
  ]
    .filter(Boolean)
    .join('；')
}

export function canvasPricingWarning(quote) {
  if (quote?.available !== true) return ''
  const lower = quote.amount ?? quote.minAmount
  const upper = quote.amount ?? quote.maxAmount
  if (lower == null || upper == null || decimalCompare(upper, '500') <= 0) return ''
  return decimalCompare(lower, '500') > 0
    ? '预计消耗超过 500.00 米值，约合超过 5 元，以实际结算为准。'
    : '预计消耗可能超过 500.00 米值（约合超过 5 元），以实际结算为准。'
}
