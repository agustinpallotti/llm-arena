const crypto = require('crypto');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;
  const secret = process.env.APP_SECRET;

  if (!password || !secret) return res.status(400).json({ ok: false });

  const a = Buffer.from(password.padEnd(128));
  const b = Buffer.from(secret.padEnd(128));
  let match = false;
  try {
    match = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { match = false; }

  if (match) {
    const token = crypto.createHmac('sha256', secret).update('llm-arena-session').digest('hex');
    return res.status(200).json({ ok: true, token });
  } else {
    setTimeout(() => res.status(401).json({ ok: false }), 500);
  }
};
