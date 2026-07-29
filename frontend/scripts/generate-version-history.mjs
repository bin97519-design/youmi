import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { versionHistory } from '../src/data/versionHistory.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const projectDir = path.resolve(frontendDir, '..')
const publicDir = path.resolve(frontendDir, 'public', 'version-log')
const assetsDir = path.resolve(publicDir, 'assets')
const visualDataUrls = new Map()

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function releaseHtml(release, index) {
  const visuals = (release.visuals || [])
    .map(
      (visual) => `
        <figure class="${visual.wide ? 'wide' : ''}">
          <div class="visual-media">
            <img src="${escapeHtml(visualDataUrls.get(visual.src) || '')}" alt="${escapeHtml(visual.alt)}" loading="lazy">
          </div>
          <figcaption>
            <strong>${escapeHtml(visual.title)}</strong>
            <span>${escapeHtml(visual.description)}</span>
          </figcaption>
        </figure>`,
    )
    .join('')
  const visualGallery = visuals ? `<div class="visuals">${visuals}</div>` : ''
  const sections = release.sections
    .map(
      (section) => `
        <section class="release-section">
          <h3>${escapeHtml(section.title)}</h3>
          <ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>`,
    )
    .join('')

  if (index === 0) {
    return `
      <div class="date"><span>${escapeHtml(release.date)}</span><i></i></div>
      <article class="release latest">
        <div class="meta"><b>v${escapeHtml(release.version)}</b><small>最新版本</small></div>
        <h2>${escapeHtml(release.title)}</h2>
        <p>${escapeHtml(release.summary)}</p>
        ${visualGallery}
        <div class="sections">${sections}</div>
      </article>`
  }

  return `
    <div class="date"><span>${escapeHtml(release.date)}</span><i></i></div>
    <details class="release">
      <summary>
        <b>v${escapeHtml(release.version)}</b>
        <span><strong>${escapeHtml(release.title)}</strong><small>${escapeHtml(release.summary)}</small></span>
        <em>查看更多</em>
      </summary>
      ${visualGallery ? visualGallery : '<!-- No visuals for this release. -->'}
      <div class="sections">${sections}</div>
    </details>`
}

const visualFiles = [
  ...new Set(
    versionHistory.flatMap((release) => (release.visuals || []).map((visual) => visual.src)),
  ),
]
await Promise.all(
  visualFiles.map(async (filename) => {
    const extension = path.extname(filename).slice(1).toLowerCase()
    const mimeType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/png'
    const file = await readFile(path.resolve(assetsDir, filename))
    visualDataUrls.set(filename, `data:${mimeType};base64,${file.toString('base64')}`)
  }),
)

const latestVersion = versionHistory[0].version
const timeline = versionHistory.map(releaseHtml).join('')
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="有米 AI 产品更新历程">
  <title>有米 AI 更新历程</title>
  <style>
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#18202a;background:#fff;font-family:"Microsoft YaHei","PingFang SC",sans-serif;letter-spacing:0}
    a{color:inherit;text-decoration:none}.hero{padding:64px 20px 42px;text-align:center;border-bottom:1px solid #edf0f3}.hero small{color:#087f88;font-weight:800}.hero h1{margin:8px 0 7px;font-size:40px;line-height:1.2}.hero p{margin:0;color:#778190}.actions{display:flex;justify-content:center;gap:10px;margin-top:24px}.actions a{padding:9px 14px;border:1px solid #dce2e8;border-radius:6px;font-size:13px}.actions a.primary{color:#fff;background:#16212b;border-color:#16212b}
    main{width:min(1020px,calc(100% - 32px));margin:0 auto;padding:18px 0 64px}.timeline{display:grid;grid-template-columns:160px minmax(0,1fr)}.date{position:relative;min-height:100%;padding:34px 30px 0 0;color:#697483;border-right:1px solid #e0e5ea;text-align:right;font-size:13px}.date i{position:absolute;top:38px;right:-5px;width:9px;height:9px;background:#fff;border:2px solid #087f88;border-radius:50%}
    .release{min-width:0;margin-left:36px;padding:32px 0;border-bottom:1px solid #e7ebef}.release:last-child{border-bottom:0}.meta{display:flex;align-items:center;gap:9px}.release b{display:inline-flex;padding:4px 8px;color:#087f88;background:#eaf7f7;border:1px solid #a8dada;border-radius:5px;font-size:12px}.meta small{color:#7b8490;font-size:12px}.release h2{margin:13px 0 7px;font-size:24px}.release>p{margin:0;color:#687381;font-size:14px;line-height:1.75}.sections{display:grid;gap:20px;margin-top:24px}.release-section{display:grid;grid-template-columns:110px minmax(0,1fr);gap:20px}.release-section h3{margin:0;font-size:14px;line-height:1.8}.release-section ul{display:grid;gap:9px;margin:0;padding:0;list-style:none}.release-section li{position:relative;padding-left:15px;color:#687381;font-size:14px;line-height:1.75}.release-section li:before{position:absolute;top:.75em;left:0;width:4px;height:4px;content:"";background:#087f88;border-radius:50%}
    .visuals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:24px}.visuals figure{min-width:0;margin:0;overflow:hidden;background:#f7f9fa;border:1px solid #e0e5ea;border-radius:6px}.visuals figure.wide{grid-column:1/-1}.visual-media{aspect-ratio:16/9;overflow:hidden;background:#eef1f4;border-bottom:1px solid #e0e5ea}.visual-media img{width:100%;height:100%;display:block;object-fit:cover;object-position:center top}.visuals figcaption{display:grid;gap:4px;padding:11px 12px 12px}.visuals figcaption strong{font-size:14px;line-height:1.45}.visuals figcaption span{color:#687381;font-size:12px;line-height:1.6}
    details summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:15px;cursor:pointer;list-style:none}details summary::-webkit-details-marker{display:none}details summary span{display:grid;gap:4px}details summary strong{font-size:17px}details summary small{overflow:hidden;color:#7b8490;text-overflow:ellipsis;white-space:nowrap}details summary em{color:#7b8490;font-size:13px;font-style:normal}footer{padding:28px 16px;color:#8a929d;border-top:1px solid #edf0f3;text-align:center;font-size:12px}
    @media(max-width:700px){.hero{padding-top:44px}.hero h1{font-size:32px}.timeline{grid-template-columns:1fr}.date{min-height:0;padding:27px 0 0 18px;border:0;text-align:left}.date i{top:31px;right:auto;left:0}.release{margin-left:0;padding:16px 0 28px}.visuals{grid-template-columns:1fr}.visuals figure.wide{grid-column:auto}.release-section{grid-template-columns:1fr;gap:5px}details summary{grid-template-columns:auto minmax(0,1fr)}details summary em{grid-column:2}.actions{flex-wrap:wrap}}
  </style>
</head>
<body>
  <header class="hero">
    <small>YOUMI RELEASES · v${escapeHtml(latestVersion)}</small>
    <h1>有米 AI 更新历程</h1>
    <p>记录每一次功能更新和体验改进，最新内容始终排在最前面。</p>
    <nav class="actions">
      <a class="primary" href="http://101.133.149.214/youmi/reverse-prompt">打开有米 AI</a>
      <a href="http://101.133.149.214/report/%E6%9C%89%E7%B1%B3%E7%94%BB%E5%B8%83%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B.html">画布教程</a>
    </nav>
  </header>
  <main><div class="timeline">${timeline}</div></main>
  <footer>有米 AI · 当前版本 v${escapeHtml(latestVersion)}</footer>
</body>
</html>
`

await mkdir(publicDir, { recursive: true })
await Promise.all([
  writeFile(path.resolve(publicDir, 'index.html'), html, 'utf8'),
  writeFile(path.resolve(projectDir, '有米AI更新历程.html'), html, 'utf8'),
])

console.log('已同步应用内版本数据和独立更新历程 HTML。')
