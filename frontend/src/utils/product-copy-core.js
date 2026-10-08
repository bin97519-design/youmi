// Shared by the web selection pool and the standalone extension workbench.
;(() => {
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const sameId = (a, b) => String(a) === String(b)
  const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0

  function newBatchId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器不支持安全生成副本编号')
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('')
  }

  function buildCopy(product, batchId) {
    if (
      !validId(product?.id) ||
      !product.sourcePlatform ||
      !product.title ||
      !product.productData ||
      typeof product.productData !== 'object' ||
      Array.isArray(product.productData)
    )
      throw new Error('未读取到完整商品资料，不能复制列表摘要')
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(batchId || '')) throw new Error('复制批次无效')
    const sourceProductId = 'copy_' + batchId
    if (sourceProductId === product.sourceProductId) throw new Error('副本不能覆盖原商品')
    const data = clone(product.productData)
    const originalProductId =
      product.originProductId || data.source?.originalProductId || product.sourceProductId
    data.sourceProductId = sourceProductId
    data.source = { ...data.source, productId: sourceProductId, originalProductId }
    data.productCopy = {
      batchId,
      parentRowId: product.id,
      parentSourceProductId: product.sourceProductId,
    }
    const payload = {
      sourcePlatform: product.sourcePlatform,
      sourceProductId,
      sourceUrl: product.sourceUrl,
      title: product.title,
      coverImageUrl: product.coverImageUrl,
      productData: data,
      rawSnapshot: clone(product.rawSnapshot || product.productData),
      collectSource: 'MANUAL',
      collectStatus: product.collectStatus || 'COLLECTED',
      qualityScore: product.qualityScore,
      originProductRowId: product.id,
      originProductId: originalProductId,
    }
    const tagIds = [...new Set((product.tags || []).map((tag) => tag.id))]
    if (tagIds.some((id) => !validId(id))) throw new Error('商品标签资料无效')
    return { parentId: product.id, batchId, payload, tagIds, saved: null }
  }

  function verifySaved(saved, job) {
    if (
      !validId(saved?.id) ||
      sameId(saved.id, job.parentId) ||
      saved.sourcePlatform !== job.payload.sourcePlatform ||
      saved.sourceProductId !== job.payload.sourceProductId
    )
      throw new Error('复制回执不完整，不能确认成功')
    return saved
  }

  function createCopier(io) {
    const flights = new Map()
    return {
      async copy(parentId) {
        if (!validId(parentId)) throw new Error('商品编号无效')
        const scope = io.getScope()
        if (!scope) throw new Error('请先登录选品库账号')
        const key = 'youmiProductCopy:' + encodeURIComponent(scope) + ':' + parentId
        if (flights.has(key)) return flights.get(key)
        const assertScope = () => {
          if (io.getScope() !== scope)
            throw new Error('账号或服务已切换，复制已暂停，请回到原账号重试')
        }
        const run = async () => {
          let job = await io.readPending(key)
          assertScope()
          if (!job) {
            const product = await io.fetchProduct(parentId)
            assertScope()
            if (!sameId(product?.id, parentId)) throw new Error('商品身份不一致，未执行复制')
            job = buildCopy(product, (io.uuid || newBatchId)())
            // Save before any server write. Refresh and retries reuse the same source identity.
            await io.writePending(key, job)
          }
          if (
            !sameId(job.parentId, parentId) ||
            !/^[a-zA-Z0-9-]{16,64}$/.test(job.batchId || '') ||
            job.payload?.sourceProductId !== 'copy_' + job.batchId
          )
            throw new Error('复制恢复记录异常，已停止，不能重新创建副本')
          assertScope()
          if (!job.saved) {
            const saved = verifySaved(await io.createProduct(clone(job.payload)), job)
            assertScope()
            job.saved = {
              id: saved.id,
              sourcePlatform: saved.sourcePlatform,
              sourceProductId: saved.sourceProductId,
            }
            await io.writePending(key, job)
          }
          verifySaved(job.saved, job)
          assertScope()
          if (job.tagIds.length) {
            await io.assignTags(job.saved.id, [...job.tagIds])
            assertScope()
          }
          // Only a fully verified copy is complete; a tag failure retries the same child.
          await io.removePending(key)
          return clone(job.saved)
        }
        const promise = run()
        flights.set(key, promise)
        try {
          return await promise
        } finally {
          flights.delete(key)
        }
      },
    }
  }
  globalThis.YoumiProductCopy = Object.freeze({ buildCopy, verifySaved, createCopier })
})()
