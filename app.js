// ── Helpers ──────────────────────────────────────────────────────────────────

function setProgress(pct) {
  document.getElementById('progress-fill').style.width = pct + '%';
}

function setStatus(id, type, label) {
  const el = document.getElementById('status-' + id);
  el.className = 'status-chip ' + type;
  el.textContent = label;
}

function setText(id, text) {
  document.getElementById('text-' + id).textContent = text;
}

function highlightWinner(id) {
  ['gpt', 'gemini', 'claude'].forEach(m => {
    const card = document.getElementById('card-' + m);
    card.classList.remove('winner');
    const badge = card.querySelector('.winner-badge');
    if (badge) badge.remove();
  });
  const card = document.getElementById('card-' + id);
  card.classList.add('winner');
  const badge = document.createElement('span');
  badge.className = 'winner-badge';
  badge.textContent = 'Ganador';
  card.querySelector('.result-card-header').appendChild(badge);
}

function togglePrompts() {
  const grid = document.getElementById('prompts-grid');
  grid.style.display = grid.style.display === 'none' ? '' : 'none';
}

// ── API Calls ─────────────────────────────────────────────────────────────────

async function callGPT(systemPrompt, userMsg, key) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
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
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callGemini(systemPrompt, userMsg, key) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
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
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function callClaude(systemPrompt, userMsg, key) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content.map(b => b.text || '').join('');
}

async function callArbiter(question, gpt, gemini, claude, claudeKey) {
  const prompt = `Eres un árbitro experto en evaluar respuestas de modelos de lenguaje. Evalúa las siguientes tres respuestas a la misma pregunta y elige la mejor.

Criterios: precisión, claridad, completitud, utilidad práctica y calidad de redacción.

Pregunta del usuario: "${question}"

Respuesta de ChatGPT:
${gpt}

Respuesta de Gemini:
${gemini}

Respuesta de Claude:
${claude}

Evalúa brevemente cada respuesta (2-3 líneas), luego declara el ganador con este formato exacto:

ChatGPT: [evaluación]
Gemini: [evaluación]
Claude: [evaluación]

Ganador: [ChatGPT / Gemini / Claude]
Razón: [explicación breve]`;

  return callClaude('Eres un árbitro imparcial.', prompt, claudeKey);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runArena() {
  const question    = document.getElementById('user-question').value.trim();
  const openaiKey   = document.getElementById('openai-key').value.trim();
  const geminiKey   = document.getElementById('gemini-key').value.trim();
  const claudeKey   = document.getElementById('claude-key').value.trim();
  const sysGPT      = document.getElementById('sys-gpt').value;
  const sysGemini   = document.getElementById('sys-gemini').value;
  const sysClaude   = document.getElementById('sys-claude').value;

  if (!question)   { alert('Escribe una pregunta primero.'); return; }
  if (!openaiKey)  { alert('Ingresa tu API key de OpenAI.'); return; }
  if (!geminiKey)  { alert('Ingresa tu API key de Gemini.'); return; }
  if (!claudeKey)  { alert('Ingresa tu API key de Anthropic (Claude).'); return; }

  // Reset UI
  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  btn.textContent = 'Consultando...';
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('progress-bar').classList.add('visible');
  setProgress(5);

  ['gpt', 'gemini', 'claude'].forEach(m => {
    setStatus(m, '', 'Consultando...');
    setText(m, '—');
    document.getElementById('card-' + m).classList.remove('winner');
    const b = document.getElementById('card-' + m).querySelector('.winner-badge');
    if (b) b.remove();
  });
  document.getElementById('arbiter-text').textContent = 'Esperando respuestas de los modelos...';

  const results = { gpt: null, gemini: null, claude: null };

  // Call all three in parallel
  await Promise.all([
    callGPT(sysGPT, question, openaiKey)
      .then(r => { results.gpt = r; setText('gpt', r); setStatus('gpt', 'done', 'Listo'); setProgress(40); })
      .catch(e => { setText('gpt', 'Error: ' + e.message); setStatus('gpt', 'error', 'Error'); }),

    callGemini(sysGemini, question, geminiKey)
      .then(r => { results.gemini = r; setText('gemini', r); setStatus('gemini', 'done', 'Listo'); setProgress(60); })
      .catch(e => { setText('gemini', 'Error: ' + e.message); setStatus('gemini', 'error', 'Error'); }),

    callClaude(sysClaude, question, claudeKey)
      .then(r => { results.claude = r; setText('claude', r); setStatus('claude', 'done', 'Listo'); setProgress(75); })
      .catch(e => { setText('claude', 'Error: ' + e.message); setStatus('claude', 'error', 'Error'); })
  ]);

  setProgress(80);

  // Run arbiter
  const available = Object.values(results).filter(Boolean);
  if (available.length < 2) {
    document.getElementById('arbiter-text').textContent =
      'No hay suficientes respuestas para comparar. Revisa tus API keys.';
  } else {
    document.getElementById('arbiter-text').textContent = 'Analizando respuestas...';
    try {
      const verdict = await callArbiter(
        question,
        results.gpt    || '[Sin respuesta]',
        results.gemini || '[Sin respuesta]',
        results.claude || '[Sin respuesta]',
        claudeKey
      );
      document.getElementById('arbiter-text').textContent = verdict;

      // Highlight winner card
      const match = verdict.match(/Ganador:\s*(ChatGPT|Gemini|Claude)/i);
      if (match) {
        const name = match[1].toLowerCase();
        if (name === 'chatgpt') highlightWinner('gpt');
        else if (name === 'gemini') highlightWinner('gemini');
        else if (name === 'claude') highlightWinner('claude');
      }
    } catch (e) {
      document.getElementById('arbiter-text').textContent = 'Error del árbitro: ' + e.message;
    }
  }

  setProgress(100);
  btn.disabled = false;
  btn.textContent = 'Consultar los tres modelos ↗';
}
