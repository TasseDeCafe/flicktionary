// The shot manifest: which account, which videos/words/timestamps, which demo
// content, and how raw captures map to landing-page assets. This file is the
// single place to curate "what the screenshots show".

// Dedicated demo account so captures never depend on (or pollute) a developer
// account. The seed script creates it on first run; everything it accumulates
// can be thrown away by deleting the user in Supabase.
export const DEMO = {
  email: process.env.SCREENSHOT_EMAIL ?? 'demo@flicktionary.app',
  nativeLanguage: 'en',
  cefr: [
    { language: 'de', level: 'B1' },
    { language: 'es', level: 'B1' },
  ],
}

// Curated videos + word targets. Timestamps and words were picked from the
// actual subtitle tracks (German has a manual de-DE track; Spanish is ASR).
// - gloss: the single word hovered for the translation-popover shot.
// - multiword: adjacent words drag-selected for the phrase-selection shot.
// - vocabulary: extra words saved via the API (not on screen during capture
//   cues where possible) so the session-vocabulary list looks lived-in.
export const VIDEOS = [
  {
    label: 'german',
    // "zahlen vs bezahlen" — only 0:15–1:00 is free of the burned-in text
    // cards this channel overlays elsewhere, so all frame targets sit there.
    videoId: 'XJjPBlSYkrU',
    // The manual human-made track — the plain ASR 'de' track exists too and
    // must not win (lowercase, re-chunked timings).
    trackLanguage: 'de-DE',
    // "Diese beiden Verben haben dieselbe Grundbedeutung:" (0:31.1–0:37.1)
    gloss: { word: 'Grundbedeutung', seekToS: 34 },
    // "Also verzeiht mir, falls ich etwas fertig aussehe" (0:19.3–0:25.0).
    // The phrase sits on the first rendered subtitle row, so the popover
    // (anchored above the selection) doesn't cover the selected words —
    // phrases on lower rows end up hidden behind their own popover.
    multiword: { words: ['verzeiht', 'mir'], seekToS: 21.5 },
    // Clicked in the web reader for the gloss-sheet shot; keep it out of
    // `vocabulary` so it renders the unsaved fresh-gloss state.
    readerGlossWord: 'Wörterbüchern',
    vocabulary: [
      'Temperaturen',
      'Geldsumme',
      'Steuern',
      'Handwerker',
      'Waschmaschine',
      'überweisen',
      'Angestellten',
      'Kredit',
      'abreisen',
      'Vorgang',
    ],
  },
  {
    label: 'spanish',
    videoId: 'YbahIjEG2i4',
    trackLanguage: 'es',
    // "tienes aquí un templo y aquí un rascacielos" (~3:20–3:23, ASR track)
    gloss: { word: 'rascacielos', seekToS: 201.5 },
    vocabulary: ['aventura', 'camarero', 'comestible', 'barrios'],
  },
]

// Plain-text sources for the text-reader variant of the session view (and to
// diversify the sessions list). Self-authored so there is no licensing issue.
export const TEXTS = [
  {
    label: 'spanish-article',
    title: 'Un domingo en el Rastro',
    highlights: ['gangas', 'callejuelas'],
    text: [
      'El Rastro es el mercado al aire libre más famoso de Madrid. Cada domingo por la mañana, miles de personas pasean entre los puestos en busca de gangas.',
      'Aquí se vende de todo: ropa de segunda mano, discos antiguos, muebles restaurados y recuerdos curiosos. Los vendedores montan sus puestos al amanecer, cuando las calles todavía están tranquilas.',
      'Los visitantes más experimentados llegan temprano para encontrar los mejores tesoros. Regatear forma parte de la experiencia, y casi nadie paga el primer precio.',
      'A mediodía, los bares de la zona se llenan de gente que pide cañas y tapas. Muchos madrileños terminan la mañana compartiendo unas bravas con amigos.',
      'Si visitas Madrid, reserva un domingo para perderte por sus callejuelas. Seguro que vuelves a casa con algo inesperado en la mochila.',
    ].join('\n\n'),
  },
  {
    label: 'german-article',
    title: 'Warum wir träumen',
    highlights: ['verarbeitet', 'lebhaft'],
    text: [
      'Warum träumen wir eigentlich? Forscher beschäftigen sich seit Jahrzehnten mit dieser Frage.',
      'Während wir schlafen, verarbeitet unser Gehirn die Erlebnisse des Tages. Besonders in der sogenannten REM-Phase sind unsere Träume lebhaft und manchmal völlig absurd.',
      'Manche Wissenschaftler vermuten, dass Träume uns helfen, Erinnerungen zu ordnen. Andere glauben, dass wir im Schlaf gefährliche Situationen gefahrlos üben können.',
      'Sicher ist: Wer ausgeschlafen ist, kann sich besser konzentrieren. Und wer sich direkt nach dem Aufwachen Notizen macht, erinnert sich deutlich länger an seine Träume.',
    ].join('\n\n'),
  },
]

// The focus-view chat shot: one real exchange on the hero card, seeded through
// the live card-chat endpoint (so the assistant answer is genuine).
export const CHAT = {
  // Prefer a saved phrase card; fall back to the single-word hero.
  cardHeadwordLike: ['%verzeih%', '%grundbedeutung%'],
  question: "Why is it 'verzeiht mir' and not 'verzeih mir' here — who is she talking to?",
}

// Practice-state shaping (German is the showcased practice language). The
// oldest promoteCount recognition facets become due review flashcards; the
// rest stay in warm-up parking, which serves gate exercises.
export const PRACTICE = {
  language: 'de',
  promoteCount: 6,
}

// Raw captures (shots/) that refresh the landing assets. Each entry copies the
// full 1280×800 capture over the existing asset name (drop-in refresh) and,
// when `crop` is set, additionally writes `<name>-cropped.png` next to it for
// tighter landing-page framing. Crop rects are in raw-capture pixels.
export const LANDING_ASSETS = [
  // Popover + subtitle line, without the full letterboxed frame.
  { out: 'subtitle-popover.png', src: 'ext-german-gloss-popover.png', crop: { left: 240, top: 200, width: 960, height: 560 } },
  // Just the sessions column (drops the sidebar).
  { out: 'sessions.png', src: 'web-sessions.png', crop: { left: 316, top: 8, width: 900, height: 784 } },
  // Header + article text (the lower half of the reader is empty).
  { out: 'import-article.png', src: 'web-session-text.png', crop: { left: 0, top: 0, width: 1280, height: 440 } },
  // Chat side panel plus a sliver of the card editor for context.
  { out: 'ai-chat.png', src: 'web-focus-chat.png', crop: { left: 480, top: 0, width: 800, height: 800 } },
  // Exercise column incl. the "Correct!" feedback and Next button.
  { out: 'practice.png', src: 'web-practice-exercise-correct.png', crop: { left: 240, top: 40, width: 800, height: 760 } },
  // List without the sidebar.
  { out: 'vocabulary.png', src: 'web-vocabulary.png', crop: { left: 256, top: 0, width: 1024, height: 800 } },
]
