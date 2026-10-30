// Fiel — app web (Conversa). Vanilla JS, sem build.
const $ = (s) => document.querySelector(s);
const tokenLocal = () => new URLSearchParams(location.search).get('token') || localStorage.getItem('akm');
const api = async (p, o = {}) => { const tk = tokenLocal(); const r = await fetch(p, { credentials: 'same-origin', ...o, headers: { ...(o.headers || {}), ...(tk ? { authorization: 'Bearer ' + tk } : {}) } }); if (r.status === 401) { mostrarLogin(); throw new Error('401'); } return r.json(); };
const NOMES = { diretor: 'Diretor', secretaria: 'Secretária', documentos: 'Documentos', financeiro: 'Financeiro', producao: 'Produção', social: 'MIA' };
let me = null, ws = null, filtro = null, maisAntigo = null, anexo = null, rec = null;

// ---------- login ----------
async function mostrarLogin() {
  $('#app').classList.add('oculto'); $('#login').classList.remove('oculto');
  // abas
  document.querySelectorAll('.abas-login .aba').forEach(b => b.onclick = () => {
    document.querySelectorAll('.abas-login .aba').forEach(x => x.classList.toggle('on', x === b));
    for (const id of ['formEntrar', 'formCadastro', 'formTelegram', 'formEsqueci', 'formRedefinir']) document.getElementById(id)?.classList.toggle('oculto', id !== 'form' + (b.dataset.aba[0].toUpperCase() + b.dataset.aba.slice(1)));
    if (b.dataset.aba === 'telegram') carregarTelegram();
  });
  // formulários
  $('#formEntrar').onsubmit = async (e) => { e.preventDefault(); $('#erroEntrar').textContent = ''; const f = Object.fromEntries(new FormData(e.target));
    const r = await (await fetch('/api/login/senha', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).json();
    if (r.ok) { localStorage.setItem('akm', r.token); iniciar(); } else $('#erroEntrar').textContent = r.erro || 'não foi possível entrar'; };
  $('#formCadastro').onsubmit = async (e) => { e.preventDefault(); $('#erroCadastro').textContent = ''; const f = Object.fromEntries(new FormData(e.target));
    const r = await (await fetch('/api/cadastro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).json();
    if (r.ok) { localStorage.setItem('akm', r.token); iniciar(); } else $('#erroCadastro').textContent = r.erro || 'não foi possível criar'; };
  // ---------- esqueci minha senha ----------
  const FORMS = ['formEntrar', 'formCadastro', 'formTelegram', 'formEsqueci', 'formRedefinir'];
  const mostrarForm = (id) => FORMS.forEach(x => document.getElementById(x)?.classList.toggle('oculto', x !== id));
  const postJ = async (url, corpo) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })).json().catch(() => ({ erro: 'falha de conexão' }));
  $('#linkEsqueci').onclick = (e) => { e.preventDefault(); $('#formEsqueci').email.value = $('#formEntrar').email.value || ''; mostrarForm('formEsqueci'); $('#formEsqueci').email.focus(); };
  document.querySelectorAll('.voltarEntrar').forEach(a => a.onclick = (e) => { e.preventDefault(); mostrarForm('formEntrar'); });
  const pedirCodigo = async (email) => { const r = await postJ('/api/senha/esqueci', { email }); if (r.erro) throw new Error(r.erro); return r; };
  $('#formEsqueci').onsubmit = async (e) => { e.preventDefault(); const email = e.target.email.value.trim(); $('#erroEsqueci').textContent = ''; const b = e.target.querySelector('button'); b.disabled = true;
    try { const r = await pedirCodigo(email); const fr = $('#formRedefinir'); fr.email.value = email; fr.token.value = ''; $('#campoCodigo').classList.remove('oculto'); fr.codigo.required = true; $('#msgRedefinir').textContent = r.mensagem; mostrarForm('formRedefinir'); fr.codigo.focus(); }
    catch (err) { $('#erroEsqueci').textContent = err.message; } finally { b.disabled = false; } };
  $('#reenviarCodigo').onclick = async (e) => { e.preventDefault(); const email = $('#formRedefinir').email.value.trim(); if (!email) return; try { const r = await pedirCodigo(email); $('#msgRedefinir').textContent = '✅ ' + r.mensagem; } catch (err) { $('#erroRedefinir').textContent = err.message; } };
  $('#formRedefinir').onsubmit = async (e) => { e.preventDefault(); $('#erroRedefinir').textContent = ''; const f = Object.fromEntries(new FormData(e.target));
    if (f.nova !== f.nova2) return $('#erroRedefinir').textContent = 'as duas senhas não conferem';
    const r = await postJ('/api/senha/redefinir', { email: f.email, codigo: f.codigo, token: f.token, nova: f.nova });
    if (r.ok) { localStorage.setItem('akm', r.token); history.replaceState(null, '', location.pathname); iniciar(); } else $('#erroRedefinir').textContent = r.erro || 'não foi possível salvar'; };
  // Link do e-mail: /app/?reset=TOKEN&email=... abre direto a tela de nova senha (sem precisar digitar o código)
  const qs = new URLSearchParams(location.search);
  if (qs.get('reset')) { const fr = $('#formRedefinir'); fr.email.value = qs.get('email') || ''; fr.token.value = qs.get('reset'); fr.codigo.required = false; $('#campoCodigo').classList.add('oculto'); $('#msgRedefinir').textContent = 'Defina sua nova senha.'; mostrarForm('formRedefinir'); fr.nova.focus(); }
}
async function carregarTelegram() {
  if ($('#codigo').textContent.length > 6) return; // já carregado
  const { codigo, token, bot } = await (await fetch('/api/login/iniciar', { method: 'POST' })).json();
  $('#codigo').textContent = `web ${codigo}`; $('#botNome').textContent = '@' + bot;
  $('#abrirBot').href = `https://t.me/${bot}?text=${encodeURIComponent('web ' + codigo)}`;
  const timer = setInterval(async () => {
    const r = await (await fetch(`/api/login/status?token=${token}`)).json();
    if (r.ok) { clearInterval(timer); localStorage.setItem('akm', token); iniciar(); }
    if (!r.ok && !r.aguardando) { clearInterval(timer); $('#codigo').textContent = '······'; carregarTelegram(); }
  }, 2000);
}
async function iniciar() {
  try { me = await api('/api/me'); } catch { return; }
  $('#login').classList.add('oculto'); $('#app').classList.remove('oculto');
  $('#donoNome').textContent = me.conta.nome_dono;
  if (me.conta.admin === 1) $('#btAdmin').classList.remove('oculto');
  if (me.creditos) {
    const c = me.creditos; const pct = c.ilimitada ? 100 : Math.max(0, Math.min(100, c.saldo / (c.base || 1) * 100));
    $('#saldoChip').classList.remove('oculto');
    $('#saldoNum').textContent = c.ilimitada ? '∞' : Number(c.saldo).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    $('#saldoSub').textContent = c.ilimitada ? 'ilimitado' : pct <= 5 ? 'recarregue' : pct <= 20 ? 'acabando' : 'créd.';
    const b = $('#saldoBarra'); b.style.width = pct + '%'; b.style.background = c.ilimitada ? 'var(--sage)' : pct <= 5 ? 'var(--coral)' : pct <= 20 ? 'var(--dourado)' : 'linear-gradient(90deg,var(--coral),var(--dourado))';
    $('#saldoChip').onclick = () => { mostrarTela('creditos'); $('#lateral').classList.remove('aberta'); };
  }
  document.querySelectorAll('.atalhos button').forEach(b => b.onclick = () => { enviar(b.dataset.cmd); $('#lateral').classList.remove('aberta'); });
  const nome = (m) => me.personas.find(p => p.modulo === m)?.nome || NOMES[m];
  $('#equipeAtiva').innerHTML = `<div class="titulo">Equipe ativa</div>` + me.modulos.map(m => `<div class="equipe-item"><span class="dot"></span>${nome(m)} <span style="opacity:.6;font-size:12px">· ${NOMES[m]}</span></div>`).join('');
  $('#filtros').innerHTML = `<button class="ativo" data-f="">Todos</button>` + me.modulos.map(m => `<button data-f="${m}">${nome(m)}</button>`).join('');
  $('#filtros').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filtro = b.dataset.f || null; [...$('#filtros').children].forEach(x => x.classList.toggle('ativo', x === b)); render(); };
  $('#texto').placeholder = `Fale com ${me.modulos.map(nome).slice(0, 4).join(', ')}…`;
  await carregar(); conectar(); setTimeout(irParaFim, 600); window.addEventListener('resize', () => { if (pertoDoFim($('#lista'))) irParaFim(); });
}

// ---------- mensagens ----------
let msgs = [];
async function carregar(antes) {
  const lote = await api(`/api/mensagens?limite=60${antes ? `&antes=${antes}` : ''}`);
  msgs = antes ? [...lote, ...msgs] : lote; maisAntigo = lote.length ? msgs[0]?.id : null; render(!antes, !!antes);
}
let carregandoAntigas = false;
function pertoDoFim(lista) { return lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120; }
function render(rolar = true, manterPosicao = false) {
  const lista = $('#lista'); const alturaAntes = lista.scrollHeight; const topoAntes = lista.scrollTop;
  const vis = filtro ? msgs.filter(m => m.direcao === 'entrada' || m.modulo === filtro) : msgs;
  let dia = ''; const html = [];
  for (const m of vis) {
    const d = new Date(m.em.replace(' ', 'T') + 'Z'); const dd = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    if (dd !== dia) { dia = dd; html.push(`<div class="dia">${dd}</div>`); }
    html.push(bolha(m, d));
  }
  bloqueiaScroll = true; lista.innerHTML = html.join('');
  if (manterPosicao) lista.scrollTop = lista.scrollHeight - alturaAntes + topoAntes;
  else if (rolar) irParaFim();
  requestAnimationFrame(() => { bloqueiaScroll = false; });
}
let bloqueiaScroll = false;
function irParaFim() { const l = $('#lista'); l.scrollTop = l.scrollHeight; requestAnimationFrame(() => { l.scrollTop = l.scrollHeight; }); setTimeout(() => { l.scrollTop = l.scrollHeight; }, 250); }
/** Acrescenta uma mensagem nova sem redesenhar tudo; rola só se o dono já estava no fim. */
function acrescentar(m) {
  const lista = $('#lista'); const noFim = pertoDoFim(lista);
  if (filtro && !(m.direcao === 'entrada' || m.modulo === filtro)) return;
  const d = new Date(m.em.replace(' ', 'T') + 'Z');
  lista.insertAdjacentHTML('beforeend', bolha(m, d));
  if (noFim || m.direcao === 'entrada') irParaFim();
  // imagens/vídeos que carregam depois empurram o fim: acompanha
  lista.lastElementChild?.querySelectorAll('img,video').forEach(el => el.addEventListener('load', () => { if (pertoDoFim(lista) || noFim) irParaFim(); }, { once: true }));
}
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function fmt(t) {
  let s = esc(t);
  s = s.replace(/^\s*#{1,6}\s+(.+)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<b>$2</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Links clicáveis: http(s), wa.me (WhatsApp), tel: (chamada), mailto: (e-mail).
  // WhatsApp e tel ganham ícone contextual na frente, não repetem a URL feia no texto do link.
  s = s.replace(/\bhttps?:\/\/wa\.me\/(\d+)[^\s<]*/g, (u, num) => `<a href="${u}" target="_blank" rel="noopener" class="link-wa">📱 Abrir WhatsApp</a>`);
  s = s.replace(/\btel:\+?([\d]+)/g, (u, num) => `<a href="${u}" class="link-tel">☎ Ligar</a>`);
  s = s.replace(/\bmailto:([^\s<]+)/g, (u, m) => `<a href="${u}" class="link-mail">✉ ${m}</a>`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`);
  return s;
}
function bolha(m, d) {
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nome = m.modulo ? (me.personas.find(p => p.modulo === m.modulo)?.nome || NOMES[m.modulo]) : null;
  let midia = '';
  if (m.midia?.url && m.tipo === 'imagem') midia = `<img src="${m.midia.url}" loading="lazy">`;
  else if (m.midia?.url && m.tipo === 'video') midia = `<video src="${m.midia.url}" controls playsinline preload="metadata"></video>`;
  else if (m.midia?.urls) midia = `<div class="album">${m.midia.urls.map(u => `<img src="${u}" loading="lazy">`).join('')}</div>`;
  else if (m.midia?.url && m.tipo === 'audio') midia = `<audio src="${m.midia.url}" controls></audio>`;
  else if (m.midia?.url) midia = `<a class="doc" href="${m.midia.url}" target="_blank">📄 ${esc(m.midia.nome || 'arquivo')}</a>`;
  else if (m.midia && m.direcao === 'entrada') midia = `<span style="color:var(--mudo)">📎 ${esc(m.midia.nome || m.tipo)} (enviado pelo Telegram)</span>`;
  const botoes = m.botoes ? `<div class="botoes" data-id="${m.id}">${m.botoes.flat().map(b => `<button data-d="${esc(b.d ?? b.t)}">${esc(b.t)}</button>`).join('')}</div>` : '';
  const texto = m.texto && !(m.midia && /^\[(imagem|video|arquivo|audio)\]$/.test(m.texto)) ? fmt(m.texto) : '';
  return `<div class="msg ${m.direcao}" data-id="${m.id}">${nome ? `<div class="mod">${esc(nome)}</div>` : ''}${midia}${texto}${botoes}<div class="meta"><span>${hora}</span><span>${m.direcao === 'entrada' ? (m.canal === 'web' ? '💻 web' : '📱 telegram') : ''}</span></div></div>`;
}
$('#lista').addEventListener('click', (e) => {
  const b = e.target.closest('.botoes button'); if (!b) return;
  b.closest('.botoes').classList.add('usados'); enviar(b.dataset.d);
});
$('#lista').addEventListener('scroll', async () => { if (bloqueiaScroll || carregandoAntigas) return; if ($('#lista').scrollTop < 40 && maisAntigo) { carregandoAntigas = true; const a = maisAntigo; try { await carregar(a); } finally { carregandoAntigas = false; } } });

// ---------- websocket ----------
function conectar() {
  const tok = tokenLocal(); const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${tok}`);
  ws.onopen = () => { $('#estado').textContent = 'ao vivo · sincronizado com o Telegram'; irParaFim(); };
  ws.onclose = () => { $('#estado').textContent = 'reconectando…'; setTimeout(conectar, 2500); };
  ws.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.tipo === 'mensagem') { msgs.push(e.mensagem); $('#digitando').classList.add('oculto'); acrescentar(e.mensagem); }
    if (e.tipo === 'digitando') { $('#digitando').classList.remove('oculto'); clearTimeout(conectar._t); conectar._t = setTimeout(() => $('#digitando').classList.add('oculto'), 6000); }
  };
}

// ---------- composer ----------
async function enviar(texto, arquivo) {
  if (!texto && !arquivo) return;
  const fd = new FormData(); if (texto) fd.append('texto', texto); if (arquivo) fd.append('arquivo', arquivo, arquivo.name || 'audio.webm');
  await api('/api/enviar', { method: 'POST', body: fd });
}
$('#form').onsubmit = async (e) => {
  e.preventDefault(); const t = $('#texto').value.trim(); const a = anexo; if (!t && !a) return;
  $('#texto').value = ''; $('#texto').style.height = 'auto'; limparAnexo();
  await enviar(t, a);
};
$('#texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#form').requestSubmit(); } });
$('#texto').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(160, this.scrollHeight) + 'px'; });
$('#anexar').onclick = () => $('#arquivo').click();
$('#arquivo').onchange = () => { const f = $('#arquivo').files[0]; if (f) mostrarAnexo(f); $('#arquivo').value = ''; };
function mostrarAnexo(f) {
  anexo = f; const p = $('#previaAnexo'); p.classList.remove('oculto');
  const url = URL.createObjectURL(f); const tag = f.type.startsWith('image/') ? `<img src="${url}">` : f.type.startsWith('video/') ? `<video src="${url}" muted></video>` : '📄';
  p.innerHTML = `${tag}<span>${esc(f.name)} · ${(f.size / 1048576).toFixed(1)} MB</span><button class="icone" id="tirarAnexo">✕</button>`;
  $('#tirarAnexo').onclick = limparAnexo; $('#texto').focus();
}
function limparAnexo() { anexo = null; $('#previaAnexo').classList.add('oculto'); $('#previaAnexo').innerHTML = ''; }
document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) mostrarAnexo(f); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) mostrarAnexo(f); });

// gravação de áudio (MediaRecorder) → envia como áudio (o bot transcreve)
$('#gravar').onclick = async () => {
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' }); rec = null; $('#gravar').classList.remove('gravando'); $('#gravar').textContent = '🎙'; if (blob.size > 1000) await enviar('', new File([blob], blob.type.includes('mp4') ? 'audio.m4a' : 'audio.webm', { type: blob.type })); };
    rec.start(); $('#gravar').classList.add('gravando'); $('#gravar').textContent = '■';
  } catch (e) { alert('Não consegui acessar o microfone: ' + e.message); }
};

// ---------- lateral / atalhos / sair ----------
$('#abrirLateral').onclick = () => $('#lateral').classList.add('aberta');
$('#fecharLateral').onclick = () => $('#lateral').classList.remove('aberta');
document.querySelectorAll('.menu a').forEach(a => a.onclick = () => { window.mostrarTela?.(a.dataset.tela); $('#lateral').classList.remove('aberta'); });
$('#sair').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); localStorage.removeItem('akm'); location.reload(); };

// PWA
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {});
iniciar();
