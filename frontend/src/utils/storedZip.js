const encoder = new TextEncoder()

let crcTable = null

function getCrcTable() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let value = 0; value < 256; value += 1) {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crcTable[value] = crc >>> 0
  }
  return crcTable
}

function crc32(bytes) {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

function localHeader(entry) {
  const output = new Uint8Array(30 + entry.nameBytes.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, entry.time, true)
  view.setUint16(12, entry.date, true)
  view.setUint32(14, entry.crc, true)
  view.setUint32(18, entry.data.length, true)
  view.setUint32(22, entry.data.length, true)
  view.setUint16(26, entry.nameBytes.length, true)
  view.setUint16(28, 0, true)
  output.set(entry.nameBytes, 30)
  return output
}

function centralHeader(entry) {
  const output = new Uint8Array(46 + entry.nameBytes.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, entry.time, true)
  view.setUint16(14, entry.date, true)
  view.setUint32(16, entry.crc, true)
  view.setUint32(20, entry.data.length, true)
  view.setUint32(24, entry.data.length, true)
  view.setUint16(28, entry.nameBytes.length, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, entry.offset, true)
  output.set(entry.nameBytes, 46)
  return output
}

export function createStoredZip(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('没有可打包的文件')
  if (files.length > 0xffff) throw new Error('文件数量超过 ZIP 格式限制')

  const timestamp = dosDateTime()
  let offset = 0
  const entries = files.map((file) => {
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data)
    const nameBytes = encoder.encode(file.name)
    if (nameBytes.length > 0xffff) throw new Error(`文件名过长：${file.name}`)
    if (data.length > 0xffffffff) throw new Error(`文件过大：${file.name}`)
    const entry = {
      nameBytes,
      data,
      crc: crc32(data),
      offset,
      ...timestamp,
    }
    offset += 30 + nameBytes.length + data.length
    return entry
  })

  const localParts = []
  for (const entry of entries) localParts.push(localHeader(entry), entry.data)
  const centralParts = entries.map(centralHeader)
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const view = new DataView(end.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, entries.length, true)
  view.setUint16(10, entries.length, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, offset, true)
  view.setUint16(20, 0, true)

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' })
}
