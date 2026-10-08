import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyRecoveryStore } from '../src/utils/selectionCopyStorage.js'

test('copy recovery waits for IndexedDB commit and reads/removes large product snapshots', async () => {
  const previous = globalThis.indexedDB
  const rows = new Map()
  const complete = []
  let closes = 0
  let abort = false
  globalThis.indexedDB = {
    open() {
      const request = {}
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          close: () => closes++,
          transaction(_name, mode) {
            const tx = {}
            const perform = (action) => {
              const result = {}
              complete.push(() => {
                if (abort) {
                  tx.error = new Error('quota reached')
                  tx.onabort()
                } else {
                  result.result = action()
                  tx.oncomplete()
                }
              })
              return result
            }
            tx.objectStore = () => ({
              get: (key) => perform(() => rows.get(key)),
              put: (value, key) =>
                perform(() => {
                  assert.equal(mode, 'readwrite')
                  rows.set(key, structuredClone(value))
                }),
              delete: (key) => perform(() => rows.delete(key)),
            })
            return tx
          },
        }
        request.onsuccess()
      })
      return request
    },
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  try {
    const snapshot = { rawSnapshot: 'x'.repeat(6 * 1024 * 1024) }
    let committed = false
    const write = copyRecoveryStore.write('account-1:11', snapshot).then(() => {
      committed = true
    })
    await tick()
    assert.equal(committed, false)
    complete.shift()()
    await write
    const read = copyRecoveryStore.read('account-1:11')
    await tick()
    complete.shift()()
    assert.deepEqual(await read, snapshot)
    const remove = copyRecoveryStore.remove('account-1:11')
    await tick()
    complete.shift()()
    await remove
    assert.equal(rows.size, 0)
    abort = true
    const failed = copyRecoveryStore.write('account-1:11', snapshot)
    const rejected = assert.rejects(failed, /quota/)
    await tick()
    complete.shift()()
    await rejected
    assert.equal(rows.size, 0)
    assert.equal(closes, 4)
  } finally {
    globalThis.indexedDB = previous
  }
})
