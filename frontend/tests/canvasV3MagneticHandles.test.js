import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  MAGNETIC_HANDLE_ICON_SIZE,
  MAGNETIC_HANDLE_SIZE,
  MAGNETIC_HANDLE_TRAVEL,
  magneticHandleHome,
  magneticHandleOffset,
} from '../src/features/canvas-v3/config/magneticHandle.js'

const nodeSource = fs.readFileSync(
  new URL('../src/features/canvas-v3/components/GeneratorNode.vue', import.meta.url),
  'utf8',
)
const styles = fs.readFileSync(
  new URL('../src/features/canvas-v3/canvas-v3.css', import.meta.url),
  'utf8',
)

test('image node handles use the measured LibTV magnetic geometry', () => {
  assert.equal(MAGNETIC_HANDLE_SIZE, 80)
  assert.equal(MAGNETIC_HANDLE_ICON_SIZE, 20)
  assert.equal(MAGNETIC_HANDLE_TRAVEL, 25)
  assert.deepEqual(magneticHandleHome('source'), { x: -25, y: 0 })
  assert.deepEqual(magneticHandleHome('target'), { x: 25, y: 0 })
  assert.match(styles, /\.cv3-handle-hit\s*\{[^}]*width: 80px;[^}]*height: 80px;/s)
  assert.match(styles, /\.cv3-handle-indicator\s*\{[^}]*width: 20px;[^}]*height: 20px;/s)
})

test('the plus indicator follows nearby pointers and stays inside its magnetic travel', () => {
  const rect = { left: 100, top: 200, width: 80, height: 80 }
  assert.deepEqual(magneticHandleOffset({ x: 140, y: 240 }, rect, 'source'), { x: 0, y: 0 })
  assert.deepEqual(magneticHandleOffset({ x: 100, y: 200 }, rect, 'source'), { x: -25, y: -25 })
  assert.deepEqual(magneticHandleOffset({ x: 180, y: 280 }, rect, 'source'), { x: 25, y: 25 })

  const zoomedRect = { left: 100, top: 200, width: 40, height: 40 }
  assert.deepEqual(magneticHandleOffset({ x: 120, y: 220 }, zoomedRect, 'source'), { x: 0, y: 0 })
})

test('both node sides render accessible plus handles with the same magnetic behavior', () => {
  assert.match(nodeSource, /aria-label="连接到此节点"/)
  assert.match(nodeSource, /aria-label="从此节点创建连接"/)
  assert.equal(nodeSource.match(/class="cv3-handle-hit"/g)?.length, 2)
  assert.equal(nodeSource.match(/@pointermove="followHandlePointer"/g)?.length, 2)
  assert.match(nodeSource, /M10 6\.5v7M6\.5 10h7/)
})
