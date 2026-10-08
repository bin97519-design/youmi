export function assertJdSkuPreflightAvailable(platform, pluginInfo) {
  if (platform === 'JD' && !pluginInfo?.capabilities?.includes('JD_SKU_NAME_PREFLIGHT'))
    throw new Error(
      '京东上架前需要 SKU 超长校验，请重新加载 0.9.12.124 或更新版本的搬家插件，再刷新选品库',
    )
}

export async function prepareMigrationWithConfirmation(payload, send, confirm) {
  // Freeze the request while the customer reviews the dialog. A different
  // report from the extension requires another explicit confirmation.
  const request = structuredClone(payload)
  delete request.jdSkuNameConfirmation
  let result = await send(request)
  for (let attempt = 0; result?.requiresConfirmation; attempt += 1) {
    const report = result.preflight
    if (attempt >= 3) throw new Error('SKU 资料连续变化，请重新启动并核对')
    if (
      request.targetPlatform !== 'JD' ||
      report?.version !== 'jd-sku-name-preflight-124' ||
      report.limit !== 50 ||
      !/^[a-f0-9]{64}$/.test(report.confirmationKey) ||
      !Array.isArray(report.products)
    )
      throw new Error('京东 SKU 预检结果无效，请重新加载插件后再试')
    if (typeof confirm !== 'function' || (await confirm(report)) !== true)
      return { cancelled: true, execution: { opened: false } }
    result = await send({ ...request, jdSkuNameConfirmation: report.confirmationKey })
  }
  if (!result?.execution?.opened) throw new Error('插件未启动发布页，请检查任务状态后重试')
  return result
}
