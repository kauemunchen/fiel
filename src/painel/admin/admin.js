// Painel admin do Fiel. Vanilla JS. Reusa o token do app (/app).
const $ = (s) => document.querySelector(s); const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const token = () => new URLSearchParams(location.search).get('token') || localStorage.getItem('akm');
const api = async (p, o = {}) => { const tk = token(); const r = await fetch(p, { credentials: 'same-origin', ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}), ...(tk ? { authorization: 'Bearer ' + tk } : {}) } }); if (r.status === 401 || r.status === 403) { $('#app').classList.add('oculto'); $('#login401').classList.remove('oculto'); throw new Error('auth'); } const j = await r.json().catch(() => ({})); if (j.erro) toast('⚠️ ' + j.erro); return j; };
const toast = (t) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2500); };
const fmtR = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtC = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
const diaBr = (s) => s ? new Date(s + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const PLANO = { trial: 'Trial', prepago: 'Pré-pago', ilimitado: 'Ilimitado', mensal_pro: 'Pro mensal', mensal_max: 'Max mensal' };
const STATUS = { ativa: 'tag ok', bloqueada: 'tag off', suspensa: 'tag warn' };

const telas = {};
async function iniciar() {
  try { const r = await api('/api/admin/resumo'); if (!r.produto) throw new Error('sem acesso'); } catch { return; }
  $('#app').classList.remove('oculto'); montarTela('resumo');
  document.querySelectorAll('.menu a').forEach(a => a.onclick = () => montarTela(a.dataset.tela));
}
function montarTela(nome) {
  document.querySelectorAll('.menu a').forEach(a => a.classList.toggle('ativo', a.dataset.tela === nome));
  $('#tela').innerHTML = '<p class="sub">carregando…</p>'; telas[nome]().then(({ titulo, sub, corpo, depois }) => { $('#tela').innerHTML = `<h1>${titulo}</h1><p class="sub">${sub || ''}</p>${corpo}`; depois?.(); });
}

telas.resumo = async () => {
  const d = await api('/api/admin/resumo');
  const spark = (serie, chave) => { const max = Math.max(1, ...serie.map(x => x[chave] || 0)); return `<div class="sparkline">${serie.map(x => `<div title="${x.d}: ${x[chave] || 0}" style="height:${Math.max(2, (x[chave] || 0) / max * 38)}px"></div>`).join('')}</div>`; };
  const corpo = `<div class="kpis">
    <div class="kpi"><div class="r">Contas</div><div class="v">${fmtN(d.contas.total)}</div><div class="s">${d.contas.ativas} ativas · ${d.contas.bloqueadas} bloqueadas · ${d.contas.em_trial} em trial</div></div>
    <div class="kpi"><div class="r">Faturamento 30d</div><div class="v">${fmtR(d.faturamento_30d.bruto)}</div><div class="s">${d.faturamento_30d.n} cobranças · hoje ${fmtR(d.faturamento_hoje.bruto)}</div>${spark(d.por_dia, 'r')}</div>
    <div class="kpi"><div class="r">Pendente</div><div class="v">${fmtR(d.pendente.bruto)}</div><div class="s">${d.pendente.n} cobranças aguardando</div></div>
    <div class="kpi"><div class="r">Assinaturas ativas</div><div class="v">${fmtN(d.assinaturas.ativas)}</div><div class="s">MRR ${fmtR(d.assinaturas.mrr || 0)}</div></div>
    <div class="kpi"><div class="r">Créditos (30d)</div><div class="v">${fmtC(d.creditos_30d.consumidos)}</div><div class="s">consumidos · ${fmtC(d.creditos_30d.emitidos)} emitidos</div></div>
    <div class="kpi"><div class="r">IA (30d)</div><div class="v">${fmtN(d.uso_30d.chamadas)}</div><div class="s">chamadas · ${fmtN(d.uso_30d.tokens)} tokens</div></div>
  </div>
  <div class="grade">
    <div class="cartao"><h3>Novas contas (30d)</h3>${spark(d.novas, 'n')}<p class="d">${d.novas.reduce((a, b) => a + b.n, 0)} contas criadas</p></div>
    <div class="cartao"><h3>Tokens por assessor (30d)</h3><ul class="lista-s">${d.por_modulo.map(x => `<li><span>${esc(x.modulo || '—')}</span><span>${fmtN(x.tokens)} tokens · ${x.chamadas} chamadas</span></li>`).join('') || '<li>Sem uso ainda.</li>'}</ul></div>
    <div class="cartao" style="grid-column:1/-1"><h3>Top 10 consumidores (30d)</h3><div class="tabela compacta"><table><thead><tr><th>Conta</th><th>Empresa</th><th style="text-align:right">Créditos gastos</th><th></th></tr></thead><tbody>${d.top_gasto.map(c => `<tr><td>${esc(c.nome_dono)}</td><td>${esc(c.empresa)}</td><td style="text-align:right">${fmtC(c.gasto)}</td><td><button class="minibtn" data-conta="${c.id}">abrir</button></td></tr>`).join('') || '<tr><td colspan="4">Sem dados.</td></tr>'}</tbody></table></div></div>
  </div>`;
  return { titulo: '📊 Resumo', sub: `Fiel · últimos 30 dias`, corpo, depois() { document.querySelectorAll('button[data-conta]').forEach(b => b.onclick = () => abrirConta(Number(b.dataset.conta))); } };
};

telas.contas = async () => {
  return { titulo: '🏢 Contas', sub: 'Todas as contas do Fiel. Clique para ver detalhes, ajustar créditos ou bloquear.', corpo: `
    <div class="linha-busca">
      <input id="qc" placeholder="buscar nome, empresa, CPF/CNPJ, e-mail…" style="flex:1">
      <div class="sel-filtro" id="fc">${['', 'ativas', 'bloqueadas', 'trial', 'mensal', 'inativas'].map(f => `<button data-f="${f}" class="${!f ? 'on' : ''}">${f || 'todas'}</button>`).join('')}</div>
    </div>
    <div class="tabela compacta"><table><thead><tr><th>ID</th><th>Dono</th><th>Empresa</th><th>Plano</th><th>Status</th><th style="text-align:right">Saldo</th><th style="text-align:right">30d</th><th>Último uso</th><th>Criada</th><th></th></tr></thead><tbody id="tbc"><tr><td colspan="10">carregando…</td></tr></tbody></table></div>`,
    async depois() {
      let filtro = ''; let q = '';
      const render = async () => { const rows = await api(`/api/admin/contas?filtro=${filtro}&q=${encodeURIComponent(q)}`); $('#tbc').innerHTML = rows.map(c => `<tr><td class="mono">#${c.id}${c.admin ? ' 👑' : ''}</td><td>${esc(c.nome_dono)}</td><td>${esc(c.empresa)}</td><td>${esc(PLANO[c.plano] || c.plano || '—')}</td><td><span class="${STATUS[c.status] || 'tag'}">${esc(c.status)}</span></td><td style="text-align:right">${c.plano === 'ilimitado' || c.admin ? '∞' : fmtC(c.saldo)}</td><td style="text-align:right">${fmtC(c.gasto_30d)}</td><td>${c.ultimo_uso ? diaBr(c.ultimo_uso) : '—'}</td><td>${diaBr(c.criado_em)}</td><td><button class="minibtn" data-id="${c.id}">abrir</button></td></tr>`).join('') || '<tr><td colspan="10">Nenhuma conta.</td></tr>'; document.querySelectorAll('#tbc button').forEach(b => b.onclick = () => abrirConta(Number(b.dataset.id))); };
      $('#qc').oninput = (e) => { q = e.target.value; clearTimeout(window._bq); window._bq = setTimeout(render, 250); };
      $('#fc').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filtro = b.dataset.f; document.querySelectorAll('#fc button').forEach(x => x.classList.toggle('on', x === b)); render(); };
      render();
    } };
};

async function abrirConta(id) {
  const d = await api(`/api/admin/conta/${id}`);
  const c = d.conta; const div = document.createElement('div'); div.className = 'dialog'; const planos = ['trial', 'prepago', 'ilimitado', 'mensal_pro', 'mensal_max'];
  div.innerHTML = `<div class="cartao" style="position:relative"><button class="fechar">✕</button>
    <h2 style="margin:0 0 4px">#${c.id} · ${esc(c.nome_dono)} ${c.admin ? '👑' : ''}</h2>
    <p class="d">${esc(c.empresa)} · ${esc(c.email || '—')} · ${esc(c.cpf_cnpj || 'sem CPF/CNPJ')} · criada ${diaBr(c.criado_em)}</p>
    <div class="kpis"><div class="kpi"><div class="r">Saldo</div><div class="v">${d.ilimitada ? '∞' : fmtC(d.saldo)}</div></div><div class="kpi"><div class="r">Plano</div><div class="v" style="font-size:16px">${esc(PLANO[c.plano] || c.plano)}</div></div><div class="kpi"><div class="r">Status</div><div class="v" style="font-size:16px"><span class="${STATUS[c.status] || 'tag'}">${esc(c.status)}</span></div></div></div>
    <form id="fAjc" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:4px"><div class="campo"><label>Operação</label><select name="operacao"><option value="credito">+ Creditar</option><option value="debito">− Debitar</option></select></div><div class="campo"><label>Quantidade</label><input name="quantidade" type="number" min="0.01" step="0.1" required style="width:120px"></div><div class="campo" style="flex:1;min-width:200px"><label>Motivo</label><input name="motivo" placeholder="ex.: cortesia, estorno manual"></div><button class="btn prim">Aplicar</button></form>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><label>Plano <select id="selPlano">${planos.map(p => `<option ${p === c.plano ? 'selected' : ''}>${p}</option>`).join('')}</select></label><label>Status <select id="selStatus">${['ativa', 'bloqueada', 'suspensa'].map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label><input type="checkbox" id="chkAdmin" ${c.admin ? 'checked' : ''}> admin</label><label title="Libera pesquisa na web (Google Search) para os assessores desta conta. Admin tem acesso automático."><input type="checkbox" id="chkPesquisaWeb" ${c.pesquisa_web || c.admin || c.plano === 'ilimitado' ? 'checked' : ''} ${c.admin || c.plano === 'ilimitado' ? 'disabled' : ''}> 🔎 pesquisa web</label><button class="minibtn" id="btSalvar">salvar</button></div>
    <h3 style="margin-top:16px">Uso (30d)</h3><ul class="lista-s">${d.uso_30d.map(x => `<li><span>${esc(x.modulo || '—')}</span><span>${fmtN(x.tokens)} tokens · ${x.chamadas} chamadas</span></li>`).join('') || '<li>Sem uso.</li>'}</ul>
    <h3>Cobranças</h3><div class="tabela compacta"><table><thead><tr><th>Data</th><th>Pacote</th><th>Forma</th><th>Valor</th><th>Status</th></tr></thead><tbody>${d.cobrancas.map(cb => `<tr><td>${diaBr(cb.criado_em)}</td><td>${esc(cb.pacote_id)}</td><td>${esc(cb.forma)}</td><td>${fmtR(cb.valor)}</td><td><span class="${cb.status === 'pago' ? 'tag ok' : cb.status === 'pendente' ? 'tag warn' : 'tag off'}">${esc(cb.status)}</span>${cb.invoice_url && cb.status === 'pendente' ? ` <a href="${esc(cb.invoice_url)}" target="_blank" rel="noopener">link</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma cobrança.</td></tr>'}</tbody></table></div>
    <h3>Movimentos de crédito</h3><div class="tabela compacta" style="max-height:250px;overflow:auto"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Descrição</th><th>Assessor</th><th style="text-align:right">Qtd</th></tr></thead><tbody>${d.movimentos.map(m => `<tr><td>${diaBr(m.criado_em)}</td><td>${esc(m.tipo)}</td><td>${esc(m.motivo || '')} ${m.ref ? `<small style="color:var(--mudo)">${esc(m.ref)}</small>` : ''}</td><td>${esc(m.modulo || '—')}</td><td style="text-align:right;${m.quantidade > 0 ? 'color:#1E7A45' : ''}">${m.quantidade > 0 ? '+' : ''}${fmtC(m.quantidade)}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
  document.body.appendChild(div);
  div.querySelector('.fechar').onclick = () => div.remove(); div.onclick = (e) => { if (e.target === div) div.remove(); };
  div.querySelector('#fAjc').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api(`/api/admin/conta/${id}/creditos`, { method: 'POST', body: JSON.stringify(f) }); toast('✅ aplicado'); div.remove(); abrirConta(id); };
  div.querySelector('#btSalvar').onclick = async () => { await api(`/api/admin/conta/${id}`, { method: 'POST', body: JSON.stringify({ plano: $('#selPlano').value, status: $('#selStatus').value, admin: $('#chkAdmin').checked, pesquisa_web: $('#chkPesquisaWeb').checked }) }); toast('✅ atualizado'); div.remove(); abrirConta(id); };
}

telas.financeiro = async () => {
  const d = await api('/api/admin/financeiro');
  const total = d.cobrancas.filter(c => c.status === 'pago').reduce((a, b) => a + b.valor, 0);
  const corpo = `<div class="linha-busca"><div class="sel-filtro" id="fs">${['', 'pago', 'pendente', 'vencido', 'cancelado', 'estornado'].map(s => `<button data-s="${s}" class="${!s ? 'on' : ''}">${s || 'todas'}</button>`).join('')}</div></div>
    <div class="kpis"><div class="kpi"><div class="r">Pagas (filtro atual)</div><div class="v">${fmtR(total)}</div></div><div class="kpi"><div class="r">Faturamento histórico</div><div class="v">${fmtR(d.por_mes.reduce((a, b) => a + (b.r || 0), 0))}</div><div class="s">${d.por_mes.length} meses com movimento</div></div></div>
    <div class="grade"><div class="cartao"><h3>Por mês</h3><ul class="lista-s">${d.por_mes.map(m => `<li><span>${esc(m.m)}</span><span>${fmtR(m.r)} · ${m.n} cobranças</span></li>`).join('') || '<li>Sem receita.</li>'}</ul></div></div>
    <div class="tabela compacta" style="margin-top:12px"><table><thead><tr><th>Data</th><th>Conta</th><th>Pacote</th><th>Forma</th><th style="text-align:right">Valor</th><th>Status</th><th></th></tr></thead><tbody id="tfin"></tbody></table></div>`;
  return { titulo: '💳 Financeiro', sub: 'Todas as cobranças emitidas pelo Fiel via Asaas.', corpo, async depois() {
    let status = ''; const render = async () => { const r = await api(`/api/admin/financeiro${status ? `?status=${status}` : ''}`); $('#tfin').innerHTML = r.cobrancas.map(c => `<tr><td>${diaBr(c.criado_em)}</td><td><button class="minibtn" data-c="${c.conta_id}">${esc(c.nome_dono)} <small>${esc(c.empresa)}</small></button></td><td>${esc(c.pacote_id)}</td><td>${esc(c.forma)}</td><td style="text-align:right">${fmtR(c.valor)}</td><td><span class="${c.status === 'pago' ? 'tag ok' : c.status === 'pendente' ? 'tag warn' : 'tag off'}">${esc(c.status)}</span></td><td>${c.invoice_url ? `<a class="minibtn" href="${esc(c.invoice_url)}" target="_blank" rel="noopener">fatura</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">Nenhuma cobrança.</td></tr>'; document.querySelectorAll('#tfin button[data-c]').forEach(b => b.onclick = () => abrirConta(Number(b.dataset.c))); };
    $('#fs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; status = b.dataset.s; document.querySelectorAll('#fs button').forEach(x => x.classList.toggle('on', x === b)); render(); };
    render();
  } };
};

telas.pacotes = async () => {
  const d = await api('/api/admin/pacotes');
  const corpo = `<p class="d">Edite nome, créditos e preço de cada pacote. Alterações entram em vigor imediatamente (tela Créditos no app, comando <code>comprar</code> no Telegram). Trial atual: <b>${d.trial}</b> créditos.</p>
    <div class="tabela compacta"><table><thead><tr><th>ID</th><th>Nome</th><th>Créditos</th><th>Preço R$</th><th>Tipo</th><th>Ativo</th><th>Ordem</th><th></th></tr></thead><tbody id="tpac">${d.pacotes.map(p => `<tr data-id="${esc(p.id)}">
      <td class="mono">${esc(p.id)}</td>
      <td><input value="${esc(p.nome)}" data-k="nome"></td>
      <td><input type="number" value="${p.creditos}" data-k="creditos" style="width:90px"></td>
      <td><input type="number" step="0.01" value="${p.preco}" data-k="preco" style="width:90px"></td>
      <td><select data-k="tipo"><option ${p.tipo === 'prepago' ? 'selected' : ''}>prepago</option><option ${p.tipo === 'mensal' ? 'selected' : ''}>mensal</option></select></td>
      <td><input type="checkbox" data-k="ativo" ${p.ativo ? 'checked' : ''}></td>
      <td><input type="number" value="${p.ordem}" data-k="ordem" style="width:60px"></td>
      <td><button class="minibtn" data-salvar>salvar</button> <button class="minibtn perigo" data-apagar>apagar</button></td>
    </tr>`).join('')}</tbody></table></div>
    <h3 style="margin-top:16px">Novo pacote</h3><form id="fNovo" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="campo"><label>ID (slug)</label><input name="id" required placeholder="plus"></div><div class="campo"><label>Nome</label><input name="nome" required placeholder="Plus"></div><div class="campo"><label>Créditos</label><input name="creditos" type="number" required></div><div class="campo"><label>R$</label><input name="preco" type="number" step="0.01" required></div><div class="campo"><label>Tipo</label><select name="tipo"><option>prepago</option><option>mensal</option></select></div><button class="btn prim">Criar</button></form>
    <h3 style="margin-top:16px">Tarifas fixas (código)</h3><ul class="lista-s">${Object.entries(d.tarifas).map(([k, v]) => `<li><span>${esc(k.replace(/_/g, ' '))}</span><span>${v} crédito(s)</span></li>`).join('')}</ul><p class="d">Para mudar essas tarifas, edite <code>TARIFAS</code> em <code>src/creditos/index.js</code> e faça deploy.</p>`;
  return { titulo: '🛒 Pacotes & preços', sub: 'Catálogo do Fiel exibido ao cliente final.', corpo, depois() {
    document.querySelectorAll('#tpac tr').forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelector('[data-salvar]').onclick = async () => { const body = {}; tr.querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k; body[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; }); await api(`/api/admin/pacotes/${id}`, { method: 'POST', body: JSON.stringify(body) }); toast('✅ salvo'); };
      tr.querySelector('[data-apagar]').onclick = async () => { if (!confirm(`Apagar o pacote ${id}?`)) return; await api(`/api/admin/pacotes/${id}`, { method: 'DELETE' }); toast('🗑 removido'); montarTela('pacotes'); };
    });
    $('#fNovo').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api(`/api/admin/pacotes/${f.id}`, { method: 'POST', body: JSON.stringify(f) }); toast('✅ criado'); montarTela('pacotes'); };
  } };
};

telas.broadcast = async () => {
  return { titulo: '📣 Avisos', sub: 'Mensagem única para todos os donos de conta via Telegram.', corpo: `
    <form id="fBr" class="cartao"><div class="campo"><label>Para quem</label><select name="filtro"><option value="ativas">Contas ativas</option><option value="todas">Todas</option><option value="trial">Em trial</option><option value="bloqueadas">Bloqueadas (saldo zerado)</option></select></div><div class="campo"><label>Mensagem</label><textarea name="texto" rows="5" required placeholder="Ex.: Nova função de edição de vídeo liberada. Mande 'editar meu vídeo' depois de enviar o arquivo."></textarea></div><button class="btn prim">Enviar</button> <span class="salvo" id="brMsg"></span></form>
    <p class="d" style="margin-top:12px">A mensagem é enviada como <b>📣 Fiel</b> + o texto, para cada dono via Telegram. Recomendado: avisos de manutenção, mudanças de preço, novas funções.</p>`,
    depois() { $('#fBr').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!confirm(`Enviar para os donos com filtro "${f.filtro}"?`)) return; $('#brMsg').textContent = 'enviando…'; const r = await api('/api/admin/broadcast', { method: 'POST', body: JSON.stringify(f) }); $('#brMsg').textContent = r.ok ? `✅ ${r.enviados}/${r.total} enviados` : ''; }; } };
};

iniciar();

telas.metricas = async () => {
  const d = await api('/api/admin/metricas');
  const pct = (x) => (x * 100).toFixed(1) + '%';
  const corpo = `<div class="kpis">
    <div class="kpi"><div class="r">Conversão trial → pagante (30d)</div><div class="v">${pct(d.taxa_conversao)}</div><div class="s">${d.trial_virou_pagante_30d} de ${d.trial_30d} contas novas</div></div>
    <div class="kpi"><div class="r">Churn mensal (30d)</div><div class="v">${pct(d.churn_mensal)}</div><div class="s">${d.canceladas_30d} cancelamentos · ${d.assinaturas_ativas} assinaturas ativas</div></div>
    <div class="kpi"><div class="r">Contas ativas 14d</div><div class="v">${fmtN(d.ativas_14d)}</div><div class="s">interagiram no período</div></div>
  </div>
  <div class="grade">
    <div class="cartao"><h3>Cohort (criação × pagantes)</h3><div class="tabela compacta"><table><thead><tr><th>Mês</th><th>Contas criadas</th><th>Viraram pagantes</th><th>Conversão</th></tr></thead><tbody>${d.cohort.map(c => `<tr><td>${esc(c.m)}</td><td>${c.criadas}</td><td>${c.pagantes}</td><td>${c.criadas ? pct(c.pagantes / c.criadas) : '—'}</td></tr>`).join('') || '<tr><td colspan="4">Sem dados.</td></tr>'}</tbody></table></div></div>
    <div class="cartao"><h3>Receita mensal</h3><div class="tabela compacta"><table><thead><tr><th>Mês</th><th>Cobranças</th><th style="text-align:right">R$</th></tr></thead><tbody>${d.receita_mensal.map(m => `<tr><td>${esc(m.m)}</td><td>${m.n}</td><td style="text-align:right">${fmtR(m.r)}</td></tr>`).join('') || '<tr><td colspan="3">Sem receita.</td></tr>'}</tbody></table></div></div>
  </div>`;
  return { titulo: '📈 Métricas', sub: 'Conversão, churn e cohort do Fiel.', corpo };
};

telas.operacao = async () => {
  const [backups, logs] = await Promise.all([api('/api/admin/backups'), api('/api/admin/logs')]);
  const corpo = `<div class="grade">
    <div class="cartao"><h3>Exportar (CSV)</h3><p class="d">Baixe snapshots para planilha ou contabilidade.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${['contas', 'cobrancas', 'creditos', 'uso'].map(t => `<a class="btn sec" href="/api/admin/exportar/${t}.csv" download>${t}.csv</a>`).join('')}</div></div>
    <div class="cartao"><h3>Backups <button class="btn sec" id="btBk">rodar agora</button></h3><p class="d">Diário às 04:00 (código + .env + banco + data/). <span id="bkSaida"></span></p>
      <ul class="lista-s">${backups.map(b => `<li><span><a href="/api/admin/backup/${encodeURIComponent(b.nome)}" download class="mono">${esc(b.nome)}</a></span><span>${b.mb} MB · ${diaBr(b.em.replace('Z', ''))} <button class="minibtn perigo" data-bk="${esc(b.nome)}">apagar</button></span></li>`).join('') || '<li>Nenhum backup ainda.</li>'}</ul></div>
    <div class="cartao" style="grid-column:1/-1"><h3>Limpeza de contas inativas</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><label>Sem interação há mais de <input type="number" id="dias" value="60" min="7" max="365" style="width:70px"> dias</label><button class="minibtn" id="btPrev">atualizar lista</button><button class="minibtn perigo" id="btSusp">suspender selecionadas</button></div>
      <div id="tbLimp" class="tabela compacta"><p class="d">clique "atualizar lista" para carregar.</p></div></div>
    <div class="cartao" style="grid-column:1/-1"><h3>Log de ações do admin</h3><div class="tabela compacta" style="max-height:340px;overflow:auto"><table><thead><tr><th>Quando</th><th>Admin</th><th>Ação</th><th>Alvo</th><th>Detalhes</th></tr></thead><tbody>${logs.map(l => `<tr><td>${diaBr(l.criado_em)}</td><td>${esc(l.admin_nome || '#' + l.admin_id)}</td><td class="mono">${esc(l.acao)}</td><td class="mono">${esc(l.alvo || '')}</td><td class="mono" style="font-size:11px">${esc(l.detalhes || '')}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma ação registrada.</td></tr>'}</tbody></table></div></div>
  </div>`;
  return { titulo: '🧰 Operação', sub: 'Exportar, backups, limpeza e auditoria.', corpo, depois() {
    $('#btBk').onclick = async () => { $('#bkSaida').textContent = 'gerando… (até 2 min)'; try { const r = await api('/api/admin/backup', { method: 'POST' }); $('#bkSaida').textContent = (r.saida || []).join(' · '); setTimeout(() => montarTela('operacao'), 1500); } catch { $('#bkSaida').textContent = 'falhou'; } };
    document.querySelectorAll('button[data-bk]').forEach(b => b.onclick = async () => { if (!confirm(`Apagar ${b.dataset.bk}? Essa ação não pode ser desfeita.`)) return; await api(`/api/admin/backup/${encodeURIComponent(b.dataset.bk)}`, { method: 'DELETE' }); montarTela('operacao'); });
    let lista = [];
    const render = (r) => { lista = r.candidatas; $('#tbLimp').innerHTML = `<table><thead><tr><th><input type="checkbox" id="todas"></th><th>ID</th><th>Dono</th><th>Empresa</th><th>Plano</th><th>Status</th><th>Último uso</th><th style="text-align:right">Saldo</th><th>Pagas</th></tr></thead><tbody>${r.candidatas.map(c => `<tr><td><input type="checkbox" value="${c.id}" class="sel"></td><td>#${c.id}</td><td>${esc(c.nome_dono)}</td><td>${esc(c.empresa)}</td><td>${esc(PLANO[c.plano] || c.plano)}</td><td><span class="${STATUS[c.status] || 'tag'}">${esc(c.status)}</span></td><td>${c.ultimo_uso ? diaBr(c.ultimo_uso) : 'nunca'}</td><td style="text-align:right">${fmtC(c.saldo)}</td><td>${c.pagas}</td></tr>`).join('') || '<tr><td colspan="9">Nenhuma conta inativa com esse critério.</td></tr>'}</tbody></table>`; const t = $('#todas'); if (t) t.onchange = (e) => document.querySelectorAll('.sel').forEach(x => x.checked = e.target.checked); };
    $('#btPrev').onclick = async () => { $('#tbLimp').innerHTML = '<p class="d">carregando…</p>'; render(await api(`/api/admin/limpeza?dias=${$('#dias').value}`)); };
    $('#btSusp').onclick = async () => { const ids = [...document.querySelectorAll('.sel:checked')].map(x => Number(x.value)); if (!ids.length) return toast('Selecione pelo menos uma conta.'); if (!confirm(`Suspender ${ids.length} conta(s)? Elas param de usar o Fiel até você reativar.`)) return; await api('/api/admin/limpeza/marcar', { method: 'POST', body: JSON.stringify({ ids }) }); toast(`${ids.length} suspensa(s)`); $('#btPrev').onclick(); };
  } };
};

telas.custos = async () => {
  const d = await api('/api/admin/custos'); const p = d.geral.precos;
  const inp = (k, step, w) => `<input class="pr" data-k="${k}" type="number" step="${step}" value="${p[k]}" style="width:${w || 90}px">`;
  const corpo = `<div class="kpis">
    <div class="kpi"><div class="r">Receita (30d)</div><div class="v">${fmtR(d.geral.receita_brl)}</div><div class="s">bruto · ${fmtR(d.geral.mp.total_liquido)} líquido depois do MP</div></div>
    <div class="kpi"><div class="r">Custo IA (30d)</div><div class="v">${fmtR(d.geral.ia.total_brl)}</div><div class="s">US$ ${d.geral.ia.total_usd.toFixed(4)} · câmbio R$ ${p.usd_brl}</div></div>
    <div class="kpi"><div class="r">Taxas Mercado Pago (30d)</div><div class="v">${fmtR(d.geral.mp.total_taxa)}</div><div class="s">${d.geral.mp.por_forma.length} tipos de cobrança</div></div>
    <div class="kpi"><div class="r">Infra fixa (30d)</div><div class="v">${fmtR(d.geral.infra_brl)}</div><div class="s">VPS + domínio + backups</div></div>
    <div class="kpi" style="border:1px solid ${d.geral.margem_brl >= 0 ? '#4CAF7A' : '#E25D5D'}"><div class="r">Margem líquida (30d)</div><div class="v" style="color:${d.geral.margem_brl >= 0 ? '#1E7A45' : '#B4232A'}">${fmtR(d.geral.margem_brl)}</div><div class="s">receita − IA − taxas MP − infra</div></div>
    ${(() => { const abaixo = d.margens.linhas.filter(m => m.abaixo_meta_pix || m.abaixo_meta_cartao); return `<div class="kpi" style="border:1px solid ${abaixo.length ? '#E25D5D' : '#4CAF7A'}"><div class="r">Pacotes abaixo da meta (${d.margens.meta_pct}%)</div><div class="v" style="color:${abaixo.length ? '#B4232A' : '#1E7A45'}">${abaixo.length} de ${d.margens.linhas.length}</div><div class="s">${abaixo.length ? abaixo.map(m => esc(m.nome)).join(', ') : 'todos atingem a meta de margem'}</div></div>`; })()}
    ${(() => { const atual = d.margens.tokens_por_credito_atual; const rec = d.margens.tokens_por_credito_recomendado; const dif = d.margens.tokens_por_credito_ajuste_pct; const precisaMudar = Math.abs(dif) >= 5; const cor = !precisaMudar ? '#4CAF7A' : (dif < 0 ? '#E25D5D' : '#8A5A00'); const corT = !precisaMudar ? '#1E7A45' : (dif < 0 ? '#B4232A' : '#8A5A00'); const bt = (atual !== rec) ? `<button class="minibtn" id="btAplicarTPC" style="margin-top:4px">Aplicar ${fmtN(rec)}</button>` : ''; return `<div class="kpi" style="border:1px solid ${cor}"><div class="r">Tokens por crédito (recomendado)</div><div class="v" style="color:${corT}">${fmtN(rec)}</div><div class="s">hoje: <b>${fmtN(atual)}</b> · ${!precisaMudar ? 'OK para a meta' : (dif < 0 ? `reduzir ${Math.abs(dif)}% para manter ${d.margens.meta_pct}% margem` : `pode subir ${dif}% sem perder a meta`)} ${bt}</div></div>`; })()}
  </div>
  <div class="grade">
    <div class="cartao"><h3>Seu consumo (admin · ${esc(d.admin_conta?.nome_dono || '')})</h3><p class="d">Você usa o Fiel como admin ilimitado — nenhum crédito é descontado, mas o custo real existe. Aqui está o que gastou com IA nos últimos 30 dias.</p>
      <ul class="lista-s"><li><span>Total gasto em IA</span><b>${fmtR(d.admin.ia.total_brl)} <small style="color:var(--mudo)">(US$ ${d.admin.ia.total_usd.toFixed(4)})</small></b></li></ul>
      <p class="d" style="margin-top:10px">Por modelo</p><ul class="lista-s">${d.admin.ia.por_modelo.map(m => `<li><span>${esc(m.modelo_norm)}</span><span>${fmtN(m.tokens_in + m.tokens_out)} tokens · ${fmtR(m.custo_brl)}</span></li>`).join('') || '<li>Sem uso ainda.</li>'}</ul>
    </div>
    <div class="cartao"><h3>Taxas MP por forma de pagamento (30d)</h3>
      <div class="tabela compacta"><table><thead><tr><th>Forma</th><th>Cobranças</th><th style="text-align:right">Bruto</th><th style="text-align:right">Taxa</th><th style="text-align:right">Líquido</th></tr></thead><tbody>${d.geral.mp.por_forma.map(x => `<tr><td>${esc(x.forma)}</td><td>${x.cobrancas}</td><td style="text-align:right">${fmtR(x.bruto)}</td><td style="text-align:right">${fmtR(x.taxa)}</td><td style="text-align:right">${fmtR(x.liquido)}</td></tr>`).join('') || '<tr><td colspan="5">Sem cobranças pagas.</td></tr>'}</tbody></table></div>
    </div>
    <div class="cartao" style="grid-column:1/-1"><h3>Margem bruta por pacote <small style="color:var(--mudo);font-weight:400">(meta mínima: ${d.margens.meta_pct}%)</small></h3><p class="d">Assume cliente consumindo 100% dos créditos em texto (Gemini 2.5 Flash, mix 70/30). <b>Preços dos pacotes são fixos</b> — a coluna "Tokens/créd. máx." mostra quantos tokens 1 crédito pode consumir pra bater a meta de margem em cada forma de pagamento. O menor desses valores define a tarifa recomendada de tokens por crédito.</p>
      <div class="tabela compacta"><table><thead><tr><th>Pacote</th><th style="text-align:right">Preço</th><th style="text-align:right">Créditos</th><th style="text-align:right">R$/créd.</th><th style="text-align:right">Custo IA</th><th style="text-align:right">Taxa Pix</th><th style="text-align:right">Lucro Pix</th><th style="text-align:right">Margem Pix</th><th style="text-align:right">Tokens/créd. Pix</th><th style="text-align:right">Taxa Cartão</th><th style="text-align:right">Lucro Cartão</th><th style="text-align:right">Margem Cartão</th><th style="text-align:right">Tokens/créd. Cartão</th></tr></thead><tbody>${d.margens.linhas.map(m => {
        const corP = m.abaixo_meta_pix ? '#B4232A' : '#1E7A45';
        const corC = m.abaixo_meta_cartao ? '#B4232A' : '#1E7A45';
        const bgLinha = (m.abaixo_meta_pix || m.abaixo_meta_cartao) ? 'background:#FBE7E7' : '';
        return `<tr style="${bgLinha}"><td>${esc(m.nome)}${m.tipo==='mensal'?' <small style="color:var(--mudo)">(/mês)</small>':''}${(m.abaixo_meta_pix||m.abaixo_meta_cartao)?' <span class="tag off" style="font-size:10px">abaixo da meta</span>':''}</td><td style="text-align:right">${fmtR(m.preco)}</td><td style="text-align:right">${fmtN(m.creditos)}</td><td style="text-align:right">${fmtR(m.preco/m.creditos)}</td><td style="text-align:right">${fmtR(m.custo_ia)}</td><td style="text-align:right">${fmtR(m.taxa_pix)}</td><td style="text-align:right;color:${corP};font-weight:600">${fmtR(m.lucro_pix)}</td><td style="text-align:right;color:${corP};font-weight:700">${m.margem_pix_pct}%</td><td style="text-align:right;font-weight:600">${fmtN(m.tokens_credito_max_pix)}</td><td style="text-align:right">${fmtR(m.taxa_cartao)}</td><td style="text-align:right;color:${corC};font-weight:600">${fmtR(m.lucro_cartao)}</td><td style="text-align:right;color:${corC};font-weight:700">${m.margem_cartao_pct}%</td><td style="text-align:right;font-weight:600">${fmtN(m.tokens_credito_max_cartao)}</td></tr>`;
      }).join('')}</tbody></table></div>
    </div>
    <div class="cartao" style="grid-column:1/-1"><h3>Matriz custo × margem (todo pacote × toda IA)</h3><p class="d">Se um cliente consumir 100% dos créditos em texto no modelo da coluna. <b>Verde</b> = atinge a meta de 75%; <b>amarelo</b> = 50-74%; <b>vermelho</b> = abaixo de 50% (ou prejuízo).</p>
      <div class="tabela compacta" style="overflow:auto"><table><thead><tr><th>Pacote</th><th style="text-align:right">Preço</th>${d.matriz.modelos.map(m => `<th style="text-align:center">${esc(m.nome.replace('Gemini ',''))}<br><small style="color:var(--mudo);font-weight:400">R$ ${m.r_por_1k.toFixed(4)}/1k</small></th>`).join('')}</tr></thead><tbody>${d.matriz.matriz.map(r => `<tr><td>${esc(r.pacote)}${r.tipo==='mensal'?' <small style="color:var(--mudo)">(/mês)</small>':''}</td><td style="text-align:right">${fmtR(r.preco)}</td>${r.por_modelo.map(c => { const cor = c.margem_pct >= 75 ? '#1E7A45' : c.margem_pct >= 50 ? '#8A5A00' : '#B4232A'; const bg = c.margem_pct >= 75 ? '#E3F5EA' : c.margem_pct >= 50 ? '#FFF3DB' : '#FBE7E7'; return `<td style="text-align:center;background:${bg};color:${cor};font-weight:600">${c.margem_pct}%<br><small style="font-weight:400">${fmtR(c.lucro)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    </div>
    <div class="cartao" style="grid-column:1/-1"><h3>Preços (editáveis)</h3><p class="d">Ajuste conforme as condições reais do seu plano no Google (Gemini), Mercado Pago e no seu VPS. Preços de IA em <b>US$ por 1M de tokens</b>; MP em fração (0.0099 = 0,99%).</p>
      <div class="tabela compacta"><table><tbody>
        <tr><th>IA — Gemini 2.5 Flash</th><td>in ${inp('gemini-2.5-flash_in',0.01)} / out ${inp('gemini-2.5-flash_out',0.01)}</td></tr>
        <tr><th>IA — Gemini 2.5 Pro</th><td>in ${inp('gemini-2.5-pro_in',0.01)} / out ${inp('gemini-2.5-pro_out',0.01)}</td></tr>
        <tr><th>IA — Gemini 2.0 Flash</th><td>in ${inp('gemini-2.0-flash_in',0.001)} / out ${inp('gemini-2.0-flash_out',0.001)}</td></tr>
        <tr><th>IA — Gemini Flash Lite</th><td>in ${inp('gemini-flash-lite_in',0.001)} / out ${inp('gemini-flash-lite_out',0.001)}</td></tr>
        <tr><th>IA — Gemini 1.5 Flash / Pro</th><td>Flash: in ${inp('gemini-1.5-flash_in',0.001)} / out ${inp('gemini-1.5-flash_out',0.001)} · Pro: in ${inp('gemini-1.5-pro_in',0.01)} / out ${inp('gemini-1.5-pro_out',0.01)}</td></tr>
        <tr><th>Fal.ai (US$ por imagem)</th><td>${inp('fal_imagem_usd',0.001)}</td></tr>
        <tr><th>MP · Pix</th><td>% ${inp('mp_pix_pct',0.0001,100)} + R$ ${inp('mp_pix_fixo',0.01)}</td></tr>
        <tr><th>MP · Cartão</th><td>% ${inp('mp_cartao_pct',0.0001,100)} + R$ ${inp('mp_cartao_fixo',0.01)}</td></tr>
        <tr><th>MP · Boleto</th><td>% ${inp('mp_boleto_pct',0.0001,100)} + R$ ${inp('mp_boleto_fixo',0.01)}</td></tr>
        <tr><th>Infra fixa mensal (R$)</th><td>${inp('infra_mensal_brl',1)}</td></tr>
        <tr><th>Câmbio USD → BRL</th><td>${inp('usd_brl',0.01)}</td></tr>
        <tr><th>Meta de margem (fração)</th><td>${inp('margem_meta',0.01)} <small style="color:var(--mudo)">(0,75 = 75% líquido mínimo por pacote vendido)</small></td></tr>
      </tbody></table></div>
      <p class="d" style="margin-top:8px"><button class="btn prim" id="btSalvarPrecos">Salvar preços</button> <button class="btn sec" id="btResetPrecos">Restaurar padrões</button> <span class="salvo" id="prMsg"></span></p>
    </div>
  </div>`;
  return { titulo: '💰 Custos & margem', sub: 'Quanto você paga de IA, taxas de pagamento e infra — e sua margem real.', corpo, depois() {
    $('#btSalvarPrecos').onclick = async () => { $('#prMsg').textContent = 'salvando…'; const inputs = document.querySelectorAll('input.pr'); for (const el of inputs) { try { await post('/api/admin/custos/preco', { chave: el.dataset.k, valor: Number(el.value) }); } catch {} } $('#prMsg').textContent = '✅ salvo'; setTimeout(() => montarTela('custos'), 1200); };
    $('#btResetPrecos').onclick = async () => { if (!confirm('Restaurar todos os preços para os valores padrão de referência?')) return; await post('/api/admin/custos/resetar', {}); toast('✅ padrões restaurados'); setTimeout(() => montarTela('custos'), 500); };
    const btTPC = $('#btAplicarTPC'); if (btTPC) btTPC.onclick = async () => { const rec = d.margens.tokens_por_credito_recomendado; if (!confirm(`Trocar a tarifa de ${d.margens.tokens_por_credito_atual} para ${rec} tokens por crédito? Isso vale para TODAS as contas a partir do próximo débito e mantém a meta de ${d.margens.meta_pct}% de margem.`)) return; await post('/api/admin/custos/preco', { chave: 'tokens_por_credito', valor: rec }); toast(`✅ tarifa agora é ${rec} tokens/crédito`); setTimeout(() => montarTela('custos'), 600); };
  } };
};
