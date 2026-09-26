// @vitest-environment jsdom
// (extraction walks real DOM documents, as foliate-js produces them)
import { describe, expect, it } from 'vitest'
import { extractSectionChunks } from './extract-book-text'

const parse = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html')

describe('extractSectionChunks', () => {
  it('splits paragraphs at block elements and joins inline markup without spaces', () => {
    const doc = parse(
      '<h2>Chapter 1</h2><p><span class="dropcap">D</span>OCTOR P<small>AUL</small> arrived.</p><p>Next  para\n graph.</p>'
    )
    expect(extractSectionChunks(doc.body, [])).toEqual([
      { cutIndex: -1, paragraphs: ['Chapter 1', 'DOCTOR PAUL arrived.', 'Next para graph.'] },
    ])
  })

  it('treats <br> as a line break and keeps loose text around nested blocks apart', () => {
    const doc = parse('<div>Intro<p>Inner</p>Outro</div><p>Roses are red,<br/>violets are blue</p>')
    expect(extractSectionChunks(doc.body, [])[0]!.paragraphs).toEqual([
      'Intro',
      'Inner',
      'Outro',
      'Roses are red,',
      'violets are blue',
    ])
  })

  it('drops note references, scripts and soft hyphens', () => {
    const doc = parse('<p>Лес<a epub:type="noteref" href="#n1">1</a> зеленый<script>x()</script> поли­mer</p>')
    doc.querySelector('a')!.setAttributeNS('http://www.idpf.org/2007/ops', 'epub:type', 'noteref')
    expect(extractSectionChunks(doc.body, [])[0]!.paragraphs).toEqual([
      'Лес зеленый polimer'.replace('polimer', 'полиmer'),
    ])
  })

  it('groups paragraphs by chapter anchors inside one section', () => {
    const doc = parse(
      '<p>tail of the previous chapter</p><h2 id="c2">Chapter 2</h2><p>two</p><h2 id="c3">Chapter 3</h2><p>three</p>'
    )
    const cuts = [{ element: doc.getElementById('c2') }, { element: doc.getElementById('c3') }]
    expect(extractSectionChunks(doc.body, cuts)).toEqual([
      { cutIndex: -1, paragraphs: ['tail of the previous chapter'] },
      { cutIndex: 0, paragraphs: ['Chapter 2', 'two'] },
      { cutIndex: 1, paragraphs: ['Chapter 3', 'three'] },
    ])
  })

  it('assigns everything to a cut at the section start', () => {
    const doc = parse('<p>one</p><p>two</p>')
    expect(extractSectionChunks(doc.body, [{ element: null }])).toEqual([{ cutIndex: 0, paragraphs: ['one', 'two'] }])
  })
})
