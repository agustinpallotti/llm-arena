const crypto = require('crypto');

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

function enhanceSystemPrompt(basePrompt, model) {
  const modelName = model === 'gpt' ? 'ChatGPT GPT-4o' : model === 'gemini' ? 'Google Gemini 2.5 Pro' : 'Claude Sonnet';
  const enhancement = `Eres ${modelName}, operando como asistente personal de alto nivel para Agustín Pallotti.
Principios de respuesta:
- Sé directo, preciso y sustancial. No des respuestas superficiales.
- Si la pregunta es compleja, responde con la profundidad que merece.
- Incluye datos concretos, ejemplos reales y recomendaciones accionables cuando aplique.
- Si no sabes algo con certeza, dilo — no inventes.
- Para análisis técnicos, sé exhaustivo y detallado.`;
  return enhancement + '\n\n' + basePrompt;
}

function getMaxTokens(model, userMsg) {
  const complex = /analiz|revis|explica|compar|estrategia|plan|diseña|desarrolla|investiga|profundiza|detalla/i.test(userMsg);
  if (model === 'claude') return complex ? 8000 : 4000;
  if (model === 'gpt')    return complex ? 4000 : 2500;
  return 2000;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-session-token'];
  if (!await verifyFirebaseToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const { model, systemPrompt, userMsg, fileData } = req.body;
  if (!model || !userMsg) return res.status(400).json({ error: 'Missing fields' });

  const enhanced  = enhanceSystemPrompt(systemPrompt || '', model);
  const maxTokens = getMaxTokens(model, userMsg);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (text) => res.write(`data: ${JSON.stringify({ text })}\n\n`);
  const done = () => { res.write('data: [DONE]\n\n'); res.end(); };

  try {
    if (model === 'claude') {
      // Claude streaming
      const body = {
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        stream: true,
        system: enhanced,
        messages: [{ role: 'user', content: fileData?.text
          ? `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}`
          : fileData?.type === 'image'
          ? [{ type: 'image', source: { type: 'base64', media_type: fileData.mimeType, data: fileData.base64 } }, { type: 'text', text: userMsg }]
          : userMsg
        }]
      };
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });
      const reader = upstream.body.getReader();
      const dec    = new TextDecoder();
      let buf = '';
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              send(evt.delta.text);
            }
          } catch {}
        }
      }
      done();

    } else if (model === 'gpt') {
      // GPT-4o streaming
      const messages = [{ role: 'system', content: enhanced }];
      if (fileData?.type === 'image') {
        messages.push({ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` } },
          { type: 'text', text: userMsg }
        ]});
      } else if (fileData?.text) {
        messages.push({ role: 'user', content: `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}` });
      } else {
        messages.push({ role: 'user', content: userMsg });
      }
      const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
        body: JSON.stringify({ model: 'gpt-4o', messages, max_tokens: maxTokens, stream: true })
      });
      const reader = upstream.body.getReader();
      const dec    = new TextDecoder();
      let buf = '';
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          if (line.includes('[DONE]')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            const text = evt.choices?.[0]?.delta?.content;
            if (text) send(text);
          } catch {}
        }
      }
      done();

    } else {
      // Gemini — doesn't support SSE streaming the same way, use regular and send all at once
      const userContent = fileData?.text
        ? `Archivo adjunto:\n\n${fileData.text}\n\n---\n\n${userMsg}`
        : userMsg;
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: enhanced }] },
            contents: [{ parts: [{ text: userContent }] }],
            tools: [{ google_search: {} }]
          })
        }
      );
      const data = await upstream.json();
      if (data.error) throw new Error('Gemini: ' + data.error.message);
      const parts = data.candidates[0].content.parts || [];
      const text  = parts.filter(p => p.text).map(p => p.text).join('');
      send(text);
      done();
    }
  } catch(e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
};
