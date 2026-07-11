import { describe, expect, it } from 'vitest'
import SubtitleReader from './subtitle-reader'
import { SubtitleHtml } from '@asbplayer-fork/common'

const createReader = (convertNetflixRuby = false) =>
  new SubtitleReader({
    regexFilter: '',
    regexFilterTextReplacement: '',
    subtitleHtml: SubtitleHtml.render,
    convertNetflixRuby,
  })

const nfimscFile = (xml: string) => ({ name: 'test.nfimsc', text: async () => xml }) as unknown as File

const parse = (xml: string, convertNetflixRuby = false) => createReader(convertNetflixRuby).subtitles([nfimscFile(xml)])

describe('SubtitleReader Netflix IMSC parsing', () => {
  it('parses Netflix IMSC cues', async () => {
    // Prefixed elements, namespaced ttp:tickRate, a dur-only cue, a second
    // <div>, and a nested <span> all in one document.
    const xml =
      '<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">' +
      '<tt:body>' +
      '<tt:div>' +
      '<tt:p begin="10000000t" end="30000000t"><tt:span>Hello</tt:span> world</tt:p>' +
      '<tt:p begin="40000000t" dur="20000000t">Second line</tt:p>' +
      '</tt:div>' +
      '<tt:div>' +
      '<tt:p begin="70000000t" end="90000000t">Third line</tt:p>' +
      '</tt:div>' +
      '</tt:body>' +
      '</tt:tt>'

    const subtitles = await parse(xml)

    expect(subtitles).toHaveLength(3)
    expect(subtitles[0]).toMatchObject({ start: 1000, end: 3000, text: 'Hello world' })
    expect(subtitles[1]).toMatchObject({ start: 4000, end: 6000, text: 'Second line' })
    expect(subtitles[2]).toMatchObject({ start: 7000, end: 9000, text: 'Third line' })
  })

  it('converts IMSC ruby styles to ruby html', async () => {
    // The ruby container references two styles ("plain container") to exercise
    // multi-id style resolution.
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:tickRate="10000000">' +
      '<head><styling>' +
      '<style xml:id="plain" tts:fontStyle="normal"/>' +
      '<style xml:id="container" tts:ruby="container"/>' +
      '<style xml:id="base" tts:ruby="base"/>' +
      '<style xml:id="text" tts:ruby="text"/>' +
      '</styling></head>' +
      '<body><div>' +
      '<p begin="10000000t" end="30000000t"><span style="plain container"><span style="base">日本</span><span style="text">にほん</span></span></p>' +
      '</div></body>' +
      '</tt>'

    const withRuby = await parse(xml, true)
    expect(withRuby).toHaveLength(1)
    expect(withRuby[0].text).toBe('<ruby><rb>日本</rb><rt>にほん</rt></ruby>')

    const withoutRuby = await parse(xml, false)
    expect(withoutRuby).toHaveLength(1)
    expect(withoutRuby[0].text).toBe('日本(にほん)')
  })

  it('binds a ruby reading to its own base when preceded by kanji or kana', async () => {
    // The base 子 is preceded by the kana ひろ. The reading must bind to 子 alone,
    // not to the whole ひろ子 run.
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:tickRate="10000000">' +
      '<head><styling>' +
      '<style xml:id="container" tts:ruby="container"/>' +
      '<style xml:id="base" tts:ruby="base"/>' +
      '<style xml:id="text" tts:ruby="text"/>' +
      '</styling></head>' +
      '<body><div>' +
      '<p begin="10000000t" end="30000000t">ひろ<span style="container"><span style="base">子</span><span style="text">こ</span></span>そんな</p>' +
      '</div></body>' +
      '</tt>'

    const withRuby = await parse(xml, true)
    expect(withRuby).toHaveLength(1)
    expect(withRuby[0].text).toBe('ひろ<ruby><rb>子</rb><rt>こ</rt></ruby>そんな')
    expect(withRuby[0].text).not.toContain('\u2063')

    const withoutRuby = await parse(xml, false)
    expect(withoutRuby).toHaveLength(1)
    expect(withoutRuby[0].text).toBe('ひろ子(こ)そんな')
    expect(withoutRuby[0].text).not.toContain('\u2063')
  })

  it('does not fence a reading containing a closing paren', async () => {
    // The reading )こ cannot be matched by netflixRubyRegex, so no marker is inserted
    // and the cue passes through as literal text.
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:tickRate="10000000">' +
      '<head><styling>' +
      '<style xml:id="container" tts:ruby="container"/>' +
      '<style xml:id="base" tts:ruby="base"/>' +
      '<style xml:id="text" tts:ruby="text"/>' +
      '</styling></head>' +
      '<body><div>' +
      '<p begin="10000000t" end="30000000t">ひろ<span style="container"><span style="base">子</span><span style="text">)こ</span></span>そんな</p>' +
      '</div></body>' +
      '</tt>'

    const withRuby = await parse(xml, true)
    expect(withRuby).toHaveLength(1)
    expect(withRuby[0].text).toBe('ひろ子()こ)そんな')
    expect(withRuby[0].text).not.toContain('\u2063')
  })

  it('drops tick cues when the tick rate is missing', async () => {
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml">' +
      '<body><div><p begin="100t" end="200t">Should be dropped</p></div></body>' +
      '</tt>'

    const subtitles = await parse(xml)

    expect(subtitles).toHaveLength(0)
  })
})

describe('SubtitleReader dfxp timestamp handling', () => {
  it('drops cues whose timestamps are not finite', async () => {
    const xml = '<tt><body><div><p begin="100t" end="200t">Dropped</p></div></body></tt>'
    const file = { name: 'test.dfxp', text: async () => xml } as unknown as File
    const subtitles = await createReader().subtitles([file])

    expect(subtitles).toHaveLength(0)
  })
})

describe('SubtitleReader ytsrv3 pen-layer duplicate handling', () => {
  const srv3File = (xml: string) => ({ name: 'test.ytsrv3', text: async () => xml }) as unknown as File
  const parseSrv3 = (xml: string) => createReader().subtitles([srv3File(xml)])

  it('keeps one copy of a cue emitted twice as pen layers', async () => {
    // Fancy-styled tracks (e.g. MrBeast captions) emit each cue twice with
    // identical timing/text — one row per pen layer (outline + fill); only the
    // <s p="..."> pen ids differ. A genuine repeated line (same text, later
    // start) must survive.
    const xml =
      '<timedtext format="3"><body>' +
      '<p t="0" d="2000"><s p="3">Hello </s><s p="3" t="500">world</s></p>' +
      '<p t="0" d="2000"><s p="4">Hello </s><s p="4" t="500">world</s></p>' +
      '<p t="3000" d="1000">Plain line</p>' +
      '<p t="5000" d="1000">Plain line</p>' +
      '</body></timedtext>'

    const subtitles = await parseSrv3(xml)

    expect(subtitles).toHaveLength(3)
    expect(subtitles[0]).toMatchObject({ start: 0, end: 2000, text: 'Hello world' })
    expect(subtitles[1]).toMatchObject({ start: 3000, end: 4000, text: 'Plain line' })
    expect(subtitles[2]).toMatchObject({ start: 5000, end: 6000, text: 'Plain line' })
  })

  it('keeps the tighter end when the layer copies were clamped differently', async () => {
    // The read-ahead overlap clamp sees the following row only from the SECOND
    // copy (the first copy's next row is its twin, not the '\n' separator), so
    // the surviving cue must adopt the twin's tighter end.
    const xml =
      '<timedtext format="3"><body>' +
      '<p t="0" d="5000"><s p="3">Hello</s></p>' +
      '<p t="0" d="5000"><s p="4">Hello</s></p>' +
      '<p t="2000" d="1">\n</p>' +
      '<p t="2000" d="1000">Next</p>' +
      '</body></timedtext>'

    const subtitles = await parseSrv3(xml)

    expect(subtitles).toHaveLength(2)
    expect(subtitles[0]).toMatchObject({ start: 0, end: 2000, text: 'Hello' })
  })

  it('keeps the twin rows out of the ASR re-chunker word stream', async () => {
    // Enough explicitly-timed words to trip the re-chunking path (>= 10):
    // duplicated rows would otherwise double every word in each chunk.
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
    const row = (pen: string) =>
      `<p t="0" d="6000">${words.map((w, i) => `<s p="${pen}"${i > 0 ? ` t="${i * 400}"` : ''}>${w} </s>`).join('')}</p>`
    const xml = `<timedtext format="3"><body>${row('3')}${row('4')}</body></timedtext>`

    const subtitles = await parseSrv3(xml)

    const joined = subtitles.map((s) => s.text).join(' ')
    for (const word of words) {
      expect(joined.match(new RegExp(`\\b${word}\\b`, 'g'))).toHaveLength(1)
    }
  })
})
