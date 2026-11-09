// Telas de configuração do app: Equipe e Conexões. Usa api()/esc() de app.js (global).
const telas = {};
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
async function post(url, body) { const r = await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (r.erro) { toast('⚠️ ' + r.erro); throw new Error(r.erro); } return r; }
async function del(url) { return api(url, { method: 'DELETE' }); }
const sel = (nome, opcoes, atual) => `<select name="${nome}">${opcoes.map(o => `<option ${o === atual ? 'selected' : ''}>${o}</option>`).join('')}</select>`;

function mostrarTela(nome) {
  const principal = $('#principal'); const cfg = $('#tela-config');
  document.querySelectorAll('.menu a').forEach(a => a.classList.toggle('ativo', a.dataset.tela === nome));
  if (nome === 'conversa') { principal.classList.remove('modo-config'); cfg.classList.add('oculto'); cfg.innerHTML = ''; irParaFim(); return; }
  if (!telas[nome]) { toast('Essa tela entra na próxima etapa.'); return; }
  principal.classList.add('modo-config'); cfg.classList.remove('oculto'); cfg.innerHTML = '<p class="sub">carregando…</p>';
  telas[nome]().then(html => { cfg.innerHTML = `<h1><button class="icone" id="voltarConversa">☰</button>${html.titulo}</h1><p class="sub">${html.sub || ''}</p>${html.corpo}`; $('#voltarConversa').onclick = () => $('#lateral').classList.add('aberta'); html.depois?.(); });
}

// ---------------- EQUIPE ----------------
telas.equipe = async () => {
  const d = await api('/api/equipe'); const o = d.opcoes;
  const cartaoModulo = (m) => { const p = m.persona || {}; const nomePad = m.nome; return `
    <div class="cartao" data-mod="${m.id}">
      <h3><span>${esc(p.nome || nomePad)} <span class="tag">${m.nome}</span></span>${m.fixo ? '<span class="tag ok">sempre ativo</span>' : `<label class="chave"><input type="checkbox" class="liga" ${m.ligado ? 'checked' : ''}> ${m.ligado ? 'ligado' : 'desligado'}</label>`}</h3>
      <p class="d">${m.desc}</p>
      <form class="persona">
        <div class="linha2"><div class="campo"><label>Nome da persona</label><input name="nome" value="${esc(p.nome || '')}" placeholder="${nomePad}"></div><div class="campo"><label>Como te chama</label>${sel('tratamento', o.tratamento, p.tratamento || 'primeiro nome')}</div></div>
        <div class="linha2"><div class="campo"><label>Tom</label>${sel('tom', o.tom, p.tom || 'direto')}</div><div class="campo"><label>Tamanho das respostas</label>${sel('tamanho', o.tamanho, p.tamanho || 'curta')}</div></div>
        <div class="linha2"><div class="campo"><label>Autonomia</label>${sel('autonomia', o.autonomia, p.autonomia || 'confirma ação externa')}</div><div class="campo"><label>Proatividade</label>${sel('proatividade', o.proatividade, p.proatividade || 'essencial')}</div></div>
        ${m.id === 'diretor' ? `<div class="linha2"><div class="campo"><label>Perfil de análise</label>${sel('perfil_analise', o.perfil_analise, p.perfil_analise || 'equilibrado')}</div><div class="campo"><label>Resumo do dia às</label><input name="hora_resumo" type="time" value="${esc((p.hora_resumo || '07:00').replace('h', ':00').padStart(5, '0'))}"></div></div>` : ''}
        ${m.id === 'secretaria' ? `<div class="linha2"><div class="campo"><label>Retornos às</label><input name="hora_retornos" type="time" value="${esc((p.hora_retornos || '18:00').replace('h', ':00').padStart(5, '0'))}"></div><div class="campo"><label>Fechamento às</label><input name="hora_fechamento" type="time" value="${esc((p.hora_fechamento || '20:00').replace('h', ':00').padStart(5, '0'))}"></div></div>` : ''}
        <div style="display:flex;align-items:center;gap:10px;margin-top:6px"><label class="chave"><input type="checkbox" name="emojis" ${p.emojis ? 'checked' : ''}> usa emojis</label><button class="btn prim" type="submit" style="margin-left:auto">Salvar</button><span class="salvo"></span></div>
      </form>
    </div>`; };
  const corpo = `
    <div class="grade">
      <div class="cartao"><h3>Dono e empresa</h3><form id="fConta">
        <div class="linha2"><div class="campo"><label>Seu nome</label><input name="nome_dono" value="${esc(d.conta.nome_dono || '')}"></div><div class="campo"><label>Empresa principal</label><input name="empresa" value="${esc(d.conta.empresa || '')}"></div></div>
        <div class="campo"><label>Foco do mês</label><input name="foco_mes" value="${esc(d.conta.foco_mes || '')}" placeholder="ex.: tirar o operacional da Mais Têxtil"></div>
        <div class="campo"><label>Janela de silêncio</label><input name="janela_silencio" value="${esc(d.conta.janela_silencio || '')}" placeholder="22h–6h e domingo"></div>
        <div style="display:flex;align-items:center"><button class="btn prim" type="submit">Salvar</button><span class="salvo"></span></div></form></div>
      <div class="cartao"><h3>Pessoas no Telegram <span class="tag">${d.pessoas.length}</span></h3><p class="d">Recebem recados e tarefas pela Secretária; respondem e marcam "feito".</p>
        <ul class="lista-s" id="pessoas">${d.pessoas.map(p => `<li><span>${esc(p.nome)}</span><button class="btn perigo" data-rm="${p.id}">remover</button></li>`).join('') || '<li>Ninguém ainda.</li>'}</ul>
        ${d.convites.length ? `<p class="d" style="margin-top:10px">Convites pendentes:</p><ul class="lista-s">${d.convites.map(c => `<li><span>${esc(c.nome)} · <code>entrar ${c.codigo}</code></span><button class="btn perigo" data-rmc="${c.codigo}">cancelar</button></li>`).join('')}</ul>` : ''}
        <form id="fConvite" style="display:flex;gap:8px;margin-top:10px"><input name="nome" placeholder="Nome da pessoa" style="flex:1;font:inherit;padding:9px 10px;border:1px solid var(--sec);border-radius:10px;background:var(--fundo);color:var(--texto)"><button class="btn prim">Convidar</button></form>
        <p class="d" id="convResultado" style="margin-top:8px"></p></div>
    </div>
    <h2 style="font-size:16px;margin:22px 0 10px">Assessores</h2>
    <div class="grade">${d.modulos.map(cartaoModulo).join('')}</div>`;
  return { titulo: '👥 Equipe', sub: 'Ligue módulos, dê nome e ajuste o jeito de cada assessor. Vale na hora, no Telegram e aqui.', corpo, depois() {
    $('#fConta').onsubmit = async (e) => { e.preventDefault(); await post('/api/equipe/conta', Object.fromEntries(new FormData(e.target))); e.target.querySelector('.salvo').textContent = 'salvo ✓'; };
    document.querySelectorAll('.cartao[data-mod]').forEach(c => {
      const mod = c.dataset.mod;
      c.querySelector('.liga')?.addEventListener('change', async (e) => { await post('/api/equipe/modulo', { modulo: mod, ligado: e.target.checked }); e.target.parentElement.lastChild.textContent = e.target.checked ? ' ligado' : ' desligado'; toast(e.target.checked ? 'Módulo ligado' : 'Módulo desligado'); iniciar(); });
      c.querySelector('form.persona').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.emojis = e.target.emojis.checked; await post('/api/equipe/persona', { modulo: mod, ...f }); e.target.querySelector('.salvo').textContent = 'salvo ✓'; c.querySelector('h3 span').firstChild.textContent = (f.nome || c.querySelector('input[name=nome]').placeholder) + ' '; iniciar(); };
    });
    $('#fConvite').onsubmit = async (e) => { e.preventDefault(); const nome = e.target.nome.value.trim(); if (!nome) return; const r = await post('/api/equipe/convite', { nome }); $('#convResultado').innerHTML = `Peça para <b>${esc(nome)}</b> abrir @${r.bot} e mandar: <code>entrar ${r.codigo}</code>`; e.target.reset(); };
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (!confirm('Remover esta pessoa da equipe?')) return; await del('/api/equipe/pessoa/' + b.dataset.rm); mostrarTela('equipe'); });
    document.querySelectorAll('[data-rmc]').forEach(b => b.onclick = async () => { await del('/api/equipe/convite/' + b.dataset.rmc); mostrarTela('equipe'); });
  } };
};

// ---------------- CONEXÕES ----------------
telas.conexoes = async () => {
  const d = await api('/api/conexoes');
  const esc_ = (ok, t) => `<span class="tag ${ok ? 'ok' : 'off'}">${t}</span>`;
  const g = d.google, ig = d.instagram;
  const diasIg = ig.expira_em ? Math.ceil((new Date(ig.expira_em) - Date.now()) / 864e5) : null;
  const corpo = `<div class="grade">
    <div class="cartao"><h3>Google ${g.conectado ? '<span class="tag ok">conectado</span>' : '<span class="tag off">não conectado</span>'}</h3>
      <p class="d">Agenda, Gmail, Drive, Tasks e Planilhas na sua conta Google.</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${esc_(g.escopos.agenda, 'Agenda')}${g.modo === 'completo' ? esc_(g.escopos.gmail_ler, 'Gmail ler') : ''}${esc_(g.escopos.gmail_enviar, 'Gmail enviar')}${esc_(g.escopos.planilhas, 'Planilhas')}${esc_(g.escopos.drive, g.escopos.drive_total ? 'Drive' : 'Drive (arquivos do Fiel)')}${esc_(g.escopos.tasks, 'Tarefas')}</div>${g.modo === 'completo' ? '' : '<p class="d" style="font-size:12px;margin-top:8px">Por segurança, o Fiel não lê sua caixa de entrada e só abre no Drive os arquivos que ele guardou ou que você liberar.</p><div>'}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="btn prim" href="${g.url_autorizar}" target="_blank" rel="noopener">${g.conectado ? 'Reautorizar (novos escopos)' : 'Conectar Google'}</a>${g.conectado ? '<button class="btn perigo" id="descGoogle">desconectar</button>' : ''}</div></div>
    <div class="cartao"><h3>Telegram ${d.telegram ? '<span class="tag ok">conectado</span>' : '<span class="tag off">não conectado</span>'}</h3>
      <p class="d">Fale com a equipe pelo celular, por texto ou áudio. A conversa é a mesma do app.</p>
      ${d.telegram ? '' : '<div style="margin-top:12px"><button class="btn prim" id="conTelegram">Conectar Telegram</button></div>'}</div>
    <div class="cartao"><h3>Instagram ${ig.conectado ? (ig.ok ? `<span class="tag ok">@${esc(ig.username)}</span>` : '<span class="tag off">token inválido</span>') : '<span class="tag off">não conectado</span>'}</h3>
      <p class="d">${ig.conectado ? (ig.ok ? `Conta ${esc(ig.tipo || '')} · token ${diasIg != null ? (diasIg > 0 ? `vence em ${diasIg} dias (${ig.expira_em.split('-').reverse().join('/')})` : 'vencido') : ''}` : esc(ig.erro || '')) : 'Publicação de posts, Reels e Stories pela MIA.'}</p>
      ${diasIg != null && diasIg <= 7 ? '<p class="d"><span class="tag warn">renove o token</span></p>' : ''}
      ${!ig.conectado && ig.liberacao?.status !== 'liberado' ? `<form id="fIgLib" class="campo"><label>@ do Instagram para liberação (o suporte do Fiel libera em até 12 h)</label><input name="arroba" value="${esc(ig.liberacao?.arroba || '')}" placeholder="@suaempresa"><div style="margin-top:6px"><button class="btn prim">${ig.liberacao?.status === 'pendente' ? 'Atualizar @' : 'Enviar para liberação'}</button></div>${ig.liberacao?.status === 'pendente' ? `<p class="d">✅ Pedido enviado para ${esc(ig.liberacao.arroba)} — você recebe um aviso quando for liberado.</p>` : ''}</form>` : ''}
      ${ig.liberacao?.status === 'liberado' && !ig.conectado ? `<p class="d">✅ ${esc(ig.liberacao.arroba)} liberado. Aceite o convite em <a href="https://www.instagram.com/accounts/manage_access/" target="_blank" rel="noopener">Apps e sites → Convites de testador</a> e toque em Conectar.</p>` : ''}
      ${ig.url_autorizar ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn prim" type="button" id="conIg">${ig.conectado ? 'Reconectar Instagram' : 'Conectar Instagram'}</button></div><p class="d" style="margin-top:6px">Perfil Profissional. Enquanto a Meta libera o Fiel, o seu @ precisa estar cadastrado como testador e o convite aceito no Instagram (Configurações → Apps e sites → Convites de testador).</p>` : ''}
      <details${ig.url_autorizar ? '' : ' open'}><summary class="d" style="cursor:pointer;margin-top:8px">Conectar com token (avançado)</summary>
      <form id="fIg" class="campo"><label>Token de acesso do Instagram (IGAA…)</label><input name="token" placeholder="IGAA…" autocomplete="off"><div style="display:flex;gap:8px;margin-top:6px"><button class="btn prim">Salvar token</button>${ig.conectado ? '<button class="btn perigo" type="button" id="descIg">desconectar</button>' : ''}</div></form></details></div>
    <div class="cartao"><h3>Documentos no Drive ${d.drive.pasta_id ? '<span class="tag ok">pasta definida</span>' : '<span class="tag warn">padrão KM/Assessor/Documentos</span>'}</h3>
      <p class="d">Raiz onde o módulo Documentos cria Empresa / Tipo / Ano.${d.drive.link ? ` <a href="${d.drive.link}" target="_blank">abrir pasta</a>` : ''}</p>
      <form id="fDrive" class="campo"><label>Link da pasta</label><input name="link" placeholder="https://drive.google.com/drive/folders/…"><div><button class="btn prim" style="margin-top:6px">Usar esta pasta</button></div></form></div>
    <div class="cartao"><h3>Empresas</h3><p class="d">Nomes exatos das pastas por empresa. Documento pessoal vai para "PF".</p>
      <form id="fEmp" class="campo"><textarea name="empresas" rows="3" placeholder="Mais Têxtil, Douglas Confecções, KM, Forzz, Valora Imóveis, 3D Ultimate">${esc(d.empresas.join(', '))}</textarea><div><button class="btn prim" style="margin-top:6px">Salvar</button></div></form></div>
    <div class="cartao"><h3>Planilhas Google <span class="tag">${d.planilhas.length}</span></h3><p class="d">Cadastradas para a Secretária lançar e consultar.</p>
      <ul class="lista-s">${d.planilhas.map(p => `<li><span><a href="${p.link}" target="_blank">${esc(p.nome)}</a> <small style="color:var(--mudo)">· ${esc(p.aba_padrao)} · ${p.cabecalhos.slice(0, 5).map(esc).join(', ')}</small></span><button class="btn perigo" data-rmp="${esc(p.nome)}">remover</button></li>`).join('') || '<li>Nenhuma.</li>'}</ul>
      <form id="fPlan" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><input name="link" placeholder="Link do Google Sheets" style="grid-column:1/-1;font:inherit;padding:9px 10px;border:1px solid var(--sec);border-radius:10px;background:var(--fundo);color:var(--texto)"><input name="nome" placeholder="Nome curto (ex.: gastos PF)" style="font:inherit;padding:9px 10px;border:1px solid var(--sec);border-radius:10px;background:var(--fundo);color:var(--texto)"><button class="btn prim">Cadastrar</button></form></div>
    <div class="cartao"><h3>Inteligência e serviços</h3>
      <ul class="lista-s"><li><span>Modelos Gemini</span><span>${d.ia.modelos.map(esc).join(' → ') || '—'}</span></li><li><span>Modelo rápido</span><span>${esc(d.ia.rapido || '—')}</span></li><li><span>Imagens por IA (fal.ai)</span>${esc_(d.ia.fal, d.ia.fal ? 'ativo' : 'sem chave')}</li><li><span>Hospedagem de mídia (Cloudinary)</span>${esc_(d.ia.cloudinary, d.ia.cloudinary ? 'ativo' : 'sem chave')}</li><li><span>AgilFac</span>${esc_(d.agilfac.configurado, d.agilfac.configurado ? 'configurado' : 'aguardando API')}</li></ul>
      <p class="d" style="margin-top:8px">Chaves ficam no servidor (.env). Edição por conta entra na tela Ajustes.</p></div>
  </div>`;
  return { titulo: '🔌 Conexões', sub: 'Serviços ligados à sua conta. O status é verificado ao vivo.', corpo, depois() {
    $('#fIg').onsubmit = async (e) => { e.preventDefault(); const r = await post('/api/conexoes/instagram', { token: e.target.token.value }); toast('Instagram conectado: @' + r.username); mostrarTela('conexoes'); };
    $('#descIg') && ($('#descIg').onclick = async () => { if (confirm('Desconectar o Instagram? Posts agendados vão falhar até reconectar.')) { await del('/api/conexoes/instagram'); mostrarTela('conexoes'); } });
    $('#fIgLib') && ($('#fIgLib').onsubmit = async (e) => { e.preventDefault(); const r = await post('/api/instagram/liberacao', { arroba: e.target.arroba.value }); toast(`Pedido enviado: ${r.arroba} — liberação em até 12 h`); mostrarTela('conexoes'); });
    $('#conIg') && ($('#conIg').onclick = () => { const w = window.open(ig.url_autorizar, 'fielInstagram', 'width=520,height=720'); if (!w) location.href = ig.url_autorizar; const f = (ev) => { if (String(ev.data).startsWith('fiel:instagram-')) { window.removeEventListener('message', f); if (ev.data === 'fiel:instagram-ok') { toast('Instagram conectado'); mostrarTela('conexoes'); } } }; window.addEventListener('message', f); });
    $('#conTelegram') && ($('#conTelegram').onclick = (e) => window.conectarTelegram(e.target));
    $('#descGoogle') && ($('#descGoogle').onclick = async () => { if (confirm('Desconectar o Google? Agenda, Gmail, Drive e Tasks param de funcionar até reconectar.')) { await del('/api/conexoes/google'); mostrarTela('conexoes'); } });
    $('#fDrive').onsubmit = async (e) => { e.preventDefault(); const r = await post('/api/conexoes/drive', { link: e.target.link.value }); toast('Pasta: ' + r.nome); mostrarTela('conexoes'); };
    $('#fEmp').onsubmit = async (e) => { e.preventDefault(); await post('/api/conexoes/empresas', { empresas: e.target.empresas.value }); toast('Empresas salvas'); };
    $('#fPlan').onsubmit = async (e) => { e.preventDefault(); const r = await post('/api/conexoes/planilha', { link: e.target.link.value, nome: e.target.nome.value }); toast(`Planilha "${r.nome}" cadastrada`); mostrarTela('conexoes'); };
    document.querySelectorAll('[data-rmp]').forEach(b => b.onclick = async () => { await del('/api/conexoes/planilha/' + encodeURIComponent(b.dataset.rmp)); mostrarTela('conexoes'); });
  } };
};

window.mostrarTela = mostrarTela;

// ---------------- IDENTIDADE & MARCA ----------------
const ROTULOS_ID = { perfil: 'Perfil', nicho: 'Nicho / posicionamento', publico: 'Público', tom: 'Tom de voz', pilares: 'Pilares', hashtags_fixas: 'Hashtags fixas (3)', hashtags_pilar: 'Hashtags por pilar', ctas: 'CTAs por objetivo', agenda: 'Agenda de publicação', fase: 'Fase atual', formatos: 'Formatos', cores: 'Cores', tipografia: 'Tipografia', provas: 'Provas de autoridade', series: 'Séries', descricao: 'Observações' };
telas.marca = async () => {
  const d = await api('/api/marca'); const id = d.identidade || {};
  const val = (k) => { const v = id[k]; return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v, null, 1).replace(/[{}"]/g, '').replace(/,\n/g, '\n').trim() : String(v)); };
  const campo = (k, rows = 2) => `<div class="campo"><label>${ROTULOS_ID[k]}</label><textarea name="${k}" rows="${rows}">${esc(val(k))}</textarea></div>`;
  const cores = ['#37414E', '#C8CFD7', '#FFFFFF', '#000000', '#B9964B'];
  const k = d.kit || {}; const kc = k.cores || {}; const kl = k.logos || {};
  const slotLogo = (v, rot, bg) => `<div class="logo-slot"><div class="logo-prev" style="background:${bg}">${kl[v] ? `<img src="${esc(kl[v])}" alt="">` : '<span>sem logo</span>'}</div><div class="d" style="font-size:12px;margin:4px 0">${rot}</div><label class="btn" style="font-size:12px;padding:5px 10px;cursor:pointer">${kl[v] ? 'Trocar' : 'Enviar'}<input type="file" accept="image/png,image/jpeg,image/webp" data-logo="${v}" hidden></label>${kl[v] ? ` <button class="btn perigo" style="font-size:12px;padding:5px 10px" data-rmlogo="${v}">remover</button>` : ''}</div>`;
  const corInput = (key, rot, ajuda) => `<div class="campo"><label>${rot}</label><div style="display:flex;gap:8px;align-items:center"><input type="color" data-cor="${key}" value="${esc(kc[key] || '#ffffff')}" style="width:44px;height:36px;padding:0;border:1px solid var(--sec);border-radius:8px;${kc[key] ? '' : 'opacity:.45'}"><input name="cor_${key}" value="${esc(kc[key] || '')}" placeholder="${ajuda}" style="flex:1"></div></div>`;
  const kitCard = `<div class="cartao" style="grid-column:1/-1"><h3>Kit visual da sua marca <span class="tag">usado em carrossel, frase e story</span></h3>
      <p class="d">As artes da MIA saem com estas cores, este @ e esta logo. Também dá para mandar o manual da marca no chat: "MIA, este é o manual da minha marca".</p>
      <form id="fKit"><div class="grade">
        <div class="campo"><label>Nome da marca</label><input name="nome" value="${esc(k.nome || '')}" placeholder="Ex.: Valora Imóveis"></div>
        <div class="campo"><label>@ do Instagram</label><input name="assinatura" value="${esc(k.assinatura || '')}" placeholder="@suamarca"></div>
        ${corInput('fundo', 'Cor de fundo das artes', 'ex.: #2B2B2B')}${corInput('destaque', 'Cor de destaque', 'ex.: #D9542F')}${corInput('titulo', 'Cor do título (opcional)', 'automática')}${corInput('apoio', 'Cor do texto de apoio (opcional)', 'automática')}
      </div>
      <div class="campo" style="margin:12px 0"><label>Logo da empresa nas imagens</label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="radio" name="logo_modo" value="sempre" ${k.marca_dagua_auto ? 'checked' : ''}> <b>Sempre</b> — fotos que eu enviar, imagens geradas por IA, retoques e banners</label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="radio" name="logo_modo" value="pedir" ${k.marca_dagua_auto ? '' : 'checked'}> <b>Só quando eu pedir</b></label>
        <label style="margin-top:6px">Posição</label><select name="logo_posicao">${['inferior-direito', 'inferior-esquerdo', 'superior-direito', 'superior-esquerdo'].map(p => `<option value="${p}" ${(k.logo_posicao || 'inferior-direito') === p ? 'selected' : ''}>${p.replace('-', ' ')}</option>`).join('')}</select>
        ${d.logos?.length ? '' : '<p class="d">⚠️ Envie a logo abaixo para a opção "Sempre" funcionar.</p>'}<p class="d">Carrossel, frase e story já saem com a logo pelo layout da marca.</p></div>
      <div style="display:flex;align-items:center;gap:10px"><button class="btn prim">Salvar kit</button><span class="salvo"></span></div></form>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:16px;align-items:flex-start">
        ${slotLogo('principal', 'Logo principal', '#F3F3F3')}${slotLogo('claro', 'Versão clara (fundo escuro)', '#2B2B2B')}${slotLogo('escuro', 'Versão escura (fundo claro)', '#FFFFFF')}
        <div style="margin-left:auto"><p class="d">Prévia ao vivo (story "frase")</p><img id="previaMarca" src="" style="height:260px;border-radius:12px;background:var(--fundo);display:block"><div style="display:flex;gap:6px;margin-top:6px"><input id="previaTexto" value="Seu próximo imóvel começa *aqui*" style="flex:1"><button class="btn" id="gerarPrevia" type="button">Gerar</button></div></div>
      </div></div>`;
  const corpo = `<div class="grade">
    ${d.km ? '' : kitCard}${d.km ? `<div class="cartao" style="grid-column:1/-1"><h3>Padrão visual <span class="tag">regra dura</span></h3>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
        <div><p class="d">Cores</p><div style="display:flex;gap:8px">${cores.map(c => `<div title="${c}" style="width:40px;height:40px;border-radius:10px;background:${c};border:1px solid var(--sec)"></div>`).join('')}</div><p class="d" style="margin-top:6px">#37414E fundo · #C8CFD7 apoio · branco títulos · dourado #B9964B só UMA palavra</p></div>
        <div><p class="d">Logos (marca d'água automática, cor pela luminosidade)</p><div style="display:flex;gap:10px">${d.logos.map((l, i) => `<div style="padding:10px;border-radius:10px;background:${['#FFFFFF', '#37414E', '#000000'][i]}"><img src="${l}" style="height:36px"></div>`).join('')}</div></div>
        <div><p class="d">Tipografia</p><div style="font-family:Poppins;font-weight:700;font-size:22px">Poppins Bold <span style="color:#B9964B">dourado</span></div><p class="d">Regular para texto · etiqueta Bold caixa alta</p></div>
        <div style="margin-left:auto"><p class="d">Prévia ao vivo (story "frase do dia")</p><img id="previaMarca" src="" style="height:260px;border-radius:12px;background:var(--fundo);display:block"><div style="display:flex;gap:6px;margin-top:6px"><input id="previaTexto" value="Processo não é burocracia, é *liberdade*" style="flex:1;font:inherit;padding:6px 8px;border:1px solid var(--sec);border-radius:8px;background:var(--fundo);color:var(--texto)"><button class="btn sec" id="gerarPrevia">Gerar</button></div></div>
      </div></div>` : ''}
    <div class="cartao" style="grid-column:1/-1"><h3>Identidade (o que a MIA usa em toda peça) ${d.atualizado_em ? `<span class="tag">atualizado ${esc(d.atualizado_em.slice(0, 10).split('-').reverse().join('/'))}</span>` : ''}</h3>
      <form id="fId"><div class="grade">${['perfil', 'nicho', 'publico', 'tom', 'pilares', 'series'].map(k => campo(k, 3)).join('')}${['hashtags_fixas', 'hashtags_pilar', 'ctas', 'provas'].map(k => campo(k, 4)).join('')}${['agenda', 'fase', 'formatos', 'cores', 'tipografia', 'descricao'].map(k => campo(k, 2)).join('')}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px"><button class="btn prim">Salvar identidade</button><span class="salvo"></span><span class="d" style="font-size:12px;color:var(--mudo)">Hashtags por pilar e CTAs: uma linha por item, "chave: valor".</span></div></form></div>
    ${d.admin ? '' : '<!--'}<div class="cartao" style="grid-column:1/-1"><h3>Regras operacionais do manual <span class="tag">entra no prompt da MIA</span></h3>
      <p class="d">É o trecho do Manual da Marca que a MIA carrega ao criar conteúdo. Edite com cuidado; o arquivo anterior fica salvo como .bak.</p>
      <form id="fRegras"><textarea name="regras" rows="16" style="width:100%;font:13px/1.5 ui-monospace,Menlo,monospace;padding:10px;border:1px solid var(--sec);border-radius:10px;background:var(--fundo);color:var(--texto)">${esc(d.regras_operacionais)}</textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px"><button class="btn prim">Salvar regras</button><span class="salvo"></span></div></form></div>${d.admin ? '' : '-->'}
  </div>`;
  return { titulo: '✨ Identidade & Marca', sub: 'Tudo que define como a MIA escreve e desenha. Mudou aqui, vale no próximo post.', corpo, depois() {
    const gerar = async () => { const t = $('#previaTexto').value; const m = t.match(/\*([^*]+)\*/); const r = await fetch('/api/marca/previa', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokenLocal() }, body: JSON.stringify({ modelo: 'frase', texto: t.replace(/\*/g, ''), palavra_dourada: m ? m[1] : null }) }); if (r.ok) $('#previaMarca').src = URL.createObjectURL(await r.blob()); else toast('render indisponível'); };
    $('#gerarPrevia').onclick = gerar; gerar();
    $('#fId').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); for (const k of ['hashtags_pilar', 'ctas']) { const linhas = (f[k] || '').split('\n').map(x => x.trim()).filter(x => x.includes(':')); if (linhas.length) f[k] = Object.fromEntries(linhas.map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })); } await post('/api/marca/identidade', f); e.target.querySelector('.salvo').textContent = 'salvo ✓'; };
    if ($('#fKit')) {
      document.querySelectorAll('[data-cor]').forEach(i => i.oninput = () => { const t = document.querySelector(`[name=cor_${i.dataset.cor}]`); t.value = i.value.toUpperCase(); i.style.opacity = 1; });
      $('#fKit').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target);
        const r = await post('/api/marca/kit', { nome: f.get('nome'), assinatura: f.get('assinatura'), marca_dagua_auto: f.get('logo_modo') === 'sempre', logo_posicao: f.get('logo_posicao'), cores: { fundo: f.get('cor_fundo'), destaque: f.get('cor_destaque'), titulo: f.get('cor_titulo'), apoio: f.get('cor_apoio') } });
        e.target.querySelector('.salvo').textContent = r?.erro ? r.erro : 'salvo ✓'; gerar(); };
      document.querySelectorAll('[data-logo]').forEach(inp => inp.onchange = async () => { const f = inp.files[0]; if (!f) return; if (f.size > 8e6) return toast('Imagem acima de 8 MB');
        const b64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(f); });
        toast('Enviando logo…'); const r = await post('/api/marca/kit/logo', { imagem_b64: b64, variante: inp.dataset.logo }); if (r?.erro) return toast(r.erro); mostrarTela('marca'); });
      document.querySelectorAll('[data-rmlogo]').forEach(b => b.onclick = async () => { if (!confirm('Remover esta logo?')) return; await del('/api/marca/kit/logo/' + b.dataset.rmlogo); mostrarTela('marca'); });
    }
    $('#fRegras') && ($('#fRegras').onsubmit = async (e) => { e.preventDefault(); await post('/api/marca/regras', { regras: e.target.regras.value }); e.target.querySelector('.salvo').textContent = 'salvo ✓'; });
  } };
};

// ---------------- AJUSTES ----------------
telas.ajustes = async () => {
  const d = await api('/api/ajustes'); const a = d.ajustes;
  const fmtN = (n) => (n || 0).toLocaleString('pt-BR');
  const maxDia = Math.max(1, ...d.uso.por_dia.map(x => x.t || 0));
  const corpo = `<div class="grade">
    <div class="cartao"><h3>Preferências da MIA</h3><form id="fAj">
      <div class="campo"><label>Grade de horários sugeridos (separe por vírgula)</label><input name="grade_horarios" value="${esc(a.grade_horarios.join(', '))}"></div>
      <div class="linha2"><div class="campo"><label>Vídeo: áudio por padrão</label><select name="video_sem_audio_padrao"><option value="true" ${a.video_sem_audio_padrao ? 'selected' : ''}>retirar (story mudo)</option><option value="false" ${!a.video_sem_audio_padrao ? 'selected' : ''}>manter</option></select></div><div class="campo"><label>Faixa do letreiro (vídeo)</label><select name="story_posicao_faixa">${['base', 'rodape', 'topo', 'meio'].map(o => `<option ${a.story_posicao_faixa === o ? 'selected' : ''}>${o}</option>`).join('')}</select><div class="mini">Foto de story: faixa sempre no rodapé (padrão fixo).</div></div></div>
      <div class="linha2"><div class="campo"><label>Biblioteca: apagar após (dias)</label><input name="retencao_biblioteca_dias" type="number" min="1" max="365" value="${a.retencao_biblioteca_dias}"></div><div class="campo"><label>Marcador na agenda (posts)</label><input name="marcador_social" value="${esc(a.marcador_social)}"></div></div>
      <div style="display:flex;align-items:center;gap:10px"><button class="btn prim">Salvar</button><span class="salvo"></span></div></form></div>
    <div class="cartao"><h3>Documentos</h3><form id="fAj2">
      <div class="linha2"><div class="campo"><label>Marcador de vencimentos</label><input name="marcador_vencimentos" value="${esc(a.marcador_vencimentos)}"></div><div class="campo"><label>Avisos (dias antes)</label><input name="avisos_vencimento" value="${esc(a.avisos_vencimento.join(', '))}"></div></div>
      <div class="linha2"><div class="campo"><label>Hora dos avisos</label><input name="hora_vencimentos" type="time" value="${esc(a.hora_vencimentos)}"></div><div class="campo"><label>Hora da limpeza da biblioteca</label><input name="hora_limpeza" type="time" value="${esc(a.hora_limpeza)}"></div></div>
      <div style="display:flex;align-items:center;gap:10px"><button class="btn prim">Salvar</button><span class="salvo"></span></div><p class="d" style="margin-top:8px">Horários de rotina exigem reinício do bot para valer (deploy).</p></form></div>
    <div class="cartao"><h3>Uso e custo (30 dias)</h3>
      <ul class="lista-s"><li><span>Mensagens enviadas</span><b>${fmtN(d.uso.mensagens_30d)}</b></li><li><span>Chamadas de IA</span><b>${fmtN(d.uso.por_modulo.reduce((s, x) => s + x.n, 0))}</b></li><li><span>Tokens (entrada / saída)</span><b>${fmtN(d.uso.por_modulo.reduce((s, x) => s + (x.tin || 0), 0))} / ${fmtN(d.uso.por_modulo.reduce((s, x) => s + (x.tout || 0), 0))}</b></li><li><span>Custo estimado Gemini</span><b>US$ ${d.uso.custo_usd_30d.toFixed(2)} ≈ R$ ${(d.uso.custo_usd_30d * 5.5).toFixed(2)}</b></li></ul>
      <p class="d" style="margin-top:10px">Por assessor</p><ul class="lista-s">${d.uso.por_modulo.map(x => `<li><span>${esc(x.modulo || '—')}</span><span>${fmtN(x.n)} chamadas · ${fmtN((x.tin || 0) + (x.tout || 0))} tokens</span></li>`).join('') || '<li>Sem registros ainda (começa a contar a partir desta versão).</li>'}</ul>
      <p class="d" style="margin-top:10px">Últimos 14 dias</p><div style="display:flex;align-items:flex-end;gap:3px;height:60px">${d.uso.por_dia.map(x => `<div title="${x.d}: ${fmtN(x.t)} tokens" style="flex:1;background:var(--ouro);border-radius:3px 3px 0 0;height:${Math.max(3, Math.round((x.t || 0) / maxDia * 60))}px"></div>`).join('') || '<span class="d">—</span>'}</div></div>
    <div class="cartao"><h3>Dados</h3><ul class="lista-s"><li><span>Posts (publicados)</span><b>${d.contagens.posts} (${d.contagens.publicados})</b></li><li><span>Documentos arquivados</span><b>${d.contagens.documentos}</b></li><li><span>Mídias na biblioteca</span><b>${d.contagens.biblioteca}</b></li><li><span>Lembretes pendentes</span><b>${d.contagens.lembretes}</b></li></ul>
      <p class="d" style="margin-top:10px">Servidor: modelos ${esc(d.servidor.modelos.join(' → ') || '—')} · rápido ${esc(d.servidor.rapido || '—')} · fuso ${esc(d.servidor.tz)} · versão ${esc(d.servidor.versao)}</p></div>
    <div class="cartao"><h3>Backups <button class="btn sec" id="btBackup">Fazer backup agora</button></h3><p class="d">Diário às 04:00 → servidor + Google Drive (Fiel/Backups). 10 últimos em cada.</p>
      <ul class="lista-s">${d.backups.map(b => `<li><span>${esc(b.nome)}</span><span>${b.mb} MB</span></li>`).join('') || '<li>Nenhum backup local ainda.</li>'}</ul><p class="d" id="bkSaida" style="margin-top:8px"></p></div>
    <div class="cartao" style="grid-column:1/-1"><h3>Últimas interações (log)</h3><div id="logs" class="d">carregando…</div></div>
  </div>`;
  return { titulo: '⚙️ Ajustes', sub: 'Preferências por conta, uso de IA, dados e backups.', corpo, depois() {
    const salvar = async (e, campos) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const body = {}; for (const k of campos) { let v = f[k]; if (k === 'grade_horarios') v = v.split(/[,;\s]+/).filter(x => /^\d{1,2}:\d{2}$/.test(x)); if (k === 'avisos_vencimento') v = v.split(/[,;\s]+/).map(Number).filter(n => n >= 0); if (k === 'video_sem_audio_padrao') v = v === 'true'; if (k === 'retencao_biblioteca_dias') v = Number(v); body[k] = v; } await post('/api/ajustes', body); e.target.querySelector('.salvo').textContent = 'salvo ✓'; };
    $('#fAj').onsubmit = (e) => salvar(e, ['grade_horarios', 'video_sem_audio_padrao', 'story_posicao_faixa', 'retencao_biblioteca_dias', 'marcador_social']);
    $('#fAj2').onsubmit = (e) => salvar(e, ['marcador_vencimentos', 'avisos_vencimento', 'hora_vencimentos', 'hora_limpeza']);
    $('#btBackup').onclick = async () => { $('#bkSaida').textContent = 'gerando… (até 1 min)'; const r = await post('/api/ajustes/backup', {}); $('#bkSaida').textContent = (r.saida || []).join(' · '); setTimeout(() => mostrarTela('ajustes'), 1500); };
    api('/api/ajustes/logs').then(l => { $('#logs').innerHTML = `<ul class="lista-s">${l.map(x => `<li style="flex-direction:column;align-items:flex-start;gap:2px"><span style="font-size:11px;color:var(--mudo)">${esc(x.em)} · ${esc(x.modulo || '')}</span><span>→ ${esc(x.entrada)}</span><span style="color:var(--mudo)">← ${esc(x.saida)}</span></li>`).join('')}</ul>`; });
  } };
};

// ---------------- CALENDÁRIO EDITORIAL ----------------
const ICONE_FMT = { post: '🖼', carrossel: '🎠', reels: '🎞', story: '📣' };
const COR_ST = { agendado: 'var(--ouro)', publicado: '#4CAF7A', rascunho: 'var(--sec)', erro: '#E25D5D' };
let edMes = null; let edAba = 'calendario';
telas.editorial = async () => {
  const hoje = new Date(); if (!edMes) edMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const ini = new Date(edMes.getFullYear(), edMes.getMonth(), 1), fim = new Date(edMes.getFullYear(), edMes.getMonth() + 1, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const posts = await api(`/api/editorial?de=${iso(ini)}&ate=${iso(fim)}`);
  const porDia = {}; const rascunhos = [];
  for (const p of posts) { if (!p.data) rascunhos.push(p); else (porDia[p.data.slice(0, 10)] ||= []).push(p); }
  const mini = (p) => `<div class="post-mini" draggable="${p.status !== 'publicado'}" data-id="${p.id}" style="border-left:3px solid ${COR_ST[p.status] || 'var(--sec)'}" title="${esc(p.tema || p.legenda || '')}">${p.midias[0] && !p.video ? `<img src="${p.midias[0]}" loading="lazy">` : `<span class="fmt">${ICONE_FMT[p.formato] || '📄'}</span>`}<span class="t">${p.data ? p.data.slice(11, 16) + ' ' : ''}${esc((p.tema || p.legenda || p.formato).slice(0, 34))}</span></div>`;
  const primeiro = (ini.getDay() + 6) % 7; const dias = []; for (let i = 0; i < primeiro; i++) dias.push('<div class="dia-cel vazio"></div>');
  for (let d = 1; d <= fim.getDate(); d++) { const k = iso(new Date(edMes.getFullYear(), edMes.getMonth(), d)); const eh = k === iso(hoje); dias.push(`<div class="dia-cel ${eh ? 'hoje' : ''}" data-dia="${k}"><div class="n">${d}</div>${(porDia[k] || []).map(mini).join('')}</div>`); }
  const nomeMes = edMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const corpo = `
    <div class="abas"><button class="${edAba === 'calendario' ? 'ativo' : ''}" data-aba="calendario">📅 Calendário</button><button class="${edAba === 'biblioteca' ? 'ativo' : ''}" data-aba="biblioteca">📚 Biblioteca</button></div>
    <div id="abaCal" class="${edAba === 'calendario' ? '' : 'oculto'}">
      <div class="cal-topo"><button class="btn sec" id="mesAnt">‹</button><b style="text-transform:capitalize">${nomeMes}</b><button class="btn sec" id="mesProx">›</button><span class="d" style="margin-left:auto;font-size:12px;color:var(--mudo)">arraste um post para outro dia · clique para editar · <span style="color:var(--ouro)">■</span> agendado <span style="color:#4CAF7A">■</span> publicado <span style="color:#E25D5D">■</span> erro</span></div>
      <div class="cal-cab">${['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(x => `<div>${x}</div>`).join('')}</div>
      <div class="cal-grade" id="calGrade">${dias.join('')}</div>
      <div class="cartao" style="margin-top:14px"><h3>Rascunhos (sem data) <span class="tag">${rascunhos.length}</span></h3><div class="rascunhos" id="rascunhos">${rascunhos.map(mini).join('') || '<span class="d">Nenhum. Arraste um post para cá para tirar da fila.</span>'}</div></div>
    </div>
    <div id="abaBib" class="${edAba === 'biblioteca' ? '' : 'oculto'}"><div id="bibLista" class="bib-grade"><span class="d">carregando…</span></div></div>
    <div id="modal" class="modal oculto"></div>`;
  return { titulo: '📅 Calendário editorial', sub: 'Posts da MIA: fila, publicados e rascunhos. Mudanças aqui atualizam a agenda e a publicação automática.', corpo, depois() {
    document.querySelectorAll('.abas button').forEach(b => b.onclick = () => { edAba = b.dataset.aba; mostrarTela('editorial'); });
    $('#mesAnt').onclick = () => { edMes = new Date(edMes.getFullYear(), edMes.getMonth() - 1, 1); mostrarTela('editorial'); };
    $('#mesProx').onclick = () => { edMes = new Date(edMes.getFullYear(), edMes.getMonth() + 1, 1); mostrarTela('editorial'); };
    // drag & drop
    let arrastando = null;
    document.querySelectorAll('.post-mini[draggable=true]').forEach(el => { el.ondragstart = (e) => { arrastando = el.dataset.id; e.dataTransfer.effectAllowed = 'move'; }; });
    const alvos = [...document.querySelectorAll('.dia-cel:not(.vazio)'), $('#rascunhos')];
    alvos.forEach(al => { al.ondragover = (e) => { e.preventDefault(); al.classList.add('sobre'); }; al.ondragleave = () => al.classList.remove('sobre'); al.ondrop = async (e) => { e.preventDefault(); al.classList.remove('sobre'); if (!arrastando) return; const p = posts.find(x => x.id == arrastando); const dia = al.dataset.dia; if (!dia) { await post(`/api/editorial/${arrastando}`, { data: null }); toast(`#${arrastando} virou rascunho`); } else { const hora = p?.data ? p.data.slice(11, 16) : '19:00'; await post(`/api/editorial/${arrastando}`, { data: `${dia}T${hora}` }); toast(`#${arrastando} → ${dia.split('-').reverse().slice(0, 2).join('/')} ${hora}`); } mostrarTela('editorial'); }; });
    document.querySelectorAll('.post-mini').forEach(el => el.onclick = () => abrirPost(posts.find(x => x.id == el.dataset.id)));
    if (edAba === 'biblioteca') carregarBiblioteca();
  } };
};
function abrirPost(p) {
  const m = $('#modal'); m.classList.remove('oculto');
  m.innerHTML = `<div class="modal-card"><div class="modal-topo"><b>${ICONE_FMT[p.formato] || ''} Post #${p.id} <span class="tag">${p.status}</span></b><button class="icone" id="fecharModal">✕</button></div>
    <div class="modal-corpo"><div class="modal-midia">${p.midias.length ? (p.video ? `<video src="${p.midias[0]}" controls playsinline></video>` : p.midias.map(u => `<img src="${u}">`).join('')) : '<span class="d">sem mídia</span>'}</div>
    <form id="fPost" class="modal-form">
      <div class="linha2"><div class="campo"><label>Formato</label><select name="formato">${['post', 'carrossel', 'reels', 'story'].map(f => `<option ${p.formato === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div><div class="campo"><label>Pilar</label><select name="pilar">${['', 'GESTÃO', 'NEGÓCIOS', 'IA', 'AUTOMAÇÃO'].map(f => `<option ${(p.pilar || '') === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div></div>
      <div class="campo"><label>Tema</label><input name="tema" value="${esc(p.tema || '')}"></div>
      <div class="campo"><label>Legenda</label><textarea name="legenda" rows="7">${esc(p.legenda || '')}</textarea></div>
      <div class="campo"><label>Hashtags</label><input name="hashtags" value="${esc(p.hashtags || '')}"></div>
      <div class="campo"><label>Data e hora (vazio = rascunho)</label><input name="data" type="datetime-local" value="${esc(p.data || '')}"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">${p.status !== 'publicado' ? `<button class="btn prim" type="submit">Salvar</button><button class="btn sec" type="button" id="pubAgora">Publicar agora</button><button class="btn perigo" type="button" id="apagarPost">Apagar</button>` : `<span class="d">Publicado em ${esc((p.publicado_em || '').slice(0, 16))} · ${esc(p.ig_media_id || '')}</span>`}<span class="salvo"></span></div>
    </form></div></div>`;
  $('#fecharModal').onclick = () => m.classList.add('oculto'); m.onclick = (e) => { if (e.target === m) m.classList.add('oculto'); };
  $('#fPost').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await post(`/api/editorial/${p.id}`, { ...f, data: f.data || null }); toast('Post salvo'); m.classList.add('oculto'); mostrarTela('editorial'); };
  $('#pubAgora') && ($('#pubAgora').onclick = async () => { if (!confirm(`Publicar o post #${p.id} no Instagram agora?`)) return; try { const r = await post(`/api/editorial/${p.id}/publicar`, {}); toast('Publicado: ' + r.ig_media_id); } catch {} m.classList.add('oculto'); mostrarTela('editorial'); });
  $('#apagarPost') && ($('#apagarPost').onclick = async () => { if (!confirm(`Apagar o post #${p.id}?`)) return; await del(`/api/editorial/${p.id}`); m.classList.add('oculto'); mostrarTela('editorial'); });
}
async function carregarBiblioteca() {
  const itens = await api('/api/biblioteca'); const el = $('#bibLista');
  el.innerHTML = itens.map(b => `<div class="bib-item" data-id="${b.id}">${b.tipo === 'video' ? `<video src="${b.url}" muted playsinline preload="metadata"></video>` : `<img src="${b.url}" loading="lazy">`}
    <div class="bib-info"><div class="bib-desc">${esc(b.descricao || b.tipo)}</div><div class="d" style="font-size:11px">${b.tipo}${b.duracao ? ` · ${Math.round(b.duracao)}s` : ''} · ${esc(b.em.slice(5, 10).split('-').reverse().join('/'))} ${b.usada ? '· usada' : ''} · ${b.protegida ? '🔒 guardada' : (b.dias_restantes <= 0 ? '⏳ apaga hoje' : `⏳ ${b.dias_restantes}d`)}</div>
    <div class="bib-acoes"><button class="btn sec" data-usar="${b.id}">Criar post</button><button class="btn sec" data-prot="${b.id}" data-v="${b.protegida ? 0 : 1}">${b.protegida ? 'Liberar' : 'Guardar'}</button><button class="btn perigo" data-apagar="${b.id}">Apagar</button></div></div></div>`).join('') || '<span class="d">Biblioteca vazia.</span>';
  el.querySelectorAll('[data-prot]').forEach(b => b.onclick = async () => { await post(`/api/biblioteca/${b.dataset.prot}`, { protegida: b.dataset.v === '1' }); carregarBiblioteca(); });
  el.querySelectorAll('[data-apagar]').forEach(b => b.onclick = async () => { if (!confirm('Apagar esta mídia da biblioteca e do armazenamento?')) return; try { await del(`/api/biblioteca/${b.dataset.apagar}`); } catch {} carregarBiblioteca(); });
  el.querySelectorAll('[data-usar]').forEach(b => b.onclick = async () => { const it = itens.find(x => x.id == b.dataset.usar); const formato = prompt('Formato (post, reels, story):', it.tipo === 'video' ? 'reels' : 'story'); if (!formato) return; const data = prompt('Data e hora (AAAA-MM-DDTHH:MM) ou vazio para rascunho:', ''); const r = await post(`/api/biblioteca/${it.id}/post`, { formato, data: data || undefined }); toast(`Post #${r.id} criado (${r.status})`); edAba = 'calendario'; mostrarTela('editorial'); });
}

// ---------------- DOCUMENTOS ----------------
let docAba = 'arquivo'; let docFiltro = { q: '', empresa: '', tipo: '' };
telas.documentos = async () => {
  const corpo = `<div class="abas"><button class="${docAba === 'arquivo' ? 'ativo' : ''}" data-aba="arquivo">📂 Arquivo</button><button class="${docAba === 'vencimentos' ? 'ativo' : ''}" data-aba="vencimentos">⏰ Vencimentos</button><button class="${docAba === 'cadastros' ? 'ativo' : ''}" data-aba="cadastros">👤 Cadastros</button></div><div id="docCorpo"><span class="d">carregando…</span></div><div id="modal" class="modal oculto"></div>`;
  return { titulo: '📂 Documentos', sub: 'O que está arquivado no seu Drive, o que vence e quem está cadastrado.', corpo, depois() {
    document.querySelectorAll('.abas button').forEach(b => b.onclick = () => { docAba = b.dataset.aba; mostrarTela('documentos'); });
    ({ arquivo: docArquivo, vencimentos: docVencimentos, cadastros: docCadastros })[docAba]();
  } };
};
async function docArquivo() {
  const d = await api(`/api/documentos?q=${encodeURIComponent(docFiltro.q)}&empresa=${encodeURIComponent(docFiltro.empresa)}&tipo=${encodeURIComponent(docFiltro.tipo)}`);
  $('#docCorpo').innerHTML = `<div class="filtro-linha"><input id="dq" placeholder="Buscar por título, contraparte, conteúdo…" value="${esc(docFiltro.q)}"><select id="dEmp"><option value="">Todas as empresas</option>${d.empresas.map(e => `<option ${docFiltro.empresa === e.empresa ? 'selected' : ''} value="${esc(e.empresa)}">${esc(e.empresa)} (${e.n})</option>`).join('')}</select><select id="dTipo"><option value="">Todos os tipos</option>${d.tipos.map(t => `<option ${docFiltro.tipo === t.tipo ? 'selected' : ''} value="${esc(t.tipo)}">${esc(t.tipo)} (${t.n})</option>`).join('')}</select>${d.pasta_raiz ? `<a class="btn sec" href="${d.pasta_raiz}" target="_blank">Abrir pasta no Drive</a>` : ''}</div>
    <p class="d" style="margin:6px 0 10px">${d.docs.length} documento(s). Para arquivar um novo, mande a foto/PDF na Conversa (ou pelo Telegram).</p>
    <div class="tabela"><table><thead><tr><th>Data</th><th>Título</th><th>Empresa</th><th>Tipo</th><th>Contraparte</th><th></th></tr></thead><tbody>${d.docs.map(x => `<tr data-id="${x.id}"><td>${esc((x.data || '').split('-').reverse().join('/'))}</td><td>${x.sensivel ? '🔒 ' : ''}${esc(x.titulo)}<div class="d" style="font-size:11px">${esc((x.resumo || '').slice(0, 90))}</div></td><td>${esc(x.empresa)}</td><td>${esc(x.tipo)}</td><td>${esc(x.contraparte || '')}</td><td style="white-space:nowrap"><a class="btn sec" href="${x.link}" target="_blank">abrir</a> <button class="btn sec" data-ed="${x.id}">editar</button></td></tr>`).join('')}</tbody></table></div>`;
  const aplicar = () => { docFiltro = { q: $('#dq').value, empresa: $('#dEmp').value, tipo: $('#dTipo').value }; docArquivo(); };
  $('#dq').onkeydown = (e) => { if (e.key === 'Enter') aplicar(); }; $('#dEmp').onchange = aplicar; $('#dTipo').onchange = aplicar;
  document.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const x = d.docs.find(y => y.id == b.dataset.ed); const m = $('#modal'); m.classList.remove('oculto');
    m.innerHTML = `<div class="modal-card"><div class="modal-topo"><b>Documento #${x.id}</b><button class="icone" id="fecharModal">✕</button></div><form id="fDoc" class="modal-form" style="padding:14px">
      <div class="campo"><label>Título</label><input name="titulo" value="${esc(x.titulo)}"></div><div class="linha2"><div class="campo"><label>Empresa</label><input name="empresa" value="${esc(x.empresa)}"></div><div class="campo"><label>Tipo</label><select name="tipo">${['Contratos', 'Fiscal', 'Pessoal', 'Veículos', 'Licenças', 'Imóveis', 'Financeiro', 'Jurídico', 'Seguros', 'Outros'].map(t => `<option ${x.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      <div class="linha2"><div class="campo"><label>Contraparte</label><input name="contraparte" value="${esc(x.contraparte || '')}"></div><div class="campo"><label>Data</label><input name="data" type="date" value="${esc(x.data || '')}"></div></div>
      <p class="d">Mudar empresa/tipo/ano move o arquivo de pasta no Drive.</p><button class="btn prim">Salvar</button></form></div>`;
    $('#fecharModal').onclick = () => m.classList.add('oculto'); $('#fDoc').onsubmit = async (e) => { e.preventDefault(); await post(`/api/documentos/${x.id}`, Object.fromEntries(new FormData(e.target))); toast('Documento atualizado'); m.classList.add('oculto'); docArquivo(); }; });
}
async function docVencimentos() {
  const v = await api('/api/vencimentos');
  const cls = (d) => d < 0 ? 'off' : d <= 7 ? 'warn' : 'ok';
  $('#docCorpo').innerHTML = `<div class="cartao" style="margin-bottom:12px"><h3>Nova vigência / validade</h3><form id="fVig" class="linha2" style="grid-template-columns:2fr 1fr 1fr 1fr auto;align-items:end"><div class="campo"><label>Descrição</label><input name="descricao" required placeholder="Alvará Mais Têxtil"></div><div class="campo"><label>Empresa</label><input name="empresa"></div><div class="campo"><label>Vence em</label><input name="vence_em" type="date" required></div><div class="campo"><label>Aviso prévio (dias)</label><input name="aviso_previo_dias" type="number" value="0"></div><button class="btn prim" style="margin-bottom:8px">Registrar</button></form></div>
    <div class="tabela"><table><thead><tr><th>Vence</th><th>Descrição</th><th>Empresa</th><th>Dias</th><th></th></tr></thead><tbody>${v.map(x => `<tr><td>${esc(x.vence_em.split('-').reverse().join('/'))}</td><td>${esc(x.descricao)}${x.renovacao_auto ? ' <span class="tag">renova auto</span>' : ''}${x.aviso_previo_dias ? ` <span class="tag">aviso ${x.aviso_previo_dias}d</span>` : ''}${x.link ? ` <a href="${x.link}" target="_blank">doc</a>` : ''}</td><td>${esc(x.empresa || '')}</td><td><span class="tag ${cls(x.dias)}">${x.dias < 0 ? `venceu há ${-x.dias}d` : x.dias === 0 ? 'hoje' : `${x.dias}d`}</span></td><td style="white-space:nowrap"><button class="btn sec" data-ren="${x.id}">Renovar</button> <button class="btn perigo" data-enc="${x.id}">Encerrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="d">Nenhuma vigência ativa.</td></tr>'}</tbody></table></div>`;
  $('#fVig').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.aviso_previo_dias = Number(f.aviso_previo_dias || 0); await post('/api/vencimentos', f); toast('Vigência registrada (avisos 30/7/1 + agenda)'); docVencimentos(); };
  document.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => { const nd = prompt('Nova data de vencimento (AAAA-MM-DD):'); if (!nd) return; await post(`/api/vencimentos/${b.dataset.ren}/encerrar`, { nova_data: nd }); docVencimentos(); });
  document.querySelectorAll('[data-enc]').forEach(b => b.onclick = async () => { if (!confirm('Encerrar esta vigência (para de avisar)?')) return; await post(`/api/vencimentos/${b.dataset.enc}/encerrar`, {}); docVencimentos(); });
}
async function docCadastros(q = '') {
  const c = await api(`/api/cadastros?q=${encodeURIComponent(q)}`);
  $('#docCorpo').innerHTML = `<div class="filtro-linha"><input id="cq" placeholder="Buscar nome, CNPJ/CPF, e-mail, telefone" value="${esc(q)}"><button class="btn prim" id="novoCad">+ Novo cadastro</button></div>
    <div class="tabela"><table><thead><tr><th>Tipo</th><th>Nome</th><th>Documento</th><th>Contato</th><th>Vínculo</th><th></th></tr></thead><tbody>${c.map(x => `<tr><td>${esc(x.tipo || '')}</td><td>${esc(x.nome)}${x.completo ? '' : ' <span class="tag warn">incompleto</span>'}</td><td>${esc(x.documento || '')}</td><td>${esc([x.email, x.telefone].filter(Boolean).join(' · '))}</td><td>${esc(x.empresa_vinculo || '')}</td><td style="white-space:nowrap"><button class="btn sec" data-edc='${esc(JSON.stringify(x))}'>editar</button> <button class="btn perigo" data-rmc="${x.id}">remover</button></td></tr>`).join('') || '<tr><td colspan="6" class="d">Nenhum cadastro.</td></tr>'}</tbody></table></div>`;
  $('#cq').onkeydown = (e) => { if (e.key === 'Enter') docCadastros($('#cq').value); };
  const form = (x = {}) => { const m = $('#modal'); m.classList.remove('oculto');
    m.innerHTML = `<div class="modal-card"><div class="modal-topo"><b>${x.id ? 'Editar' : 'Novo'} cadastro</b><button class="icone" id="fecharModal">✕</button></div><form id="fCad" class="modal-form" style="padding:14px">
      <div class="linha2"><div class="campo"><label>Tipo</label><select name="tipo">${['cliente', 'fornecedor', 'colaborador', 'prestador', 'outro'].map(t => `<option ${x.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="campo"><label>Nome</label><input name="nome" required value="${esc(x.nome || '')}"></div></div>
      <div class="linha2"><div class="campo"><label>CNPJ/CPF</label><input name="documento" value="${esc(x.documento || '')}"></div><div class="campo"><label>Empresa vinculada</label><input name="empresa_vinculo" value="${esc(x.empresa_vinculo || '')}"></div></div>
      <div class="linha2"><div class="campo"><label>E-mail</label><input name="email" value="${esc(x.email || '')}"></div><div class="campo"><label>Telefone</label><input name="telefone" value="${esc(x.telefone || '')}"></div></div>
      <div class="campo"><label>Endereço</label><input name="endereco" value="${esc(x.endereco || '')}"></div><button class="btn prim">Salvar</button></form></div>`;
    $('#fecharModal').onclick = () => m.classList.add('oculto'); $('#fCad').onsubmit = async (e) => { e.preventDefault(); await post('/api/cadastros', Object.fromEntries(new FormData(e.target))); toast('Cadastro salvo'); m.classList.add('oculto'); docCadastros($('#cq')?.value || ''); }; };
  $('#novoCad').onclick = () => form();
  document.querySelectorAll('[data-edc]').forEach(b => b.onclick = () => form(JSON.parse(b.dataset.edc)));
  document.querySelectorAll('[data-rmc]').forEach(b => b.onclick = async () => { if (!confirm('Remover cadastro?')) return; await del(`/api/cadastros/${b.dataset.rmc}`); docCadastros($('#cq').value); });
}

// ---------------- CRÉDITOS ----------------
telas.creditos = async () => {
  const d = await api('/api/creditos'); const fmtC = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const pct = d.ilimitada ? 100 : Math.max(0, Math.min(100, d.saldo / (d.base || 1) * 100));
  const cor = d.ilimitada ? '#4CAF7A' : pct <= 5 ? '#E25D5D' : pct <= 20 ? '#E0A030' : 'var(--ouro)';
  const maxDia = Math.max(1, ...d.por_dia.map(x => x.gasto || 0));
  const TIPO = { trial: 'Boas-vindas', compra: 'Compra', plano: 'Plano mensal', credito: 'Crédito', ajuste: 'Ajuste', debito: 'Consumo' };
  const corpo = `<div class="grade">
    <div class="cartao" style="grid-column:1/-1">
      <h3>Saldo <span class="tag ${d.ilimitada ? 'ok' : pct <= 5 ? 'off' : pct <= 20 ? 'warn' : ''}">${d.ilimitada ? 'conta ilimitada (admin)' : d.plano === 'trial' ? 'período de teste' : 'plano ' + esc(d.plano || '')}</span></h3>
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:40px;font-weight:700">${d.ilimitada ? '∞' : fmtC(d.saldo)}</span><span class="d" style="font-size:14px">créditos${d.dias_restantes != null ? ` · no ritmo atual, dá para ~${d.dias_restantes} dias` : ''}</span></div>
      <div class="saldo-barra"><div style="width:${pct}%;background:${cor}"></div></div>
      <p class="d" style="margin-top:8px">1 crédito = ${d.tokens_por_credito.toLocaleString('pt-BR')} tokens de IA. Story ou arte ${d.tarifas.render_story}, carrossel ${d.tarifas.render_carrossel}, edição de vídeo ${d.tarifas.video_edicao}, imagem gerada por IA ${d.tarifas.fal_imagem}, áudio de vídeo ${d.tarifas.video_audio}. Agenda e publicações programadas não param quando o saldo zera.</p>
    </div>
    <div class="cartao"><h3>Comprar créditos ${d.asaas ? (d.ambiente === 'producao' ? '' : '<span class="tag warn">sandbox</span>') : '<span class="tag off">pagamento indisponível</span>'}</h3><p class="d">Pix ou cartão via Asaas. Créditos pré-pagos não vencem; o plano mensal renova todo mês e soma créditos ao saldo.</p>
      ${d.assinatura ? `<p class="d">Plano ativo: <b>${esc(d.assinatura.pacote?.nome || d.assinatura.pacote_id)}</b> · próxima cobrança ${esc(d.assinatura.proxima || '')} <button class="btn perigo" id="btCancelarPlano" style="margin-left:6px">cancelar plano</button></p>` : ''}
      <div class="pacotes">${d.pacotes.map(p => `<button class="pacote" data-id="${p.id}" ${!d.asaas ? 'disabled' : ''}><b>${esc(p.nome)}</b><span>${p.creditos.toLocaleString('pt-BR')} créditos</span><span class="preco">R$ ${p.preco}${p.tipo === 'mensal' ? '<small>/mês</small>' : ''}</span></button>`).join('')}</div>
      <div id="compra" class="oculto" style="margin-top:12px;border-top:1px solid var(--sec);padding-top:12px"></div>
      ${d.cobrancas.length ? `<p class="d" style="margin-top:12px">Cobranças</p><ul class="lista-s">${d.cobrancas.slice(0, 8).map(c => `<li><span>${esc(c.criado_em.slice(0, 10))} · ${esc(NOMES_PAC(d, c.pacote_id))} · R$ ${c.valor}</span><span><span class="tag ${c.status === 'pago' ? 'ok' : c.status === 'pendente' ? 'warn' : 'off'}">${esc(c.status)}</span>${c.status === 'pendente' && c.invoice_url ? ` <a href="${esc(c.invoice_url)}" target="_blank" rel="noopener">pagar</a>` : ''}</span></li>`).join('')}</ul>` : ''}
    </div>
    <div class="cartao"><h3>Consumo (30 dias)</h3>
      <ul class="lista-s"><li><span>Total gasto</span><b>${fmtC(d.gasto_30d)}</b></li><li><span>Média por dia</span><b>${fmtC(d.media_dia)}</b></li></ul>
      <p class="d" style="margin-top:10px">Por assessor</p><ul class="lista-s">${d.por_modulo.map(x => `<li><span>${esc(NOMES[x.modulo] || x.modulo)}</span><span>${fmtC(x.gasto)} · ${x.n} usos</span></li>`).join('') || '<li>Sem consumo ainda.</li>'}</ul>
      <p class="d" style="margin-top:10px">Por tipo</p><ul class="lista-s">${d.por_tipo.map(x => `<li><span>${esc(x.item || '—')}</span><span>${fmtC(x.gasto)}</span></li>`).join('') || '<li>—</li>'}</ul>
      <p class="d" style="margin-top:10px">Por dia</p><div style="display:flex;align-items:flex-end;gap:3px;height:60px">${d.por_dia.map(x => `<div title="${x.d}: ${fmtC(x.gasto)} créditos" style="flex:1;background:var(--ouro);border-radius:3px 3px 0 0;height:${Math.max(3, Math.round((x.gasto || 0) / maxDia * 60))}px"></div>`).join('') || '<span class="d">—</span>'}</div></div>
    <div class="cartao" style="grid-column:1/-1"><h3>Histórico</h3><div class="tabela"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Descrição</th><th>Assessor</th><th style="text-align:right">Créditos</th></tr></thead><tbody>
      ${d.historico.map(h => `<tr><td>${esc(h.criado_em.slice(0, 16).replace('T', ' '))}</td><td><span class="tag ${h.quantidade > 0 ? 'ok' : ''}">${TIPO[h.tipo] || esc(h.tipo)}</span></td><td>${esc(h.motivo || '')}${h.ref && h.ref.startsWith('tokens:') ? ` <small style="color:var(--mudo)">${Number(h.ref.slice(7)).toLocaleString('pt-BR')} tokens</small>` : ''}</td><td>${esc(NOMES[h.modulo] || h.modulo || '')}</td><td style="text-align:right;${h.quantidade > 0 ? 'color:#1E7A45' : ''}">${h.quantidade > 0 ? '+' : ''}${fmtC(h.quantidade)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma movimentação.</td></tr>'}
    </tbody></table></div></div>
  </div>`;
  return { titulo: '💳 Créditos', sub: `Saldo, consumo e recargas do ${esc(d.produto)}.`, corpo, depois() {
    let poll = null;
    const mostrarCobranca = (cb) => {
      const box = $('#compra'); box.classList.remove('oculto');
      box.innerHTML = `<h3 style="font-size:15px;margin:0 0 6px">${esc(cb.pacote?.nome || cb.pacote_id)} · R$ ${cb.valor}${cb.tipo === 'mensal' ? '/mês' : ''} <span class="tag warn" id="cbStatus">aguardando pagamento</span></h3>
        ${cb.pix_qr ? `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start"><img src="data:image/png;base64,${cb.pix_qr}" alt="QR Pix" style="width:180px;height:180px;border-radius:8px;border:1px solid var(--sec)"><div style="flex:1;min-width:200px"><p class="d">Abra o app do banco, escolha Pix → ler QR code, ou use o copia e cola:</p><textarea readonly id="pixCopia" rows="4" style="width:100%;font:12px monospace;padding:8px;border:1px solid var(--sec);border-radius:8px">${esc(cb.pix_payload)}</textarea><div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><button class="btn prim" id="btCopiar">Copiar código Pix</button>${cb.invoice_url ? `<a class="btn sec" href="${esc(cb.invoice_url)}" target="_blank" rel="noopener">Abrir fatura</a>` : ''}</div></div></div>`
          : `<p class="d">Conclua o pagamento na fatura segura do Asaas (cartão de crédito${cb.forma === 'boleto' ? ' / boleto' : ''}).</p><a class="btn prim" href="${esc(cb.invoice_url)}" target="_blank" rel="noopener">Abrir fatura e pagar</a>`}
        <p class="d" style="margin-top:8px">Assim que o pagamento for confirmado, os créditos entram sozinhos (esta tela atualiza).</p>`;
      const bc = $('#btCopiar'); if (bc) bc.onclick = async () => { try { await navigator.clipboard.writeText(cb.pix_payload); toast('Código Pix copiado'); } catch { $('#pixCopia').select(); document.execCommand('copy'); toast('Código Pix copiado'); } };
      clearInterval(poll); poll = setInterval(async () => { try { const r = await api(`/api/creditos/cobranca/${cb.asaas_id}`); if (r.status === 'pago') { clearInterval(poll); $('#cbStatus').textContent = 'pago ✓'; $('#cbStatus').className = 'tag ok'; toast(`+${Number(r.creditos).toLocaleString('pt-BR')} créditos`); setTimeout(() => { mostrarTela('creditos'); iniciar?.(); }, 1500); } else if (r.status !== 'pendente') { clearInterval(poll); $('#cbStatus').textContent = r.status; $('#cbStatus').className = 'tag off'; } } catch {} }, 5000);
    };
    document.querySelectorAll('.pacote').forEach(b => b.onclick = () => {
      const p = d.pacotes.find(x => x.id === b.dataset.id); const pg = d.pagador || {}; const box = $('#compra'); box.classList.remove('oculto');
      box.innerHTML = `<form id="fCompra"><h3 style="font-size:15px;margin:0 0 6px">${esc(p.nome)} · ${p.creditos.toLocaleString('pt-BR')} créditos · R$ ${p.preco}${p.tipo === 'mensal' ? '/mês' : ''}</h3>
        <div class="linha2"><div class="campo"><label>Forma de pagamento</label><select name="forma">${p.tipo === 'mensal' ? '<option value="cartao">Cartão de crédito (renova sozinho)</option><option value="pix">Pix (todo mês você paga o QR)</option>' : '<option value="pix">Pix (na hora)</option><option value="cartao">Cartão de crédito</option><option value="boleto">Boleto</option>'}</select></div><div class="campo"><label>CPF ou CNPJ do pagador</label><input name="cpf_cnpj" required value="${esc(pg.cpf_cnpj || '')}" placeholder="000.000.000-00"></div></div>
        <div class="linha2"><div class="campo"><label>Nome / razão social</label><input name="nome" value="${esc(pg.nome || '')}"></div><div class="campo"><label>E-mail (recibo)</label><input name="email" type="email" value="${esc(pg.email || '')}"></div></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn prim">Gerar cobrança</button><button type="button" class="btn sec" id="btCancelarCompra">cancelar</button><span class="salvo" id="compraEst"></span></div></form>`;
      $('#btCancelarCompra').onclick = () => { box.classList.add('oculto'); box.innerHTML = ''; };
      $('#fCompra').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); $('#compraEst').textContent = 'gerando…'; try { const cb = await post('/api/creditos/comprar', { pacote_id: p.id, ...f }); mostrarCobranca(cb); } catch { $('#compraEst').textContent = ''; } };
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const bcp = $('#btCancelarPlano'); if (bcp) bcp.onclick = async () => { if (!confirm('Cancelar o plano mensal? Os créditos já recebidos continuam no saldo.')) return; await post('/api/creditos/assinatura/cancelar', {}); toast('Plano cancelado'); mostrarTela('creditos'); };
  } };
};
const NOMES_PAC = (d, id) => d.pacotes.find(p => p.id === id)?.nome || id;

// ---------------- MINHA CONTA ----------------
telas.conta = async () => {
  const d = await api('/api/me'); const c = d.conta;
  const corpo = `<div class="grade">
    <div class="cartao"><h3>Dados da conta</h3>
      <ul class="lista-s"><li><span>Nome</span><b>${esc(c.nome_dono)}</b></li><li><span>Empresa</span><b>${esc(c.empresa || '—')}</b></li><li><span>E-mail</span><b>${esc(c.email || '—')}</b></li><li><span>CPF/CNPJ</span><b>${esc(c.cpf_cnpj || '—')}</b></li><li><span>Plano</span><b>${esc(c.plano || 'trial')}</b></li>${c.admin ? '<li><span>Perfil</span><b>👑 Administrador do Fiel</b></li>' : ''}</ul>
      <p class="d" style="margin-top:10px">Para alterar nome, empresa ou CPF/CNPJ, use a tela <b>Equipe → Conta</b>.</p>
    </div>
    <div class="cartao"><h3>Trocar senha</h3>
      <form id="fSenha"><div class="campo"><label>Senha atual</label><input name="atual" type="password" required></div><div class="campo"><label>Nova senha (mín. 8 caracteres)</label><input name="nova" type="password" minlength="8" required></div><button class="btn prim">Trocar senha</button> <span class="salvo" id="senhaMsg"></span></form>
    </div>
    <div class="cartao"><h3>Sair</h3><p class="d">Encerra sua sessão neste navegador.</p><button class="btn sec" id="btSair2">Sair do Fiel</button></div>
  </div>`;
  return { titulo: '👤 Minha conta', sub: 'Seus dados, senha e sessão.', corpo, depois() {
    $('#fSenha').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); $('#senhaMsg').textContent = ''; try { const r = await post('/api/senha', f); $('#senhaMsg').textContent = '✅ senha trocada'; e.target.reset(); } catch { $('#senhaMsg').textContent = ''; } };
    $('#btSair2').onclick = async () => { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { authorization: 'Bearer ' + tokenLocal() } }); localStorage.removeItem('akm'); location.reload(); };
  } };
};

// link direto para uma tela (ex.: /app#conexoes vindo do aviso de Instagram liberado)
window.addEventListener('load', () => { const h = location.hash.slice(1); if (h && telas[h]) setTimeout(() => { try { mostrarTela(h); } catch {} }, 800); });
