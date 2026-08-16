import { useEffect, useMemo, useRef, useState } from 'react'
import { BADGES, DEFAULT_PROGRESS, STORAGE_KEY, awardAnswer, finishSession, levelFromXp, levelProgress, loadProgress, makeRound, shuffle } from './game.js'
import { WORD_TIERS } from './words.js'

const MODE_COPY = {
  listen: { eyebrow: 'Listen & spot', title: 'Which spelling is right?', icon: '🔊' },
  missing: { eyebrow: 'Fill the gap', title: 'Choose the missing piece', icon: '🧩' },
  chunks: { eyebrow: 'Build the word', title: 'Tap the pieces in order', icon: '🪵' },
  type: { eyebrow: 'Typing checkpoint', title: 'Listen, then type the word', icon: '⌨️' },
}

function speak(text, rate = 0.82) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
}

function Header({ progress, onHome, view }) {
  const level = levelFromXp(progress.xp)
  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={onHome} aria-label="Go to trail map">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span><strong>Spell Trail</strong><small>Words become adventures</small></span>
      </button>
      <div className="stats" aria-label="Player progress">
        <div className="stat-chip"><span aria-hidden="true">✨</span><span><b>{progress.fireflies}</b><small>fireflies</small></span></div>
        <div className="stat-chip"><span aria-hidden="true">🔥</span><span><b>{progress.streak}</b><small>streak</small></span></div>
        <div className="level-chip"><span>LVL {level}</span><div className="mini-progress"><i style={{ width: `${levelProgress(progress.xp) * 100}%` }} /></div></div>
      </div>
      {view !== 'home' ? <button className="quiet-button desktop-only" type="button" onClick={onHome}>Exit trail</button> : null}
    </header>
  )
}

function Home({ progress, selectedTier, onTierChange, onStart, onShowRewards }) {
  const level = levelFromXp(progress.xp)
  const accuracy = progress.wordsPracticed ? Math.round((progress.correctAnswers / progress.wordsPracticed) * 100) : 0
  return (
    <main className="home-shell">
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="soft-label">TODAY'S ADVENTURE</span>
          <h1>Ready for a quick<br /><em>word quest?</em></h1>
          <p>Eight small challenges. No timer. You can hear every word as many times as you need.</p>
          <button className="primary-button" type="button" onClick={onStart}><span>Start this trail</span><b>8 words · about 5 min</b><i aria-hidden="true">→</i></button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="cloud cloud-one" /><div className="cloud cloud-two" />
          <div className="mountain mountain-back" /><div className="mountain mountain-front" />
          <div className="path"><span className="path-dot one" /><span className="path-dot two" /><span className="path-dot three">★</span></div>
          <div className="sign"><span>WORD</span><span>TRAIL</span></div>
          <div className="firefly f1">✦</div><div className="firefly f2">✦</div><div className="firefly f3">✦</div>
        </div>
      </section>

      <section className="tier-section" aria-labelledby="choose-level">
        <div className="section-heading"><div><span className="soft-label">CHOOSE YOUR PATH</span><h2 id="choose-level">Pick a practice level</h2></div><p>Start where words feel doable. You can switch anytime.</p></div>
        <div className="tier-grid">
          {WORD_TIERS.map((tier, index) => {
            const selected = selectedTier.id === tier.id
            return (
              <button className={`tier-card ${selected ? 'selected' : ''}`} style={{ '--tier-color': tier.color }} type="button" key={tier.id} onClick={() => onTierChange(tier)} aria-pressed={selected}>
                <span className="tier-number">0{index + 1}</span>
                <span className="tier-icon" aria-hidden="true">{['🌲', '🛶', '⛰️', '🏔️'][index]}</span>
                <strong>{tier.label}</strong><b>{tier.grades}</b><small>{tier.description}</small>
                <span className="tier-state">{selected ? '✓ Ready to play' : 'Choose this path'}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="progress-card">
          <div className="card-title-row"><div><span className="soft-label">YOUR PROGRESS</span><h2>Level {level} Pathfinder</h2></div><span className="round-icon">🧭</span></div>
          <div className="big-progress"><i style={{ width: `${levelProgress(progress.xp) * 100}%` }} /></div>
          <div className="progress-labels"><span>{progress.xp % 120} XP</span><span>{120 - (progress.xp % 120)} XP to Level {level + 1}</span></div>
          <div className="mini-metrics"><div><b>{progress.wordsPracticed}</b><span>words practiced</span></div><div><b>{accuracy}%</b><span>accuracy</span></div><div><b>{progress.bestStreak}</b><span>best streak</span></div></div>
        </div>
        <button className="reward-card" type="button" onClick={onShowRewards}>
          <div><span className="soft-label light">FIELD GUIDE</span><h2>Badges & rewards</h2><p>{progress.badges.length} of {BADGES.length} badges discovered</p></div>
          <div className="badge-peek">{BADGES.slice(0, 3).map((badge) => <span className={progress.badges.includes(badge.id) ? '' : 'locked'} key={badge.id}>{badge.icon}</span>)}</div>
          <span className="reward-link">Open field guide <i>→</i></span>
        </button>
      </section>
    </main>
  )
}

function ListenButton({ word, sentence, compact = false }) {
  return (
    <button className={`listen-button ${compact ? 'compact' : ''}`} type="button" onClick={() => speak(`${word}. ${sentence}`)}>
      <span className="sound-waves" aria-hidden="true"><i /><i /><i /><i /></span>
      <span><b>Hear the word</b><small>Tap as many times as you need</small></span>
    </button>
  )
}

function ListenQuestion({ item, onAnswer, disabled }) {
  const options = useMemo(() => shuffle([item.word, ...item.distractors]), [item])
  return <div className="answer-grid">{options.map((option) => <button disabled={disabled} className="word-option" type="button" key={option} onClick={() => onAnswer(option === item.word)}>{option}</button>)}</div>
}

function MissingQuestion({ item, onAnswer, disabled }) {
  const targetIndex = Math.max(0, item.chunks.length - 2)
  const target = item.chunks[targetIndex]
  const visible = item.chunks.map((chunk, index) => index === targetIndex ? '___' : chunk).join('')
  const decoys = target.length === 1 ? ['e', 'i'] : [target.split('').reverse().join(''), `${target[0]}${target}`.slice(0, target.length)]
  const options = useMemo(() => shuffle([...new Set([target, ...decoys])]).slice(0, 3), [target])
  return <><div className="missing-word" aria-label={`Word with a missing part: ${visible}`}>{item.chunks.map((chunk, index) => <span className={index === targetIndex ? 'blank' : ''} key={`${chunk}-${index}`}>{index === targetIndex ? '?' : chunk}</span>)}</div><div className="small-answer-grid">{options.map((option) => <button disabled={disabled} className="chunk-option" type="button" key={option} onClick={() => onAnswer(option === target)}>{option}</button>)}</div></>
}

function ChunkQuestion({ item, onAnswer, disabled }) {
  const choices = useMemo(() => shuffle(item.chunks.map((text, index) => ({ text, index }))), [item])
  const [picked, setPicked] = useState([])
  const built = picked.map((index) => item.chunks[index]).join('')
  function pick(index) { if (!disabled && !picked.includes(index)) setPicked((current) => [...current, index]) }
  function undo() { if (!disabled) setPicked((current) => current.slice(0, -1)) }
  return <><div className={`build-line ${built ? '' : 'empty'}`}>{built || 'Your word will appear here'}{picked.length ? <button type="button" onClick={undo} aria-label="Undo last piece">↶</button> : null}</div><div className="small-answer-grid">{choices.map((choice) => <button disabled={disabled || picked.includes(choice.index)} className="chunk-option" type="button" key={choice.index} onClick={() => pick(choice.index)}>{choice.text}</button>)}</div><button disabled={disabled || picked.length !== item.chunks.length} className="check-button" type="button" onClick={() => onAnswer(built === item.word)}>Check my word</button></>
}

function TypeQuestion({ item, onAnswer, disabled }) {
  const [value, setValue] = useState('')
  return <form className="type-form" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onAnswer(value.trim().toLowerCase() === item.word) }}><label htmlFor="typed-word">Type what you hear</label><input id="typed-word" autoComplete="off" autoCapitalize="none" spellCheck="false" value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} placeholder="Type the word…" autoFocus /><button className="check-button" disabled={disabled || !value.trim()} type="submit">Check my spelling</button></form>
}

function Game({ tier, progress, onProgress, onComplete, onExit }) {
  const [round] = useState(() => makeRound(tier))
  const [index, setIndex] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const item = round[index]
  const xpBefore = useRef(progress.xp)

  useEffect(() => { const timer = window.setTimeout(() => speak(`${item.word}. ${item.sentence}`), 350); return () => window.clearTimeout(timer) }, [item])

  function answer(isCorrect) {
    if (feedback) return
    const next = awardAnswer(progress, item.word, isCorrect)
    onProgress(next)
    setFeedback({ isCorrect, xp: isCorrect ? 12 + Math.min(next.streak, 5) : 4 })
    if (isCorrect) speak('Nice work!', 0.9)
  }

  function next() {
    if (index === round.length - 1) {
      onComplete({ score: round.length, earnedXp: progress.xp - xpBefore.current, tier })
      return
    }
    setIndex((current) => current + 1)
    setFeedback(null)
  }

  const mode = MODE_COPY[item.mode]
  return (
    <main className="game-shell">
      <div className="game-topline"><button className="back-button" type="button" onClick={onExit}>← <span>Trail map</span></button><div className="question-progress"><div><i style={{ width: `${((index + (feedback ? 1 : 0)) / round.length) * 100}%` }} /></div><span>{index + 1} of {round.length}</span></div><div className="game-streak">🔥 {progress.streak}</div></div>
      <section className="question-card">
        <div className="question-heading"><span className="mode-icon" aria-hidden="true">{mode.icon}</span><div><span className="soft-label">{mode.eyebrow}</span><h1>{mode.title}</h1></div></div>
        <ListenButton word={item.word} sentence={item.sentence} />
        <p className="sentence"><span>“</span>{item.sentence.replace(new RegExp(item.word, 'i'), '_____')}<span>”</span></p>
        <div className="question-area">
          {item.mode === 'listen' ? <ListenQuestion item={item} onAnswer={answer} disabled={Boolean(feedback)} /> : null}
          {item.mode === 'missing' ? <MissingQuestion item={item} onAnswer={answer} disabled={Boolean(feedback)} /> : null}
          {item.mode === 'chunks' ? <ChunkQuestion key={index} item={item} onAnswer={answer} disabled={Boolean(feedback)} /> : null}
          {item.mode === 'type' ? <TypeQuestion key={index} item={item} onAnswer={answer} disabled={Boolean(feedback)} /> : null}
        </div>
        {feedback ? <div className={`feedback ${feedback.isCorrect ? 'correct' : 'try-again'}`} role="status"><span className="feedback-icon">{feedback.isCorrect ? '✓' : '↗'}</span><div><b>{feedback.isCorrect ? 'You found it!' : 'Good try — now you know it.'}</b><p>The word is <strong>{item.word}</strong>. <button type="button" onClick={() => speak(item.word)}>Hear it again</button></p></div><div className="xp-pop">+{feedback.xp} XP</div><button className="next-button" type="button" onClick={next}>{index === round.length - 1 ? 'Finish trail' : 'Next word'} →</button></div> : null}
      </section>
      <p className="game-note">No timer here. Take your time and listen again whenever you want.</p>
    </main>
  )
}

function Complete({ summary, progress, newBadges, onHome, onReplay }) {
  return <main className="complete-shell"><section className="complete-card"><div className="celebration" aria-hidden="true"><span>✦</span><span>✧</span><div>🏕️</div><span>✧</span><span>✦</span></div><span className="soft-label">TRAIL COMPLETE</span><h1>You made it to camp!</h1><p>Eight words explored, and every try made your spelling trail stronger.</p><div className="complete-stats"><div><span>⚡</span><b>+{summary.earnedXp + 30}</b><small>XP earned</small></div><div><span>✨</span><b>{progress.fireflies}</b><small>fireflies total</small></div><div><span>🔥</span><b>{progress.bestStreak}</b><small>best streak</small></div></div>{newBadges.length ? <div className="new-badge"><span>{newBadges[0].icon}</span><div><small>NEW BADGE</small><b>{newBadges[0].label}</b><p>{newBadges[0].detail}</p></div></div> : null}<div className="complete-actions"><button className="primary-button" type="button" onClick={onHome}><span>Back to trail map</span><i>→</i></button><button className="quiet-button" type="button" onClick={onReplay}>Practice this level again</button></div></section></main>
}

function Rewards({ progress, onBack }) {
  return <main className="rewards-shell"><button className="back-button" type="button" onClick={onBack}>← Trail map</button><div className="rewards-heading"><span className="soft-label">FIELD GUIDE</span><h1>Your discoveries</h1><p>Badges celebrate steady practice—not perfect scores.</p></div><div className="badge-grid">{BADGES.map((badge) => { const unlocked = progress.badges.includes(badge.id); return <article className={`badge-card ${unlocked ? '' : 'locked'}`} key={badge.id}><div className="big-badge">{unlocked ? badge.icon : '◇'}</div><span>{unlocked ? 'DISCOVERED' : 'STILL HIDING'}</span><h2>{badge.label}</h2><p>{badge.detail}</p></article> })}</div><section className="firefly-bank"><div><span className="soft-label light">FIREFLY JAR</span><h2>{progress.fireflies} fireflies collected</h2><p>Each correct answer adds light to your jar. A three-answer streak earns an extra firefly.</p></div><div className="jar" aria-label={`${progress.fireflies} fireflies`}><i>✦</i><i>✦</i><i>✦</i><i>✦</i><i>✦</i></div></section></main>
}

export default function App() {
  const [progress, setProgress] = useState(() => loadProgress())
  const [selectedTier, setSelectedTier] = useState(WORD_TIERS[1])
  const [view, setView] = useState('home')
  const [summary, setSummary] = useState(null)
  const [newBadges, setNewBadges] = useState([])

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)) }, [progress])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [view])
  function completeRound(roundSummary) {
    const before = new Set(progress.badges)
    const finished = finishSession(progress)
    setProgress(finished)
    setNewBadges(BADGES.filter((badge) => finished.badges.includes(badge.id) && !before.has(badge.id)))
    setSummary(roundSummary)
    setView('complete')
  }
  function resetDemo() { setProgress(DEFAULT_PROGRESS); setView('home') }

  return <div className="app"><Header progress={progress} view={view} onHome={() => setView('home')} />{view === 'home' ? <Home progress={progress} selectedTier={selectedTier} onTierChange={setSelectedTier} onStart={() => setView('game')} onShowRewards={() => setView('rewards')} /> : null}{view === 'game' ? <Game tier={selectedTier} progress={progress} onProgress={setProgress} onComplete={completeRound} onExit={() => setView('home')} /> : null}{view === 'complete' && summary ? <Complete summary={summary} progress={progress} newBadges={newBadges} onHome={() => setView('home')} onReplay={() => setView('game')} /> : null}{view === 'rewards' ? <Rewards progress={progress} onBack={() => setView('home')} /> : null}<footer><span>Spell Trail saves progress on this device.</span><button type="button" onClick={resetDemo}>Reset progress</button></footer></div>
}
