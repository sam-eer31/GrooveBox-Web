let kv = null
const getKv = async () => {
  if (kv) return kv
  try {
    const mod = await import('@vercel/kv')
    kv = mod.kv
  } catch {}
  return kv
}

const isAuthorized = (req) => {
  const secret = process.env.GLOBAL_PLAYER_UPDATE_SECRET
  if (!secret) return true
  return req.headers['x-global-update-secret'] === secret
}

const GLOBAL_KEY = 'global_player_state'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const kvClient = await getKv()
  if (!kvClient) {
    return res.status(503).json({ error: 'KV not configured' })
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}
    const nowIso = new Date().toISOString()

    const update = {}
    const allowed = [
      'track_id',
      'track_title',
      'track_artist',
      'duration_ms',
      'status',
      'position_ms',
      'last_updated_at',
      'updated_by',
    ]
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }
    if (!update.last_updated_at) update.last_updated_at = nowIso

    if (update.status && !['playing', 'paused', 'stopped'].includes(update.status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }
    if (update.duration_ms != null && typeof update.duration_ms !== 'number') {
      return res.status(400).json({ error: 'Invalid duration_ms' })
    }
    if (update.position_ms != null && typeof update.position_ms !== 'number') {
      return res.status(400).json({ error: 'Invalid position_ms' })
    }

    const existing = (await kvClient.get(GLOBAL_KEY)) || {}
    const nextState = { ...existing, ...update }

    await kvClient.set(GLOBAL_KEY, nextState)

    // Optional realtime broadcast (requires server token)
    try {
      const token = process.env.REALTIME_SERVER_TOKEN
      const channel = process.env.REALTIME_CHANNEL || 'global-player'
      const baseUrl = process.env.REALTIME_BASE_URL || 'https://realtime.vercel.com'
      if (token) {
        await fetch(`${baseUrl}/v1/channels/${encodeURIComponent(channel)}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'state_update', data: nextState }),
        })
      }
    } catch {}

    return res.status(200).json({ ok: true, state: nextState })
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update global state' })
  }
}


