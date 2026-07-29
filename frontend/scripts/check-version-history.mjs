import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { versionHistory } from '../src/data/versionHistory.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  await readFile(path.resolve(scriptDir, '..', 'package.json'), 'utf8'),
)

const errors = []
const versions = new Set()

if (!versionHistory.length) {
  errors.push('更新历程不能为空。')
}

if (versionHistory[0]?.version !== packageJson.version) {
  errors.push(
    `package.json 版本为 ${packageJson.version}，但更新历程最新版本为 ${versionHistory[0]?.version || '空'}。`,
  )
}

for (const [index, release] of versionHistory.entries()) {
  if (!release.version || !release.date || !release.title || !release.summary) {
    errors.push(`第 ${index + 1} 条更新记录缺少版本、日期、标题或摘要。`)
  }
  if (versions.has(release.version)) {
    errors.push(`更新历程存在重复版本：${release.version}。`)
  }
  versions.add(release.version)
  if (!Array.isArray(release.sections) || !release.sections.length) {
    errors.push(`v${release.version} 没有更新内容分组。`)
  }
  if (index > 0 && versionHistory[index - 1].date < release.date) {
    errors.push('更新历程必须按日期从新到旧排列。')
  }
}

if (errors.length) {
  console.error(`版本历程检查失败：\n- ${errors.join('\n- ')}`)
  process.exit(1)
}

console.log(`版本历程检查通过：v${packageJson.version}，共 ${versionHistory.length} 个版本。`)
