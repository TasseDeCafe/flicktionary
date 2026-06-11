// Builds flicktionary-logos.html — a single self-contained, shareable page
// with every logo option inlined as data URIs. Re-run after editing any SVG:
//   node build-share.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const uri = (f) => `data:image/svg+xml;base64,${readFileSync(new URL(f, import.meta.url)).toString('base64')}`

const sections = [
  {
    title: 'Option 1 · The Ticket',
    blurb: 'A cinema ticket whose left half is a vocabulary entry; the stub carries a play glyph. At tiny sizes (browser tabs) it pairs with a matching “F” mark instead of shrinking the illustration.',
    tiles: [
      { file: 'concept-d-ticket.svg', name: 'Yellow', smalls: ['concept-d-favicon-f.svg'] },
      { file: 'concept-d-sunset.svg', name: 'Sunset', smalls: ['concept-d-sunset-favicon-f.svg', 'concept-c-sunset-small.svg'] },
    ],
  },
  {
    title: 'Option 2 · The Firefly Jar',
    blurb: 'Words collected like fireflies — one drops in, the rest glow inside the jar.',
    tiles: [
      { file: 'concept-h-jar.svg', name: 'Indigo night', smalls: ['concept-h-jar-small.svg'] },
      { file: 'concept-h-midnight.svg', name: 'Midnight', smalls: ['concept-h-midnight-small.svg'] },
      { file: 'concept-h-dusk.svg', name: 'Dusk', smalls: ['concept-h-dusk-small.svg'] },
      { file: 'concept-h-forest.svg', name: 'Forest', smalls: ['concept-h-forest-small.svg'] },
      { file: 'concept-h-paper.svg', name: 'Paper (daylight)', smalls: ['concept-h-paper-small.svg'] },
    ],
  },
  {
    title: 'Option 3 · The F-strip',
    blurb: 'An “F” whose stem is a filmstrip and whose arms are subtitle lines. The most abstract; razor-sharp at every size.',
    tiles: [
      { file: 'concept-c-monogram.svg', name: 'Indigo', smalls: ['concept-c-monogram-small.svg'] },
      { file: 'concept-c-yellow.svg', name: 'Yellow on slate', smalls: ['concept-c-yellow-small.svg'] },
      { file: 'concept-c-sunset.svg', name: 'Sunset', smalls: ['concept-c-sunset-small.svg'] },
      { file: 'concept-c-ink.svg', name: 'Ink on paper', smalls: ['concept-c-ink-small.svg'] },
    ],
  },
  {
    title: 'More explorations',
    blurb: 'Other directions tried along the way.',
    compact: true,
    tiles: [
      { file: 'concept-a-highlight.svg', name: 'Subtitle highlight' },
      { file: 'concept-b-clapper.svg', name: 'Clapper entry' },
      { file: 'concept-g-ticket-f.svg', name: 'Ticket-F fusion' },
      { file: 'concept-d2-ticket-tile.svg', name: 'Ticket tile' },
      { file: 'concept-d3-ticket-stub.svg', name: 'Ticket stub' },
      { file: 'concept-e-bubble.svg', name: 'Caption bubble' },
      { file: 'concept-f-cards.svg', name: 'Card fan' },
      { file: 'concept-i-capture.svg', name: 'Web capture' },
      { file: 'concept-j-orbit.svg', name: 'Orbit' },
    ],
  },
]

const chip = (f) => `
        <span class="chip light"><img src="${uri(f)}" width="32" height="32" alt=""><img src="${uri(f)}" width="16" height="16" alt=""></span>
        <span class="chip dark"><img src="${uri(f)}" width="32" height="32" alt=""><img src="${uri(f)}" width="16" height="16" alt=""></span>`

const tile = (t, compact) => `
    <div class="tile${compact ? ' compact' : ''}">
      <img class="big" src="${uri(t.file)}" alt="${t.name}">
      <h3>${t.name}</h3>${t.smalls ? `\n      <div class="sizes">${t.smalls.map(chip).join('')}\n      </div>` : ''}
    </div>`

const section = (s) => `
  <section>
    <h2>${s.title}</h2>
    <p>${s.blurb}</p>
    <div class="row">${s.tiles.map((t) => tile(t, s.compact)).join('')}
    </div>
  </section>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flicktionary — logo options</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0 auto; padding: 32px 20px 64px;
         max-width: 1060px; background: #ECEAE4; color: #1c1917; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .lede { color: #57534e; margin: 0 0 8px; }
  section h2 { font-size: 16px; text-transform: uppercase; letter-spacing: .07em;
               color: #9a3412; margin: 44px 0 4px; }
  section > p { color: #57534e; font-size: 14px; margin: 0 0 18px; max-width: 64ch; }
  .row { display: flex; flex-wrap: wrap; gap: 22px; }
  .tile { width: 190px; }
  .tile.compact { width: 130px; }
  .tile img.big { width: 100%; height: auto; display: block; border-radius: 22%;
                  filter: drop-shadow(0 8px 18px rgba(0,0,0,.16)); }
  .tile h3 { font-size: 13.5px; margin: 10px 0 6px; font-weight: 600; }
  .sizes { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { border-radius: 10px; padding: 8px; display: inline-flex; gap: 8px; align-items: flex-end; }
  .chip.light { background: #fff; }
  .chip.dark  { background: #1c1917; }
  .vote { margin-top: 48px; padding: 16px 20px; background: #fff; border-radius: 14px;
          font-size: 14px; color: #44403c; }
</style>
</head>
<body>
<h1>Flicktionary — logo options</h1>
<p class="lede">Pick a favorite! Each option shows the app icon, and the small pairs show how the
browser-tab icon looks at 32&thinsp;px and 16&thinsp;px on light and dark.</p>
${sections.map(section).join('\n')}
<div class="vote">To vote, just name the option + color — e.g. <strong>“Jar — Dusk”</strong>,
<strong>“Ticket — Yellow”</strong>, or <strong>“F-strip — Sunset”</strong>.</div>
</body>
</html>
`

writeFileSync(new URL('flicktionary-logos.html', import.meta.url), html)
console.log('wrote flicktionary-logos.html', html.length, 'bytes')
