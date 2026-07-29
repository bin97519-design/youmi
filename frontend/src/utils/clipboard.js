function copyWithTextArea(text) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard is unavailable')
  }

  const textArea = document.createElement('textarea')
  const activeElement = document.activeElement
  const selection = document.getSelection()
  const selectedRanges = []

  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      selectedRanges.push(selection.getRangeAt(index).cloneRange())
    }
  }

  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.setAttribute('aria-hidden', 'true')
  Object.assign(textArea.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(textArea)

  try {
    textArea.focus({ preventScroll: true })
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)
    if (!document.execCommand('copy')) {
      throw new Error('Legacy clipboard copy failed')
    }
  } finally {
    textArea.remove()
    if (activeElement instanceof HTMLElement) {
      activeElement.focus({ preventScroll: true })
    }
    if (selection) {
      selection.removeAllRanges()
      selectedRanges.forEach((range) => selection.addRange(range))
    }
  }
}

export async function writeTextToClipboard(value) {
  const text = String(value ?? '')
  if (!text) return

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Permission policies can block the modern API even in a secure context.
    }
  }

  copyWithTextArea(text)
}
