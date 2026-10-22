import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveKlingOmniRoute } from '../src/features/canvas-v3/config/klingOmniRoutes.js'
import { KLING_OMNI_API_MODELS } from '../src/features/canvas-v3/config/klingOmniParameters.js'
import {
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

const routes = Object.entries(KLING_OMNI_API_MODELS).map(([label, model], index) => ({
  value: `model-api-key:${index + 101}`,
  model,
  label,
}))

test('each Omni intent resolves only its exact configured API model, independent of editable labels', () => {
  const before = structuredClone(routes)
  for (const [mode, model] of Object.entries(KLING_OMNI_API_MODELS)) {
    const route = resolveKlingOmniRoute('Kling 3.0', mode, routes)
    assert.equal(route.model, model)
    assert.equal(resolveKlingOmniRoute(routes[0].value, mode, routes).model, model)
  }
  assert.deepEqual(routes, before)
  const mixed = { ...routes[1], model: ' KLING-V3-OMNI-CANKAO ' }
  assert.equal(resolveKlingOmniRoute('Kling 3.0', '参考生', [mixed]), mixed)
  assert.throws(
    () =>
      resolveKlingOmniRoute('Kling 3.0', '参考生', [
        { value: 'wrong', model: 'other-video', label: 'kling-v3-omni-cankao' },
        routes[0],
      ]),
    /参考生.*尚未配置.*kling-v3-omni-cankao/,
  )
})

test('Omni never arbitrarily picks a key when target mode has multiple routes', () => {
  const duplicate = { ...routes[1], value: 'model-api-key:extra' }
  const configured = [...routes, duplicate]
  assert.throws(() => resolveKlingOmniRoute('Kling 3.0', '参考生', configured), /多条线路/)
  assert.equal(resolveKlingOmniRoute(duplicate.value, '参考生', configured), duplicate)
  assert.throws(() => resolveKlingOmniRoute('model-api-key:deleted', '参考生', []), /尚未配置/)
})

test('three mode APIs retain one aggregate dropdown choice and correct branding for saved real routes', () => {
  assert.deepEqual(
    videoModelOptions(['Kling 3.0'], routes).map((item) => item.value),
    ['Kling 3.0'],
  )
  for (const route of routes) {
    const presentation = modelPresentation(route, 'video')
    assert.equal(presentation.label, '可灵-Omni')
    assert.equal(presentation.icon, 'modelKling')
    assert.equal(presentation.value, route.value)
  }
})
