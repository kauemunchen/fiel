// Telas de configuração do app: Equipe e Conexões. Usa api()/esc() de app.js (global).
const telas = {};
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
async function post(url, body) { const r = await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (r.erro) { toast('⚠️ ' + r.erro); throw new Error(r.erro); } return r; }
async function del(url) { return api(url, { method: 'DELETE' }); }
const sel = (nome, opcoes, atual) => `<select name="${nome}">${opcoes.map(o => `<option ${o === atual ? 'selected' : ''}>${o}</option>`).join('')}</select>`;

window.telas = telas;
let seqTela = 0; // só a última tela pedida é desenhada (evita uma resposta lenta cobrir a tela atual)
function mostrarTela(nome) {
  const principal = $('#principal'); const cfg = $('#tela-config');
  document.querySelectorAll('.menu a, #tabbar a').forEach(a => a.classList.toggle('ativo', a.dataset.tela === nome));
  document.body.dataset.tela = nome;
  if (nome === 'conversa') { seqTela++; principal.classList.remove('modo-config'); cfg.classList.add('oculto'); cfg.innerHTML = ''; irParaFim(); preencherTrilho(); return; }
  $('#trilho')?.classList.add('oculto'); $('#app').classList.remove('com-trilho');
  if (!telas[nome]) { toast('Essa tela entra na próxima etapa.'); return; }
  principal.classList.add('modo-config'); cfg.classList.remove('oculto', 'tela-hoje', 'tela-fin'); cfg.innerHTML = '<p class="sub">carregando…</p>';
  const seq = ++seqTela;
  telas[nome]().then(html => { if (seq !== seqTela) return; cfg.innerHTML = `<h1><button class="icone" id="voltarConversa" aria-label="Menu"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>${html.titulo}</h1><p class="sub">${html.sub || ''}</p>${html.corpo}`; $('#voltarConversa').onclick = () => $('#lateral').classList.add('aberta'); html.depois?.(); })
    .catch(() => { if (seq === seqTela) cfg.innerHTML = '<p class="sub">Não consegui carregar agora. Tente de novo em instantes.</p>'; });
}

// ---------------- HOJE (tela inicial: o dia em sequência) ----------------
const IC_OK = '<svg class="ic ok" viewBox="0 0 24 24" role="img" aria-label="feito"><path d="M20 6L9 17l-5-5"/></svg>';
let hojeCache = null;
async function dadosHoje(forcar) { if (!hojeCache || forcar || Date.now() - hojeCache.t > 60000) hojeCache = { t: Date.now(), d: await api('/api/hoje') }; return hojeCache.d; }
function acoesHtml(acoes, i) { return (acoes || []).map((a, j) => `<button class="btn-h ${a.sec ? 'sec' : 'pri'}" data-i="${i}" data-j="${j}">${esc(a.rotulo)}</button>`).join(''); }
function ligarAcoes(raiz, itens) {
  raiz.querySelectorAll('.btn-h').forEach(b => b.onclick = async () => { const a = itens[b.dataset.i]?.acoes?.[b.dataset.j]; if (!a) return;
    if (a.copiar) { try { await navigator.clipboard.writeText(a.copiar); toast('Código copiado'); } catch { prompt('Copie o código:', a.copiar); } return; }
    if (a.url) { window.open(a.url, '_blank', 'noopener'); return; }
    if (a.excluir) { // dois cliques: o primeiro pede confirmação no próprio botão
      if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = 'Confirmar descarte'; b.classList.add('perigo'); setTimeout(() => { if (b.isConnected && b.dataset.conf) { delete b.dataset.conf; b.textContent = a.rotulo; b.classList.remove('perigo'); } }, 4000); return; }
      b.disabled = true; const r = await api(a.excluir, { method: 'DELETE' });
      if (r?.erro) { toast(r.erro); b.disabled = false; return; }
      hojeCache = null; b.closest('.h-card, .t-item')?.remove(); toast(r?.removidos ? `${r.removidos} rascunhos descartados` : 'Rascunho descartado'); return; }
    if (a.tela) return mostrarTela(a.tela);
    if (a.cmd) { mostrarTela('conversa'); enviar(a.cmd); hojeCache = null; } });
}
telas.hoje = async () => {
  const d = hojeCache && Date.now() - hojeCache.t < 300000 ? (dadosHoje(true).catch(() => {}), hojeCache.d) : await dadosHoje(true); const nomeDono = (me?.conta?.nome_dono || '').split(' ')[0];
  const dataTxt = (t => t.charAt(0).toUpperCase() + t.slice(1))(new Date(d.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const nFeito = d.feito.length, nPrecisa = d.precisa.length, total = Math.max(1, d.total);
  const resumo = nFeito || nPrecisa ? `${nFeito ? `A equipe já resolveu ${nFeito} ${nFeito === 1 ? 'coisa' : 'coisas'} hoje.` : 'Nada concluído ainda hoje.'} ${nPrecisa ? `<b>${nPrecisa} ${nPrecisa === 1 ? 'precisa' : 'precisam'} de você.</b>` : '<b>Nada depende de você agora.</b>'}` : 'Dia tranquilo por enquanto. Peça qualquer coisa à equipe.';
  const barra = Array.from({ length: Math.min(total, 24) }, (_, i) => { const k = i / Math.min(total, 24) * total; return `<i class="${k < nFeito ? 'f' : k < nFeito + nPrecisa ? 'p' : ''}"></i>`; }).join('');
  const card = (x, i) => `<article class="h-card${x.alerta ? ' alerta' : ''}"><div class="h-ic">${avatar(x.modulo, x.quem)}</div><div class="h-txt"><div class="h-meta"><span class="tag">${esc(x.quem)}</span><span class="${x.alerta ? 'h-alerta' : 'h-sub'}">${esc(x.detalhe || '')}</span></div><b>${esc(x.titulo)}</b></div><div class="h-acoes">${acoesHtml(x.acoes, i)}</div></article>`;
  const sec = (n, cls, titulo, corpo) => `<section class="h-sec"><h2><span class="h-n ${cls}">${n}</span>${titulo}</h2>${corpo}</section>`;
  const vazio = (t) => `<p class="h-vazio">${t}</p>`;
  const ult = (typeof msgs !== 'undefined' ? msgs : []).filter(m => m.texto && !/^\[(imagem|video|arquivo|audio)\]$/.test(m.texto)).slice(-3);
  const chat = `<aside class="h-chat cartao"><div class="h-chat-topo"><b>Conversa</b><span class="h-sync"><i></i>sincronizada com o Telegram</span></div>
    <div class="h-msgs">${ult.length ? ult.map(m => `<div class="h-msg ${m.direcao}">${m.direcao === 'saida' ? avatar(m.modulo, (me.personas.find(p => p.modulo === m.modulo)?.nome || NOMES[m.modulo] || 'Fiel')) : ''}<div>${esc(String(m.texto).slice(0, 220))}${String(m.texto).length > 220 ? '…' : ''}</div></div>`).join('') : '<p class="h-vazio">Nenhuma conversa ainda.</p>'}</div>
    <div class="chips h-chips">${[...document.querySelectorAll('#chips button')].slice(1, 5).map(b => `<button type="button" data-cmd="${esc(b.dataset.cmd)}">${esc(b.textContent)}</button>`).join('')}</div>
    <form class="h-form" id="hForm"><label for="hTexto" class="so-leitor">Mensagem</label><input id="hTexto" placeholder="Peça qualquer coisa à equipe…" autocomplete="off"><button class="enviar" aria-label="Enviar"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form></aside>`;
  const corpo = `<div class="h-prog"><div class="h-prog-t"><span>Progresso do dia</span><b>${nFeito} de ${d.total}</b></div><div class="h-barra">${barra}</div></div>
  <div class="h-grade"><div class="h-col">
    ${sec(1, 'n1', 'Precisa de você', nPrecisa ? d.precisa.map(card).join('') : vazio('Tudo em dia. Quando algo depender de você, aparece aqui.'))}
    ${sec(2, 'n2', 'A equipe já fez', nFeito ? `<div class="cartao h-lista">${d.feito.map(x => `<div class="h-linha">${IC_OK}<div class="h-txt"><span>${esc(x.titulo)}</span><small>${esc(x.quem)} · ${esc(x.detalhe || '')}</small></div><time>${esc(x.hora || '')}</time></div>`).join('')}</div>` : vazio('Assim que a equipe concluir algo hoje, aparece aqui com ✓.'))}
    ${sec(3, 'n3', 'Ainda hoje', d.depois.length ? `<ol class="h-tempo">${d.depois.map(x => `<li><time>${esc(x.hora)}</time><div><span>${esc(x.titulo)}</span>${x.detalhe ? `<small>${esc(x.detalhe)}</small>` : ''}</div></li>`).join('')}</ol>` : vazio('Nada mais na agenda de hoje.'))}
    ${d.saldo ? `<p class="h-saldo">Último saldo registrado (${esc(d.saldo.carteira)}): <b>${esc(d.saldo.texto)}</b></p>` : ''}
  </div>${chat}</div>`;
  return { titulo: `${esc(d.saudacao)}${nomeDono ? ', ' + esc(nomeDono) : ''}.`, sub: `<span class="h-data">${esc(dataTxt)}</span> ${resumo}`, corpo,
    depois: () => { const raiz = $('#tela-config'); raiz.classList.add('tela-hoje'); ligarAcoes(raiz, d.precisa);
      raiz.querySelectorAll('.h-chips button').forEach(b => b.onclick = () => { mostrarTela('conversa'); enviar(b.dataset.cmd); });
      $('#hForm').onsubmit = (e) => { e.preventDefault(); const t = $('#hTexto').value.trim(); if (!t) return; mostrarTela('conversa'); enviar(t); }; } };
};
// Trilho da Conversa (telas largas): pendências + agenda de hoje.
async function preencherTrilho() {
  const t = $('#trilho'); if (!t) return; t.classList.remove('oculto'); $('#app').classList.add('com-trilho');
  try { const d = await dadosHoje();
    t.innerHTML = `<section><h2>Pendências</h2>${d.precisa.length ? d.precisa.slice(0, 5).map((x, i) => `<div class="t-item${x.alerta ? ' alerta' : ''}"><i></i><div><span>${esc(x.titulo)}</span><small>${esc(x.quem)} · ${esc(x.detalhe || '')}</small><div class="t-acoes">${acoesHtml(x.acoes, i)}</div></div></div>`).join('') : '<p class="h-vazio">Nada pendente.</p>'}</section>
      <section><h2>Ainda hoje</h2>${d.depois.length ? `<ol class="h-tempo">${d.depois.slice(0, 6).map(x => `<li><time>${esc(x.hora)}</time><div><span>${esc(x.titulo)}</span></div></li>`).join('')}</ol>` : '<p class="h-vazio">Agenda livre.</p>'}</section>
      <a class="t-ver" data-tela="hoje">Ver o dia completo</a>`;
    ligarAcoes(t, d.precisa); t.querySelector('.t-ver').onclick = () => mostrarTela('hoje');
  } catch { t.innerHTML = ''; }
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
    <div class="cartao"><h3>Empresas</h3><p class="d">Nomes exatos das pastas por empresa. Documento pessoal vai para "PF". Cada empresa daqui também vira uma carteira no Financeiro (Mais › Contas e cartões), com suas contas, cartões e plano de contas.</p>
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

// ---------------- FINANCEIRO (painel gerencial da Tina) ----------------
const finEstado = { carteira: '', mes: '', conta: '' };
const brlF = (v, sinal) => { const n = Number(v || 0); const t = Math.abs(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); return (n < 0 ? '−' : sinal && n > 0 ? '+' : '') + t; };
const brlK = (v) => { const n = Number(v || 0), a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + ' mi' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + ' mil' : a.toFixed(0)); };
const dataBR = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';
const mesNome = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const mesLongo = (m) => (t => t.charAt(0).toUpperCase() + t.slice(1))(new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
function graficoPrevisao(serie) {
  const W = innerWidth < 640 ? 400 : 720, H = 220, pl = 56, pr = 16, pt = 16, pb = 28; const vs = serie.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs); if (hi - lo < Math.max(1, Math.abs(hi) * .1)) { const m = Math.max(1, Math.abs(hi) * .1); lo -= m; hi += m; } const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  const x = (i) => pl + i / (serie.length - 1) * (W - pl - pr), y = (v) => pt + (hi - v) / (hi - lo) * (H - pt - pb);
  const ticks = [lo, (lo + hi) / 2, hi].map(v => Math.round(v));
  const path = serie.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const marcas = [0, 30, 60, 90].filter(i => i < serie.length);
  return `<div class="fin-graf" data-serie='${JSON.stringify(serie.map(p => [p.d, p.v]))}' data-geo='${JSON.stringify({ W, pl, pr, n: serie.length, lo, hi, pt, pb, H })}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Previsão de saldo para os próximos 90 dias">
      ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="g-grade"/><text x="${pl - 8}" y="${y(v) + 4}" class="g-eixo" text-anchor="end">${brlK(v)}</text>`).join('')}
      ${lo < 0 && hi > 0 ? `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="g-zero"/><text x="${W - pr}" y="${y(0) - 6}" class="g-eixo" text-anchor="end">zero</text>` : ''}
      ${marcas.map(i => `<text x="${x(i)}" y="${H - 8}" class="g-eixo" text-anchor="middle">${i === 0 ? 'hoje' : '+' + i + 'd'}</text>`).join('')}
      <path d="${path}" class="g-linha"/>
      <circle cx="${x(0)}" cy="${y(serie[0].v)}" r="4.5" class="g-ponto"/>
      <line class="g-cruz" x1="0" x2="0" y1="${pt}" y2="${H - pb}" style="display:none"/><circle class="g-alvo" r="5" style="display:none"/>
    </svg><div class="g-tip" hidden></div></div>`;
}
function graficoMeses(hist) {
  const W = innerWidth < 640 ? 400 : 720, H = 220, pl = 56, pr = 16, pt = 16, pb = 28; const max = Math.max(1, ...hist.flatMap(h => [h.recebido, h.pago]));
  const gw = (W - pl - pr) / hist.length, bw = Math.min(26, gw / 3), y = (v) => pt + (1 - v / max) * (H - pt - pb), base = H - pb;
  const ticks = [0, max / 2, max];
  const barra = (xx, v, cls, tip) => { const h = Math.max(0, base - y(v)); const r = Math.min(4, h); return `<path class="${cls}" data-tip="${tip}" d="M${xx},${base}V${base - h + r}Q${xx},${base - h} ${xx + r},${base - h}H${xx + bw - r}Q${xx + bw},${base - h} ${xx + bw},${base - h + r}V${base}Z"/><rect class="g-hit" data-tip="${tip}" x="${xx - 2}" y="${pt}" width="${bw + 4}" height="${base - pt}"/>`; };
  return `<div class="fin-graf barras"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas pagas nos últimos 6 meses">
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="g-grade"/><text x="${pl - 8}" y="${y(v) + 4}" class="g-eixo" text-anchor="end">${brlK(v)}</text>`).join('')}
    ${hist.map((h, i) => { const cx = pl + gw * i + gw / 2; return barra(cx - bw - 1, h.recebido, 'g-ent', `${mesNome(h.mes)} · recebido ${brlF(h.recebido)}`) + barra(cx + 1, h.pago, 'g-sai', `${mesNome(h.mes)} · pago ${brlF(h.pago)}`) + `<text x="${cx}" y="${H - 8}" class="g-eixo" text-anchor="middle">${mesNome(h.mes)}</text>`; }).join('')}
  </svg><div class="g-tip" hidden></div></div>`;
}
function ligarGraficos(raiz) {
  raiz.querySelectorAll('.fin-graf').forEach(g => {
    const tip = g.querySelector('.g-tip'); const svg = g.querySelector('svg');
    const mostra = (txt, ev) => { tip.hidden = false; tip.textContent = txt; const r = g.getBoundingClientRect(); let lx = ev.clientX - r.left + 12; if (lx > r.width - 180) lx -= 200; tip.style.left = lx + 'px'; tip.style.top = Math.max(0, ev.clientY - r.top - 40) + 'px'; };
    if (g.dataset.serie) {
      const s = JSON.parse(g.dataset.serie), G = JSON.parse(g.dataset.geo); const cruz = g.querySelector('.g-cruz'), alvo = g.querySelector('.g-alvo');
      svg.addEventListener('pointermove', (ev) => { const r = svg.getBoundingClientRect(); const vx = (ev.clientX - r.left) / r.width * G.W; const i = Math.max(0, Math.min(G.n - 1, Math.round((vx - G.pl) / (G.W - G.pl - G.pr) * (G.n - 1))));
        const px = G.pl + i / (G.n - 1) * (G.W - G.pl - G.pr), py = G.pt + (G.hi - s[i][1]) / (G.hi - G.lo) * (G.H - G.pt - G.pb);
        cruz.setAttribute('x1', px); cruz.setAttribute('x2', px); cruz.style.display = ''; alvo.setAttribute('cx', px); alvo.setAttribute('cy', py); alvo.style.display = '';
        mostra(`${dataBR(s[i][0])} · saldo previsto ${brlF(s[i][1])}`, ev); });
      svg.addEventListener('pointerleave', () => { tip.hidden = true; cruz.style.display = 'none'; alvo.style.display = 'none'; });
    } else {
      svg.querySelectorAll('[data-tip]').forEach(el => { el.addEventListener('pointermove', (ev) => mostra(el.dataset.tip, ev)); el.addEventListener('pointerleave', () => { tip.hidden = true; }); });
    }
  });
}
telas.financeiro = async () => {
  const q = new URLSearchParams(); if (finEstado.carteira) q.set('carteira', finEstado.carteira); if (finEstado.carteira && finEstado.conta) q.set('conta', finEstado.conta); if (finEstado.mes) q.set('mes', finEstado.mes);
  const d = await api('/api/financeiro/painel?' + q); const nomeTina = me?.personas?.find(p => p.modulo === 'financeiro')?.nome || 'Tina';
  const meses = []; { let m = d.hoje.slice(0, 7); for (let k = 0; k < 12; k++) { meses.push(m); const [a, b] = m.split('-').map(Number); m = b === 1 ? `${a - 1}-12` : `${a}-${String(b - 1).padStart(2, '0')}`; } }
  const fichaDe = (c) => (d.fichas || []).find(f => f.carteira === c) || {};
  const optCart = (pf) => d.carteiras.filter(c => !!fichaDe(c).pf === pf).map(c => `<option value="${esc(c)}" ${d.carteira === c ? 'selected' : ''}>${esc(c)}${fichaDe(c).titular && fichaDe(c).titular !== c ? ' · ' + esc(fichaDe(c).titular) : ''}</option>`).join('');
  const filtros = `<div class="fin-filtros"><div class="fin-visao">
      <label class="fin-sel"><span>Visualizar</span><select id="finCart"><option value="">Geral · todas as carteiras</option>${optCart(false) ? `<optgroup label="Empresas (PJ)">${optCart(false)}</optgroup>` : ''}${optCart(true) ? `<optgroup label="Pessoa física (PF)">${optCart(true)}</optgroup>` : ''}</select></label>
      ${d.carteira && d.contas_carteira?.length ? `<label class="fin-sel"><span>Conta</span><select id="finConta"><option value="">Todas as contas</option>${d.contas_carteira.map(x => `<option value="${x.id}" ${d.conta_sel?.id === x.id ? 'selected' : ''}>${esc(x.rotulo)}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="fin-dir"><button type="button" class="chip-link" id="finPlanilha">Planilha no Drive</button><button type="button" class="chip-link" id="finImportar" hidden>Atualizar pela planilha</button><button type="button" class="chip-link" id="finContas">Contas e cartões</button><button type="button" class="chip-link" id="finPlano">Plano de contas</button><label class="fin-mes"><span class="so-leitor">Mês</span><select id="finMes">${meses.map(m => `<option value="${m}" ${m === d.mes ? 'selected' : ''}>${mesLongo(m)}</option>`).join('')}</select></label></div></div>`;
  if (d.vazio && !d.carteira) return { titulo: 'Financeiro', sub: `Painel gerencial da ${esc(nomeTina)}`, corpo: `<div class="cartao fin-vazio"><h3>Seu financeiro aparece aqui</h3><p class="d">Mande o extrato do banco (OFX ou CSV), uma foto de boleto ou nota, ou conte à ${esc(nomeTina)} o saldo atual. Ela organiza tudo e este painel se monta sozinho.</p><div class="h-acoes"><button class="btn-h pri" data-cmd="${esc(nomeTina)}, quero mandar o extrato do banco">Mandar extrato</button><button class="btn-h sec" data-cmd="${esc(nomeTina)}, quero informar o saldo atual da conta">Informar saldo</button></div></div>`,
    depois: () => document.querySelectorAll('.fin-vazio [data-cmd]').forEach(b => b.onclick = () => { mostrarTela('conversa'); enviar(b.dataset.cmd); }) };
  const a = d.mes_atual, p = d.mes_anterior, delta = a.resultado - p.resultado;
  const kpi = (rot, val, sub, cls = '') => `<div class="fin-kpi ${cls}"><span class="r">${rot}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const kpis = `<div class="fin-kpis">
    ${kpi('Saldo hoje', brlF(d.saldo.hoje), d.saldo.por_carteira.length > 1 ? (l => l.slice(0, 4).map(s => `<span class="fin-sc"><i>${esc(s.carteira)}</i> ${brlF(s.saldo)}</span>`).join('') + (l.length > 4 ? `<span class="fin-sc"><i>+${l.length - 4} carteiras</i></span>` : ''))(d.saldo.por_carteira.filter(s => Math.abs(s.saldo) >= 0.01).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo))) : esc(d.saldo.por_carteira[0]?.base || ''), 'destaque')}
    ${kpi(`Resultado de ${mesNome(d.mes)}`, brlF(a.resultado, true), `${delta >= 0 ? '▲' : '▼'} ${brlF(Math.abs(delta))} vs ${mesNome(p.mes)}`, a.resultado < 0 ? 'neg' : '')}
    ${kpi('Recebido no mês', brlF(a.recebido), `${mesNome(p.mes)}: ${brlF(p.recebido)}`)}
    ${kpi('Pago no mês', brlF(a.pago), `${mesNome(p.mes)}: ${brlF(p.pago)}`)}
    ${kpi('A receber · 30 dias', brlF(d.abertos.a_receber_30), d.abertos.atrasado_receber ? `<span class="fin-alerta">${brlF(d.abertos.atrasado_receber)} em atraso</span>` : 'nada em atraso')}
    ${kpi('A pagar · 30 dias', brlF(d.abertos.a_pagar_30), d.abertos.atrasado_pagar ? `<span class="fin-alerta">${brlF(d.abertos.atrasado_pagar)} em atraso</span>` : 'nada em atraso')}
    ${kpi('Saldo previsto em 30 dias', brlF(d.previsao.d30), d.previsao.menor.valor < 0 ? `<span class="fin-alerta">fica negativo em ${dataBR(d.previsao.menor.dia)}</span>` : `60d ${brlF(d.previsao.d60)} · 90d ${brlF(d.previsao.d90)}`, d.previsao.d30 < 0 ? 'neg' : '')}
  </div>`;
  const venc = d.vencimentos.length ? d.vencimentos.map((v, i) => `<div class="fin-lin${v.atrasado ? ' atras' : ''}"><time>${v.atrasado ? 'atrasada' : v.hoje ? 'hoje' : dataBR(v.venc)}</time><div class="h-txt"><span>${esc(v.descricao || v.contraparte || 'Lançamento')}</span><small>${esc(v.carteira)}${v.categoria ? ' · ' + esc(v.categoria) : ''}</small>${(v.pagar || []).length ? `<span class="fin-pg">${v.pagar.map(x => x.url ? `<a class="fin-pg-b" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.rotulo)}">${esc(x.curto)}</a>` : `<button type="button" class="fin-pg-b" data-copiar="${esc(x.copiar)}" title="${esc(x.rotulo)}">${esc(x.curto)}</button>`).join('')}</span>` : ''}</div><b class="fin-v ${v.tipo}">${v.tipo === 'entrada' ? '+' : '−'}${brlF(v.valor)}</b><button class="btn-h sec fin-bx" data-i="${i}">${v.tipo === 'entrada' ? 'Recebi' : 'Paguei'}</button></div>`).join('') : '<p class="h-vazio">Nada a vencer nos próximos 30 dias.</p>';
  const maxCat = Math.max(1, ...d.categorias.map(c => c.total));
  const cats = d.categorias.length ? d.categorias.map(c => `<div class="fin-cat"><span>${esc(c.categoria)}</span><div class="fin-cat-b"><i style="width:${(c.total / maxCat * 100).toFixed(1)}%"></i></div><b>${brlF(c.total)}</b></div>`).join('') : '<p class="h-vazio">Sem despesas pagas neste mês.</p>';
  const ult = d.ultimos.length ? d.ultimos.map(u => `<div class="fin-lin"><time>${dataBR(u.quando)}</time><div class="h-txt"><span>${esc(u.descricao || u.contraparte || 'Lançamento')}</span><small>${esc(u.carteira)}${u.categoria ? ' · ' + esc(u.categoria) : ''}</small></div><b class="fin-v ${u.tipo}">${u.tipo === 'entrada' ? '+' : '−'}${brlF(u.valor)}</b></div>`).join('') : '<p class="h-vazio">Nenhum lançamento pago ainda.</p>';
  const tabela = (cab, linhas) => `<details class="fin-tab"><summary>Ver em tabela</summary><table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  const corpo = filtros + kpis + `<div class="fin-grade">
    <section class="cartao fin-box"><h3>Previsão de saldo · 90 dias</h3><p class="d">Saldo de hoje somado às contas a receber e a pagar já lançadas.</p>${graficoPrevisao(d.previsao.serie)}${tabela(['Quando', 'Saldo previsto'], [['Hoje', brlF(d.previsao.serie[0].v)], ['Em 30 dias', brlF(d.previsao.d30)], ['Em 60 dias', brlF(d.previsao.d60)], ['Em 90 dias', brlF(d.previsao.d90)], ['Menor saldo', `${brlF(d.previsao.menor.valor)} (${dataBR(d.previsao.menor.dia)})`]])}</section>
    <section class="cartao fin-box"><h3>Recebido x pago · 6 meses</h3><div class="fin-leg"><span><i class="ent"></i>Recebido</span><span><i class="sai"></i>Pago</span></div>${graficoMeses(d.historico)}${tabela(['Mês', 'Recebido', 'Pago', 'Resultado'], d.historico.map(h => [mesNome(h.mes), brlF(h.recebido), brlF(h.pago), brlF(h.resultado, true)]))}</section>
    ${(d.contas_fin || []).length ? `<section class="cartao fin-box largo"><h3>Contas e cartões</h3><div class="fin-cf">${d.contas_fin.map(x => { const uso = x.tipo === 'cartao_credito' && x.limite ? Math.min(100, (x.faturas || []).reduce((s, f) => s + f.total, 0) / x.limite * 100) : null;
      return `<div class="fin-cf-it"><span class="cf-ic" aria-hidden="true"><svg class="ic" viewBox="0 0 24 24">${icTipo[x.tipo] || icTipo.outro}</svg></span><div class="h-txt"><span>${esc(x.rotulo)}</span><small>${d.carteira ? '' : esc(x.carteira) + ' · '}${x.tipo === 'cartao_credito' ? (x.faturas?.length ? `fatura ${dataBR(x.faturas[0].venc)}` : 'sem fatura aberta') : x.tipo === 'cartao_debito' ? 'débito' : 'saldo'}</small>${uso !== null ? `<div class="fin-cat-b" title="${uso.toFixed(0)}% do limite"><i style="width:${uso.toFixed(1)}%"></i></div>` : ''}</div><b>${x.tipo === 'cartao_credito' ? brlF(x.faturas?.[0]?.total || 0) : x.tipo === 'cartao_debito' ? '' : brlF(x.saldo?.saldo || 0)}</b></div>`; }).join('')}</div></section>` : ''}
    <section class="cartao fin-box"><h3>A vencer · 30 dias${d.abertos.n_atrasados ? ` <span class="tag off">${d.abertos.n_atrasados} em atraso</span>` : ''}</h3>${venc}</section>
    <section class="cartao fin-box"><h3>Despesas de ${mesNome(d.mes)} por ${d.usa_plano ? 'conta do plano' : 'categoria'}</h3>${cats}</section>
    <section class="cartao fin-box largo"><h3>Últimos lançamentos</h3>${ult}<div class="h-acoes" style="margin-top:12px"><button class="btn-h sec" data-cmd="${esc(nomeTina)}, me manda o DRE de ${mesLongo(d.mes)}">Pedir DRE do mês</button><button class="btn-h sec" data-cmd="${esc(nomeTina)}, quero lançar uma conta">Lançar conta</button><button class="btn-h sec" data-cmd="${esc(nomeTina)}, quero mandar o extrato do banco">Mandar extrato</button></div></section>
  </div>`;
  return { titulo: d.carteira ? `Financeiro · ${esc(d.carteira)}` : 'Financeiro', sub: `${d.carteira ? `${fichaDe(d.carteira).pf ? 'Pessoa física' : 'Empresa'}${fichaDe(d.carteira).titular ? ' · ' + esc(fichaDe(d.carteira).titular) : ''}${d.conta_sel ? ' · só ' + esc(d.conta_sel.rotulo) : ''}` : 'Visão geral de todas as carteiras'} · ${mesLongo(d.mes)}`, corpo, depois: () => {
    const raiz = $('#tela-config'); raiz.classList.add('tela-fin'); ligarGraficos(raiz);
    $('#finCart').onchange = (e) => { finEstado.carteira = e.target.value; finEstado.conta = ''; mostrarTela('financeiro'); };
    $('#finConta') && ($('#finConta').onchange = (e) => { finEstado.conta = e.target.value; mostrarTela('financeiro'); });
    $('#finPlanilha').onclick = async (e) => { const b = e.currentTarget; const w = window.open('', '_blank'); b.disabled = true; b.textContent = 'Preparando…';
      const st = await api('/api/fin/espelho').catch(() => ({}));
      const r = st.ativo ? (post('/api/fin/espelho', {}).catch(() => {}), st) : await post('/api/fin/espelho', {}).catch(() => null);
      b.disabled = false; b.textContent = 'Planilha no Drive';
      if (r?.link) { if (w) w.location = r.link; else window.open(r.link, '_blank'); toast(st.ativo ? 'Abrindo a planilha (atualizando agora)' : 'Planilha criada no seu Drive'); } else if (w) w.close(); };
    $('#finImportar').onclick = () => mostrarTela('espelho');
    api('/api/fin/espelho').then(st => { if (!st?.ativo) return; $('#finImportar') && ($('#finImportar').hidden = false);
      if (st.alterada && $('.fin-filtros')) $('.fin-filtros').insertAdjacentHTML('afterend', `<div class="cartao es-aviso"><b>Você alterou a planilha do Drive.</b> Ela fica pausada até você revisar. <button class="btn-h pri" id="esIr">Revisar e aplicar</button></div>`), $('#esIr').onclick = () => mostrarTela('espelho'); }).catch(() => {});
    $('#finContas').onclick = () => { cfEstado.carteira = finEstado.carteira || ''; mostrarTela('contasfin'); };
    $('#finPlano').onclick = () => { planoEstado.carteira = finEstado.carteira || ''; mostrarTela('plano'); };
    $('#finMes').onchange = (e) => { finEstado.mes = e.target.value; mostrarTela('financeiro'); };
    raiz.querySelectorAll('.fin-pg-b[data-copiar]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); toast(b.title.replace('Copiar', '').trim() + ' copiado'); b.classList.add('ok'); setTimeout(() => b.classList.remove('ok'), 1500); } catch { prompt('Copie:', b.dataset.copiar); } });
    raiz.querySelectorAll('.fin-bx').forEach(b => b.onclick = () => { const v = d.vencimentos[b.dataset.i]; mostrarTela('conversa'); enviar(`${nomeTina}, ${v.tipo === 'entrada' ? 'recebi' : 'paguei'}: ${v.descricao || v.contraparte} (${brlF(v.valor)}, ${v.carteira}).`); });
    raiz.querySelectorAll('.fin-box [data-cmd]').forEach(b => b.onclick = () => { mostrarTela('conversa'); enviar(b.dataset.cmd); });
  } };
};

// ---------------- PLANO DE CONTAS (opcional, por carteira) ----------------
const planoEstado = { carteira: '' };
const pp = (u, b) => post(u, b).catch(() => ({ erro: true })); // post já mostra o erro em toast
telas.plano = async () => {
  const d = await api('/api/plano');
  if (!d.carteiras?.length) return { titulo: 'Plano de contas', sub: 'Opcional, por carteira.', corpo: `<div class="cartao"><p class="d">Ainda não há carteiras. Diga à Tina quais são (ex.: "Tina, minhas carteiras são Empresa e Pessoal") e volte aqui.</p></div>` };
  const sel = d.carteiras.find(c => c.carteira === planoEstado.carteira) || d.carteiras[0]; planoEstado.carteira = sel.carteira;
  const ehPF = /pessoal|\bpf\b|casa|fam[ií]lia|particular/i.test(sel.carteira);
  const grupos = ehPF ? d.grupos.pessoal : d.grupos.empresa; const todosGrupos = [...new Set([...grupos, ...sel.contas.map(c => c.grupo)])];
  const chips = `<div class="chips fin-chips" role="group" aria-label="Carteira">${d.carteiras.map(c => `<button type="button" data-pc="${esc(c.carteira)}" class="${c.carteira === sel.carteira ? 'on' : ''}">${esc(c.carteira)}${c.ativo ? ' ✓' : ''}</button>`).join('')}</div>`;
  const opcModelo = (atual) => d.modelos.map(m => `<option value="${m.id}" ${m.id === atual ? 'selected' : ''}>${esc(m.nome)} · ${m.contas} contas</option>`).join('');
  let corpo = chips;
  if (!sel.contas.length) {
    const sugerido = ehPF ? 'pessoal' : 'empresa';
    corpo += `<div class="cartao pc-inicio"><h3>Usar plano de contas em ${esc(sel.carteira)}?</h3><p class="d">Com o plano ligado, a Tina classifica cada lançamento numa conta (ex.: "3.4 Energia, água e internet") e o painel mostra as despesas por conta. Escolha um modelo para começar; depois você renomeia, cria ou desativa contas aqui.</p>
      <div class="pc-modelos">${d.modelos.map(m => `<button type="button" class="pc-modelo${m.id === sugerido ? ' sugerido' : ''}" data-modelo="${m.id}"><b>${esc(m.nome)}</b><small>${m.contas} contas prontas${m.id === sugerido ? ' · sugerido' : ''}</small></button>`).join('')}</div></div>`;
  } else {
    const porGrupo = todosGrupos.map(g => ({ g, contas: sel.contas.filter(c => c.grupo === g) })).filter(x => x.contas.length);
    const linha = (c) => `<div class="pc-lin${c.ativo ? '' : ' off'}" data-id="${c.id}">
      <label class="so-leitor" for="pcc${c.id}">Código</label><input id="pcc${c.id}" class="pc-cod" value="${esc(c.codigo)}" inputmode="decimal">
      <label class="so-leitor" for="pcn${c.id}">Nome</label><input id="pcn${c.id}" class="pc-nome" value="${esc(c.nome)}">
      <label class="so-leitor" for="pct${c.id}">Tipo</label><select id="pct${c.id}" class="pc-tipo"><option value="entrada" ${c.tipo === 'entrada' ? 'selected' : ''}>Entrada</option><option value="saida" ${c.tipo === 'saida' ? 'selected' : ''}>Saída</option></select>
      <label class="so-leitor" for="pcg${c.id}">Grupo do DRE</label><select id="pcg${c.id}" class="pc-grupo">${todosGrupos.map(g => `<option ${g === c.grupo ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <label class="pc-ativo"><input type="checkbox" class="pc-on" ${c.ativo ? 'checked' : ''}> ativa</label>
      <span class="pc-usos">${c.usos ? `${c.usos} lanç.` : ''}</span>
      <button type="button" class="icone pc-del" aria-label="Remover conta ${esc(c.codigo)}" title="${c.usos ? 'Tem lançamentos: será só desativada' : 'Remover'}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div>`;
    corpo += `<div class="cartao pc-topo"><label class="pc-switch"><input type="checkbox" id="pcAtivo" ${sel.ativo ? 'checked' : ''}><span></span><b>Usar plano de contas em ${esc(sel.carteira)}</b></label>
        <p class="d">${sel.ativo ? 'Ligado: a Tina classifica cada lançamento desta carteira numa conta abaixo.' : 'Desligado: a Tina usa só as categorias gerenciais. Suas contas ficam guardadas.'}</p>
        <div class="pc-trocar"><label for="pcModelo">Modelo</label><select id="pcModelo">${opcModelo(sel.modelo)}</select><button type="button" class="btn-h sec" id="pcTrocar">Recomeçar com este modelo</button></div></div>
      ${porGrupo.map(x => `<section class="cartao pc-grupo-box"><h3>${esc(x.g)}</h3>${x.contas.map(linha).join('')}</section>`).join('')}
      <section class="cartao pc-nova"><h3>Nova conta</h3><div class="pc-lin">
        <label class="so-leitor" for="pnCod">Código</label><input id="pnCod" class="pc-cod" placeholder="3.10" inputmode="decimal">
        <label class="so-leitor" for="pnNome">Nome</label><input id="pnNome" class="pc-nome" placeholder="Nome da conta">
        <label class="so-leitor" for="pnTipo">Tipo</label><select id="pnTipo" class="pc-tipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select>
        <label class="so-leitor" for="pnGrupo">Grupo do DRE</label><select id="pnGrupo" class="pc-grupo">${todosGrupos.map(g => `<option>${esc(g)}</option>`).join('')}</select>
        <button type="button" class="btn-h pri" id="pnAdd">Adicionar</button></div></section>`;
  }
  return { titulo: 'Plano de contas', sub: 'Opcional, por carteira. A Tina classifica cada lançamento na conta certa e o DRE continua funcionando.', corpo, depois: () => {
    const raiz = $('#tela-config'); raiz.classList.add('tela-fin');
    raiz.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { planoEstado.carteira = b.dataset.pc; mostrarTela('plano'); });
    raiz.querySelectorAll('[data-modelo]').forEach(b => b.onclick = async () => { b.disabled = true; const r = await pp('/api/plano/cfg', { carteira: sel.carteira, modelo: b.dataset.modelo }); if (!r?.erro) { toast('Plano de contas ligado'); mostrarTela('plano'); } else b.disabled = false; });
    $('#pcAtivo') && ($('#pcAtivo').onchange = async (e) => { const r = await pp('/api/plano/cfg', { carteira: sel.carteira, ativo: e.target.checked }); if (!r?.erro) { toast(e.target.checked ? 'Plano ligado' : 'Plano desligado'); mostrarTela('plano'); } });
    $('#pcTrocar') && ($('#pcTrocar').onclick = async (e) => { const b = e.currentTarget; if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar: substitui as contas atuais'; b.classList.add('perigo'); return; }
      const r = await pp('/api/plano/cfg', { carteira: sel.carteira, modelo: $('#pcModelo').value, substituir: true }); if (!r?.erro) { toast('Modelo aplicado'); mostrarTela('plano'); } });
    raiz.querySelectorAll('.pc-grupo-box .pc-lin').forEach(l => {
      const salvar = async () => { const r = await pp('/api/plano/conta', { id: l.dataset.id, codigo: l.querySelector('.pc-cod').value, nome: l.querySelector('.pc-nome').value, tipo: l.querySelector('.pc-tipo').value, grupo: l.querySelector('.pc-grupo').value, ativo: l.querySelector('.pc-on').checked });
        if (!r?.erro) { toast('Salvo'); l.classList.toggle('off', !l.querySelector('.pc-on').checked); } };
      l.querySelectorAll('input, select').forEach(i => i.addEventListener('change', salvar));
      l.querySelector('.pc-del').onclick = async () => { const r = await del('/api/plano/conta/' + l.dataset.id); if (r?.erro) return toast(r.erro); toast(r.desativada ? `Conta desativada (tem ${r.usos} lançamentos)` : 'Conta removida'); mostrarTela('plano'); };
    });
    $('#pnAdd') && ($('#pnAdd').onclick = async () => { const r = await pp('/api/plano/conta', { carteira: sel.carteira, codigo: $('#pnCod').value, nome: $('#pnNome').value, tipo: $('#pnTipo').value, grupo: $('#pnGrupo').value }); if (!r?.erro) { toast('Conta criada'); mostrarTela('plano'); } });
  } };
};

// ---------------- CONTAS E CARTÕES (bancos, cartões, dinheiro — por carteira) ----------------
const cfEstado = { carteira: '' };
const icTipo = { banco: '<path d="M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18"/>', cartao_credito: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>', cartao_debito: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>', dinheiro: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/>', outro: '<circle cx="12" cy="12" r="8"/>' };
telas.contasfin = async () => {
  const d = await api('/api/fin/contas'); const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dt = (s) => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
  const sub = 'Cada empresa e cada pessoa tem sua carteira, com suas contas bancárias, cartões, dinheiro, saldo e plano de contas. A Tina usa só as contas ativas.';
  const novaCarteira = `<section class="cartao cf-novacart"><h3>Nova carteira</h3><p class="d">Uma carteira para cada empresa (PJ) e para cada pessoa (PF). Cada uma tem suas contas, cartões, saldo e plano de contas. Empresa nova também aparece em Conexões › Empresas (pastas de documentos).</p>
    <div class="cf-form"><label>Tipo<select id="ncTipo"><option value="pj">Empresa (PJ)</option><option value="pf">Pessoa física (PF)</option></select></label><label>Nome da carteira<input id="ncNome" placeholder="ex.: Mais Têxtil, Kauê PF"></label><label>Razão social / nome completo<input id="ncTit" placeholder="opcional"></label><button type="button" class="btn-h pri" id="ncAdd">Criar carteira</button></div></section>`;
  if (!d.carteiras?.length) return { titulo: 'Contas e cartões', sub, corpo: novaCarteira, depois: ligarNovaCarteira };
  const sel = d.carteiras.find(c => c.carteira === cfEstado.carteira) || d.carteiras[0]; cfEstado.carteira = sel.carteira;
  const grupo = (pf) => d.carteiras.filter(c => c.pf === pf).map(c => `<button type="button" data-cfc="${esc(c.carteira)}" class="${c.carteira === sel.carteira ? 'on' : ''}">${esc(c.carteira)}</button>`).join('');
  const chips = `<div class="cf-chips">${grupo(false) ? `<div class="cf-chipg"><span>Empresas (PJ)</span><div class="chips fin-chips" role="group" aria-label="Empresas">${grupo(false)}</div></div>` : ''}${grupo(true) ? `<div class="cf-chipg"><span>Pessoa física (PF)</span><div class="chips fin-chips" role="group" aria-label="Pessoa física">${grupo(true)}</div></div>` : ''}</div>`;
  const info = (x) => x.tipo === 'cartao_credito'
    ? `${x.limite ? `Limite ${brl(x.limite)} · ` : ''}fecha dia ${x.dia_fechamento || '—'}, vence dia ${x.dia_vencimento || '—'}${x.faturas?.length ? `<br><b>Fatura ${dt(x.faturas[0].venc)}: ${brl(x.faturas[0].total)}</b>${x.faturas.length > 1 ? ` · depois ${brl(x.faturas.slice(1).reduce((s, f) => s + f.total, 0))}` : ''}` : '<br>Sem fatura em aberto'}`
    : x.tipo === 'cartao_debito' ? 'Débito em conta' : `<b>${brl(x.saldo?.saldo)}</b>${x.saldo?.informado ? ` <small>(base ${dt(x.saldo.data_base)})</small>` : ' <small>(saldo ainda não informado)</small>'}`;
  const campos = (x = {}, p = 'n') => `
    <label>Tipo<select class="cf-tipo" id="${p}Tipo">${Object.entries(d.tipos).map(([k, v]) => `<option value="${k}" ${k === (x.tipo || 'banco') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Nome<input class="cf-nome" value="${esc(x.nome || '')}" placeholder="ex.: Itaú PJ, Nubank, Carteira"></label>
    <label class="cf-so" data-so="banco cartao_credito cartao_debito">Banco / emissor<input class="cf-inst" value="${esc(x.instituicao || '')}" placeholder="ex.: Itaú"></label>
    <label class="cf-so" data-so="cartao_credito cartao_debito banco">Final<input class="cf-final" value="${esc(x.final || '')}" inputmode="numeric" maxlength="4" placeholder="1234"></label>
    <label class="cf-so" data-so="cartao_credito">Limite<input class="cf-limite" value="${x.limite || ''}" inputmode="decimal" placeholder="5000"></label>
    <label class="cf-so" data-so="cartao_credito">Dia do fechamento<input class="cf-fech" value="${x.dia_fechamento || ''}" inputmode="numeric" placeholder="3"></label>
    <label class="cf-so" data-so="cartao_credito">Dia do vencimento<input class="cf-venc" value="${x.dia_vencimento || ''}" inputmode="numeric" placeholder="10"></label>`;
  const item = (x) => `<div class="cf-item${x.ativo ? '' : ' off'}" data-id="${x.id}">
      <span class="cf-ic" aria-hidden="true"><svg class="ic" viewBox="0 0 24 24">${icTipo[x.tipo] || icTipo.outro}</svg></span>
      <div class="cf-txt"><b>${esc(x.rotulo)}</b> <small>${esc(x.tipo_nome)}${x.instituicao ? ' · ' + esc(x.instituicao) : ''}${x.ativo ? '' : ' · desativada'}</small><div class="cf-info">${info(x)}</div></div>
      <div class="cf-acoes">
        ${/cartao/.test(x.tipo) ? '' : `<button type="button" class="btn-h sec cf-saldo">Informar saldo</button>`}
        <label class="pc-ativo"><input type="checkbox" class="cf-on" ${x.ativo ? 'checked' : ''}> ativa</label>
        <button type="button" class="icone cf-edit" aria-label="Editar ${esc(x.rotulo)}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>
        <button type="button" class="icone cf-del" aria-label="Remover ${esc(x.rotulo)}" title="${x.usos ? 'Tem lançamentos: será só desativada' : 'Remover'}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
      </div>
      <div class="cf-saldo-form" hidden><label class="so-leitor" for="sv${x.id}">Saldo de hoje</label><input id="sv${x.id}" inputmode="decimal" placeholder="Saldo hoje, ex.: 12.500,00"><button type="button" class="btn-h pri cf-saldo-ok">Salvar</button></div>
      <div class="cf-form cf-edit-form" hidden>${campos(x, 'e' + x.id)}<button type="button" class="btn-h pri cf-edit-ok">Salvar</button></div>
    </div>`;
  const corpo = chips + `
    <section class="cartao cf-cart"><div class="cf-cab"><h3>${esc(sel.carteira)} <small>${sel.pf ? 'Pessoa física' : 'Empresa'}${sel.titular ? ' · ' + esc(sel.titular) : ''}</small></h3>
      <div class="cf-cab-ac"><button type="button" class="chip-link" id="cfFicha">Editar ficha</button>${sel.lancamentos ? '' : '<button type="button" class="chip-link" id="cfRem">Remover carteira</button>'}</div></div>
      <div class="cf-resumo"><div><span>Saldo da carteira</span><b>${brl(sel.saldo?.saldo)}</b><small>${esc(sel.saldo?.base || '')}</small></div>
        <div><span>Contas e cartões</span><b>${sel.contas.filter(x => x.ativo).length} ativos</b><small>${sel.contas.filter(x => /cartao/.test(x.tipo) && x.ativo).length} cartões</small></div>
        <div><span>Plano de contas</span><b>${sel.plano ? 'Ligado' : 'Não usa'}</b><small><a href="#" id="cfPlano">${sel.plano ? esc(sel.plano) + ' · ajustar' : 'configurar'}</a></small></div>
        <div><span>Lançamentos</span><b>${sel.lancamentos}</b><small><a href="#" id="cfVer">ver no Financeiro</a></small></div></div>
      <div class="cf-form" id="cfFichaForm" hidden>
        <label>Tipo<select id="cfTipo"><option value="pj" ${sel.pf ? '' : 'selected'}>Empresa (PJ)</option><option value="pf" ${sel.pf ? 'selected' : ''}>Pessoa física (PF)</option></select></label>
        <label>Nome da carteira<input id="cfRenNome" value="${esc(sel.carteira)}"></label>
        <label>Razão social / nome completo<input id="cfTit" value="${esc(sel.titular || '')}"></label>
        <label>CNPJ / CPF<input id="cfDoc" value="${esc(sel.documento || '')}" placeholder="opcional"></label>
        <button type="button" class="btn-h pri" id="cfFichaOk">Salvar ficha</button></div>
      ${sel.contas.length ? sel.contas.map(item).join('') : `<p class="d">Nenhuma conta cadastrada. Sem contas, a Tina controla só o saldo geral da carteira. Cadastre abaixo para separar por banco, cartão e dinheiro.</p>`}
    </section>
    <section class="cartao cf-nova"><h3>Adicionar em ${esc(sel.carteira)}</h3><div class="cf-form">${campos({}, 'n')}<button type="button" class="btn-h pri" id="cfAdd">Adicionar</button></div></section>
    ${novaCarteira}`;
  return { titulo: 'Contas e cartões', sub, corpo, depois: () => {
    const raiz = $('#tela-config'); raiz.classList.add('tela-fin');
    const mostrarCampos = (form) => { const t = form.querySelector('.cf-tipo').value; form.querySelectorAll('.cf-so').forEach(l => l.hidden = !l.dataset.so.split(' ').includes(t)); };
    const ler = (form) => ({ tipo: form.querySelector('.cf-tipo').value, nome: form.querySelector('.cf-nome').value, instituicao: form.querySelector('.cf-inst').value, final: form.querySelector('.cf-final').value, limite: form.querySelector('.cf-limite').value.replace(/\./g, '').replace(',', '.'), dia_fechamento: form.querySelector('.cf-fech').value, dia_vencimento: form.querySelector('.cf-venc').value });
    raiz.querySelectorAll('.cf-form').forEach(f => { if (f.querySelector('.cf-tipo')) { mostrarCampos(f); f.querySelector('.cf-tipo').onchange = () => mostrarCampos(f); } });
    raiz.querySelectorAll('[data-cfc]').forEach(b => b.onclick = () => { cfEstado.carteira = b.dataset.cfc; mostrarTela('contasfin'); });
    $('#cfAdd').onclick = async () => { const r = await pp('/api/fin/contas', { carteira: sel.carteira, ...ler($('.cf-nova .cf-form')) }); if (!r?.erro) { toast('Cadastrada e ativa'); mostrarTela('contasfin'); } };
    raiz.querySelectorAll('.cf-item').forEach(el => {
      const x = sel.contas.find(c => String(c.id) === el.dataset.id);
      el.querySelector('.cf-on').onchange = async (e) => { const r = await pp('/api/fin/contas', { ...x, ativo: e.target.checked }); if (!r?.erro) { toast(e.target.checked ? 'Ativada' : 'Desativada'); mostrarTela('contasfin'); } };
      el.querySelector('.cf-edit').onclick = () => { const f = el.querySelector('.cf-edit-form'); f.hidden = !f.hidden; };
      el.querySelector('.cf-edit-ok').onclick = async () => { const r = await pp('/api/fin/contas', { id: x.id, ativo: !!x.ativo, ...ler(el.querySelector('.cf-edit-form')) }); if (!r?.erro) { toast('Salvo'); mostrarTela('contasfin'); } };
      el.querySelector('.cf-del').onclick = async (e) => { const b = e.currentTarget; if (!b.dataset.conf) { b.dataset.conf = 1; b.classList.add('perigo'); toast('Clique de novo para confirmar'); return; }
        const r = await del('/api/fin/contas/' + x.id); if (r?.erro) return toast(r.erro); toast(r.desativada ? `Desativada (tem ${r.usos} lançamentos)` : 'Removida'); mostrarTela('contasfin'); };
      const bs = el.querySelector('.cf-saldo'); if (bs) { bs.onclick = () => { const f = el.querySelector('.cf-saldo-form'); f.hidden = !f.hidden; f.querySelector('input').focus(); };
        el.querySelector('.cf-saldo-ok').onclick = async () => { const r = await pp('/api/fin/saldo', { conta_fin_id: x.id, saldo: el.querySelector('.cf-saldo-form input').value }); if (!r?.erro) { toast('Saldo atualizado'); mostrarTela('contasfin'); } }; }
    });
    $('#cfFicha').onclick = () => { $('#cfFichaForm').hidden = !$('#cfFichaForm').hidden; };
    $('#cfPlano').onclick = (e) => { e.preventDefault(); planoEstado.carteira = sel.carteira; mostrarTela('plano'); };
    $('#cfVer').onclick = (e) => { e.preventDefault(); finEstado.carteira = sel.carteira; finEstado.conta = ''; mostrarTela('financeiro'); };
    $('#cfFichaOk').onclick = async () => { const nome = $('#cfRenNome').value.trim();
      if (nome && nome !== sel.carteira) { const r = await pp('/api/fin/carteiras', { acao: 'renomear', carteira: sel.carteira, nome }); if (r?.erro) return; cfEstado.carteira = nome; }
      const r = await pp('/api/fin/carteiras', { acao: 'ficha', carteira: cfEstado.carteira, tipo: $('#cfTipo').value, titular: $('#cfTit').value, documento: $('#cfDoc').value }); if (!r?.erro) { toast('Ficha salva'); mostrarTela('contasfin'); } };
    $('#cfRem') && ($('#cfRem').onclick = async (e) => { const b = e.currentTarget; if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar (sai também de Conexões › Empresas)'; b.classList.add('perigo'); return; }
      const r = await pp('/api/fin/carteiras', { acao: 'remover', carteira: sel.carteira }); if (!r?.erro) { cfEstado.carteira = ''; toast('Carteira removida'); mostrarTela('contasfin'); } });
    ligarNovaCarteira();
  } };
};
function ligarNovaCarteira() {
  $('#tela-config')?.classList.add('tela-fin');
  $('#ncAdd') && ($('#ncAdd').onclick = async () => { const nome = $('#ncNome').value.trim(); const r = await pp('/api/fin/carteiras', { acao: 'adicionar', nome, tipo: $('#ncTipo').value, titular: $('#ncTit').value }); if (!r?.erro) { cfEstado.carteira = nome; toast('Carteira criada'); mostrarTela('contasfin'); } });
}

// ---------------- ATUALIZAR PELA PLANILHA (espelho → Fiel, com revisão) ----------------
telas.espelho = async () => {
  const d = await api('/api/fin/espelho/alteracoes').catch(e => ({ erro: e.message || 'Não consegui ler a planilha.' }));
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fv = (c, v) => c === 'valor' ? brl(v) : /data|vencimento/.test(c) && v ? String(v).split('-').reverse().join('/') : esc(String(v ?? '')) || '—';
  const sub = 'Confira o que você mudou na planilha "Espelho financeiro" e escolha o que vai para o Fiel. Nada muda sem você aplicar.';
  if (d.erro) return { titulo: 'Atualizar pela planilha', sub, corpo: `<div class="cartao"><p class="d">${esc(d.erro)}</p></div>` };
  if (!d.total && !d.erros.length) return { titulo: 'Atualizar pela planilha', sub, corpo: `<div class="cartao"><h3>Tudo igual</h3><p class="d">A planilha está igual ao Fiel. Edite a aba Lançamentos (ou acrescente linhas sem ID) e volte aqui.</p></div>` };
  const corpo = `
    ${d.mudancas.length ? `<section class="cartao es-box"><h3>Alterados (${d.mudancas.length})</h3>${d.mudancas.map(m => `<label class="es-it"><input type="checkbox" class="es-m" value="${m.id}" checked><div><b>${esc(m.descricao)}</b> <small>linha ${m.linha} · #${m.id}</small>${m.campos.map(c => `<div class="es-c">${esc(c.rotulo)}: <s>${fv(c.campo, c.de)}</s> → <b>${fv(c.campo, c.para)}</b></div>`).join('')}</div></label>`).join('')}</section>` : ''}
    ${d.novos.length ? `<section class="cartao es-box"><h3>Novos (${d.novos.length})</h3>${d.novos.map(n => `<label class="es-it"><input type="checkbox" class="es-n" value="${n.linha}" checked><div><b>${esc(n.descricao)}</b> <small>linha ${n.linha}</small><div class="es-c">${n.alvo.tipo === 'entrada' ? 'Entrada' : 'Saída'} · ${brl(n.alvo.valor)} · ${esc(n.alvo.carteira)} · ${esc(n.alvo.status)}</div></div></label>`).join('')}</section>` : ''}
    ${d.removidos.length ? `<section class="cartao es-box"><h3>Apagados na planilha (${d.removidos.length})</h3><p class="d">Marque só o que deve sair do Fiel. Os não marcados voltam para a planilha.</p>${d.removidos.map(r => `<label class="es-it"><input type="checkbox" class="es-r" value="${r.id}"><div><b>${esc(r.descricao || 'Lançamento')}</b> <small>#${r.id}</small><div class="es-c">${r.tipo === 'entrada' ? 'Entrada' : 'Saída'} · ${brl(r.valor)} · ${esc(r.carteira)}</div></div></label>`).join('')}</section>` : ''}
    ${d.erros.length ? `<section class="cartao es-box es-err"><h3>Com erro (${d.erros.length}) · não serão aplicados</h3>${d.erros.map(e => `<div class="es-it"><div><b>Linha ${e.linha}${e.descricao ? ' · ' + esc(e.descricao) : ''}</b>${e.erros.map(x => `<div class="es-c">${esc(x)}</div>`).join('')}</div></div>`).join('')}</section>` : ''}
    <div class="h-acoes"><button class="btn-h pri" id="esAplicar">Aplicar selecionados</button><button class="btn-h sec" id="esDescartar">Descartar e voltar a planilha ao Fiel</button></div>`;
  return { titulo: 'Atualizar pela planilha', sub, corpo, depois: () => {
    $('#tela-config').classList.add('tela-fin');
    const marc = (cls) => [...document.querySelectorAll(cls + ':checked')].map(i => Number(i.value));
    $('#esAplicar').onclick = async (e) => { e.currentTarget.disabled = true; const r = await pp('/api/fin/espelho/aplicar', { ids: marc('.es-m'), novos: marc('.es-n'), remover: marc('.es-r') });
      if (!r?.erro) { toast(`Feito: ${r.alterados} alterados, ${r.criados} novos, ${r.removidos} removidos`); finEstado.conta = ''; mostrarTela('financeiro'); } else e.currentTarget.disabled = false; };
    $('#esDescartar').onclick = async (e) => { const b = e.currentTarget; if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar: a planilha volta a ficar igual ao Fiel'; b.classList.add('perigo'); return; }
      const r = await pp('/api/fin/espelho/descartar', {}); if (!r?.erro) { toast('Planilha restaurada'); mostrarTela('financeiro'); } };
  } };
};
