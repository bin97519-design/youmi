import {
  personalAssetImageUrl,
  personalAssetKind,
  personalAssetLibrary,
} from '../config/personalAssetLibrary.js'
import { createCharacterAssetClient } from './characterAssetClient.js'

// Keep descriptive metadata, not provider jobs, billing identities or consent.
// Do not remove generic product price/cost fields: those are merchandise facts.
const transientKeys = new Set([
  'generation',
  'generationjob',
  'generationtask',
  'generationtasks',
  'pendinggeneration',
  'generationconsent',
  'authorization',
  'auth',
  'apikey',
  'token',
  'credentials',
  'credential',
  'billing',
  'billinglog',
  'billinglogid',
  'consumedmi',
  'micost',
  'balance',
  'clienttaskid',
  'taskid',
  'taskids',
  'unresolvedtaskids',
  'runstate',
  'taskstate',
])
const text = (value) => (typeof value === 'string' ? value.trim() : '')

function boundedText(value, limit, label) {
  const result = text(value)
  if (result.length > limit) throw new Error(`${label}不能超过 ${limit} 字`)
  if (result.includes('\0')) throw new Error(`${label}包含无效字符`)
  return result
}

function recordId(record, singular, required = false) {
  const value = record?.id
  if (value == null || value === '') {
    if (required) throw new Error(`请选择已保存的${singular}`)
    return ''
  }
  const id = text(value)
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || /^(official|builtin)[-_]/i.test(id))
    throw new Error(`${singular}标识无效`)
  return id
}

function metadataFor(record, kind, singular) {
  const config = record?.config ?? {}
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${singular}配置格式无效`)
  }
  let copy
  try {
    copy = JSON.parse(JSON.stringify(config))
  } catch {
    throw new Error(`${singular}配置必须是有效 JSON`)
  }
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
    throw new Error(`${singular}配置格式无效`)
  }
  let visited = 0
  const strip = (value, depth = 0) => {
    if (depth > 12 || ++visited > 4096) throw new Error(`${singular}配置层级或内容过多`)
    if (Array.isArray(value)) return value.map((item) => strip(item, depth + 1))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !transientKeys.has(key.toLowerCase().replace(/[_-]/g, '')))
          .map(([key, item]) => [key, strip(item, depth + 1)]),
      )
    }
    return value
  }
  const result = { ...strip(copy), libraryKind: kind }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 65536) {
    throw new Error(`${singular}配置不能超过 64 KiB`)
  }
  return result
}

function typedPayload(record, kind, singular) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${singular}资料不能为空`)
  }
  const id = recordId(record, singular)
  if (id && personalAssetKind(record) !== kind) {
    throw new Error(`不能在此${singular}库修改其他素材库中的记录`)
  }
  const name = boundedText(record.name, 80, `${singular}名称`)
  if (!name) throw new Error(`请输入${singular}名称`)
  const original = text(record.imageUrl) || text(record.coverUrl)
  const imageUrl = personalAssetImageUrl(original)
  if (!imageUrl) throw new Error(`请先上传有效的${singular}图片（HTTP(S) 地址）`)
  const cover = text(record.coverUrl)
  const coverUrl = cover ? personalAssetImageUrl(cover) : imageUrl
  if (!coverUrl) throw new Error(`${singular}封面必须是已上传的 HTTP(S) 图片地址`)
  return {
    ...(id ? { id } : {}),
    name,
    description: boundedText(record.description, 4000, `${singular}描述`),
    gender: boundedText(record.gender, 80, '性别'),
    ageGroup: boundedText(record.ageGroup, 80, '年龄'),
    culture: boundedText(record.culture, 80, '文化背景'),
    imageUrl,
    coverUrl,
    config: metadataFor(record, kind, singular),
  }
}

function translatedError(error, singular) {
  if (!error || typeof error.message !== 'string') return error
  const message = error.message.replaceAll('角色', singular).replaceAll('模特', singular)
  if (message === error.message) return error
  const translated = new Error(message, { cause: error })
  translated.name = error.name || 'Error'
  for (const key of ['status', 'code']) {
    if (Object.hasOwn(error, key)) translated[key] = error[key]
  }
  return translated
}

/** Logical account-owned collections over the existing authenticated asset API. */
export function createPersonalAssetLibraryClient({ kind, ...dependencies } = {}) {
  const { singular } = personalAssetLibrary(kind)
  const base = createCharacterAssetClient(dependencies)
  const scoped = async (operation) => {
    try {
      return await operation()
    } catch (error) {
      throw translatedError(error, singular)
    }
  }
  return Object.freeze({
    list: (options = {}) =>
      scoped(async () =>
        (await base.list(options)).filter((record) => personalAssetKind(record) === kind),
      ),
    save: (record, options = {}) =>
      scoped(async () => {
        const result = await base.save(typedPayload(record, kind, singular), options)
        if (personalAssetKind(result) !== kind)
          throw new Error(`${singular}保存结果的素材库类型不匹配，请刷新后核对`)
        if (!personalAssetImageUrl(result.imageUrl || result.coverUrl))
          throw new Error(`${singular}保存结果缺少有效图片`)
        return result
      }),
    remove: (record, options = {}) =>
      scoped(async () => {
        const id = recordId(record, singular, true)
        if (personalAssetKind(record) !== kind)
          throw new Error(`不能从此${singular}库删除其他素材库中的记录`)
        return base.remove(id, options)
      }),
  })
}
