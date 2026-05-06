import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, setDoc, deleteDoc, doc, orderBy, query, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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
const storage = getStorage(firebaseApp);
const auth    = getAuth(firebaseApp);
signInAnonymously(auth).catch(e => console.error('Firebase auth error:', e));

let SESSION_TOKEN   = sessionStorage.getItem('llm-arena-token') || null;
let currentThreadId = null;  // active conversation thread
let currentThread   = [];    // array of turns [{question, winner, gpt, gemini, claude}]
let currentFileData = null;

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkLogin() {
  const password = document.getElementById('login-input').value;
  if (!password) return;
  try {
    const res  = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password}) });
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
  } catch {
    document.getElementById('login-error').textContent = 'Error de conexión.';
    document.getElementById('login-error').classList.remove('hidden');
  }
}
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadSettings(); loadHistory(); loadProfile(); loadDocuments(); loadStoredFiles();
}
window.checkLogin = checkLogin;
window.addEventListener('DOMContentLoaded', () => { if (SESSION_TOKEN) showApp(); });

// ── Proxy ─────────────────────────────────────────────────────────────────────
async function callProxy(body) {
  const res = await fetch('/api/query', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Session-Token':SESSION_TOKEN},
    body:JSON.stringify(body)
  });
  if (res.status === 401) { sessionStorage.clear(); location.reload(); throw new Error('Sesión expirada.'); }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  ['history','profile','docs','files'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
    document.getElementById('panel-'+t).classList.toggle('hidden', t!==tab);
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
  const def = 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  document.getElementById('sys-gpt').value    = localStorage.getItem('llm-sys-gpt')    || def;
  document.getElementById('sys-gemini').value = localStorage.getItem('llm-sys-gemini') || def;
  document.getElementById('sys-claude').value = localStorage.getItem('llm-sys-claude') || def;
}
function toggleSettings() { document.getElementById('settings-panel').classList.toggle('hidden'); }
window.saveSettings   = saveSettings;
window.toggleSettings = toggleSettings;

// ── Thread Management ─────────────────────────────────────────────────────────
function buildConversationContext(thread) {
  if (!thread || !thread.length) return '';
  let ctx = '\n\n--- CONVERSACIÓN ANTERIOR (mantén este contexto) ---\n';
  thread.forEach((turn, i) => {
    ctx += `\nTurno ${i+1}:\nUsuario: ${turn.question}\n`;
    if (turn.winner) {
      const winnerResponse = turn[turn.winner];
      if (winnerResponse) ctx += `Mejor respuesta (${turn.winner}): ${winnerResponse}\n`;
    }
  });
  ctx += '--- FIN CONVERSACIÓN ---\n';
  return ctx;
}

function extractWinnerModel(arbiterText) {
  const match = arbiterText.match(/Ganador:\s*(ChatGPT|Gemini|Claude)/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (name === 'chatgpt') return 'gpt';
  return name;
}

// ── History / Threads ─────────────────────────────────────────────────────────
async function saveThread(question, results, arbiterText, modelsUsed, fileName) {
  const winner = extractWinnerModel(arbiterText);
  const turn   = { question, arbiter: arbiterText, winner, modelsUsed, fileName: fileName||null,
    gpt: results.gpt||null, gemini: results.gemini||null, claude: results.claude||null,
    createdAt: new Date() };

  if (currentThreadId) {
    // Append turn to existing thread
    const threadRef  = doc(db, 'threads', currentThreadId);
    const threadSnap = await getDoc(threadRef);
    if (threadSnap.exists()) {
      const data = threadSnap.data();
      const turns = data.turns || [];
      turns.push(turn);
      await updateDoc(threadRef, { turns, updatedAt: new Date() });
      currentThread = turns;
    }
  } else {
    // Create new thread
    const threadRef = await addDoc(collection(db, 'threads'), {
      title:     question.substring(0, 60),
      turns:     [turn],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    currentThreadId = threadRef.id;
    currentThread   = [turn];
  }
  loadHistory();
}

async function loadHistory() {
  try {
    const q    = query(collection(db, 'threads'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    const list  = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    list.innerHTML = '';
    if (snap.empty) { list.appendChild(empty); empty.classList.remove('hidden'); return; }

    snap.forEach(docSnap => {
      const data    = docSnap.data();
      const turns   = data.turns || [];
      const btn     = document.createElement('button');
      btn.className = 'history-item';
      const date    = data.updatedAt?.toDate?.() || new Date();
      const dateStr = date.toLocaleDateString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      const turnCount = turns.length > 1 ? `<span class="thread-count">${turns.length} turnos</span>` : '';
      const hasFile   = turns.some(t => t.fileName);
      btn.innerHTML = `
        <span class="history-item-q">${escapeHtml(data.title || turns[0]?.question || '—')}${hasFile?' 📎':''}</span>
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

  // Render all turns in the conversation view
  renderThread(currentThread);
}

function renderThread(turns) {
  const resultsEl = document.getElementById('results');
  resultsEl.classList.remove('hidden');

  // Show last turn in the cards
  const last = turns[turns.length - 1];
  if (!last) return;

  document.getElementById('user-question').value = last.question;
  ['gpt','gemini','claude'].forEach(m => {
    setText(m,    last[m] || '[No consultado]');
    setStatus(m,  last[m] ? 'done':'error', last[m] ? 'Listo':'No usado');
    document.getElementById('card-'+m).classList.toggle('model-disabled', !last[m]);
  });
  document.getElementById('arbiter-text').textContent = last.arbiter || '—';

  // Highlight winner
  if (last.winner) highlightWinner(last.winner);

  // Show conversation history banner if multi-turn
  const banner = document.getElementById('thread-banner');
  if (turns.length > 1) {
    banner.classList.remove('hidden');
    banner.textContent = `💬 Conversación de ${turns.length} turnos — continuando hilo`;
  } else {
    banner.classList.add('hidden');
  }

  if (last.modelsUsed) {
    ['gpt','gemini','claude'].forEach(m => { activeModels[m] = last.modelsUsed.includes(m); });
    updateModelToggles();
  }
}

window.newQuery = function() {
  // Start fresh thread
  currentThreadId = null;
  currentThread   = [];
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  document.getElementById('user-question').value = '';
  document.getElementById('results').classList.add('hidden');
  document.getElementById('progress-bar').classList.add('hidden');
  document.getElementById('detect-reason').classList.add('hidden');
  document.getElementById('thread-banner').classList.add('hidden');
  ['gpt','gemini','claude'].forEach(m => { activeModels[m] = true; });
  updateModelToggles();
  clearFile();
  setProgress(0);
  document.getElementById('user-question').focus();
};

// ── File Processing ───────────────────────────────────────────────────────────
async function processFile(file) {
  const mimeType = file.type;
  const name     = file.name;
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
  if (isCSV || isText) {
    const text = await file.text();
    return { type:'document', mimeType, text, name };
  }
  try {
    const text = await file.text();
    return { type:'document', mimeType, text, name };
  } catch { throw new Error('Tipo de archivo no soportado: ' + name); }
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractPDFText(file) {
  try {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) return '[PDF cargado - instala pdf.js para extraer texto]';
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text.trim() || '[PDF sin texto extraíble]';
  } catch { return '[Error extrayendo texto del PDF]'; }
}

window.handleFileSelect = async function(event) {
  const file    = event.target.files[0];
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
    const typeLabel  = currentFileData.type === 'image' ? '🖼️ Imagen' : '📄 Documento';
    info.textContent = `${typeLabel} · ${file.name} · ${sizeKB} KB`;
    if (currentFileData.text) info.textContent += ` · ${currentFileData.text.length.toLocaleString()} caracteres`;
    saveBtn.classList.remove('hidden');
    saveBtn.dataset.filename = file.name;
    saveBtn._file = file;
  } catch(e) {
    info.textContent = '❌ Error: ' + e.message;
    currentFileData  = null;
  }
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
  if (!file || !currentFileData) return;
  saveBtn.disabled    = true;
  saveBtn.textContent = 'Guardando...';
  try {
    const fileName   = `files/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, fileName);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    await addDoc(collection(db, 'files'), {
      name:file.name, type:file.type, size:file.size,
      storagePath:fileName, url, text:currentFileData.text||null, createdAt:new Date()
    });
    saveBtn.textContent = '✓ Guardado';
    setTimeout(() => { saveBtn.disabled=false; saveBtn.textContent='Guardar en Archivos'; }, 2500);
    loadStoredFiles();
  } catch(e) {
    saveBtn.textContent = 'Error al guardar';
    saveBtn.disabled    = false;
    console.error(e);
  }
};

async function loadStoredFiles() {
  try {
    const q    = query(collection(db, 'files'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list = document.getElementById('files-list');
    list.innerHTML = '';
    if (snap.empty) { list.innerHTML='<p class="history-empty">Sin archivos guardados</p>'; return; }
    snap.forEach(docSnap => {
      const data   = { id:docSnap.id, ...docSnap.data() };
      const item   = document.createElement('div');
      item.className = 'file-item';
      const sizeKB = (data.size/1024).toFixed(1);
      const icon   = data.type?.startsWith('image/') ? '🖼️' : data.type==='application/pdf' ? '📄' : data.type?.includes('csv') ? '📊' : '📝';
      const date   = data.createdAt?.toDate?.() || new Date();
      const dateStr= date.toLocaleDateString('es-MX', {day:'2-digit',month:'short'});
      item.innerHTML = `
        <div class="file-item-header">
          <span class="file-item-icon">${icon}</span>
          <div class="file-item-info">
            <span class="file-item-name">${escapeHtml(data.name)}</span>
            <span class="file-item-meta">${sizeKB} KB · ${dateStr}</span>
          </div>
          <div class="file-item-actions">
            <button class="file-action-btn" onclick="useStoredFile('${docSnap.id}')" title="Usar en consulta">↑</button>
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
    const snap = await getDoc(doc(db, 'files', fileId));
    if (!snap.exists()) return;
    const data     = snap.data();
    const response = await fetch(data.url);
    const blob     = await response.blob();
    const file     = new File([blob], data.name, { type:data.type });
    currentFileData = await processFile(file);
    const preview   = document.getElementById('file-preview');
    const info      = document.getElementById('file-info');
    preview.classList.remove('hidden');
    info.textContent = `📁 ${data.name} (desde Archivos)`;
    document.getElementById('file-save-btn').classList.add('hidden');
    switchTab('history');
    alert(`"${data.name}" listo para tu próxima consulta.`);
  } catch(e) { alert('Error cargando archivo: ' + e.message); }
};

window.deleteStoredFile = async function(fileId, storagePath) {
  if (!confirm('¿Eliminar este archivo?')) return;
  try {
    await deleteDoc(doc(db, 'files', fileId));
    if (storagePath) await deleteObject(ref(storage, storagePath)).catch(()=>{});
    loadStoredFiles();
  } catch(e) { console.error(e); }
};

// ── Model Toggles ─────────────────────────────────────────────────────────────
const activeModels = { gpt:true, gemini:true, claude:true };
window.toggleModel = function(model) {
  const enabled = Object.values(activeModels).filter(Boolean).length;
  if (activeModels[model] && enabled <= 2) {
    alert('Debes tener al menos 2 modelos activos.');
    document.getElementById('toggle-'+model).checked = true;
    return;
  }
  activeModels[model] = !activeModels[model];
  updateModelToggles();
};
function updateModelToggles() {
  ['gpt','gemini','claude'].forEach(m => {
    const card   = document.getElementById('card-'+m);
    const toggle = document.getElementById('toggle-'+m);
    if (card)   card.classList.toggle('model-disabled', !activeModels[m]);
    if (toggle) toggle.checked = activeModels[m];
  });
}
async function autoDetectModels(question) {
  try {
    document.getElementById('detect-status').textContent = '🔍 Analizando pregunta...';
    document.getElementById('detect-status').classList.remove('hidden');
    const data = await callProxy({ action:'detect', question });
    ['gpt','gemini','claude'].forEach(m => { activeModels[m] = data.models.includes(m); });
    updateModelToggles();
    document.getElementById('detect-reason').textContent = data.reason || '';
    document.getElementById('detect-reason').classList.remove('hidden');
    document.getElementById('detect-status').classList.add('hidden');
  } catch { document.getElementById('detect-status').classList.add('hidden'); }
}

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
  } catch(e) { console.error(e); }
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
  await addDoc(collection(db, 'documents'), { title, content, createdAt:new Date() });
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
      const data = { id:docSnap.id, ...docSnap.data() };
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

// ── UI Helpers ────────────────────────────────────────────────────────────────
function setProgress(pct) { document.getElementById('progress-fill').style.width = pct+'%'; }
function setStatus(id, type, label) {
  const el = document.getElementById('status-'+id);
  el.className   = 'status-chip '+type;
  el.textContent = label;
}
function setText(id, text) { document.getElementById('text-'+id).textContent = text; }
function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function highlightWinner(id) {
  ['gpt','gemini','claude'].forEach(m => {
    document.getElementById('card-'+m).classList.remove('winner');
    const b = document.getElementById('card-'+m).querySelector('.winner-badge');
    if (b) b.remove();
  });
  const card = document.getElementById('card-'+id);
  if (!card) return;
  card.classList.add('winner');
  const badge = document.createElement('span');
  badge.className   = 'winner-badge';
  badge.textContent = 'Ganador';
  card.querySelector('.result-card-header').appendChild(badge);
}

async function buildSystemPrompt(basePrompt) {
  const convCtx    = buildConversationContext(currentThread);
  const profileCtx = getProfileContext();
  const docsCtx    = getDocsContext();
  return basePrompt + profileCtx + docsCtx + convCtx;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runArena() {
  const question = document.getElementById('user-question').value.trim();
  if (!question) { alert('Escribe una pregunta primero.'); return; }
  const modelsToRun = Object.entries(activeModels).filter(([,v])=>v).map(([k])=>k);
  if (modelsToRun.length < 2) { alert('Activa al menos 2 modelos.'); return; }

  const btn = document.getElementById('send-btn');
  btn.disabled    = true;
  btn.textContent = currentThread.length > 0 ? 'Continuando...' : 'Consultando...';
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('progress-bar').classList.remove('hidden');
  document.getElementById('detect-reason').classList.add('hidden');
  setProgress(5);

  ['gpt','gemini','claude'].forEach(m => {
    const card = document.getElementById('card-'+m);
    card.classList.remove('winner');
    card.classList.toggle('model-disabled', !activeModels[m]);
    const b = card.querySelector('.winner-badge');
    if (b) b.remove();
    if (activeModels[m]) { setStatus(m,'','Consultando...'); setText(m,'—'); }
    else { setStatus(m,'skipped','No usado'); setText(m,'Modelo no seleccionado.'); }
  });
  document.getElementById('arbiter-text').textContent = 'Esperando respuestas...';

  const def = 'Eres un asistente experto. Responde de forma clara, precisa y concisa en español.';
  const [sysGPT, sysGemini, sysClaude] = await Promise.all([
    buildSystemPrompt(localStorage.getItem('llm-sys-gpt')    || def),
    buildSystemPrompt(localStorage.getItem('llm-sys-gemini') || def),
    buildSystemPrompt(localStorage.getItem('llm-sys-claude') || def)
  ]);
  setProgress(12);

  const results = { gpt:null, gemini:null, claude:null };
  const fd      = currentFileData;
  const tasks   = [];

  if (activeModels.gpt)
    tasks.push(callProxy({ model:'gpt', systemPrompt:sysGPT, userMsg:question, fileData:fd })
      .then(d => { results.gpt=d.result; setText('gpt',d.result); setStatus('gpt','done','Listo'); setProgress(40); })
      .catch(e => { setText('gpt','Error: '+e.message); setStatus('gpt','error','Error'); }));

  if (activeModels.gemini)
    tasks.push(callProxy({ model:'gemini', systemPrompt:sysGemini, userMsg:question, fileData:fd?.text?{text:fd.text}:null })
      .then(d => { results.gemini=d.result; setText('gemini',d.result); setStatus('gemini','done','Listo'); setProgress(60); })
      .catch(e => { setText('gemini','Error: '+e.message); setStatus('gemini','error','Error'); }));

  if (activeModels.claude)
    tasks.push(callProxy({ model:'claude', systemPrompt:sysClaude, userMsg:question, fileData:fd })
      .then(d => { results.claude=d.result; setText('claude',d.result); setStatus('claude','done','Listo'); setProgress(75); })
      .catch(e => { setText('claude','Error: '+e.message); setStatus('claude','error','Error'); }));

  await Promise.all(tasks);
  setProgress(80);

  const available = Object.values(results).filter(Boolean);
  let arbiterText = '';
  if (available.length < 2) {
    arbiterText = 'No hay suficientes respuestas para comparar.';
    document.getElementById('arbiter-text').textContent = arbiterText;
  } else {
    document.getElementById('arbiter-text').textContent = '⚖️ GPT-5.4-mini analizando...';
    try {
      const d = await callProxy({ action:'arbiter', question, responses:results });
      arbiterText = d.result;
      document.getElementById('arbiter-text').textContent = arbiterText;
      const winner = extractWinnerModel(arbiterText);
      if (winner) highlightWinner(winner);
    } catch(e) {
      arbiterText = 'Error del árbitro: '+e.message;
      document.getElementById('arbiter-text').textContent = arbiterText;
    }
  }

  await saveThread(question, results, arbiterText, modelsToRun, fd?.name||null);

  // Show thread banner if continuing
  const banner = document.getElementById('thread-banner');
  if (currentThread.length > 1) {
    banner.classList.remove('hidden');
    banner.textContent = `💬 Conversación de ${currentThread.length} turnos`;
  }

  setProgress(100);
  btn.disabled    = false;
  btn.textContent = 'Consultar los modelos ↗';
  document.getElementById('user-question').value = '';
  document.getElementById('user-question').focus();
}
window.runArena = runArena;

// Auto-detect
let detectTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const q = document.getElementById('user-question');
  if (q) q.addEventListener('input', () => {
    clearTimeout(detectTimer);
    const val = q.value.trim();
    if (val.length > 20) detectTimer = setTimeout(() => autoDetectModels(val), 1200);
  });
});
