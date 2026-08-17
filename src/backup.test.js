import { describe, expect, it } from 'vitest'
import { isValidCode, loadBackup, normalizeCode, packStore, saveBackup, unpackStore } from './backup.js'
import { makeCode } from '../worker/index.js'
import { addProfile, emptyStore } from './profiles.js'
import { clampRoundLength, ROUND_LENGTH, ROUND_LENGTH_OPTIONS } from './game.js'

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('backup codes', () => {
  it('builds a readable four-part code', () => {
    const code = makeCode(new Uint32Array([1, 2, 3, 4567]))
    expect(isValidCode(code)).toBe(true)
    expect(code.split('-')).toHaveLength(4)
  })

  it('pads the digits so the shape is always the same', () => {
    expect(makeCode(new Uint32Array([0, 1, 2, 7])).endsWith('-0007')).toBe(true)
  })

  it('accepts a code the parent retyped with spaces or capitals', () => {
    expect(normalizeCode('  Otter Summit Ridge 4821 ')).toBe('otter-summit-ridge-4821')
    expect(isValidCode(normalizeCode('OTTER-SUMMIT-RIDGE-4821'))).toBe(true)
  })

  it('rejects codes of the wrong shape', () => {
    for (const bad of ['', 'otter', 'otter-summit-4821', 'otter-summit-ridge-482', 'a-b-c-12345']) {
      expect(isValidCode(normalizeCode(bad)), `${bad} should be invalid`).toBe(false)
    }
  })
})

describe('backup payload', () => {
  it('round-trips every player', () => {
    const store = addProfile(addProfile(emptyStore(), 'Ada'), 'Ben')
    const restored = unpackStore(packStore(store))
    expect(restored.profiles).toHaveLength(3)
    expect(restored.profiles.map((p) => p.name)).toContain('Ada')
    expect(restored.activeId).toBe(store.activeId)
  })

  it('refuses a payload with no players rather than wiping the device', () => {
    expect(() => unpackStore(JSON.stringify({ profiles: [] }))).toThrow(/did not contain/)
    expect(() => unpackStore('{}')).toThrow(/did not contain/)
  })

  it('does not send the device-only settings', () => {
    const store = { ...emptyStore(), settings: { voiceUri: 'some-local-voice' }, backupCode: 'x' }
    expect(packStore(store)).not.toContain('some-local-voice')
  })
})

describe('backup transport', () => {
  it('mints a code on first save', async () => {
    const calls = []
    const fetcher = async (url, init) => { calls.push({ url, init }); return jsonResponse({ code: 'a-b-c-0001', savedAt: 5 }) }
    const result = await saveBackup(emptyStore(), null, fetcher)
    expect(result.code).toBe('a-b-c-0001')
    expect(JSON.parse(calls[0].init.body).code).toBeUndefined()
  })

  it('reuses the existing code on later saves', async () => {
    const calls = []
    const fetcher = async (url, init) => { calls.push(init); return jsonResponse({ code: 'a-b-c-0001' }) }
    await saveBackup(emptyStore(), 'a-b-c-0001', fetcher)
    expect(JSON.parse(calls[0].body).code).toBe('a-b-c-0001')
  })

  it('explains a missing code in words a parent can act on', async () => {
    const fetcher = async () => jsonResponse({ error: 'not-found' }, 404)
    await expect(loadBackup('otter-summit-ridge-4821', fetcher)).rejects.toThrow(/Check for typos/)
  })

  it('rejects a malformed code before making a request', async () => {
    let called = false
    const fetcher = async () => { called = true; return jsonResponse({}) }
    await expect(loadBackup('nonsense', fetcher)).rejects.toThrow(/backup code/)
    expect(called).toBe(false)
  })

  it('reports a network failure without losing local data', async () => {
    const fetcher = async () => jsonResponse({}, 500)
    await expect(saveBackup(emptyStore(), null, fetcher)).rejects.toThrow(/Could not reach/)
  })
})

describe('session length', () => {
  it('keeps every offered length intact', () => {
    for (const option of ROUND_LENGTH_OPTIONS) expect(clampRoundLength(option)).toBe(option)
  })

  it('snaps an unexpected value to the nearest offered length', () => {
    expect(clampRoundLength(9)).toBe(8)
    expect(clampRoundLength(100)).toBe(16)
    expect(clampRoundLength(1)).toBe(3)
  })

  it('falls back to the default for junk', () => {
    for (const junk of [null, undefined, 'eight', NaN]) expect(clampRoundLength(junk)).toBe(ROUND_LENGTH)
  })
})
