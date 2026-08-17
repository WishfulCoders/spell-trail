import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BADGES,
  ROUND_LENGTH,
  ROUND_LENGTH_OPTIONS,
  SESSION_BONUS,
  awardAnswer,
  blankSentence,
  buildRound,
  finishSession,
  levelFromXp,
  levelProgress,
  makeRetry,
  newProgress,
  xpIntoLevel,
  xpToNextLevel,
} from './game.js'
import { MODE_REGISTRY } from './modes.jsx'
import {
  MAX_NAME_LENGTH,
  MAX_PROFILES,
  activeProfile,
  addProfile,
  cleanName,
  createPack,
  loadStore,
  removeProfile,
  renameProfile,
  saveStore,
  setRoundLength,
  setVoice,
  updatePack,
  updateProfile,
} from './profiles.js'
import {
  COMPANIONS,
  buyCompanion,
  companionEmoji,
  equipCompanion,
  nextCompanion,
  ownedCompanions,
  ownsCompanion,
} from './shop.js'
import { bestVoiceUri, listVoices, onVoicesChanged, speak, speechReady, stopSpeaking } from './speech.js'
import { loadBackup, saveBackup } from './backup.js'
import { MAX_PACK_WORDS, buildPackWords, parseEntries } from './wordgen.js'
import { DEFAULT_TIER_ID, WORD_TIERS } from './words.js'

// Chrome fires `voiceschanged` once, often before React has mounted and
// subscribed — so the event alone leaves the app believing it has no speech.
// Poll briefly as well, then give up and fall back to written clues.
// Change this one line to point the heart somewhere else.
export const SUPPORT_URL = 'https://buymeacoffee.com/wishfulcoders'

const VOICE_POLL_MS = 250
const VOICE_GIVE_UP_MS = 4000

function useAudioAvailable() {
  const [available, setAvailable] = useState(() => speechReady())
  useEffect(() => {
    if (available) return undefined
    let stopped = false
    const check = () => {
      if (stopped || !speechReady()) return
      stopped = true
      setAvailable(true)
    }
    const unsubscribe = onVoicesChanged(check)
    const interval = window.setInterval(check, VOICE_POLL_MS)
    const giveUp = window.setTimeout(() => window.clearInterval(interval), VOICE_GIVE_UP_MS)
    check()
    return () => {
      stopped = true
      unsubscribe()
      window.clearInterval(interval)
      window.clearTimeout(giveUp)
    }
  }, [available])
  return available
}

// A trail can be drawn from a built-in tier or from a pack the grown-up typed
// in. Everything downstream only needs { label, color, words }.
function resolveSource(selection, profile) {
  if (selection?.kind === 'pack') {
    const pack = profile.packs.find((entry) => entry.id === selection.id)
    if (pack) return { kind: 'pack', id: pack.id, label: pack.name, color: profile.color, icon: '📝', words: pack.words }
  }
  const tier = WORD_TIERS.find((entry) => entry.id === selection?.id)
    || WORD_TIERS.find((entry) => entry.id === DEFAULT_TIER_ID)
  return { kind: 'tier', id: tier.id, label: tier.label, color: tier.color, icon: tier.icon, words: tier.words }
}

function Header({ profile, onHome, onSwitch, view }) {
  const level = levelFromXp(profile.progress.xp)
  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={onHome} aria-label="Go to trail map">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span><strong>Spell Trail</strong><small>Words become adventures</small></span>
      </button>
      <div className="stats" aria-label="Player progress">
        <button className="who-chip" type="button" onClick={onSwitch} style={{ '--tier-color': profile.color }}>
          <span aria-hidden="true">{companionEmoji(profile.avatar)}</span>
          <span><b>{profile.name}</b><small>switch player</small></span>
        </button>
        <div className="stat-chip"><span aria-hidden="true">✨</span><span><b>{profile.progress.fireflies}</b><small>fireflies</small></span></div>
        <div className="stat-chip"><span aria-hidden="true">🔥</span><span><b>{profile.progress.streak}</b><small>streak</small></span></div>
        <div className="level-chip"><span>LVL {level}</span><div className="mini-progress"><i style={{ width: `${levelProgress(profile.progress.xp) * 100}%` }} /></div></div>
      </div>
      {view !== 'home' ? <button className="quiet-button desktop-only" type="button" onClick={onHome}>Exit trail</button> : null}
    </header>
  )
}

function Home({ profile, selection, source, onSelect, onStart, onShowRewards, onShowFamily }) {
  const { progress } = profile
  const level = levelFromXp(progress.xp)
  const accuracy = progress.wordsPracticed ? Math.round((progress.correctAnswers / progress.wordsPracticed) * 100) : 0
  const roundLength = Math.min(profile.roundLength || ROUND_LENGTH, source.words.length)
  return (
    <main className="home-shell">
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="soft-label">{profile.name.toUpperCase()}'S ADVENTURE</span>
          <h1>Ready for a quick<br /><em>word quest?</em></h1>
          <p>{roundLength} small challenges. No timer. You can hear every word as many times as you need.</p>
          <button className="primary-button" type="button" onClick={onStart}>
            <span>Start {source.label}</span>
            <b>{roundLength} words · about 5 min</b>
            <i aria-hidden="true">→</i>
          </button>
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

      {profile.packs.length ? (
        <section className="tier-section" aria-labelledby="this-week">
          <div className="section-heading">
            <div><span className="soft-label">FROM YOUR GROWN-UP</span><h2 id="this-week">This week's words</h2></div>
            <p>Spelling lists typed in for you.</p>
          </div>
          <div className="tier-grid">
            {profile.packs.map((pack) => {
              const selected = selection.kind === 'pack' && selection.id === pack.id
              return (
                <button className={`tier-card pack-card ${selected ? 'selected' : ''}`} style={{ '--tier-color': profile.color }} type="button" key={pack.id} onClick={() => onSelect({ kind: 'pack', id: pack.id })} aria-pressed={selected}>
                  <span className="tier-icon" aria-hidden="true">📝</span>
                  <strong>{pack.name}</strong><b>{pack.words.length} words</b>
                  <small>{pack.words.slice(0, 4).map((entry) => entry.word).join(', ')}{pack.words.length > 4 ? '…' : ''}</small>
                  <span className="tier-state">{selected ? '✓ Ready to play' : 'Practice this list'}</span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="tier-section" aria-labelledby="choose-level">
        <div className="section-heading">
          <div><span className="soft-label">CHOOSE YOUR PATH</span><h2 id="choose-level">Pick a practice level</h2></div>
          <p>Start where words feel doable. You can switch anytime.</p>
        </div>
        <div className="tier-grid">
          {WORD_TIERS.map((tier, index) => {
            const selected = selection.kind === 'tier' && selection.id === tier.id
            return (
              <button className={`tier-card ${selected ? 'selected' : ''}`} style={{ '--tier-color': tier.color }} type="button" key={tier.id} onClick={() => onSelect({ kind: 'tier', id: tier.id })} aria-pressed={selected}>
                <span className="tier-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="tier-icon" aria-hidden="true">{tier.icon}</span>
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
          <div className="progress-labels"><span>{xpIntoLevel(progress.xp)} XP</span><span>{xpToNextLevel(progress.xp)} XP to Level {level + 1}</span></div>
          <div className="mini-metrics"><div><b>{progress.wordsPracticed}</b><span>words practiced</span></div><div><b>{accuracy}%</b><span>accuracy</span></div><div><b>{progress.bestStreak}</b><span>best streak</span></div></div>
        </div>
        <button className="reward-card" type="button" onClick={onShowRewards}>
          <div><span className="soft-label light">FIELD GUIDE</span><h2>Badges & rewards</h2><p>{progress.badges.length} of {BADGES.length} badges discovered</p></div>
          <div className="badge-peek">{BADGES.slice(0, 3).map((badge) => <span className={progress.badges.includes(badge.id) ? '' : 'locked'} key={badge.id}>{badge.icon}</span>)}</div>
          <span className="reward-link">Open field guide <i>→</i></span>
        </button>
      </section>

      <button className="family-link" type="button" onClick={onShowFamily}>
        <span aria-hidden="true">👋</span>
        <span><b>Grown-ups: players & word lists</b><small>Add a player, or type in this week's spelling words</small></span>
        <i aria-hidden="true">→</i>
      </button>
    </main>
  )
}

function ListenButton({ word, sentence, audio, voiceUri }) {
  if (!audio) {
    return (
      <p className="audio-notice">
        <span aria-hidden="true">🔇</span>
        This browser has no speech voices available, so the trail is showing written clues instead.
      </p>
    )
  }
  return (
    <button className="listen-button" type="button" onClick={() => speak(`${word}. ${sentence}`, { voiceUri })}>
      <span className="sound-waves" aria-hidden="true"><i /><i /><i /><i /></span>
      <span><b>Hear the word</b><small>Tap as many times as you need</small></span>
    </button>
  )
}

function Game({ source, progress, roundLength, onProgress, onComplete, onExit, audio, voiceUri }) {
  const [base] = useState(() => buildRound({ words: source.words, length: roundLength, audio }))
  const [retries, setRetries] = useState([])
  const [index, setIndex] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const xpBefore = useRef(progress.xp)
  const missed = useRef(new Set())

  const items = useMemo(() => [...base, ...retries], [base, retries])
  const item = items[index]
  const inRetry = index >= base.length
  const isLast = index === items.length - 1

  useEffect(() => {
    if (!audio) return undefined
    const timer = window.setTimeout(() => speak(`${item.word}. ${item.sentence}`, { voiceUri }), 350)
    return () => {
      window.clearTimeout(timer)
      stopSpeaking()
    }
  }, [item, audio, voiceUri])

  function answer(isCorrect, choice) {
    if (feedback) return
    const { progress: next, xpEarned } = awardAnswer(progress, item.word, isCorrect, {
      mode: item.mode,
      practice: Boolean(item.retry),
    })
    onProgress(next)

    // Queue a missed word for one second look later in the trail. Once only —
    // a word the child is stuck on should not trap them in a loop.
    const queued = !isCorrect && !item.retry && !missed.current.has(item.word)
    if (queued) {
      missed.current.add(item.word)
      setRetries((current) => [...current, makeRetry(item, { audio })])
    }

    setFeedback({ isCorrect, choice, xp: xpEarned, queued })
    if (isCorrect && audio) speak('Nice work!', { rate: 0.9, voiceUri })
  }

  function next() {
    if (isLast) {
      onComplete({
        score: base.length,
        practiced: retries.length,
        earnedXp: progress.xp - xpBefore.current,
        source: source.label,
      })
      return
    }
    setIndex((current) => current + 1)
    setFeedback(null)
  }

  const mode = MODE_REGISTRY[item.mode]
  const Question = mode.component
  const step = inRetry ? index - base.length + 1 : index + 1
  const total = inRetry ? retries.length : base.length
  const filled = (step - 1 + (feedback ? 1 : 0)) / total
  return (
    <main className="game-shell">
      <div className="game-topline">
        <button className="back-button" type="button" onClick={onExit}>← <span>Trail map</span></button>
        <div className="question-progress">
          <div className={inRetry ? 'practice' : ''}><i style={{ width: `${filled * 100}%` }} /></div>
          <span>{inRetry ? `Second look ${step} of ${total}` : `${step} of ${total}`}</span>
        </div>
        <div className="game-streak">🔥 {progress.streak}</div>
      </div>
      <section className="question-card">
        {inRetry ? (
          <p className="retry-banner">
            <span aria-hidden="true">🔁</span>
            One more look at the words you missed. No pressure — this one does not change your score.
          </p>
        ) : null}
        <div className="question-heading">
          <span className="mode-icon" aria-hidden="true">{mode.icon}</span>
          <div><span className="soft-label">{mode.eyebrow}</span><h1>{mode.title}</h1></div>
        </div>
        <ListenButton word={item.word} sentence={item.sentence} audio={audio} voiceUri={voiceUri} />
        <p className="sentence"><span>“</span>{blankSentence(item.sentence, item.word)}<span>”</span></p>
        <div className="question-area">
          <Question key={index} item={item} onAnswer={answer} feedback={feedback} />
        </div>
        {feedback ? (
          <div className={`feedback ${feedback.isCorrect ? 'correct' : 'try-again'}`} role="status">
            <span className="feedback-icon">{feedback.isCorrect ? '✓' : '↗'}</span>
            <div>
              <b>{feedback.isCorrect ? 'You found it!' : 'Good try — now you know it.'}</b>
              <p className="answer-line">
                <span>The word is</span>
                <strong>{item.word}</strong>
                {audio ? <button type="button" onClick={() => speak(item.word, { voiceUri })}>Hear it again</button> : null}
              </p>
              {feedback.queued ? <small className="queued-note">We will come back to this one before the trail ends.</small> : null}
            </div>
            {feedback.xp ? <div className="xp-pop">+{feedback.xp} XP</div> : null}
            <button className="next-button" type="button" onClick={next}>{isLast ? 'Finish trail' : 'Next word'} →</button>
          </div>
        ) : null}
      </section>
      <p className="game-note">No timer here. Take your time{audio ? ' and listen again whenever you want' : ''}.</p>
    </main>
  )
}

function Complete({ summary, progress, newBadges, onHome, onReplay }) {
  return (
    <main className="complete-shell">
      <section className="complete-card">
        <div className="celebration" aria-hidden="true"><span>✦</span><span>✧</span><div>🏕️</div><span>✧</span><span>✦</span></div>
        <span className="soft-label">TRAIL COMPLETE</span>
        <h1>You made it to camp!</h1>
        <p>
          {summary.score} words explored on {summary.source}
          {summary.practiced ? `, plus ${summary.practiced} second look${summary.practiced === 1 ? '' : 's'}` : ''}
          , and every try made your spelling trail stronger.
        </p>
        <div className="complete-stats">
          <div><span>⚡</span><b>+{summary.earnedXp + SESSION_BONUS}</b><small>XP earned</small></div>
          <div><span>✨</span><b>{progress.fireflies}</b><small>fireflies total</small></div>
          <div><span>🔥</span><b>{progress.bestStreak}</b><small>best streak</small></div>
        </div>
        {newBadges.length ? (
          <div className="new-badge">
            <span>{newBadges[0].icon}</span>
            <div><small>NEW BADGE</small><b>{newBadges[0].label}</b><p>{newBadges[0].detail}</p></div>
          </div>
        ) : null}
        <div className="complete-actions">
          <button className="primary-button" type="button" onClick={onHome}><span>Back to trail map</span><i>→</i></button>
          <button className="quiet-button" type="button" onClick={onReplay}>Practice this level again</button>
        </div>
      </section>
    </main>
  )
}

function Rewards({ profile, onBack, onBuy, onEquip }) {
  const { progress } = profile
  const saving = nextCompanion(profile)
  return (
    <main className="rewards-shell">
      <button className="back-button" type="button" onClick={onBack}>← Trail map</button>
      <div className="rewards-heading"><span className="soft-label">FIELD GUIDE</span><h1>Your discoveries</h1><p>Badges celebrate steady practice—not perfect scores.</p></div>
      <div className="badge-grid">
        {BADGES.map((badge) => {
          const unlocked = progress.badges.includes(badge.id)
          return (
            <article className={`badge-card ${unlocked ? '' : 'locked'}`} key={badge.id}>
              <div className="big-badge">{unlocked ? badge.icon : '◇'}</div>
              <span>{unlocked ? 'DISCOVERED' : 'STILL HIDING'}</span>
              <h2>{badge.label}</h2>
              <p>{badge.detail}</p>
            </article>
          )
        })}
      </div>
      <section className="firefly-bank">
        <div>
          <span className="soft-label light">FIREFLY JAR</span>
          <h2>{progress.fireflies} fireflies to spend</h2>
          <p>
            Each correct answer adds light to your jar, and a three-answer streak earns an extra
            firefly. Spend them on trail companions below.
            {saving && saving.cost > progress.fireflies
              ? <> Your next companion, <b>{saving.name}</b>, needs {saving.cost - progress.fireflies} more.</>
              : null}
          </p>
        </div>
        <div className="jar" aria-label={`${progress.fireflies} fireflies`}><i>✦</i><i>✦</i><i>✦</i><i>✦</i><i>✦</i></div>
      </section>

      <section className="shop" aria-labelledby="companions">
        <div className="section-heading">
          <div><span className="soft-label">FIREFLY JAR</span><h2 id="companions">Trail companions</h2></div>
          <p>Companions walk the trail with you. They are just for fun — every word stays open to everyone.</p>
        </div>
        <div className="companion-grid">
          {COMPANIONS.map((item) => {
            const owned = ownsCompanion(profile, item.id)
            const equipped = profile.avatar === item.id
            const affordable = progress.fireflies >= item.cost
            const state = equipped ? 'equipped' : owned ? 'owned' : affordable ? 'affordable' : 'locked'
            return (
              <button
                className={`companion-card ${state}`}
                type="button"
                key={item.id}
                disabled={equipped || (!owned && !affordable)}
                onClick={() => (owned ? onEquip(item.id) : onBuy(item.id))}
              >
                <span className="companion-face" aria-hidden="true">{item.emoji}</span>
                <strong>{item.name}</strong>
                <small>{item.note}</small>
                <span className="companion-state">
                  {equipped ? '✓ With you now'
                    : owned ? 'Take this one'
                    : affordable ? `Free the ${item.name.toLowerCase()} · ${item.cost} ✨`
                    : `${item.cost} ✨ · ${item.cost - progress.fireflies} to go`}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </main>
  )
}

function ConfirmButton({ className = 'quiet-button', label, confirmLabel, onConfirm }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const timer = window.setTimeout(() => setArmed(false), 5000)
    return () => window.clearTimeout(timer)
  }, [armed])
  if (!armed) return <button className={className} type="button" onClick={() => setArmed(true)}>{label}</button>
  return (
    <button className={`${className} danger`} type="button" onClick={() => { setArmed(false); onConfirm() }}>
      {confirmLabel}
    </button>
  )
}

function SessionLength({ profile, onRoundLength }) {
  const current = profile.roundLength || ROUND_LENGTH
  return (
    <section className="family-card">
      <h2>Words per session</h2>
      <p className="field-help">
        Shorter trails are easier to finish on a busy night. A missed word still comes back for a
        second look, so a trail can run slightly longer than the number you pick.
      </p>
      <div className="length-row" role="group" aria-label="Words per session">
        {ROUND_LENGTH_OPTIONS.map((option) => (
          <button
            className={`length-choice ${current === option ? 'selected' : ''}`}
            type="button"
            key={option}
            aria-pressed={current === option}
            onClick={() => onRoundLength(option)}
          >
            <b>{option}</b>
            <small>{option <= 3 ? 'quick' : option <= 5 ? 'short' : option <= 8 ? 'normal' : option <= 12 ? 'long' : 'marathon'}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

function VoicePicker({ store, audio, onVoice }) {
  const voices = useMemo(() => (audio ? listVoices() : []), [audio])
  const chosen = store.settings?.voiceUri || bestVoiceUri()
  if (!audio || !voices.length) {
    return (
      <section className="family-card">
        <h2>Reading voice</h2>
        <p className="field-help">This browser has no speech voices installed, so trails show written clues instead.</p>
      </section>
    )
  }
  return (
    <section className="family-card">
      <h2>Reading voice</h2>
      <p className="field-help">
        Browsers ship several voices and the one they pick by default is usually the most robotic.
        Spell Trail picks the best it can find — change it here if another sounds clearer.
      </p>
      <div className="voice-row">
        <select
          aria-label="Reading voice"
          value={chosen || ''}
          onChange={(event) => onVoice(event.target.value)}
        >
          {voices.map((voice) => (
            <option value={voice.uri} key={voice.uri}>{voice.name} ({voice.lang})</option>
          ))}
        </select>
        <button
          className="check-button"
          type="button"
          onClick={() => speak('The word is necessary. Water is necessary on a long hike.', { voiceUri: chosen })}
        >
          Hear it
        </button>
      </div>
    </section>
  )
}

function BackupPanel({ store, onRestore }) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const savedCode = store.backupCode || null

  async function run(action) {
    setBusy(true)
    setStatus(null)
    try {
      await action()
    } catch (error) {
      setStatus({ tone: 'bad', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="family-card">
      <h2>Back up progress</h2>
      <p className="field-help">
        There is no account and no password. Backing up gives you a code — keep it somewhere safe,
        and enter it on another device to bring everything across. Anyone with the code can read
        that backup, so treat it like a key.
      </p>

      <div className="backup-actions">
        <button
          className="check-button"
          type="button"
          disabled={busy}
          onClick={() => run(async () => {
            const result = await saveBackup(store, savedCode)
            onRestore({ backupCode: result.code })
            setStatus({ tone: 'good', text: savedCode ? 'Backup updated.' : 'Backup created.' })
          })}
        >
          {busy ? 'Working…' : savedCode ? 'Update my backup' : 'Back up now'}
        </button>
        {savedCode ? <code className="backup-code">{savedCode}</code> : null}
      </div>

      <form
        className="restore-row"
        onSubmit={(event) => {
          event.preventDefault()
          run(async () => {
            const restored = await loadBackup(code)
            onRestore({ profiles: restored.profiles, activeId: restored.activeId, backupCode: restored.code })
            setCode('')
            setStatus({ tone: 'good', text: `Restored ${restored.profiles.length} player${restored.profiles.length === 1 ? '' : 's'}.` })
          })
        }}
      >
        <label htmlFor="restore-code">Restore from a code</label>
        <input
          id="restore-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="otter-summit-ridge-4821"
          autoComplete="off"
          spellCheck="false"
        />
        <button className="quiet-button" type="submit" disabled={busy || !code.trim()}>Restore</button>
      </form>
      <p className="field-help">Restoring replaces everything on this device with the backup.</p>

      {status ? <p className={`backup-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  )
}

function SupportCard() {
  return (
    <a className="support-card" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
      <span className="support-heart" aria-hidden="true">♥</span>
      <span>
        <b>Support the developer</b>
        <small>Spell Trail is free, has no ads, and never sells your data. If it helps your family, you can chip in.</small>
      </span>
      <i aria-hidden="true">→</i>
    </a>
  )
}

// A saved pack is turned back into the text the grown-up typed, so editing is
// the same form as creating rather than a second, different editor.
function packToText(pack) {
  return pack.words
    .map((entry) => (entry.sentence.startsWith('Can you spell the word ') ? entry.word : `${entry.word}: ${entry.sentence}`))
    .join('\n')
}

function PackForm({ onAdd, editing, onSave, onCancel }) {
  const [name, setName] = useState(editing ? editing.name : '')
  const [text, setText] = useState(editing ? packToText(editing) : '')
  const entries = useMemo(() => parseEntries(text), [text])
  const words = useMemo(() => buildPackWords(entries), [entries])
  const skipped = entries.length - words.length

  function submit(event) {
    event.preventDefault()
    if (!words.length) return
    if (editing) {
      onSave(editing.id, name, words)
      return
    }
    onAdd(name, words)
    setName('')
    setText('')
  }

  return (
    <form className="pack-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="pack-name">List name</label>
        <input id="pack-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Week of March 3" maxLength={40} />
      </div>
      <div className="field">
        <label htmlFor="pack-words">Spelling words</label>
        <textarea
          id="pack-words"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'rocket\nplanet\ncomet\n\nOr add your own sentence:\nrocket: The rocket lifted off at dawn.'}
        />
        <p className="field-help">
          One word per line, or separated by commas. Add <code>word: sentence</code> to use your own sentence —
          otherwise Spell Trail writes one. Up to {MAX_PACK_WORDS} words.
        </p>
      </div>
      <div className="pack-preview" aria-live="polite">
        {words.length ? (
          <>
            <b>{words.length} word{words.length === 1 ? '' : 's'} ready</b>
            <span>{words.map((entry) => entry.chunks.join('·')).join('   ')}</span>
            {skipped > 0 ? <small>{skipped} skipped as blank or duplicate.</small> : null}
          </>
        ) : (
          <span>Type some words to see how they will be broken into pieces.</span>
        )}
      </div>
      <div className="pack-form-actions">
        <button className="check-button" type="submit" disabled={!words.length}>
          {editing ? 'Save changes' : 'Save this list'}
        </button>
        {editing ? <button className="tiny-button" type="button" onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  )
}

function ProfileEditor({ profile, onRename, onPickAvatar, onDone }) {
  const [name, setName] = useState(profile.name)
  const owned = ownedCompanions(profile)
  const locked = COMPANIONS.length - owned.length
  return (
    <div className="profile-editor">
      <form
        className="rename-row"
        onSubmit={(event) => { event.preventDefault(); onRename(name); onDone() }}
      >
        <label htmlFor={`rename-${profile.id}`}>Name</label>
        <input
          id={`rename-${profile.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoFocus
        />
        <button className="check-button" type="submit" disabled={!cleanName(name) || cleanName(name) === profile.name}>Save</button>
      </form>
      <fieldset className="avatar-picker">
        <legend>Companion</legend>
        <div className="avatar-row">
          {owned.map((item) => (
            <button
              className={`avatar-choice ${profile.avatar === item.id ? 'selected' : ''}`}
              type="button"
              key={item.id}
              title={item.name}
              aria-label={item.name}
              aria-pressed={profile.avatar === item.id}
              onClick={() => onPickAvatar(item.id)}
            >
              {item.emoji}
            </button>
          ))}
        </div>
        {locked ? <p className="field-help">{locked} more to unlock with fireflies in the field guide.</p> : null}
      </fieldset>
      <button className="tiny-button" type="button" onClick={onDone}>Done</button>
    </div>
  )
}

function Family({
  store, profile, audio, onBack, onSwitch, onAddProfile, onRemoveProfile, onRename, onPickAvatar,
  onAddPack, onRemovePack, onSavePack, onResetProfile, onRoundLength, onVoice, onRestoreStore,
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingPack, setEditingPack] = useState(null)
  const onEdit = (id) => setEditingId((current) => (current === id ? null : id))
  return (
    <main className="rewards-shell family-shell">
      <button className="back-button" type="button" onClick={onBack}>← Trail map</button>
      <div className="rewards-heading">
        <span className="soft-label">GROWN-UPS</span>
        <h1>Players & word lists</h1>
        <p>Everything stays on this device. No account, no sign-in.</p>
      </div>

      <section className="family-card">
        <h2>Who is playing?</h2>
        <div className="profile-grid">
          {store.profiles.map((entry) => (
            <div className={`profile-card ${entry.id === profile.id ? 'selected' : ''}`} style={{ '--tier-color': entry.color }} key={entry.id}>
              <button className="profile-pick" type="button" onClick={() => onSwitch(entry.id)} aria-pressed={entry.id === profile.id}>
                <span className="profile-avatar" aria-hidden="true">{companionEmoji(entry.avatar)}</span>
                <strong>{entry.name}</strong>
                <small>Level {levelFromXp(entry.progress.xp)} · {entry.progress.wordsPracticed} words</small>
                <span className="tier-state">{entry.id === profile.id ? '✓ Playing now' : 'Switch to this player'}</span>
              </button>
              <div className="profile-actions">
                <button className="tiny-button" type="button" onClick={() => onEdit(entry.id)}>Edit</button>
                {store.profiles.length > 1 ? (
                  <ConfirmButton className="tiny-button" label="Remove" confirmLabel="Tap again to remove" onConfirm={() => onRemoveProfile(entry.id)} />
                ) : null}
              </div>
              {editingId === entry.id ? (
                <ProfileEditor
                  profile={entry}
                  onRename={(name) => onRename(entry.id, name)}
                  onPickAvatar={(id) => onPickAvatar(entry.id, id)}
                  onDone={() => onEdit(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
        {store.profiles.length < MAX_PROFILES ? (
          <form
            className="add-profile"
            onSubmit={(event) => { event.preventDefault(); onAddProfile(newName); setNewName('') }}
          >
            <label htmlFor="new-player">Add a player</label>
            <input id="new-player" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Name" maxLength={MAX_NAME_LENGTH} />
            <button className="check-button" type="submit" disabled={!cleanName(newName)}>Add</button>
          </form>
        ) : <p className="field-help">That is the maximum of {MAX_PROFILES} players.</p>}
      </section>

      <section className="family-card">
        <h2>{profile.name}'s spelling lists</h2>
        <p className="field-help">Type in the words from school. They become full trails with listening, building, and typing.</p>
        {profile.packs.length ? (
          <ul className="pack-list">
            {profile.packs.map((pack) => (
              <li key={pack.id}>
                <div>
                  <b>{pack.name}</b>
                  <small>{pack.words.map((entry) => entry.word).join(', ')}</small>
                </div>
                <button className="tiny-button" type="button" onClick={() => setEditingPack(editingPack === pack.id ? null : pack.id)}>
                  {editingPack === pack.id ? 'Close' : 'Edit'}
                </button>
                <ConfirmButton className="tiny-button" label="Delete" confirmLabel="Tap again to delete" onConfirm={() => onRemovePack(pack.id)} />
              </li>
            ))}
          </ul>
        ) : <p className="empty-note">No lists yet.</p>}
        <PackForm
          key={editingPack || 'new'}
          editing={profile.packs.find((pack) => pack.id === editingPack) || null}
          onAdd={onAddPack}
          onSave={(id, name, words) => { onSavePack(id, name, words); setEditingPack(null) }}
          onCancel={() => setEditingPack(null)}
        />
      </section>

      <SessionLength profile={profile} onRoundLength={onRoundLength} />
      <VoicePicker store={store} audio={audio} onVoice={onVoice} />
      <BackupPanel store={store} onRestore={onRestoreStore} />
      <SupportCard />

      <section className="family-card danger-card">
        <h2>Reset {profile.name}'s progress</h2>
        <p className="field-help">Clears XP, badges, and streaks for this player only. Word lists are kept.</p>
        <ConfirmButton label="Reset progress" confirmLabel="Tap again to erase this player's progress" onConfirm={onResetProfile} />
      </section>
    </main>
  )
}

export default function App() {
  const [store, setStore] = useState(() => loadStore())
  const [selection, setSelection] = useState({ kind: 'tier', id: DEFAULT_TIER_ID })
  const [view, setView] = useState('home')
  const [summary, setSummary] = useState(null)
  const [newBadges, setNewBadges] = useState([])
  const [saveFailed, setSaveFailed] = useState(false)
  const audio = useAudioAvailable()

  const profile = activeProfile(store)
  const source = useMemo(() => resolveSource(selection, profile), [selection, profile])

  useEffect(() => { setSaveFailed(!saveStore(store)) }, [store])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [view])
  useEffect(() => stopSpeaking, [])

  function setProgress(progress) {
    setStore((current) => updateProfile(current, current.activeId, (entry) => ({ ...entry, progress })))
  }

  function completeRound(roundSummary) {
    const before = new Set(profile.progress.badges)
    const finished = finishSession(profile.progress)
    setProgress(finished)
    setNewBadges(BADGES.filter((badge) => finished.badges.includes(badge.id) && !before.has(badge.id)))
    setSummary(roundSummary)
    setView('complete')
  }

  function leaveGame(nextView) {
    stopSpeaking()
    setView(nextView)
  }

  function switchProfile(id) {
    stopSpeaking()
    setStore((current) => ({ ...current, activeId: id }))
    setSelection({ kind: 'tier', id: DEFAULT_TIER_ID })
    setView('home')
  }

  return (
    <div className="app">
      <Header
        profile={profile}
        view={view}
        onHome={() => leaveGame('home')}
        onSwitch={() => leaveGame('family')}
      />
      {view === 'home' ? (
        <Home
          profile={profile}
          selection={selection}
          source={source}
          onSelect={setSelection}
          onStart={() => setView('game')}
          onShowRewards={() => setView('rewards')}
          onShowFamily={() => setView('family')}
        />
      ) : null}
      {view === 'game' ? (
        <Game
          source={source}
          progress={profile.progress}
          roundLength={profile.roundLength || ROUND_LENGTH}
          onProgress={setProgress}
          onComplete={completeRound}
          onExit={() => leaveGame('home')}
          audio={audio}
          voiceUri={store.settings?.voiceUri || null}
        />
      ) : null}
      {view === 'complete' && summary ? (
        <Complete summary={summary} progress={profile.progress} newBadges={newBadges} onHome={() => setView('home')} onReplay={() => setView('game')} />
      ) : null}
      {view === 'rewards' ? (
        <Rewards
          profile={profile}
          onBack={() => setView('home')}
          onBuy={(id) => setStore((current) => updateProfile(current, current.activeId, (entry) => buyCompanion(entry, id).profile))}
          onEquip={(id) => setStore((current) => updateProfile(current, current.activeId, (entry) => equipCompanion(entry, id)))}
        />
      ) : null}
      {view === 'family' ? (
        <Family
          store={store}
          profile={profile}
          audio={audio}
          onBack={() => setView('home')}
          onSwitch={switchProfile}
          onAddProfile={(name) => setStore((current) => addProfile(current, name))}
          onRemoveProfile={(id) => setStore((current) => removeProfile(current, id))}
          onRename={(id, name) => setStore((current) => renameProfile(current, id, name))}
          onPickAvatar={(id, companion) => setStore((current) => updateProfile(current, id, (entry) => equipCompanion(entry, companion)))}
          onAddPack={(name, words) => setStore((current) => updateProfile(current, current.activeId, (entry) => ({ ...entry, packs: [...entry.packs, createPack(name, words)] })))}
          onRemovePack={(id) => {
            setStore((current) => updateProfile(current, current.activeId, (entry) => ({ ...entry, packs: entry.packs.filter((pack) => pack.id !== id) })))
            setSelection((current) => (current.kind === 'pack' && current.id === id ? { kind: 'tier', id: DEFAULT_TIER_ID } : current))
          }}
          onResetProfile={() => setStore((current) => updateProfile(current, current.activeId, (entry) => ({ ...entry, progress: newProgress() })))}
          onSavePack={(id, name, words) => setStore((current) => updatePack(current, current.activeId, id, { name: name.trim().slice(0, 40) || 'This week', words }))}
          onRoundLength={(length) => setStore((current) => setRoundLength(current, current.activeId, length))}
          onVoice={(uri) => setStore((current) => setVoice(current, uri))}
          onRestoreStore={(changes) => setStore((current) => ({ ...current, ...changes }))}
        />
      ) : null}
      <footer>
        <span>{saveFailed ? 'Progress cannot be saved in this browser window.' : 'Spell Trail saves progress on this device.'}</span>
        <button type="button" onClick={() => setView('family')}>Players & word lists</button>
        <a className="footer-heart" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">♥</span> Support the developer
        </a>
      </footer>
    </div>
  )
}
