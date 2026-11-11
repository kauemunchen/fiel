// Tina — módulo financeiro (sem Open Finance). Carteiras, lançamentos, contas a pagar/receber, importação de
// extrato (OFX/CSV/PDF/imagem), conciliação, DRE, fluxo de caixa e regras de categorização aprendidas.
// REGRAS DURAS (validadas aqui): nunca movimenta dinheiro; todo lançamento tem carteira; baixa só com comprovante ou extrato.
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import * as PL from './plano-contas.js';
import * as CF from './contas-fin.js';

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
  CF.prepararContasFin();
}
prepararFinanceiro();

/**
 * Reparo único (2026-11): transferências entre contas que a Tina lançou como receita + despesa
 * (par entrada/saída, mesma carteira, mesmo valor e dia, descrição de transferência) viram categoria
 * Transferência; pares repetidos registrados em minutos são ocultados (reversível). Não muda saldo.
 */
export function reparoTransferencias() {
  db.exec('CREATE TABLE IF NOT EXISTS reparos (nome TEXT PRIMARY KEY, feito_em TEXT DEFAULT CURRENT_TIMESTAMP, resumo TEXT)');
  if (db.prepare("SELECT 1 FROM reparos WHERE nome='transferencias-2026-11'").get()) return null;
  const transf = /transfer|\bted\b|\bdoc\b/i; let recat = 0, ocult = 0;
  const cands = db.prepare("SELECT * FROM fin_lancamentos WHERE status='pago' AND oculto=0 AND COALESCE(categoria,'')<>'Transferência' AND COALESCE(pago_em,data) >= date('now','-5 days') ORDER BY id").all().filter(l => transf.test(l.descricao || ''));
  const usados = new Set(); const pares = [];
  for (const s of cands.filter(l => l.tipo === 'saida')) {
    const e = cands.find(l => l.tipo === 'entrada' && !usados.has(l.id) && l.conta_id === s.conta_id && l.carteira === s.carteira && Math.abs(l.valor - s.valor) < 0.01 && (l.pago_em || l.data) === (s.pago_em || s.data)
      && Math.abs(new Date(l.criado_em + 'Z') - new Date(s.criado_em + 'Z')) < 30 * 60e3);
    if (e) { usados.add(e.id); usados.add(s.id); pares.push([s, e]); }
  }
  db.transaction(() => {
    const vistos = [];
    for (const [s, e] of pares) {
      const rep = vistos.find(([s2]) => s2.conta_id === s.conta_id && s2.carteira === s.carteira && Math.abs(s2.valor - s.valor) < 0.01 && (s2.pago_em || s2.data) === (s.pago_em || s.data) && Math.abs(new Date(s.criado_em + 'Z') - new Date(s2.criado_em + 'Z')) < 15 * 60e3);
      if (rep) { db.prepare("UPDATE fin_lancamentos SET oculto=1, comprovante=COALESCE(comprovante,'') || ' [oculto: transferência repetida]' WHERE id IN (?,?)").run(s.id, e.id); ocult += 2; continue; }
      vistos.push([s, e]);
      for (const l of [s, e]) { const enc = PL.encaixarNoPlano(l.conta_id, l.carteira, l.tipo, { categoria: 'Transferência' }).a; db.prepare('UPDATE fin_lancamentos SET categoria=?, subcategoria=? WHERE id=?').run('Transferência', enc.subcategoria || null, l.id); recat++; }
    }
    db.prepare("INSERT INTO reparos (nome, resumo) VALUES ('transferencias-2026-11', ?)").run(`${recat} recategorizados, ${ocult} ocultados`);
  })();
  return { recat, ocult };
}
setTimeout(() => { try { const r = reparoTransferencias(); if (r) console.log('[financeiro] reparo transferências', r); } catch (e) { console.error('[financeiro] reparo transferências', e.message); } }, 3000);

// ---------- plano de contas KM ----------
export const PLANO_PJ = ['Receita operacional', 'Outras receitas', 'Custos variáveis', 'Despesas fixas', 'Despesas financeiras', 'Investimentos', 'Retiradas'];
export const PLANO_PF = ['Renda', 'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros'];
const ehPF = (carteira, contaId) => contaId ? CF.ehPFCarteira(contaId, carteira) : /pessoal|\bpf\b|casa|fam[ií]lia|particular/i.test(carteira || '');
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesDe = (d) => String(d).slice(0, 7);
const somaDias = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

// ---------- carteiras ----------
/** Carteiras = as definidas na Tina + as empresas cadastradas (Conexões › Empresas), sem repetir. */
export function carteirasDe(contaId) { return CF.listaCarteiras(contaId); }
export function empresasDe(contaId) { try { return JSON.parse(db.prepare('SELECT empresas FROM contas WHERE id=?').get(contaId)?.empresas || '[]'); } catch { return []; } }
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
async function categorizarComIA(carteira, itens, contaId) {
  if (!itens.length) return [];
  if (contaId && PL.planoAtivo(contaId, carteira)) { // carteira com plano de contas: classifica direto nas contas do plano
    const contas = PL.contasPlano(contaId, carteira); const { gerarJSON } = await import('../integracoes/gemini.js'); const saida = [];
    for (let i = 0; i < itens.length; i += 120) {
      const lote = itens.slice(i, i + 120);
      const j = await gerarJSON(`Classifique cada lançamento bancário da carteira "${carteira}" numa conta do plano de contas abaixo (use o código). Entradas só em contas de entrada; saídas só em contas de saída. Transferência entre contas próprias: a conta de transferência. Sem conta adequada: codigo null.
PLANO: ${contas.map(c => `${c.codigo} ${c.nome} (${c.tipo})`).join(' | ')}
Responda JSON {"r":[{"i":número,"codigo":string|null}]}.
${lote.map((x, k) => `${i + k}. ${x.valor < 0 ? 'SAÍDA' : 'ENTRADA'} ${Math.abs(x.valor).toFixed(2)} — ${x.descricao}`).join('\n')}`);
      for (const r of (j.r || [])) { const c = r.codigo && contas.find(x => x.codigo === String(r.codigo)); saida[r.i] = c ? { categoria: c.grupo, subcategoria: PL.rotulo(c) } : null; }
    }
    return saida;
  }
  const plano = ehPF(carteira, contaId) ? PLANO_PF : PLANO_PJ;
  const { gerarJSON } = await import('../integracoes/gemini.js');
  const saida = [];
  for (let i = 0; i < itens.length; i += 120) {
    const lote = itens.slice(i, i + 120);
    const j = await gerarJSON(`Classifique cada lançamento bancário da carteira "${carteira}" (${ehPF(carteira, contaId) ? 'pessoa física' : 'empresa'}) numa categoria do plano: ${plano.join(' | ')}. Inclua uma subcategoria curta (ex.: energia, folha, facção, combustível, mercado, tarifa bancária, pró-labore). Transferência entre contas próprias: categoria "Transferência". Responda JSON {"r":[{"i":número,"categoria":string,"subcategoria":string}]}.
${lote.map((x, k) => `${i + k}. ${x.valor < 0 ? 'SAÍDA' : 'ENTRADA'} ${Math.abs(x.valor).toFixed(2)} — ${x.descricao}`).join('\n')}`);
    for (const r of (j.r || [])) saida[r.i] = { categoria: [...plano, 'Transferência'].includes(r.categoria) ? r.categoria : (ehPF(carteira, contaId) ? 'Outros' : null), subcategoria: r.subcategoria || null };
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
  let ia = []; try { ia = await categorizarComIA(carteira, semRegra, contaId); } catch (e) { console.error('[tina] categorizar', e.message); }
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
    if (cart && ehPF(cart, contaId)) { const ent = t.filter(x => x.tipo === 'entrada').reduce((a, x) => a + x.total, 0); const sai = t.filter(x => x.tipo === 'saida').reduce((a, x) => a + x.total, 0); return { tipo: 'PF', entradas: +ent.toFixed(2), saidas: +sai.toFixed(2), sobra: +(ent - sai).toFixed(2), por_categoria: Object.fromEntries(t.filter(x => x.tipo === 'saida').map(x => [x.categoria, +x.total.toFixed(2)])) }; }
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
  const pc = CF.saldoPelasContas(contaId, carteira); if (pc) return { saldo: pc.saldo, tem_saldo_inicial: true, base: pc.base };
  const s = db.prepare('SELECT saldo, data FROM fin_saldos WHERE conta_id=? AND carteira=? AND conta_fin_id IS NULL ORDER BY data DESC, id DESC LIMIT 1').get(contaId, carteira);
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
export const requerConfirmacao = new Set(['excluir_lancamento', 'criar_cobranca', 'aplicar_alteracoes_planilha']);
export function ferramentas(_conta) {
  return [
    { name: 'definir_carteiras', description: 'Define a lista de carteiras do dono (cada empresa e a vida pessoal separadas). Substitui a lista inteira — inclua as existentes.', parameters: obj({ carteiras: { type: 'ARRAY', items: S } }, ['carteiras']) },
    { name: 'definir_saldo', description: 'Registra o saldo atual (ou numa data) de uma carteira — base para o fluxo de caixa.', parameters: obj({ carteira: S, saldo: N, data: { type: 'STRING', description: 'YYYY-MM-DD; padrão hoje' }, conta: { type: 'STRING', description: 'conta bancária ou dinheiro (quando a carteira tem várias contas)' } }, ['carteira', 'saldo']) },
    { name: 'registrar_lancamento', description: 'Registra uma entrada ou saída JÁ ACONTECIDA (ex.: "paguei 350 de luz ontem"). Exige carteira.', parameters: obj({ carteira: S, tipo: { type: 'STRING', enum: ['entrada', 'saida'] }, valor: N, descricao: S, categoria: S, subcategoria: S, data: S, contraparte: S, conta_plano: S, conta: S, forcar_novo: B }, ['tipo', 'valor', 'descricao']) },
    { name: 'criar_conta_pagar', description: 'Agenda uma conta a pagar (boleto, fornecedor, imposto). recorrente=true para conta fixa mensal.', parameters: obj({ carteira: S, valor: N, descricao: S, vencimento: S, contraparte: S, categoria: S, subcategoria: S, conta_plano: S, conta: S, linha_digitavel: S, recorrente: B }, ['valor', 'descricao', 'vencimento']) },
    { name: 'criar_conta_receber', description: 'Agenda um valor a receber (cliente, venda a prazo).', parameters: obj({ carteira: S, valor: N, descricao: S, vencimento: S, contraparte: S, categoria: S, conta_plano: S, conta: S, recorrente: B }, ['valor', 'descricao', 'vencimento']) },
    { name: 'dar_baixa', description: 'Marca uma conta prevista como paga/recebida. SÓ quando o dono disser explicitamente que pagou/recebeu ("paguei", "recebi", "já paguei") ou mandar comprovante/extrato. Agradecimento, "ok" ou "o link ajudou" NÃO é pagamento. comprovante: descrição do comprovante, ou "declarado pelo dono" quando ele afirmou que pagou.', parameters: obj({ id: N, data: S, comprovante: S, extrato_id: N, valor_pago: N, conta: { type: 'STRING', description: 'conta/cartão de onde saiu ou entrou o dinheiro (opcional)' } }, ['id']) },
    { name: 'listar_lancamentos', description: 'Lista lançamentos com filtros (período, carteira, categoria, tipo, status, texto).', parameters: obj({ carteira: S, de: S, ate: S, categoria: S, tipo: S, status: { type: 'STRING', enum: ['pago', 'previsto'] }, texto: S, limite: N }) },
    { name: 'contas_em_aberto', description: 'Contas a pagar/receber atrasadas, vencendo hoje e nos próximos dias.', parameters: obj({ dias: N, carteira: S }) },
    { name: 'gerar_dre', description: 'DRE gerencial do mês (padrão: mês anterior) por carteira ou consolidado, com comparação ao mês anterior e alertas.', parameters: obj({ mes: { type: 'STRING', description: 'YYYY-MM' }, carteira: S }) },
    { name: 'fluxo_caixa', description: 'Saldo de hoje, a pagar/receber e saldo projetado nos próximos dias por carteira, com alerta de saldo negativo.', parameters: obj({ dias: N, carteira: S }) },
    { name: 'recategorizar', description: 'Corrige a categoria de lançamentos (por ids ou por texto na descrição). criar_regra=true faz a correção valer para os próximos (a Tina aprende).', parameters: obj({ ids: { type: 'ARRAY', items: N }, texto: S, carteira: S, categoria: S, subcategoria: S, conta_plano: S, criar_regra: B }) },
    { name: 'importar_extrato_pendente', description: 'Importa um extrato que já foi lido e estava aguardando o dono dizer a carteira.', parameters: obj({ importacao_id: N, carteira: S }, ['importacao_id', 'carteira']) },
    { name: 'listar_contas_financeiras', description: 'Lista contas bancárias, cartões (crédito/débito) e dinheiro de cada carteira, com saldo (banco/dinheiro) e fatura aberta (cartão de crédito).', parameters: obj({ carteira: S }) },
    { name: 'transferencia_entre_contas', description: 'Registra dinheiro que passou de uma conta para outra do próprio dono (ex.: "transferi 18 mil do BB para o Porto Seguro", "saquei 500", "depositei no Itaú"). NÃO é receita nem despesa: o saldo total não muda, só sai de uma conta e entra na outra. Use SEMPRE isto em vez de registrar_lancamento para transferências. Contas que ainda não existem na carteira são cadastradas como conta bancária ("dinheiro"/"carteira" vira Dinheiro). Se as contas forem de carteiras diferentes (ex.: da empresa para a pessoal), informe carteira_destino.', parameters: obj({ carteira: S, de: S, para: S, valor: N, data: S, carteira_destino: S, descricao: S }, ['carteira', 'de', 'para', 'valor']) },
    { name: 'planilha_espelho', description: 'Cria (ou atualiza agora) a planilha "Fiel · Espelho financeiro" no Google Drive do dono: todos os lançamentos de todas as carteiras, com painel e filtros por carteira, mês e conta. Ela se atualiza sozinha depois. Use quando o dono pedir planilha, espelho ou exportar o financeiro.', parameters: obj({}, []) },
    { name: 'ver_alteracoes_planilha', description: 'Compara a planilha "Espelho financeiro" (aba Lançamentos) com o Fiel e mostra o que o dono mudou lá: lançamentos alterados, novos (linhas sem ID) e removidos. Não grava nada. Use quando o dono disser que editou a planilha ou pedir para atualizar pelo que está nela.', parameters: obj({}, []) },
    { name: 'aplicar_alteracoes_planilha', description: 'Aplica no Fiel as alterações da planilha espelho, depois que o dono viu a lista (ver_alteracoes_planilha) e confirmou. Por padrão aplica alterados e novos; removidos só se o dono pedir (remover_ids). Exige confirmação.', parameters: obj({ ids: { type: 'ARRAY', items: N }, remover_ids: { type: 'ARRAY', items: N } }, []) },
    { name: 'ficha_carteira', description: 'Define se a carteira é de uma empresa (pj) ou de uma pessoa (pf) e o titular (razão social ou nome completo). Use quando o dono disser de quem é a carteira.', parameters: obj({ carteira: S, tipo: { type: 'STRING', enum: ['pj', 'pf'] }, titular: S }, ['carteira', 'tipo']) },
    { name: 'cadastrar_conta_financeira', description: 'Cadastra uma conta bancária, cartão de crédito, cartão de débito ou dinheiro numa carteira. Cartão de crédito: informe dia_fechamento e dia_vencimento. O dono também cadastra no painel: Mais › Contas e cartões.', parameters: obj({ carteira: S, nome: S, tipo: { type: 'STRING', enum: ['banco', 'cartao_credito', 'cartao_debito', 'dinheiro', 'outro'] }, instituicao: S, final: S, limite: N, dia_fechamento: N, dia_vencimento: N }, ['carteira', 'nome', 'tipo']) },
    { name: 'pagar_fatura_cartao', description: 'Dá baixa na fatura de um cartão de crédito (todas as compras daquele vencimento), quando o dono disser que pagou. pago_com = conta bancária de onde saiu o dinheiro.', parameters: obj({ cartao: S, carteira: S, vencimento: S, pago_com: S, comprovante: S }, ['cartao']) },
    { name: 'listar_plano_contas', description: 'Mostra o plano de contas de uma carteira (código, nome, entrada/saída, grupo do DRE). Use para escolher conta_plano quando a carteira usa plano.', parameters: obj({ carteira: S }, ['carteira']) },
    { name: 'ativar_plano_contas', description: 'Liga o plano de contas numa carteira a partir de um modelo (empresa, industria, pessoal). Ajustes finos o dono faz no painel: Mais › Plano de contas.', parameters: obj({ carteira: S, modelo: { type: 'STRING', enum: ['empresa', 'industria', 'pessoal'] } }, ['carteira', 'modelo']) },
    { name: 'reabrir_lancamento', description: 'Desfaz uma baixa: a conta volta a ficar em aberto (prevista). Use quando o dono disser que NÃO pagou/recebeu algo que foi baixado. Nunca exclua a conta para isso.', parameters: obj({ id: N }, ['id']) },
    { name: 'excluir_lancamento', description: 'Exclui um lançamento ou conta prevista lançada por engano. Exige confirmação.', parameters: obj({ id: N }, ['id']) },
  ];
}

// ---------- execução ----------
export async function executar(nome, a, conta) {
  if (['transferir', 'pagar', 'pix', 'ted'].includes(nome)) throw new Error('Este módulo nunca movimenta dinheiro.');
  const c = conta.id;
  if (!/^(listar|gerar|contas_em|fluxo)/.test(nome)) import('./espelho-fin.js').then(m => m.agendarEspelho(c)).catch(() => {});
  switch (nome) {
    case 'definir_carteiras': {
      const lista = [...new Set((a.carteiras || []).map(x => String(x).trim()).filter(Boolean))]; if (!lista.length) throw new Error('informe ao menos uma carteira');
      db.prepare('UPDATE contas SET carteiras=? WHERE id=?').run(lista.join(', '), c); return { ok: true, carteiras: lista };
    }
    case 'definir_saldo': { const cart = resolverCarteira(c, a.carteira); const cfS = CF.resolverContaFin(c, cart, a.conta);
      if (cfS && cfS.tipo === 'cartao_credito') throw new Error('cartão de crédito não tem saldo; informe o saldo da conta bancária ou do dinheiro');
      db.prepare('INSERT INTO fin_saldos (conta_id, carteira, saldo, data, conta_fin_id) VALUES (?,?,?,?,?)').run(c, cart, Number(a.saldo), a.data || hoje(), cfS?.id || null);
      return { ok: true, carteira: cart, conta: cfS ? CF.rotuloConta(cfS) : 'carteira inteira', saldo: Number(a.saldo), data: a.data || hoje() }; }
    case 'registrar_lancamento': {
      const cart = resolverCarteira(c, a.carteira); const v = Math.abs(Number(a.valor)); if (!v) throw new Error('valor inválido');
      // Já existe conta prevista igual? Então é baixa, não lançamento novo (evita duplicar e "sumir" a conta).
      const igual = db.prepare("SELECT id, descricao, vencimento FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND status='previsto' AND oculto=0 AND tipo=? AND abs(valor-?)<0.01 LIMIT 1").get(c, cart, a.tipo === 'entrada' ? 'entrada' : 'saida', v);
      if (igual && !a.forcar_novo) throw new Error(`já existe a conta prevista #${igual.id} "${igual.descricao}" (venc. ${igual.vencimento}) com esse valor. Se o dono disse que pagou, use dar_baixa nela; só registre novo se for outra despesa (forcar_novo=true).`);
      const regra = !a.categoria ? aplicarRegras(c, cart, a.descricao) : null;
      if (a.data && a.data > hoje()) a.data = hoje(); // já aconteceu: nunca data futura
      const encR = PL.encaixarNoPlano(c, cart, a.tipo === 'entrada' ? 'entrada' : 'saida', { ...a, categoria: a.categoria || regra?.categoria, subcategoria: a.subcategoria || regra?.subcategoria }); a = encR.a;
      const id = Number(db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, contraparte, status, data, pago_em, origem) VALUES (?,?,?,?,?,?,?,?,'pago',?,?,'manual')").run(c, cart, a.tipo === 'entrada' ? 'entrada' : 'saida', v, a.descricao, a.categoria || regra?.categoria || null, a.subcategoria || regra?.subcategoria || null, a.contraparte || null, a.data || hoje(), a.data || hoje()).lastInsertRowid);
      const cfR = CF.resolverContaFin(c, cart, a.conta); let fatura = null;
      if (cfR) { db.prepare('UPDATE fin_lancamentos SET conta_fin_id=? WHERE id=?').run(cfR.id, id);
        if (cfR.tipo === 'cartao_credito') { fatura = CF.vencimentoFatura(cfR, a.data || hoje()); db.prepare("UPDATE fin_lancamentos SET status='previsto', vencimento=?, pago_em=NULL WHERE id=?").run(fatura, id); } }
      return { ok: true, id, carteira: cart, valor: v, categoria: a.categoria || regra?.categoria || 'sem categoria — pergunte ou use recategorizar', conta_plano: encR.conta_plano, aviso: encR.aviso, conta: cfR ? CF.rotuloConta(cfR) : undefined, fatura_cartao: fatura ? `entra na fatura que vence em ${fatura.split('-').reverse().join('/')}` : undefined };
    }
    case 'criar_conta_pagar': case 'criar_conta_receber': {
      const cart = resolverCarteira(c, a.carteira); const v = Math.abs(Number(a.valor)); if (!v) throw new Error('valor inválido'); if (!/^\d{4}-\d{2}-\d{2}$/.test(a.vencimento || '')) throw new Error('vencimento no formato YYYY-MM-DD');
      const tipo = nome === 'criar_conta_pagar' ? 'saida' : 'entrada'; const regra = !a.categoria ? aplicarRegras(c, cart, a.descricao) : null;
      const encC = PL.encaixarNoPlano(c, cart, tipo, { ...a, categoria: a.categoria || regra?.categoria, subcategoria: a.subcategoria || regra?.subcategoria }); a = encC.a;
      const doc = a.linha_digitavel ? String(a.linha_digitavel).replace(/\s/g, '') : null;
      if (doc && db.prepare('SELECT 1 FROM fin_lancamentos WHERE conta_id=? AND documento=? AND oculto=0').get(c, doc)) throw new Error('Esse boleto (mesma linha digitável) já está lançado.');
      const id = Number(db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, contraparte, status, data, vencimento, origem, documento, recorrente) VALUES (?,?,?,?,?,?,?,?,'previsto',?,?,?,?,?)").run(c, cart, tipo, v, a.descricao, a.categoria || regra?.categoria || null, a.subcategoria || regra?.subcategoria || null, a.contraparte || null, a.vencimento, a.vencimento, doc ? 'boleto' : 'manual', doc, a.recorrente ? 1 : 0).lastInsertRowid);
      const cfC = CF.resolverContaFin(c, cart, a.conta); if (cfC) db.prepare('UPDATE fin_lancamentos SET conta_fin_id=? WHERE id=?').run(cfC.id, id);
      return { ok: true, id, carteira: cart, tipo, valor: v, vencimento: a.vencimento, recorrente: !!a.recorrente, conta_plano: encC.conta_plano, aviso: encC.aviso, conta: cfC ? CF.rotuloConta(cfC) : undefined };
    }
    case 'dar_baixa': {
      if (!a.comprovante && !a.extrato_id) throw new Error('Baixa sem comprovante nem extrato. Peça o comprovante (foto/print do pix) ou o extrato.');
      const p = db.prepare("SELECT * FROM fin_lancamentos WHERE id=? AND conta_id=?").get(Number(a.id), c); if (!p) throw new Error(`lançamento #${a.id} não encontrado`);
      if (p.status === 'pago') return { ok: true, ja_estava_pago: true, id: p.id };
      const data = a.data && a.data <= hoje() ? a.data : hoje(); const valor = a.valor_pago ? Math.abs(Number(a.valor_pago)) : p.valor; // pagamento nunca com data futura
      db.prepare("UPDATE fin_lancamentos SET status='pago', pago_em=?, valor=?, comprovante=?, conciliado_id=? WHERE id=?").run(data, valor, a.comprovante || `extrato #${a.extrato_id}`, a.extrato_id || null, p.id);
      if (a.extrato_id) db.prepare('UPDATE fin_lancamentos SET oculto=1 WHERE id=? AND conta_id=?').run(Number(a.extrato_id), c);
      const cfB = CF.resolverContaFin(c, p.carteira, a.conta); if (cfB?.tipo === 'cartao_credito') { const fv = CF.vencimentoFatura(cfB, data); db.prepare("UPDATE fin_lancamentos SET conta_fin_id=?, status='previsto', pago_em=NULL, vencimento=? WHERE id=?").run(cfB.id, fv, p.id); return { ok: true, id: p.id, no_cartao: CF.rotuloConta(cfB), entra_na_fatura: fv }; }
      if (cfB) db.prepare('UPDATE fin_lancamentos SET pago_com_id=? WHERE id=?').run(cfB.id, p.id);
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
      if (a.conta_plano) { // conta do plano → categoria (grupo do DRE) + subcategoria (conta)
        const cartP = cart || (a.ids?.length ? db.prepare('SELECT carteira FROM fin_lancamentos WHERE id=? AND conta_id=?').get(Number(a.ids[0]), c)?.carteira : null);
        if (!cartP || !PL.planoAtivo(c, cartP)) throw new Error('essa carteira não usa plano de contas; use categoria/subcategoria');
        const conta = PL.acharConta(c, cartP, a.conta_plano); if (!conta) throw new Error(`"${a.conta_plano}" não está no plano de ${cartP}: ${PL.contasPlano(c, cartP).map(PL.rotulo).join(' · ')}`);
        a = { ...a, categoria: conta.grupo, subcategoria: PL.rotulo(conta) };
      }
      if (!a.categoria) throw new Error('informe categoria ou conta_plano');
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
    case 'listar_contas_financeiras': {
      const cart = a.carteira ? resolverCarteira(c, a.carteira) : null; const l = CF.listarContasFin(c, cart);
      if (!l.length) return { contas: [], dica: 'Nenhuma conta ou cartão cadastrado. Cadastre com cadastrar_conta_financeira ou no painel (Mais › Contas e cartões).' };
      return { contas: l.map(x => ({ carteira: x.carteira, conta: CF.rotuloConta(x), tipo: CF.TIPOS[x.tipo], ...(x.tipo === 'cartao_credito' ? { faturas_abertas: CF.faturasCartao(c, x.id), limite: x.limite, fecha_dia: x.dia_fechamento, vence_dia: x.dia_vencimento } : x.tipo === 'cartao_debito' ? {} : CF.saldoContaFin(c, x.id)) })) };
    }
    case 'transferencia_entre_contas': {
      const cart = resolverCarteira(c, a.carteira); const cartD = a.carteira_destino ? resolverCarteira(c, a.carteira_destino) : cart;
      const v = Math.abs(Number(a.valor)); if (!v) throw new Error('valor inválido'); const dia = a.data && a.data <= hoje() ? a.data : hoje();
      const garantir = (carteira, ref) => { const achou = CF.acharContaFin(c, carteira, ref); if (achou) return { conta: achou, nova: false };
        const tipo = /dinheiro|esp[eé]cie|carteira|caixa/i.test(ref) ? 'dinheiro' : 'banco'; const nomeC = String(ref).replace(/^(a |o )?(conta (do|da|de)\s+)?/i, '').trim().slice(0, 60) || ref;
        const id = Number(db.prepare('INSERT INTO fin_contas (conta_id, carteira, nome, tipo) VALUES (?,?,?,?)').run(c, carteira, nomeC, tipo).lastInsertRowid);
        return { conta: db.prepare('SELECT * FROM fin_contas WHERE id=?').get(id), nova: true }; };
      const o = garantir(cart, a.de), d = garantir(cartD, a.para);
      if (/cartao/.test(o.conta.tipo) || /cartao/.test(d.conta.tipo)) throw new Error('transferência é entre contas bancárias/dinheiro. Pagamento de fatura: use pagar_fatura_cartao.');
      const mesma = cart === cartD; const desc = a.descricao || `Transferência ${CF.rotuloConta(o.conta)} → ${CF.rotuloConta(d.conta)}`;
      const dup = db.prepare("SELECT id FROM fin_lancamentos WHERE conta_id=? AND carteira=? AND tipo='saida' AND categoria IN ('Transferência','Retiradas') AND abs(valor-?)<0.01 AND COALESCE(pago_em,data)=? AND conta_fin_id=? AND oculto=0 AND criado_em > datetime('now','-10 minutes')").get(c, cart, v, dia, o.conta.id);
      if (dup) return { ok: true, ja_registrada: true, aviso: 'Essa transferência já foi registrada agora há pouco; não lancei de novo.' };
      const catS = mesma ? 'Transferência' : (CF.ehPFCarteira(c, cart) ? 'Transferência' : 'Retiradas'); const catE = mesma ? 'Transferência' : (CF.ehPFCarteira(c, cartD) ? 'Renda' : 'Outras receitas');
      const ins = (carteira, tipo, cat, contaFin) => { const e = PL.encaixarNoPlano(c, carteira, tipo, { categoria: cat }).a;
        return Number(db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, categoria, subcategoria, status, data, pago_em, origem, conta_fin_id) VALUES (?,?,?,?,?,?,?,'pago',?,?,'transferencia',?)").run(c, carteira, tipo, v, desc, e.categoria, e.subcategoria || null, dia, dia, contaFin).lastInsertRowid); };
      const idS = ins(cart, 'saida', catS, o.conta.id), idE = ins(cartD, 'entrada', catE, d.conta.id);
      return { ok: true, valor: v, de: `${CF.rotuloConta(o.conta)} (${cart})`, para: `${CF.rotuloConta(d.conta)} (${cartD})`, lancamentos: [idS, idE],
        efeito: mesma ? 'saldo total da carteira não muda; não entra como receita nem despesa' : `sai de ${cart} como ${catS} e entra em ${cartD} como ${catE}`,
        contas_criadas: [o, d].filter(x => x.nova).map(x => CF.rotuloConta(x.conta)), dica: [o, d].some(x => x.nova) ? 'Contas novas foram cadastradas sem saldo; o dono pode informar o saldo de cada uma em Mais › Contas e cartões.' : undefined };
    }
    case 'planilha_espelho': { const E = await import('./espelho-fin.js'); const r = await E.criarEspelho(c); return { ...r, dica: 'A planilha se atualiza sozinha cerca de 1 minuto depois de cada lançamento. Abas: Painel (filtros), Lançamentos, Contas.' }; }
    case 'ver_alteracoes_planilha': { const E = await import('./espelho-fin.js'); const r = await E.alteracoesPlanilha(c);
      return { alterados: r.mudancas.map(m => ({ id: m.id, descricao: m.descricao, mudancas: m.campos.map(x => `${x.rotulo}: ${x.de || '—'} → ${x.para || '—'}`) })), novos: r.novos.map(n => ({ linha: n.linha, descricao: n.descricao, valor: n.alvo.valor, tipo: n.alvo.tipo, carteira: n.alvo.carteira })),
        removidos_na_planilha: r.removidos, com_erro: r.erros, dica: r.total ? 'Mostre a lista ao dono e peça confirmação antes de aplicar_alteracoes_planilha. Removidos só saem se ele pedir.' : 'A planilha está igual ao Fiel.' }; }
    case 'aplicar_alteracoes_planilha': { const E = await import('./espelho-fin.js'); return E.aplicarAlteracoes(c, { ids: a.ids?.length ? a.ids : 'todos', novos: 'todos', remover: a.remover_ids || [] }); }
    case 'ficha_carteira': { const cart = resolverCarteira(c, a.carteira); CF.salvarFicha(c, cart, { tipo: a.tipo, titular: a.titular }); return { ok: true, carteira: cart, ...CF.fichaCarteira(c, cart) }; }
    case 'cadastrar_conta_financeira': {
      const cart = resolverCarteira(c, a.carteira); if (!CF.TIPOS[a.tipo]) throw new Error('tipo inválido');
      if (a.tipo === 'cartao_credito' && !a.dia_vencimento) throw new Error('para cartão de crédito, pergunte o dia de vencimento (e de fechamento) da fatura');
      const final = a.final ? String(a.final).replace(/\D/g, '').slice(-4) : null;
      const r = db.prepare('INSERT INTO fin_contas (conta_id, carteira, nome, tipo, instituicao, final, limite, dia_fechamento, dia_vencimento) VALUES (?,?,?,?,?,?,?,?,?)').run(c, cart, String(a.nome).slice(0, 60), a.tipo, a.instituicao || null, final, a.limite || null, a.dia_fechamento || null, a.dia_vencimento || null);
      return { ok: true, id: Number(r.lastInsertRowid), carteira: cart, conta: `${a.nome}${final ? ' ••' + final : ''}`, tipo: CF.TIPOS[a.tipo] };
    }
    case 'pagar_fatura_cartao': {
      const cartP = a.carteira ? resolverCarteira(c, a.carteira) : null;
      const cartao = CF.listarContasFin(c, cartP).filter(x => x.tipo === 'cartao_credito').find(x => x.id === (CF.acharContaFin(c, x.carteira, a.cartao) || {}).id);
      if (!cartao) throw new Error(`cartão "${a.cartao}" não encontrado. Cartões: ${CF.listarContasFin(c, cartP).filter(x => x.tipo === 'cartao_credito').map(CF.rotuloConta).join(' · ') || 'nenhum cadastrado'}`);
      const faturas = CF.faturasCartao(c, cartao.id); if (!faturas.length) return { ok: true, sem_fatura_aberta: true };
      const venc = a.vencimento || faturas[0].venc; const f = faturas.find(x => x.venc === venc); if (!f) throw new Error(`não há fatura aberta com vencimento ${venc}. Abertas: ${faturas.map(x => `${x.venc} (R$ ${x.total})`).join(', ')}`);
      const pagoCom = a.pago_com ? CF.resolverContaFin(c, cartao.carteira, a.pago_com) : null;
      const n = db.prepare("UPDATE fin_lancamentos SET status='pago', pago_em=?, comprovante=?, pago_com_id=? WHERE conta_id=? AND conta_fin_id=? AND status IN ('previsto','pendente') AND oculto=0 AND COALESCE(vencimento,data)=?").run(hoje(), a.comprovante || 'declarado pelo dono', pagoCom?.id || null, c, cartao.id, venc).changes;
      return { ok: true, cartao: CF.rotuloConta(cartao), vencimento: venc, total: f.total, compras: n, pago_com: pagoCom ? CF.rotuloConta(pagoCom) : null };
    }
    case 'listar_plano_contas': {
      const cart = resolverCarteira(c, a.carteira); const cfg = PL.cfgPlano(c, cart);
      if (!cfg?.ativo) return { carteira: cart, usa_plano: false, dica: 'Essa carteira não usa plano de contas. Para ligar: ativar_plano_contas (modelos: empresa, industria, pessoal) ou pelo painel em Mais › Plano de contas.' };
      return { carteira: cart, usa_plano: true, modelo: cfg.modelo, contas: PL.contasPlano(c, cart).map(x => ({ conta: PL.rotulo(x), tipo: x.tipo, grupo_dre: x.grupo })) };
    }
    case 'ativar_plano_contas': {
      const cart = resolverCarteira(c, a.carteira); const contas = PL.aplicarModelo(c, cart, a.modelo);
      return { ok: true, carteira: cart, modelo: a.modelo, contas: contas.length, dica: 'O dono pode renomear, criar ou desativar contas no painel: Mais › Plano de contas.' };
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
