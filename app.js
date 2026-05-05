import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase Config ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyABX-y7bat2oVL7--GD2uTk6pXtK2745bw",
  authDomain: "llm-arena-60597.firebaseapp.com",
  projectId: "llm-arena-60597",
  storageBucket: "llm-arena-60597.firebasestorage.app",
  messagingSenderId: "507852214387",
  appId: "1:507852214387:web:e3c14d75c81266476b5a06"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Password Protection ───────────────────────────────────────────────────────
// Cambia esta contraseña por la que quieras usar
const APP_PASSWORD = "arena2025";

function checkLogin() {
  const input = document.getElementById('login-input').value;
  if (input === APP_PASSWORD) {
    sessionStorage.setItem('llm-arena-auth', '1');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadSettings();
    loadHistory();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
    document.getElementById('login-input').value = '';
    document.getElementById('login-input').focus();
  }
}

window.checkLogin = checkLogin;

// Auto-login if already authenticated in this session
window.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('llm-arena-auth') === '1') {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadSettings();
    loadHistory();
  }
});

// ── Settings ─────────────────────────────────────────────────────────────────
function saveSettings() {
  localStorage.setItem('llm-openai-key',  document.getElementById('openai-key').value);
  localStorage.setItem('llm-gemini-key',  document.getElementById('gemini-key').value);
  localStorage.setItem('llm-claude-key',  document.getElementById('claude-key').value);
  localStorage.setItem('llm-sys-gpt',     document.getElementById('sys-gpt').value);
  localStorage.setItem('llm-sys-gemini',  document.getElementById('sys-gemini').value);
  localStorage.setItem('llm-sys-claude',  document.getElementById('sys-claude').value);
  toggleSettings();
}

function loadSettings() {
  document.getElementById('openai-key').value  = localStorage.getItem('llm-openai-key') || '';
  document.getElementById('gemini-key').value  = localStorage.getItem('llm-gemini-key') || '';
  document.getElementById('claude-key').value  = localStorage.getItem('llm-claude-key') || '';
  document.getElementById('sys-gpt').value     = localStorage.getItem('llm-sys-gpt')    || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  document.getElementById('sys-gemini').value  = localStorage.getItem('llm-sys-gemini') || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  document.getElementById('sys-claude').value  = localStorage.getItem('llm-sys-claude') || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
}

function toggleSettings() {
  document.getElementById('settings-panel').classList.toggle('hidden');
}

window.saveSettings  = saveSettings;
window.toggleSettings = toggleSettings;

// ── History ───────────────────────────────────────────────────────────────────
async function saveToHistory(question, results, arbiterText) {
  try {
    await addDoc(collection(db, 'history'), {
      question,
      gpt:     results.gpt    || null,
      gemini:  results.gemini || null,
      claude:  results.claude || null,
      arbiter: arbiterText,
      createdAt: new Date()
    });
    loadHistory();
  } catch (e) {
    console.error('Error guardando en Firebase:', e);
  }
}

async function loadHistory() {
  try {
    const q = query(collection(db, 'history'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    list.innerHTML = '';

    if (snap.empty) {
      list.appendChild(empty);
      empty.classList.remove('hidden');
      return;
    }

    snap.forEach(docSnap => {
      const data = docSnap.data();
      const btn = document.createElement('button');
      btn.className = 'history-item';

      const date = data.createdAt?.toDate?.() || new Date();
      const dateStr = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

      btn.innerHTML = `
        <span class="history-item-q">${escapeHtml(data.question)}</span>
        <span class="history-item-date">${dateStr}</span>
      `;

      btn.onclick = () => loadHistoryItem(data, btn);
      list.appendChild(btn);
    });
  } catch (e) {
    console.error('Error cargando historial:', e);
  }
}

function loadHistoryItem(data, btn) {
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.getElementById('user-question').value = data.question;
  setText('gpt',    data.gpt    || '[Sin respuesta]');
  setText('gemini', data.gemini || '[Sin respuesta]');
  setText('claude', data.claude || '[Sin respuesta]');
  setStatus('gpt',    data.gpt    ? 'done' : 'error', data.gpt    ? 'Listo' : 'Error');
  setStatus('gemini', data.gemini ? 'done' : 'error', data.gemini ? 'Listo' : 'Error');
  setStatus('claude', data.claude ? 'done' : 'error', data.claude ? 'Listo' : 'Error');
  document.getElementById('arbiter-text').textContent = data.arbiter || '—';
  document.getElementById('results').classList.remove('hidden');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.newQuery = function() {
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  document.getElementById('user-question').value = '';
  document.getElementById('results').classList.add('hidden');
  document.getElementById('progress-bar').classList.add('hidden');
  setProgress(0);
  document.getElementById('user-question').focus();
};

// ── UI Helpers ────────────────────────────────────────────────────────────────
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
  ['gpt','gemini','claude'].forEach(m => {
    document.getElementById('card-' + m).classList.remove('winner');
    const b = document.getElementById('card-' + m).querySelector('.winner-badge');
    if (b) b.remove();
  });
  const card = document.getElementById('card-' + id);
  card.classList.add('winner');
  const badge = document.createElement('span');
  badge.className = 'winner-badge';
  badge.textContent = 'Ganador';
  card.querySelector('.result-card-header').appendChild(badge);
}

// ── API Calls ─────────────────────────────────────────────────────────────────
async function callGPT(systemPrompt, userMsg, key) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
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
      model: 'claude-3-5-sonnet-20241022',
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
  const question   = document.getElementById('user-question').value.trim();
  const openaiKey  = document.getElementById('openai-key').value.trim();
  const geminiKey  = document.getElementById('gemini-key').value.trim();
  const claudeKey  = document.getElementById('claude-key').value.trim();
  const sysGPT     = document.getElementById('sys-gpt').value;
  const sysGemini  = document.getElementById('sys-gemini').value;
  const sysClaude  = document.getElementById('sys-claude').value;

  if (!question)  { alert('Escribe una pregunta primero.'); return; }
  if (!openaiKey) { alert('Falta la API key de OpenAI. Abre Configuración.'); return; }
  if (!geminiKey) { alert('Falta la API key de Gemini. Abre Configuración.'); return; }
  if (!claudeKey) { alert('Falta la API key de Claude. Abre Configuración.'); return; }

  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  btn.textContent = 'Consultando...';
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('progress-bar').classList.remove('hidden');
  setProgress(5);

  ['gpt','gemini','claude'].forEach(m => {
    setStatus(m, '', 'Consultando...');
    setText(m, '—');
    document.getElementById('card-' + m).classList.remove('winner');
    const b = document.getElementById('card-' + m).querySelector('.winner-badge');
    if (b) b.remove();
  });
  document.getElementById('arbiter-text').textContent = 'Esperando respuestas...';

  const results = { gpt: null, gemini: null, claude: null };

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

  const available = Object.values(results).filter(Boolean);
  let arbiterText = '';

  if (available.length < 2) {
    arbiterText = 'No hay suficientes respuestas para comparar. Revisa tus API keys en Configuración.';
    document.getElementById('arbiter-text').textContent = arbiterText;
  } else {
    document.getElementById('arbiter-text').textContent = 'Analizando respuestas...';
    try {
      arbiterText = await callArbiter(
        question,
        results.gpt    || '[Sin respuesta]',
        results.gemini || '[Sin respuesta]',
        results.claude || '[Sin respuesta]',
        claudeKey
      );
      document.getElementById('arbiter-text').textContent = arbiterText;

      const match = arbiterText.match(/Ganador:\s*(ChatGPT|Gemini|Claude)/i);
      if (match) {
        const name = match[1].toLowerCase();
        if (name === 'chatgpt') highlightWinner('gpt');
        else if (name === 'gemini') highlightWinner('gemini');
        else if (name === 'claude') highlightWinner('claude');
      }
    } catch (e) {
      arbiterText = 'Error del árbitro: ' + e.message;
      document.getElementById('arbiter-text').textContent = arbiterText;
    }
  }

  // Save to Firebase
  await saveToHistory(question, results, arbiterText);

  setProgress(100);
  btn.disabled = false;
  btn.textContent = 'Consultar los tres modelos ↗';
}

window.runArena = runArena;
