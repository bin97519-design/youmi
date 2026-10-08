export function assertProductMoverStorageReady(info) {
  if (info?.storage?.unlimited !== true) {
    throw new Error(
      `当前插件 ${info?.version || '版本未知'} 尚未启用存储扩容。请在 Chrome 扩展管理页重新加载有米商品搬家 0.9.12.115 或更新版，再刷新选品库。不要重复创建任务，原任务可在“待发布任务”中继续发布。`,
    )
  }
}

export function productMoverStorageLabel(info) {
  const storage = info?.storage
  const bytes = storage?.bytesInUse
  const usage =
    typeof bytes === 'number' && Number.isFinite(bytes)
      ? `，已用 ${(bytes / 1048576).toFixed(1)} MB`
      : ''
  return `插件 ${info?.version || '版本未知'} · ${storage?.unlimited ? '存储扩容已启用' : '存储未扩容，请重新加载 0.9.12.115 或更新版'}${usage}`
}

export function productMoverErrorMessage(error, fallback = '插件接管失败') {
  const message = error?.message || fallback
  return /kQuotaBytes|QUOTA_BYTES|quota.*exceeded/i.test(message)
    ? '插件本地存储配额不足。请重新加载 0.9.12.115 或更新版插件并刷新网页，再从待发布任务继续发布；不要重复新建。若仍失败，请发实际插件版本和存储占用。'
    : message
}
