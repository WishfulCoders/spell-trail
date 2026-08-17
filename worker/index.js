// Backup service for Spell Trail.
//
// Deliberately account-free: there is no email, no password, and no user
// record. A backup is a random code handed to the grown-up, and the code is
// the only key to the blob. That keeps children's data out of an identifiable
// account, at the cost that anyone holding a code can read that backup — which
// the UI says plainly.

const WORDS = [
  'acorn', 'alder', 'amber', 'anchor', 'antler', 'arbor', 'aspen', 'badger',
  'basin', 'beacon', 'birch', 'bison', 'bluff', 'boulder', 'bramble', 'branch',
  'breeze', 'bridge', 'brook', 'canyon', 'cedar', 'cinder', 'clover', 'cobble',
  'compass', 'copper', 'coral', 'cove', 'crater', 'creek', 'crest', 'dawn',
  'delta', 'dune', 'ember', 'fable', 'fern', 'fjord', 'flint', 'forest',
  'fossil', 'garnet', 'geyser', 'glacier', 'granite', 'grotto', 'harbor', 'heather',
  'hollow', 'ivy', 'juniper', 'kettle', 'lagoon', 'lantern', 'ledge', 'lichen',
  'lupine', 'maple', 'marsh', 'meadow', 'mesa', 'mica', 'mist', 'moss',
  'nectar', 'oak', 'onyx', 'orchard', 'otter', 'pebble', 'pine', 'plateau',
  'pollen', 'quarry', 'quartz', 'rapids', 'ridge', 'river', 'sage', 'sandbar',
  'sequoia', 'shale', 'shore', 'slate', 'spruce', 'summit', 'thicket', 'thistle',
  'timber', 'topaz', 'trail', 'tundra', 'valley', 'willow', 'yarrow', 'zenith',
]

const MAX_PAYLOAD_BYTES = 256 * 1024
const TTL_SECONDS = 60 * 60 * 24 * 365 * 2

function pick(list, random) {
  return list[random % list.length]
}

export function makeCode(randomValues) {
  const parts = [
    pick(WORDS, randomValues[0]),
    pick(WORDS, randomValues[1]),
    pick(WORDS, randomValues[2]),
  ]
  const digits = String(randomValues[3] % 10000).padStart(4, '0')
  return `${parts.join('-')}-${digits}`
}

export function normalizeCode(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export function isValidCode(code) {
  return /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/.test(code)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function handleSave(request, env) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad-json' }, 400)
  }

  const payload = body?.payload
  if (typeof payload !== 'string' || !payload) return json({ error: 'no-payload' }, 400)
  if (payload.length > MAX_PAYLOAD_BYTES) return json({ error: 'too-large' }, 413)

  // An existing code overwrites in place; otherwise mint a new one.
  let code = normalizeCode(body?.code)
  if (code) {
    if (!isValidCode(code)) return json({ error: 'bad-code' }, 400)
    const existing = await env.BACKUPS.get(code)
    if (!existing) return json({ error: 'not-found' }, 404)
  } else {
    const values = new Uint32Array(4)
    crypto.getRandomValues(values)
    code = makeCode(values)
  }

  await env.BACKUPS.put(code, payload, { expirationTtl: TTL_SECONDS })
  return json({ code, savedAt: Date.now() })
}

async function handleLoad(code, env) {
  if (!isValidCode(code)) return json({ error: 'bad-code' }, 400)
  const payload = await env.BACKUPS.get(code)
  if (!payload) return json({ error: 'not-found' }, 404)
  return json({ code, payload })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    if (url.pathname === '/api/backup' && request.method === 'POST') {
      return handleSave(request, env)
    }
    if (url.pathname.startsWith('/api/backup/') && request.method === 'GET') {
      return handleLoad(normalizeCode(url.pathname.slice('/api/backup/'.length)), env)
    }
    return json({ error: 'not-found' }, 404)
  },
}
