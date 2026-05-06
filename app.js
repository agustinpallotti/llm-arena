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
let currentThreadId = null;
let currentThread   = [];
let currentFileData = null;
let lastResults     = {};  // stores all 3 results after asking others
let chosenModel     = null; // model Lupa chose

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

// ── Model helpers ─────────────────────────────────────────────────────────────
const MODEL_META = {
  gpt:    { name:'ChatGPT',  dotClass:'gpt'    },
  gemini: { name:'Gemini',   dotClass:'gemini' },
  claude: { name:'Claude',   dotClass:'claude' }
};

function otherModels(chosen) {
  return ['gpt','gemini','claude'].filter(m => m !== chosen);
}

// ── Lupa: decide which model to use ──────────────────────────────────────────
async function lupaDecide(question) {
  const data = await callProxy({ action:'detect', question });
  // Pick the first recommended model as the primary
  const primary = data.models[0] || 'claude';
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
    const q    = query(collection(db, 'threads'), orderBy('updatedAt', 'desc'));
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
  currentThread   = data.turns||[];
  const last      = currentThread[currentThread.length-1];
  if (!last) return;

  document.getElementById('user-question').value = '';
  document.getElementById('results').classList.remove('hidden');
  document.getElementById('other-opinions-section').classList.add('hidden');
  document.getElementById('ask-others-btn').classList.remove('hidden');

  // Show primary answer
  const winner = last.winner || 'claude';
  setPrimaryCard(winner, last[winner]||'[Sin respuesta]', 'done', 'Listo');
  lastResults  = { gpt:last.gpt, gemini:last.gemini, claude:last.claude };
  chosenModel  = winner;

  const banner = document.getElementById('thread-banner');
  if (currentThread.length > 1) {
    banner.classList.remove('hidden');
    banner.textContent = `💬 Conversación de ${currentThread.length} turnos — continuando hilo`;
  } else { banner.classList.add('hidden'); }
}

window.newQuery = function() {
  currentThreadId = null;
  currentThread   = [];
  lastResults     = {};
  chosenModel     = null;
  document.querySelectorAll('.history-item').forEach(b => b.classList.remove('active'));
  document.getElementById('user-question').value = '';
  document.getElementById('results').classList.add('hidden');
  document.getElementById('progress-bar').classList.add('hidden');
  document.getElementById('detect-status').classList.add('hidden');
  document.getElementById('thread-banner').classList.add('hidden');
  document.getElementById('other-opinions-section').classList.add('hidden');
  clearFile();
  setProgress(0);
  document.getElementById('user-question').focus();
};

// ── Primary card ──────────────────────────────────────────────────────────────
function setPrimaryCard(model, text, statusType, statusLabel) {
  const meta = MODEL_META[model] || { name: model, dotClass: 'claude' };
  document.getElementById('primary-dot').className        = 'dot ' + meta.dotClass;
  document.getElementById('primary-model-name').textContent = meta.name;
  document.getElementById('primary-text').textContent     = text;
  const statusEl = document.getElementById('primary-status');
  statusEl.className   = 'status-chip ' + statusType;
  statusEl.textContent = statusLabel;
}

// ── Ask Others ────────────────────────────────────────────────────────────────
window.askOthers = async function() {
  const question = currentThread.length ? currentThread[currentThread.length-1].question : document.getElementById('user-question').value.trim();
  if (!question) return;

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
    card.className = 'result-card';
    card.id = 'other-card-' + m;
    const meta = MODEL_META[m];
    card.innerHTML = `
      <div class="result-card-header">
        <div class="model-label"><span class="dot ${meta.dotClass}"></span><span>${meta.name}</span></div>
        <span class="status-chip" id="other-status-${m}">Consultando...</span>
      </div>
      <div class="result-text" id="other-text-${m}">—</div>`;
    grid.appendChild(card);

    // If we already have the result (from a previous full query), show it
    if (lastResults[m]) {
      document.getElementById('other-text-'+m).textContent   = lastResults[m];
      document.getElementById('other-status-'+m).className   = 'status-chip done';
      document.getElementById('other-status-'+m).textContent = 'Listo';
      return;
    }

    // Otherwise call the model
    try {
      const sys = localStorage.getItem('llm-sys-'+m) || def;
      const sp  = await buildSystemPrompt(sys);
      const d   = await callProxy({ model:m, systemPrompt:sp, userMsg:question, fileData: m==='gemini' && fd?.text ? {text:fd.text} : fd });
      lastResults[m] = d.result;
      document.getElementById('other-text-'+m).textContent   = d.result;
      document.getElementById('other-status-'+m).className   = 'status-chip done';
      document.getElementById('other-status-'+m).textContent = 'Listo';
    } catch(e) {
      document.getElementById('other-text-'+m).textContent   = 'Error: ' + e.message;
      document.getElementById('other-status-'+m).className   = 'status-chip error';
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
  };
  await setDoc(doc(db,'user','profile'), profile);
  const saved = document.getElementById('profile-saved');
  saved.classList.remove('hidden');
  setTimeout(()=>saved.classList.add('hidden'),2500);
  updateMemoryBanner();
}
async function loadProfile() {
  try {
    const snap = await getDoc(doc(db,'user','profile'));
    if (snap.exists()) {
      const p=snap.data();
      document.getElementById('profile-name').value    = p.name    ||'';
      document.getElementById('profile-role').value    = p.role    ||'';
      document.getElementById('profile-context').value = p.context ||'';
      document.getElementById('profile-style').value   = p.style   ||'';
      document.getElementById('profile-topics').value  = p.topics  ||'';
      updateMemoryBanner();
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
    updateMemoryBanner();
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
  const hasProfile=document.getElementById('profile-name').value.trim()||document.getElementById('profile-context').value.trim();
  const hasDocs=userDocs.length>0;
  const banner=document.getElementById('memory-banner');
  const summary=document.getElementById('memory-summary');
  if (hasProfile||hasDocs) {
    banner.classList.remove('hidden');
    const parts=[];
    if (hasProfile) parts.push('perfil personal');
    if (hasDocs)    parts.push(`${userDocs.length} documento${userDocs.length>1?'s':''}`);
    summary.textContent=`Los modelos usarán tu ${parts.join(' y ')} como contexto`;
  } else { banner.classList.add('hidden'); }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function setProgress(pct) { document.getElementById('progress-fill').style.width=pct+'%'; }
function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function buildSystemPrompt(basePrompt) {
  return basePrompt + getProfileContext() + getDocsContext() + buildConversationContext(currentThread);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runArena() {
  const question = document.getElementById('user-question').value.trim();
  if (!question) { alert('Escribe una pregunta primero.'); return; }

  const btn = document.getElementById('send-btn');
  btn.disabled=true; btn.textContent='Lupa está pensando...';

  document.getElementById('results').classList.remove('hidden');
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

  // Step 2: Show card loading state
  setPrimaryCard(primary, '—', '', 'Consultando...');

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
    setPrimaryCard(primary, d.result, 'done', 'Listo');
    setProgress(90);
  } catch(e) {
    setPrimaryCard(primary, 'Error: '+e.message, 'error', 'Error');
    setProgress(90);
  }

  // Save thread
  await saveThread(question, lastResults, primary, [primary], fd?.name||null);
  setProgress(100);

  btn.disabled=false;
  btn.textContent='Preguntar ↗';
  document.getElementById('user-question').value='';
  document.getElementById('user-question').focus();

  const banner=document.getElementById('thread-banner');
  if (currentThread.length>1) {
    banner.classList.remove('hidden');
    banner.textContent=`💬 Conversación de ${currentThread.length} turnos`;
  }
}
window.runArena=runArena;
