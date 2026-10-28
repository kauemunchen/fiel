// Custos operacionais do Fiel (o que você paga aos fornecedores) — para medir margem real e o seu consumo pessoal como admin.
// Tabela custos_cfg guarda as taxas editáveis (preço por 1M tokens de cada modelo, custo do fal, taxas MP, VPS/mês).
import { db } from './db/index.js';

// Preços de referência atualizados (USD por 1M tokens, Google Gemini public pricing).
// Fonte: ai.google.dev/pricing — ajuste em /admin → Custos se seu plano for diferente.
export const PRECOS_PADRAO = {
  'gemini-2.5-pro_in': 1.25,   'gemini-2.5-pro_out': 10.00,  // prompts ≤200k. Acima: 2.50 / 15.00
  'gemini-2.5-flash_in': 0.30, 'gemini-2.5-flash_out': 2.50, // texto/imagem/vídeo. Áudio in: 1.00
  'gemini-flash-lite_in': 0.10,'gemini-flash-lite_out': 0.40,// Gemini 2.5 Flash-Lite
  'gemini-2.0-flash_in': 0.10, 'gemini-2.0-flash_out': 0.40, // texto. Áudio in: 0.70
  'gemini-2.0-flash-lite_in': 0.075, 'gemini-2.0-flash-lite_out': 0.30,
  'gemini-1.5-flash_in': 0.075,'gemini-1.5-flash_out': 0.30, // ≤128k. Acima: 0.15 / 0.60
  'gemini-1.5-pro_in': 1.25,   'gemini-1.5-pro_out': 5.00,   // ≤128k. Acima: 2.50 / 10.00
  // Fal.ai (USD por imagem) — flux/schnell que a MIA usa fica em torno de US$ 0,003
  'fal_imagem_usd': 0.003,
  // Mercado Pago (fração do valor + taxa fixa em R$) — ajuste pelo SEU plano MP
  'mp_pix_pct': 0.0099, 'mp_pix_fixo': 0,
  'mp_cartao_pct': 0.0499, 'mp_cartao_fixo': 0.40,  // crédito liberação imediata; parcelado 4,98%+0,40 à vista
  'mp_boleto_pct': 0.019, 'mp_boleto_fixo': 3.49,
  // Custo fixo mensal (R$) — VPS Hostinger + domínio prorrateado + backups + ferramentas externas pagas
  'infra_mensal_brl': 220,
  // Câmbio USD → BRL de referência (base para converter o custo de IA)
  'usd_brl': 5.60,
  // Meta de margem líquida mínima por crédito vendido (fração: 0.75 = 75%).
  // Qualquer pacote cuja margem Pix/Cartão fique abaixo disso é marcado como "abaixo da meta" no painel.
  'margem_meta': 0.75,
  // Piso absoluto de margem por conta: quando o custo real da IA desde a última recarga paga
  // atinge (1 - margem_piso) × valor_pago, o consumo da conta é travado até nova compra.
  // Default 0.50 = 50% (ninguém consome mais de metade do que pagou em custo de IA).
  'margem_piso': 0.50,
  // Quantos tokens de IA 1 crédito compra. Lido em runtime por tokensPorCredito() em creditos/index.js.
  'tokens_por_credito': 1000,
};

/** Valores que já existiram como default e que podem ser atualizados automaticamente
 * para o novo default se o admin nunca os tiver editado manualmente. */
const DEFAULTS_ANTIGOS = {
  'infra_mensal_brl': [60],
  'usd_brl': [5.5, 5.50],
};

export function prepararCustos() {
  db.exec(`CREATE TABLE IF NOT EXISTS custos_cfg (chave TEXT PRIMARY KEY, valor REAL)`);
  const ins = db.prepare('INSERT OR IGNORE INTO custos_cfg (chave, valor) VALUES (?,?)');
  for (const [k, v] of Object.entries(PRECOS_PADRAO)) ins.run(k, v);
  // One-shot: se o valor em banco ainda for um default anterior, atualiza para o novo default.
  const upd = db.prepare('UPDATE custos_cfg SET valor=? WHERE chave=? AND valor IN (' + Array(10).fill('?').slice(0, 1).map(() => '?').join(',') + ')');
  for (const [k, antigos] of Object.entries(DEFAULTS_ANTIGOS)) {
    const atual = db.prepare('SELECT valor FROM custos_cfg WHERE chave=?').get(k)?.valor;
    if (atual != null && antigos.includes(atual)) db.prepare('UPDATE custos_cfg SET valor=? WHERE chave=?').run(PRECOS_PADRAO[k], k);
  }
}

// ---------- Custos fixos mensais detalhados (VPS, domínio, ferramentas...) ----------
// Quando existir ao menos um item ativo, a soma deles substitui infra_mensal_brl em todos os cálculos.
export function prepararCustosFixos() {
  prepararCustos();
  db.exec(`CREATE TABLE IF NOT EXISTS custos_fixos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, valor_brl REAL NOT NULL DEFAULT 0, categoria TEXT, obs TEXT, ativo INTEGER DEFAULT 1, ordem INTEGER DEFAULT 0, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
  if (!db.prepare('SELECT id FROM custos_fixos LIMIT 1').get()) {
    const atual = db.prepare("SELECT valor FROM custos_cfg WHERE chave='infra_mensal_brl'").get()?.valor ?? PRECOS_PADRAO.infra_mensal_brl;
    const ins = db.prepare('INSERT INTO custos_fixos (nome, valor_brl, categoria, ordem) VALUES (?,?,?,?)');
    [['Servidor VPS (Hostinger)', 0, 'infra'], ['Domínios (usefiel.com / .app)', 0, 'infra'], ['E-mail / Google Workspace', 0, 'ferramenta'], ['Cloudinary (mídia)', 0, 'ferramenta'], ['Backup', 0, 'infra'], ['Não detalhado (ajuste e zere)', atual, 'outros']]
      .forEach(([n, v, c], i) => ins.run(n, v, c, i));
  }
}
export function listarCustosFixos() { prepararCustosFixos(); const itens = db.prepare('SELECT * FROM custos_fixos ORDER BY ordem, id').all(); const total = +itens.filter(i => i.ativo).reduce((s, i) => s + (Number(i.valor_brl) || 0), 0).toFixed(2); return { itens, total }; }
export function salvarCustoFixo({ id, nome, valor_brl, categoria, obs, ativo }) {
  prepararCustosFixos(); const n = String(nome || '').trim().slice(0, 80); const v = Math.max(0, Number(valor_brl) || 0); const a = ativo === false || ativo === 0 ? 0 : 1;
  if (!n) throw new Error('nome obrigatório');
  if (id) { db.prepare('UPDATE custos_fixos SET nome=?, valor_brl=?, categoria=?, obs=?, ativo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?').run(n, v, categoria || null, obs || null, a, id); return Number(id); }
  const ordem = (db.prepare('SELECT MAX(ordem) m FROM custos_fixos').get()?.m ?? -1) + 1;
  return Number(db.prepare('INSERT INTO custos_fixos (nome, valor_brl, categoria, obs, ativo, ordem) VALUES (?,?,?,?,?,?)').run(n, v, categoria || null, obs || null, a, ordem).lastInsertRowid);
}
export function removerCustoFixo(id) { prepararCustosFixos(); db.prepare('DELETE FROM custos_fixos WHERE id=?').run(id); }

export function precos() {
  prepararCustos(); const rows = db.prepare('SELECT chave, valor FROM custos_cfg').all(); const p = Object.fromEntries(rows.map(r => [r.chave, r.valor]));
  try { const { itens, total } = listarCustosFixos(); if (itens.some(i => i.ativo)) p['infra_mensal_brl'] = total; } catch {}
  return p;
}
export function definirPreco(chave, valor) { prepararCustos(); db.prepare('INSERT INTO custos_cfg (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').run(chave, Number(valor)); }

/** Casa o nome do modelo à chave de preço mais próxima (ex.: 'gemini-2.5-flash-002' → 'gemini-2.5-flash'). */
function normalizaModelo(modelo) {
  const m = String(modelo || '').toLowerCase();
  if (m.includes('2.5-flash') && !m.includes('lite')) return 'gemini-2.5-flash';
  if (m.includes('2.5-pro')) return 'gemini-2.5-pro';
  if (m.includes('flash-lite')) return 'gemini-flash-lite';
  if (m.includes('2.0-flash')) return 'gemini-2.0-flash';
  if (m.includes('1.5-flash')) return 'gemini-1.5-flash';
  if (m.includes('1.5-pro')) return 'gemini-1.5-pro';
  return 'gemini-2.5-flash';
}

/** Custo de IA (USD → BRL) nos últimos N dias, podendo filtrar por conta. */
export function custoIA({ contaId = null, dias = 30 } = {}) {
  const p = precos(); const cambio = p['usd_brl'] || 5.5;
  const rows = db.prepare(`SELECT modelo, SUM(tokens_in) ti, SUM(tokens_out) to_ FROM uso WHERE criado_em >= datetime('now','-'||?||' days') ${contaId ? 'AND conta_id=?' : ''} GROUP BY modelo`).all(dias, ...(contaId ? [contaId] : []));
  let totalUsd = 0; const detalhe = rows.map(r => { const m = normalizaModelo(r.modelo); const c = (r.ti || 0) / 1e6 * (p[m + '_in'] || 0) + (r.to_ || 0) / 1e6 * (p[m + '_out'] || 0); totalUsd += c; return { modelo: r.modelo, modelo_norm: m, tokens_in: r.ti || 0, tokens_out: r.to_ || 0, custo_usd: +c.toFixed(4), custo_brl: +(c * cambio).toFixed(2) }; });
  return { total_usd: +totalUsd.toFixed(4), total_brl: +(totalUsd * cambio).toFixed(2), por_modelo: detalhe, cambio };
}

/** Taxa do Mercado Pago sobre as cobranças pagas nos últimos N dias. */
export function custoMP({ dias = 30 } = {}) {
  const p = precos();
  const rows = db.prepare(`SELECT forma, SUM(valor) bruto, COUNT(*) n FROM cobrancas WHERE status='pago' AND pago_em >= datetime('now','-'||?||' days') GROUP BY forma`).all(dias);
  let totalTaxa = 0; let totalBruto = 0;
  const detalhe = rows.map(r => { const forma = /pix/i.test(r.forma) ? 'pix' : /cart|credit/i.test(r.forma) ? 'cartao' : /boleto/i.test(r.forma) ? 'boleto' : 'pix'; const taxa = (r.bruto || 0) * (p['mp_' + forma + '_pct'] || 0) + (r.n || 0) * (p['mp_' + forma + '_fixo'] || 0); totalTaxa += taxa; totalBruto += r.bruto || 0; return { forma: r.forma, bruto: r.bruto, cobrancas: r.n, taxa: +taxa.toFixed(2), liquido: +((r.bruto || 0) - taxa).toFixed(2) }; });
  return { total_bruto: +totalBruto.toFixed(2), total_taxa: +totalTaxa.toFixed(2), total_liquido: +(totalBruto - totalTaxa).toFixed(2), por_forma: detalhe };
}

/** Visão consolidada: receita, custos operacionais, margem. Para admin global ou para o próprio consumo (contaId). */
export function resumo({ contaId = null, dias = 30 } = {}) {
  const p = precos(); const ia = custoIA({ contaId, dias });
  const mp = contaId ? { total_bruto: 0, total_taxa: 0, total_liquido: 0, por_forma: [] } : custoMP({ dias });
  const infraDia = (p['infra_mensal_brl'] || 0) / 30; const infra = +(infraDia * dias).toFixed(2);
  const receita = contaId ? 0 : mp.total_bruto;
  const custoTotal = +((ia.total_brl || 0) + (mp.total_taxa || 0) + (contaId ? 0 : infra)).toFixed(2);
  const margem = +((receita - custoTotal) + (contaId ? 0 : 0)).toFixed(2); // líquido antes de MP já embutido? Vamos considerar: margem = liquido_mp - ia - infra
  const margemReal = contaId ? 0 : +((mp.total_liquido || 0) - (ia.total_brl || 0) - infra).toFixed(2);
  return { dias, ia, mp, infra_brl: contaId ? 0 : infra, receita_brl: receita, custo_total_brl: custoTotal, margem_brl: margemReal, precos: p };
}

/** Matriz pacote × modelo: para cada pacote, qual seria o custo e margem se o cliente usasse só aquele modelo. */
export async function matrizCustos() {
  const p = precos(); const cambio = p['usd_brl'] || 5.5;
  const { PACOTES, tokensPorCredito } = await import('./creditos/index.js');
  const TPC = tokensPorCredito();
  const MODELOS = [['Gemini 2.5 Pro','gemini-2.5-pro'],['Gemini 2.5 Flash','gemini-2.5-flash'],['Gemini 2.5 Flash-Lite','gemini-flash-lite'],['Gemini 2.0 Flash','gemini-2.0-flash'],['Gemini 2.0 Flash-Lite','gemini-2.0-flash-lite'],['Gemini 1.5 Flash','gemini-1.5-flash'],['Gemini 1.5 Pro','gemini-1.5-pro']];
  const custo1k = (k) => (TPC * 0.7 * (p[k+'_in']||0) + TPC * 0.3 * (p[k+'_out']||0)) / 1e6 * cambio;
  const modelos = MODELOS.map(([nome, chave]) => ({ nome, chave, r_por_1k: +custo1k(chave).toFixed(5) }));
  const matriz = PACOTES.map(pac => ({ pacote: pac.nome, tipo: pac.tipo, preco: pac.preco, creditos: pac.creditos, por_modelo: MODELOS.map(([nome, chave]) => { const custo = custo1k(chave) * pac.creditos; const taxa = pac.preco * (p['mp_pix_pct']||0) + (p['mp_pix_fixo']||0); const lucro = pac.preco - custo - taxa; return { modelo: nome, custo_ia: +custo.toFixed(2), lucro: +lucro.toFixed(2), margem_pct: pac.preco > 0 ? +(lucro / pac.preco * 100).toFixed(1) : 0 }; }) }));
  return { modelos, matriz };
}

/** Margem bruta estimada por pacote (preço vigente × créditos × custo médio por crédito × taxa MP).
 * Como o preço dos pacotes é fixo, calcula também "tokens_credito_max": quantos tokens
 * um crédito pode consumir para o pacote fechar com a meta (p['margem_meta']) de margem líquida.
 * O menor valor entre todos os pacotes vira a tarifa recomendada (TOKENS_POR_CREDITO sugerido). */
export async function margemPacotes() {
  const p = precos(); const cambio = p['usd_brl'] || 5.5; const metaFrac = p['margem_meta'] ?? 0.75;
  const { PACOTES, tokensPorCredito } = await import('./creditos/index.js' /* resolved relative to this file */);
  const TPC = tokensPorCredito();
  // Custo por token (BRL) no Gemini 2.5 Flash, mix 70% in + 30% out
  const custoPorTokenBRL = (0.7 * p['gemini-2.5-flash_in'] + 0.3 * p['gemini-2.5-flash_out']) / 1e6 * cambio;
  const custoIAperCred = TPC * custoPorTokenBRL;
  // Tokens-por-crédito que cada pacote comporta mantendo a meta pela forma Pix / Cartão
  const tokensMax = (pac, pct, fixo) => {
    // margem_desejada_BRL = metaFrac * preco. custo_IA_total_máx = preco*(1-pct-metaFrac) - fixo
    const custoIAmax = pac.preco * (1 - (pct || 0) - metaFrac) - (fixo || 0);
    if (custoIAmax <= 0 || pac.creditos <= 0) return 0;
    return Math.floor(custoIAmax / pac.creditos / custoPorTokenBRL);
  };
  const linhas = PACOTES.map(pac => {
    const custoIAtotal = pac.creditos * custoIAperCred;
    const taxaPix = pac.preco * p['mp_pix_pct'] + p['mp_pix_fixo'];
    const taxaCartao = pac.preco * p['mp_cartao_pct'] + p['mp_cartao_fixo'];
    const lucroPix = pac.preco - custoIAtotal - taxaPix;
    const lucroCartao = pac.preco - custoIAtotal - taxaCartao;
    const margemPixPct = lucroPix / pac.preco; const margemCartaoPct = lucroCartao / pac.preco;
    const tokensMaxPix = tokensMax(pac, p['mp_pix_pct'], p['mp_pix_fixo']);
    const tokensMaxCartao = tokensMax(pac, p['mp_cartao_pct'], p['mp_cartao_fixo']);
    return {
      ...pac,
      custo_credito: +custoIAperCred.toFixed(4),
      custo_ia: +custoIAtotal.toFixed(2),
      taxa_pix: +taxaPix.toFixed(2),
      taxa_cartao: +taxaCartao.toFixed(2),
      lucro_pix: +lucroPix.toFixed(2),
      lucro_cartao: +lucroCartao.toFixed(2),
      margem_pix_pct: +(margemPixPct * 100).toFixed(1),
      margem_cartao_pct: +(margemCartaoPct * 100).toFixed(1),
      tokens_credito_max_pix: tokensMaxPix,
      tokens_credito_max_cartao: tokensMaxCartao,
      abaixo_meta_pix: margemPixPct < metaFrac,
      abaixo_meta_cartao: margemCartaoPct < metaFrac,
      meta_pct: +(metaFrac * 100).toFixed(0),
    };
  });
  // Tarifa recomendada: o pior caso (menor tokens/crédito) entre todos os pacotes, considerando cartão (mais caro).
  const limites = linhas.map(l => Math.min(l.tokens_credito_max_pix || Infinity, l.tokens_credito_max_cartao || Infinity)).filter(v => v > 0 && v !== Infinity);
  const tokensRecomendados = limites.length ? Math.min(...limites) : TOKENS_POR_CREDITO;
  // Aplica em todas as linhas também o "tokens recomendado por pacote" (pior do próprio pacote)
  for (const l of linhas) l.tokens_credito_recomendado = Math.min(l.tokens_credito_max_pix || Infinity, l.tokens_credito_max_cartao || Infinity);
  return {
    linhas,
    tokens_por_credito_atual: TPC,
    tokens_por_credito_recomendado: tokensRecomendados,
    tokens_por_credito_ajuste_pct: TPC > 0 ? +((tokensRecomendados - TPC) / TPC * 100).toFixed(1) : 0,
    meta_pct: +(metaFrac * 100).toFixed(0),
    custo_por_token_brl: +custoPorTokenBRL.toFixed(8),
  };
}
