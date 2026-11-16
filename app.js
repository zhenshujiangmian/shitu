const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const dropzone = $('dropzone');
const image = $('previewImage');
let currentFile = null;
let worker = null;
let toastTimer;
let cameraStream = null;
const DEFAULT_PROMPT = '请逐字转录图片中所有清晰可见的印刷文字。严格遵守：1. 保持原文语言，不要翻译、解释、总结或回答题目；2. 按原图从上到下、从左到右的阅读顺序输出，保留题号、选项编号、段落和换行；3. 保留括号、下划线、标点、数字及选项之间的空格；4. 不要补全被遮挡或无法确认的内容，不要猜测；5. 忽略手写涂改和纸张背面的透印。只返回转录文本，不要添加说明。';
const apiFields = ['apiEndpoint','apiModel','apiPrompt'];
const savedApi = (() => { try { return JSON.parse(localStorage.getItem('shizi-api-settings') || sessionStorage.getItem('shizi-api-settings') || '{}'); } catch { return {}; } })();
for (const id of apiFields) { if (savedApi[id]) $(id).value = savedApi[id]; }
if (!$('apiPrompt').value) $('apiPrompt').value = DEFAULT_PROMPT;
const VAULT_KEY = 'shizi-api-key-vault-v1';
let vaultRecord = (() => { try { return JSON.parse(localStorage.getItem(VAULT_KEY) || 'null'); } catch { return null; } })();
let vaultUnlocked = false;
let apiPanelOpen = false;
function saveApiSettings() {
  const value = Object.fromEntries(apiFields.map(id => [id, $(id).value]));
  try { localStorage.setItem('shizi-api-settings', JSON.stringify(value)); } catch { /* private browsing can disable storage */ }
}
apiFields.forEach(id => $(id).addEventListener('input', saveApiSettings));
saveApiSettings(); // migrate older session-only settings and retain non-secret configuration
function setVaultUI() {
  const keyField = $('apiKey');
  if (vaultRecord && !vaultUnlocked) {
    keyField.value = ''; keyField.disabled = true; keyField.placeholder = '已加密锁定，点击“解锁 Key”';
    $('vaultStatus').textContent = '🔒 API Key 已加密锁定'; $('vaultSaveButton').classList.add('hidden');
    $('vaultUnlockButton').classList.remove('hidden'); $('vaultLockButton').classList.add('hidden'); $('vaultDeleteButton').classList.remove('hidden');
    $('vaultHint').textContent = '密钥已加密保存。每次打开网页后解锁即可，无需重新输入 API Key。';
  } else if (vaultRecord && vaultUnlocked) {
    keyField.disabled = false; keyField.placeholder = '已解锁';
    $('vaultStatus').textContent = '🔓 本次会话已解锁'; $('vaultSaveButton').textContent = '更新加密 Key';
    $('vaultSaveButton').classList.remove('hidden'); $('vaultUnlockButton').classList.add('hidden'); $('vaultLockButton').classList.remove('hidden'); $('vaultDeleteButton').classList.remove('hidden');
    $('vaultHint').textContent = '密钥已解锁，仅保留在此页面内存中；关闭标签页后会重新锁定。';
  } else {
    keyField.disabled = false; keyField.placeholder = '粘贴 API Key';
    $('vaultStatus').textContent = 'API Key 加密保存在本机'; $('vaultSaveButton').textContent = '加密保存 Key';
    $('vaultSaveButton').classList.remove('hidden'); $('vaultUnlockButton').classList.add('hidden'); $('vaultLockButton').classList.add('hidden'); $('vaultDeleteButton').classList.add('hidden');
    $('vaultHint').textContent = '可用密码加密保存 API Key，之后解锁即可使用。';
  }
}
setVaultUI();

let vaultDialogMode = 'create';
function showVaultDialog(mode) {
  vaultDialogMode = mode;
  const create = mode === 'create';
  $('vaultDialogTitle').textContent = create ? (vaultRecord ? '更新加密密钥' : '创建密钥锁') : '解锁 API Key';
  $('vaultDialogDescription').textContent = create ? '设置一个解锁密码。API Key 将使用此密码加密保存在本机。请记住密码，忘记后无法恢复。' : '输入密钥锁密码以解锁本机保存的 API Key。';
  $('vaultPasswordLabel').textContent = create ? '设置解锁密码（至少 8 位）' : '解锁密码';
  $('vaultConfirmWrap').classList.toggle('hidden', !create);
  $('vaultDialogSubmit').textContent = create ? '加密保存并使用' : '解锁';
  $('vaultPassword').value = ''; $('vaultPasswordConfirm').value = ''; $('vaultDialogError').classList.add('hidden');
  $('vaultDialog').classList.remove('hidden'); $('vaultPassword').focus();
}
function closeVaultDialog() { $('vaultDialog').classList.add('hidden'); $('vaultPassword').value = ''; $('vaultPasswordConfirm').value = ''; }
function bytesToBase64(bytes) { let binary=''; for (const byte of bytes) binary+=String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
async function deriveVaultKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
$('vaultSaveButton').addEventListener('click', () => {
  if (!$('apiKey').value.trim()) { toast('先填写 API Key，再加密保存'); return; }
  showVaultDialog('create');
});
$('vaultUnlockButton').addEventListener('click', () => showVaultDialog('unlock'));
$('vaultLockButton')?.addEventListener('click', () => { vaultUnlocked=false; $('apiKey').value=''; setVaultUI(); });
$('vaultDeleteButton').addEventListener('click', () => {
  if (!confirm('删除保存在本机的加密 API Key？此操作不会删除服务商账户中的密钥。')) return;
  localStorage.removeItem(VAULT_KEY); vaultRecord=null; vaultUnlocked=false; $('apiKey').value=''; setVaultUI(); toast('已删除本机保存的密钥');
});
$('vaultDialogClose').addEventListener('click', closeVaultDialog);
$('vaultDialog').addEventListener('click', e => { if (e.target === $('vaultDialog')) closeVaultDialog(); });
$('vaultDialogSubmit').addEventListener('click', async () => {
  const password=$('vaultPassword').value;
  const fail=message=>{ $('vaultDialogError').textContent=message; $('vaultDialogError').classList.remove('hidden'); };
  $('vaultDialogError').classList.add('hidden');
  if (!globalThis.crypto?.subtle) { fail('当前浏览器环境不支持加密保存，请通过 localhost 或 HTTPS 打开。'); return; }
  if (vaultDialogMode === 'create') {
    if (password.length < 8) { fail('解锁密码至少需要 8 位。'); return; }
    if (password !== $('vaultPasswordConfirm').value) { fail('两次输入的密码不一致。'); return; }
    const rawKey=$('apiKey').value.trim(); if (!rawKey) { fail('请先填写 API Key。'); return; }
    try {
      const salt=crypto.getRandomValues(new Uint8Array(16)); const iv=crypto.getRandomValues(new Uint8Array(12));
      const key=await deriveVaultKey(password,salt); const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(rawKey));
      vaultRecord={salt:bytesToBase64(salt),iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(ciphertext))};
      localStorage.setItem(VAULT_KEY,JSON.stringify(vaultRecord)); vaultUnlocked=true; setVaultUI(); closeVaultDialog();
      if ($('apiEndpoint').value.trim() && $('apiModel').value.trim()) { apiPanelOpen=false; setEngineMode(); }
      toast('API Key 已加密保存');
    } catch { fail('加密保存失败，请检查浏览器存储权限。'); }
  } else {
    try {
      const key=await deriveVaultKey(password,base64ToBytes(vaultRecord.salt));
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(vaultRecord.iv)},key,base64ToBytes(vaultRecord.ciphertext));
      $('apiKey').value=new TextDecoder().decode(plaintext); vaultUnlocked=true; setVaultUI(); closeVaultDialog();
      if ($('apiEndpoint').value.trim() && $('apiModel').value.trim()) { apiPanelOpen=false; setEngineMode(); }
      toast('API Key 已解锁');
    } catch { fail('密码不正确，或本机密钥数据已损坏。'); }
  }
});

function setEngineMode() {
  const ai = $('engineSelect').value === 'ai';
  $('apiSettings').classList.toggle('hidden', !ai || !apiPanelOpen);
  $('apiPanelToggle').classList.toggle('hidden', !ai);
  $('apiPanelToggle').textContent = apiPanelOpen ? '收起 API 设置' : (vaultRecord ? 'API 已锁定 · 设置' : 'API 设置');
  $('apiPanelToggle').setAttribute('aria-expanded', String(ai && apiPanelOpen));
  $('languageControls').classList.toggle('hidden', ai);
  $('layoutToggle').classList.toggle('hidden', ai);
  $('engineTag').innerHTML = `<span class="engine-dot"></span>${ai ? '视觉 AI API' : '本地 OCR'}`;
  $('statusText').textContent = ai ? '正在连接 AI 服务…' : '正在准备识别…';
  $('downloadNote').textContent = ai ? '图片会发送至你配置的 API 服务进行识别。' : '首次识别时需要下载语言模型，请保持网络连接。';
  $('imagePrivacyNote').innerHTML = ai ? '<span class="footer-lock">↗</span> AI 模式：图片发送至你配置的 API 服务' : '<span class="footer-lock">▣</span> 本地 OCR：图片不会离开你的设备';
}
// Avoid reopening a completed setup on every mode change; incomplete settings open automatically.
$('engineSelect').addEventListener('change', () => {
  if ($('engineSelect').value === 'ai') apiPanelOpen = !($('apiEndpoint').value.trim() && $('apiModel').value.trim() && (vaultUnlocked || $('apiKey').value.trim()));
  setEngineMode();
});
$('apiPanelToggle').addEventListener('click', () => { apiPanelOpen=!apiPanelOpen; setEngineMode(); });
setEngineMode();

function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function setStatus(message, state = '') {
  const el = $('resultStatus'); el.className = `result-status ${state}`;
  el.lastElementChild.textContent = message;
}
function useFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('图片超过 20 MB，请换一张较小的图片'); return; }
  currentFile = file;
  image.src = URL.createObjectURL(file);
  image.onload = () => {
    $('emptyState').classList.add('hidden'); $('previewWrap').classList.remove('hidden');
    $('imageMeta').classList.remove('hidden'); $('removeImage').classList.remove('hidden');
    $('fileName').textContent = file.name; $('imageDimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
    $('recognizeButton').disabled = false; $('resultPlaceholder').classList.remove('hidden'); $('resultText').classList.add('hidden');
    $('resultText').value = ''; $('copyButton').disabled = true; $('downloadButton').disabled = true;
    selectedSnippet=''; $('explainButton').disabled=true; $('explanationPanel').classList.add('hidden');
    $('wordCount').textContent = '等待识别'; $('boxLayer').replaceChildren(); setStatus('图片已添加');
  };
}
$('browseButton').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { useFile(e.target.files[0]); e.target.value = ''; });
function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(track=>track.stop()); cameraStream=null; }
  $('cameraVideo').srcObject=null;
}
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('当前打开方式无法使用摄像头，请通过 HTTPS 或 localhost 打开网页'); return; }
  try {
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    $('cameraVideo').srcObject=cameraStream;
    $('emptyState').classList.add('hidden'); $('cameraStage').classList.remove('hidden');
    await $('cameraVideo').play();
  } catch(error) {
    stopCamera(); $('cameraStage').classList.add('hidden'); $('emptyState').classList.remove('hidden');
    const message=error.name==='NotAllowedError'?'摄像头权限未开启，请在 Edge 地址栏左侧的站点权限中允许摄像头。':error.name==='NotFoundError'?'没有检测到可用摄像头。':'无法启动摄像头，请确认摄像头未被其他应用占用。';
    toast(message);
  }
}
$('openCameraButton').addEventListener('click',openCamera);
$('cancelCameraButton').addEventListener('click',()=>{stopCamera();$('cameraStage').classList.add('hidden');$('emptyState').classList.remove('hidden');});
$('captureButton').addEventListener('click',()=>{
  const video=$('cameraVideo'); if(!video.videoWidth||!video.videoHeight){toast('摄像头画面还未准备好，请稍等一下');return;}
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  canvas.toBlob(blob=>{if(!blob){toast('拍摄失败，请重试');return;}const photo=new File([blob],`shizi-camera-${Date.now()}.jpg`,{type:'image/jpeg'});stopCamera();$('cameraStage').classList.add('hidden');useFile(photo);},'image/jpeg',.92);
});
window.addEventListener('pagehide',stopCamera);
$('removeImage').addEventListener('click', () => {
  stopCamera(); $('cameraStage').classList.add('hidden');
  currentFile = null; image.removeAttribute('src'); $('previewWrap').classList.add('hidden'); $('emptyState').classList.remove('hidden');
  $('imageMeta').classList.add('hidden'); $('removeImage').classList.add('hidden'); $('recognizeButton').disabled = true;
  $('boxLayer').replaceChildren(); $('resultPlaceholder').classList.remove('hidden'); $('resultText').classList.add('hidden');
  $('resultText').value = ''; $('copyButton').disabled = true; $('downloadButton').disabled = true; $('wordCount').textContent = '等待图片'; setStatus('准备就绪');
  selectedSnippet=''; $('explainButton').disabled=true; $('explanationPanel').classList.add('hidden');
});
for (const event of ['dragenter','dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('dragging'); $('dropOverlay').classList.remove('hidden'); });
for (const event of ['dragleave','drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('dragging'); $('dropOverlay').classList.add('hidden'); });
dropzone.addEventListener('drop', e => useFile(e.dataTransfer.files[0]));
document.addEventListener('paste', e => { const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (item) useFile(item.getAsFile()); });

function groupWords(words) {
  const sorted = words.filter(w => w.text?.trim()).sort((a,b) => (a.bbox.y0-b.bbox.y0) || (a.bbox.x0-b.bbox.x0));
  const lines = [];
  for (const word of sorted) {
    const mid = (word.bbox.y0 + word.bbox.y1) / 2;
    let line = lines.find(l => Math.abs(l.mid-mid) < Math.max(9, (word.bbox.y1-word.bbox.y0)*.55));
    if (!line) { line = {mid, words:[]}; lines.push(line); }
    line.words.push(word); line.mid = line.words.reduce((s,w)=>s+(w.bbox.y0+w.bbox.y1)/2,0)/line.words.length;
  }
  return lines.sort((a,b)=>a.mid-b.mid).map(line => line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0));
}
function lineText(words) {
  let out = '';
  for (const word of words) {
    const text = word.text.trim(); if (!text) continue;
    if (out && /^[\x00-\x7F]+$/.test(text) && /[\x00-\x7F]$/.test(out)) out += ' ';
    out += text;
  }
  return out;
}
function drawBoxes(words, width, height) {
  const layer = $('boxLayer'); layer.replaceChildren();
  for (const w of words.filter(x=>x.text?.trim())) {
    const box = document.createElement('span'); box.className = 'ocr-box';
    box.style.left = `${w.bbox.x0/width*100}%`; box.style.top = `${w.bbox.y0/height*100}%`;
    box.style.width = `${(w.bbox.x1-w.bbox.x0)/width*100}%`; box.style.height = `${(w.bbox.y1-w.bbox.y0)/height*100}%`;
    box.title = `${w.text} · ${Math.round(w.confidence)}%`; layer.append(box);
  }
}
$('layoutToggle').addEventListener('click', () => {
  const button = $('layoutToggle'); const active = button.classList.toggle('active'); button.setAttribute('aria-pressed', active);
  $('boxLayer').classList.toggle('hidden', !active);
});
let selectedSnippet = '';
function escapeHtml(value) { return value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function renderExplanation(markdown) {
  const inline = value => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>');
  const html = markdown.split(/\r?\n/).map(raw => {
    const line=raw.trim();
    if (!line) return '';
    const heading=line.match(/^#{1,3}\s+(.+)$/);
    if (heading) return `<h3>${inline(heading[1])}</h3>`;
    const bullet=line.match(/^(?:[-*•])\s+(.+)$/);
    if (bullet) return `<div class="explanation-list-item"><span class="explanation-bullet">•</span><span>${inline(bullet[1])}</span></div>`;
    const numbered=line.match(/^\d+[.)、]\s*(.+)$/);
    if (numbered) return `<div class="explanation-list-item"><span class="explanation-number">${line.match(/^\d+/)[0]}</span><span>${inline(numbered[1])}</span></div>`;
    return `<p>${inline(line)}</p>`;
  }).join('');
  $('explanationText').innerHTML=html;
}
function readTextSelection() {
  const field=$('resultText');
  selectedSnippet=field.value.slice(field.selectionStart,field.selectionEnd).trim();
  $('explainButton').disabled=!selectedSnippet;
  $('explainButton').title=selectedSnippet ? `解析：${selectedSnippet.slice(0,80)}` : '先拖动鼠标选中识别结果中的词句';
}
for (const event of ['mouseup','keyup','select']) $('resultText').addEventListener(event,readTextSelection);
$('closeExplanation').addEventListener('click',()=>$('explanationPanel').classList.add('hidden'));
$('explainButton').addEventListener('click',async()=>{
  if (!selectedSnippet) return;
  if (!$('apiEndpoint').value.trim() || !$('apiModel').value.trim()) {
    $('engineSelect').value='ai'; apiPanelOpen=true; setEngineMode(); toast('请先配置支持视觉或文字输入的 AI API'); return;
  }
  if (!vaultUnlocked && vaultRecord) { $('engineSelect').value='ai'; apiPanelOpen=true; setEngineMode(); toast('请先解锁已加密保存的 API Key'); return; }
  const apiKey=$('apiKey').value.trim();
  if (!apiKey) { $('engineSelect').value='ai'; apiPanelOpen=true; setEngineMode(); toast('请先填写 API Key 或解锁本机密钥'); return; }
  const wholeText=$('resultText').value; const start=$('resultText').selectionStart; const end=$('resultText').selectionEnd;
  const context=wholeText.slice(Math.max(0,start-180),Math.min(wholeText.length,end+180));
  const button=$('explainButton'); button.disabled=true; button.innerHTML='<span>…</span> 正在解析';
  $('explanationText').innerHTML='<p class="explanation-loading"><span class="loading-dot"></span> 正在请求 AI 翻译和解析…</p>';
  $('explanationPanel').classList.remove('hidden'); $('explanationSource').textContent=selectedSnippet;
  try {
    const response=await fetch($('apiEndpoint').value.trim(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({
      model:$('apiModel').value.trim(),temperature:0.2,
      messages:[
        {role:'system',content:'你是一名细致的多语言阅读助手。请用简体中文解析用户选中的词句：先给出自然、准确的中文翻译；再说明关键词读音/词义、语法或固定搭配、句中语气。只依据所给上下文，不确定时明确指出，不要臆造。回答简洁清晰，使用小标题。'},
        {role:'user',content:`OCR 全文上下文：\n${context}\n\n用户选中的词句：\n${selectedSnippet}\n\n请翻译并解析选中内容。`}
      ]
    })});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error?.message||payload.message||`API 请求失败（HTTP ${response.status}）`);
    const content=payload.choices?.[0]?.message?.content;
    const explanation=Array.isArray(content)?content.filter(part=>part.type==='text').map(part=>part.text).join('\n'):content;
    if(typeof explanation!=='string'||!explanation.trim()) throw new Error('API 没有返回解析文本。');
    renderExplanation(explanation.trim());
  } catch(error) { $('explanationText').textContent=`解析失败：${error.message||'请检查 API 设置或跨域权限。'}`; }
  finally { button.innerHTML='<span>✦</span> 翻译 / 解析'; readTextSelection(); }
});
$('recognizeButton').addEventListener('click', async () => {
  if (!currentFile) return;
  const aiMode = $('engineSelect').value === 'ai';
  if (aiMode && (!$('apiEndpoint').value.trim() || !$('apiModel').value.trim())) { toast('请先填写 API 地址和模型名称'); $('apiSettings').classList.remove('hidden'); return; }
  if (aiMode && vaultRecord && !vaultUnlocked) { apiPanelOpen=true; setEngineMode(); toast('请先解锁已加密保存的 API Key'); return; }
  if (!aiMode && !window.Tesseract) { toast('OCR 引擎加载失败，请检查网络后刷新页面'); return; }
  $('recognizeButton').disabled = true; $('resultPlaceholder').classList.add('hidden'); $('resultText').classList.add('hidden'); $('progressArea').classList.remove('hidden');
  $('downloadNote').classList.remove('hidden'); $('progressBar').style.width = aiMode ? '24%' : '0%'; $('progressPercent').textContent = aiMode ? '…' : '0%'; $('statusText').textContent = aiMode ? '正在请求视觉 AI…' : '正在准备识别…'; setStatus('正在识别', 'processing');
  try {
    let text = '';
    if (aiMode) {
      $('statusText').textContent = '正在发送图片并等待 AI 转录…';
      const imageData = await fileAsDataUrl(currentFile);
      const endpoint = $('apiEndpoint').value.trim();
      const headers = {'Content-Type':'application/json'};
      const key = $('apiKey').value.trim(); if (key) headers.Authorization = `Bearer ${key}`;
      const response = await fetch(endpoint, {method:'POST', headers, body:JSON.stringify({
        model:$('apiModel').value.trim(), temperature:0.1,
        messages:[
          {role:'system',content:$('apiPrompt').value.trim() || DEFAULT_PROMPT},
          {role:'user',content:[{type:'text',text:'请转录这张图片中的文字。'},{type:'image_url',image_url:{url:imageData}}]}
        ]
      })});
      const payload = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.message || `API 请求失败（HTTP ${response.status}）`);
      const content = payload.choices?.[0]?.message?.content;
      text = Array.isArray(content) ? content.filter(part=>part.type==='text').map(part=>part.text).join('\n') : content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('API 返回中没有可用的文字内容，请确认模型支持图片输入和 Chat Completions 格式。');
      $('boxLayer').replaceChildren(); $('wordCount').textContent = 'AI 转录结果';
    } else {
      const lang = $('languageSelect').value;
      if (worker) { await worker.terminate(); worker = null; }
      worker = await Tesseract.createWorker(lang, 1, { logger: m => {
        if (m.status) $('statusText').textContent = ({'loading tesseract core':'加载识别引擎…','initializing tesseract':'初始化引擎…','loading language traineddata':'下载语言模型…','initializing api':'准备识别…','recognizing text':'正在识别文字…'})[m.status] || m.status;
        if (typeof m.progress === 'number') { const pct = Math.round(m.progress*100); $('progressBar').style.width=`${pct}%`; $('progressPercent').textContent=`${pct}%`; }
      }});
      const { data } = await worker.recognize(currentFile);
      const words = data.words || []; text = groupWords(words).map(lineText).filter(Boolean).join('\n');
      drawBoxes(words, image.naturalWidth, image.naturalHeight); $('boxLayer').classList.toggle('hidden', !$('layoutToggle').classList.contains('active'));
      $('wordCount').textContent = `${words.filter(w=>w.text?.trim()).length} 个文字区域`;
    }
    $('resultText').value = text.trim(); $('resultText').setSelectionRange(0,0); selectedSnippet=''; $('explainButton').disabled=true; $('explanationPanel').classList.add('hidden'); $('resultText').classList.remove('hidden'); $('progressArea').classList.add('hidden');
    $('copyButton').disabled = !$('resultText').value; $('downloadButton').disabled = !$('resultText').value;
    setStatus('识别完成', 'done'); if (!$('resultText').value) toast('没有识别到文字，请检查图片或 API 设置');
  } catch (error) {
    console.error(error); $('progressArea').classList.add('hidden'); $('resultText').classList.remove('hidden'); $('resultText').value = ''; $('resultPlaceholder').classList.add('hidden'); setStatus('识别失败'); toast(error.message || '识别失败，请检查网络、API 地址和跨域权限');
  } finally { $('recognizeButton').disabled = false; }
});
function fileAsDataUrl(file) { return new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('无法读取图片文件')); reader.readAsDataURL(file); }); }
$('copyButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('resultText').value); toast('已复制到剪贴板'); } catch { $('resultText').select(); document.execCommand('copy'); toast('已复制到剪贴板'); } });
$('downloadButton').addEventListener('click', () => {
  const blob = new Blob([$('resultText').value], {type:'text/plain;charset=utf-8'}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${currentFile?.name.replace(/\.[^.]+$/,'') || 'shitu-ocr'}.txt`; a.click(); URL.revokeObjectURL(a.href);
});
