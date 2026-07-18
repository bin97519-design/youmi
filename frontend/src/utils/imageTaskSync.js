const EVENT_NAME = 'youmi:image-task-persisted'
const CHANNEL_NAME = 'youmi-image-task-sync-v1'

let channel

function getChannel() {
  if (channel !== undefined) return channel
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null
  return channel
}

export function publishImageTaskPersistence(detail) {
  if (!detail?.taskId) return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }))
  getChannel()?.postMessage(detail)
}

export function subscribeImageTaskPersistence(handler) {
  if (typeof handler !== 'function') return () => {}
  const onWindowEvent = (event) => handler(event.detail || {})
  const onChannelMessage = (event) => handler(event.data || {})
  window.addEventListener(EVENT_NAME, onWindowEvent)
  getChannel()?.addEventListener('message', onChannelMessage)
  return () => {
    window.removeEventListener(EVENT_NAME, onWindowEvent)
    getChannel()?.removeEventListener('message', onChannelMessage)
  }
}
