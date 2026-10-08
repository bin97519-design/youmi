/* Shared by the web editor and the extension. No DOM or network access. */
;(function (root) {
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const text = (value) => String(value ?? '').trim()
  const pid = (value) => text(value).replace(/^p-/, '')
  const vid = (value) => text(value).replace(/^v-/, '')
  const pathOf = (properties) => properties.map((p) => `${p.propertyId}:${p.valueId}`).join(';')
  const imageKeys = [
    'imageUrl',
    'image_url',
    'imgUrl',
    'img_url',
    'skuImageUrl',
    'sku_image_url',
    'picUrl',
    'pic_url',
    'pictureUrl',
    'thumbUrl',
    'thumb_url',
    'fullUrl',
    'full_url',
    'image',
    'img',
    'url',
  ]
  const imageLists = ['skuPicture', 'skuPictures', 'images', 'imageUrls', 'imageList', 'pictures']

  function imageUrls(groups = [], rows = []) {
    const urls = new Set()
    const collect = (value) => {
      if (typeof value === 'string') {
        const url = text(value).replace(/^\/\//, 'https://')
        if (/^https?:\/\//i.test(url)) urls.add(url)
      } else if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') {
        for (const key of [...imageKeys, ...imageLists, 'picture', 'skuPic']) collect(value[key])
      }
    }
    for (const group of groups) for (const value of group.values || []) collect(value)
    for (const row of rows) {
      collect(row)
      for (const property of row.properties || []) collect(property)
    }
    return [...urls]
  }

  // Remove only images proven to have lost their last binding. Keep shared images and
  // unassigned uploads in the editor pool; never promote those uploads to arbitrary SKUs.
  function syncImagePool(pool, previousGroups, previousRows, groups, rows) {
    const previous = new Set(imageUrls(previousGroups, previousRows))
    const current = new Set(imageUrls(groups, rows))
    return (pool || []).filter((url) => {
      const key = text(url).replace(/^\/\//, 'https://')
      return !previous.has(key) || current.has(key)
    })
  }

  function cleanGroups(groups) {
    return clone(groups).map((group) => {
      group.name = text(group.name)
      // Editor values are authoritative. Collector aliases must not resurrect deleted values.
      delete group.items
      for (const key of ['text', 'propertyName', 'groupName']) {
        if (key in group) group[key] = group.name
      }
      group.values = (group.values || []).map((value) => {
        value.name = text(value.name)
        for (const key of ['text', 'valueName', 'label']) {
          if (key in value) value[key] = value.name
        }
        return value
      })
      return group
    })
  }

  function shape(groups) {
    return JSON.stringify(
      groups.map((g) => [
        g.propertyId,
        g.name,
        g.values.map((v) => [v.valueId, v.name, v.imageUrl || '']),
      ]),
    )
  }

  function identify(row, groups) {
    const properties = row.properties?.length
      ? row.properties
      : row.propertyValues || row.props || []
    const tokens = text(row.propPath)
      .split(';')
      .map((part) => part.split(':'))
    const result = new Map()
    for (const group of groups) {
      const property =
        properties.find((p) => pid(p.propertyId || p.propId) === pid(group.propertyId)) ||
        properties.find((p) => !p.propertyId && text(p.propertyName || p.groupName) === group.name)
      const token = tokens.find(([id]) => pid(id) === pid(group.propertyId))
      const valueId = property?.valueId || property?.vid || token?.[1]
      let value = valueId ? group.values.find((v) => vid(v.valueId) === vid(valueId)) : null
      if (!value && !valueId && property) {
        const matches = group.values.filter(
          (v) => v.name === text(property.name || property.valueName),
        )
        if (matches.length === 1) value = matches[0]
      }
      if (!value)
        throw new Error(
          `SKU「${row.name || row.skuId || ''}」无法对应原${group.name}，请先核对规格资料`,
        )
      result.set(group.propertyId, value.valueId)
    }
    return result
  }

  function property(group, value) {
    return {
      propertyId: group.propertyId,
      propertyName: group.name,
      valueId: value.valueId,
      name: value.name,
      imageUrl: value.imageUrl || '',
    }
  }

  function updateRow(row, properties, previousProperties) {
    const updated = {
      ...clone(row),
      name: properties.map((p) => p.name).join(' / '),
      propPath: pathOf(properties),
      properties,
    }
    // A row inheriting a removed/replaced value image must not retain that old image
    // through skuPicture or collector aliases. Independent per-row images stay intact.
    const oldImages = new Set(imageUrls([], [{ properties: previousProperties }]))
    const currentImages = new Set(imageUrls([], [{ properties }]))
    const rowImage = imageUrls([], [{ ...row, properties: [] }])[0]
    if (rowImage && oldImages.has(rowImage) && !currentImages.has(rowImage)) {
      const replacement = [...currentImages][0] || ''
      for (const key of imageKeys) if (key in updated) updated[key] = replacement
      for (const key of imageLists)
        if (key in updated) updated[key] = replacement ? [{ url: replacement }] : []
      for (const key of ['picture', 'skuPic'])
        if (key in updated) updated[key] = replacement ? { url: replacement } : null
      updated.imageUrl = replacement
      updated.skuPicture = replacement ? [{ url: replacement, pix: '' }] : []
    }
    // Downstream normalizers merge these aliases; keep them consistent with the editor.
    for (const key of ['propertyValues', 'props']) {
      if (key in updated) updated[key] = clone(properties)
    }
    for (const key of ['skuName', 'specName']) {
      if (key in updated) updated[key] = updated.name
    }
    return updated
  }

  function mergeRows(rows) {
    const merged = rows[0]
    if (rows.length === 1) return merged
    const fields = [
      ['price', 'salePrice'],
      ['originalPrice', 'marketPrice'],
      ['quantity', 'stock'],
      ['imageUrl', 'skuPicture'],
      ['barcode', 'barCode'],
      ['outerId', 'outer_id'],
    ]
    const conflicts = []
    for (const keys of fields) {
      if (
        rows.some((row) =>
          keys.some((key) => JSON.stringify(row[key]) !== JSON.stringify(merged[key])),
        )
      ) {
        conflicts.push(keys[0])
        for (const key of keys) {
          if (key in merged)
            merged[key] =
              key === 'skuPicture' ? [] : ['quantity', 'stock'].includes(key) ? null : ''
        }
      }
    }
    // Several source SKUs became one. Never keep one source SKU's identity by accident.
    merged.skuId = `edited_${merged.propPath}`
    for (const key of ['id', 'sourceSkuId']) delete merged[key]
    if (conflicts.length) merged.skuSyncReview = conflicts
    return merged
  }

  function sync(groupsValue, rowsValue, previousValue, buildMatrix, defaults = {}) {
    const groups = cleanGroups(groupsValue)
    const previous = cleanGroups(previousValue)
    if (!groups.length)
      return { groups, rows: previous.length ? [] : clone(rowsValue), error: '', review: 0 }
    const incomplete = groups.some(
      (g) => !g.name || !g.values.length || g.values.some((v) => !v.name),
    )
    if (incomplete) {
      // Deleting the last value removes its combinations. A temporary blank name keeps data safe.
      const emptied = groups.some(
        (g) => !g.values.length && previous.some((p) => p.propertyId === g.propertyId),
      )
      return {
        groups,
        rows: emptied ? [] : clone(rowsValue),
        error: '请填写完整的规格组名称和规格值，SKU 同步完成后才能保存或拆分',
        review: 0,
      }
    }
    const ids = new Set()
    for (const group of groups) {
      if (!group.propertyId || ids.has(group.propertyId))
        throw new Error('规格组 ID 重复或缺失，无法同步 SKU')
      ids.add(group.propertyId)
      if (
        new Set(group.values.map((v) => v.valueId)).size !== group.values.length ||
        group.values.some((v) => !v.valueId)
      ) {
        throw new Error(`${group.name}的规格值 ID 重复或缺失，无法同步 SKU`)
      }
      if (new Set(group.values.map((v) => v.name)).size !== group.values.length) {
        throw new Error(`${group.name}存在同名规格值，请使用不同名称`)
      }
    }
    const total = groups.reduce((count, group) => count * group.values.length, 1)
    if (!Number.isSafeInteger(total) || total > 5000)
      throw new Error(`当前规格会生成 ${total} 个 SKU，最多支持 5000 个组合`)
    if (shape(groups) === shape(previous)) {
      return {
        groups,
        rows: clone(rowsValue),
        error: '',
        review: rowsValue.filter((r) => r.skuSyncReview?.length).length,
      }
    }
    if (!previous.length)
      return { groups, rows: buildMatrix(groups, [], defaults), error: '', review: 0 }
    const previousById = new Map(previous.map((g) => [g.propertyId, g]))
    const rowsByPath = new Map()
    for (const row of rowsValue) {
      const chosen = identify(row, previous)
      if (
        groups.some(
          (g) =>
            chosen.has(g.propertyId) &&
            !g.values.some((v) => v.valueId === chosen.get(g.propertyId)),
        )
      )
        continue
      let combinations = [[]]
      for (const group of groups) {
        const values = chosen.has(group.propertyId)
          ? group.values.filter((v) => v.valueId === chosen.get(group.propertyId))
          : group.values
        combinations = combinations.flatMap((props) =>
          values.map((value) => [...props, property(group, value)]),
        )
      }
      for (const props of combinations) {
        const previousProperties = previous.map((group) =>
          property(
            group,
            group.values.find((value) => value.valueId === chosen.get(group.propertyId)),
          ),
        )
        const updated = updateRow(row, props, previousProperties)
        if (groups.some((g) => !previousById.has(g.propertyId)))
          updated.skuId = `edited_${updated.propPath}`
        const bucket = rowsByPath.get(updated.propPath) || []
        bucket.push(updated)
        rowsByPath.set(updated.propPath, bucket)
      }
    }
    const rows = [...rowsByPath.values()].map(mergeRows)
    const newValues = new Set(
      groups.flatMap((g) =>
        g.values
          .filter(
            (v) =>
              previousById.has(g.propertyId) &&
              !previousById.get(g.propertyId).values.some((old) => old.valueId === v.valueId),
          )
          .map((v) => `${g.propertyId}:${v.valueId}`),
      ),
    )
    if (newValues.size) {
      for (const row of buildMatrix(groups, [], defaults)) {
        if (
          !rowsByPath.has(row.propPath) &&
          row.properties.some((p) => newValues.has(`${p.propertyId}:${p.valueId}`))
        ) {
          rows.push({ ...row, skuId: `edited_${row.propPath}` })
        }
      }
    }
    return { groups, rows, error: '', review: rows.filter((r) => r.skuSyncReview?.length).length }
  }

  root.YoumiSkuSync = { sync, cleanGroups, imageUrls, syncImagePool }
})(globalThis)
