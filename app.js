import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, setDoc, deleteDoc, doc, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase ──────────────────────────────────────────────────────────────────
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

// ── Session Token (set after login, never stored long-term) ───────────────────
let SESSION_TOKEN = sessionStorage.getItem('llm-arena-token') || null;

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkLogin() {
  const password = document.getElementById('login-input').value;
  if (!password) return;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.ok && data.token) {
      SESSION_TOKEN = data.token;
      sessionStorage.setItem('llm-arena-token', data.token);
      showApp();
    } else {
      document.getElementById('login-error').classList.remove('hidden');
      document.getElementById('login-input').value = '';
      document.getElementById('login-input').focus();
    }
  } catch(e) {
    document.getElementById('login-error').textContent = 'Error de conexión. Intenta de nuevo.';
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadSettings();
  loadHistory();
  loadProfile();
  loadDocuments();
}

window.checkLogin = checkLogin;

window.addEventListener('DOMContentLoaded', () => {
  if (SESSION_TOKEN) showApp();
});

// ── API Proxy caller ──────────────────────────────────────────────────────────
async function callProxy(model, systemPrompt, userMsg) {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': SESSION_TOKEN
    },
    body: JSON.stringify({ model, systemPrompt, userMsg })
  });
  if (res.status === 401) {
    sessionStorage.clear();
    location.reload();
    throw new Error('Sesión expirada. Por favor inicia sesión de nuevo.');
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  ['history','profile','docs'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab);
  });
};

// ── Settings ──────────────────────────────────────────────────────────────────
function saveSettings() {
  localStorage.setItem('llm-sys-gpt',    document.getElementById('sys-gpt').value);
  localStorage.setItem('llm-sys-gemini', document.getElementById('sys-gemini').value);
  localStorage.setItem('llm-sys-claude', document.getElementById('sys-claude').value);
  toggleSettings();
}
function loadSettings() {
  document.getElementById('sys-gpt').value    = localStorage.getItem('llm-sys-gpt')    || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  document.getElementById('sys-gemini').value = localStorage.getItem('llm-sys-gemini') || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  document.getElementById('sys-claude').value = localStorage.getItem('llm-sys-claude') || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
}
function toggleSettings() { document.getElementById('settings-panel').classList.toggle('hidden'); }
window.saveSettings   = saveSettings;
window.toggleSettings = toggleSettings;

// ── Profile ───────────────────────────────────────────────────────────────────
async function saveProfile() {
  const profile = {
    name:    document.getElementById('profile-name').value,
    role:    document.getElementById('profile-role').value,
    context: document.getElementById('profile-context').value,
    style:   document.getElementById('profile-style').value,
    topics:  document.getElementById('profile-topics').value,
  };
  await setDoc(doc(db, 'user', 'profile'), profile);
  const saved = document.getElementById('profile-saved');
  saved.classList.remove('hidden');
  setTimeout(() => saved.classList.add('hidden'), 2500);
  updateMemoryBanner();
}
async function loadProfile() {
  try {
    const snap = await getDoc(doc(db, 'user', 'profile'));
    if (snap.exists()) {
      const p = snap.data();
      document.getElementById('profile-name').value    = p.name    || '';
      document.getElementById('profile-role').value    = p.role    || '';
      document.getElementById('profile-context').value = p.context || '';
      document.getElementById('profile-style').value   = p.style   || '';
      document.getElementById('profile-topics').value  = p.topics  || '';
      updateMemoryBanner();
    }
  } catch(e) { console.error('Error cargando perfil:', e); }
}
function getProfileContext() {
  const name    = document.getElementById('profile-name').value.trim();
  const role    = document.getElementById('profile-role').value.trim();
  const context = document.getElementById('profile-context').value.trim();
  const style   = document.getElementById('profile-style').value.trim();
  const topics  = document.getElementById('profile-topics').value.trim();
  if (!name && !role && !context) return '';
  let text = '\n\n--- CONTEXTO DEL USUARIO ---\n';
  if (name)    text += `Nombre: ${name}\n`;
  if (role)    text += `Rol: ${role}\n`;
  if (context) text += `Sobre el usuario: ${context}\n`;
  if (style)   text += `Estilo de respuesta preferido: ${style}\n`;
  if (topics)  text += `Temas de interés: ${topics}\n`;
  text += '--- FIN CONTEXTO ---\n';
  return text;
}
window.saveProfile = saveProfile;

// ── Documents ─────────────────────────────────────────────────────────────────
let userDocs = [];
async function addDocument() {
  const title   = document.getElementById('doc-title').value.trim();
  const content = document.getElementById('doc-content').value.trim();
  if (!title || !content) { alert('Escribe un título y el contenido.'); return; }
  await addDoc(collection(db, 'documents'), { title, content, createdAt: new Date() });
  document.getElementById('doc-title').value   = '';
  document.getElementById('doc-content').value = '';
  loadDocuments();
}
async function loadDocuments() {
  try {
    const q    = query(collection(db, 'documents'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    userDocs   = [];
    const list = document.getElementById('docs-list');
    list.innerHTML = '';
    snap.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      userDocs.push(data);
      const item = document.createElement('div');
      item.className = 'doc-item';
      item.innerHTML = `
        <div class="doc-item-header">
          <span class="doc-item-title">${escapeHtml(data.title)}</span>
          <button class="doc-delete-btn" onclick="deleteDocument('${data.id}')">✕</button>
        </div>
        <p class="doc-item-preview">${escapeHtml(data.content.substring(0,80))}${data.content.length>80?'...':''}</p>`;
      list.appendChild(item);
    });
    updateMemoryBanner();
  } catch(e) { console.error('Error cargando documentos:', e); }
}
async function deleteDocument(id) {
  await deleteDoc(doc(db, 'documents', id));
  loadDocuments();
}
function getDocsContext() {
  if (!userDocs.length) return '';
  let text = '\n\n--- DOCUMENTOS DE REFERENCIA ---\n';
  userDocs.forEach(d => { text += `\n[${d.title}]:\n${d.content}\n`; });
  text += '--- FIN DOCUMENTOS ---\n';
  return text;
}
window.addDocument    = addDocument;
window.deleteDocument = deleteDocument;

// ── Memory Banner ─────────────────────────────────────────────────────────────
function updateMemoryBanner() {
  const hasProfile = document.getElementById('profile-name').value.trim() ||
                     document.getElementById('profile-context').value.trim();
  const hasDocs    = userDocs.length > 0;
  const banner     = document.getElementById('memory-banner');
  const summary    = document.getElementById('memory-summary');
  if (hasProfile || hasDocs) {
    banner.classList.remove('hidden');
    const parts = [];
    if (hasProfile) parts.push('perfil personal');
    if (hasDocs)    parts.push(`${userDocs.length} documento${userDocs.length>1?'s':''}`);
    summary.textContent = `Los modelos usarán tu ${parts.join(' y ')} como contexto`;
  } else {
    banner.classList.add('hidden');
  }
}

// ── History ───────────────────────────────────────────────────────────────────
async function saveToHistory(question, results, arbiterText) {
  try {
    await addDoc(collection(db, 'history'), {
      question, arbiter: arbiterText,
      gpt: results.gpt || null, gemini: results.gemini || null, claude: results.claude || null,
      createdAt: new Date()
    });
    loadHistory();
  } catch(e) { console.error('Error guardando historial:', e); }
}
async function loadHistory() {
  try {
    const q    = query(collection(db, 'history'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list  = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    list.innerHTML = '';
    if (snap.empty) { list.appendChild(empty); empty.classList.remove('hidden'); return; }
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const btn  = document.createElement('button');
      btn.className = 'history-item';
      const date    = data.createdAt?.toDate?.() || new Date();
      const dateStr = date.toLocaleDateString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      btn.innerHTML = `<span class="history-item-q">${escapeHtml(data.question)}</span><span class="history-item-date">${dateStr}</span>`;
      btn.onclick = () => loadHistoryItem(data, btn);
      list.appendChild(btn);
    });
  } catch(e) { console.error('Error cargando historial:', e); }
}
async function getRecentHistoryContext() {
  try {
    const q    = query(collection(db, 'history'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => items.push(d.data()));
    const recent = items.slice(0, 5);
    if (!recent.length) return '';
    let text = '\n\n--- CONSULTAS RECIENTES (para contexto) ---\n';
    recent.forEach((item, i) => { text += `${i+1}. "${item.question}"\n`; });
    text += '--- FIN HISTORIAL ---\n';
    return text;
  } catch(e) { return ''; }
}
function loadHistoryItem(data, btn) {
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('user-question').value = data.question;
  setText('gpt',    data.gpt    || '[Sin respuesta]');
  setText('gemini', data.gemini || '[Sin respuesta]');
  setText('claude', data.claude || '[Sin respuesta]');
  setStatus('gpt',    data.gpt    ? 'done':'error', data.gpt    ? 'Listo':'Error');
  setStatus('gemini', data.gemini ? 'done':'error', data.gemini ? 'Listo':'Error');
  setStatus('claude', data.claude ? 'done':'error', data.claude ? 'Listo':'Error');
  document.getElementById('arbiter-text').textContent = data.arbiter || '—';
  document.getElementById('results').classList.remove('hidden');
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
function setProgress(pct) { document.getElementById('progress-fill').style.width = pct + '%'; }
function setStatus(id, type, label) {
  const el = document.getElementById('status-' + id);
  el.className = 'status-chip ' + type;
  el.textContent = label;
}
function setText(id, text) { document.getElementById('text-' + id).textContent = text; }
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// ── Build system prompt with memory ──────────────────────────────────────────
async function buildSystemPrompt(basePrompt) {
  const profileCtx = getProfileContext();
  const docsCtx    = getDocsContext();
  const historyCtx = await getRecentHistoryContext();
  return basePrompt + profileCtx + docsCtx + historyCtx;
}

// ── Settings panel — solo prompts, sin API keys ───────────────────────────────
// (Las API keys ya no se gestionan desde el frontend)

// ── Main ──────────────────────────────────────────────────────────────────────
async function runArena() {
  const question = document.getElementById('user-question').value.trim();
  if (!question) { alert('Escribe una pregunta primero.'); return; }

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

  const baseGPT    = localStorage.getItem('llm-sys-gpt')    || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  const baseGemini = localStorage.getItem('llm-sys-gemini') || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  const baseClaude = localStorage.getItem('llm-sys-claude') || 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';

  const [sysGPT, sysGemini, sysClaude] = await Promise.all([
    buildSystemPrompt(baseGPT),
    buildSystemPrompt(baseGemini),
    buildSystemPrompt(baseClaude)
  ]);
  setProgress(15);

  const results = { gpt: null, gemini: null, claude: null };

  await Promise.all([
    callProxy('gpt', sysGPT, question)
      .then(r => { results.gpt = r; setText('gpt', r); setStatus('gpt', 'done', 'Listo'); setProgress(45); })
      .catch(e => { setText('gpt', 'Error: ' + e.message); setStatus('gpt', 'error', 'Error'); }),
    callProxy('gemini', sysGemini, question)
      .then(r => { results.gemini = r; setText('gemini', r); setStatus('gemini', 'done', 'Listo'); setProgress(65); })
      .catch(e => { setText('gemini', 'Error: ' + e.message); setStatus('gemini', 'error', 'Error'); }),
    callProxy('claude', sysClaude, question)
      .then(r => { results.claude = r; setText('claude', r); setStatus('claude', 'done', 'Listo'); setProgress(80); })
      .catch(e => { setText('claude', 'Error: ' + e.message); setStatus('claude', 'error', 'Error'); })
  ]);

  setProgress(82);
  const available = Object.values(results).filter(Boolean);
  let arbiterText = '';

  if (available.length < 2) {
    arbiterText = 'No hay suficientes respuestas para comparar.';
    document.getElementById('arbiter-text').textContent = arbiterText;
  } else {
    document.getElementById('arbiter-text').textContent = 'Analizando respuestas...';
    const arbiterPrompt = `Eres un árbitro imparcial. Evalúa brevemente estas tres respuestas y elige la mejor.

Criterios: precisión, claridad, completitud y utilidad práctica.

Pregunta: "${question}"

ChatGPT: ${results.gpt || '[Sin respuesta]'}
Gemini: ${results.gemini || '[Sin respuesta]'}
Claude: ${results.claude || '[Sin respuesta]'}

Formato:
ChatGPT: [evaluación breve]
Gemini: [evaluación breve]
Claude: [evaluación breve]

Ganador: [ChatGPT / Gemini / Claude]
Razón: [explicación]`;

    try {
      arbiterText = await callProxy('claude', 'Eres un árbitro imparcial.', arbiterPrompt);
      document.getElementById('arbiter-text').textContent = arbiterText;
      const match = arbiterText.match(/Ganador:\s*(ChatGPT|Gemini|Claude)/i);
      if (match) {
        const name = match[1].toLowerCase();
        if (name === 'chatgpt') highlightWinner('gpt');
        else if (name === 'gemini') highlightWinner('gemini');
        else if (name === 'claude') highlightWinner('claude');
      }
    } catch(e) {
      arbiterText = 'Error del árbitro: ' + e.message;
      document.getElementById('arbiter-text').textContent = arbiterText;
    }
  }

  await saveToHistory(question, results, arbiterText);
  setProgress(100);
  btn.disabled = false;
  btn.textContent = 'Consultar los tres modelos ↗';
}
window.runArena = runArena;
