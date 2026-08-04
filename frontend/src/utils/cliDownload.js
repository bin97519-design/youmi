const DEFAULT_CLI_UPDATE_BASE_URL =
  import.meta.env.VITE_CLI_UPDATE_BASE_URL ||
  'https://huami-canvas.oss-cn-shanghai.aliyuncs.com/youmi-update/win/'

function withTrailingSlash(url) {
  const text = String(url || '').trim()
  if (!text) return ''
  return text.endsWith('/') ? text : `${text}/`
}

function cleanYamlValue(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

function extractYamlValue(yamlText, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(yamlText)
  return match ? cleanYamlValue(match[1]) : ''
}

function resolveAssetUrl(baseUrl, assetPath) {
  const normalizedBase = withTrailingSlash(baseUrl)
  const normalizedPath = cleanYamlValue(assetPath)
  if (!normalizedPath) return ''
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath
  return new URL(normalizedPath, normalizedBase).toString()
}

function inferInstallerPath(version) {
  const safeVersion = String(version || '').trim() || 'latest'
  return `有米AI-Setup-${safeVersion}.exe`
}

export async function fetchCliLatestReleaseInfo(baseUrl = DEFAULT_CLI_UPDATE_BASE_URL) {
  const normalizedBase = withTrailingSlash(baseUrl)
  if (!normalizedBase) {
    throw new Error('CLI 下载地址未配置')
  }

  const latestYmlUrl = new URL('latest.yml', normalizedBase).toString()
  const response = await fetch(latestYmlUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`获取 latest.yml 失败：HTTP ${response.status}`)
  }

  const yamlText = await response.text()
  const version = extractYamlValue(yamlText, 'version')
  const releaseDate = extractYamlValue(yamlText, 'releaseDate')
  const path =
    extractYamlValue(yamlText, 'path') ||
    extractYamlValue(yamlText, 'url') ||
    inferInstallerPath(version)
  const downloadUrl = resolveAssetUrl(normalizedBase, path)

  if (!downloadUrl) {
    throw new Error('latest.yml 中未找到可下载的安装包地址')
  }

  return {
    latestYmlUrl,
    version,
    releaseDate,
    path,
    downloadUrl,
    raw: yamlText,
  }
}

export async function downloadLatestCliInstaller(baseUrl = DEFAULT_CLI_UPDATE_BASE_URL) {
  const releaseInfo = await fetchCliLatestReleaseInfo(baseUrl)

  const anchor = document.createElement('a')
  anchor.href = releaseInfo.downloadUrl
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.download = ''
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  return releaseInfo
}

export function getCliUpdateBaseUrl() {
  return withTrailingSlash(DEFAULT_CLI_UPDATE_BASE_URL)
}
