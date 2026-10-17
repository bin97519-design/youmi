<script setup>
import { computed } from 'vue'

const props = defineProps({ text: { type: String, default: '' } })

function inlineParts(value) {
  const source = String(value || '')
  const parts = []
  const matcher = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let cursor = 0
  let match
  while ((match = matcher.exec(source))) {
    if (match.index > cursor) parts.push({ type: 'text', text: source.slice(cursor, match.index) })
    if (match[2]) parts.push({ type: 'strong', text: match[2] })
    else if (match[3]) parts.push({ type: 'code', text: match[3] })
    else if (match[4] && match[5]) parts.push({ type: 'link', text: match[4], href: match[5] })
    cursor = matcher.lastIndex
  }
  if (cursor < source.length) parts.push({ type: 'text', text: source.slice(cursor) })
  return parts.length ? parts : [{ type: 'text', text: source }]
}

function isTableDivider(line) {
  const cells = line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function tableCells(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => ({ parts: inlineParts(cell.trim()) }))
}

function isBlockStart(lines, index) {
  const line = lines[index] || ''
  const next = lines[index + 1] || ''
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    (/\|/.test(line) && isTableDivider(next))
  )
}

function parseMarkdown(value) {
  const lines = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```\s*([\w-]+)?\s*$/)
    if (fence) {
      const code = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language: fence[1] || '', text: code.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, parts: inlineParts(heading[2]) })
      index += 1
      continue
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
      const header = tableCells(line)
      const rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line)
      const matcher = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/
      const items = []
      while (index < lines.length) {
        const item = lines[index].match(matcher)
        if (!item) break
        items.push({ parts: inlineParts(item[1]) })
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', parts: inlineParts(quote.join(' ')) })
      continue
    }

    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', parts: inlineParts(paragraph.join(' ')) })
  }
  return blocks
}

const blocks = computed(() => parseMarkdown(props.text))
</script>

<template>
  <div class="cv3-director-rich-text">
    <template v-for="(block, blockIndex) in blocks" :key="`${block.type}-${blockIndex}`">
      <component :is="`h${block.level}`" v-if="block.type === 'heading'">
        <template v-for="(part, partIndex) in block.parts" :key="partIndex">
          <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
          <code v-else-if="part.type === 'code'">{{ part.text }}</code>
          <a v-else-if="part.type === 'link'" :href="part.href" target="_blank" rel="noreferrer">
            {{ part.text }}
          </a>
          <template v-else>{{ part.text }}</template>
        </template>
      </component>
      <p v-else-if="block.type === 'paragraph'">
        <template v-for="(part, partIndex) in block.parts" :key="partIndex">
          <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
          <code v-else-if="part.type === 'code'">{{ part.text }}</code>
          <a v-else-if="part.type === 'link'" :href="part.href" target="_blank" rel="noreferrer">
            {{ part.text }}
          </a>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <blockquote v-else-if="block.type === 'quote'">
        <template v-for="(part, partIndex) in block.parts" :key="partIndex">
          <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
          <code v-else-if="part.type === 'code'">{{ part.text }}</code>
          <a v-else-if="part.type === 'link'" :href="part.href" target="_blank" rel="noreferrer">
            {{ part.text }}
          </a>
          <template v-else>{{ part.text }}</template>
        </template>
      </blockquote>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item.parts" :key="partIndex">
            <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
            <code v-else-if="part.type === 'code'">{{ part.text }}</code>
            <a v-else-if="part.type === 'link'" :href="part.href" target="_blank" rel="noreferrer">
              {{ part.text }}
            </a>
            <template v-else>{{ part.text }}</template>
          </template>
        </li>
      </component>
      <div v-else-if="block.type === 'table'" class="cv3-director-table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="(cell, cellIndex) in block.header" :key="cellIndex">
                <template v-for="(part, partIndex) in cell.parts" :key="partIndex">
                  <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
                  <code v-else-if="part.type === 'code'">{{ part.text }}</code>
                  <template v-else>{{ part.text }}</template>
                </template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                <template v-for="(part, partIndex) in cell.parts" :key="partIndex">
                  <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
                  <code v-else-if="part.type === 'code'">{{ part.text }}</code>
                  <a
                    v-else-if="part.type === 'link'"
                    :href="part.href"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ part.text }}
                  </a>
                  <template v-else>{{ part.text }}</template>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <pre v-else-if="block.type === 'code'"><code>{{ block.text }}</code></pre>
    </template>
  </div>
</template>

<style scoped>
.cv3-director-rich-text {
  color: #fff;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.cv3-director-rich-text :where(p, ul, ol, blockquote, pre, table) {
  margin: 0 0 10px;
}

.cv3-director-rich-text :where(h1, h2, h3, h4, h5, h6) {
  margin: 14px 0 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.55;
}

.cv3-director-rich-text > :first-child {
  margin-top: 0;
}

.cv3-director-rich-text > :last-child {
  margin-bottom: 0;
}

.cv3-director-rich-text :where(ul, ol) {
  padding-left: 20px;
}

.cv3-director-rich-text li + li {
  margin-top: 4px;
}

.cv3-director-rich-text strong {
  font-weight: 650;
}

.cv3-director-rich-text a {
  color: #67c8ff;
  text-underline-offset: 2px;
}

.cv3-director-rich-text code {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: #f5f5f5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}

.cv3-director-rich-text pre {
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: #171717;
}

.cv3-director-rich-text pre code {
  padding: 0;
  background: transparent;
}

.cv3-director-rich-text blockquote {
  padding-left: 10px;
  border-left: 2px solid rgba(91, 200, 255, 0.55);
  color: rgba(255, 255, 255, 0.68);
}

.cv3-director-table-wrap {
  max-width: 100%;
  margin: 4px 0 10px;
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.cv3-director-rich-text table {
  width: 100%;
  min-width: 320px;
  margin: 0;
  border-collapse: collapse;
}

.cv3-director-rich-text :where(th, td) {
  padding: 8px 9px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
  vertical-align: top;
}

.cv3-director-rich-text th {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
}

.cv3-director-rich-text tr:last-child td,
.cv3-director-rich-text th:last-child,
.cv3-director-rich-text td:last-child {
  border-right: 0;
}

.cv3-director-rich-text tr:last-child td {
  border-bottom: 0;
}
</style>
