<script setup>
import { useId } from 'vue'

const instanceId = `character-wireframe-${useId()}`
const silhouetteId = `${instanceId}-silhouette`
const surfaceId = `${instanceId}-surface`
const rimId = `${instanceId}-rim`
const shadowId = `${instanceId}-shadow`
const sectionVolumeId = `${instanceId}-section-volume`

// Anatomical contours and separate surface sections, in reference-image coordinates.
// Keep the existing portrait box/interaction; this is a local vector, not a remote 3D model.
const silhouette = [
  'M219 52 C212 52 207 57 206.5 64',
  'C205 71 207 80 209.5 85.5 L211 91 C213 95 211 101 208 104',
  'C205 108 195 109 188 112 C180 115 175 123 173 135',
  'C170 149 169 164 166.5 180 C163.5 195 162 211 162 226',
  'L162.5 246 C162 252 161.5 259 162.5 269',
  'C163 277 166 284 171 288 L179 294',
  'C180 294 180 292 179 290 L173 281',
  'L178 286 C180 287 180 285 178.5 282 L174 273',
  'C175 272 177 276 179 278 C181 279 182 277 180.5 274',
  'L175 265 C173 261 171 258 172 251 L175 225',
  'C177 213 179 205 180 196 C181.5 183 184 173 186 160',
  'L191 139 C193 146 194 153 195 161',
  'C196 173 193.5 184 190.5 196 C187 209 183 225 182.5 239',
  'C181.5 254 183.5 269 186 281 C188 294 192 306 192.5 316',
  'C192.5 326 191 335 191.5 345 C192 359 195.5 374 196.5 387',
  'L197 408 C197 416 193 420 187 424 L178 430',
  'C176 432 177 433 181 433 L205 432 C209 432 210 430 210 426',
  'L210 408 C209 399 209.5 390 210 381',
  'C211 368 213 356 212 345 C211 333 209 324 210 314',
  'C211 300 214 288 215 276 L218 257',
  'C219 252 222 252 224 258 L228 279 C231 294 235 304 237 316',
  'C239 329 239 341 241 353 C243 368 246.5 382 248 396',
  'L249 415 C249 422 248 427 250 431 C252 434 260 434 266 434',
  'L275 436 C278 436 278 434 275 432 L265 423',
  'C261 419 261 412 261 405 L261 386',
  'C262 374 263 360 262 347 C261 335 258 325 258 315',
  'C258 304 261 291 261 279 C262 265 260 250 258.5 237',
  'C258 222 253.5 206 250 193 C247 182 246 173 248 161',
  'L253 140 C255 149 256 159 257 169 C258 181 261 191 264 201',
  'C267 215 270 233 270 248 C269 255 267 262 267.5 269',
  'L266 279 C265.5 282 267 284 268.5 281 L272 272',
  'L270 285 C270 288 271.5 289 273 286 L277 277',
  'C279 270 279.5 264 279 256 L279 237',
  'C278 220 277 205 274 190 C271 175 270 159 268.5 144',
  'C267.5 130 266 121 261 116 C256 110 248 109 240 107',
  'C233 106 229 102 229 96 L229 90',
  'C232 85 233 79 234 72 C235.5 62 232 56 226 53 C224 52 221 52 219 52 Z',
].join(' ')

// [height, centre, half-width, front curvature]. Each region has its own
// transverse rings and meridians: no ruled grid crossing unrelated limbs.
const sections = [
  {
    name: 'head',
    columns: 6,
    rows: [
      [53, 220, 3, 0.5],
      [57, 220, 10, 1.5],
      [64, 220, 13.5, 2.5],
      [72, 220, 13, 2.7],
      [80, 220, 11, 2.4],
      [87, 220, 9, 1.8],
      [93, 220, 7, 1.1],
    ],
  },
  {
    name: 'torso',
    columns: 9,
    rows: [
      [95, 220, 8.5, 2],
      [102, 220, 10, 2.5],
      [109, 220, 25, 4],
      [117, 220.5, 33, 6],
      [127, 221, 32.5, 7],
      [137, 221, 31, 7.5],
      [147, 221, 28.5, 7],
      [157, 221, 26.5, 6.5],
      [167, 220.5, 25, 6],
      [177, 220.5, 25.5, 6],
      [187, 220.5, 27.5, 6.5],
      [197, 220.5, 31, 7],
      [207, 220.5, 34, 7],
      [217, 220.5, 36, 7],
      [227, 220.5, 37.5, 7],
      [237, 220.5, 38, 6],
      [245, 220.5, 38, 5],
      [252, 220.5, 37, 3],
    ],
  },
  {
    name: 'left-arm',
    columns: 4,
    rows: [
      [116, 186, 7, 2],
      [125, 183.5, 9.5, 2.5],
      [135, 182.5, 10, 3],
      [145, 181, 10, 3],
      [155, 179, 9.5, 3],
      [165, 177, 9, 2.5],
      [175, 175, 8.5, 2],
      [185, 173, 8, 2],
      [195, 171.5, 8.5, 2.5],
      [205, 170, 8, 2.5],
      [215, 168.5, 7, 2.5],
      [225, 168, 6, 2],
      [235, 167.5, 5.5, 1.5],
      [245, 167, 5, 1.3],
      [255, 167, 4.5, 1.2],
      [264, 168, 5, 1.5],
      [272, 169, 5, 1.3],
      [280, 172, 4, 1],
    ],
  },
  {
    name: 'right-arm',
    columns: 4,
    rows: [
      [116, 257, 6, 2],
      [125, 260, 7, 2.5],
      [135, 261, 7.5, 3],
      [145, 262, 7.5, 3],
      [155, 263, 7, 2.8],
      [165, 264, 7, 2.5],
      [175, 265.5, 6.5, 2],
      [185, 267, 6.5, 2],
      [195, 269, 7, 2.5],
      [205, 271, 6, 2.5],
      [215, 273, 5, 2.2],
      [225, 274, 4.5, 1.8],
      [235, 274.5, 4.5, 1.5],
      [245, 274.5, 4.5, 1.5],
      [255, 274, 5, 1.7],
      [264, 273, 5.5, 1.7],
      [272, 273, 4.5, 1.3],
      [280, 272, 2.5, 1],
    ],
  },
  {
    name: 'left-leg',
    columns: 6,
    rows: [
      [252, 201, 18.5, 4],
      [262, 201, 18.5, 4.5],
      [272, 200, 16, 4.5],
      [282, 200, 14, 4],
      [292, 200.5, 12, 3.5],
      [302, 201, 10, 3],
      [312, 201.5, 9, 2.5],
      [322, 201, 9, 3],
      [332, 201, 10, 3.5],
      [342, 201.5, 10.5, 3.5],
      [352, 202.5, 10, 3.5],
      [362, 203, 9, 3],
      [372, 203.5, 8, 2.5],
      [382, 203.5, 7, 2],
      [392, 203.5, 6.5, 1.8],
      [402, 203.5, 6.5, 1.8],
      [412, 203, 6.5, 2],
      [420, 199, 11, 2],
      [427, 194, 16, 1],
      [432, 194, 15, 0],
    ],
  },
  {
    name: 'right-leg',
    columns: 6,
    rows: [
      [252, 241, 18, 4],
      [262, 242, 18.5, 4.5],
      [272, 243, 18, 4.5],
      [282, 244, 16.5, 4],
      [292, 245, 15, 3.5],
      [302, 247, 12, 3],
      [312, 248.5, 10, 2.5],
      [322, 249, 10, 3],
      [332, 250, 10.5, 3.5],
      [342, 251, 11, 3.5],
      [352, 252, 10.5, 3.5],
      [362, 253.5, 9.5, 3],
      [372, 254.5, 8, 2.5],
      [382, 254.5, 7, 2],
      [392, 254.5, 6, 1.8],
      [402, 255, 6, 1.8],
      [412, 255, 6.5, 2],
      [422, 257, 8, 2],
      [430, 261, 12, 1],
      [435, 264, 12, 0],
    ],
  },
]

const number = (value) => Math.round(value * 100) / 100
function smoothPath(points) {
  let path = `M${points[0].map(number).join(' ')}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const start = points[index]
    const end = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const first = start.map((value, axis) => value + (end[axis] - previous[axis]) / 6)
    const second = end.map((value, axis) => value - (next[axis] - start[axis]) / 6)
    path += ` C${[...first, ...second, ...end].map(number).join(' ')}`
  }
  return path
}
const mesh = sections.map(({ name, rows, columns }) => ({
  name,
  surface: `${smoothPath(rows.map(([y, x, radius]) => [x - radius, y]))} ${smoothPath([...rows].reverse().map(([y, x, radius]) => [x + radius, y])).replace(/^M/, 'L')} Z`,
  rings: rows
    .filter((_row, index) => !name.endsWith('-leg') || index > 0)
    .map(
      ([y, x, radius, depth]) =>
        `M${number(x - radius)} ${y} C${number(x - radius * 0.7)} ${number(y + depth * 1.33)} ${number(x + radius * 0.7)} ${number(y + depth * 1.33)} ${number(x + radius)} ${y}`,
    ),
  meridians: Array.from({ length: columns - 1 }, (_, index) => {
    const angle = -Math.PI / 2 + ((index + 1) * Math.PI) / columns
    return smoothPath(
      rows.map(([y, x, radius, depth]) => [
        x + radius * Math.sin(angle),
        y + depth * Math.cos(angle),
      ]),
    )
  }),
}))

const contours = [
  'M210 104 C213 110 218 111 221 111 C226 110 230 108 232 105',
  'M190 118 C198 115 208 115 219 121 C231 115 243 115 253 120',
  'M195 142 C202 147 211 148 220 146 C231 149 242 146 249 141',
  'M220 123 C218 142 220 159 219 176',
  'M187 222 C199 226 211 235 219 248 C230 236 244 226 257 224',
  'M184 250 C196 244 207 245 218 257 M224 258 C236 246 247 244 260 252',
  'M193 309 C198 314 205 314 210 310 M237 311 C245 316 253 316 258 311',
  'M196 407 C200 410 206 410 210 408 M249 410 C253 412 258 413 261 411',
  'M199 414 C203 423 194 427 183 431 M254 416 C253 423 261 431 270 433',
  'M165 259 C168 265 170 271 171 277 M170 271 L175 286 M168 275 L173 286',
  'M276 260 C273 267 273 276 272 281 M277 270 L275 280',
]
</script>

<template>
  <svg
    class="cv3-character-wireframe"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 180 430"
    fill="none"
    aria-hidden="true"
    focusable="false"
    preserveAspectRatio="xMidYMid meet"
  >
    <defs>
      <clipPath :id="silhouetteId">
        <path :d="silhouette" />
      </clipPath>
      <linearGradient
        :id="surfaceId"
        x1="170"
        y1="200"
        x2="270"
        y2="200"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#888" stop-opacity=".035" />
        <stop offset=".23" stop-color="#828282" stop-opacity=".025" />
        <stop offset=".48" stop-color="#616161" stop-opacity=".012" />
        <stop offset=".72" stop-color="#777" stop-opacity=".02" />
        <stop offset="1" stop-color="#888" stop-opacity=".045" />
      </linearGradient>
      <radialGradient :id="rimId" cx=".28" cy=".32" r=".7">
        <stop offset="0" stop-color="#bcbcbc" stop-opacity=".025" />
        <stop offset=".5" stop-color="#888" stop-opacity=".008" />
        <stop offset="1" stop-color="#333" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="shadowId">
        <stop offset="0" stop-color="#101010" stop-opacity="0" />
        <stop offset=".5" stop-color="#101010" stop-opacity=".22" />
        <stop offset="1" stop-color="#101010" stop-opacity="0" />
      </linearGradient>
      <linearGradient :id="sectionVolumeId">
        <stop offset="0" stop-color="#aaa" stop-opacity=".035" />
        <stop offset=".12" stop-color="#aaa" stop-opacity=".075" />
        <stop offset=".3" stop-color="#999" stop-opacity=".02" />
        <stop offset=".65" stop-color="#999" stop-opacity=".005" />
        <stop offset=".9" stop-color="#999" stop-opacity=".035" />
        <stop offset="1" stop-color="#999" stop-opacity=".045" />
      </linearGradient>
    </defs>

    <g transform="translate(-135.72 -43.35) scale(1.026)">
      <path :d="silhouette" :fill="`url(#${surfaceId})`" />
      <path :d="silhouette" :fill="`url(#${rimId})`" />
      <g :clip-path="`url(#${silhouetteId})`">
        <path
          v-for="section in mesh"
          :key="`surface-${section.name}`"
          :d="section.surface"
          :fill="`url(#${sectionVolumeId})`"
        />
        <path
          d="M213 124 Q219 140 215 178 L211 224 L219 251 L229 225 L225 178 Q222 148 227 124 Z"
          :fill="`url(#${shadowId})`"
        />
        <path
          d="M184 138 Q195 152 190 178 L175 244 L172 244 L180 180 Z M254 140 Q247 161 253 181 L269 246 L273 246 L265 180 Z"
          :fill="`url(#${shadowId})`"
        />
        <g v-for="section in mesh" :key="section.name" :data-mesh-section="section.name">
          <g class="cv3-character-wireframe-rings">
            <path v-for="(ring, index) in section.rings" :key="index" :d="ring" />
          </g>
          <g class="cv3-character-wireframe-meridians">
            <path v-for="(curve, index) in section.meridians" :key="index" :d="curve" />
          </g>
        </g>
        <g class="cv3-character-wireframe-contours">
          <path v-for="(curve, index) in contours" :key="index" :d="curve" />
        </g>
      </g>
      <path class="cv3-character-wireframe-outline" :d="silhouette" />
    </g>
  </svg>
</template>

<style scoped>
.cv3-character-wireframe {
  display: block;
  flex: none;
  width: auto;
  height: 100%;
  max-width: 100%;
  overflow: visible;
  pointer-events: none;
}
.cv3-character-wireframe-rings,
.cv3-character-wireframe-meridians,
.cv3-character-wireframe-contours,
.cv3-character-wireframe-outline {
  stroke: var(--cv3-wireframe-color, #858585);
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cv3-character-wireframe-rings {
  stroke-width: 0.65;
  stroke-opacity: 0.14;
}
.cv3-character-wireframe-meridians {
  stroke-width: 0.6;
  stroke-opacity: 0.14;
}
.cv3-character-wireframe-contours {
  stroke-width: 0.6;
  stroke-opacity: 0.13;
}
.cv3-character-wireframe-outline {
  stroke-width: 0.65;
  stroke-opacity: 0.23;
}
</style>
