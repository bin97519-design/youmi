# 选品库列表精简响应

`GET /api/v1/selection-pool/products` 默认 `compact=true`，返回分页摘要：

- 保留商品 ID、来源、标题、封面、采集/搬家状态、质量分数、时间、标签等列表字段。
- `listMeta` 包含 `productType`、`categoryName`、`skuGroupCount`、`skuCount`、`skuSplit`（只保留份数编号和分组名称）。
- 不返回 `productData` 或 `rawSnapshot`。
- 编辑、复制必须调用 `GET /products/{id}` 获取完整资料；不可用摘要覆盖商品。
- 旧集成确需完整分页资料时，显式传 `compact=false`。单品详情、写入和搬家快照接口不变。

查询说明：非空页执行 3 次业务 SQL（分页、计数、批量标签），空页 2 次；用户和软删除隔离保持不变。
摘要查询不读取 `raw_snapshot`。由于历史表未存储 SKU 计数字段，仍读取该页 `product_data`，通过流式 JSON 读取器提取元信息，不构建完整 SKU 树、不向客户端传输明细。
没有新增数据库列或执行历史商品回写，兼容当前 MySQL/H2 表结构。

上线需部署并重启后端，同时发布新版网页。插件已请求 `compact=true` 并支持 `listMeta`，无需为了此接口更换插件。
上线前验证列表响应不含两个大字段，并检查列表数字、分页、编辑、复制和搬家。
