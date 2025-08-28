// Vercel Serverless Function (ESM)

let kv = null
const getKv = async () => {
  if (kv) return kv
  try {
    const mod = await import('@vercel/kv')
    kv = mod.kv
  } catch {}
  return kv
}

const GLOBAL_KEY = 'global_player_state'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const kvClient = await getKv()
  if (!kvClient) {
    return res.status(503).json({ error: 'KV not configured' })
  }

  try {
    const state = await kvClient.get(GLOBAL_KEY)
    return res.status(200).json(
      state || {
        track_id: null,
        track_title: null,
        track_artist: null,
        duration_ms: 0,
        status: 'stopped',
        position_ms: 0,
        last_updated_at: new Date().toISOString(),
        updated_by: null,
      }
    )
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch global state' })
  }
}


