import { describe, expect, it } from 'vitest'
import { parseSrt } from './srt-parser'

describe('parseSrt', () => {
  it('parses a basic single-cue file', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Hello, world!`
    expect(parseSrt(srt)).toEqual([{ index: 0, text: 'Hello, world!', startMs: 1000, endMs: 3500 }])
  })

  it('joins multi-line cues with a single space', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
First line
Second line
Third line`
    expect(parseSrt(srt)).toEqual([{ index: 0, text: 'First line Second line Third line', startMs: 1000, endMs: 3000 }])
  })

  it('handles BOM and CRLF', () => {
    const srt = `﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nThere`
    expect(parseSrt(srt)).toEqual([
      { index: 0, text: 'Hi', startMs: 1000, endMs: 2000 },
      { index: 1, text: 'There', startMs: 3000, endMs: 4000 },
    ])
  })

  it('reindexes after skipping malformed cues', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
A

malformed-block

3
00:00:03,000 --> 00:00:04,000
B`
    expect(parseSrt(srt)).toEqual([
      { index: 0, text: 'A', startMs: 1000, endMs: 2000 },
      { index: 1, text: 'B', startMs: 3000, endMs: 4000 },
    ])
  })

  it('accepts WebVTT-style milliseconds dot separator', () => {
    const srt = `1
00:00:01.250 --> 00:00:02.000
Dot ms`
    expect(parseSrt(srt)).toEqual([{ index: 0, text: 'Dot ms', startMs: 1250, endMs: 2000 }])
  })

  it('strips inline markup (italic, bold, font tags) and collapses leftover whitespace', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
<i>Congratulations, Hudson High Class of 2004.</i>

2
00:00:03,000 --> 00:00:04,000
Hi <b>Bob</b>, <font color="red">welcome</font> back.`
    expect(parseSrt(srt)).toEqual([
      { index: 0, text: 'Congratulations, Hudson High Class of 2004.', startMs: 1000, endMs: 2000 },
      { index: 1, text: 'Hi Bob, welcome back.', startMs: 3000, endMs: 4000 },
    ])
  })
})
