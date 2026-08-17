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
  passedCount,
  REVIEW_RECALL_SHARE,
  reviewWords,
  settleLevelUps,
  UNKNOWN_ANSWER,
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
import { deleteBackup, loadBackup, saveBackup } from './backup.js'
import { MAX_PACK_WORDS, buildPackWords, parseEntries } from './wordgen.js'
import { DEFAULT_TIER_ID, WORD_TIERS } from './words.js'

// Chrome fires `voiceschanged` once, often before React has mounted and
// subscribed — so the event alone leaves the app believing it has no speech.
// Poll briefly as well, then give up and fall back to written clues.
// Change this one line to point the heart somewhere else.
export const SUPPORT_URL = 'https://buymeacoffee.com/wishfulcoder'

// The studio line every Wishful Coders app carries. Same words, same link,
// wherever it appears — the point is that it reads identically across apps.
export const STUDIO_URL = 'https://wishfulcoders.com'

// Forwards to the studio inbox through Cloudflare Email Routing, so the address
// a family sees is the app's own rather than someone's personal mailbox. See
// the README's Email section — changing this needs a matching routing rule.
export const SUPPORT_EMAIL = 'support@spelltrail.app'

const VOICE_POLL_MS = 250
const VOICE_GIVE_UP_MS = 4000

const VIEW_HASHES = { home: '', family: '#grown-ups', rewards: '#rewards', privacy: '#privacy', game: '#trail', complete: '#complete' }

function viewFromLocation() {
  const match = Object.entries(VIEW_HASHES).find(([view, hash]) => ['family', 'rewards', 'privacy'].includes(view) && hash === window.location.hash)
  return match?.[0] || 'home'
}

function urlForView(view) {
  return window.location.pathname + window.location.search + (VIEW_HASHES[view] || '')
}

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

// Review camp is not a word list of its own — it is whichever words this
// player has missed, gathered from everywhere they could have met one.
export const REVIEW_COLOR = '#b4713c'

const ALL_TIER_WORDS = WORD_TIERS.flatMap((tier) => tier.words)

// A pack word that repeats a tier word keeps the tier's richer entry, so review
// camp asks it in every mode rather than only the ones a typed-in word supports.
function knownWords(profile) {
  const seen = new Map()
  for (const entry of [...ALL_TIER_WORDS, ...profile.packs.flatMap((pack) => pack.words)]) {
    if (!seen.has(entry.word)) seen.set(entry.word, entry)
  }
  return [...seen.values()]
}

// A trail can be drawn from a built-in tier, from a pack the grown-up typed in,
// or from review camp. Everything downstream only needs { label, color, words }.
function resolveSource(selection, profile, review) {
  // `priority` says the list is already ordered by need, so a round takes the
  // words at the front instead of sampling the whole pool at random.
  if (selection?.kind === 'review' && review.length) {
    return {
      kind: 'review', id: 'review', label: 'Review Camp', color: REVIEW_COLOR, icon: '🏕️',
      words: review, priority: true, recallShare: REVIEW_RECALL_SHARE,
    }
  }
  if (selection?.kind === 'pack') {
    const pack = profile.packs.find((entry) => entry.id === selection.id)
    if (pack) return { kind: 'pack', id: pack.id, label: pack.name, color: profile.color, icon: '📝', words: pack.words }
  }
  const tier = WORD_TIERS.find((entry) => entry.id === selection?.id)
    || WORD_TIERS.find((entry) => entry.id === DEFAULT_TIER_ID)
  return { kind: 'tier', id: tier.id, label: tier.label, color: tier.color, icon: tier.icon, words: tier.words }
}

function Header({ profile, onHome, onSwitch }) {
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
    </header>
  )
}

// A track is a tier or a word pack. Tapping one selects it; the selected one
// opens up to show the start button, so choosing and starting are the same
// gesture in the same place rather than a trip back to the top of the page.
// `note` replaces the passed-off bar for a track where that count means nothing
// — review camp shrinks as words are learned rather than filling up.
function TrackCard({ track, selected, passed, roundLength, note, onSelect, onStart, children }) {
  const total = track.words.length
  const pct = total ? Math.round((passed / total) * 100) : 0
  return (
    <div className={`tier-card ${track.kind === 'pack' ? 'pack-card' : ''} ${selected ? 'selected' : ''}`} style={{ '--tier-color': track.color }}>
      <button className="tier-pick" type="button" onClick={onSelect} aria-pressed={selected} aria-expanded={selected}>
        <span className="tier-icon" aria-hidden="true">{track.icon}</span>
        {children}
        <span className="track-progress">
          {note ? null : <span className="track-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>}
          <small>{note || `${passed}/${total} words passed off`}</small>
        </span>
        {selected ? null : <span className="tier-state">Choose this trail</span>}
      </button>
      {selected ? (
        <button className="track-start" type="button" onClick={onStart}>
          <span>Start trail</span>
          <b>{roundLength} words · no timer</b>
          <i aria-hidden="true">→</i>
        </button>
      ) : null}
    </div>
  )
}

function Home({ profile, selection, source, review, onSelect, onStart, onShowRewards, onShowFamily }) {
  const { progress } = profile
  const level = levelFromXp(progress.xp)
  const accuracy = progress.wordsPracticed ? Math.round((progress.correctAnswers / progress.wordsPracticed) * 100) : 0
  const roundLength = Math.min(profile.roundLength || ROUND_LENGTH, source.words.length)
  return (
    <main id="main-content" tabIndex="-1" className="home-shell">
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="soft-label">{profile.name.toUpperCase()}'S ADVENTURE</span>
          <h1>Ready for a quick<br /><em>word quest?</em></h1>
          <p>Pick a trail below and tap start. {roundLength} small challenges, no timer, and you can hear every word as many times as you need.</p>
          <a className="primary-button" href="#choose-level">
            <span>Choose your trail</span>
            <b>{WORD_TIERS.length} levels{profile.packs.length ? ` · ${profile.packs.length} list${profile.packs.length === 1 ? '' : 's'} from your grown-up` : ''}</b>
            <i aria-hidden="true">↓</i>
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <img src="/trail-scene.svg" alt="" />
        </div>
      </section>

      {review.length ? (
        <section className="tier-section" aria-labelledby="review-camp">
          <div className="section-heading">
            <div><span className="soft-label">SECOND CHANCES</span><h2 id="review-camp">Review camp</h2></div>
            <p>The words you missed, waiting in one place.</p>
          </div>
          <div className="tier-grid">
            <TrackCard
              track={{ kind: 'review', label: 'Review Camp', color: REVIEW_COLOR, icon: '🏕️', words: review }}
              selected={selection.kind === 'review'}
              roundLength={Math.min(profile.roundLength || ROUND_LENGTH, review.length)}
              note="Spell one from memory twice and it leaves camp"
              onSelect={() => onSelect({ kind: 'review' })}
              onStart={onStart}
            >
              <strong>Review camp</strong>
              <b>{review.length} word{review.length === 1 ? '' : 's'} waiting</b>
              <small>{review.slice(0, 4).map((entry) => entry.word).join(', ')}{review.length > 4 ? '…' : ''}</small>
            </TrackCard>
          </div>
        </section>
      ) : null}

      {profile.packs.length ? (
        <section className="tier-section" aria-labelledby="this-week">
          <div className="section-heading">
            <div><span className="soft-label">FROM YOUR GROWN-UP</span><h2 id="this-week">This week's words</h2></div>
            <p>Spelling lists typed in for you.</p>
          </div>
          <div className="tier-grid">
            {profile.packs.map((pack) => (
              <TrackCard
                key={pack.id}
                track={{ kind: 'pack', label: pack.name, color: profile.color, icon: '📝', words: pack.words }}
                selected={selection.kind === 'pack' && selection.id === pack.id}
                passed={passedCount(progress, pack.words)}
                roundLength={Math.min(profile.roundLength || ROUND_LENGTH, pack.words.length)}
                onSelect={() => onSelect({ kind: 'pack', id: pack.id })}
                onStart={onStart}
              >
                <strong>{pack.name}</strong>
                <small>{pack.words.slice(0, 4).map((entry) => entry.word).join(', ')}{pack.words.length > 4 ? '…' : ''}</small>
              </TrackCard>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tier-section" aria-labelledby="choose-level">
        <div className="section-heading">
          <div><span className="soft-label">CHOOSE YOUR PATH</span><h2 id="choose-level">Pick a practice level</h2></div>
          <p>Start where words feel doable. You can switch anytime.</p>
        </div>
        <div className="tier-grid">
          {WORD_TIERS.map((tier) => (
            <TrackCard
              key={tier.id}
              track={tier}
              selected={selection.kind === 'tier' && selection.id === tier.id}
              passed={passedCount(progress, tier.words)}
              roundLength={Math.min(profile.roundLength || ROUND_LENGTH, tier.words.length)}
              onSelect={() => onSelect({ kind: 'tier', id: tier.id })}
              onStart={onStart}
            >
              <strong>{tier.label}</strong><b>{tier.grades}</b><small>{tier.description}</small>
            </TrackCard>
          ))}
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
      <span><b>Hear the word</b><small>Tap as often as you need</small></span>
    </button>
  )
}

function Game({ source, progress, roundLength, onProgress, onComplete, onExit, onLevelUp, onStarted, audio, voiceUri }) {
  // A review trail takes the words at the front of its list — the ones that
  // need it most — instead of sampling every word the player has ever missed.
  const [base] = useState(() => buildRound({
    words: source.priority ? source.words.slice(0, roundLength) : source.words,
    length: roundLength,
    audio,
    recallShare: source.recallShare,
  }))
  // Review camp empties as its words are learned, which can change the source
  // under a round in progress — so the trail keeps the name it started with.
  const [label] = useState(source.label)
  const [sourceKind] = useState(source.kind)
  const [retries, setRetries] = useState([])
  const [index, setIndex] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const xpBefore = useRef(progress.xp)
  const missed = useRef(new Set())
  const nextRef = useRef(null)

  const items = useMemo(() => [...base, ...retries], [base, retries])
  const item = items[index]
  const inRetry = index >= base.length
  const isLast = index === items.length - 1

  useEffect(() => {
    if (feedback) nextRef.current?.focus()
  }, [feedback])

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
    onStarted()
    const { progress: awarded, xpEarned } = awardAnswer(progress, item.word, isCorrect, {
      mode: item.mode,
      practice: Boolean(item.retry),
    })
    const { progress: next, levelUps } = settleLevelUps(progress.xp, awarded)
    onProgress(next)
    if (levelUps.length) onLevelUp(levelUps)

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
        source: label,
        sourceKind,
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
    <main id="main-content" tabIndex="-1" className="game-shell">
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
            One more look at a word you missed — this one does not change your score.
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
        {feedback ? null : (
          <button className="unsure-button" type="button" onClick={() => answer(false, UNKNOWN_ANSWER)}>
            I don&apos;t know this one — show me
          </button>
        )}
        {feedback ? (
          <div className={`feedback ${feedback.isCorrect ? 'correct' : 'try-again'}`} role="status">
            <span className="feedback-icon">{feedback.isCorrect ? '✓' : '↗'}</span>
            <div>
              <b>
                {feedback.isCorrect ? 'You found it!'
                  : feedback.choice === UNKNOWN_ANSWER ? 'Good asking — here it is.'
                  : 'Good try — now you know it.'}
              </b>
              <p className="answer-line">
                <span>The word is</span>
                <strong>{item.word}</strong>
                {audio ? <button type="button" onClick={() => speak(item.word, { voiceUri })}>Hear it again</button> : null}
              </p>
              {feedback.queued ? <small className="queued-note">We will come back to this one before the trail ends.</small> : null}
            </div>
            {feedback.xp ? <div className="xp-pop">+{feedback.xp} XP</div> : null}
            <button className="next-button" type="button" ref={nextRef} onClick={next}>{isLast ? 'Finish trail' : 'Next word'} →</button>
          </div>
        ) : null}
      </section>
    </main>
  )
}

function Complete({ summary, progress, newBadges, canReplay, onHome, onReplay }) {
  return (
    <main id="main-content" tabIndex="-1" className="complete-shell">
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
          {canReplay ? <button className="quiet-button" type="button" onClick={onReplay}>Practice this trail again</button> : null}
        </div>
      </section>
    </main>
  )
}

function Rewards({ profile, onBack, onBuy, onEquip }) {
  const { progress } = profile
  const saving = nextCompanion(profile)
  return (
    <main id="main-content" tabIndex="-1" className="rewards-shell">
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
          name="reading-voice"
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

function BackupPanel({ store, onRestore, onShowPrivacy }) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pendingRestore, setPendingRestore] = useState(null)
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
        that backup, so treat it like a key.{' '}
        <button className="inline-link" type="button" onClick={onShowPrivacy}>What is stored?</button>
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
        {savedCode ? (
          <ConfirmButton
            className="tiny-button"
            label="Delete backup"
            confirmLabel="Tap again to delete it"
            onConfirm={() => run(async () => {
              await deleteBackup(savedCode)
              onRestore({ backupCode: null })
              setStatus({ tone: 'good', text: 'Backup deleted. Nothing of yours is stored online now.' })
            })}
          />
        ) : null}
      </div>

      <form
        className="restore-row"
        onSubmit={(event) => {
          event.preventDefault()
          setPendingRestore(null)
          run(async () => {
            const restored = await loadBackup(code)
            setPendingRestore(restored)
            setStatus(null)
          })
        }}
      >
        <label htmlFor="restore-code">Restore from a code</label>
        <input
          id="restore-code"
          name="restore-code"
          value={code}
          onChange={(event) => { setCode(event.target.value); setPendingRestore(null) }}
          placeholder="otter-summit-ridge-4821…"
          autoComplete="off"
          spellCheck="false"
        />
        <button className="quiet-button" type="submit" disabled={busy || !code.trim()}>Restore</button>
      </form>
      <p className="field-help">Restoring replaces everything on this device with the backup.</p>

      {pendingRestore ? (
        <div className="restore-confirm" role="alert">
          <b>Replace this device's progress?</b>
          <p>This backup contains {pendingRestore.profiles.map((entry) => entry.name).join(', ')}. Your current players will be replaced.</p>
          <div className="restore-confirm-actions">
            <button
              className="quiet-button danger"
              type="button"
              onClick={() => {
                setCode('')
                setPendingRestore(null)
                setStatus({ tone: 'good', text: 'Backup restored.' })
                onRestore({ profiles: pendingRestore.profiles, activeId: pendingRestore.activeId, backupCode: pendingRestore.code }, true)
              }}
            >
              Replace progress
            </button>
            <button className="tiny-button" type="button" onClick={() => setPendingRestore(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {status ? <p className={`backup-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  )
}

function LevelUpModal({ levelUps, onClose }) {
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = closeRef.current?.closest('[role=dialog]')
    const previousOverflow = document.body.style.overflow
    const background = [...document.querySelectorAll('.app > :not(.modal-veil)')]
    background.forEach((element) => { element.inert = true })

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll('button, a, input, select, textarea')]
        .filter((element) => !element.disabled)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      background.forEach((element) => { element.inert = false })
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus()
      else document.querySelector('.next-button')?.focus()
    }
  }, [])
  if (!levelUps.length) return null
  const top = levelUps[levelUps.length - 1]
  const fireflies = levelUps.reduce((sum, entry) => sum + entry.fireflies, 0)
  return (
    <div className="modal-veil" role="dialog" aria-modal="true" aria-labelledby="levelup-title">
      <section className="levelup-card">
        <div className="levelup-burst" aria-hidden="true">
          <span>✦</span><span>✧</span>
          <div className="levelup-badge">{top.level}</div>
          <span>✧</span><span>✦</span>
        </div>
        <span className="soft-label">
          {levelUps.length > 1 ? `${levelUps.length} LEVELS AT ONCE` : 'LEVEL UP'}
        </span>
        <h2 id="levelup-title">Congratulations — you reached level {top.level}!</h2>
        <p>
          {levelUps.length > 1
            ? 'Two level-ups in one go. That is a lot of careful spelling.'
            : 'Your spelling trail just got longer. Keep going and the next one is a little further out.'}
        </p>
        <div className="levelup-reward">
          <span aria-hidden="true">✨</span>
          <div><b>+{fireflies} fireflies</b><small>Spend them on a trail companion</small></div>
        </div>
        <button className="primary-button" type="button" ref={closeRef} onClick={onClose}>
          <span>Keep going</span><i aria-hidden="true">→</i>
        </button>
      </section>
    </div>
  )
}

function Privacy({ onBack }) {
  return (
    <main id="main-content" tabIndex="-1" className="rewards-shell privacy-shell">
      <button className="back-button" type="button" onClick={onBack}>← Trail map</button>
      <div className="rewards-heading">
        <span className="soft-label">PRIVACY</span>
        <h1>What Spell Trail keeps</h1>
        <p>The short version: almost nothing, and nothing at all unless you ask for a backup.</p>
      </div>

      <section className="family-card prose">
        <h2>On your device</h2>
        <p>
          Player names, progress, badges, companions, and any spelling lists you type in are saved
          in this browser only. They are not sent anywhere. Clearing your browser data removes them.
        </p>
        <p>
          Use a first name or a nickname. Spell Trail never asks for a surname, a birthday, a school,
          an email address, or a password, and there is nowhere to enter one.
        </p>

        <h2>If you make a backup</h2>
        <p>
          Backing up is the only thing that sends data off your device, and only when you tap the
          button. It uploads your players — their names, progress, and word lists — and stores them
          against a random code on Cloudflare, which hosts this app.
        </p>
        <p>
          The code is the only key. There is no account attached to it, so we cannot tell you who a
          backup belongs to, and anyone who has your code can read it. Keep it like a house key.
          Delete a backup any time from <b>Players &amp; word lists</b>. Backups you never touch
          again are removed automatically after two years.
        </p>

        <h2>Reading words aloud</h2>
        <p>
          Spell Trail asks your browser to read words out. Some browsers do this on the device and
          some — including Chrome&apos;s higher quality voices — send the word to the browser maker to
          be turned into audio. That is the browser&apos;s doing, not ours, and it receives only the
          word and its example sentence. If you would rather keep everything local, pick a voice
          marked as an on-device or local voice in the voice list.
        </p>

        <h2>Counting visitors</h2>
        <p>
          Spell Trail uses Cloudflare Web Analytics to count how many people open the site and
          which pages they land on. It sets no cookies, does not follow you to other sites, and
          does not build a profile of you or your child. It loads one small script from
          Cloudflare, which is the only thing this site requests from anywhere else.
        </p>
        <p>
          What it records is the kind of thing a web server writes down anyway: a page address, a
          rough country, a browser type. It never sees a player name, a score, or a spelling list —
          those live on your device and are only ever sent if you make a backup.
        </p>

        <h2>What we do not do</h2>
        <ul>
          <li>No accounts, no sign-in, no passwords.</li>
          <li>No advertising, and nothing is ever sold or shared with advertisers.</li>
          <li>No cookies, and no tracking you across other websites.</li>
          <li>Fonts are served from this site, not from a font network.</li>
        </ul>

        <h2>Children</h2>
        <p>
          Spell Trail is built for children to use with a grown-up nearby. Because there are no
          accounts and we collect nothing that identifies a child, we hold no personal profile of
          your family. If you back up and later want it gone, delete it with your code — that
          removes everything we hold.
        </p>

        <h2>Questions</h2>
        <p>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. This page will
          be dated and updated if any of the above changes.
        </p>
        <p className="prose-note">Last updated 17 August 2026.</p>
      </section>
    </main>
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

function PackForm({ onAdd, editing, onSave, onCancel, onDirtyChange }) {
  const [name, setName] = useState(editing ? editing.name : '')
  const [text, setText] = useState(editing ? packToText(editing) : '')
  const initial = useRef({ name: editing ? editing.name : '', text: editing ? packToText(editing) : '' })
  const entries = useMemo(() => parseEntries(text), [text])
  const words = useMemo(() => buildPackWords(entries), [entries])
  const skipped = entries.length - words.length
  const dirty = name !== initial.current.name || text !== initial.current.text

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

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
        <input id="pack-name" name="pack-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Week of March 3…" maxLength={40} />
      </div>
      <div className="field">
        <label htmlFor="pack-words">Spelling words</label>
        <textarea
          id="pack-words"
          name="pack-words"
          autoComplete="off"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'rocket\nplanet\ncomet\n\nOr add your own sentence:\nrocket: The rocket lifted off at dawn.…'}
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
          name="player-name"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
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
  onAddPack, onRemovePack, onSavePack, onResetProfile, onRoundLength, onVoice, onRestoreStore, onShowPrivacy, onDraftChange,
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingPack, setEditingPack] = useState(null)
  const onEdit = (id) => setEditingId((current) => (current === id ? null : id))
  return (
    <main id="main-content" tabIndex="-1" className="rewards-shell family-shell">
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
            <input id="new-player" name="new-player" autoComplete="off" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Name…" maxLength={MAX_NAME_LENGTH} />
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
          onDirtyChange={onDraftChange}
        />
      </section>

      <SessionLength profile={profile} onRoundLength={onRoundLength} />
      <VoicePicker store={store} audio={audio} onVoice={onVoice} />
      <BackupPanel store={store} onRestore={onRestoreStore} onShowPrivacy={onShowPrivacy} />
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
  const [view, setView] = useState(() => viewFromLocation())
  const [summary, setSummary] = useState(null)
  const [newBadges, setNewBadges] = useState([])
  const [saveFailed, setSaveFailed] = useState(false)
  const [levelUps, setLevelUps] = useState([])
  const [gameStarted, setGameStarted] = useState(false)
  const [hasUnsavedPack, setHasUnsavedPack] = useState(false)
  const viewRef = useRef(view)
  const gameStartedRef = useRef(gameStarted)
  const unsavedPackRef = useRef(hasUnsavedPack)
  const audio = useAudioAvailable()

  const profile = activeProfile(store)
  const review = useMemo(() => reviewWords(profile.progress, knownWords(profile)), [profile])
  const source = useMemo(() => resolveSource(selection, profile, review), [selection, profile, review])
  viewRef.current = view
  gameStartedRef.current = gameStarted
  unsavedPackRef.current = hasUnsavedPack

  useEffect(() => { setSaveFailed(!saveStore(store)) }, [store])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [view])
  useEffect(() => stopSpeaking, [])
  useEffect(() => {
    window.history.replaceState({ spellTrailView: view }, '', urlForView(view))
    function onPopState(event) {
      const requested = event.state?.spellTrailView || viewFromLocation()
      const next = ['game', 'complete'].includes(requested) ? 'home' : requested
      if (next !== requested) window.history.replaceState({ spellTrailView: next }, '', urlForView(next))
      const leavingTrail = viewRef.current === 'game' && gameStartedRef.current && next !== 'complete'
      const losingDraft = viewRef.current === 'family' && unsavedPackRef.current && next !== 'family'
      if ((leavingTrail && !window.confirm('Leave this trail? Your completed answers are saved, but this trail will end.'))
        || (losingDraft && !window.confirm('Leave without saving this spelling list?'))) {
        window.history.pushState({ spellTrailView: viewRef.current }, '', urlForView(viewRef.current))
        return
      }
      stopSpeaking()
      setGameStarted(false)
      setView(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (!gameStarted && !hasUnsavedPack) return undefined
    function warnBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [gameStarted, hasUnsavedPack])

  function navigate(next, { force = false, replace = false } = {}) {
    if (next === view) return true
    if (!force && view === 'game' && gameStarted && next !== 'complete'
      && !window.confirm('Leave this trail? Your completed answers are saved, but this trail will end.')) return false
    if (!force && view === 'family' && hasUnsavedPack && next !== 'family'
      && !window.confirm('Leave without saving this spelling list?')) return false
    window.history[replace ? 'replaceState' : 'pushState']({ spellTrailView: next }, '', urlForView(next))
    setView(next)
    if (next !== 'game') setGameStarted(false)
    return true
  }

  function setProgress(progress) {
    setStore((current) => updateProfile(current, current.activeId, (entry) => ({ ...entry, progress })))
  }

  function completeRound(roundSummary) {
    const before = new Set(profile.progress.badges)
    const finished = finishSession(profile.progress)
    // The end-of-trail bonus can be the thing that tips a player over.
    const { progress: settled, levelUps } = settleLevelUps(profile.progress.xp, finished)
    setProgress(settled)
    setNewBadges(BADGES.filter((badge) => settled.badges.includes(badge.id) && !before.has(badge.id)))
    setSummary(roundSummary)
    navigate('complete', { force: true, replace: true })
    if (levelUps.length) setLevelUps(levelUps)
  }

  function leaveGame(nextView) {
    if (!navigate(nextView, { replace: view === 'game' })) return
    stopSpeaking()
  }

  function switchProfile(id) {
    if (!navigate('home')) return
    stopSpeaking()
    setStore((current) => ({ ...current, activeId: id }))
    setSelection({ kind: 'tier', id: DEFAULT_TIER_ID })
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header
        profile={profile}
        onHome={() => leaveGame('home')}
        onSwitch={() => leaveGame('family')}
      />
      {view === 'home' ? (
        <Home
          profile={profile}
          selection={selection}
          source={source}
          review={review}
          onSelect={setSelection}
          onStart={() => { setGameStarted(false); navigate('game', { force: true }) }}
          onShowRewards={() => navigate('rewards')}
          onShowFamily={() => navigate('family')}
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
          onLevelUp={setLevelUps}
          onStarted={() => setGameStarted(true)}
          audio={audio}
          voiceUri={store.settings?.voiceUri || null}
        />
      ) : null}
      {view === 'complete' && summary ? (
        <Complete summary={summary} progress={profile.progress} newBadges={newBadges} canReplay={summary.sourceKind !== 'review' || review.length > 0} onHome={() => navigate('home')} onReplay={() => { setGameStarted(false); navigate('game', { force: true }) }} />
      ) : null}
      {view === 'privacy' ? <Privacy onBack={() => navigate('home')} /> : null}
      {view === 'rewards' ? (
        <Rewards
          profile={profile}
          onBack={() => navigate('home')}
          onBuy={(id) => setStore((current) => updateProfile(current, current.activeId, (entry) => buyCompanion(entry, id).profile))}
          onEquip={(id) => setStore((current) => updateProfile(current, current.activeId, (entry) => equipCompanion(entry, id)))}
        />
      ) : null}
      {view === 'family' ? (
        <Family
          store={store}
          profile={profile}
          audio={audio}
          onBack={() => navigate('home')}
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
          onRestoreStore={(changes, returnHome = false) => {
            setStore((current) => ({ ...current, ...changes }))
            if (returnHome) {
              setHasUnsavedPack(false)
              navigate('home', { force: true, replace: true })
            }
          }}
          onShowPrivacy={() => navigate('privacy')}
          onDraftChange={setHasUnsavedPack}
        />
      ) : null}
      {levelUps.length ? <LevelUpModal levelUps={levelUps} onClose={() => setLevelUps([])} /> : null}
      {/* The trail screen has to fit a phone without scrolling, so the footer
          steps out of the way while a round is being played. */}
      {view === 'game' ? null : (
        <footer>
          <a className="studio-line" href={STUDIO_URL} target="_blank" rel="noopener noreferrer">
            A <b>Wishful Coders</b> app
          </a>
          <span>{saveFailed ? 'Progress cannot be saved in this browser window.' : 'Spell Trail saves progress on this device.'}</span>
          <button type="button" onClick={() => navigate('family')}>Players & word lists</button>
          <button type="button" onClick={() => navigate('privacy')}>Privacy</button>
          <a className="footer-heart" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">♥</span> Support the developer
          </a>
        </footer>
      )}
    </div>
  )
}
