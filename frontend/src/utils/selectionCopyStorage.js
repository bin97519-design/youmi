// Full product snapshots can exceed sessionStorage's string quota. Keep only pending
// copy jobs in IndexedDB and remove each job after the copy and tags are confirmed.
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('当前浏览器无法保存复制恢复记录'))
    const request = globalThis.indexedDB.open('youmi-product-copy', 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('pending'))
        request.result.createObjectStore('pending')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('复制恢复记录无法打开'))
  })
}

async function transact(mode, operation) {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('pending', mode)
      const request = operation(transaction.objectStore('pending'))
      transaction.oncomplete = () => resolve(request.result ?? null)
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error || request.error || new Error('复制恢复记录保存失败，未继续操作'))
    })
  } finally {
    database.close()
  }
}

export const copyRecoveryStore = {
  read: (key) => transact('readonly', (store) => store.get(key)),
  write: (key, value) => transact('readwrite', (store) => store.put(value, key)),
  remove: (key) => transact('readwrite', (store) => store.delete(key)),
}
