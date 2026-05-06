const crypto = require('crypto');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
}

function verifyToken(token) {
  if (!token) return false;
  const secret = process.env.APP_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update('llm-arena-session').digest('hex');
  try {
    const a = Buffer.from(token.padEnd(128));
    const b = Buffer.from(expected.padEnd(128));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

async function callGPT(systemPrompt, userMsg) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      max_tokens: 800
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('GPT: ' + data.error.message);
  return data.choices[0].message.content;
}

async function callGemini(systemPrompt, userMsg) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMsg }] }]
      })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error('Gemini: ' + data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function callClaude(systemPrompt, userMsg) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude: ' + JSON.stringify(data.error));
  return data.content.map(b => b.text || '').join('');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-session-token'];
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const { model, systemPrompt, userMsg } = req.body;
  if (!model || !userMsg) return res.status(400).json({ error: 'Missing fields' });

  try {
    let result;
    if      (model === 'gpt')    result = await callGPT(systemPrompt || '', userMsg);
    else if (model === 'gemini') result = await callGemini(systemPrompt || '', userMsg);
    else if (model === 'claude') result = await callClaude(systemPrompt || '', userMsg);
    else return res.status(400).json({ error: 'Unknown model: ' + model });
    return res.status(200).json({ result });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
