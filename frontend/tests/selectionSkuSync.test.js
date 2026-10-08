import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { computed, reactive, ref, watch } from 'vue'
import { parse } from '@vue/compiler-sfc'
import * as format from '../src/utils/selectionProductFormat.js'
import * as sync from '../src/utils/selectionSkuSync.js'

const editorSource = fs.readFileSync(
  new URL('../src/components/selection/SelectionProductEditor.vue', import.meta.url),
  'utf8',
)
const script = parse(editorSource).descriptor.scriptSetup.content.replace(
  /import[\s\S]*?from ['"][^'"]+['"]\s*/g,
  '',
)
function editor(prepare = () => {}) {
  const skuGroups = [
    {
      propertyId: 'size',
      name: '尺寸',
      values: [
        { valueId: 'a', name: '1米' },
        { valueId: 'b', name: '2米' },
      ],
    },
    {
      propertyId: 'color',
      name: '颜色',
      values: [
        { valueId: 'red', name: '红色' },
        { valueId: 'blue', name: '蓝色' },
      ],
    },
  ]
  const skus = format.buildSelectionSkuMatrix(skuGroups, [], { price: '100', defaultStock: 0 })
  skus.splice(1, 1) // A real collected product need not have the full Cartesian matrix.
  skus[0].price = '123'
  skus[0].barcode = 'keep'
  const product = { id: 1, title: '床垫', productData: { skuGroups, skus } }
  prepare(product)
  const emitted = []
  const context = vm.createContext({
    computed,
    reactive,
    ref,
    watch,
    ...format,
    ...sync,
    defineProps: () => ({ product, saving: false }),
    defineEmits:
      () =>
      (...args) =>
        emitted.push(args),
  })
  vm.runInContext(
    script +
      '\nglobalThis.api = {form, skuImages, skuSyncError, syncSkuMatrix, removeSkuGroup, removeSkuValue, addSkuValue, submit}',
    context,
  )
  return { ...context.api, emitted }
}

test('web editor input rename is immediate and preserves real sparse SKU values', () => {
  const app = editor()
  app.form.skuGroups[0].values[0].name = '100cm'
  assert.equal(app.syncSkuMatrix(), true)
  assert.equal(app.form.skus.length, 3)
  assert.equal(app.form.skus[0].name, '100cm / 红色')
  assert.equal(app.form.skus[0].price, '123')
  assert.equal(app.form.skus[0].quantity, 0)
  assert.equal(app.form.skus[0].barcode, 'keep')
  assert.match(editorSource, /class="sku-groups" @input="syncSkuMatrix" @change="syncSkuMatrix"/)
})

test('web editor deleting size/color updates table and saved payload, not just the counter', () => {
  const app = editor()
  app.form.skuGroups[0].items = JSON.parse(JSON.stringify(app.form.skuGroups[0].values))
  app.removeSkuValue(app.form.skuGroups[0], 1)
  assert.equal(app.form.skus.length, 1)
  app.submit()
  const payload = app.emitted[0][1].payload.productData
  assert.equal(payload.skuGroups[0].values.length, 1)
  assert.equal(payload.skuGroups[0].items, undefined)
  for (const key of ['skus', 'sku', 'skuList']) assert.equal(payload[key].length, 1)
  assert.equal(payload.skus[0].price, '123')
})

test('blank or duplicate names block save; completing name keeps data and allows save', () => {
  const app = editor()
  app.form.skuGroups[0].values[0].name = ''
  app.syncSkuMatrix()
  assert.equal(app.form.skus.length, 3)
  app.submit()
  assert.equal(app.emitted.length, 0)
  app.form.skuGroups[0].values[0].name = '150cm'
  app.submit() // save synchronizes even if no input event occurred
  assert.equal(app.emitted[0][1].payload.productData.skus[0].name, '150cm / 红色')
  assert.equal(app.skuSyncError.value, '')
})

test('new value generates only its new combinations; last value/group deletion clears rows', () => {
  const app = editor()
  app.addSkuValue(app.form.skuGroups[0], 0)
  assert.equal(app.form.skus.length, 3)
  app.form.skuGroups[0].values.at(-1).name = '3米'
  app.syncSkuMatrix()
  assert.equal(app.form.skus.length, 5)
  while (app.form.skuGroups[0].values.length) app.removeSkuValue(app.form.skuGroups[0], 0)
  assert.equal(app.form.skus.length, 0)
  app.removeSkuGroup(0)
  app.removeSkuGroup(0)
  assert.equal(app.form.skus.length, 0)
})

test('group removal merges collisions, preserves equal fields and flags conflicting fields', () => {
  const app = editor()
  app.removeSkuGroup(0)
  assert.equal(app.form.skus.length, 2)
  assert.equal(app.form.skus[0].name, '红色')
  assert.equal(app.form.skus[0].price, '')
  assert.equal(app.form.skus[0].quantity, 0)
  assert.ok(app.form.skus[0].skuSyncReview.includes('price'))
})

test('web deleting a color removes its images from preview and saved image pools; shared images survive', () => {
  for (const shared of [false, true]) {
    const red = 'https://img.test/red.jpg'
    const blue = shared ? red : 'https://img.test/blue.jpg'
    const app = editor((product) => {
      const data = product.productData
      data.skuGroups[1].values[0].imageUrl = red
      data.skuGroups[1].values[1].imageUrl = blue
      for (const row of data.skus) {
        row.imageUrl = row.properties[1].valueId === 'red' ? red : blue
        row.skuPicture = [{ url: row.imageUrl }]
        row.properties[1].imageUrl = row.imageUrl
      }
      data.skuImages = [red, blue, 'https://img.test/old-orphan.jpg']
      data.media = { skuImages: [...data.skuImages], mainImages: ['https://img.test/main.jpg'] }
    })
    app.removeSkuValue(app.form.skuGroups[1], 1)
    assert.deepEqual([...app.skuImages.value], [red])
    app.submit()
    const data = app.emitted[0][1].payload.productData
    assert.deepEqual([...data.skuImages], [red])
    assert.deepEqual([...data.media.skuImages], [red])
    assert.deepEqual([...data.media.mainImages], ['https://img.test/main.jpg'])
    assert.equal(data.skus.length, 2)
    assert.ok(data.skus.every((row) => row.imageUrl === red))
  }
})

test('web size deletion preserves independent surviving row images in preview and payload', () => {
  const app = editor((product) => {
    product.productData.skus.forEach((row, index) => {
      row.imageUrl = `https://img.test/sku-${index}.jpg`
      row.skuPicture = [{ url: row.imageUrl }]
    })
  })
  assert.equal(app.skuImages.value.length, 3)
  app.removeSkuValue(app.form.skuGroups[0], 1)
  assert.deepEqual([...app.skuImages.value], ['https://img.test/sku-0.jpg'])
  app.submit()
  const data = app.emitted[0][1].payload.productData
  assert.deepEqual([...data.skuImages], ['https://img.test/sku-0.jpg'])
  assert.deepEqual([...data.media.skuImages], [...data.skuImages])
  assert.equal(data.skus[0].price, '123')
  assert.equal(data.skus[0].quantity, 0)
})
