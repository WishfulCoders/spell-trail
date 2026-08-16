export const STORAGE_KEY = 'spell-trail-progress-v1'

export const DEFAULT_PROGRESS = {
  xp: 0,
  fireflies: 0,
  streak: 0,
  bestStreak: 0,
  wordsPracticed: 0,
  correctAnswers: 0,
  sessionsCompleted: 0,
  badges: [],
  mastered: {},
}

export const BADGES = [
  { id: 'first-step', icon: '🥾', label: 'First Step', detail: 'Finish your first trail', test: (p) => p.sessionsCompleted >= 1 },
  { id: 'bright-spark', icon: '✨', label: 'Bright Spark', detail: 'Reach a 5-answer streak', test: (p) => p.bestStreak >= 5 },
  { id: 'word-scout', icon: '🧭', label: 'Word Scout', detail: 'Practice 20 words', test: (p) => p.wordsPracticed >= 20 },
  { id: 'summit-star', icon: '🏔️', label: 'Summit Star', detail: 'Earn 500 XP', test: (p) => p.xp >= 500 },
]

export function levelFromXp(xp) {
  return Math.floor(xp / 120) + 1
}

export function levelProgress(xp) {
  return (xp % 120) / 120
}

export function shuffle(items, random = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

export function makeRound(tier, random = Math.random) {
  const words = shuffle(tier.words, random)
  return words.map((entry, index) => ({
    ...entry,
    mode: index === 3 || index === 7 ? 'type' : index % 3 === 0 ? 'listen' : index % 3 === 1 ? 'missing' : 'chunks',
  }))
}

export function awardAnswer(progress, word, isCorrect) {
  const streak = isCorrect ? progress.streak + 1 : 0
  const xpEarned = isCorrect ? 12 + Math.min(streak, 5) : 4
  const firefliesEarned = isCorrect ? (streak >= 3 ? 2 : 1) : 0
  const mastered = { ...progress.mastered }
  const previous = mastered[word] || { right: 0, tries: 0 }
  mastered[word] = { right: previous.right + (isCorrect ? 1 : 0), tries: previous.tries + 1 }
  return {
    ...progress,
    xp: progress.xp + xpEarned,
    fireflies: progress.fireflies + firefliesEarned,
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    wordsPracticed: progress.wordsPracticed + 1,
    correctAnswers: progress.correctAnswers + (isCorrect ? 1 : 0),
    mastered,
  }
}

export function finishSession(progress) {
  const next = { ...progress, sessionsCompleted: progress.sessionsCompleted + 1, xp: progress.xp + 30 }
  const badges = BADGES.filter((badge) => badge.test(next)).map((badge) => badge.id)
  return { ...next, badges }
}

export function loadProgress(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    return saved ? { ...DEFAULT_PROGRESS, ...saved } : DEFAULT_PROGRESS
  } catch {
    return DEFAULT_PROGRESS
  }
}
