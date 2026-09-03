import { describe, expect, it } from 'vitest'
import { MODE_REGISTRY, PEEK_MAX_MS, SPELLING_KEY_ROWS, normalizeSpelling, peekMs } from './modes.jsx'
import { MODES } from './game.js'

describe('mode registry', () => {
  it('can draw every mode the round planner is allowed to pick', () => {
    for (const mode of MODES) {
      expect(MODE_REGISTRY[mode], `${mode} has no question component`).toBeTruthy()
      expect(MODE_REGISTRY[mode].component).toBeTypeOf('function')
      expect(MODE_REGISTRY[mode].icon, `${mode} icon`).toBeTruthy()
    }
  })
})

describe('memory trail peek', () => {
  it('holds a longer word on screen for longer', () => {
    expect(peekMs('expedition')).toBeGreaterThan(peekMs('said'))
  })

  it('gives even the shortest word long enough to read', () => {
    expect(peekMs('a')).toBeGreaterThanOrEqual(1500)
  })

  it('caps the peek so a long word does not sit there being copied', () => {
    expect(peekMs('a'.repeat(40))).toBe(PEEK_MAX_MS)
  })
})

describe('spelling answer normalization', () => {
  it('ignores capitalization and surrounding space', () => {
    expect(normalizeSpelling('  RoCkEt  ')).toBe('rocket')
  })

  it('treats smart punctuation as the spelling punctuation it resembles', () => {
    expect(normalizeSpelling('mother\u2019s')).toBe("mother's")
    expect(normalizeSpelling('merry\u2013go\u2013round')).toBe('merry-go-round')
  })

  it('removes invisible characters inserted by input methods', () => {
    expect(normalizeSpelling('spell\u200bing')).toBe('spelling')
  })
})

describe('spelling keyboard', () => {
  it('uses the familiar QWERTY row layout', () => {
    expect(SPELLING_KEY_ROWS.map((row) => row.join(''))).toEqual(['qwertyuiop', 'asdfghjkl', 'zxcvbnm'])
  })

  it('offers every letter exactly once', () => {
    const letters = SPELLING_KEY_ROWS.flat()
    expect([...letters].sort().join('')).toBe('abcdefghijklmnopqrstuvwxyz')
  })
})
