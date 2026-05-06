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

let SESSION_TOKEN = sessionStorage.getItem('llm-arena-token') || null;

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkLogin() {
  const password = document.getElementById('login-input').value;
  if (!password) return;
  try {
    const res  = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
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
    document.getElementById('login-error').textContent = 'Error de conexión.';
    document.getElementById('login-error').classList.remove('hidden');
  }
}
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadSettings(); loadHistory(); loadProfile(); loadDocuments();
}
window.checkLogin = checkLogin;
window.addEventListener('DOMContentLoaded', () => { if (SESSION_TOKEN) showApp(); });

// ── Proxy caller ──────────────────────────────────────────────────────────────
async function callProxy(body) {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': SESSION_TOKEN },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { sessionStorage.clear(); location.reload(); throw new Error('Sesión expirada.'); }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
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
window.saveSettings = saveSettings;
window.toggleSettings = toggleSettings;

// ── Model Toggles ─────────────────────────────────────────────────────────────
const activeModels = { gpt: true, gemini: true, claude: true };

window.toggleModel = function(model) {
  const enabled = Object.values(activeModels).filter(Boolean).length;
  if (activeModels[model] && enabled <= 2) {
    alert('Debes tener al menos 2 modelos activos para poder comparar.');
    // Re-check the toggle visually
    document.getElementById('toggle-' + model).checked = true;
    return;
  }
  activeModels[model] = !activeModels[model];
  updateModelToggles();
};

function updateModelToggles() {
  ['gpt','gemini','claude'].forEach(m => {
    const card = document.getElementById('card-' + m);
    const toggle = document.getElementById('toggle-' + m);
    if (card)   card.classList.toggle('model-disabled', !activeModels[m]);
    if (toggle) toggle.checked = activeModels[m];
  });
}

async function autoDetectModels(question) {
  try {
    document.getElementById('detect-status').textContent = '🔍 Analizando pregunta...';
    document.getElementById('detect-status').classList.remove('hidden');
    const data = await callProxy({ action: 'detect', question });
    // Apply detected models
    ['gpt','gemini','claude'].forEach(m => { activeModels[m] = data.models.includes(m); });
    updateModelToggles();
    document.getElementById('detect-reason').textContent = data.reason || '';
    document.getElementById('detect-reason').classList.remove('hidden');
    document.getElementById('detect-status').classList.add('hidden');
  } catch(e) {
    document.getElementById('detect-status').classList.add('hidden');
  }
}

// ── Profile ───────────────────────────────────────────────────────────────────
async function saveProfile() {
  const profile = {
    name: document.getElementById('profile-name').value,
    role: document.getElementById('profile-role').value,
    context: document.getElementById('profile-context').value,
    style: document.getElementById('profile-style').value,
    topics: document.getElementById('profile-topics').value,
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
  } catch(e) { console.error(e); }
}
function getProfileContext() {
  const name = document.getElementById('profile-name').value.trim();
  const role = document.getElementById('profile-role').value.trim();
  const context = document.getElementById('profile-context').value.trim();
  const style = document.getElementById('profile-style').value.trim();
  const topics = document.getElementById('profile-topics').value.trim();
  if (!name && !role && !context) return '';
  let text = '\n\n--- CONTEXTO DEL USUARIO ---\n';
  if (name)    text += `Nombre: ${name}\n`;
  if (role)    text += `Rol: ${role}\n`;
  if (context) text += `Sobre el usuario: ${context}\n`;
  if (style)   text += `Estilo preferido: ${style}\n`;
  if (topics)  text += `Temas de interés: ${topics}\n`;
  return text + '--- FIN CONTEXTO ---\n';
}
window.saveProfile = saveProfile;

// ── Documents ─────────────────────────────────────────────────────────────────
let userDocs = [];
async function addDocument() {
  const title   = document.getElementById('doc-title').value.trim();
  const content = document.getElementById('doc-content').value.trim();
  if (!title || !content) { alert('Escribe un título y el contenido.'); return; }
  await addDoc(collection(db, 'documents'), { title, content, createdAt: new Date() });
  document.getElementById('doc-title').value = '';
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
  } catch(e) { console.error(e); }
}
async function deleteDocument(id) {
  await deleteDoc(doc(db, 'documents', id));
  loadDocuments();
}
function getDocsContext() {
  if (!userDocs.length) return '';
  let text = '\n\n--- DOCUMENTOS DE REFERENCIA ---\n';
  userDocs.forEach(d => { text += `\n[${d.title}]:\n${d.content}\n`; });
  return text + '--- FIN DOCUMENTOS ---\n';
}
window.addDocument    = addDocument;
window.deleteDocument = deleteDocument;

// ── Memory Banner ─────────────────────────────────────────────────────────────
function updateMemoryBanner() {
  const hasProfile = document.getElementById('profile-name').value.trim() || document.getElementById('profile-context').value.trim();
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
async function saveToHistory(question, results, arbiterText, modelsUsed) {
  try {
    await addDoc(collection(db, 'history'), {
      question, arbiter: arbiterText, modelsUsed,
      gpt: results.gpt || null, gemini: results.gemini || null, claude: results.claude || null,
      createdAt: new Date()
    });
    loadHistory();
  } catch(e) { console.error(e); }
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
      const data   = docSnap.data();
      const btn    = document.createElement('button');
      btn.className = 'history-item';
      const date   = data.createdAt?.toDate?.() || new Date();
      const dateStr = date.toLocaleDateString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      btn.innerHTML = `<span class="history-item-q">${escapeHtml(data.question)}</span><span class="history-item-date">${dateStr}</span>`;
      btn.onclick = () => loadHistoryItem(data, btn);
      list.appendChild(btn);
    });
  } catch(e) { console.error(e); }
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
    return text + '--- FIN HISTORIAL ---\n';
  } catch { return ''; }
}
function loadHistoryItem(data, btn) {
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('user-question').value = data.question;
  ['gpt','gemini','claude'].forEach(m => {
    setText(m, data[m] || '[No consultado]');
    setStatus(m, data[m] ? 'done' : 'error', data[m] ? 'Listo' : 'No usado');
  });
  document.getElementById('arbiter-text').textContent = data.arbiter || '—';
  document.getElementById('results').classList.remove('hidden');
  // Restore which models were used
  if (data.modelsUsed) {
    ['gpt','gemini','claude'].forEach(m => { activeModels[m] = data.modelsUsed.includes(m); });
    updateModelToggles();
  }
}
window.newQuery = function() {
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  document.getElementById('user-question').value = '';
  document.getElementById('results').classList.add('hidden');
  document.getElementById('progress-bar').classList.add('hidden');
  document.getElementById('detect-reason').classList.add('hidden');
  ['gpt','gemini','claude'].forEach(m => { activeModels[m] = true; });
  updateModelToggles();
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
function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function highlightWinner(id) {
  ['gpt','gemini','claude'].forEach(m => {
    document.getElementById('card-' + m).classList.remove('winner');
    const b = document.getElementById('card-' + m).querySelector('.winner-badge');
    if (b) b.remove();
  });
  const card = document.getElementById('card-' + id);
  if (!card) return;
  card.classList.add('winner');
  const badge = document.createElement('span');
  badge.className = 'winner-badge';
  badge.textContent = 'Ganador';
  card.querySelector('.result-card-header').appendChild(badge);
}

async function buildSystemPrompt(basePrompt) {
  const profileCtx = getProfileContext();
  const docsCtx    = getDocsContext();
  const historyCtx = await getRecentHistoryContext();
  return basePrompt + profileCtx + docsCtx + historyCtx;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runArena() {
  const question = document.getElementById('user-question').value.trim();
  if (!question) { alert('Escribe una pregunta primero.'); return; }

  const modelsToRun = Object.entries(activeModels).filter(([,v]) => v).map(([k]) => k);
  if (modelsToRun.length < 2) { alert('Activa al menos 2 modelos.'); return; }

  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  btn.textContent = 'Consultando...';
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('progress-bar').classList.remove('hidden');
  document.getElementById('detect-reason').classList.add('hidden');
  setProgress(5);

  ['gpt','gemini','claude'].forEach(m => {
    const card = document.getElementById('card-' + m);
    card.classList.remove('winner');
    card.classList.toggle('model-disabled', !activeModels[m]);
    const b = card.querySelector('.winner-badge');
    if (b) b.remove();
    if (activeModels[m]) {
      setStatus(m, '', 'Consultando...');
      setText(m, '—');
    } else {
      setStatus(m, 'skipped', 'No usado');
      setText(m, 'Modelo no seleccionado para esta consulta.');
    }
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
  setProgress(12);

  const results = { gpt: null, gemini: null, claude: null };
  const tasks = [];

  if (activeModels.gpt)
    tasks.push(callProxy({ model: 'gpt', systemPrompt: sysGPT, userMsg: question })
      .then(d => { results.gpt = d.result; setText('gpt', d.result); setStatus('gpt', 'done', 'Listo'); setProgress(40); })
      .catch(e => { setText('gpt', 'Error: ' + e.message); setStatus('gpt', 'error', 'Error'); }));

  if (activeModels.gemini)
    tasks.push(callProxy({ model: 'gemini', systemPrompt: sysGemini, userMsg: question })
      .then(d => { results.gemini = d.result; setText('gemini', d.result); setStatus('gemini', 'done', 'Listo'); setProgress(60); })
      .catch(e => { setText('gemini', 'Error: ' + e.message); setStatus('gemini', 'error', 'Error'); }));

  if (activeModels.claude)
    tasks.push(callProxy({ model: 'claude', systemPrompt: sysClaude, userMsg: question })
      .then(d => { results.claude = d.result; setText('claude', d.result); setStatus('claude', 'done', 'Listo'); setProgress(75); })
      .catch(e => { setText('claude', 'Error: ' + e.message); setStatus('claude', 'error', 'Error'); }));

  await Promise.all(tasks);
  setProgress(80);

  const available = Object.values(results).filter(Boolean);
  let arbiterText = '';

  if (available.length < 2) {
    arbiterText = 'No hay suficientes respuestas para comparar.';
    document.getElementById('arbiter-text').textContent = arbiterText;
  } else {
    document.getElementById('arbiter-text').textContent = '⚖️ GPT-5.4-mini analizando respuestas...';
    try {
      const d = await callProxy({ action: 'arbiter', question, responses: results });
      arbiterText = d.result;
      document.getElementById('arbiter-text').textContent = arbiterText;
      const match = arbiterText.match(/Ganador:\s*(ChatGPT|Gemini|Claude)/i);
      if (match) {
        const name = match[1].toLowerCase();
        if (name === 'chatgpt') highlightWinner('gpt');
        else highlightWinner(name);
      }
    } catch(e) {
      arbiterText = 'Error del árbitro: ' + e.message;
      document.getElementById('arbiter-text').textContent = arbiterText;
    }
  }

  await saveToHistory(question, results, arbiterText, modelsToRun);
  setProgress(100);
  btn.disabled = false;
  btn.textContent = 'Consultar los modelos ↗';
}
window.runArena = runArena;

// Auto-detect on question input (debounced)
let detectTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const q = document.getElementById('user-question');
  if (q) {
    q.addEventListener('input', () => {
      clearTimeout(detectTimer);
      const val = q.value.trim();
      if (val.length > 20) {
        detectTimer = setTimeout(() => autoDetectModels(val), 1200);
      }
    });
  }
});
