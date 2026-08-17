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

export function speak(text, rate = 0.82) {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
}
