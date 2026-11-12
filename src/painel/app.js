// Fiel — app web (Conversa). Vanilla JS, sem build.
const $ = (s) => document.querySelector(s);
const tokenLocal = () => new URLSearchParams(location.search).get('token') || localStorage.getItem('akm');
const api = async (p, o = {}) => { const tk = tokenLocal(); const r = await fetch(p, { credentials: 'same-origin', ...o, headers: { ...(o.headers || {}), ...(tk ? { authorization: 'Bearer ' + tk } : {}) } }); if (r.status === 401) { mostrarLogin(); throw new Error('401'); } return r.json(); };
const NOMES = { diretor: 'Diretor', secretaria: 'Secretária', documentos: 'Documentos', financeiro: 'Financeiro', producao: 'Produção', social: 'MIA' };
let me = null, ws = null, filtro = null, maisAntigo = null, rec = null;

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
    if (r.ok) { localStorage.setItem('akm', r.token); if (r.cupom?.beneficio) try { sessionStorage.setItem('cupomOk', `Cupom ${r.cupom.codigo} ativado: ${r.cupom.beneficio}`); } catch {} else if (r.cupom?.erro) try { sessionStorage.setItem('cupomOk', `Conta criada. O cupom não foi aplicado: ${r.cupom.erro}`); } catch {} iniciar(); } else $('#erroCadastro').textContent = r.erro || 'não foi possível criar'; };
  // cupom: vem no link (?cupom=CODIGO) e mostra o brinde antes de criar a conta
  { const cc = $('#cadCupom'); if (cc) { const q = new URLSearchParams(location.search).get('cupom'); const ver = async () => { const v = cc.value.trim(); $('#cupomInfo').textContent = ''; if (v.length < 3) return; const r = await (await fetch('/api/cupom/validar?codigo=' + encodeURIComponent(v))).json().catch(() => ({})); $('#cupomInfo').textContent = r.ok ? '🎁 ' + r.beneficio : (r.erro || ''); };
    cc.onchange = ver; cc.onblur = ver; if (q) { cc.value = q.toUpperCase(); ver(); document.querySelector('[data-aba="cadastro"]')?.click(); } } }
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
  try { const cm = sessionStorage.getItem('cupomOk'); if (cm) { sessionStorage.removeItem('cupomOk'); setTimeout(() => (window.toast || alert)(cm), 800); } } catch {}
  $('#donoNome').textContent = me.conta.nome_dono;
  if (me.conta.admin !== 1) setTimeout(() => window.verificarOnboarding?.(), 0);
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
  $('#equipeAtiva').innerHTML = `<div class="titulo">Sua equipe</div><div class="avs">${me.modulos.map(m => avatar(m, nome(m), NOMES[m])).join('')}</div><div class="mini-n">${me.modulos.length} assessores ativos</div>`;
  $('#filtros').innerHTML = `<button class="ativo" data-f="">Todos</button>` + me.modulos.map(m => `<button data-f="${m}">${avatar(m, nome(m))}${esc(nome(m))}</button>`).join('');
  $('#filtros').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filtro = b.dataset.f || null; [...$('#filtros').children].forEach(x => x.classList.toggle('ativo', x === b)); render(); };
  $('#texto').placeholder = `Fale com ${me.modulos.map(nome).slice(0, 4).join(', ')}…`;
  carregarGuia();
  await carregar(); conectar(); setTimeout(irParaFim, 600);
  if (!location.hash || !window.telas?.[location.hash.slice(1)]) window.mostrarTela?.('hoje'); window.addEventListener('resize', () => { if (pertoDoFim($('#lista'))) irParaFim(); });
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
/** Avatar de assessor: iniciais em círculo, cor por função (sempre com o nome escrito ao lado ou no title). */
function avatar(mod, nome, papel) { const ini = String(nome || '?').replace(/[^A-Za-zÀ-ú ]/g, '').trim().slice(0, 2).toUpperCase() || '?'; return `<span class="av av-${esc(mod || 'fiel')}" title="${esc(nome)}${papel ? ' · ' + esc(papel) : ''}" aria-hidden="true">${esc(ini)}</span>`; }
function fmt(t) {
  let s = esc(t);
  s = s.replace(/^\s*#{1,6}\s+(.+)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<b>$2</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Links clicáveis: http(s), wa.me (WhatsApp), tel: (chamada), mailto: (e-mail).
  // WhatsApp e tel ganham ícone contextual na frente, não repetem a URL feia no texto do link.
  // Uma passada só: cada trecho vira link uma única vez (antes o link do WhatsApp era reprocessado e o HTML vazava no texto).
  s = s.replace(/\b(?:https?:\/\/[^\s<]+|tel:\+?\d+|mailto:[^\s<]+)/g, (bruto) => {
    const fim = (bruto.match(/[.,;:!?)\]]+$/) || [''])[0]; const u = fim ? bruto.slice(0, -fim.length) : bruto; // pontuação da frase fica fora do link
    if (/^https?:\/\/(?:api\.)?wa\.me\//i.test(u)) return `<a href="${u}" target="_blank" rel="noopener" class="link-wa">📱 Abrir WhatsApp</a>${fim}`;
    if (/^tel:/i.test(u)) return `<a href="${u}" class="link-tel">☎ Ligar</a>${fim}`;
    if (/^mailto:/i.test(u)) return `<a href="${u}" class="link-mail">✉ ${u.slice(7)}</a>${fim}`;
    return `<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>${fim}`;
  });
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
  const botoes = m.botoes ? `<div class="botoes" data-id="${m.id}">${m.botoes.flat().map(b => b.url ? `<a class="bt-link" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.t)}</a>` : `<button data-d="${esc(b.d ?? b.t)}">${esc(b.t)}</button>`).join('')}</div>` : '';
  const texto = m.texto && !(m.midia && /^\[(imagem|video|arquivo|audio)\]$/.test(m.texto)) ? fmt(m.texto) : '';
  return `<div class="msg ${m.direcao}" data-id="${m.id}">${nome ? `<div class="mod">${avatar(m.modulo, nome)}<span>${esc(nome)}</span></div>` : ''}${midia}${texto}${botoes}<div class="meta"><span>${hora}</span><span>${m.direcao === 'entrada' ? (m.canal === 'web' ? '💻 web' : '📱 telegram') : ''}</span></div></div>`;
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
    if (e.tipo === 'mensagem') { if (e.mensagem.direcao === 'saida') agendarGuia(); msgs.push(e.mensagem); $('#digitando').classList.add('oculto'); acrescentar(e.mensagem); }
    if (e.tipo === 'digitando') { $('#digitando').classList.remove('oculto'); clearTimeout(conectar._t); conectar._t = setTimeout(() => $('#digitando').classList.add('oculto'), 6000); }
  };
}

// ---------- composer ----------
// Envio com progresso (XHR): o dono vê "enviando 45%" e, se falhar, o erro e um botão para tentar de novo.
function enviarXHR(fd, aoProgresso) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', '/api/enviar'); const tk = tokenLocal(); if (tk) x.setRequestHeader('authorization', 'Bearer ' + tk);
    x.timeout = 10 * 60000;
    x.upload.onprogress = (e) => { if (e.lengthComputable && aoProgresso) aoProgresso(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => { if (x.status === 401) { mostrarLogin(); return reject(new Error('sessão expirada')); } let j = {}; try { j = JSON.parse(x.responseText); } catch {} if (x.status >= 400 || j.erro) return reject(new Error(j.erro || (x.status === 413 ? 'arquivo grande demais' : 'erro ' + x.status))); resolve(j); };
    x.onerror = () => reject(new Error('falha de conexão')); x.ontimeout = () => reject(new Error('o envio demorou demais'));
    x.send(fd);
  });
}
function avisoEnvio(nome) {
  const el = document.createElement('div'); el.className = 'envio-status'; $('#lista').appendChild(el); $('#lista').scrollTop = $('#lista').scrollHeight;
  return {
    progresso(p) { el.textContent = `📎 Enviando ${nome}… ${p}%`; },
    ok() { el.remove(); },
    erro(msg, tentar) { el.classList.add('erro'); el.innerHTML = `⚠️ Não consegui enviar <b>${esc(nome)}</b> (${esc(msg)}). <button type="button">Tentar de novo</button>`; el.querySelector('button').onclick = () => { el.remove(); tentar(); }; },
  };
}
let ultimoEnvio = { t: '', em: 0 };
async function enviar(texto, arquivo, extra = {}) {
  if (!texto && !arquivo) return;
  // Clique duplo em botão/atalho não manda a mesma mensagem duas vezes.
  if (texto && !arquivo && texto === ultimoEnvio.t && Date.now() - ultimoEnvio.em < 5000) return; if (texto && !arquivo) ultimoEnvio = { t: texto, em: Date.now() };
  const fd = new FormData(); if (texto) fd.append('texto', texto); for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  if (!arquivo) return api('/api/enviar', { method: 'POST', body: fd });
  fd.append('arquivo', arquivo, arquivo.name || 'audio.webm');
  const nome = arquivo.name || 'áudio'; const av = avisoEnvio(nome); av.progresso(0);
  try { await enviarXHR(fd, (p) => av.progresso(p)); av.ok(); return true; }
  catch (e) { av.erro(e.message, () => enviar(texto, arquivo, extra)); return false; }
}
const MAX_ANEXOS = 10, MAX_MB = 50;
let anexos = [];
$('#form').onsubmit = async (e) => {
  e.preventDefault(); const t = $('#texto').value.trim(); const lista = anexos.slice(); if (!t && !lista.length) return;
  $('#texto').value = ''; $('#texto').style.height = 'auto'; limparAnexo();
  if (!lista.length) return enviar(t);
  // vários arquivos: um envio por vez (fila), todos no mesmo "grupo" — fotos viram álbum; o texto vai junto do primeiro
  const grupo = lista.length > 1 ? 'g' + Date.now().toString(36) : '';
  for (let i = 0; i < lista.length; i++) await enviar(i === 0 ? t : '', lista[i], grupo ? { grupo } : {});
};
$('#texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#form').requestSubmit(); } });
function ajustarAltura(el) { el.style.height = 'auto'; const max = Math.min(280, Math.round(innerHeight * 0.4)); el.style.height = Math.min(max, el.scrollHeight + 2) + 'px'; el.classList.toggle('multilinha', el.scrollHeight > 48); }
$('#texto').addEventListener('input', function () { ajustarAltura(this); });
$('#anexar').onclick = () => $('#arquivo').click();
$('#arquivo').onchange = () => { adicionarAnexos($('#arquivo').files); $('#arquivo').value = ''; };
function adicionarAnexos(files) {
  const novos = [...(files || [])]; if (!novos.length) return;
  const grandes = novos.filter(f => f.size > MAX_MB * 1048576);
  if (grandes.length) alert(`${grandes.map(f => f.name).join(', ')}: acima de ${MAX_MB} MB. Suba no Google Drive e mande o link aqui.`);
  anexos = [...anexos, ...novos.filter(f => f.size <= MAX_MB * 1048576)];
  if (anexos.length > MAX_ANEXOS) { alert(`Envio até ${MAX_ANEXOS} arquivos por vez — fiquei com os ${MAX_ANEXOS} primeiros.`); anexos = anexos.slice(0, MAX_ANEXOS); }
  desenharAnexos(); $('#texto').focus();
}
function mostrarAnexo(f) { adicionarAnexos([f]); }
function desenharAnexos() {
  const p = $('#previaAnexo'); if (!anexos.length) { p.classList.add('oculto'); p.innerHTML = ''; return; }
  p.classList.remove('oculto');
  p.innerHTML = anexos.map((f, i) => { const url = URL.createObjectURL(f); const tag = f.type.startsWith('image/') ? `<img src="${url}">` : f.type.startsWith('video/') ? `<video src="${url}" muted></video>` : '<span class="ico-arq">📄</span>';
    return `<div class="anexo-item">${tag}<span>${esc(f.name)} · ${(f.size / 1048576).toFixed(1)} MB</span><button type="button" class="icone" data-i="${i}" title="Tirar">✕</button></div>`; }).join('')
    + (anexos.length > 1 ? `<div class="anexo-total">${anexos.length} arquivos — vão um por vez</div>` : '');
  p.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => { anexos.splice(Number(b.dataset.i), 1); desenharAnexos(); });
}
function limparAnexo() { anexos = []; desenharAnexos(); }
document.addEventListener('paste', (e) => { const fs = e.clipboardData?.files; if (fs?.length) adicionarAnexos(fs); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); adicionarAnexos(e.dataTransfer?.files); });

// gravação de áudio (MediaRecorder) → envia como áudio (o bot transcreve)
$('#gravar').onclick = async () => {
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' }); rec = null; $('#gravar').classList.remove('gravando'); $('#gravar').innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>'; if (blob.size > 1000) await enviar('', new File([blob], blob.type.includes('mp4') ? 'audio.m4a' : 'audio.webm', { type: blob.type })); };
    rec.start(); $('#gravar').classList.add('gravando'); $('#gravar').innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  } catch (e) { alert('Não consegui acessar o microfone: ' + e.message); }
};

// ---------- lateral / atalhos / sair ----------
$('#abrirLateral').onclick = () => $('#lateral').classList.add('aberta');
$('#fecharLateral').onclick = () => $('#lateral').classList.remove('aberta');
document.querySelectorAll('.menu a[data-tela], #tabbar a[data-tela]').forEach(a => a.onclick = () => { window.mostrarTela?.(a.dataset.tela); $('#lateral').classList.remove('aberta'); });
document.querySelector('#tabbar [data-acao="mais"]').onclick = () => $('#lateral').classList.add('aberta');
document.querySelectorAll('#chips button').forEach(b => b.onclick = () => enviar(b.dataset.cmd));
$('#sair').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); localStorage.removeItem('akm'); location.reload(); };

// PWA
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {});
iniciar();


// ---------------- PRIMEIROS PASSOS ----------------
let _guiaT = null, _guiaAberto = null;
function agendarGuia() { clearTimeout(_guiaT); _guiaT = setTimeout(carregarGuia, 1500); }
async function carregarGuia() {
  const el = $('#guia'); if (!el) return;
  let g; try { g = await api('/api/guia'); } catch { return; }
  if (!g || g.dispensado || g.completo || me?.conta?.admin === 1) { el.classList.add('oculto'); return; }
  if (_guiaAberto === null) _guiaAberto = g.feitos < 2;
  const acao = { telegram: 'Conectar', google: 'Conectar', audio: 'Gravar', post: 'Mandar foto', extrato: 'Mandar arquivo' };
  const pct = Math.round(g.feitos / g.total * 100);
  el.innerHTML = `<div class="guia-topo"><button class="guia-titulo" id="guiaAlterna" aria-expanded="${_guiaAberto}"><strong>Primeiros passos</strong><span class="guia-cont">${g.feitos} de ${g.total}</span><span class="guia-bar"><i style="width:${pct}%"></i></span><span class="guia-seta">${_guiaAberto ? '▴' : '▾'}</span></button><button class="guia-x" id="guiaX" title="Não mostrar mais">✕</button></div>
    ${_guiaAberto ? `<ol class="guia-lista">${g.passos.map(p => `<li class="${p.feito ? 'feito' : ''}"><span class="guia-check">${p.feito ? '✓' : ''}</span><div class="guia-txt"><b>${esc(p.titulo)}</b><small>${esc(p.detalhe)}</small></div>${p.feito ? '' : `<button class="btn guia-bt" data-passo="${p.id}">${acao[p.id]}</button>`}</li>`).join('')}</ol>` : ''}`;
  el.classList.remove('oculto');
  $('#guiaAlterna').onclick = () => { _guiaAberto = !_guiaAberto; carregarGuia(); };
  $('#guiaX').onclick = async () => { if (!confirm('Esconder os primeiros passos? Você ainda pode pedir ajuda ao Alfred quando quiser.')) return; await api('/api/guia/dispensar', { method: 'POST' }); el.classList.add('oculto'); };
  el.querySelectorAll('[data-passo]').forEach(b => b.onclick = () => acaoGuia(b.dataset.passo, b));
}
async function acaoGuia(passo, botao) {
  if (passo === 'telegram') return conectarTelegram(botao);
  if (passo === 'google') { botao.disabled = true; try { const d = await api('/api/conexoes'); window.open(d.google.url_autorizar, '_blank', 'noopener'); } finally { botao.disabled = false; } return; }
  if (passo === 'audio') { $('#gravar')?.click(); return; }
  if (passo === 'post') { const t = $('#texto'); t.value = 'MIA, post sobre '; t.focus(); $('#arquivo').setAttribute('accept', 'image/*'); $('#arquivo').click(); setTimeout(() => $('#arquivo').setAttribute('accept', 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx'), 1000); return; }
  if (passo === 'extrato') { const t = $('#texto'); t.value = 'Tina, extrato da empresa '; t.focus(); $('#arquivo').setAttribute('accept', '.ofx,.csv,.pdf,.xls,.xlsx'); $('#arquivo').click(); setTimeout(() => $('#arquivo').setAttribute('accept', 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx'), 1000); return; }
}
async function conectarTelegram(botao) {
  if (botao) botao.disabled = true;
  let r; try { r = await api('/api/telegram/vincular', { method: 'POST' }); } finally { if (botao) botao.disabled = false; }
  if (!r?.link) return alert('Não consegui gerar o código agora. Tente de novo em instantes.');
  const d = document.createElement('dialog'); d.className = 'guia-dialogo';
  d.innerHTML = `<h3>Conectar o Telegram</h3><p>Toque no botão abaixo. O Telegram abre na conversa com o Fiel: toque em <b>Iniciar</b> e pronto.</p>
    <a class="btn prim" href="${r.link}" target="_blank" rel="noopener">Abrir o Telegram</a>
    <p class="d">No computador sem o app? Procure <b>@${esc(r.bot)}</b> no Telegram e mande:<br><code>vincular ${esc(r.codigo)}</code><br>O código vale ${r.validade_min} minutos.</p>
    <button class="btn" id="guiaFecharDlg">Fechar</button>`;
  document.body.appendChild(d); d.showModal();
  const iv = setInterval(async () => { try { const g = await api('/api/guia'); if (g.passos.find(p => p.id === 'telegram')?.feito) { clearInterval(iv); d.querySelector('h3').textContent = '✅ Telegram conectado'; d.querySelector('p').textContent = 'Agora é só falar com a equipe por lá também — texto ou áudio.'; carregarGuia(); } } catch {} }, 4000);
  d.querySelector('#guiaFecharDlg').onclick = () => { clearInterval(iv); d.close(); d.remove(); };
}
window.conectarTelegram = conectarTelegram;
