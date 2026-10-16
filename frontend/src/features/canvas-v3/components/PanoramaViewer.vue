<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import { apiPath } from '../../../utils/apiBase'
const props = defineProps({ src: { type: String, required: true } })
const canvas = ref(null)
const flat = ref(false)
const error = ref('')
const warning = ref('')
const view = ref({ yaw: 0, pitch: 0, fov: 75 })
let gl, program, texture, buffer, observer, image, drag
let proxyRetried = false
function draw() {
  if (!gl || !program || !texture || !canvas.value) return
  const c = canvas.value
  const scale = Math.min(devicePixelRatio || 1, 2)
  c.width = Math.max(1, Math.round(c.clientWidth * scale))
  c.height = Math.max(1, Math.round(c.clientHeight * scale))
  gl.viewport(0, 0, c.width, c.height)
  gl.useProgram(program)
  gl.uniform1f(gl.getUniformLocation(program, 'aspect'), c.width / c.height)
  for (const key of ['yaw', 'pitch', 'fov'])
    gl.uniform1f(gl.getUniformLocation(program, key), (view.value[key] * Math.PI) / 180)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}
function shader(type, source) {
  const item = gl.createShader(type)
  gl.shaderSource(item, source)
  gl.compileShader(item)
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
    gl.deleteShader(item)
    throw new Error('全景预览着色器初始化失败')
  }
  return item
}
function reset() {
  view.value = { yaw: 0, pitch: 0, fov: 75 }
  draw()
}
async function toggleFlat() {
  flat.value = !flat.value
  await nextTick()
  draw()
}
function start(event) {
  if (flat.value || event.button !== 0) return
  drag = { x: event.clientX, y: event.clientY, yaw: view.value.yaw, pitch: view.value.pitch }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function move(event) {
  if (!drag) return
  view.value.yaw = drag.yaw - (event.clientX - drag.x) * 0.2
  view.value.pitch = Math.max(-85, Math.min(85, drag.pitch + (event.clientY - drag.y) * 0.2))
  draw()
}
function zoom(event) {
  if (flat.value) return
  view.value.fov = Math.max(30, Math.min(110, view.value.fov + event.deltaY * 0.04))
  draw()
}
function key(event) {
  const delta = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[
    event.key
  ]
  if (delta) {
    event.preventDefault()
    view.value.yaw += delta[0]
    view.value.pitch = Math.max(-85, Math.min(85, view.value.pitch + delta[1]))
    draw()
  }
}
onMounted(() => {
  try {
    gl = canvas.value.getContext('webgl', { antialias: true, alpha: false })
    if (!gl) throw new Error('当前设备不支持全景预览，可切换平面图查看')
    const vertex = shader(
      gl.VERTEX_SHADER,
      'attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}',
    )
    const fragment = shader(
      gl.FRAGMENT_SHADER,
      `precision highp float;
      varying vec2 uv; uniform sampler2D panorama; uniform float aspect,yaw,pitch,fov;
      void main(){
        vec2 p=(uv*2.-1.)*vec2(aspect,1.)*tan(fov*.5);
        vec3 r=normalize(vec3(p,1.));
        r=vec3(r.x,cos(pitch)*r.y+sin(pitch)*r.z,-sin(pitch)*r.y+cos(pitch)*r.z);
        r=vec3(cos(yaw)*r.x+sin(yaw)*r.z,r.y,-sin(yaw)*r.x+cos(yaw)*r.z);
        vec2 st=vec2(fract(atan(r.x,r.z)/6.28318530718+.5),.5-asin(clamp(r.y,-1.,1.))/3.14159265359);
        gl_FragColor=texture2D(panorama,st);
      }`,
    )
    program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('全景预览初始化失败')
    gl.useProgram(program)
    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        if (!gl || !program) return
        if (Math.abs(image.naturalWidth / image.naturalHeight - 2) > 0.1)
          warning.value = '当前图片不是标准2:1全景比例，投影可能变形'
        texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        draw()
      } catch {
        error.value = '全景纹理加载失败，请切换平面图查看'
      }
    }
    image.onerror = () => {
      if (!proxyRetried && /^https?:\/\//.test(props.src)) {
        proxyRetried = true
        image.src = apiPath('/api/image-tasks/proxy-download?url=' + encodeURIComponent(props.src))
      } else error.value = '全景纹理加载失败，请切换平面图查看'
    }
    image.src = props.src
    observer = new ResizeObserver(draw)
    observer.observe(canvas.value)
  } catch (failure) {
    error.value = failure.message
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (image) {
    image.onload = null
    image.onerror = null
  }
  if (gl) {
    gl.deleteTexture(texture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }
  gl = null
})
</script>

<template>
  <section class="cv3-panorama-viewer" aria-label="720度全景预览">
    <div class="cv3-panorama-actions">
      <strong>720°全景预览</strong>
      <button type="button" :aria-pressed="!flat" @click="toggleFlat">
        {{ flat ? '全景视角' : '平面图' }}
      </button>
      <button type="button" @click="reset">
        <CanvasIcon name="rotate" :size="15" />
        重置视角
      </button>
    </div>
    <canvas
      v-show="!flat"
      ref="canvas"
      tabindex="0"
      aria-label="拖动环视，滚轮缩放，方向键转动视角"
      :data-yaw="view.yaw"
      :data-pitch="view.pitch"
      :data-fov="view.fov"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="drag = null"
      @pointercancel="drag = null"
      @wheel.prevent.stop="zoom"
      @keydown="key"
    />
    <img v-if="flat" :src="src" alt="720度全景平面图" />
    <p v-if="error && !flat" role="status">{{ error }}</p>
    <small>
      {{ warning || (flat ? '等距柱状全景图 · 2:1' : '拖动环视 · 滚轮缩放 · 方向键转动') }}
    </small>
  </section>
</template>
