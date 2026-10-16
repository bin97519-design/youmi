// Unmodified SVG assets from the local 4178 reference package. Hash filenames
// intentionally match its asset manifest, so provenance stays easy to audit.
const sources = import.meta.glob('../assets/libtv/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const names = {
  // Extracted from states/02-image-node.body.html in the same reference kit.
  referenceMark: 'reference-mark',
  referenceStyle: 'reference-style',
  chevron: '5e7a0273012aebb1',
  workflow: '961726419a41e5fb',
  storyboard: 'ca259fc675126a67',
  share: 'ea1e414dcafd134e',
  credits: '3845154d97bfee7a',
  diamond: '65da125820ff2cc0',
  power: '71dd175ae112b946',
  plus: 'a4a37a05409e3a16',
  move: '1b76a1b13116a459',
  materials: '9fc180bd0a44d542',
  character: '138f6494e577c6d5',
  history: 'a17e4d2f48db91aa',
  keyboard: '3fefa3e8ae35701f',
  help: '6c137efed80f7558',
}
export const REFERENCE_ICONS = Object.fromEntries(
  Object.entries(names).map(([name, hash]) => {
    const svg = sources[`../assets/libtv/icons/${hash}.svg`]
    return [
      name,
      {
        viewBox: svg.match(/viewBox="([^"]+)"/)[1],
        body: svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')),
      },
    ]
  }),
)
