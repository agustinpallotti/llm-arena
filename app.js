import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, setDoc, deleteDoc, doc, orderBy, query, updateDoc, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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
const db      = getFirestore(firebaseApp);

// Load Inter font safely after module loads
(function() {
  const l = document.createElement('link');
  l.rel  = 'preconnect'; l.href = 'https://fonts.googleapis.com';
  document.head.appendChild(l);
  const l2 = document.createElement('link');
  l2.rel  = 'stylesheet';
  l2.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
  document.head.appendChild(l2);
})();
const storage = getStorage(firebaseApp);
const auth    = getAuth(firebaseApp);
const ALLOWED_EMAIL = 'agustin@agustinpallotti.com'; // set to your email to restrict, or null to allow any Google account
const provider      = new GoogleAuthProvider();

let SESSION_TOKEN   = sessionStorage.getItem('llm-arena-token') || null;

// ── Default voice ─────────────────────────────────────────────────────────────
const DEFAULT_VOICE = `INSTRUCCIONES DE VOZ (obligatorias, siempre):
- Responde de forma directa y concisa. Ve al punto inmediatamente.
- Tutea siempre al usuario. Nunca uses "usted".
- Usa el mismo idioma en que te escriban.
- Nunca empieces con "¡Claro!", "Por supuesto", "Entendido", "Excelente" ni frases similares.
- Sin introducciones innecesarias. Sin frases de relleno.
- Habla como un colega experto, no como un asistente servicial.
- Si la respuesta es corta, que sea corta. No la inflés.`;

// Listen for auth state
onAuthStateChanged(auth, async (user) => {
   if (user && !user.isAnonymous && user.email === ALLOWED_EMAIL) {
    // Verified Google user
    SESSION_TOKEN = await user.getIdToken();
    sessionStorage.setItem('llm-arena-token', SESSION_TOKEN);
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    // Show user avatar in sidebar
    updateUserBadge(user);
    loadSettings(); loadHistory(); loadProfile(); loadDocuments(); loadStoredFiles();
    loadModelStats(); loadAutoProfile();
    updateGreeting();
    if (!window._greetingInterval) {
      window._greetingInterval = setInterval(updateGreeting, 60000);
    }
  }
});
let currentThreadId = null;
let currentThread   = [];
let currentFileData = null;
let modelStats      = {};   // { gpt: { byCategory: { code: {success:3, fallback:1} } } }
let queryCount      = 0;    // track when to run style analysis
let lastCategory    = null; // category Lupa detected for current query
let lastResults     = {};  // stores all 3 results after asking others
let chosenModel     = null; // model Lupa chose

// ── Learning System ───────────────────────────────────────────────────────────
async function loadModelStats() {
  try {
    const snap = await getDoc(doc(db, 'user', 'modelStats'));
    if (snap.exists()) modelStats = snap.data() || {};
  } catch(e) { console.error(e); }
}

async function saveModelStats() {
  try {
    await setDoc(doc(db, 'user', 'modelStats'), modelStats);
  } catch(e) { console.error(e); }
}

function recordModelSuccess(model, category) {
  if (!model || !category) return;
  if (!modelStats[model]) modelStats[model] = { byCategory: {} };
  if (!modelStats[model].byCategory) modelStats[model].byCategory = {};
  if (!modelStats[model].byCategory[category]) modelStats[model].byCategory[category] = { success: 0, fallback: 0 };
  modelStats[model].byCategory[category].success++;
  saveModelStats();
}

function recordModelFallback(model, category) {
  // Called when user asks for "other opinions" — signal chosen model wasn't enough
  if (!model || !category) return;
  if (!modelStats[model]) modelStats[model] = { byCategory: {} };
  if (!modelStats[model].byCategory) modelStats[model].byCategory = {};
  if (!modelStats[model].byCategory[category]) modelStats[model].byCategory[category] = { success: 0, fallback: 0 };
  modelStats[model].byCategory[category].fallback++;
  saveModelStats();
}

async function maybeAnalyzeStyle() {
  // Run style analysis every 10 queries silently
  queryCount++;
  if (queryCount % 10 !== 0) return;
  try {
    const q    = query(collection(db, 'threads'), orderBy('updatedAt', 'desc'), limit(40));
    const snap = await getDocs(q);
    const questions = [];
    snap.forEach(d => {
      const turns = d.data().turns || [];
      turns.forEach(t => { if (t.question) questions.push(t.question); });
    });
    if (questions.length < 5) return;
    const recent = questions.slice(0, 20);
    const data   = await callProxy({ action: 'analyze-style', recentQuestions: recent });
    if (!data) return;
    // Silently update profile auto-fields in Firebase
    const snap2 = await getDoc(doc(db, 'user', 'profile'));
    const existing = snap2.exists() ? snap2.data() : {};
    await setDoc(doc(db, 'user', 'profile'), {
      ...existing,
      autoTopics: data.topics || '',
      autoStyle:  data.style  || '',
      autoInterests: (data.interests || []).join(', '),
      autoUpdatedAt: new Date()
    });
  } catch(e) { console.error('Style analysis error:', e); }
}

function getAutoProfileContext() {
  // This will be loaded from Firebase on startup
  return window._autoProfile || '';
}

async function loadAutoProfile() {
  try {
    const snap = await getDoc(doc(db, 'user', 'profile'));
    if (snap.exists()) {
      const p = snap.data();
      if (p.autoTopics || p.autoStyle) {
        window._autoProfile = '\n\n--- PERFIL APRENDIDO AUTOMÁTICAMENTE ---\n' +
          (p.autoTopics ? `Temas frecuentes del usuario: ${p.autoTopics}\n` : '') +
          (p.autoStyle  ? `Estilo detectado: ${p.autoStyle}\n` : '') +
          (p.autoInterests ? `Intereses detectados: ${p.autoInterests}\n` : '') +
          '--- FIN PERFIL AUTO ---\n';
      }
    }
  } catch(e) { console.error(e); }
}

// showApp() merged into onAuthStateChanged
// ── Google SSO ────────────────────────────────────────────────────────────────
async function signInWithGoogle() {
  const btn = document.getElementById('google-signin-btn') || document.getElementById('google-btn');
  btn.disabled    = true;
  btn.textContent = 'Conectando...';
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged handles the rest
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continuar con Google`;
    document.getElementById('login-error').classList.remove('hidden');
    console.error('Google sign-in error:', e.code, e.message);
  }
}
window.signInWithGoogle = signInWithGoogle;

async function signOut() {
  try {
    await auth.signOut();
    sessionStorage.clear();
    SESSION_TOKEN = null;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    const btn = document.getElementById('google-signin-btn') || document.getElementById('google-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continuar con Google`;
    }
  } catch(e) { console.error('Sign out error:', e); }
}
window.signOut = signOut;

function updateUserBadge(user) {
  const badge = document.getElementById('user-badge');
  if (!badge) return;
  if (user.photoURL) {
    badge.innerHTML = `<img src="${user.photoURL}" class="user-avatar" title="${user.displayName||user.email}" />`;
  } else {
    badge.textContent = (user.displayName||user.email||'U').charAt(0).toUpperCase();
  }
}

// Refresh token every 45 min
setInterval(async () => {
  const user = auth.currentUser;
  if (user) {
    SESSION_TOKEN = await user.getIdToken(true);
    sessionStorage.setItem('llm-arena-token', SESSION_TOKEN);
  }
}, 45 * 60 * 1000);

// ── Proxy ─────────────────────────────────────────────────────────────────────
async function callProxy(body) {
  // Always get a fresh token before calling the proxy
  try {
    const user = auth.currentUser;
    if (user) {
      SESSION_TOKEN = await user.getIdToken(false); // false = only refresh if expired
      sessionStorage.setItem('llm-arena-token', SESSION_TOKEN);
    }
  } catch(e) { console.warn('Token refresh warning:', e); }

  const res = await fetch('/api/query', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Session-Token':SESSION_TOKEN},
    body:JSON.stringify(body)
  });

  // If 401, try once more with a forced fresh token
  if (res.status === 401) {
    try {
      const user = auth.currentUser;
      if (user) {
        SESSION_TOKEN = await user.getIdToken(true); // force refresh
        sessionStorage.setItem('llm-arena-token', SESSION_TOKEN);
        const retry = await fetch('/api/query', {
          method:'POST',
          headers:{'Content-Type':'application/json','X-Session-Token':SESSION_TOKEN},
          body:JSON.stringify(body)
        });
        const retryData = await retry.json();
        if (retryData.error) throw new Error(retryData.error);
        return retryData;
      }
    } catch(e) { console.error('Token retry failed:', e); }
    sessionStorage.clear();
    location.reload();
    throw new Error('Sesión expirada.');
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  ['history','profile','docs','files'].forEach(t => {
    const tabEl = document.getElementById('tab-'+t);
    const panelEl = document.getElementById('panel-'+t);
    if (tabEl)   tabEl.classList.toggle('active', t===tab);
    if (panelEl) panelEl.classList.toggle('hidden', t!==tab);
  });
};

// Dynamic greeting
function updateGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const el = document.getElementById('sidebar-greeting');
  if (el) el.textContent = `${greeting}, Agustín`;
}

// ── Settings ──────────────────────────────────────────────────────────────────
function saveSettings() {
  localStorage.setItem('llm-sys-gpt',    document.getElementById('sys-gpt').value);
  localStorage.setItem('llm-sys-gemini', document.getElementById('sys-gemini').value);
  localStorage.setItem('llm-sys-claude', document.getElementById('sys-claude').value);
  toggleSettings();
}
function loadSettings() {
  const def = 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  document.getElementById('sys-gpt').value    = localStorage.getItem('llm-sys-gpt')    || def;
  document.getElementById('sys-gemini').value = localStorage.getItem('llm-sys-gemini') || def;
  document.getElementById('sys-claude').value = localStorage.getItem('llm-sys-claude') || def;
}
function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderDashboard();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  renderModelStats();
  renderTopics();
}

function renderModelStats() {
  const el = document.getElementById('dash-models');
  if (!el) return;

  const entries = [];
  for (const [model, data] of Object.entries(modelStats)) {
    if (!data.byCategory) continue;
    for (const [cat, stats] of Object.entries(data.byCategory)) {
      const total   = (stats.success || 0) + (stats.fallback || 0);
      const pct     = total > 0 ? Math.round((stats.success || 0) / total * 100) : 0;
      entries.push({ model, cat, total, pct });
    }
  }

  if (!entries.length) {
    el.innerHTML = '<p class="dash-empty">Aún no hay suficientes datos. Sigue usando Lupa.</p>';
    return;
  }

  // Group by category, pick best model per category
  const byCategory = {};
  entries.forEach(e => {
    if (!byCategory[e.cat] || e.pct > byCategory[e.cat].pct) {
      byCategory[e.cat] = e;
    }
  });

  const modelColors = { gpt: '#10a37f', gemini: '#4285F4', claude: '#c9824a' };
  const modelNames  = { gpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' };

  el.innerHTML = Object.entries(byCategory).map(([cat, e]) => `
    <div class="dash-row">
      <span class="dash-cat">${cat}</span>
      <div class="dash-bar-wrap">
        <div class="dash-bar" style="width:${e.pct}%;background:${modelColors[e.model]||'#888'}"></div>
      </div>
      <span class="dash-model-label" style="color:${modelColors[e.model]||'#888'}">${modelNames[e.model]||e.model} ${e.pct}%</span>
    </div>
  `).join('');
}

function renderTopics() {
  const el = document.getElementById('dash-topics');
  if (!el) return;

  const autoProfile = window._autoProfile || '';
  const topics = document.getElementById('profile-topics')?.value?.trim();
  const autoTopics = autoProfile.match(/Temas frecuentes[^:]*: ([^\n]+)/)?.[1] || '';
  const autoInterests = autoProfile.match(/Intereses detectados: ([^\n]+)/)?.[1] || '';

  const all = [topics, autoTopics, autoInterests].filter(Boolean).join(', ');
  if (!all) {
    el.innerHTML = '<p class="dash-empty">Aún no hay datos. Lupa analiza tus temas cada 10 consultas.</p>';
    return;
  }

  const chips = [...new Set(all.split(/[,،]+/).map(t => t.trim()).filter(t => t.length > 1))];
  el.innerHTML = chips.map(t => `<span class="dash-chip">${t}</span>`).join('');
}
window.saveSettings   = saveSettings;
window.toggleSettings = toggleSettings;

// ── Model helpers ─────────────────────────────────────────────────────────────
const MODEL_META = {
  gpt:    { name:'ChatGPT',  dotClass:'gpt'    },
  gemini: { name:'Gemini',   dotClass:'gemini' },
  claude: { name:'Claude',   dotClass:'claude' }
};
const MODEL_NAMES  = { gpt:'ChatGPT', gemini:'Gemini', claude:'Claude' };
const MODEL_COLORS = { gpt:'#10a37f', gemini:'#4285F4', claude:'#c9824a' };

function otherModels(chosen) {
  return ['gpt','gemini','claude'].filter(m => m !== chosen);
}

// ── Lupa: decide which model to use ──────────────────────────────────────────
async function lupaDecide(question) {
  const hasImage = !!(currentFileData && currentFileData.type === 'image');
  const data     = await callProxy({ action:'detect', question, modelStats, hasImage });
  const primary  = data.models[0] || 'claude';
  lastCategory   = data.category || 'general';
  return primary;
}

// ── Thread / Conversation context ─────────────────────────────────────────────
function buildConversationContext(thread) {
  if (!thread || !thread.length) return '';
  let ctx = '\n\n--- CONVERSACIÓN ANTERIOR ---\n';
  thread.forEach((turn, i) => {
    ctx += `\nTurno ${i+1}:\nUsuario: ${turn.question}\n`;
    const winnerResponse = turn[turn.winner];
    if (winnerResponse) ctx += `Respuesta (${MODEL_META[turn.winner]?.name||turn.winner}): ${winnerResponse}\n`;
  });
  return ctx + '--- FIN CONVERSACIÓN ---\n';
}

// ── History ───────────────────────────────────────────────────────────────────
async function saveThread(question, results, chosenModel, modelsUsed, fileName) {
  const turn = {
    question, winner: chosenModel, modelsUsed, fileName: fileName||null,
    gpt: results.gpt||null, gemini: results.gemini||null, claude: results.claude||null,
    createdAt: new Date()
  };
  if (currentThreadId) {
    const threadRef  = doc(db, 'threads', currentThreadId);
    const threadSnap = await getDoc(threadRef);
    if (threadSnap.exists()) {
      const turns = [...(threadSnap.data().turns||[]), turn];
      await updateDoc(threadRef, { turns, updatedAt: new Date() });
      currentThread = turns;
    }
  } else {
    const threadRef = await addDoc(collection(db, 'threads'), {
      title: question.substring(0,60), turns:[turn],
      createdAt: new Date(), updatedAt: new Date()
    });
    currentThreadId = threadRef.id;
    currentThread   = [turn];
  }
  loadHistory();
}

async function loadHistory() {
  try {
    const q    = query(collection(db, 'threads'), orderBy('updatedAt', 'desc'), limit(40));
    const snap = await getDocs(q);
    const list  = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    list.innerHTML = '';
    if (snap.empty) { list.appendChild(empty); empty.classList.remove('hidden'); return; }
    snap.forEach(docSnap => {
      const data    = docSnap.data();
      const turns   = data.turns||[];
      const btn     = document.createElement('button');
      btn.className = 'history-item';
      const date    = data.updatedAt?.toDate?.() || new Date();
      const dateStr = date.toLocaleDateString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      const turnCount = turns.length > 1 ? `<span class="thread-count">${turns.length} turnos</span>` : '';
      btn.innerHTML = `
        <span class="history-item-q">${escapeHtml(data.title||turns[0]?.question||'—')}</span>
        <span class="history-item-date">${dateStr} ${turnCount}</span>`;
      btn.onclick = () => loadThreadItem(docSnap.id, data, btn);
      if (docSnap.id === currentThreadId) btn.classList.add('active');
      list.appendChild(btn);
    });
  } catch(e) { console.error(e); }
}

async function loadThreadItem(threadId, data, btn) {
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentThreadId = threadId;
  currentThread   = data.turns || [];

  // Clear chat and render all turns
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';
  document.getElementById('other-opinions-section').classList.add('hidden');
  document.getElementById('ask-others-btn').classList.remove('hidden');
  document.getElementById('thread-banner').classList.add('hidden');

  currentThread.forEach(turn => {
    const winner = turn.winner || 'claude';
    const turnId = addChatTurn(turn.question, winner, turn[winner] || '[Sin respuesta]', 'done');
    window._currentTurnId = turnId;
  });

  const last = currentThread[currentThread.length - 1];
  if (last) {
    lastResults = { gpt: last.gpt, gemini: last.gemini, claude: last.claude };
    chosenModel = last.winner || 'claude';
  }

  const banner = document.getElementById('thread-banner');
  if (currentThread.length > 1) {
    banner.classList.remove('hidden');
    banner.textContent = `💬 Conversación de ${currentThread.length} turnos`;
  }

  document.getElementById('user-question').focus();
}

window.newQuery = function() {
  currentThreadId = null;
  currentThread   = [];
  lastResults     = {};
  chosenModel     = null;
  window._currentTurnId = null;
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  document.getElementById('user-question').value = '';
  document.getElementById('chat-area').innerHTML = '';
  document.getElementById('progress-bar').classList.add('hidden');
  document.getElementById('detect-status').classList.add('hidden');
  document.getElementById('thread-banner').classList.add('hidden');
  document.getElementById('other-opinions-section').classList.add('hidden');
  document.getElementById('ask-others-btn').classList.add('hidden');
  clearFile();
  setProgress(0);
  document.getElementById('user-question').focus();
};

// setPrimaryCard removed — chat layout uses addChatTurn/updateChatTurn

// ── Ask Others ────────────────────────────────────────────────────────────────
window.askOthers = async function() {
  const question = currentThread.length ? currentThread[currentThread.length-1].question : document.getElementById('user-question').value.trim();
  if (!question) return;
  // Signal: user wasn't satisfied with primary model
  if (chosenModel && lastCategory) recordModelFallback(chosenModel, lastCategory);

  const btn = document.getElementById('ask-others-btn');
  btn.disabled    = true;
  btn.textContent = 'Consultando otros modelos...';

  const others  = otherModels(chosenModel);
  const section = document.getElementById('other-opinions-section');
  const grid    = document.getElementById('other-opinions-grid');
  section.classList.remove('hidden');
  grid.innerHTML = '';

  const def = 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  const sysPrompt = await buildSystemPrompt(localStorage.getItem('llm-sys-gpt') || def);
  const fd = currentFileData;

  const tasks = others.map(async m => {
    // Create card
    const card = document.createElement('div');
    card.className = 'other-card';
    card.id = 'other-card-' + m;
    const color = MODEL_COLORS[m] || '#888';
    const name  = MODEL_NAMES[m]  || m;
    card.innerHTML = `
      <div class="other-card-header">
        <div class="model-label">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;margin-right:4px"></span>
          <span>${name}</span>
        </div>
        <span class="model-status" id="other-status-${m}">Consultando...</span>
      </div>
      <div class="model-response-body" id="other-text-${m}">—</div>`;
    grid.appendChild(card);

    // If we already have the result (from a previous full query), show it
    if (lastResults[m]) {
      document.getElementById('other-text-'+m).innerHTML    = renderMarkdown(lastResults[m]);
      document.getElementById('other-status-'+m).className   = 'model-status done';
      document.getElementById('other-status-'+m).textContent = 'Listo';
      return;
    }

    // Otherwise call the model
    try {
      const sys = localStorage.getItem('llm-sys-'+m) || def;
      const sp  = await buildSystemPrompt(sys);
      const d   = await callProxy({ model:m, systemPrompt:sp, userMsg:question, fileData: m==='gemini' && fd?.text ? {text:fd.text} : fd });
      lastResults[m] = d.result;
      document.getElementById('other-text-'+m).innerHTML    = renderMarkdown(d.result);
      document.getElementById('other-status-'+m).className   = 'model-status done';
      document.getElementById('other-status-'+m).textContent = 'Listo';
    } catch(e) {
      document.getElementById('other-text-'+m).textContent   = 'Error: ' + e.message;
      document.getElementById('other-status-'+m).className   = 'model-status error';
      document.getElementById('other-status-'+m).textContent = 'Error';
    }
  });

  await Promise.all(tasks);
  btn.textContent = 'Otras opiniones cargadas';
};

// ── File Processing ───────────────────────────────────────────────────────────
async function processFile(file) {
  const mimeType = file.type, name = file.name;
  const isImage  = mimeType.startsWith('image/');
  const isPDF    = mimeType === 'application/pdf';
  const isCSV    = mimeType === 'text/csv' || name.endsWith('.csv');
  const isText   = mimeType.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md');
  if (isImage) {
    const base64 = await fileToBase64(file);
    return { type:'image', mimeType, base64:base64.split(',')[1], name };
  }
  if (isPDF) {
    const base64 = await fileToBase64(file);
    const text   = await extractPDFText(file);
    return { type:'document', mimeType, text, name, base64:base64.split(',')[1] };
  }
  if (isCSV || isText) return { type:'document', mimeType, text: await file.text(), name };
  try { return { type:'document', mimeType, text: await file.text(), name }; }
  catch { throw new Error('Tipo de archivo no soportado: '+name); }
}
async function fileToBase64(file) {
  return new Promise((resolve,reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function extractPDFText(file) {
  try {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) return '[PDF cargado]';
    const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
    let text = '';
    for (let i=1; i<=Math.min(pdf.numPages,20); i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item=>item.str).join(' ')+'\n';
    }
    return text.trim()||'[PDF sin texto extraíble]';
  } catch { return '[Error extrayendo PDF]'; }
}
window.handleFileSelect = async function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.getElementById('file-preview');
  const info    = document.getElementById('file-info');
  const saveBtn = document.getElementById('file-save-btn');
  preview.classList.remove('hidden');
  info.textContent = `⏳ Procesando ${file.name}...`;
  saveBtn.classList.add('hidden');
  try {
    currentFileData  = await processFile(file);
    const sizeKB     = (file.size/1024).toFixed(1);
    const typeLabel  = currentFileData.type==='image' ? '🖼️ Imagen' : '📄 Documento';
    info.textContent = `${typeLabel} · ${file.name} · ${sizeKB} KB`;
    if (currentFileData.text) info.textContent += ` · ${currentFileData.text.length.toLocaleString()} caracteres`;
    saveBtn.classList.remove('hidden');
    saveBtn._file = file;
  } catch(e) { info.textContent='❌ Error: '+e.message; currentFileData=null; }
};
window.clearFile = function() {
  currentFileData = null;
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('file-input').value = '';
};

// ── Firebase Storage ──────────────────────────────────────────────────────────
window.saveFileToStorage = async function() {
  const saveBtn = document.getElementById('file-save-btn');
  const file    = saveBtn._file;
  if (!file||!currentFileData) return;
  saveBtn.disabled=true; saveBtn.textContent='Guardando...';
  try {
    const fileName   = `files/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, fileName);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    await addDoc(collection(db,'files'), {
      name:file.name, type:file.type, size:file.size,
      storagePath:fileName, url, text:currentFileData.text||null, createdAt:new Date()
    });
    saveBtn.textContent='✓ Guardado';
    setTimeout(()=>{ saveBtn.disabled=false; saveBtn.textContent='Guardar en Archivos'; },2500);
    loadStoredFiles();
  } catch(e) { saveBtn.textContent='Error'; saveBtn.disabled=false; console.error(e); }
};
async function loadStoredFiles() {
  try {
    const q    = query(collection(db,'files'), orderBy('createdAt','desc'));
    const snap = await getDocs(q);
    const list = document.getElementById('files-list');
    list.innerHTML='';
    if (snap.empty) { list.innerHTML='<p class="history-empty">Sin archivos guardados</p>'; return; }
    snap.forEach(docSnap => {
      const data   = {id:docSnap.id,...docSnap.data()};
      const item   = document.createElement('div');
      item.className='file-item';
      const sizeKB = (data.size/1024).toFixed(1);
      const icon   = data.type?.startsWith('image/')? '🖼️': data.type==='application/pdf'?'📄':data.type?.includes('csv')?'📊':'📝';
      const date   = data.createdAt?.toDate?.()||new Date();
      const dateStr= date.toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
      item.innerHTML=`
        <div class="file-item-header">
          <span class="file-item-icon">${icon}</span>
          <div class="file-item-info">
            <span class="file-item-name">${escapeHtml(data.name)}</span>
            <span class="file-item-meta">${sizeKB} KB · ${dateStr}</span>
          </div>
          <div class="file-item-actions">
            <button class="file-action-btn" onclick="useStoredFile('${docSnap.id}')" title="Usar">↑</button>
            <a class="file-action-btn" href="${data.url}" target="_blank" title="Descargar">↓</a>
            <button class="file-action-btn file-delete" onclick="deleteStoredFile('${docSnap.id}','${data.storagePath}')" title="Eliminar">✕</button>
          </div>
        </div>`;
      list.appendChild(item);
    });
  } catch(e) { console.error(e); }
}
window.useStoredFile = async function(fileId) {
  try {
    const snap = await getDoc(doc(db,'files',fileId));
    if (!snap.exists()) return;
    const data     = snap.data();
    const response = await fetch(data.url);
    const blob     = await response.blob();
    currentFileData = await processFile(new File([blob],data.name,{type:data.type}));
    document.getElementById('file-preview').classList.remove('hidden');
    document.getElementById('file-info').textContent = `📁 ${data.name} (desde Archivos)`;
    document.getElementById('file-save-btn').classList.add('hidden');
    switchTab('history');
    alert(`"${data.name}" listo para tu próxima consulta.`);
  } catch(e) { alert('Error: '+e.message); }
};
window.deleteStoredFile = async function(fileId, storagePath) {
  if (!confirm('¿Eliminar este archivo?')) return;
  try {
    await deleteDoc(doc(db,'files',fileId));
    if (storagePath) await deleteObject(ref(storage,storagePath)).catch(()=>{});
    loadStoredFiles();
  } catch(e) { console.error(e); }
};

// ── Profile ───────────────────────────────────────────────────────────────────
async function saveProfile() {
  const profile = {
    name:    document.getElementById('profile-name').value,
    role:    document.getElementById('profile-role').value,
    context: document.getElementById('profile-context').value,
    style:   document.getElementById('profile-style').value,
    topics:  document.getElementById('profile-topics').value,
    voice:   document.getElementById('profile-voice').value,
  };
  await setDoc(doc(db,'user','profile'), profile);
  const saved = document.getElementById('profile-saved');
  saved.classList.remove('hidden');
  setTimeout(()=>saved.classList.add('hidden'),2500);
}
async function loadProfile() {
  try {
    const snap = await getDoc(doc(db,'user','profile'));
    if (snap.exists()) {
      const p=snap.data();
      document.getElementById('profile-name').value    = p.name    || '';
      document.getElementById('profile-role').value    = p.role    || '';
      document.getElementById('profile-context').value = p.context || '';
      document.getElementById('profile-style').value   = p.style   || '';
      document.getElementById('profile-topics').value  = p.topics  || '';
      document.getElementById('profile-voice').value   = p.voice   || '';
    }
  } catch(e) { console.error(e); }
}
function getProfileContext() {
  const name=document.getElementById('profile-name').value.trim();
  const role=document.getElementById('profile-role').value.trim();
  const context=document.getElementById('profile-context').value.trim();
  const style=document.getElementById('profile-style').value.trim();
  const topics=document.getElementById('profile-topics').value.trim();
  if (!name&&!role&&!context) return '';
  let text='\n\n--- CONTEXTO DEL USUARIO ---\n';
  if (name)    text+=`Nombre: ${name}\n`;
  if (role)    text+=`Rol: ${role}\n`;
  if (context) text+=`Sobre el usuario: ${context}\n`;
  if (style)   text+=`Estilo preferido: ${style}\n`;
  if (topics)  text+=`Temas de interés: ${topics}\n`;
  return text+'--- FIN CONTEXTO ---\n';
}
function getVoicePrompt() {
  const custom = document.getElementById('profile-voice')?.value?.trim();
  if (custom) return '\n\n--- VOZ Y ESTILO (obligatorio) ---\n' + custom + '\n--- FIN VOZ ---\n';
  return '\n\n--- VOZ Y ESTILO (obligatorio) ---\n' + DEFAULT_VOICE + '\n--- FIN VOZ ---\n';
}

window.saveProfile=saveProfile;

// ── Documents ─────────────────────────────────────────────────────────────────
let userDocs=[];
async function addDocument() {
  const title  =document.getElementById('doc-title').value.trim();
  const content=document.getElementById('doc-content').value.trim();
  if (!title||!content) { alert('Escribe un título y el contenido.'); return; }
  await addDoc(collection(db,'documents'),{title,content,createdAt:new Date()});
  document.getElementById('doc-title').value='';
  document.getElementById('doc-content').value='';
  loadDocuments();
}
async function loadDocuments() {
  try {
    const q    = query(collection(db,'documents'),orderBy('createdAt','desc'));
    const snap = await getDocs(q);
    userDocs   = [];
    const list = document.getElementById('docs-list');
    list.innerHTML='';
    snap.forEach(docSnap=>{
      const data={id:docSnap.id,...docSnap.data()};
      userDocs.push(data);
      const item=document.createElement('div');
      item.className='doc-item';
      item.innerHTML=`
        <div class="doc-item-header">
          <span class="doc-item-title">${escapeHtml(data.title)}</span>
          <button class="doc-delete-btn" onclick="deleteDocument('${data.id}')">✕</button>
        </div>
        <p class="doc-item-preview">${escapeHtml(data.content.substring(0,80))}${data.content.length>80?'...':''}</p>`;
      list.appendChild(item);
    });
  } catch(e) { console.error(e); }
}
async function deleteDocument(id) {
  await deleteDoc(doc(db,'documents',id));
  loadDocuments();
}
function getDocsContext() {
  if (!userDocs.length) return '';
  let text='\n\n--- DOCUMENTOS DE REFERENCIA ---\n';
  userDocs.forEach(d=>{ text+=`\n[${d.title}]:\n${d.content}\n`; });
  return text+'--- FIN DOCUMENTOS ---\n';
}
window.addDocument=addDocument;
window.deleteDocument=deleteDocument;

// ── Memory Banner ─────────────────────────────────────────────────────────────
function updateMemoryBanner() {
  // Memory banner removed from new chat layout — no-op
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function setProgress(pct) { document.getElementById('progress-fill').style.width=pct+'%'; }
function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function buildSystemPrompt(basePrompt) {
  return basePrompt + getVoicePrompt() + getProfileContext() + getAutoProfileContext() + getDocsContext() + buildConversationContext(currentThread);
}


// ── Voice Input & Output ──────────────────────────────────────────────────────
let recognition    = null;
let isListening    = false;
let isSpeaking     = false;
let synth          = window.speechSynthesis;

function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r          = new SR();
  r.lang           = 'es-MX';
  r.continuous     = false;
  r.interimResults = true;

  r.onstart = () => {
    isListening = true;
    document.getElementById('mic-btn').classList.add('mic-active');
    document.getElementById('user-question').placeholder = 'Escuchando...';
  };

  r.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    document.getElementById('user-question').value = transcript;
    if (e.results[e.results.length - 1].isFinal) stopListening();
  };

  r.onerror = (e) => {
    console.error('Speech error:', e.error);
    stopListening();
  };

  r.onend = () => stopListening();
  return r;
}

function stopListening() {
  isListening = false;
  const btn = document.getElementById('mic-btn');
  if (btn) btn.classList.remove('mic-active');
  const q = document.getElementById('user-question');
  if (q) q.placeholder = 'Pregúntale a Lupa...';
  if (recognition) recognition.stop();
}

window.toggleVoiceInput = function() {
  // Stop speaking if active
  if (isSpeaking) { stopSpeaking(); return; }

  if (isListening) {
    stopListening();
    return;
  }

  recognition = initRecognition();
  if (!recognition) {
    alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Safari.');
    return;
  }
  try { recognition.start(); }
  catch(e) { console.error(e); }
};

window.stopSpeaking = function() {
  if (synth) synth.cancel();
  isSpeaking = false;
  document.getElementById('stop-speaking-btn')?.classList.add('hidden');
};

function speakText(text) {
  if (!synth || !text) return;
  synth.cancel();

  // Clean markdown before speaking
  const clean = text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-•]\s/g, '')
    .trim();

  const utterance   = new SpeechSynthesisUtterance(clean);
  utterance.lang    = 'es-MX';
  utterance.rate    = 1.05;
  utterance.pitch   = 1.0;

  // Prefer a Spanish voice if available
  const voices = synth.getVoices();
  const esVoice = voices.find(v => v.lang.startsWith('es') && v.localService) ||
                  voices.find(v => v.lang.startsWith('es'));
  if (esVoice) utterance.voice = esVoice;

  utterance.onstart = () => {
    isSpeaking = true;
    document.getElementById('stop-speaking-btn')?.classList.remove('hidden');
  };
  utterance.onend = () => {
    isSpeaking = false;
    document.getElementById('stop-speaking-btn')?.classList.add('hidden');
  };
  utterance.onerror = () => {
    isSpeaking = false;
    document.getElementById('stop-speaking-btn')?.classList.add('hidden');
  };

  synth.speak(utterance);
}


// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  let t = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  const codeBlocks = [];
  t = t.split('```').map((part, i) => {
    if (i % 2 === 0) return part;
    const nl = part.indexOf('\n');
    const code = nl >= 0 ? part.slice(nl + 1) : part;
    codeBlocks.push(code);
    return '[[CB' + (codeBlocks.length - 1) + ']]';
  }).join('');

  // Headers
  t = t.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  t = t.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  t = t.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold and italic
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^\*\n]+?)\*/g, '<em>$1</em>');

  // Inline code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Blockquote
  t = t.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // HR
  t = t.replace(/^---+$/gm, '<hr>');

  // Tables — simple line-by-line approach
  const tableLines = [];
  let inTable = false;
  const outputLines = [];
  t.split('\n').forEach(line => {
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (!inTable) { inTable = true; tableLines.length = 0; }
      tableLines.push(line);
    } else {
      if (inTable) {
        inTable = false;
        const rows = tableLines.filter(r => !/^\s*\|[-\s|:]+\|\s*$/.test(r));
        if (rows.length > 0) {
          let html = '<table>';
          rows.forEach((row, i) => {
            const tag = i === 0 ? 'th' : 'td';
            const cells = row.split('|').slice(1, -1).map(c => c.trim());
            html += '<tr>' + cells.map(c => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>';
          });
          html += '</table>';
          outputLines.push(html);
        }
        tableLines.length = 0;
      }
      outputLines.push(line);
    }
  });
  if (inTable && tableLines.length > 0) {
    const rows = tableLines.filter(r => !/^\s*\|[-\s|:]+\|\s*$/.test(r));
    let html = '<table>';
    rows.forEach((row, i) => {
      const tag = i === 0 ? 'th' : 'td';
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      html += '<tr>' + cells.map(c => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>';
    });
    html += '</table>';
    outputLines.push(html);
  }
  t = outputLines.join('\n');

  // Lists
  t = t.replace(/^[ \t]*[\*\-] (.+)$/gm, '<li>$1</li>');
  t = t.replace(/^[ \t]*\d+\.[ \t]+(.+)$/gm, '<li>$1</li>');
  t = t.replace(/((<li>[^\n]*<\/li>\n?)+)/gm, '<ul>$1</ul>');

  // Paragraphs
  const blocks = t.split(/\n\n+/);
  t = blocks.map(b => {
    b = b.trim();
    if (!b) return '';
    if (/^<(h[1-6]|ul|ol|table|pre|hr|blockquote)/.test(b)) return b;
    if (b.startsWith('[[CB')) return b;
    return '<p>' + b.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // Restore code blocks
  t = t.replace(/\[\[CB(\d+)\]\]/g, function(_, i) {
    return '<pre><code>' + codeBlocks[parseInt(i)] + '</code></pre>';
  });

  return t;
}

// ── Chat turn helpers ─────────────────────────────────────────────────────────
function addChatTurn(question, model, responseText, statusType) {
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return 'turn-0';
  const turnId = 'turn-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
  const turn   = document.createElement('div');
  turn.className = 'chat-turn';
  turn.id = turnId;
  const color = MODEL_COLORS[model] || '#888';
  const name  = MODEL_NAMES[model]  || model;
  turn.innerHTML = `
    <div class="user-bubble-wrap">
      <div class="user-bubble">${escapeHtml(question)}</div>
    </div>
    <div class="model-response">
      <div class="model-response-header">
        <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;margin-right:4px;flex-shrink:0"></span>
        <span class="model-response-name">${name}</span>
        <span class="model-badge">Elegido por Lupa</span>
        <span class="model-status ${statusType}" id="mstatus-${turnId}">${statusType==='done'?'Listo':statusType==='error'?'Error':'...'}</span>
      </div>
      <div class="model-response-body" id="mbody-${turnId}">${responseText ? renderMarkdown(responseText) : '<span style="color:var(--muted);font-style:italic">Pensando...</span>'}</div>
    </div>`;
  chatArea.appendChild(turn);
  chatArea.scrollTop = chatArea.scrollHeight;
  return turnId;
}

function updateChatTurn(turnId, responseText, statusType) {
  const body   = document.getElementById('mbody-'   + turnId);
  const status = document.getElementById('mstatus-' + turnId);
  if (body)   body.innerHTML   = renderMarkdown(responseText);
  if (status) { status.textContent = statusType==='done'?'Listo':'Error'; status.className = 'model-status ' + statusType; }
  const chatArea = document.getElementById('chat-area');
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runArena() {
  const question = document.getElementById('user-question').value.trim();
  if (!question) { alert('Escribe una pregunta primero.'); return; }

  const btn = document.getElementById('send-btn');
  btn.disabled=true;
  btn.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.4"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  // results div removed in chat layout
  document.getElementById('progress-bar').classList.remove('hidden');
  document.getElementById('other-opinions-section').classList.add('hidden');
  document.getElementById('ask-others-btn').classList.remove('hidden');
  document.getElementById('ask-others-btn').disabled=false;
  document.getElementById('ask-others-btn').textContent='Pedir otras opiniones';
  lastResults = {};
  setProgress(10);

  // Step 1: Lupa decides
  const detectStatus = document.getElementById('detect-status');
  detectStatus.textContent='🔍 Lupa está eligiendo el mejor modelo...';
  detectStatus.classList.remove('hidden');

  let primary='claude';
  try {
    primary    = await lupaDecide(question);
    chosenModel = primary;
  } catch { chosenModel=primary='claude'; }

  detectStatus.classList.add('hidden');
  setProgress(30);

  // Step 2: Create chat turn placeholder
  document.getElementById('user-question').value = '';
  const currentTurnId = addChatTurn(question, primary, '', '');
  window._currentTurnId = currentTurnId;

  // Step 3: Call chosen model
  const def = 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  const sys  = localStorage.getItem('llm-sys-'+primary)||def;
  const sp   = await buildSystemPrompt(sys);
  const fd   = currentFileData;

  try {
    const d = await callProxy({
      model: primary, systemPrompt: sp, userMsg: question,
      fileData: primary==='gemini'&&fd?.text ? {text:fd.text} : fd
    });
    lastResults[primary] = d.result;
    updateChatTurn(window._currentTurnId, d.result, 'done');
    setProgress(90);
  } catch(e) {
    updateChatTurn(window._currentTurnId, 'Error: ' + e.message, 'error');
    setProgress(90);
  }

  // Save thread
  await saveThread(question, lastResults, primary, [primary], fd?.name||null);
  setProgress(100);

  // Record success (user didn't immediately ask for others = good signal)
  setTimeout(() => {
    if (chosenModel && lastCategory) recordModelSuccess(chosenModel, lastCategory);
    maybeAnalyzeStyle();
  }, 8000); // wait 8s — if they ask for others within this time we cancel

  btn.disabled=false;
  btn.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  document.getElementById('user-question').value='';
  document.getElementById('user-question').focus();

  const banner=document.getElementById('thread-banner');
  if (currentThread.length>1) {
    banner.classList.remove('hidden');
    banner.textContent=`💬 Conversación de ${currentThread.length} turnos`;
  }
}
window.runArena=runArena;

// ── Quick Actions ─────────────────────────────────────────────────────────────
window.toggleQuickActions = function() {
  const menu = document.getElementById('quick-actions-menu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    setTimeout(() => {
      document.addEventListener('click', function closeQA(e) {
        const wrap = document.querySelector('.quick-actions-wrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.classList.add('hidden');
        }
        document.removeEventListener('click', closeQA);
      });
    }, 50);
  }
};

window.applyQuickAction = function(prefix) {
  const textarea = document.getElementById('user-question');
  const current  = textarea.value.trim();
  textarea.value  = current ? prefix + '\n\n' + current : prefix + '\n\n';
  document.getElementById('quick-actions-menu').classList.add('hidden');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
};
