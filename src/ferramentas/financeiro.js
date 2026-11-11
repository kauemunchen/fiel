// Tina — módulo financeiro (sem Open Finance). Carteiras, lançamentos, contas a pagar/receber, importação de
// extrato (OFX/CSV/PDF/imagem), conciliação, DRE, fluxo de caixa e regras de categorização aprendidas.
// REGRAS DURAS (validadas aqui): nunca movimenta dinheiro; todo lançamento tem carteira; baixa só com comprovante ou extrato.
import crypto from 'node:crypto';
import { db } from '../db/index.js';

export function prepararFinanceiro() {
  db.exec(`CREATE TABLE IF NOT EXISTS fin_lancamentos (
      id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, carteira TEXT NOT NULL, tipo TEXT NOT NULL, valor REAL NOT NULL,
      descricao TEXT, categoria TEXT, subcategoria TEXT, contraparte TEXT, status TEXT NOT NULL DEFAULT 'pago',
      data TEXT NOT NULL, vencimento TEXT, pago_em TEXT, origem TEXT DEFAULT 'manual', documento TEXT, comprovante TEXT,
      recorrente INTEGER DEFAULT 0, hash TEXT, oculto INTEGER DEFAULT 0, conciliado_id INTEGER, importacao_id INTEGER,
      criado_em TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS ix_fin_conta ON fin_lancamentos (conta_id, carteira, data);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_hash ON fin_lancamentos (conta_id, hash) WHERE hash IS NOT NULL;
    CREATE TABLE IF NOT EXISTS fin_regras (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, padrao TEXT NOT NULL, categoria TEXT, subcategoria TEXT, carteira TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS fin_saldos (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, carteira TEXT NOT NULL, saldo REAL NOT NULL, data TEXT NOT NULL, criado_em TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS fin_importacoes (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, carteira TEXT, dados TEXT NOT NULL, resumo TEXT, status TEXT DEFAULT 'pendente', criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
  try { db.exec('ALTER TABLE contas ADD COLUMN carteiras TEXT'); } catch {}
}
prepararFinanceiro();

// ---------- plano de contas KM ----------
export const PLANO_PJ = ['Receita operacional', 'Outras receitas', 'Custos variáveis', 'Despesas fixas', 'Despesas financeiras', 'Investimentos', 'Retiradas'];
export const PLANO_PF = ['Renda', 'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros'];
const ehPF = (carteira) => /pessoal|\bpf\b|casa|fam[ií]lia|particular/i.test(carteira || '');
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesDe = (d) => String(d).slice(0, 7);
const somaDias = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

// ---------- carteiras ----------
export function carteirasDe(contaId) { const c = db.prepare('SELECT carteiras FROM contas WHERE id=?').get(contaId)?.carteiras || ''; return c.split(/[,;\n]/).map(x => x.trim()).filter(Boolean); }
export function resolverCarteira(contaId, nome, { obrigatoria = true } = {}) {
  const lista = carteirasDe(contaId);
  if (!lista.length) throw new Error('Ainda não há carteiras definidas. Pergunte ao dono quais são (ex.: "Mais Têxtil, Douglas Confecções, Pessoal") e use definir_carteiras.');
  if (!nome) { if (lista.length === 1) return lista[0]; if (obrigatoria) throw new Error(`Lançamento sem carteira. Pergunte ao dono qual carteira: ${lista.join(', ')}.`); return null; }
  const n = semAcento(nome); const achou = lista.find(c => semAcento(c) === n) || lista.find(c => semAcento(c).includes(n) || n.includes(semAcento(c)));
  if (!achou) throw new Error(`Carteira "${nome}" não existe. Carteiras: ${lista.join(', ')}. Se for nova, confirme com o dono e use definir_carteiras.`);
  return achou;
}
/** Tenta descobrir a carteira citada num texto livre (legenda do arquivo). */
export function carteiraNoTexto(contaId, texto) { const t = semAcento(texto); return carteirasDe(contaId).find(c => t.includes(semAcento(c))) || null; }

// ---------- categorização: regras do dono primeiro, depois IA ----------
function aplicarRegras(contaId, carteira, descricao) {
  const d = semAcento(descricao);
  return db.prepare('SELECT * FROM fin_regras WHERE conta_id=? AND (carteira IS NULL OR carteira=?) ORDER BY length(padrao) DESC').all(contaId, carteira).find(r => d.includes(semAcento(r.padrao))) || null;
}
async function categorizarComIA(carteira, itens) {
  if (!itens.length) return [];
  const plano = ehPF(carteira) ? PLANO_PF : PLANO_PJ;
  const { gerarJSON } = await import('../integracoes/gemini.js');
  const saida = [];
  for (let i = 0; i < itens.length; i += 120) {
    const lote = itens.slice(i, i + 120);
    const j = await gerarJSON(`Classifique cada lançamento bancário da carteira "${carteira}" (${ehPF(carteira) ? 'pessoa física' : 'empresa'}) numa categoria do plano: ${plano.join(' | ')}. Inclua uma subcategoria curta (ex.: energia, folha, facção, combustível, mercado, tarifa bancária, pró-labore). Transferência entre contas próprias: categoria "Transferência". Responda JSON {"r":[{"i":número,"categoria":string,"subcategoria":string}]}.
${lote.map((x, k) => `${i + k}. ${x.valor < 0 ? 'SAÍDA' : 'ENTRADA'} ${Math.abs(x.valor).toFixed(2)} — ${x.descricao}`).join('\n')}`);
    for (const r of (j.r || [])) saida[r.i] = { categoria: [...plano, 'Transferência'].includes(r.categoria) ? r.categoria : (ehPF(carteira) ? 'Outros' : null), subcategoria: r.subcategoria || null };
  }
  return saida;
}

// ---------- importação de extrato ----------
const hashDe = (contaId, carteira, l) => crypto.createHash('sha1').update(l.fitid ? `fitid|${carteira}|${l.fitid}` : `${carteira}|${l.data}|${Number(l.valor).toFixed(2)}|${semAcento(l.descricao).replace(/\s+/g, ' ')}`).digest('hex');
export async function importarLancamentos(contaId, carteira, doc, { importacaoId = null } = {}) {
  const lanc = (doc.lancamentos || []).filter(l => l.data && Number(l.valor));
  if (!lanc.length) throw new Error('Não encontrei lançamentos nesse arquivo.');
  const regras = lanc.map(l => aplicarRegras(contaId, carteira, l.descricao));
  const semRegra = lanc.map((l, i) => ({ ...l, i })).filter((_, i) => !regras[i]);
  let ia = []; try { ia = await categorizarComIA(carteira, semRegra); } catch (e) { console.error('[tina] categorizar', e.message); }
  const catIA = {}; semRegra.forEach((l, k) => { catIA[l.i] = ia[k] || ia[l.i] || null; });
  const ins = db.prepare(`INSERT OR IGNORE INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, status, data, pago_em, origem, hash, importacao_id) VALUES (?,?,?,?,?,?,?,'pago',?,?, 'extrato', ?, ?)`);
  let novos = 0, dup = 0, ent = 0, sai = 0;
  db.transaction(() => { lanc.forEach((l, i) => {
    const c = regras[i] || catIA[i] || {}; const v = Number(l.valor);
    const r = ins.run(contaId, carteira, v < 0 ? 'saida' : 'entrada', Math.abs(v), String(l.descricao).slice(0, 300), c.categoria || null, c.subcategoria || null, l.data, l.data, hashDe(contaId, carteira, l), importacaoId);
    if (r.changes) { novos++; v < 0 ? (sai += -v) : (ent += v); } else dup++;
  }); })();
  if (doc.saldo_final != null && !isNaN(doc.saldo_final)) db.prepare('INSERT INTO fin_saldos (conta_id, carteira, saldo, data) VALUES (?,?,?,?)').run(contaId, carteira, Number(doc.saldo_final), doc.saldo_data || lanc.map(l => l.data).sort().pop());
  const conc = conciliar(contaId, carteira);
  const datas = lanc.map(l => l.data).sort();
  const semCat = db.prepare("SELECT COUNT(*) n FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND origem='extrato' AND categoria IS NULL AND oculto=0").get(contaId, carteira).n;
  return { carteira, periodo: `${datas[0]} a ${datas[datas.length - 1]}`, importados: novos, duplicados_ignorados: dup, entradas: +ent.toFixed(2), saidas: +sai.toFixed(2), conciliados_com_contas_previstas: conc.length, sem_categoria: semCat, saldo_final: doc.saldo_final ?? null };
}
/** Guarda um extrato lido para importar depois que o dono disser a carteira. */
export function guardarImportacao(contaId, doc) {
  return Number(db.prepare('INSERT INTO fin_importacoes (conta_id, dados, resumo) VALUES (?,?,?)').run(contaId, JSON.stringify(doc), `${doc.lancamentos.length} lançamentos`).lastInsertRowid);
}

// Conta fixa paga → agenda a do mês seguinte (mesmo dia; dia 31 vira o último dia do mês).
function criarProximaRecorrencia(p) {
  if (!p.recorrente) return null;
  const base = new Date((p.vencimento || p.data) + 'T12:00:00Z'); const dia = base.getUTCDate();
  const prox = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 12)); const ultimo = new Date(Date.UTC(prox.getUTCFullYear(), prox.getUTCMonth() + 1, 0, 12)).getUTCDate();
  prox.setUTCDate(Math.min(dia, ultimo)); const nv = prox.toISOString().slice(0, 10);
  if (db.prepare("SELECT 1 FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND descricao=? AND COALESCE(vencimento,data)=? AND oculto=0").get(p.conta_id, p.carteira, p.descricao, nv)) return null;
  return Number(db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, contraparte, status, data, vencimento, origem, recorrente) VALUES (?,?,?,?,?,?,?,?,'previsto',?,?,'recorrente',1)").run(p.conta_id, p.carteira, p.tipo, p.valor, p.descricao, p.categoria, p.subcategoria, p.contraparte, nv, nv).lastInsertRowid);
}

// ---------- conciliação: extrato dá baixa em conta prevista (mesmo valor, até 5 dias de diferença) ----------
export function conciliar(contaId, carteira) {
  const prev = db.prepare("SELECT * FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND status='previsto' AND oculto=0").all(contaId, carteira);
  const feitos = [];
  for (const p of prev) {
    const ref = p.vencimento || p.data;
    const e = db.prepare(`SELECT * FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND origem='extrato' AND status='pago' AND oculto=0 AND tipo=? AND abs(valor-?)<0.01
      AND data BETWEEN ? AND ? AND id NOT IN (SELECT conciliado_id FROM fin_lancamentos WHERE conciliado_id IS NOT NULL) ORDER BY abs(julianday(data)-julianday(?)) LIMIT 1`).get(contaId, carteira, p.tipo, p.valor, somaDias(ref, -5), somaDias(ref, 5), ref);
    if (!e) continue;
    // A conta prevista vira paga (mantém descrição/categoria do dono); a linha do extrato fica oculta para não contar em dobro.
    db.prepare("UPDATE fin_lancamentos SET status='pago', pago_em=?, conciliado_id=?, comprovante=COALESCE(comprovante, 'extrato #' || ?) WHERE id=?").run(e.data, e.id, e.id, p.id);
    db.prepare('UPDATE fin_lancamentos SET oculto=1 WHERE id=?').run(e.id);
    const prox = criarProximaRecorrencia(p);
    feitos.push({ conta_prevista: p.id, descricao: p.descricao, valor: p.valor, pago_em: e.data, proxima_recorrencia: prox });
  }
  return feitos;
}

// ---------- consultas ----------
const efetiva = "COALESCE(pago_em, data)";
function totaisPorCategoria(contaId, carteira, mes) {
  const cond = carteira ? 'AND carteira=?' : ''; const args = carteira ? [contaId, carteira, mes] : [contaId, mes];
  return db.prepare(`SELECT tipo, COALESCE(categoria,'Sem categoria') categoria, SUM(valor) total, COUNT(*) n FROM fin_lancamentos WHERE conta_id=? ${cond} AND status='pago' AND oculto=0 AND substr(${efetiva},1,7)=? AND COALESCE(categoria,'')<>'Transferência' GROUP BY tipo, categoria`).all(...args);
}
export function gerarDRE(contaId, { mes, carteira } = {}) {
  const m = mes || mesDe(somaDias(hoje(), -28)); const cart = carteira ? resolverCarteira(contaId, carteira) : null;
  const ant = mesDe(somaDias(m + '-15', -30));
  const monta = (mm) => {
    const t = totaisPorCategoria(contaId, cart, mm); const s = (cat, tipo) => t.filter(x => x.categoria === cat && (!tipo || x.tipo === tipo)).reduce((a, x) => a + x.total, 0);
    if (cart && ehPF(cart)) { const ent = t.filter(x => x.tipo === 'entrada').reduce((a, x) => a + x.total, 0); const sai = t.filter(x => x.tipo === 'saida').reduce((a, x) => a + x.total, 0); return { tipo: 'PF', entradas: +ent.toFixed(2), saidas: +sai.toFixed(2), sobra: +(ent - sai).toFixed(2), por_categoria: Object.fromEntries(t.filter(x => x.tipo === 'saida').map(x => [x.categoria, +x.total.toFixed(2)])) }; }
    const receita = s('Receita operacional', 'entrada'), outras = s('Outras receitas', 'entrada'), cv = s('Custos variáveis', 'saida'), df = s('Despesas fixas', 'saida'), fin = s('Despesas financeiras', 'saida'), inv = s('Investimentos', 'saida'), ret = s('Retiradas', 'saida');
    const semCat = t.filter(x => x.categoria === 'Sem categoria').reduce((a, x) => a + (x.tipo === 'saida' ? -x.total : x.total), 0);
    const mc = receita - cv, ro = mc - df, res = ro - fin + outras;
    return { tipo: 'PJ', receita_operacional: +receita.toFixed(2), custos_variaveis: +cv.toFixed(2), margem_contribuicao: +mc.toFixed(2), margem_pct: receita ? +(mc / receita * 100).toFixed(1) : null, despesas_fixas: +df.toFixed(2), despesa_fixa_pct_receita: receita ? +(df / receita * 100).toFixed(1) : null, resultado_operacional: +ro.toFixed(2), despesas_financeiras: +fin.toFixed(2), outras_receitas: +outras.toFixed(2), resultado: +res.toFixed(2), abaixo_da_linha: { investimentos: +inv.toFixed(2), retiradas: +ret.toFixed(2) }, sem_categoria_liquido: +semCat.toFixed(2) };
  };
  const atual = monta(m), anterior = monta(ant);
  const alertas = []; if (atual.despesa_fixa_pct_receita > 60) alertas.push(`despesa fixa em ${atual.despesa_fixa_pct_receita}% da receita (limite 60%)`); if (atual.sem_categoria_liquido) alertas.push('há lançamentos sem categoria — recategorize para o DRE ficar exato');
  return { mes: m, carteira: cart || 'consolidado (todas)', atual, mes_anterior: { mes: ant, ...anterior }, alertas, instrucao: 'Responda com os números principais, a comparação com o mês anterior e 3 leituras curtas.' };
}
export function saldoAtual(contaId, carteira) {
  const s = db.prepare('SELECT saldo, data FROM fin_saldos WHERE conta_id=? AND carteira=? ORDER BY data DESC, id DESC LIMIT 1').get(contaId, carteira);
  const desde = s?.data || '0000-00-00';
  const mov = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) v FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND status='pago' AND oculto=0 AND ${efetiva} > ?`).get(contaId, carteira, desde).v;
  return { saldo: +((s?.saldo || 0) + mov).toFixed(2), tem_saldo_inicial: !!s, base: s ? `saldo informado ${brl(s.saldo)} em ${s.data}` : 'sem saldo inicial informado (soma só do que foi lançado)' };
}
export function fluxoCaixa(contaId, { dias = 15, carteira } = {}) {
  const carts = carteira ? [resolverCarteira(contaId, carteira)] : carteirasDe(contaId); const fim = somaDias(hoje(), Number(dias) || 15);
  return { ate: fim, carteiras: carts.map(c => {
    const s = saldoAtual(contaId, c);
    const prev = db.prepare("SELECT id, tipo, valor, descricao, COALESCE(vencimento,data) venc FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND status='previsto' AND oculto=0 AND COALESCE(vencimento,data)<=? ORDER BY venc").all(contaId, c, fim);
    let corrente = s.saldo, minimo = s.saldo, diaMin = hoje(); const atrasadas = prev.filter(p => p.venc < hoje());
    for (const p of prev) { corrente += p.tipo === 'entrada' ? p.valor : -p.valor; if (corrente < minimo) { minimo = corrente; diaMin = p.venc < hoje() ? hoje() : p.venc; } }
    const ent = prev.filter(p => p.tipo === 'entrada').reduce((a, p) => a + p.valor, 0), sai = prev.filter(p => p.tipo === 'saida').reduce((a, p) => a + p.valor, 0);
    return { carteira: c, saldo_hoje: s.saldo, base: s.base, a_receber: +ent.toFixed(2), a_pagar: +sai.toFixed(2), saldo_projetado: +corrente.toFixed(2), menor_saldo: +minimo.toFixed(2), dia_menor_saldo: diaMin, alerta: minimo < 0 ? `saldo fica NEGATIVO (${brl(minimo)}) em ${diaMin}` : null, atrasadas: atrasadas.map(p => ({ id: p.id, tipo: p.tipo, descricao: p.descricao, valor: p.valor, venceu: p.venc })) };
  }) };
}
export function contasEmAberto(contaId, { dias = 7, carteira } = {}) {
  const cart = carteira ? resolverCarteira(contaId, carteira) : null; const fim = somaDias(hoje(), Number(dias) || 7);
  const rows = db.prepare(`SELECT id, carteira, tipo, valor, descricao, contraparte, COALESCE(vencimento,data) venc, documento FROM fin_lancamentos WHERE conta_id=? ${cart ? 'AND carteira=?' : ''} AND status='previsto' AND oculto=0 AND COALESCE(vencimento,data)<=? ORDER BY venc`).all(...(cart ? [contaId, cart, fim] : [contaId, fim]));
  return { hoje: hoje(), ate: fim, atrasadas: rows.filter(r => r.venc < hoje()), vencem_hoje: rows.filter(r => r.venc === hoje()), proximas: rows.filter(r => r.venc > hoje()) };
}
/** Linhas para o aviso das 8h (contas vencendo hoje e atrasadas). */
export function avisosFinanceiros(contaId) {
  const a = contasEmAberto(contaId, { dias: 2 }); const linha = (r) => `${r.tipo === 'saida' ? '💸 Pagar' : '💰 Receber'} ${brl(r.valor)} — ${r.descricao}${r.contraparte ? ' (' + r.contraparte + ')' : ''} · ${r.carteira}`;
  return [...a.atrasadas.map(r => `⚠️ ATRASADA desde ${r.venc.split('-').reverse().join('/')}: ${linha(r)}`), ...a.vencem_hoje.map(r => `HOJE: ${linha(r)}`), ...a.proximas.map(r => `${r.venc.split('-').reverse().join('/')}: ${linha(r)}`)];
}

// ---------- ferramentas (declarações para a IA) ----------
const S = { type: 'STRING' }, N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' };
const obj = (properties, required = []) => ({ type: 'OBJECT', properties, required });
export const requerConfirmacao = new Set(['excluir_lancamento', 'criar_cobranca']);
export function ferramentas(_conta) {
  return [
    { name: 'definir_carteiras', description: 'Define a lista de carteiras do dono (cada empresa e a vida pessoal separadas). Substitui a lista inteira — inclua as existentes.', parameters: obj({ carteiras: { type: 'ARRAY', items: S } }, ['carteiras']) },
    { name: 'definir_saldo', description: 'Registra o saldo atual (ou numa data) de uma carteira — base para o fluxo de caixa.', parameters: obj({ carteira: S, saldo: N, data: { type: 'STRING', description: 'YYYY-MM-DD; padrão hoje' } }, ['carteira', 'saldo']) },
    { name: 'registrar_lancamento', description: 'Registra uma entrada ou saída JÁ ACONTECIDA (ex.: "paguei 350 de luz ontem"). Exige carteira.', parameters: obj({ carteira: S, tipo: { type: 'STRING', enum: ['entrada', 'saida'] }, valor: N, descricao: S, categoria: S, subcategoria: S, data: S, contraparte: S, forcar_novo: B }, ['tipo', 'valor', 'descricao']) },
    { name: 'criar_conta_pagar', description: 'Agenda uma conta a pagar (boleto, fornecedor, imposto). recorrente=true para conta fixa mensal.', parameters: obj({ carteira: S, valor: N, descricao: S, vencimento: S, contraparte: S, categoria: S, subcategoria: S, linha_digitavel: S, recorrente: B }, ['valor', 'descricao', 'vencimento']) },
    { name: 'criar_conta_receber', description: 'Agenda um valor a receber (cliente, venda a prazo).', parameters: obj({ carteira: S, valor: N, descricao: S, vencimento: S, contraparte: S, categoria: S, recorrente: B }, ['valor', 'descricao', 'vencimento']) },
    { name: 'dar_baixa', description: 'Marca uma conta prevista como paga/recebida. SÓ quando o dono disser explicitamente que pagou/recebeu ("paguei", "recebi", "já paguei") ou mandar comprovante/extrato. Agradecimento, "ok" ou "o link ajudou" NÃO é pagamento. comprovante: descrição do comprovante, ou "declarado pelo dono" quando ele afirmou que pagou.', parameters: obj({ id: N, data: S, comprovante: S, extrato_id: N, valor_pago: N }, ['id']) },
    { name: 'listar_lancamentos', description: 'Lista lançamentos com filtros (período, carteira, categoria, tipo, status, texto).', parameters: obj({ carteira: S, de: S, ate: S, categoria: S, tipo: S, status: { type: 'STRING', enum: ['pago', 'previsto'] }, texto: S, limite: N }) },
    { name: 'contas_em_aberto', description: 'Contas a pagar/receber atrasadas, vencendo hoje e nos próximos dias.', parameters: obj({ dias: N, carteira: S }) },
    { name: 'gerar_dre', description: 'DRE gerencial do mês (padrão: mês anterior) por carteira ou consolidado, com comparação ao mês anterior e alertas.', parameters: obj({ mes: { type: 'STRING', description: 'YYYY-MM' }, carteira: S }) },
    { name: 'fluxo_caixa', description: 'Saldo de hoje, a pagar/receber e saldo projetado nos próximos dias por carteira, com alerta de saldo negativo.', parameters: obj({ dias: N, carteira: S }) },
    { name: 'recategorizar', description: 'Corrige a categoria de lançamentos (por ids ou por texto na descrição). criar_regra=true faz a correção valer para os próximos (a Tina aprende).', parameters: obj({ ids: { type: 'ARRAY', items: N }, texto: S, carteira: S, categoria: S, subcategoria: S, criar_regra: B }, ['categoria']) },
    { name: 'importar_extrato_pendente', description: 'Importa um extrato que já foi lido e estava aguardando o dono dizer a carteira.', parameters: obj({ importacao_id: N, carteira: S }, ['importacao_id', 'carteira']) },
    { name: 'reabrir_lancamento', description: 'Desfaz uma baixa: a conta volta a ficar em aberto (prevista). Use quando o dono disser que NÃO pagou/recebeu algo que foi baixado. Nunca exclua a conta para isso.', parameters: obj({ id: N }, ['id']) },
    { name: 'excluir_lancamento', description: 'Exclui um lançamento ou conta prevista lançada por engano. Exige confirmação.', parameters: obj({ id: N }, ['id']) },
  ];
}

// ---------- execução ----------
export async function executar(nome, a, conta) {
  if (['transferir', 'pagar', 'pix', 'ted'].includes(nome)) throw new Error('Este módulo nunca movimenta dinheiro.');
  const c = conta.id;
  switch (nome) {
    case 'definir_carteiras': {
      const lista = [...new Set((a.carteiras || []).map(x => String(x).trim()).filter(Boolean))]; if (!lista.length) throw new Error('informe ao menos uma carteira');
      db.prepare('UPDATE contas SET carteiras=? WHERE id=?').run(lista.join(', '), c); return { ok: true, carteiras: lista };
    }
    case 'definir_saldo': { const cart = resolverCarteira(c, a.carteira); db.prepare('INSERT INTO fin_saldos (conta_id, carteira, saldo, data) VALUES (?,?,?,?)').run(c, cart, Number(a.saldo), a.data || hoje()); return { ok: true, carteira: cart, saldo: Number(a.saldo), data: a.data || hoje() }; }
    case 'registrar_lancamento': {
      const cart = resolverCarteira(c, a.carteira); const v = Math.abs(Number(a.valor)); if (!v) throw new Error('valor inválido');
      // Já existe conta prevista igual? Então é baixa, não lançamento novo (evita duplicar e "sumir" a conta).
      const igual = db.prepare("SELECT id, descricao, vencimento FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND status='previsto' AND oculto=0 AND tipo=? AND abs(valor-?)<0.01 LIMIT 1").get(c, cart, a.tipo === 'entrada' ? 'entrada' : 'saida', v);
      if (igual && !a.forcar_novo) throw new Error(`já existe a conta prevista #${igual.id} "${igual.descricao}" (venc. ${igual.vencimento}) com esse valor. Se o dono disse que pagou, use dar_baixa nela; só registre novo se for outra despesa (forcar_novo=true).`);
      const regra = !a.categoria ? aplicarRegras(c, cart, a.descricao) : null;
      if (a.data && a.data > hoje()) a.data = hoje(); // já aconteceu: nunca data futura
      const id = Number(db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, contraparte, status, data, pago_em, origem) VALUES (?,?,?,?,?,?,?,?,'pago',?,?,'manual')").run(c, cart, a.tipo === 'entrada' ? 'entrada' : 'saida', v, a.descricao, a.categoria || regra?.categoria || null, a.subcategoria || regra?.subcategoria || null, a.contraparte || null, a.data || hoje(), a.data || hoje()).lastInsertRowid);
      return { ok: true, id, carteira: cart, valor: v, categoria: a.categoria || regra?.categoria || 'sem categoria — pergunte ou use recategorizar' };
    }
    case 'criar_conta_pagar': case 'criar_conta_receber': {
      const cart = resolverCarteira(c, a.carteira); const v = Math.abs(Number(a.valor)); if (!v) throw new Error('valor inválido'); if (!/^\d{4}-\d{2}-\d{2}$/.test(a.vencimento || '')) throw new Error('vencimento no formato YYYY-MM-DD');
      const tipo = nome === 'criar_conta_pagar' ? 'saida' : 'entrada'; const regra = !a.categoria ? aplicarRegras(c, cart, a.descricao) : null;
      const doc = a.linha_digitavel ? String(a.linha_digitavel).replace(/\s/g, '') : null;
      if (doc && db.prepare('SELECT 1 FROM fin_lancamentos WHERE conta_id=? AND documento=? AND oculto=0').get(c, doc)) throw new Error('Esse boleto (mesma linha digitável) já está lançado.');
      const id = Number(db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, contraparte, status, data, vencimento, origem, documento, recorrente) VALUES (?,?,?,?,?,?,?,?,'previsto',?,?,?,?,?)").run(c, cart, tipo, v, a.descricao, a.categoria || regra?.categoria || null, a.subcategoria || regra?.subcategoria || null, a.contraparte || null, a.vencimento, a.vencimento, doc ? 'boleto' : 'manual', doc, a.recorrente ? 1 : 0).lastInsertRowid);
      return { ok: true, id, carteira: cart, tipo, valor: v, vencimento: a.vencimento, recorrente: !!a.recorrente };
    }
    case 'dar_baixa': {
      if (!a.comprovante && !a.extrato_id) throw new Error('Baixa sem comprovante nem extrato. Peça o comprovante (foto/print do pix) ou o extrato.');
      const p = db.prepare("SELECT * FROM fin_lancamentos WHERE id=? AND conta_id=?").get(Number(a.id), c); if (!p) throw new Error(`lançamento #${a.id} não encontrado`);
      if (p.status === 'pago') return { ok: true, ja_estava_pago: true, id: p.id };
      const data = a.data && a.data <= hoje() ? a.data : hoje(); const valor = a.valor_pago ? Math.abs(Number(a.valor_pago)) : p.valor; // pagamento nunca com data futura
      db.prepare("UPDATE fin_lancamentos SET status='pago', pago_em=?, valor=?, comprovante=?, conciliado_id=? WHERE id=?").run(data, valor, a.comprovante || `extrato #${a.extrato_id}`, a.extrato_id || null, p.id);
      if (a.extrato_id) db.prepare('UPDATE fin_lancamentos SET oculto=1 WHERE id=? AND conta_id=?').run(Number(a.extrato_id), c);
      const proxima = criarProximaRecorrencia(p);
      return { ok: true, id: p.id, pago_em: data, valor, proxima_recorrencia: proxima ? { id: proxima } : null };
    }
    case 'listar_lancamentos': {
      const w = ['conta_id=?', 'oculto=0'], v = [c];
      if (a.carteira) { w.push('carteira=?'); v.push(resolverCarteira(c, a.carteira)); }
      if (a.de) { w.push(`${efetiva}>=?`); v.push(a.de); } if (a.ate) { w.push(`${efetiva}<=?`); v.push(a.ate); }
      if (a.categoria) { w.push("lower(COALESCE(categoria,''))=lower(?)"); v.push(a.categoria); } if (a.tipo) { w.push('tipo=?'); v.push(a.tipo); } if (a.status) { w.push('status=?'); v.push(a.status); }
      if (a.texto) { w.push('lower(descricao) LIKE ?'); v.push(`%${semAcento(a.texto)}%`); }
      const rows = db.prepare(`SELECT id, carteira, tipo, valor, descricao, categoria, subcategoria, status, ${efetiva} data, vencimento, origem FROM fin_lancamentos WHERE ${w.join(' AND ')} ORDER BY ${efetiva} DESC, id DESC LIMIT ?`).all(...v, Math.min(Number(a.limite) || 40, 200));
      const ent = rows.filter(r => r.tipo === 'entrada').reduce((s, r) => s + r.valor, 0), sai = rows.filter(r => r.tipo === 'saida').reduce((s, r) => s + r.valor, 0);
      return { total: rows.length, entradas: +ent.toFixed(2), saidas: +sai.toFixed(2), lancamentos: rows };
    }
    case 'contas_em_aberto': return contasEmAberto(c, a);
    case 'gerar_dre': return gerarDRE(c, a);
    case 'fluxo_caixa': return fluxoCaixa(c, a);
    case 'recategorizar': {
      const cart = a.carteira ? resolverCarteira(c, a.carteira) : null; let n = 0;
      if (a.ids?.length) n = db.prepare(`UPDATE fin_lancamentos SET categoria=?, subcategoria=COALESCE(?, subcategoria) WHERE conta_id=? AND id IN (${a.ids.map(() => '?').join(',')})`).run(a.categoria, a.subcategoria || null, c, ...a.ids.map(Number)).changes;
      else if (a.texto) n = db.prepare(`UPDATE fin_lancamentos SET categoria=?, subcategoria=COALESCE(?, subcategoria) WHERE conta_id=? ${cart ? 'AND carteira=?' : ''} AND lower(descricao) LIKE ?`).run(a.categoria, a.subcategoria || null, c, ...(cart ? [cart] : []), `%${semAcento(a.texto)}%`).changes;
      else throw new Error('informe ids ou texto');
      if (a.criar_regra && a.texto) db.prepare('INSERT INTO fin_regras (conta_id, padrao, categoria, subcategoria, carteira) VALUES (?,?,?,?,?)').run(c, semAcento(a.texto), a.categoria, a.subcategoria || null, cart);
      return { ok: true, alterados: n, regra_criada: !!(a.criar_regra && a.texto) };
    }
    case 'importar_extrato_pendente': {
      const imp = db.prepare("SELECT * FROM fin_importacoes WHERE id=? AND conta_id=? AND status='pendente'").get(Number(a.importacao_id), c); if (!imp) throw new Error('importação não encontrada ou já feita');
      const cart = resolverCarteira(c, a.carteira); const r = await importarLancamentos(c, cart, JSON.parse(imp.dados), { importacaoId: imp.id });
      db.prepare("UPDATE fin_importacoes SET status='importada', carteira=? WHERE id=?").run(cart, imp.id); return r;
    }
    case 'reabrir_lancamento': {
      const p = db.prepare('SELECT * FROM fin_lancamentos WHERE id=? AND conta_id=?').get(Number(a.id), c); if (!p) throw new Error(`lançamento #${a.id} não encontrado`);
      if (p.status !== 'pago') return { ok: true, ja_estava_em_aberto: true, id: p.id };
      if (p.origem === 'extrato') throw new Error('esse lançamento veio do extrato do banco (o dinheiro saiu de fato); não dá para reabrir');
      if (!p.vencimento && p.origem === 'manual') throw new Error('esse foi um pagamento avulso registrado (sem conta prevista); se foi engano, use excluir_lancamento');
      db.prepare("UPDATE fin_lancamentos SET status='previsto', pago_em=NULL, comprovante=NULL, conciliado_id=NULL WHERE id=?").run(p.id);
      if (p.conciliado_id) db.prepare('UPDATE fin_lancamentos SET oculto=0 WHERE id=? AND conta_id=?').run(p.conciliado_id, c);
      return { ok: true, id: p.id, reaberto: true, vencimento: p.vencimento };
    }
    case 'excluir_lancamento': { const r = db.prepare('DELETE FROM fin_lancamentos WHERE id=? AND conta_id=?').run(Number(a.id), c); if (!r.changes) throw new Error(`lançamento #${a.id} não encontrado`); return { ok: true, excluido: Number(a.id) }; }
  }
  throw new Error(`financeiro.${nome}: não implementada`);
}
