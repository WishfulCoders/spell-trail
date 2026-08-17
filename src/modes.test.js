import { describe, expect, it } from 'vitest'
import { MODE_REGISTRY, PEEK_MAX_MS, peekMs } from './modes.jsx'
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
