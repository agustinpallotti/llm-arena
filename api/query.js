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

async function callGPT(systemPrompt, userMsg, fileData) {
  const messages = [{ role: 'system', content: systemPrompt }];
  if (fileData && fileData.type === 'image') {
    messages.push({ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` } },
      { type: 'text', text: userMsg }
    ]});
  } else if (fileData && fileData.text) {
    messages.push({ role: 'user', content: `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}` });
  } else {
    messages.push({ role: 'user', content: userMsg });
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 1200 })
  });
  const data = await res.json();
  if (data.error) throw new Error('GPT: ' + data.error.message);
  return data.choices[0].message.content;
}

async function callGemini(systemPrompt, userMsg, fileData) {
  let userContent = userMsg;
  if (fileData && fileData.text) userContent = `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userContent }] }]
      })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error('Gemini: ' + data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function callClaude(systemPrompt, userMsg, fileData) {
  let content;
  if (fileData && fileData.type === 'image') {
    content = [
      { type: 'image', source: { type: 'base64', media_type: fileData.mimeType, data: fileData.base64 } },
      { type: 'text', text: userMsg }
    ];
  } else if (fileData && fileData.text) {
    content = `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}`;
  } else {
    content = userMsg;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, system: systemPrompt, messages: [{ role: 'user', content }] })
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude: ' + JSON.stringify(data.error));
  return data.content.map(b => b.text || '').join('');
}

async function callArbiter(question, responses) {
  const activeModels = Object.entries(responses).filter(([,v]) => v).map(([k]) => k === 'gpt' ? 'ChatGPT' : k.charAt(0).toUpperCase() + k.slice(1));
  let responsesText = '';
  if (responses.gpt)    responsesText += `\nChatGPT:\n${responses.gpt}\n`;
  if (responses.gemini) responsesText += `\nGemini:\n${responses.gemini}\n`;
  if (responses.claude) responsesText += `\nClaude:\n${responses.claude}\n`;
  const prompt = `Eres un árbitro experto e imparcial evaluando respuestas de modelos de IA.
Pregunta del usuario: "${question}"
${responsesText}
Evalúa cada respuesta en: precisión, claridad, completitud y utilidad práctica.
Elige el ganador entre: ${activeModels.join(', ')}.
Formato:
${activeModels.map(m => `${m}: [evaluación en 2 líneas]`).join('\n')}
Ganador: [${activeModels.join(' / ')}]
Razón: [por qué es el mejor en 2 líneas]`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      messages: [
        { role: 'system', content: 'Eres un árbitro imparcial. Evalúa con rigor y objetividad. Nunca favorezcas a ChatGPT solo porque comparte tu origen.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 600
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Árbitro: ' + data.error.message);
  return data.choices[0].message.content;
}

async function detectModels(question) {
  // Claude decides — more impartial, tends to be self-critical
  // GPT is explicitly excluded from being the decider to avoid self-selection bias
  const prompt = `Eres un selector imparcial de modelos de IA. Tu único trabajo es decidir qué modelo es el MÁS ADECUADO para responder esta pregunta.

Pregunta: "${question}"

Modelos disponibles y sus fortalezas reales:
- gpt: ChatGPT GPT-4o-mini — código, matemáticas, instrucciones paso a paso, lógica estructurada, programación
- gemini: Google Gemini 2.5 Flash — información reciente, noticias, eventos actuales, búsqueda web, datos en tiempo real
- claude: Anthropic Claude — redacción creativa, análisis profundo, razonamiento ético, textos largos, síntesis, humanidades

Reglas estrictas:
1. Elige UNO como primero (el mejor para esta pregunta específica)
2. Sé honesto — no favorezcas a ninguno por defecto
3. Para preguntas generales o ambiguas, elige claude como primero
4. Para código o matemáticas, elige gpt como primero
5. Para noticias o información reciente (post-2024), elige gemini como primero

Responde SOLO con JSON válido sin texto adicional:
{"models": ["claude", "gpt", "gemini"], "reason": "razón breve en español"}

El orden importa: el PRIMERO es quien responderá.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  try {
    const text = data.content.map(b => b.text||'').join('');
    return JSON.parse(text.replace(/```json|```/g,'').trim());
  } catch {
    return { models: ['claude','gpt','gemini'], reason: 'Selección por defecto' };
  }
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers['x-session-token'];
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const { action, model, systemPrompt, userMsg, responses, question, fileData } = req.body;

  if (action === 'detect') {
    if (!question) return res.status(400).json({ error: 'Missing question' });
    try { return res.status(200).json(await detectModels(question)); }
    catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (action === 'arbiter') {
    if (!question || !responses) return res.status(400).json({ error: 'Missing fields' });
    try { return res.status(200).json({ result: await callArbiter(question, responses) }); }
    catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (!model || !userMsg) return res.status(400).json({ error: 'Missing fields' });
  try {
    let result;
    if      (model === 'gpt')    result = await callGPT(systemPrompt || '', userMsg, fileData);
    else if (model === 'gemini') result = await callGemini(systemPrompt || '', userMsg, fileData);
    else if (model === 'claude') result = await callClaude(systemPrompt || '', userMsg, fileData);
    else return res.status(400).json({ error: 'Unknown model: ' + model });
    return res.status(200).json({ result });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
