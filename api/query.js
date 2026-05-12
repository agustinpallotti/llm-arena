const crypto = require('crypto');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
}

async function verifyFirebaseToken(idToken) {
  if (!idToken) return false;
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;
    const validAudiences = [
      'llm-arena-60597',
      '507852214387-o2rch6rt2vv9si3r4u7d4ofr0e9od2qq.apps.googleusercontent.com'
    ];
    if (!validAudiences.includes(payload.aud)) return false;
    if (!payload.email && !payload.sub) return false;
    return true;
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
    body: JSON.stringify({ model: 'gpt-4o', messages, max_tokens: 2500 })
  });
  const data = await res.json();
  if (data.error) throw new Error('GPT: ' + data.error.message);
  return data.choices[0].message.content;
}

async function callGemini(systemPrompt, userMsg, fileData) {
  let userContent = userMsg;
  if (fileData && fileData.text) userContent = `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2500, system: systemPrompt, messages: [{ role: 'user', content }] })
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
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: 'Eres un árbitro imparcial. Evalúa con rigor y objetividad. Nunca favorezcas a ChatGPT solo porque comparte tu origen.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 800
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Árbitro: ' + data.error.message);
  return data.choices[0].message.content;
}

async function analyzeUserStyle(recentQuestions) {
  const prompt = `Analiza estas preguntas recientes de un usuario y extrae un perfil de estilo conciso.

Preguntas recientes:
${recentQuestions.map((q,i) => `${i+1}. "${q}"`).join('\n')}

Responde SOLO con JSON válido:
{
  "topics": "temas principales detectados en 1 línea",
  "style": "estilo de comunicación en 1 línea (ej: directo, técnico, analítico)",
  "interests": ["tema1", "tema2", "tema3"]
}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  const text = data.content.map(b => b.text||'').join('');
  try { return JSON.parse(text.replace(/```json|```/g,'').trim()); }
  catch { return null; }
}

async function detectModelsWithLearning(question, modelStats) {
  let learnedCtx = '';
  if (modelStats && Object.keys(modelStats).length > 0) {
    learnedCtx = '\n\nHistorial de preferencias del usuario (úsalo para decidir mejor):\n';
    for (const [model, stats] of Object.entries(modelStats)) {
      const modelName = model === 'gpt' ? 'ChatGPT' : model === 'gemini' ? 'Gemini' : 'Claude';
      if (stats.byCategory) {
        for (const [cat, data] of Object.entries(stats.byCategory)) {
          const total   = (data.success||0) + (data.fallback||0);
          const succPct = total > 0 ? Math.round((data.success||0)/total*100) : 0;
          if (total >= 2) learnedCtx += `- ${modelName} en "${cat}": ${succPct}% satisfacción (${total} usos)\n`;
        }
      }
    }
  }

  const prompt = `Eres un selector imparcial de modelos de IA. Decide qué modelo es el MÁS ADECUADO para esta pregunta.

Pregunta: "${question}"
${learnedCtx}
Modelos disponibles:
- gpt: ChatGPT GPT-4o — código, matemáticas, instrucciones paso a paso, programación, análisis técnico
- gemini: Google Gemini 2.5 Pro — información reciente, noticias, eventos actuales, datos en tiempo real, búsqueda web
- claude: Anthropic Claude Sonnet — redacción, análisis profundo, razonamiento, síntesis, estrategia, humanidades

Reglas:
1. Usa el historial de preferencias si existe para este tipo de pregunta
2. Para preguntas generales o de análisis → claude primero
3. Para código o matemáticas → gpt primero
4. Para noticias o datos recientes (post-2024) → gemini primero
5. Clasifica la pregunta en una categoría simple (código, análisis, redacción, noticias, general, matemáticas, estrategia, etc.)

Responde SOLO con JSON:
{"models": ["claude", "gpt", "gemini"], "reason": "razón breve", "category": "categoría detectada"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  try {
    const text = data.content.map(b => b.text||'').join('');
    return JSON.parse(text.replace(/```json|```/g,'').trim());
  } catch {
    return { models: ['claude','gpt','gemini'], reason: 'Selección por defecto', category: 'general' };
  }
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers['x-session-token'];
  const valid  = await verifyFirebaseToken(token);
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  const { action, model, systemPrompt, userMsg, responses, question, fileData } = req.body;

  if (action === 'detect') {
    if (!question) return res.status(400).json({ error: 'Missing question' });
    try {
      const modelStats = req.body.modelStats || {};
      const hasImage   = req.body.hasImage   || false;
      if (hasImage) {
        return res.status(200).json({
          models:   ['claude', 'gpt', 'gemini'],
          reason:   'Imagen detectada — usando modelo con visión',
          category: 'imagen'
        });
      }
      return res.status(200).json(await detectModelsWithLearning(question, modelStats));
    }
    catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (action === 'analyze-style') {
    const { recentQuestions } = req.body;
    if (!recentQuestions || !recentQuestions.length) return res.status(400).json({ error: 'Missing questions' });
    try { return res.status(200).json(await analyzeUserStyle(recentQuestions)); }
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
