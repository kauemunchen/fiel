// Painel admin do Fiel. Vanilla JS. Reusa o token do app (/app).
const $ = (s) => document.querySelector(s); const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const token = () => new URLSearchParams(location.search).get('token') || localStorage.getItem('akm');
const api = async (p, o = {}) => { const tk = token(); const r = await fetch(p, { credentials: 'same-origin', ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}), ...(tk ? { authorization: 'Bearer ' + tk } : {}) } }); if (r.status === 401 || r.status === 403) { $('#app').classList.add('oculto'); $('#login401').classList.remove('oculto'); throw new Error('auth'); } const j = await r.json().catch(() => ({})); if (j.erro) toast('⚠️ ' + j.erro); return j; };
const post = (p, corpo, metodo = 'POST') => api(p, { method: metodo, body: corpo == null ? undefined : JSON.stringify(corpo) });
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
    <div class="tabela compacta"><table><thead><tr><th>ID</th><th>Dono</th><th>Empresa</th><th>Plano</th><th>Status</th><th style="text-align:right">Saldo</th><th style="text-align:right">30d</th><th style="text-align:right" title="Custo real com IA (Gemini + imagens fal.ai) de todo o histórico da conta">Custo IA (R$)</th><th>Último uso</th><th>Criada</th><th></th></tr></thead><tbody id="tbc"><tr><td colspan="11">carregando…</td></tr></tbody><tfoot id="tfc"></tfoot></table></div>`,
    async depois() {
      let filtro = ''; let q = '';
      const render = async () => { const rows = await api(`/api/admin/contas?filtro=${filtro}&q=${encodeURIComponent(q)}`); $('#tbc').innerHTML = rows.map(c => `<tr><td class="mono">#${c.id}${c.admin ? ' 👑' : ''}</td><td>${esc(c.nome_dono)}</td><td>${esc(c.empresa)}</td><td>${esc(PLANO[c.plano] || c.plano || '—')}</td><td><span class="${STATUS[c.status] || 'tag'}">${esc(c.status)}</span></td><td style="text-align:right">${c.plano === 'ilimitado' || c.admin ? '∞' : fmtC(c.saldo)}</td><td style="text-align:right">${fmtC(c.gasto_30d)}</td><td style="text-align:right" title="Gemini ${fmtR(c.custo_gemini_brl)} (${fmtN(c.tokens_total)} tokens) · fal.ai ${fmtR(c.custo_fal_brl)} (${fmtN(c.imagens_fal)} imagens)"><b>${fmtR(c.custo_ia_brl)}</b><br><small style="color:var(--mudo)">30d ${fmtR(c.custo_ia_30d_brl)}</small></td><td>${c.ultimo_uso ? diaBr(c.ultimo_uso) : '—'}</td><td>${diaBr(c.criado_em)}</td><td><button class="minibtn" data-id="${c.id}">abrir</button></td></tr>`).join('') || '<tr><td colspan="11">Nenhuma conta.</td></tr>'; const tot = rows.reduce((a, c) => [a[0] + (c.custo_ia_brl || 0), a[1] + (c.custo_ia_30d_brl || 0)], [0, 0]); $('#tfc').innerHTML = rows.length ? `<tr><th colspan="7" style="text-align:right">Total ${rows.length} conta(s)</th><th style="text-align:right">${fmtR(tot[0])}<br><small style="color:var(--mudo);font-weight:400">30d ${fmtR(tot[1])}</small></th><th colspan="3"></th></tr>` : ''; document.querySelectorAll('#tbc button').forEach(b => b.onclick = () => abrirConta(Number(b.dataset.id))); };
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
    ${(() => { const b = d.piso?.bloqueadas || 0; const a = d.piso?.alerta || 0; const cor = b ? '#E25D5D' : (a ? '#D5A000' : '#4CAF7A'); const corT = b ? '#B4232A' : (a ? '#8A5A00' : '#1E7A45'); return `<div class="kpi" style="border:1px solid ${cor}"><div class="r">Proteção de margem</div><div class="v" style="color:${corT}">${b} travadas</div><div class="s">${a} em alerta (≥90% do piso) · piso: ${100 - (p['margem_piso']||0.5)*100}% margem mínima</div></div>`; })()}
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
    ${(() => { const linhas = d.piso?.contas || []; if (!linhas.length) return ''; return `<div class="cartao" style="grid-column:1/-1"><h3>Contas no limite de margem <small style="color:var(--mudo);font-weight:400">(${d.piso.bloqueadas} travadas · ${d.piso.alerta} em alerta)</small></h3><p class="d">Essas contas já consumiram mais de 90% do limite de IA desta recarga. As travadas (vermelhas) estão bloqueadas até comprar nova recarga — o usuário recebe "seu consumo de créditos expirou". <b>Esse limite é interno, não aparece para o cliente.</b></p>
      <div class="tabela compacta"><table><thead><tr><th>Conta</th><th>Empresa</th><th>Status</th><th style="text-align:right">Pago (BRL)</th><th style="text-align:right">Custo real IA</th><th style="text-align:right">Limite (50% do pago)</th><th style="text-align:right">% do limite</th><th style="text-align:right">Margem atual</th><th>Desde</th><th></th></tr></thead><tbody>${linhas.map(l => { const trav = l.bloqueado; const bg = trav ? 'background:#FBE7E7' : 'background:#FFF8E1'; return `<tr style="${bg}"><td>${esc(l.nome_dono)}</td><td>${esc(l.empresa)}</td><td><span class="tag ${trav?'off':'warn'}">${trav?'travada':'alerta'}</span></td><td style="text-align:right">${fmtR(l.valor_pago_brl)}</td><td style="text-align:right">${fmtR(l.custo_atual_brl)}</td><td style="text-align:right">${fmtR(l.limite_brl)}</td><td style="text-align:right;color:${trav?'#B4232A':'#8A5A00'};font-weight:700">${l.pct_do_limite}%</td><td style="text-align:right;font-weight:600">${l.margem_atual_pct}%</td><td>${l.bloqueada_margem_em?diaBr(l.bloqueada_margem_em):'—'}</td><td><button class="minibtn" data-c="${l.id}">abrir</button></td></tr>`; }).join('')}</tbody></table></div>
    </div>`; })()}
    <div class="cartao" style="grid-column:1/-1"><h3>Matriz custo × margem (todo pacote × toda IA)</h3><p class="d">Se um cliente consumir 100% dos créditos em texto no modelo da coluna. <b>Verde</b> = atinge a meta de 75%; <b>amarelo</b> = 50-74%; <b>vermelho</b> = abaixo de 50% (ou prejuízo).</p>
      <div class="tabela compacta" style="overflow:auto"><table><thead><tr><th>Pacote</th><th style="text-align:right">Preço</th>${d.matriz.modelos.map(m => `<th style="text-align:center">${esc(m.nome.replace('Gemini ',''))}<br><small style="color:var(--mudo);font-weight:400">R$ ${m.r_por_1k.toFixed(4)}/1k</small></th>`).join('')}</tr></thead><tbody>${d.matriz.matriz.map(r => `<tr><td>${esc(r.pacote)}${r.tipo==='mensal'?' <small style="color:var(--mudo)">(/mês)</small>':''}</td><td style="text-align:right">${fmtR(r.preco)}</td>${r.por_modelo.map(c => { const cor = c.margem_pct >= 75 ? '#1E7A45' : c.margem_pct >= 50 ? '#8A5A00' : '#B4232A'; const bg = c.margem_pct >= 75 ? '#E3F5EA' : c.margem_pct >= 50 ? '#FFF3DB' : '#FBE7E7'; return `<td style="text-align:center;background:${bg};color:${cor};font-weight:600">${c.margem_pct}%<br><small style="font-weight:400">${fmtR(c.lucro)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    </div>
    <div class="cartao" style="grid-column:1/-1"><h3>Custos fixos mensais <small style="color:var(--mudo);font-weight:400">· total ${fmtR(d.fixos?.total)}/mês</small></h3><p class="d">Preencha cada custo fixo que o Fiel tem por mês. O total entra automaticamente como "Infra fixa" na margem líquida (rateado por dia). Desmarque "ativo" para tirar um item do cálculo sem apagar.</p>
      <div class="tabela compacta"><table><thead><tr><th>Item</th><th>Categoria</th><th style="text-align:right">Valor (R$/mês)</th><th>Observação</th><th style="text-align:center">Ativo</th><th></th></tr></thead><tbody id="tbFixos">${(d.fixos?.itens || []).map(i => `<tr data-id="${i.id}"><td><input class="cf-nome" value="${esc(i.nome)}" style="width:100%;min-width:180px"></td><td><select class="cf-cat">${['infra','ferramenta','pessoal','marketing','outros'].map(c => `<option${c === (i.categoria||'outros') ? ' selected' : ''}>${c}</option>`).join('')}</select></td><td style="text-align:right"><input class="cf-valor" type="number" step="0.01" min="0" value="${Number(i.valor_brl||0).toFixed(2)}" style="width:110px;text-align:right"></td><td><input class="cf-obs" value="${esc(i.obs||'')}" placeholder="ex.: plano KVM 2, vence dia 10" style="width:100%;min-width:160px"></td><td style="text-align:center"><input class="cf-ativo" type="checkbox"${i.ativo ? ' checked' : ''}></td><td><button class="minibtn cf-del" title="remover">✕</button></td></tr>`).join('')}
        <tr id="cfNova" style="background:var(--fundo-2,#FAF5EC)"><td><input id="cfNovoNome" placeholder="novo custo (ex.: Domínio usefiel.app)" style="width:100%;min-width:180px"></td><td><select id="cfNovaCat">${['infra','ferramenta','pessoal','marketing','outros'].map(c => `<option>${c}</option>`).join('')}</select></td><td style="text-align:right"><input id="cfNovoValor" type="number" step="0.01" min="0" placeholder="0,00" style="width:110px;text-align:right"></td><td><input id="cfNovaObs" placeholder="observação" style="width:100%;min-width:160px"></td><td></td><td><button class="minibtn" id="cfAdd">+ adicionar</button></td></tr>
      </tbody><tfoot><tr><th colspan="2" style="text-align:right">Total ativo</th><th style="text-align:right" id="cfTotal">${fmtR(d.fixos?.total)}</th><th colspan="3"></th></tr></tfoot></table></div>
      <p class="d" style="margin-top:8px"><button class="btn prim" id="cfSalvar">Salvar custos fixos</button> <span class="salvo" id="cfMsg"></span></p>
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
        <tr><th>Infra fixa mensal (R$)</th><td><b>${fmtR(d.fixos?.total)}</b> <small style="color:var(--mudo)">— calculado pelos "Custos fixos mensais" acima</small></td></tr>
        <tr><th>Câmbio USD → BRL</th><td>${inp('usd_brl',0.01)}</td></tr>
        <tr><th>Meta de margem (fração)</th><td>${inp('margem_meta',0.01)} <small style="color:var(--mudo)">(0,75 = 75% líquido mínimo por pacote vendido)</small></td></tr>
        <tr><th>Piso de margem (fração)</th><td>${inp('margem_piso',0.01)} <small style="color:var(--mudo)">(0,50 = trava consumo quando o custo real da IA passa de 50% do que o cliente pagou nessa recarga)</small></td></tr>
      </tbody></table></div>
      <p class="d" style="margin-top:8px"><button class="btn prim" id="btSalvarPrecos">Salvar preços</button> <button class="btn sec" id="btResetPrecos">Restaurar padrões</button> <span class="salvo" id="prMsg"></span></p>
    </div>
  </div>`;
  return { titulo: '💰 Custos & margem', sub: 'Quanto você paga de IA, taxas de pagamento e infra — e sua margem real.', corpo, depois() {
    $('#btSalvarPrecos').onclick = async () => { $('#prMsg').textContent = 'salvando…'; const inputs = document.querySelectorAll('input.pr'); for (const el of inputs) { try { await post('/api/admin/custos/preco', { chave: el.dataset.k, valor: Number(el.value) }); } catch {} } $('#prMsg').textContent = '✅ salvo'; setTimeout(() => montarTela('custos'), 1200); };
    $('#btResetPrecos').onclick = async () => { if (!confirm('Restaurar todos os preços para os valores padrão de referência?')) return; await post('/api/admin/custos/resetar', {}); toast('✅ padrões restaurados'); setTimeout(() => montarTela('custos'), 500); };
    const btTPC = $('#btAplicarTPC'); if (btTPC) btTPC.onclick = async () => { const rec = d.margens.tokens_por_credito_recomendado; if (!confirm(`Trocar a tarifa de ${d.margens.tokens_por_credito_atual} para ${rec} tokens por crédito? Isso vale para TODAS as contas a partir do próximo débito e mantém a meta de ${d.margens.meta_pct}% de margem.`)) return; await post('/api/admin/custos/preco', { chave: 'tokens_por_credito', valor: rec }); toast(`✅ tarifa agora é ${rec} tokens/crédito`); setTimeout(() => montarTela('custos'), 600); };
    document.querySelectorAll('button[data-c]').forEach(b => b.onclick = () => abrirConta(Number(b.dataset.c)));
    // Custos fixos: total ao vivo, salvar em lote, adicionar e remover
    const linhasCF = () => [...document.querySelectorAll('#tbFixos tr[data-id]')];
    const recalcCF = () => { const t = linhasCF().reduce((s, tr) => s + (tr.querySelector('.cf-ativo').checked ? Number(tr.querySelector('.cf-valor').value) || 0 : 0), 0); $('#cfTotal').textContent = fmtR(t); };
    document.querySelectorAll('#tbFixos .cf-valor, #tbFixos .cf-ativo').forEach(el => el.oninput = el.onchange = recalcCF);
    $('#cfSalvar').onclick = async () => { $('#cfMsg').textContent = 'salvando…'; for (const tr of linhasCF()) { await post('/api/admin/custos-fixos', { id: Number(tr.dataset.id), nome: tr.querySelector('.cf-nome').value, categoria: tr.querySelector('.cf-cat').value, valor_brl: Number(tr.querySelector('.cf-valor').value) || 0, obs: tr.querySelector('.cf-obs').value, ativo: tr.querySelector('.cf-ativo').checked }); } $('#cfMsg').textContent = '✅ salvo'; setTimeout(() => montarTela('custos'), 700); };
    $('#cfAdd').onclick = async () => { const nome = $('#cfNovoNome').value.trim(); if (!nome) return toast('Dê um nome ao custo'); await post('/api/admin/custos-fixos', { nome, categoria: $('#cfNovaCat').value, valor_brl: Number($('#cfNovoValor').value) || 0, obs: $('#cfNovaObs').value }); toast('✅ custo adicionado'); montarTela('custos'); };
    document.querySelectorAll('#tbFixos .cf-del').forEach(b => b.onclick = async () => { const tr = b.closest('tr'); if (!confirm(`Remover "${tr.querySelector('.cf-nome').value}"?`)) return; await post(`/api/admin/custos-fixos/${tr.dataset.id}`, null, 'DELETE'); toast('removido'); montarTela('custos'); });
  } };
};

// ---------- 👥 Clientes (CRM) ----------
telas.clientes = async () => {
  const FILTROS = [['', 'todos'], ['pagantes', 'pagantes'], ['nunca_pagou', 'nunca pagou'], ['trial', 'trial'], ['mensal', 'mensal'], ['inativas', 'inativos 14d+'], ['com_telegram', 'com Telegram'], ['optin', 'aceitam ofertas']];
  return { titulo: '👥 Clientes', sub: 'Base com os dados de todos os clientes. Clique numa linha para editar telefone, etiquetas, notas e consentimento de ofertas.', corpo: `
    <div class="kpis" id="kpiCli"></div>
    <div class="linha-busca"><input id="qcli" placeholder="buscar nome, empresa, e-mail, telefone, CPF/CNPJ, etiqueta…" style="flex:1"><div class="sel-filtro" id="fcli">${FILTROS.map(([f, n]) => `<button data-f="${f}" class="${!f ? 'on' : ''}">${n}</button>`).join('')}</div><a class="btn sec" id="btCsv" href="/api/admin/clientes.csv">⬇ Exportar CSV</a></div>
    <div class="tabela compacta" style="overflow:auto"><table><thead><tr><th>Cliente</th><th>Contato</th><th>Plano</th><th style="text-align:right">Pago</th><th style="text-align:right">Custo IA</th><th>Último uso</th><th>Canais</th><th>Etiquetas</th><th>Desde</th></tr></thead><tbody id="tbcli"><tr><td colspan="9">carregando…</td></tr></tbody></table></div>
    <dialog id="dlgCli" style="max-width:520px;width:calc(100% - 32px);border:1px solid var(--linha);border-radius:14px;padding:22px"></dialog>`,
  depois() {
    let filtro = '', q = '', rows = [];
    const urlCsv = () => `/api/admin/clientes.csv?filtro=${filtro}&q=${encodeURIComponent(q)}`;
    const render = async () => {
      rows = await api(`/api/admin/clientes?filtro=${filtro}&q=${encodeURIComponent(q)}`); $('#btCsv').href = urlCsv();
      const pagantes = rows.filter(r => r.compras > 0); const receita = rows.reduce((s, r) => s + (r.total_pago || 0), 0);
      $('#kpiCli').innerHTML = `<div class="kpi"><div class="r">Clientes na lista</div><div class="v">${fmtN(rows.length)}</div><div class="s">${pagantes.length} pagantes</div></div><div class="kpi"><div class="r">Receita acumulada</div><div class="v">${fmtR(receita)}</div><div class="s">ticket médio ${fmtR(pagantes.length ? receita / pagantes.length : 0)}</div></div><div class="kpi"><div class="r">Aceitam ofertas</div><div class="v">${fmtN(rows.filter(r => r.marketing_optin === 1).length)}</div><div class="s">de ${rows.length}</div></div><div class="kpi"><div class="r">Telegram vinculado</div><div class="v">${fmtN(rows.filter(r => r.tem_telegram).length)}</div><div class="s">recebem pelo bot</div></div>`;
      $('#tbcli').innerHTML = rows.map(r => `<tr data-id="${r.id}" style="cursor:pointer"><td><b>${esc(r.nome_dono)}</b>${r.admin ? ' 👑' : ''}<br><small style="color:var(--mudo)">${esc(r.empresa || '')}${r.cpf_cnpj ? ' · ' + esc(r.cpf_cnpj) : ''}</small></td><td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—'}<br><small>${r.telefone ? `<a href="https://wa.me/55${String(r.telefone).replace(/\D/g, '').replace(/^55/, '')}" target="_blank" rel="noopener">📱 ${esc(r.telefone)}</a>` : '<span style="color:var(--mudo)">sem telefone</span>'}</small></td><td>${esc(PLANO[r.plano] || r.plano || '—')}<br><span class="${STATUS[r.status] || 'tag'}">${esc(r.status)}</span></td><td style="text-align:right">${fmtR(r.total_pago)}<br><small style="color:var(--mudo)">${r.compras} compra(s)</small></td><td style="text-align:right">${fmtR(r.custo_ia_brl)}</td><td>${r.ultimo_uso ? diaBr(r.ultimo_uso) : '—'}</td><td>${r.email ? '✉️' : ''} ${r.tem_telegram ? '✈️' : ''}<br><small>${r.marketing_optin === 1 ? '<span class="tag ok">ofertas ✓</span>' : '<span class="tag">sem ofertas</span>'}</small></td><td>${(r.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t.trim())}</span>`).join(' ')}</td><td>${diaBr(r.criado_em)}</td></tr>`).join('') || '<tr><td colspan="9">Nenhum cliente.</td></tr>';
      document.querySelectorAll('#tbcli tr[data-id]').forEach(tr => tr.onclick = (e) => { if (e.target.closest('a')) return; editar(rows.find(r => r.id === Number(tr.dataset.id))); });
    };
    const editar = (r) => {
      const d = $('#dlgCli');
      d.innerHTML = `<h3 style="margin-top:0">${esc(r.nome_dono)} <small style="color:var(--mudo);font-weight:400">#${r.id}</small></h3>
        <div class="campo"><label>Empresa</label><input id="ceEmp" value="${esc(r.empresa || '')}"></div>
        <div class="campo"><label>E-mail</label><input id="ceEmail" type="email" value="${esc(r.email || '')}"></div>
        <div class="campo"><label>WhatsApp / telefone</label><input id="ceTel" value="${esc(r.telefone || '')}" placeholder="(47) 99999-9999"></div>
        <div class="campo"><label>Etiquetas (separe por vírgula)</label><input id="ceTags" value="${esc(r.tags || '')}" placeholder="ex.: têxtil, indicação, vip"></div>
        <div class="campo"><label>Notas</label><textarea id="ceNotas" rows="4">${esc(r.notas || '')}</textarea></div>
        <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="ceOpt"${r.marketing_optin === 1 ? ' checked' : ''}> Aceita receber ofertas e lançamentos</label>
        <p class="d" style="margin:0 0 12px">${r.marketing_optin_em ? 'Consentimento atualizado em ' + diaBr(r.marketing_optin_em) + '. ' : ''}Só marque se o cliente pediu — é registro de consentimento (LGPD).</p>
        <p class="d">Pago: <b>${fmtR(r.total_pago)}</b> em ${r.compras} compra(s) · última ${r.ultima_compra ? diaBr(r.ultima_compra) : '—'} · custo IA ${fmtR(r.custo_ia_brl)} · saldo ${fmtC(r.saldo)} créd.</p>
        <p style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:0"><button class="btn sec" id="ceConta">Abrir conta</button><button class="btn sec" id="ceFechar">Fechar</button><button class="btn prim" id="ceSalvar">Salvar</button></p>`;
      d.showModal();
      $('#ceFechar').onclick = () => d.close();
      $('#ceConta').onclick = () => { d.close(); abrirConta(r.id); };
      $('#ceSalvar').onclick = async () => { const corpo = { empresa: $('#ceEmp').value, email: $('#ceEmail').value, telefone: $('#ceTel').value, tags: $('#ceTags').value, notas: $('#ceNotas').value }; if ($('#ceOpt').checked !== (r.marketing_optin === 1)) corpo.marketing_optin = $('#ceOpt').checked; const x = await post(`/api/admin/clientes/${r.id}`, corpo); if (x.ok) { toast('✅ salvo'); d.close(); render(); } };
    };
    $('#qcli').oninput = (e) => { q = e.target.value; clearTimeout(window._bcli); window._bcli = setTimeout(render, 250); };
    $('#fcli').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filtro = b.dataset.f; document.querySelectorAll('#fcli button').forEach(x => x.classList.toggle('on', x === b)); render(); };
    render();
  } };
};

// ---------- 📣 Campanhas (e-mail + Telegram) ----------
telas.campanhas = async () => {
  const hist = await api('/api/admin/campanhas');
  const PUBLICOS = [['ativas', 'Contas ativas'], ['todas', 'Todas as contas'], ['pagantes', 'Quem já pagou'], ['nunca_pagou', 'Nunca pagou'], ['trial', 'Em trial'], ['mensal', 'Plano mensal'], ['inativas', 'Inativas há 14+ dias'], ['bloqueadas', 'Bloqueadas (saldo zerado)'], ['tag:', 'Por etiqueta…']];
  const ST = { rascunho: 'tag', enviando: 'tag warn', concluida: 'tag ok', erro: 'tag off' };
  const NOME_ST = { rascunho: 'rascunho', enviando: 'enviando', concluida: 'concluída', erro: 'erro' };
  return { titulo: '📣 Campanhas', sub: 'Avisos, ofertas e lançamentos por e-mail e Telegram — com prévia ao vivo de como chega para o cliente.', corpo: `
  <div class="camp-grid">
    <form id="fCamp" class="cartao camp-form" autocomplete="off">
      <div class="camp-sec"><span class="camp-n">1</span><h3>Para quem</h3></div>
      <div class="camp-seg" role="radiogroup">
        <label><input type="radio" name="tipo" value="aviso" checked><span><b>Aviso do serviço</b><small>vai para todos do público</small></span></label>
        <label><input type="radio" name="tipo" value="oferta"><span><b>Oferta / lançamento</b><small>só quem aceitou receber</small></span></label>
      </div>
      <div class="linha2">
        <div class="campo"><label>Público</label><select name="filtro">${PUBLICOS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
        <div class="campo oculto" id="campoTag"><label>Etiqueta</label><input name="tag" placeholder="ex.: vip"></div>
      </div>
      <div class="campo"><label>Canais</label><div class="camp-chips">
        <label class="camp-chip"><input type="checkbox" name="canais" value="email" checked><span>✉️ E-mail</span></label>
        <label class="camp-chip"><input type="checkbox" name="canais" value="telegram" checked><span>✈️ Telegram</span></label>
      </div></div>
      <div class="camp-publico" id="previa">calculando…</div>

      <div class="camp-sec"><span class="camp-n">2</span><h3>Mensagem</h3></div>
      <div class="campo"><label>Título — topo do e-mail e do Telegram</label><input name="titulo" maxlength="90" placeholder="Chegou o Fiel para WhatsApp"></div>
      <div class="linha2">
        <div class="campo"><label>Assunto do e-mail</label><input name="assunto" maxlength="120" placeholder="{nome}, sua equipe agora atende no WhatsApp"></div>
        <div class="campo"><label>Prévia na caixa de entrada (opcional)</label><input name="preheader" maxlength="140" placeholder="o texto curto que aparece ao lado do assunto"></div>
      </div>
      <div class="campo"><label>Texto</label><textarea name="texto" rows="9" required placeholder="Oi {nome}!&#10;&#10;Escreva aqui. Linha em branco = novo parágrafo. *negrito* e links funcionam.&#10;&#10;{nome} = primeiro nome · {empresa} = empresa do cliente"></textarea>
        <div class="camp-vars">Inserir: <button type="button" data-v="{nome}">{nome}</button> <button type="button" data-v="{empresa}">{empresa}</button> <button type="button" data-v="*negrito*">*negrito*</button></div></div>
      <div class="linha2">
        <div class="campo"><label>Botão — texto (opcional)</label><input name="botao_texto" maxlength="40" placeholder="Quero conhecer"></div>
        <div class="campo"><label>Botão — link</label><input name="botao_url" type="url" placeholder="https://usefiel.com/app"></div>
      </div>

      <div class="camp-sec"><span class="camp-n">3</span><h3>Enviar</h3></div>
      <div class="camp-acoes"><button type="button" class="btn sec" id="btTeste">Enviar teste só para mim</button><button class="btn ouro" id="btEnviar">Enviar campanha</button></div>
      <p class="camp-msg" id="campMsg"></p>
      <p class="d camp-lgpd">Ofertas vão só para quem aceitou no cadastro (ou mandou "receber ofertas" no Telegram) e todo e-mail de oferta leva link de descadastro — LGPD. Avisos do serviço vão para todo o público.</p>
    </form>

    <div class="camp-prev">
      <div class="camp-tabs"><button type="button" class="on" data-p="email">✉️ E-mail</button><button type="button" data-p="telegram">✈️ Telegram</button><span class="camp-ex">exemplo com “Maria Souza”</span></div>
      <div id="pvEmail" class="camp-mail">
        <div class="camp-mail-top"><div class="camp-av">F</div><div><b>Fiel</b> <small>&lt;ola@usefiel.com&gt;</small><div class="camp-assunto" id="pvAssunto">—</div></div></div>
        <iframe id="pvFrame" title="Prévia do e-mail" sandbox="allow-same-origin"></iframe>
      </div>
      <div id="pvTg" class="camp-tg oculto"><div class="camp-tg-bolha" id="pvTgTexto"></div></div>
    </div>
  </div>

  <div class="cartao" style="margin-top:16px"><h3>Histórico</h3><div class="tabela compacta" style="overflow:auto"><table><thead><tr><th>Data</th><th>Campanha</th><th>Tipo</th><th>Canais</th><th>Público</th><th style="text-align:right">✉️ ok</th><th style="text-align:right">✈️ ok</th><th style="text-align:right">Falhas</th><th>Status</th><th></th></tr></thead><tbody>${hist.map(c => `<tr><td>${diaBr(c.enviado_em || c.criado_em)}</td><td><b>${esc(c.titulo || c.assunto || c.texto.slice(0, 40))}</b>${c.assunto && c.titulo ? `<br><small style="color:var(--mudo)">${esc(c.assunto)}</small>` : ''}</td><td>${c.tipo === 'oferta' ? '<span class="tag warn">oferta</span>' : '<span class="tag">aviso</span>'}</td><td>${c.canais.split(',').map(x => x === 'email' ? '✉️' : '✈️').join(' ')}</td><td>${esc(c.filtro)}</td><td style="text-align:right">${c.ok_email}</td><td style="text-align:right">${c.ok_telegram}</td><td style="text-align:right">${c.falhas ? `<b style="color:#E25D5D">${c.falhas}</b>` : 0}</td><td><span class="${ST[c.status] || 'tag'}">${NOME_ST[c.status] || esc(c.status)}</span></td><td><button class="minibtn" data-env="${c.id}">detalhes</button></td></tr>`).join('') || '<tr><td colspan="10" style="color:var(--mudo)">Nenhuma campanha enviada ainda.</td></tr>'}</tbody></table></div><div id="envios"></div></div>`,
  depois() {
    const f = $('#fCamp');
    const dados = () => { const x = Object.fromEntries(new FormData(f)); x.canais = [...f.querySelectorAll('input[name=canais]:checked')].map(i => i.value); if (x.filtro === 'tag:') x.filtro = 'tag:' + (x.tag || '').trim(); return x; };
    const escTg = (t) => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
    const previa = async () => {
      const d = dados(); const box = $('#previa');
      if (!d.canais.length) { box.innerHTML = '<span class="camp-alerta">Escolha ao menos um canal.</span>'; return; }
      const p = await post('/api/admin/campanhas/previa', d);
      box.innerHTML = `<div class="camp-num"><b>${p.total_publico}</b><span>no público</span></div>${d.canais.includes('email') ? `<div class="camp-num"><b>${p.email}</b><span>✉️ por e-mail</span></div>` : ''}${d.canais.includes('telegram') ? `<div class="camp-num"><b>${p.telegram}</b><span>✈️ no Telegram</span></div>` : ''}${d.tipo === 'oferta' && p.sem_consentimento ? `<div class="camp-num mudo"><b>${p.sem_consentimento}</b><span>sem aceite de ofertas (fora)</span></div>` : ''}${d.canais.includes('email') && !p.smtp ? '<div class="camp-alerta">E-mail não configurado no servidor (SMTP) — só o Telegram vai sair.</div>' : ''}`;
    };
    const render = async () => {
      const d = dados(); const r = await post('/api/admin/campanhas/render', d);
      $('#pvAssunto').textContent = r.assunto || '(sem assunto)';
      const fr = $('#pvFrame'); fr.srcdoc = r.html; fr.onload = () => { try { fr.style.height = (fr.contentDocument.body.scrollHeight + 4) + 'px'; } catch { fr.style.height = '900px'; } };
      $('#pvTgTexto').innerHTML = escTg(r.telegram || '');
    };
    let t1, t2; const agendar = () => { clearTimeout(t1); t1 = setTimeout(render, 350); };
    f.addEventListener('input', agendar);
    f.addEventListener('change', (e) => { if (e.target.name === 'filtro') $('#campoTag').classList.toggle('oculto', e.target.value !== 'tag:'); if (['tipo', 'filtro', 'canais'].includes(e.target.name)) previa(); agendar(); });
    f.tag.addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(previa, 350); });
    document.querySelectorAll('.camp-vars button').forEach(b => b.onclick = () => { const ta = f.texto; const [a, z] = [ta.selectionStart, ta.selectionEnd]; ta.setRangeText(b.dataset.v, a, z, 'end'); ta.focus(); agendar(); });
    document.querySelectorAll('.camp-tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.camp-tabs button').forEach(x => x.classList.toggle('on', x === b)); $('#pvEmail').classList.toggle('oculto', b.dataset.p !== 'email'); $('#pvTg').classList.toggle('oculto', b.dataset.p !== 'telegram'); });
    const msg = (t, ok = true) => { const el = $('#campMsg'); el.textContent = t; el.className = 'camp-msg ' + (ok ? 'ok' : 'erro'); };
    $('#btTeste').onclick = async () => { const d = dados(); if (!d.texto?.trim()) return msg('Escreva a mensagem antes do teste.', false); if (!d.canais.length) return msg('Escolha um canal.', false); msg('Enviando teste…'); const r = await post('/api/admin/campanhas/teste', d); const partes = [r.email && `E-mail: ${r.email}`, r.telegram && `Telegram: ${r.telegram}`].filter(Boolean); msg(partes.join(' · ') || 'Nada enviado.', !/falhou/.test(partes.join())); };
    f.onsubmit = async (e) => { e.preventDefault(); const d = dados(); await previa(); const resumo = [...document.querySelectorAll('#previa .camp-num')].map(x => x.innerText.replace('\n', ' ')).join(' · '); if (!confirm(`Enviar "${d.titulo || d.assunto || 'campanha'}" agora?\n\n${resumo}`)) return; msg('Disparando…'); const r = await post('/api/admin/campanhas', d); if (r.ok) { toast(`✅ campanha na fila: ${r.total} envio(s)`); setTimeout(() => montarTela('campanhas'), 1500); } else msg(r.erro || 'Não foi possível enviar.', false); };
    document.querySelectorAll('button[data-env]').forEach(b => b.onclick = async () => { const rows = await api(`/api/admin/campanhas/${b.dataset.env}/envios`); $('#envios').innerHTML = `<h4 style="margin:16px 0 8px">Envios da campanha #${b.dataset.env}</h4><div class="tabela compacta"><table><thead><tr><th>Cliente</th><th>Canal</th><th>Destino</th><th>Status</th><th>Erro</th><th>Quando</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.nome_dono || '#' + x.conta_id)}</td><td>${x.canal === 'email' ? '✉️' : '✈️'}</td><td>${esc(x.destino)}</td><td><span class="tag ${x.status === 'ok' ? 'ok' : 'off'}">${x.status}</span></td><td>${esc(x.erro || '')}</td><td>${diaBr(x.enviado_em)}</td></tr>`).join('') || '<tr><td colspan="6">Sem envios.</td></tr>'}</tbody></table></div>`; });
    previa(); render();
  } };
};
