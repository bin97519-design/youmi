import { prepareMigrationWithConfirmation } from './jdSkuPreflightFlow'

const REQUEST_CHANNEL = 'YOUMI_PRODUCT_MOVER_REQUEST'
const RESPONSE_CHANNEL = 'YOUMI_PRODUCT_MOVER_RESPONSE'
const PAGE_SOURCE = 'youmi-selection-pool'
const EXTENSION_SOURCE = 'youmi-product-mover-extension'
const DEFAULT_TIMEOUT = 5000

let requestSequence = 0

function nextRequestId() {
  requestSequence += 1
  return `youmi-${Date.now()}-${requestSequence}`
}

export function productMoverApiBase() {
  const configured = String(import.meta.env?.VITE_PRODUCT_MOVER_API_BASE || '').trim()
  if (configured) return configured.replace(/\/+$/, '')
  return 'http://127.0.0.1:8083'
}

export function sendProductMoverRequest(action, payload = {}, options = {}) {
  if (typeof window === 'undefined') return Promise.reject(new Error('当前环境无法连接浏览器插件'))

  const requestId = nextRequestId()
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('未检测到有米商品搬家插件，请确认插件已启用并刷新页面'))
    }, timeout)

    function cleanup() {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }

    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (
        message?.source !== EXTENSION_SOURCE ||
        message?.channel !== RESPONSE_CHANNEL ||
        message?.requestId !== requestId
      )
        return

      cleanup()
      if (!message.response?.ok) {
        reject(new Error(message.response?.error || '插件动作执行失败'))
        return
      }
      resolve(message.response.result)
    }

    window.addEventListener('message', onMessage)
    window.postMessage(
      {
        source: PAGE_SOURCE,
        channel: REQUEST_CHANNEL,
        requestId,
        action,
        payload,
      },
      window.location.origin,
    )
  })
}

export function probeProductMover() {
  return sendProductMoverRequest('PING', {}, { timeout: 1800 })
}

export function openProductMoverWorkbench() {
  return sendProductMoverRequest('OPEN_WORKBENCH')
}

export function prepareProductMoverMigration(payload, confirm) {
  return prepareMigrationWithConfirmation(
    payload,
    (request) => sendProductMoverRequest('PREPARE_MIGRATION', request, { timeout: 120000 }),
    confirm,
  )
}

export function removeProductMoverTaskCache(payload) {
  return sendProductMoverRequest('REMOVE_TASK_CACHE', payload, { timeout: 120000 })
}
