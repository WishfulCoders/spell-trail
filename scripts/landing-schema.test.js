// Guards the search and assistant-facing metadata, which has no build step and
// is easy to let drift:
//
//   - every JSON-LD block parses;
//   - the FAQPage schema on the landing page matches the visible FAQ word for word
//     (engines treat a mismatch as spam);
//   - the one-line description is identical everywhere it appears — landing page,
//     app shell, and both llms.txt files — because assistants build their picture
//     of an app from repeated consistent statements;
//   - the app entity has the same @id on both pages, so it reads as one thing.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const landing = read('site/index.html')
const appShell = read('index.html')
const appLlms = read('public/llms.txt')
const siteLlms = read('site/llms.txt')

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const squash = (s) => decode(s).replace(/\s+/g, ' ').trim()

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  expect(blocks.length, 'expected exactly one JSON-LD block').toBe(1)
  return JSON.parse(blocks[0][1])
}

function meta(html, attr, value) {
  const m = html.match(new RegExp(`<meta ${attr}="${value}" content="([^"]*)"`))
  expect(m, `missing <meta ${attr}="${value}">`).not.toBeNull()
  return decode(m[1])
}

function visibleFaq(html) {
  const section = html.match(/<div class="grownup faq">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/)
  expect(section, 'FAQ section not found').not.toBeNull()
  return [...section[1].matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(([, q, a]) => ({
    question: squash(q),
    answer: squash(a),
  }))
}

const byType = (graph, type) =>
  graph['@graph'].find((n) => (Array.isArray(n['@type']) ? n['@type'].includes(type) : n['@type'] === type))

describe('landing page schema', () => {
  const graph = jsonLd(landing)

  it('carries the visible FAQ verbatim', () => {
    const faqs = visibleFaq(landing)
    expect(faqs.length).toBeGreaterThanOrEqual(6)
    const schema = byType(graph, 'FAQPage').mainEntity.map((q) => ({
      question: q.name,
      answer: q.acceptedAnswer.text,
    }))
    expect(schema).toEqual(faqs)
  })

  it('ties the app to the Wishful Coders organization and author', () => {
    const app = byType(graph, 'SoftwareApplication')
    expect(app.publisher['@id']).toBe('https://wishfulcoders.com/#organization')
    expect(app.author['@id']).toBe('https://wishfulcoders.com/about/#person')
    expect(byType(graph, 'Organization')['@id']).toBe('https://wishfulcoders.com/#organization')
    expect(byType(graph, 'Person')['@id']).toBe('https://wishfulcoders.com/about/#person')
    expect(app.isAccessibleForFree).toBe(true)
    expect(app.offers.price).toBe('0')
  })
})

describe('one description everywhere', () => {
  const description = meta(landing, 'name', 'description')
  const blockquote = (txt) => squash(txt.match(/^> (.*)$/m)[1])

  it('is short enough for a search snippet', () => {
    expect(description.length).toBeLessThanOrEqual(160)
  })

  it('matches across the landing page, app shell, and llms.txt files', () => {
    expect(meta(landing, 'property', 'og:description')).toBe(description)
    expect(meta(appShell, 'name', 'description')).toBe(description)
    expect(meta(appShell, 'property', 'og:description')).toBe(description)
    expect(blockquote(appLlms)).toBe(description)
    expect(blockquote(siteLlms)).toBe(description)
    expect(byType(jsonLd(landing), 'SoftwareApplication').description).toBe(description)
    expect(byType(jsonLd(appShell), 'SoftwareApplication').description).toBe(description)
  })

  it('describes one app entity on both pages', () => {
    const a = byType(jsonLd(landing), 'SoftwareApplication')['@id']
    const b = byType(jsonLd(appShell), 'SoftwareApplication')['@id']
    expect(a).toBe('https://spelltrail.app/#app')
    expect(b).toBe(a)
  })
})
