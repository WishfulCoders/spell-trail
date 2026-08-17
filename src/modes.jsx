import { useEffect, useMemo, useRef, useState } from 'react'
import { blankFor, shuffle } from './game.js'

// Each question component takes the same props:
//   item      the round entry (word, sentence, chunks, distractors, blank, mode)
//   onAnswer  (isCorrect, choice) — `choice` is what the player actually picked
//   feedback  null while unanswered, else { isCorrect, choice }
function optionState(feedback, option, correctValue) {
  if (!feedback) return ''
  if (option === correctValue) return 'is-correct'
  if (option === feedback.choice) return 'is-wrong'
  return 'is-muted'
}

function Mark({ state }) {
  if (state !== 'is-correct' && state !== 'is-wrong') return null
  return <i className="option-mark" aria-hidden="true">{state === 'is-correct' ? '✓' : '✕'}</i>
}

export function ListenQuestion({ item, onAnswer, feedback }) {
  const options = useMemo(() => shuffle([item.word, ...item.distractors]), [item])
  return (
    <div className="answer-grid">
      {options.map((option) => {
        const state = optionState(feedback, option, item.word)
        return (
          <button
            className={`word-option ${state}`}
            type="button"
            key={option}
            disabled={Boolean(feedback)}
            onClick={() => onAnswer(option === item.word, option)}
          >
            {option}
            <Mark state={state} />
          </button>
        )
      })}
    </div>
  )
}

export function MissingQuestion({ item, onAnswer, feedback }) {
  const blank = useMemo(() => blankFor(item), [item])
  return (
    <>
      <div className="missing-word" aria-label={`Word with a missing part: ${item.chunks.map((chunk, index) => (index === blank.at ? 'blank' : chunk)).join(' ')}`}>
        {item.chunks.map((chunk, index) => (
          <span className={index === blank.at ? 'blank' : ''} key={`${chunk}-${index}`}>
            {index === blank.at ? (feedback ? blank.target : '?') : chunk}
          </span>
        ))}
      </div>
      <div className="small-answer-grid">
        {blank.options.map((option) => {
          const state = optionState(feedback, option, blank.target)
          return (
            <button
              className={`chunk-option ${state}`}
              type="button"
              key={option}
              disabled={Boolean(feedback)}
              onClick={() => onAnswer(option === blank.target, option)}
            >
              {option}
              <Mark state={state} />
            </button>
          )
        })}
      </div>
    </>
  )
}

export function ChunkQuestion({ item, onAnswer, feedback }) {
  const choices = useMemo(() => shuffle(item.chunks.map((text, index) => ({ text, index }))), [item])
  const [picked, setPicked] = useState([])
  const built = picked.map((index) => item.chunks[index]).join('')
  const disabled = Boolean(feedback)

  function pick(index) {
    if (!disabled && !picked.includes(index)) setPicked((current) => [...current, index])
  }

  function undo() {
    if (!disabled) setPicked((current) => current.slice(0, -1))
  }

  const lineState = feedback ? (feedback.isCorrect ? 'is-correct' : 'is-wrong') : ''
  return (
    <>
      <div className={`build-line ${built ? '' : 'empty'} ${lineState}`}>
        {built || 'Your word will appear here'}
        {picked.length && !disabled ? (
          <button type="button" onClick={undo} aria-label="Undo last piece">↶</button>
        ) : null}
      </div>
      <div className="small-answer-grid">
        {choices.map((choice) => (
          <button
            className="chunk-option"
            type="button"
            key={choice.index}
            disabled={disabled || picked.includes(choice.index)}
            onClick={() => pick(choice.index)}
          >
            {choice.text}
          </button>
        ))}
      </div>
      <button
        className="check-button"
        type="button"
        disabled={disabled || picked.length !== item.chunks.length}
        onClick={() => onAnswer(built === item.word, built)}
      >
        Check my word
      </button>
    </>
  )
}

// Shared by every mode that asks the player to spell the whole word. The
// keyboard handling is the reason it is shared: get one attribute wrong and the
// phone quietly offers the answer above the keys.
function SpellingInput({ id, label, placeholder, item, onAnswer, feedback }) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  const disabled = Boolean(feedback)
  const state = feedback ? (feedback.isCorrect ? 'is-correct' : 'is-wrong') : ''
  useEffect(() => {
    if (window.matchMedia('(min-width: 700px) and (pointer: fine)').matches) inputRef.current?.focus()
  }, [])
  return (
    <form
      className="type-form"
      onSubmit={(event) => {
        event.preventDefault()
        const typed = value.trim()
        if (typed) onAnswer(typed.toLowerCase() === item.word, typed.toLowerCase())
      }}
    >
      <label htmlFor={id}>{label}</label>
      {/* A phone keyboard that suggests the word defeats the whole exercise.
          `autocorrect` is what iOS listens to, and Chrome turns
          `spellcheck=false` into the Android IME's no-suggestions flag. */}
      <input
        id={id}
        ref={inputRef}
        name={id}
        className={state}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck="false"
        enterKeyHint="done"
        data-1p-ignore=""
        data-lpignore="true"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
      <button className="check-button" type="submit" disabled={disabled || !value.trim()}>
        Check my spelling
      </button>
    </form>
  )
}

export function TypeQuestion({ item, onAnswer, feedback }) {
  return (
    <SpellingInput
      id="typed-word"
      label="Type what you hear"
      placeholder="Type the word…"
      item={item}
      onAnswer={onAnswer}
      feedback={feedback}
    />
  )
}

// How long the word stays on screen before it is taken away. Long words get
// longer — the exercise is holding a spelling in your head for a moment, not
// reading against a stopwatch.
export const PEEK_BASE_MS = 1500
export const PEEK_PER_LETTER_MS = 220
export const PEEK_MAX_MS = 5000

export function peekMs(word) {
  return Math.min(PEEK_BASE_MS + word.length * PEEK_PER_LETTER_MS, PEEK_MAX_MS)
}

export function MemoryQuestion({ item, onAnswer, feedback }) {
  const hold = useMemo(() => peekMs(item.word), [item])
  const [showing, setShowing] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setShowing(false), hold)
    return () => window.clearTimeout(timer)
  }, [hold])

  // Answering during the peek — by way of the "I don't know" button — hides the
  // word too, so the feedback panel below is the one place the answer is shown.
  if (showing && !feedback) {
    return (
      <div className="memory-flash">
        <p className="memory-word">{item.word}</p>
        <p className="memory-hint">It will hide automatically, or hide it when you are ready.</p>
        <div className="memory-timer" aria-hidden="true">
          <i style={{ animationDuration: `${hold}ms` }} />
        </div>
        <button className="tiny-button" type="button" onClick={() => setShowing(false)}>
          Hide it — I&apos;m ready
        </button>
      </div>
    )
  }
  return (
    <SpellingInput
      id="remembered-word"
      label="Type the word you just saw"
      placeholder="Spell it from memory…"
      item={item}
      onAnswer={onAnswer}
      feedback={feedback}
    />
  )
}

// The registry is what a new game mode plugs into. `game.js` decides *which*
// mode a word gets; this decides how it looks.
export const MODE_REGISTRY = {
  listen: { component: ListenQuestion, eyebrow: 'Listen & spot', title: 'Which spelling is right?', icon: '🔊' },
  missing: { component: MissingQuestion, eyebrow: 'Fill the gap', title: 'Choose the missing piece', icon: '🧩' },
  chunks: { component: ChunkQuestion, eyebrow: 'Build the word', title: 'Tap the pieces in order', icon: '🪵' },
  memory: { component: MemoryQuestion, eyebrow: 'Memory trail', title: 'Look, then spell it from memory', icon: '🧠' },
  type: { component: TypeQuestion, eyebrow: 'Typing checkpoint', title: 'Listen, then type the word', icon: '⌨️' },
}
