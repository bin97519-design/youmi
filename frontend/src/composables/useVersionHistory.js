import { computed, ref } from 'vue'
import packageInfo from '../../package.json'

const LAST_SEEN_KEY = 'youmi:version-log:last-seen'
const LAST_NOTIFIED_KEY = 'youmi:version-log:last-notified'

const versionHistoryOpen = ref(false)
const lastSeenVersion = ref(readStorage(LAST_SEEN_KEY))
const lastNotifiedVersion = ref(readStorage(LAST_NOTIFIED_KEY))
const currentAppVersion = packageInfo.version

function readStorage(key) {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStorage(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The unread marker is optional when storage is unavailable.
  }
}

const hasUnreadVersion = computed(() => lastSeenVersion.value !== currentAppVersion)
const shouldNotifyVersion = computed(() => lastNotifiedVersion.value !== currentAppVersion)

function openVersionHistory() {
  versionHistoryOpen.value = true
  lastSeenVersion.value = currentAppVersion
  writeStorage(LAST_SEEN_KEY, currentAppVersion)
}

function closeVersionHistory() {
  versionHistoryOpen.value = false
}

function markVersionNotified() {
  lastNotifiedVersion.value = currentAppVersion
  writeStorage(LAST_NOTIFIED_KEY, currentAppVersion)
}

export function useVersionHistory() {
  return {
    currentAppVersion,
    versionHistoryOpen,
    hasUnreadVersion,
    shouldNotifyVersion,
    openVersionHistory,
    closeVersionHistory,
    markVersionNotified,
  }
}
