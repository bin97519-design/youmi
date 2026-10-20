// SVG shapes observed in the reference canvas. Kept local so icon rendering is
// independent of a font CDN, font fallback, and the Remix icon version.
const icon = (viewBox, body) => ({ viewBox, body })
const path = (d, extra = '') => `<path d="${d}" fill="currentColor" ${extra}/>`

export const CANVAS_ICONS = {
  canvasInsert: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v5M13.5 12v6M10.5 15h6"/></g>',
  ),
  shortcutAdjust: icon(
    '0 0 16 16',
    path(
      'M8.46 6.75c1.27 0 2.33.89 2.6 2.07h2.2c.23 0 .4.18.4.4v.4a.4.4 0 0 1-.4.4h-2.2a2.67 2.67 0 0 1-5.2 0H.4a.4.4 0 0 1-.4-.4v-.4c0-.22.18-.4.4-.4h5.46a2.7 2.7 0 0 1 2.6-2.07m0 1.2a1.47 1.47 0 1 0 0 2.94 1.47 1.47 0 0 0 0-2.93M5.31 0c1.26 0 2.32.88 2.6 2.07h5.36c.22 0 .4.18.4.4v.4a.4.4 0 0 1-.4.4H7.9a2.67 2.67 0 0 1-5.2 0H.4a.4.4 0 0 1-.4-.4v-.4c0-.22.18-.4.4-.4h2.3A2.7 2.7 0 0 1 5.3 0m0 1.2a1.47 1.47 0 1 0 0 2.93 1.47 1.47 0 0 0 0-2.93',
      'transform="translate(1.165 1.955)"',
    ),
  ),
  smile: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="10" cy="10" r="7.5"/><path d="M6 11.5q4 5 8 0M6.5 7.5h.1m6.8 0h.1"/></g>',
  ),
  panorama: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M3 5q7 3 14 0v10q-7-3-14 0zM6 12l3-3 2 2 3-2"/><path d="M6 2H4a2 2 0 0 0-2 2m12-2h2a2 2 0 0 1 2 2M6 18H4a2 2 0 0 1-2-2m12 2h2a2 2 0 0 0 2-2"/></g>',
  ),
  angles: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2"><ellipse cx="10" cy="10" rx="8" ry="3.5"/><ellipse cx="10" cy="10" rx="3.5" ry="8"/><path d="M10 2v16M2 10h16"/></g>',
  ),
  lighting: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M4 4l2 2m8 8 2 2M4 16l2-2m8-8 2-2"/></g>',
  ),
  grid: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="16" height="16" rx="1"/><path d="M7 2v16m6-16v16M2 7h16M2 13h16"/></g>',
  ),
  gridFour: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="16" height="16" rx="2"/><path d="M10 2v16M2 10h16"/></g>',
  ),
  faceViews: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2H3a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M2 14v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3M5 11c.5 3 2 4 5 4s4.5-1 5-4M7 7h.01M13 7h.01M10 8v3h1"/></g>',
  ),
  characterSheet: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="10" cy="6" r="4"/><path d="M2 18a8 8 0 0 1 16 0"/></g>',
  ),
  sceneSheet: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="m10 2 8 5-8 5-8-5zM5.2 9 2 12l8 5 8-5-3.2-3"/></g>',
  ),
  productSheet: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="6" y="2" width="8" height="16" rx="1"/><path d="M6 4H2v12h4M14 4h4v12h-4"/></g>',
  ),
  storyGrid: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="16" height="16" rx="1"/><path d="M6 2v16m8-16v16M2 7h16M2 13h16M6 2l8 5M6 13l8 5"/></g>',
  ),
  cinematicLight: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="16" height="16" rx="2"/><path d="m3 13 4-4 4 5M13 2v4m-2-2h4M10 10l3-3 4 4"/><circle cx="6" cy="5" r="1"/></g>',
  ),
  threeViews: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="16" height="16" rx="2"/><path d="M7 6v8M13 6v8M5 10h2m6 0h2"/></g>',
  ),
  frameForward: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="m8 7 4 3-4 3M14 7v6"/></g>',
  ),
  frameBackward: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="m12 7-4 3 4 3M6 7v6"/></g>',
  ),
  hd: icon(
    '0 0 20 20',
    '<rect x="1" y="3" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4 7v6m4-6v6m-4-3h4m3-3v6h2a3 3 0 0 0 0-6z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  ),
  elements: icon(
    '0 0 20 20',
    '<path d="m6 10 5-5a3 3 0 0 1 4 4l-7 7a4 4 0 0 1-6-6l7-7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  ),
  layers: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="m10 2 8 5-8 5-8-5zM2 11l8 5 8-5M2 15l8 4 8-4"/></g>',
  ),
  eraser: icon(
    '0 0 20 20',
    '<path d="m3 12 9-9 6 6-8 8H6zM8 7l6 6M10 17h8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  rotate: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M10 2v16M3 7c-4 6 18 6 14 0M3 7l4 1M3 7l2-3"/><path d="m13 16-3 3-3-3"/></g>',
  ),
  reset: icon(
    '0 0 20 20',
    '<path d="M3 3v5h5M3.6 7A7 7 0 1 1 3 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  download: icon(
    '0 0 20 20',
    '<path d="M10 2v11m-4-4 4 4 4-4M3 13v4h14v-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  expand: icon(
    '0 0 20 20',
    '<path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M12 3h5v5M17 3l-6 6M3 12v5h5M3 17l6-6"/>',
  ),
  collapse: icon(
    '0 0 20 20',
    '<path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M17 3l-6 6m0-5v5h5M3 17l6-6m0 5v-5H4"/>',
  ),
  settings: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="1.5" fill="#282828"/><circle cx="13" cy="10" r="1.5" fill="#282828"/><circle cx="7" cy="15" r="1.5" fill="#282828"/></g>',
  ),
  rectangle: icon(
    '0 0 20 16',
    '<rect x="1.5" y="2.5" width="17" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  ),
  arrowUp: icon(
    '0 0 20 20',
    '<path d="M10 16V4m-5 5 5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  close: icon(
    '0 0 20 20',
    '<path d="m5 5 10 10M5 15 15 5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  ),
  scissors: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="5" r="2.4"/><circle cx="5" cy="15" r="2.4"/><path d="m7 6.2 10 6.3M7 13.8l10-6.3M8.3 9.2 6.8 8.3m1.5 2.5-1.5.9"/></g>',
  ),
  check: icon(
    '0 0 20 20',
    '<path d="m4 10 4 4L16 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  copy: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.25"><rect x="6" y="6" width="10" height="10" rx="2"/><path d="M13 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1"/></g>',
  ),
  thumbUp: icon(
    '0 0 20 20',
    '<path d="M6 8v9H3V8zm0 8h8.2a2 2 0 0 0 1.95-1.56l1.02-4.5A2 2 0 0 0 15.22 7H12l.55-2.2A2.25 2.25 0 0 0 10.36 2L6 8" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  thumbDown: icon(
    '0 0 20 20',
    '<path d="M6 12V3H3v9zm0-8h8.2a2 2 0 0 1 1.95 1.56l1.02 4.5A2 2 0 0 1 15.22 13H12l.55 2.2A2.25 2.25 0 0 1 10.36 18L6 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  brain: icon(
    '0 0 20 20',
    '<path d="M8 4.2A2.5 2.5 0 0 0 3.8 6a2.7 2.7 0 0 0-.1 5A2.8 2.8 0 0 0 8 14.6V4.2Zm4 0A2.5 2.5 0 0 1 16.2 6a2.7 2.7 0 0 1 .1 5 2.8 2.8 0 0 1-4.3 3.6V4.2ZM8 7H6m2 4H5.5m6.5-4h2m-2 4h2.5M8 4v12m4-12v12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  search: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></g>',
  ),
  filter: icon(
    '0 0 20 20',
    '<path d="M3 5h14M6 10h8m-5 5h2" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>',
  ),
  folder: icon(
    '0 0 20 20',
    '<path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h4l1.6 1.75H16A1.5 1.5 0 0 1 17.5 7.25v7.25A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" fill="currentColor"/><path d="M2.8 7h14.4" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>',
  ),
  diamond: icon('0 0 20 20', path('M5 3h10l4 5-9 10L1 8z')),
  text: icon(
    '0 0 20 20',
    '<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><rect x="2" y="3" width="16" height="14" rx="3"/><path d="M6 7h8M6 10h8M6 13h5"/></g>',
  ),
  upload: icon(
    '0 0 20 20',
    '<path d="M3 12v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4M10 13V3M6 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  chevron: icon(
    '0 0 16 16',
    path(
      'M6.2.12a.4.4 0 0 1 .56 0l.43.42a.4.4 0 0 1 0 .57L4.15 4.15a.7.7 0 0 1-1 0L.13 1.1a.4.4 0 0 1 0-.57L.54.12a.4.4 0 0 1 .57 0l2.54 2.54z',
      'transform="translate(4.345 5.825)"',
    ),
  ),
  image: icon(
    '0 0 24 24',
    path(
      'M9.8 2.5a.63.63 0 0 1 0 1.25H5.61c-1.03 0-1.87.84-1.87 1.88v6.26l1.9-1.8a1.46 1.46 0 0 1 2.03.04L10 12.45l.64-.64a1.45 1.45 0 0 1 2.06 0l3.37 3.37q.17-.37.18-.8V10.2a.62.62 0 0 1 1.25 0v4.16c0 1.73-1.4 3.13-3.12 3.13H5.62a3.1 3.1 0 0 1-3.12-3.12V5.62C2.5 3.9 3.9 2.5 5.63 2.5zm-3 8.51a.2.2 0 0 0-.3 0l-2.75 2.6v.77c0 1.03.84 1.87 1.88 1.87h8.75q.43 0 .8-.18l-3.37-3.37a.2.2 0 0 0-.26-.03l-.03.03-1.08 1.08a.6.6 0 0 1-.88 0zM15 1.67c.2 0 .38.12.45.3l.58 1.52q.14.35.48.48l1.51.58a.49.49 0 0 1 0 .9l-1.5.58a.8.8 0 0 0-.49.48l-.58 1.51a.49.49 0 0 1-.9 0l-.58-1.5a.8.8 0 0 0-.48-.49l-1.51-.58a.49.49 0 0 1 0-.9l1.5-.58q.35-.14.49-.48l.58-1.51a.5.5 0 0 1 .45-.31',
      'transform="scale(1.2)"',
    ),
  ),
  video: icon(
    '0 0 24 24',
    path(
      'M9.98 2.5a.62.62 0 1 1 0 1.25H5.81c-1.03 0-1.87.84-1.87 1.88v8.75c0 1.03.84 1.87 1.87 1.87h8.75c1.04 0 1.88-.84 1.88-1.87V10.2a.63.63 0 0 1 1.25 0v4.16c0 1.73-1.4 3.13-3.13 3.13H5.81a3.13 3.13 0 0 1-3.12-3.12V5.62c0-1.72 1.4-3.12 3.12-3.12zm-1.3 4.86c.22-.1.47-.08.66.06l2.7 2.08a.63.63 0 0 1 0 1l-2.7 2.08a.62.62 0 0 1-1-.5V7.82q.06-.31.34-.46m6.5-5.7q.34.02.46.32l.58 1.5q.14.35.48.49l1.51.58a.49.49 0 0 1 0 .9l-1.5.58a.8.8 0 0 0-.49.48l-.58 1.51a.49.49 0 0 1-.9 0l-.58-1.5a.8.8 0 0 0-.48-.49l-1.51-.58a.49.49 0 0 1 0-.9l1.5-.58q.35-.14.49-.48l.58-1.51a.5.5 0 0 1 .45-.31',
      'transform="scale(1.2)"',
    ),
  ),
  audio: icon(
    '0 0 24 24',
    path(
      'M15.83 11.67q.32.01.46.3l.58 1.52q.14.35.48.48l1.5.58a.49.49 0 0 1 0 .9l-1.5.58a.8.8 0 0 0-.48.48l-.58 1.51a.49.49 0 0 1-.91 0l-.58-1.5a.8.8 0 0 0-.48-.49l-1.51-.58a.49.49 0 0 1 0-.9l1.51-.58q.35-.14.48-.48l.58-1.51a.5.5 0 0 1 .45-.31M6.46 2.5c.34 0 .62.28.62.63v13.75a.62.62 0 1 1-1.25 0V3.13c0-.35.28-.63.63-.63M10 5.83c.35 0 .62.28.63.63v7.08a.63.63 0 0 1-1.26 0V6.46c0-.35.28-.63.63-.63M3.13 7.5c.34 0 .62.28.62.63v3.74a.62.62 0 1 1-1.25 0V8.14c0-.35.28-.63.63-.63m10.41-3.33c.35 0 .63.28.63.62v6.25a.63.63 0 0 1-1.25 0V4.8c0-.34.28-.62.62-.62m3.34 3.33c.34 0 .62.28.62.63v2.08a.62.62 0 1 1-1.25 0v-2.1c0-.34.28-.62.63-.62',
      'transform="scale(1.2)"',
    ),
  ),
  script: icon(
    '0 0 20 20',
    path(
      'M15.83 2.5c1.15 0 2.09.93 2.09 2.08v2.09c0 .8-.66 1.46-1.46 1.46H15v7.5c0 1.03-.84 1.87-1.87 1.87H3.95a2.3 2.3 0 0 1-2.3-2.3v-.82c0-.81.66-1.46 1.47-1.46h1.04v-1.67a.62.62 0 1 1 1.25 0v1.67h5.62c.8 0 1.46.65 1.46 1.46v1.24a.62.62 0 1 0 1.25 0V4.59q0-.45.18-.83H8.75a.62.62 0 1 1 0-1.25zM3.13 14.17a.2.2 0 0 0-.21.2v.84c0 .57.46 1.04 1.04 1.04h7.4q-.1-.3-.11-.62v-1.26a.2.2 0 0 0-.2-.2zM5 2.5c.2 0 .38.12.45.31l.45 1.17c.17.44.52.78.96.95l1.16.45a.49.49 0 0 1 0 .9l-1.16.45c-.44.17-.79.52-.96.96l-.45 1.17a.49.49 0 0 1-.9 0L4.1 7.69a1.7 1.7 0 0 0-.96-.96L1.98 6.3a.49.49 0 0 1 0-.91l1.16-.45c.44-.17.79-.51.96-.95l.45-1.17A.5.5 0 0 1 5 2.5m10.83 1.25a.83.83 0 0 0-.83.83v2.3h1.46c.11 0 .2-.1.2-.21V4.58a.83.83 0 0 0-.83-.83',
    ),
  ),
  smartEdit: icon(
    '0 0 20 20',
    path(
      'M10 14.17c.35 0 .63.28.63.62v2.92a.62.62 0 1 1-1.26 0v-2.92c0-.34.28-.62.63-.62M4.1 4.1a.63.63 0 0 1 .9 0l5.44 5.45c.25.24.25.64 0 .88L5 15.9a.63.63 0 0 1-.88-.88l4.38-4.38H2.3a.62.62 0 1 1 0-1.26h6.2L4.11 5a.6.6 0 0 1 0-.88m8.85 8.84a.63.63 0 0 1 .88 0L15.9 15a.63.63 0 0 1-.88.88l-2.06-2.06a.6.6 0 0 1 0-.88m4.76-3.57a.62.62 0 1 1 0 1.24H14.8a.62.62 0 1 1 0-1.24zM15 4.1a.63.63 0 0 1 .88.88l-2.06 2.06a.63.63 0 0 1-.88-.88zm-5-2.43c.35 0 .63.28.63.62v2.92a.62.62 0 1 1-1.26 0V2.29c0-.34.28-.62.63-.62',
    ),
  ),
  plus: icon(
    '0 0 20 20',
    path(
      'M9.38 16.67v-6.05H3.33a.62.62 0 1 1 0-1.24h6.05V3.33a.63.63 0 0 1 1.24 0v6.05h6.05a.63.63 0 0 1 0 1.24h-6.05v6.05a.63.63 0 0 1-1.24 0',
    ),
  ),
  move: icon(
    '0 0 20 20',
    path(
      'M2.33 4.72c-.5-1.48.9-2.9 2.39-2.39L17.08 6.6c1.63.57 1.7 2.85.1 3.51l-4.77 1.96a.6.6 0 0 0-.34.34l-1.96 4.77-.06.14a1.88 1.88 0 0 1-3.39-.1l-.06-.14zm1.98-1.2a.63.63 0 0 0-.8.79L7.8 16.67c.18.54.95.57 1.17.03l1.95-4.76.08-.17q.32-.6.95-.86l4.76-1.96a.62.62 0 0 0-.03-1.16z',
    ),
  ),
  materials: icon(
    '0 0 20 20',
    path(
      'M6.94 10.84c1.15 0 2.08.93 2.08 2.08v2.6c0 1.15-.93 2.09-2.08 2.09h-2.6a2.1 2.1 0 0 1-2.09-2.09v-2.6c0-1.15.93-2.08 2.08-2.08zm7.23.2c.35 0 .63.28.63.62v1.94h1.93a.63.63 0 0 1 0 1.25H14.8v1.93a.63.63 0 0 1-1.25 0v-1.93H11.6a.63.63 0 0 1 0-1.25h1.94v-1.94c0-.34.28-.62.62-.62m-9.84 1.05h-.08a.83.83 0 0 0-.75.83v2.6c0 .44.33.8.75.83h2.68c.47 0 .84-.37.84-.83v-2.6a.83.83 0 0 0-.83-.83zm.42-9.85a1.25 1.25 0 0 1 1.77 0L9.08 4.8a1.25 1.25 0 0 1 0 1.77L6.52 9.13c-.49.49-1.28.49-1.77 0L2.2 6.57a1.25 1.25 0 0 1 0-1.77zm9.42.06a3.38 3.38 0 1 1 0 6.77a3.38 3.38 0 0 1 0-6.77M3.07 5.7l2.56 2.56L8.2 5.69L5.63 3.13zm11.1-2.14c-1.18 0-2.13.96-2.13 2.14v.21c.11 1 .9 1.8 1.91 1.9l.22.02c1.1 0 2.02-.84 2.12-1.92l.02-.21c0-1.1-.84-2.02-1.92-2.13z',
    ),
  ),
  character: icon(
    '0 0 20 20',
    path(
      'M17.08 10a7.08 7.08 0 1 0-14.16 0a7.08 7.08 0 0 0 14.16 0m-2.45 0c.34.05.58.37.53.71a5.2 5.2 0 0 1-4.45 4.45a.62.62 0 1 1-.17-1.24a3.96 3.96 0 0 0 3.38-3.38a.63.63 0 0 1 .7-.53M7.29 6.68a1.04 1.04 0 1 1 0 2.08a1.04 1.04 0 0 1 0-2.08m4.17 0a1.04 1.04 0 1 1 0 2.08a1.04 1.04 0 0 1 0-2.08M18.33 10a8.33 8.33 0 1 1-16.66 0a8.33 8.33 0 0 1 16.66 0',
    ),
  ),
  history: icon(
    '0 0 20 20',
    path(
      'M17.08 10a7.08 7.08 0 1 0-14.16 0a7.08 7.08 0 0 0 14.16 0m-7.7-3.54a.62.62 0 1 1 1.24 0v3.28l2.11 2.11a.63.63 0 0 1-.88.88l-2.3-2.29a.6.6 0 0 1-.18-.44zM18.33 10a8.33 8.33 0 1 1-16.66 0a8.33 8.33 0 0 1 16.66 0',
    ),
  ),
  keyboard: icon(
    '0 0 20 20',
    path(
      'M16.08 3.35c1.72 0 3.12 1.4 3.12 3.13l-.03 7.05c0 1.72-1.4 3.12-3.13 3.12H3.96a3.13 3.13 0 0 1-3.13-3.13l.04-7.05c0-1.72 1.4-3.12 3.12-3.12zM3.99 4.6c-1.03 0-1.87.84-1.87 1.88l-.04 7.05c0 1.03.84 1.87 1.88 1.87h12.08c1.04 0 1.88-.84 1.88-1.88l.03-7.04v-.2c-.1-.94-.9-1.68-1.87-1.68zm.8 6.44a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67m10.42 0a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67m-3.34.21a.62.62 0 1 1 0 1.25H8.14a.62.62 0 1 1 0-1.25zM4.8 7.29a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67m3.34 0a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67m3.74 0a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67m3.34 0a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67',
    ),
  ),
  help: icon(
    '0 0 20 20',
    path(
      'M10 1.67a8.33 8.33 0 1 1 0 16.66a8.33 8.33 0 0 1 0-16.66m0 1.25a7.08 7.08 0 1 0 0 14.16a7.08 7.08 0 0 0 0-14.16m0 9.58a.83.83 0 1 1 0 1.67a.83.83 0 0 1 0-1.67m.27-6.73c.54.03 1.09.21 1.52.58c.43.38.71.93.71 1.6c0 1.02-.72 1.6-1.15 1.97c-.49.43-.72.69-.72 1.12a.63.63 0 0 1-1.26 0c0-1.06.7-1.66 1.15-2.05c.52-.45.73-.67.73-1.04q-.02-.44-.28-.65a1.3 1.3 0 0 0-.77-.28c-.66-.04-1.28.29-1.48.89a.63.63 0 0 1-1.19-.4c.43-1.28 1.68-1.8 2.74-1.74',
    ),
  ),
  assets: icon(
    '0 0 20 20',
    path(
      'M17.48.01A2.8 2.8 0 0 1 20 2.81V17.2l-.01.28a2.8 2.8 0 0 1-2.5 2.5l-.3.02H2.8a2.8 2.8 0 0 1-2.79-2.52L0 17.2V2.8A2.8 2.8 0 0 1 2.8 0h14.4zM2.8 1.8a1 1 0 0 0-1 1v14.4a1 1 0 0 0 1 1h4.08V1.8zm5.88 16.4h8.52a1 1 0 0 0 1-1V2.8a1 1 0 0 0-1-1H8.68z',
    ),
  ),
  directorDock: icon(
    '0 0 16 16',
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M13.67 5.17c0-.83-.67-1.5-1.5-1.5H3.83c-.83 0-1.5.67-1.5 1.5v5.66c0 .83.67 1.5 1.5 1.5h8.34c.83 0 1.5-.67 1.5-1.5zm1 5.66a2.5 2.5 0 0 1-2.5 2.5H3.83a2.5 2.5 0 0 1-2.5-2.5V5.17a2.5 2.5 0 0 1 2.5-2.5h8.34a2.5 2.5 0 0 1 2.5 2.5z" fill="currentColor" fill-opacity=".9"/><path d="M11.33 10.5v-5a.5.5 0 0 1 1 0v5a.5.5 0 1 1-1 0" fill="currentColor" fill-opacity=".9"/>',
  ),
  directorFloat: icon(
    '0 0 16 16',
    '<g transform="translate(1.33333 2.66667)"><path d="M12.33 2.5c0-.83-.67-1.5-1.5-1.5H2.5C1.67 1 1 1.67 1 2.5v5.67c0 .83.67 1.5 1.5 1.5h8.33c.83 0 1.5-.67 1.5-1.5zm1 5.67a2.5 2.5 0 0 1-2.5 2.5H2.5A2.5 2.5 0 0 1 0 8.17V2.5A2.5 2.5 0 0 1 2.5 0h8.33a2.5 2.5 0 0 1 2.5 2.5z" fill="currentColor" fill-opacity=".9"/><path d="M10.5 4.33H8.83a.5.5 0 0 0-.5.5v3c0 .28.23.5.5.5h1.67a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5" fill="currentColor" fill-opacity=".9"/></g>',
  ),
  links: icon(
    '0 0 16 16',
    path(
      'M9.28 0a2.28 2.28 0 1 1-2.22 2.8h-4.5a1.52 1.52 0 1 0 0 3.03h6.42a2.57 2.57 0 0 1 0 5.14h-4.5a2.28 2.28 0 1 1 0-1.05h4.5a1.52 1.52 0 0 0 0-3.04H2.57a2.57 2.57 0 0 1 0-5.13h4.5C7.3.75 8.2 0 9.26 0m-7 9.22a1.23 1.23 0 1 0 0 2.45a1.23 1.23 0 0 0 0-2.45m7-8.17a1.22 1.22 0 1 0 0 2.45a1.22 1.22 0 0 0 0-2.45',
      'transform="translate(2.225 1.64)"',
    ),
  ),
  workflow: icon(
    '0 0 16 16',
    path(
      'M12.25 11.03a1.22 1.22 0 1 0-2.45 0a1.22 1.22 0 0 0 2.45 0M6.9 2.33q1.32-.01 2.09.05q.4.03.7.1q.31.1.58.32c.42.4.6.99.5 1.56q-.09.34-.3.58q-.2.25-.5.5q-.6.49-1.69 1.24L5.91 8.35q-1.09.77-1.6 1.19q-.27.22-.37.35l-.08.13q-.06.34.19.6l.14.06q.16.04.5.07q.67.05 2 .04h.54a.53.53 0 0 1 0 1.05H6.7q-1.31.01-2.09-.04q-.39-.03-.7-.11t-.58-.31a1.7 1.7 0 0 1-.5-1.56q.09-.34.3-.59t.5-.5q.6-.48 1.69-1.23l2.37-1.68q1.08-.76 1.6-1.18q.27-.23.37-.36l.08-.13a.6.6 0 0 0-.18-.6L9.4 3.5a3 3 0 0 0-.5-.08q-.67-.05-2-.04h-.25a.53.53 0 0 1 0-1.05zm-2.82.53a1.22 1.22 0 1 0-2.45 0a1.22 1.22 0 0 0 2.45 0m9.22 8.17a2.28 2.28 0 1 1-4.55 0a2.28 2.28 0 0 1 4.55 0M5.13 2.86a2.28 2.28 0 1 1-4.55 0a2.28 2.28 0 0 1 4.55 0',
      'transform="translate(1 1)"',
    ),
  ),
  storyboard: icon(
    '0 0 16 16',
    path(
      'M10.5 6.3H6.3v4.2h1.93q.73 0 1.1-.02t.5-.11q.35-.18.54-.54q.08-.13.1-.5q.04-.37.03-1.1zm0-2.97q0-.74-.02-1.11c-.02-.26-.06-.4-.11-.5q-.18-.35-.54-.54q-.13-.08-.5-.1q-.37-.04-1.1-.03H6.3v4.2h4.2zm-9.45 4.9q0 .73.02 1.1t.11.5q.18.35.54.54c.1.05.24.09.5.1q.37.04 1.1.03h1.93V1.05H3.33q-.74 0-1.11.02c-.26.02-.4.06-.5.11q-.35.18-.54.54c-.05.1-.09.24-.1.5q-.04.37-.03 1.1zm10.5 0q0 .71-.03 1.19t-.22.89q-.34.65-1 1q-.4.19-.88.21q-.47.04-1.2.03h-4.9q-.71 0-1.19-.03a2 2 0 0 1-.89-.22a2.3 2.3 0 0 1-1-1q-.19-.4-.21-.88q-.04-.47-.03-1.2v-4.9q0-.71.03-1.19q.02-.47.22-.89q.34-.65 1-1q.4-.19.88-.21q.47-.04 1.2-.03h4.9q.71 0 1.19.03t.89.22q.65.34 1 1q.19.4.21.88q.04.47.03 1.2z',
      'transform="translate(2.225 2.225)"',
    ),
  ),
  share: icon(
    '0 0 14 14',
    path(
      'M10.12.642a2.276 2.276 0 0 1 0 4.55a2.27 2.27 0 0 1-1.647-.708L5.297 6.338a2.28 2.28 0 0 1 0 1.323l3.178 1.852a2.275 2.275 0 1 1-.531.906L4.767 8.567a2.276 2.276 0 1 1 0-3.136l3.176-1.853A2.275 2.275 0 0 1 10.12.642m0 9.216c-.428 0-.804.22-1.023.553a.5.5 0 0 1-.065.109a1.225 1.225 0 1 0 1.088-.661m-7-4.083a1.224 1.224 0 1 0 0 2.45a1.224 1.224 0 0 0 0-2.45m7-4.083a1.224 1.224 0 1 0 0 2.45a1.224 1.224 0 0 0 0-2.45',
    ),
  ),
  power: icon(
    '0 0 16 16',
    path(
      'M7.3.64A.5.5 0 0 0 7 .05a.6.6 0 0 0-.67.14L.13 7.05a.5.5 0 0 0-.08.56c.1.19.3.3.51.3H3.8l-.97 4.11c-.06.24.07.48.3.6c.23.1.51.05.68-.14L10 5.62a.5.5 0 0 0 .08-.56a.6.6 0 0 0-.51-.31H6.33z',
      'transform="translate(2.935 1.665)"',
    ),
  ),
  credits: icon(
    '0 0 16 16',
    path(
      'M8 1.33a6.67 6.67 0 1 1 0 13.34A6.67 6.67 0 0 1 8 1.33m0 3.24c-.2 0-.38.12-.45.3L6.9 6.53a.5.5 0 0 1-.29.3l-1.64.63a.49.49 0 0 0 0 .9L6.62 9a.5.5 0 0 1 .3.28l.63 1.65a.49.49 0 0 0 .9 0l.64-1.65A.5.5 0 0 1 9.37 9l1.65-.64a.49.49 0 0 0 0-.9L9.37 6.8a.5.5 0 0 1-.28-.29l-.64-1.64a.5.5 0 0 0-.45-.3',
    ),
  ),
  magnet: icon(
    '0 0 24 24',
    '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m12 15l4 4M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282zM5 8l4 4"/>',
  ),
  layout: icon(
    '0 0 16 16',
    '<g fill="none" stroke="currentColor" stroke-width="1.1"><rect x="2" y="2" width="5" height="7" rx="1"/><rect x="9" y="2" width="5" height="4" rx="1"/><rect x="2" y="11" width="5" height="3" rx="1"/><rect x="9" y="8" width="5" height="6" rx="1"/></g>',
  ),
  minimap: icon(
    '0 0 21.8 21.8',
    path(
      'M10.9 0a6.9 6.9 0 0 1 6.9 6.9l-.01.4a10 10 0 0 1-1.82 4.7h1.93a1.9 1.9 0 0 1 1.8 1.3l2 6l.06.22a1.9 1.9 0 0 1-1.64 2.27l-.22.01h-18a1.9 1.9 0 0 1-1.8-2.5l2-6l.06-.14A1.9 1.9 0 0 1 3.9 12h1.93A10 10 0 0 1 4 7.3v-.4A6.9 6.9 0 0 1 10.9 0M3.87 13.8l-.02.02l-.04.05l-2 6a.1.1 0 0 0 0 .09l.04.03l.05.01h18a.1.1 0 0 0 .08-.04l.02-.05v-.04l-2-6l-.04-.05l-.06-.02h-3.3a27 27 0 0 1-2.55 2.61a1.9 1.9 0 0 1-2.36-.04c-.6-.54-1.54-1.44-2.5-2.57zm7.03-12a5.1 5.1 0 0 0-5.1 5.1c0 1.51.83 3.18 1.95 4.7A24 24 0 0 0 10.9 15l.05-.01a24 24 0 0 0 3.1-3.38C15.17 10.08 16 8.4 16 6.9a5.1 5.1 0 0 0-5.1-5.1m0 2.2a2.9 2.9 0 1 1 0 5.8a2.9 2.9 0 0 1 0-5.8m0 1.8a1.1 1.1 0 1 0 0 2.2a1.1 1.1 0 0 0 0-2.2',
    ),
  ),
}
