import { computed, onScopeDispose, ref, unref, watch } from 'vue'
import {
  canvasPricingDisplay,
  canvasPricingTitle,
  createCanvasPricingClient,
  normalizeCanvasPricingQuote,
} from '../sync/canvasPricingClient.js'

function stable(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
}

/** Injectable, non-persistent coordinator. Its only side effect is calling the
 * authenticated local pricing client; it never creates a task or changes a node. */
export function createCanvasPricingController({
  client,
  onChange = () => {},
  debounceMs = 300,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  maxCacheEntries = 100,
} = {}) {
  const cache = new Map()
  let state = { status: 'idle', quote: null, message: '请选择模型与参数' }
  let timer,
    expiryTimer,
    abort,
    sequence = 0,
    key = '',
    current,
    stopped = false
  function publish(next) {
    state = next
    onChange(next)
  }
  function cancel() {
    sequence += 1
    if (timer != null) clearTimer(timer)
    if (expiryTimer != null) clearTimer(expiryTimer)
    timer = expiryTimer = undefined
    abort?.abort()
    abort = null
  }
  function scheduleExpiry(quote) {
    expiryTimer = setTimer(
      () => {
        expiryTimer = undefined
        if (current && !stopped) update(current.input, current.scope, current.enabled, true)
      },
      Math.max(1, quote.expiresAt - now()),
    )
  }
  function ready(quote) {
    publish({ status: 'ready', quote, message: quote.message || '' })
    scheduleExpiry(quote)
  }
  function update(input, scope, enabled = true, force = false) {
    if (stopped) return
    const body = input?.request || null
    const nextKey =
      enabled && body ? stable([scope, body]) : stable([scope, null, enabled, input?.message || ''])
    current = { input, scope, enabled }
    if (!force && nextKey === key) return
    cancel()
    key = nextKey
    if (!enabled) {
      publish({ status: 'idle', quote: null, message: '登录后可查询预估米值' })
      return
    }
    if (!body) {
      publish({
        status: 'unavailable',
        quote: null,
        message: input?.message || '当前参数暂不能预估米值',
      })
      return
    }
    const cached = !force && cache.get(key)
    if (cached && cached.expiresAt > now()) {
      ready(cached)
      return
    }
    if (cached) cache.delete(key)
    // Old numbers disappear synchronously, including during the debounce delay.
    publish({ status: 'loading', quote: null, message: '正在查询预估米值' })
    const ownSequence = sequence
    timer = setTimer(
      async () => {
        timer = undefined
        abort = new AbortController()
        const requestAbort = abort
        try {
          const payload = await client.estimate(body, { signal: requestAbort.signal })
          if (stopped || sequence !== ownSequence || requestAbort.signal.aborted) return
          const quote = normalizeCanvasPricingQuote(payload, now())
          if (!quote.available) {
            publish({ status: 'unavailable', quote: null, message: quote.message })
            return
          }
          cache.delete(key)
          cache.set(key, quote)
          while (cache.size > Math.max(1, maxCacheEntries)) cache.delete(cache.keys().next().value)
          ready(quote)
        } catch (error) {
          if (stopped || sequence !== ownSequence || requestAbort.signal.aborted) return
          publish({
            status: 'unavailable',
            quote: null,
            message: normalizeCanvasPricingQuote({
              available: false,
              message: error?.message || '暂时无法查询预估米值',
            }).message,
          })
        } finally {
          if (abort === requestAbort) abort = null
        }
      },
      Math.max(0, debounceMs),
    )
  }
  return {
    update,
    refresh() {
      if (current) update(current.input, current.scope, current.enabled, true)
    },
    dispose() {
      stopped = true
      cancel()
      cache.clear()
      current = null
      publish({ status: 'idle', quote: null, message: '' })
    },
    get state() {
      return state
    },
  }
}

export function useCanvasPricing({
  request,
  input = request,
  scope,
  enabled = true,
  headers,
  path,
  fetcher,
  client,
  debounceMs = 300,
} = {}) {
  const state = ref({ status: 'idle', quote: null, message: '请选择模型与参数' })
  const controller = createCanvasPricingController({
    client: client || createCanvasPricingClient({ headers, path, fetcher }),
    debounceMs,
    onChange: (next) => {
      state.value = next
    },
  })
  const stop = watch(
    [() => unref(input), () => unref(scope), () => unref(enabled)],
    ([next, currentScope, active]) => controller.update(next, currentScope, active),
    { immediate: true, deep: true, flush: 'sync' },
  )
  onScopeDispose(() => {
    stop()
    controller.dispose()
  })
  return {
    status: computed(() => state.value.status),
    quote: computed(() => state.value.quote),
    amount: computed(() => state.value.quote?.amount ?? null),
    display: computed(() =>
      state.value.status === 'loading' ? '…' : canvasPricingDisplay(state.value.quote),
    ),
    title: computed(() =>
      state.value.status === 'loading'
        ? '正在查询预估米值'
        : state.value.quote
          ? canvasPricingTitle(state.value.quote)
          : state.value.message,
    ),
    refresh: () => controller.refresh(),
  }
}
