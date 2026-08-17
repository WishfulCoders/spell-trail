export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// Support alone is not enough: a browser can expose the API with no voices
// installed, which makes every listening question silently unanswerable.
export function speechReady() {
  if (!speechSupported()) return false
  try {
    return window.speechSynthesis.getVoices().length > 0
  } catch {
    return false
  }
}

export function onVoicesChanged(handler) {
  if (!speechSupported()) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', handler)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', handler)
}

// Browsers hand back a default voice that is usually the oldest and most
// robotic one installed. Ranking them and picking the best is the single
// biggest quality win available without a paid TTS service.
const GOOD = [
  { pattern: /natural/i, score: 60 },
  { pattern: /neural/i, score: 60 },
  { pattern: /premium/i, score: 50 },
  { pattern: /enhanced/i, score: 45 },
  { pattern: /\bgoogle\b/i, score: 40 },
  { pattern: /\b(ava|allison|samantha|siri|zoe|serena|jamie|nathan)\b/i, score: 20 },
]

// Novelty and low-fidelity voices that exist on macOS and older Android.
const BAD = [
  { pattern: /compact/i, score: -50 },
  { pattern: /espeak/i, score: -60 },
  { pattern: /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|grandma|grandpa|rocko|shelley|sandy|eddy|flo|reed|rishi)\b/i, score: -70 },
]

export function scoreVoice(voice) {
  const name = voice.name || ''
  let score = 0
  for (const { pattern, score: points } of [...GOOD, ...BAD]) {
    if (pattern.test(name)) score += points
  }
  // A local voice keeps working offline, which matters for a local-first app,
  // but not enough to outweigh a clearly better-sounding remote voice.
  if (voice.localService) score += 8
  if (/^en[-_]US/i.test(voice.lang)) score += 10
  else if (/^en[-_]GB/i.test(voice.lang)) score += 6
  else if (/^en/i.test(voice.lang)) score += 4
  if (voice.default) score += 1
  return score
}

export function listVoices() {
  if (!speechSupported()) return []
  let voices = []
  try {
    voices = window.speechSynthesis.getVoices()
  } catch {
    return []
  }
  return voices
    .filter((voice) => /^en/i.test(voice.lang || ''))
    .map((voice) => ({ uri: voice.voiceURI, name: voice.name, lang: voice.lang, score: scoreVoice(voice) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export function bestVoiceUri() {
  return listVoices()[0]?.uri || null
}

function resolveVoice(preferredUri) {
  if (!speechSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  const chosen = preferredUri && voices.find((voice) => voice.voiceURI === preferredUri)
  if (chosen) return chosen
  const best = bestVoiceUri()
  return voices.find((voice) => voice.voiceURI === best) || null
}

export function speak(text, { rate = 0.82, voiceUri = null } = {}) {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = resolveVoice(voiceUri)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  utterance.rate = rate
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
}
