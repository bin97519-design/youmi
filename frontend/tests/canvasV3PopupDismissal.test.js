import test from 'node:test'
import assert from 'node:assert/strict'
import { isOutsidePopup } from '../src/features/canvas-v3/config/popupDismissal.js'

function element(...children) {
  const root = { contains: (target) => target === root || children.includes(target) }
  return root
}

test('parameter options and nested icons remain inside the popup', () => {
  const option = {}
  const icon = {}
  const popup = element(option, icon)
  const trigger = element()
  for (const target of [popup, option, icon]) {
    assert.equal(isOutsidePopup({ target }, popup, trigger), false)
  }
})

test('the active trigger is not dismissed on pointerdown before click toggles it', () => {
  const icon = {}
  const trigger = element(icon)
  const popup = element()
  assert.equal(isOutsidePopup({ target: trigger }, popup, trigger), false)
  assert.equal(isOutsidePopup({ target: icon }, popup, trigger), false)
})

test('prompt input, other controls, toolbar and canvas are outside the popup', () => {
  const popup = element()
  const trigger = element()
  for (const name of ['prompt', 'another-trigger', 'toolbar', 'canvas']) {
    assert.equal(isOutsidePopup({ target: { name } }, popup, trigger), true)
  }
})

test('composed event paths preserve popup and trigger interactions', () => {
  const popup = element()
  const trigger = element()
  for (const root of [popup, trigger]) {
    assert.equal(
      isOutsidePopup({ target: {}, composedPath: () => [{}, root] }, popup, trigger),
      false,
    )
  }
})

test('unmounted popup roots do not prevent outside dismissal', () => {
  assert.equal(isOutsidePopup({ target: {} }, null, null), true)
})
