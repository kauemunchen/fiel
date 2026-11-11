// Espelho financeiro no Google Sheets: uma planilha no Drive do dono com TODOS os lançamentos da Tina
// (as mesmas informações do painel web e do Telegram), atualizada sozinha. Mão única: Fiel → planilha.
// Abas: Painel (filtros por carteira, mês e conta + indicadores, despesas por categoria, resumo por mês, vencimentos),
// Lançamentos (tudo, com filtro em cada coluna) e Contas (saldos de carteiras, contas e faturas de cartão).
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import * as CF from './contas-fin.js';

db.exec(`CREATE TABLE IF NOT EXISTS fin_espelho (conta_id INTEGER PRIMARY KEY, spreadsheet_id TEXT NOT NULL, assinatura TEXT, sincronizado_em TEXT, erro TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);

const link = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
export const espelhoDe = (contaId) => db.prepare('SELECT * FROM fin_espelho WHERE conta_id=?').get(contaId) || null;
const CAB = ['ID', 'Data', 'Mês', 'Vencimento', 'Carteira', 'PJ/PF', 'Tipo', 'Status', 'Descrição', 'Contraparte', 'Categoria', 'Conta do plano', 'Conta (saiu de / entrou em)', 'Valor', 'Valor (±)', 'Transferência', 'Origem'];
const serial = (iso) => iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5) : '';
const agoraBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 16).split(' ').map((p, i) => i ? p : p.split('-').reverse().join('/')).join(' ');
const STATUS = { pago: 'Pago', previsto: 'Previsto', pendente: 'Pendente' };

function dados(contaId) {
  const contas = Object.fromEntries(CF.listarContasFin(contaId, null, { todas: true }).map(c => [c.id, CF.rotuloConta(c)]));
  const fichas = {}; const pf = (cart) => (fichas[cart] ??= CF.fichaCarteira(contaId, cart).pf) ? 'PF' : 'PJ';
  const ls = db.prepare('SELECT * FROM fin_lancamentos WHERE conta_id=? AND oculto=0 ORDER BY COALESCE(pago_em, vencimento, data) DESC, id DESC').all(contaId);
  const linhas = ls.map(l => {
    const efet = l.status === 'pago' ? (l.pago_em || l.data) : (l.vencimento || l.data); const ent = l.tipo === 'entrada';
    const plano = /^\d+(\.\d+)*\s/.test(l.subcategoria || '') ? l.subcategoria : '';
    return [l.id, serial(efet), "'" + String(efet || '').slice(0, 7), serial(l.vencimento), l.carteira, pf(l.carteira), ent ? 'Entrada' : 'Saída', STATUS[l.status] || l.status,
      l.descricao || '', l.contraparte || '', l.categoria || 'Sem categoria', plano, contas[l.conta_fin_id] || contas[l.pago_com_id] || '',
      +Number(l.valor).toFixed(2), +(ent ? l.valor : -l.valor).toFixed(2), l.categoria === 'Transferência' ? 'Sim' : 'Não', l.origem || ''];
  });
  return { linhas, ls };
}
async function contasLinhas(contaId) {
  const F = await import('./financeiro.js'); const out = [];
  for (const cart of F.carteirasDe(contaId)) {
    const s = F.saldoAtual(contaId, cart); out.push([cart, 'Carteira', cart, s.saldo, s.base || '']);
    for (const c of CF.listarContasFin(contaId, cart)) {
      if (c.tipo === 'cartao_credito') { const f = CF.faturasCartao(contaId, c.id); out.push([cart, CF.TIPOS[c.tipo], CF.rotuloConta(c), f[0]?.total || 0, f[0] ? `fatura que vence em ${f[0].venc.split('-').reverse().join('/')}${c.limite ? ` · limite ${c.limite}` : ''}` : 'sem fatura em aberto']); }
      else if (c.tipo !== 'cartao_debito') { const s2 = CF.saldoContaFin(contaId, c.id); out.push([cart, CF.TIPOS[c.tipo], CF.rotuloConta(c), s2.saldo, s2.informado ? `saldo informado em ${s2.data_base.split('-').reverse().join('/')}` : 'saldo ainda não informado']); }
    }
  }
  return out;
}

// ---------- fórmulas do Painel ----------
const L = (c) => `'Lançamentos'!${c}2:${c}`;
const cart = `((${L('E')}=$B$4)+($B$4="Todas")>0)`, mes = `((${L('C')}=$B$5)+($B$5="Todos")>0)`, conta = `((${L('M')}=$B$6)+($B$6="Todas")>0)`;
const soma = (...cond) => `=SUMPRODUCT(${L('N')}*${[...cond, cart, mes, conta].join('*')})`;
const W = (comMes = true) => `&IF($B$4="Todas",""," and E = '"&$B$4&"'")${comMes ? `&IF($B$5="Todos",""," and C = '"&$B$5&"'")` : ''}&IF($B$6="Todas",""," and M = '"&$B$6&"'")`;
const PAINEL = [
  ['Espelho financeiro · Fiel'], ['Atualizado pelo Fiel'], [],
  ['Carteira', 'Todas'], ['Mês', 'Todos'], ['Conta (saiu de / entrou em)', 'Todas'], ['Escolha nos campos acima. "Todas/Todos" mostra tudo.'], [],
  ['Saldo atual', `=IF($B$6="Todas",SUMPRODUCT(Contas!D2:D*(Contas!B2:B="Carteira")*((Contas!A2:A=$B$4)+($B$4="Todas")>0)),SUMPRODUCT(Contas!D2:D*(Contas!C2:C=$B$6)*(Contas!B2:B<>"Carteira")))`],
  ['Recebido', soma(`(${L('G')}="Entrada")`, `(${L('H')}="Pago")`, `(${L('P')}="Não")`)],
  ['Pago', soma(`(${L('G')}="Saída")`, `(${L('H')}="Pago")`, `(${L('P')}="Não")`)],
  ['Resultado', '=B10-B11'],
  ['A receber (em aberto)', soma(`(${L('G')}="Entrada")`, `(${L('H')}<>"Pago")`, `(${L('P')}="Não")`)],
  ['A pagar (em aberto)', soma(`(${L('G')}="Saída")`, `(${L('H')}<>"Pago")`, `(${L('P')}="Não")`)],
  ['A pagar em atraso', soma(`(${L('G')}="Saída")`, `(${L('H')}<>"Pago")`, `(${L('D')}<TODAY())`, `(${L('D')}<>"")`)],
  ['Transferências entre contas', soma(`(${L('G')}="Saída")`, `(${L('P')}="Sim")`)], [],
  ['Resumo por mês'],
  [`=IFERROR(QUERY('Lançamentos'!A2:Q,"select C, sum(N) where H = 'Pago' and P = 'Não'"${W(false)}&" group by C pivot G order by C desc label C 'Mês'",0),"Sem lançamentos pagos no filtro")`],
];
const CATEG = `=IFERROR(QUERY('Lançamentos'!A2:Q,"select K, sum(N) where G = 'Saída' and H = 'Pago' and P = 'Não'"${W()}&" group by K order by sum(N) desc label K 'Despesa por categoria', sum(N) 'Total'",0),"Sem despesas pagas no filtro")`;
const VENC = `=IFERROR(QUERY('Lançamentos'!A2:Q,"select D, E, I, N, G where H <> 'Pago' and D is not null"${W()}&" order by D limit 25 label D 'Vencimento', E 'Carteira', I 'Descrição', N 'Valor', G 'Tipo'",0),"Nada em aberto no filtro")`;
/** Troca o separador de argumentos "," por ";" fora das aspas duplas (planilhas pt-BR que não aceitam vírgula). */
const ptBR = (f) => { let q = false, o = ''; for (const ch of f) { if (ch === '"') q = !q; o += !q && ch === ',' ? ';' : ch; } return o; };

async function svcDe(contaId) { if (globalThis.__sheetsTeste) return globalThis.__sheetsTeste; const G = await import('../integracoes/google-sheets.js'); return G.sheetsDe(contaId); }
const lista = (vals) => ({ condition: { type: 'ONE_OF_LIST', values: vals.slice(0, 450).map(v => ({ userEnteredValue: String(v) })) }, showCustomUi: true, strict: true });

export async function criarEspelho(contaId) {
  const ja = espelhoDe(contaId); if (ja) { await sincronizar(contaId, { forcar: true }); return { ok: true, ja_existia: true, link: link(ja.spreadsheet_id) }; }
  const svc = await svcDe(contaId);
  const r = await svc.spreadsheets.create({ requestBody: { properties: { title: 'Fiel · Espelho financeiro', locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
    sheets: [{ properties: { title: 'Painel', gridProperties: { frozenRowCount: 0 } } }, { properties: { title: 'Lançamentos', gridProperties: { frozenRowCount: 1 } } }, { properties: { title: 'Contas', gridProperties: { frozenRowCount: 1 } } }] },
    fields: 'spreadsheetId,sheets.properties' });
  const id = r.data.spreadsheetId; const [sP, sL, sC] = r.data.sheets.map(s => s.properties.sheetId);
  db.prepare('INSERT INTO fin_espelho (conta_id, spreadsheet_id) VALUES (?,?)').run(contaId, id);
  try { db.prepare("INSERT INTO planilhas (conta_id, nome, spreadsheet_id, aba_padrao, cabecalhos) VALUES (?,?,?,?,?) ON CONFLICT(conta_id, nome) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id").run(contaId, 'Espelho financeiro', id, 'Lançamentos', JSON.stringify(CAB)); } catch {}
  await svc.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: "'Lançamentos'!A1", values: [CAB] }, { range: 'Contas!A1', values: [['Carteira', 'Tipo', 'Nome', 'Saldo / fatura', 'Observação']] },
    { range: 'Painel!A1', values: PAINEL }, { range: 'Painel!D4', values: [[CATEG]] }, { range: 'Painel!H4', values: [[VENC]] }] } });
  const cor = (h) => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 });
  const cab = (sheetId, n) => ({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }, cell: { userEnteredFormat: { backgroundColor: cor('#18162D'), textFormat: { bold: true, foregroundColor: cor('#FAF8F1') } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
  const fmt = (sheetId, c0, c1, r0, r1, f) => ({ repeatCell: { range: { sheetId, startColumnIndex: c0, endColumnIndex: c1, ...(r0 != null ? { startRowIndex: r0, endRowIndex: r1 } : { startRowIndex: 1 }) }, cell: { userEnteredFormat: f }, fields: 'userEnteredFormat(' + Object.keys(f).join(',') + ')' } });
  const moeda = { numberFormat: { type: 'CURRENCY', pattern: '"R$" #,##0.00;[Red]-"R$" #,##0.00' } }, data = { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } };
  await svc.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [
    cab(sL, CAB.length), cab(sC, 5),
    fmt(sL, 1, 2, null, null, data), fmt(sL, 3, 4, null, null, data), fmt(sL, 13, 15, null, null, moeda), fmt(sC, 3, 4, null, null, moeda),
    { setBasicFilter: { filter: { range: { sheetId: sL, startColumnIndex: 0, endColumnIndex: CAB.length } } } },
    { setBasicFilter: { filter: { range: { sheetId: sC, startColumnIndex: 0, endColumnIndex: 5 } } } },
    fmt(sP, 0, 1, 0, 1, { textFormat: { bold: true, fontSize: 18, foregroundColor: cor('#18162D') } }),
    fmt(sP, 0, 1, 1, 2, { textFormat: { italic: true, foregroundColor: cor('#5C5A6E') } }),
    fmt(sP, 0, 1, 3, 6, { textFormat: { bold: true } }), fmt(sP, 1, 2, 3, 6, { backgroundColor: cor('#FCE3DC'), textFormat: { bold: true } }),
    fmt(sP, 0, 1, 6, 7, { textFormat: { italic: true, fontSize: 9, foregroundColor: cor('#5C5A6E') } }),
    fmt(sP, 0, 1, 8, 16, { textFormat: { bold: true } }), fmt(sP, 1, 2, 8, 16, { ...moeda, textFormat: { bold: true, fontSize: 12 } }),
    fmt(sP, 0, 1, 17, 18, { textFormat: { bold: true, fontSize: 12 } }), fmt(sP, 1, 4, 19, 80, moeda),
    fmt(sP, 4, 5, 4, 200, moeda), fmt(sP, 7, 8, 4, 200, data), fmt(sP, 10, 11, 4, 200, moeda),
    { updateDimensionProperties: { range: { sheetId: sP, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 210 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: sP, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: sP, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: sP, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: sL, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 280 }, fields: 'pixelSize' } },
    { addProtectedRange: { protectedRange: { range: { sheetId: sL }, description: 'Reescrita pelo Fiel a cada atualização', warningOnly: true } } },
  ] } });
  try { const drive = await import('../integracoes/google-drive.js'); const raiz = await drive.pastaRaiz(contaId); const pasta = await drive.obterOuCriarPasta(contaId, 'Financeiro', raiz); await drive.mover(contaId, id, pasta); } catch {}
  await sincronizar(contaId, { forcar: true });
  // Planilha pt-BR que não aceite vírgula nas fórmulas: regrava com ponto e vírgula.
  try { const v = await svc.spreadsheets.values.get({ spreadsheetId: id, range: 'Painel!B9:B12' }); if ((v.data.values || []).flat().some(x => /^#/.test(String(x))))
    await svc.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'USER_ENTERED', data: [{ range: 'Painel!A1', values: PAINEL.map(l => l.map(c => String(c).startsWith('=') ? ptBR(c) : c)) }, { range: 'Painel!D4', values: [[ptBR(CATEG)]] }, { range: 'Painel!H4', values: [[ptBR(VENC)]] }] } }); } catch {}
  await sincronizar(contaId, { forcar: true });
  return { ok: true, link: link(id) };
}

/** Reescreve Lançamentos e Contas e atualiza as listas dos filtros. Só faz algo se os dados mudaram (ou forcar). */
export async function sincronizar(contaId, { forcar = false, ignorarEdicao = false } = {}) {
  const e = espelhoDe(contaId); if (!e) return { ok: false, erro: 'sem espelho' };
  // O dono editou a aba Lançamentos? Não sobrescreve: espera ele revisar (aplicar ou descartar) no Fiel.
  if (!ignorarEdicao && e.hash_planilha) { try { const h = hashAba(await lerAba(contaId)); if (h !== e.hash_planilha) { if (!e.alterada) db.prepare('UPDATE fin_espelho SET alterada=1 WHERE conta_id=?').run(contaId); return { ok: true, editada_pelo_dono: true }; } } catch {} }
  if (e.alterada && !ignorarEdicao) return { ok: true, editada_pelo_dono: true };
  const { linhas } = dados(contaId); const contas = await contasLinhas(contaId);
  const assin = crypto.createHash('md5').update(JSON.stringify([linhas, contas])).digest('hex');
  // Planilha criada antes da detecção de edição: se o Fiel não mudou e a aba difere do que ele escreveria, o dono editou.
  if (!ignorarEdicao && !e.hash_planilha && e.assinatura === assin) { try { const lida = await lerAba(contaId); const nossa = linhas.map(r => r.map(c => typeof c === 'string' && c.startsWith("'") ? c.slice(1) : c));
    if (hashAba(lida) !== hashAba(nossa)) { db.prepare('UPDATE fin_espelho SET alterada=1 WHERE conta_id=?').run(contaId); return { ok: true, editada_pelo_dono: true }; }
    db.prepare('UPDATE fin_espelho SET hash_planilha=? WHERE conta_id=?').run(hashAba(lida), contaId); } catch {} }
  if (!forcar && assin === e.assinatura) return { ok: true, sem_mudanca: true };
  try {
    const svc = await svcDe(contaId); const id = e.spreadsheet_id;
    const meta = await svc.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties' }); const sid = (t) => meta.data.sheets.find(s => s.properties.title === t)?.properties.sheetId;
    await svc.spreadsheets.values.batchClear({ spreadsheetId: id, requestBody: { ranges: ["'Lançamentos'!A2:Q", 'Contas!A2:E'] } });
    const data = [{ range: "'Lançamentos'!A1", values: [CAB] }, { range: 'Painel!A2', values: [[`Atualizado pelo Fiel em ${agoraBR()} · ${linhas.length} lançamentos. As abas Lançamentos e Contas são reescritas a cada atualização; crie suas próprias abas à vontade.`]] }];
    if (linhas.length) data.push({ range: "'Lançamentos'!A2", values: linhas }); if (contas.length) data.push({ range: 'Contas!A2', values: contas });
    await svc.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'USER_ENTERED', data } });
    const sP = sid('Painel');
    if (sP != null) {
      const carts = [...new Set(linhas.map(l => l[4]).concat(contas.filter(c => c[1] === 'Carteira').map(c => c[0])))];
      const meses = [...new Set(linhas.map(l => l[2].slice(1)))].sort().reverse(); const nomesC = [...new Set(contas.filter(c => c[1] !== 'Carteira').map(c => c[2]))];
      const dv = (row, vals) => ({ setDataValidation: { range: { sheetId: sP, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 }, rule: lista(vals) } });
      await svc.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [dv(3, ['Todas', ...carts]), dv(4, ['Todos', ...meses]), dv(5, ['Todas', ...nomesC])] } });
    }
    let hp = null; try { hp = hashAba(await lerAba(contaId)); } catch {}
    db.prepare('UPDATE fin_espelho SET assinatura=?, hash_planilha=?, alterada=0, sincronizado_em=CURRENT_TIMESTAMP, erro=NULL WHERE conta_id=?').run(assin, hp, contaId);
    return { ok: true, linhas: linhas.length, link: link(id) };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 300); db.prepare('UPDATE fin_espelho SET erro=? WHERE conta_id=?').run(msg, contaId);
    if (/not found|notFound|404/i.test(msg)) db.prepare('DELETE FROM fin_espelho WHERE conta_id=?').run(contaId); // planilha apagada pelo dono: some do Fiel
    return { ok: false, erro: msg };
  }
}

// Atualização automática: 60 s depois de qualquer mudança da Tina, e a cada 15 min (pega mudanças do painel web).
const timers = new Map();
export function agendarEspelho(contaId) {
  try { if (!espelhoDe(contaId)) return; } catch { return; }
  clearTimeout(timers.get(contaId)); timers.set(contaId, setTimeout(() => { timers.delete(contaId); sincronizar(contaId).catch(e => console.error('[espelho]', e.message)); }, 60e3));
}
export async function sincronizarTodos() {
  for (const { conta_id } of db.prepare('SELECT conta_id FROM fin_espelho').all()) { try { await sincronizar(conta_id); } catch (e) { console.error('[espelho]', conta_id, e.message); } }
}

// ---------- Mão contrária: alterações feitas na planilha → Fiel (sempre com revisão e confirmação) ----------
try { db.exec('ALTER TABLE fin_espelho ADD COLUMN hash_planilha TEXT'); } catch {}
try { db.exec('ALTER TABLE fin_espelho ADD COLUMN alterada INTEGER DEFAULT 0'); } catch {}
const deSerial = (v) => { if (v === '' || v == null) return null; if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim(); let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : 'inválida'; };
const num = (v) => typeof v === 'number' ? v : Number(String(v || '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
const sa = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const normLinha = (r) => [r[0], r[1], r[3], r[4], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13]].map(x => typeof x === 'number' ? +x.toFixed(2) : String(x ?? '').trim()).join('\u0001');
async function lerAba(contaId) {
  const e = espelhoDe(contaId); if (!e) throw new Error('A planilha espelho ainda não existe. Crie em Financeiro › Planilha no Drive.');
  const svc = await svcDe(contaId); const v = await svc.spreadsheets.values.get({ spreadsheetId: e.spreadsheet_id, range: "'Lançamentos'!A2:Q", valueRenderOption: 'UNFORMATTED_VALUE' });
  return (v.data.values || []).filter(r => r.some(c => String(c ?? '').trim() !== ''));
}
const hashAba = (linhas) => crypto.createHash('md5').update(linhas.map(normLinha).join('\n')).digest('hex');

/** Compara a aba Lançamentos com o Fiel. Não grava nada. */
export async function alteracoesPlanilha(contaId) {
  const PL = await import('./plano-contas.js'); const F = await import('./financeiro.js');
  const linhas = await lerAba(contaId); const carts = F.carteirasDe(contaId);
  const mapa = new Map(db.prepare('SELECT * FROM fin_lancamentos WHERE conta_id=? AND oculto=0').all(contaId).map(l => [l.id, l]));
  const contas = CF.listarContasFin(contaId, null, { todas: true });
  const mudancas = [], novos = [], erros = [], vistos = new Set();
  const STI = { pago: 'pago', previsto: 'previsto', pendente: 'pendente' };
  linhas.forEach((r, i) => {
    const lin = i + 2; const id = Number(r[0]) || null; const g = (k) => String(r[k] ?? '').trim();
    const alvo = { carteira: g(4), tipo: /^entr/i.test(g(6)) ? 'entrada' : /^sa/i.test(g(6)) ? 'saida' : null, status: STI[sa(g(7))] || null,
      descricao: g(8), contraparte: g(9), categoria: g(10), plano: g(11), conta: g(12), valor: +num(r[13]).toFixed(2), data: deSerial(r[1]), vencimento: deSerial(r[3]) };
    const err = []; const cart = carts.find(c => sa(c) === sa(alvo.carteira));
    if (!cart) err.push(`carteira "${alvo.carteira}" não existe (${carts.join(', ')})`); else alvo.carteira = cart;
    if (!alvo.tipo) err.push('Tipo deve ser Entrada ou Saída'); if (!alvo.status) err.push('Status deve ser Pago, Previsto ou Pendente');
    if (!(alvo.valor > 0)) err.push('Valor inválido'); if (alvo.data === 'inválida' || alvo.vencimento === 'inválida') err.push('data inválida (use dd/mm/aaaa)');
    if (cart && alvo.plano && PL.planoAtivo(contaId, cart)) { const p = PL.acharConta(contaId, cart, alvo.plano); if (!p) err.push(`conta do plano "${alvo.plano}" não existe em ${cart}`); else { alvo.plano = PL.rotulo(p); alvo.categoria = p.grupo; } }
    let cf = null; if (cart && alvo.conta) { cf = contas.find(c => c.carteira === cart && sa(CF.rotuloConta(c)) === sa(alvo.conta)) || CF.acharContaFin(contaId, cart, alvo.conta); if (!cf) err.push(`conta/cartão "${alvo.conta}" não cadastrada em ${cart}`); }
    if (err.length) { erros.push({ linha: lin, id, descricao: alvo.descricao, erros: err }); if (id) vistos.add(id); return; }
    if (id && mapa.has(id)) {
      vistos.add(id); const l = mapa.get(id); const atual = {
        carteira: l.carteira, tipo: l.tipo, status: l.status, descricao: l.descricao || '', contraparte: l.contraparte || '', categoria: l.categoria || 'Sem categoria',
        plano: /^\d+(\.\d+)*\s/.test(l.subcategoria || '') ? l.subcategoria : '', conta_fin_id: l.conta_fin_id || l.pago_com_id || null, valor: +Number(l.valor).toFixed(2),
        data: l.status === 'pago' ? (l.pago_em || l.data) : (l.vencimento || l.data), vencimento: l.vencimento || null };
      const campos = []; const cmp = (k, rot, a, b) => { if (String(a ?? '') !== String(b ?? '')) campos.push({ campo: k, rotulo: rot, de: a ?? '', para: b ?? '' }); };
      cmp('carteira', 'Carteira', atual.carteira, alvo.carteira); cmp('tipo', 'Tipo', atual.tipo, alvo.tipo); cmp('status', 'Status', atual.status, alvo.status);
      cmp('descricao', 'Descrição', atual.descricao, alvo.descricao); cmp('contraparte', 'Contraparte', atual.contraparte, alvo.contraparte);
      cmp('valor', 'Valor', atual.valor, alvo.valor); cmp('data', 'Data', atual.data, alvo.data); cmp('vencimento', 'Vencimento', atual.vencimento, alvo.vencimento);
      if (alvo.plano !== atual.plano && alvo.plano) cmp('plano', 'Conta do plano', atual.plano, alvo.plano); else if (alvo.categoria !== atual.categoria) cmp('categoria', 'Categoria', atual.categoria, alvo.categoria);
      const cfAtual = atual.conta_fin_id ? CF.rotuloConta(contas.find(c => c.id === atual.conta_fin_id) || { nome: '?' }) : ''; if ((cf?.id || null) !== atual.conta_fin_id) cmp('conta', 'Conta/cartão', cfAtual, cf ? CF.rotuloConta(cf) : '');
      if (campos.length) mudancas.push({ id, linha: lin, descricao: alvo.descricao, campos, alvo: { ...alvo, conta_fin_id: cf?.id || null } });
    } else if (!id && alvo.descricao) novos.push({ linha: lin, descricao: alvo.descricao, alvo: { ...alvo, conta_fin_id: cf?.id || null } });
    else if (id) erros.push({ linha: lin, id, descricao: alvo.descricao, erros: ['ID não existe no Fiel (apague o ID para lançar como novo)'] });
  });
  const removidos = [...mapa.values()].filter(l => !vistos.has(l.id)).map(l => ({ id: l.id, descricao: l.descricao, valor: l.valor, carteira: l.carteira, tipo: l.tipo }));
  return { mudancas, novos, removidos, erros, total: mudancas.length + novos.length + removidos.length };
}

/** Aplica as alterações escolhidas (ids de mudanças, linhas de novos, ids a remover). Remover = ocultar (reversível). */
export async function aplicarAlteracoes(contaId, { ids = 'todos', novos = 'todos', remover = [] } = {}) {
  const PL = await import('./plano-contas.js'); const a = await alteracoesPlanilha(contaId); let alt = 0, cri = 0, rem = 0;
  const quer = (lista, v) => lista === 'todos' || (Array.isArray(lista) && lista.map(Number).includes(Number(v)));
  db.transaction(() => {
    for (const m of a.mudancas.filter(m => quer(ids, m.id))) {
      const x = m.alvo; const l = db.prepare('SELECT * FROM fin_lancamentos WHERE id=? AND conta_id=?').get(m.id, contaId); if (!l) continue;
      const enc = x.plano ? { categoria: x.categoria, subcategoria: x.plano } : PL.encaixarNoPlano(contaId, x.carteira, x.tipo, { categoria: x.categoria === 'Sem categoria' ? null : x.categoria }).a;
      const capHoje = (d) => { const h = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); return !d || d > h ? h : d; };
      const tem = (k) => m.campos.some(c => c.campo === k); const pago = x.status === 'pago'; let cfId = l.conta_fin_id, pcId = l.pago_com_id;
      if (m.campos.some(c => c.campo === 'conta')) { const t = CF.listarContasFin(contaId, null, { todas: true }).find(c => c.id === x.conta_fin_id)?.tipo;
        if (t === 'cartao_credito' || !l.pago_com_id) { cfId = x.conta_fin_id; } else { pcId = x.conta_fin_id; } }
      db.prepare(`UPDATE fin_lancamentos SET carteira=?, tipo=?, status=?, descricao=?, contraparte=?, valor=?, categoria=?, subcategoria=?, vencimento=?, pago_em=?, conta_fin_id=?, pago_com_id=? WHERE id=?`)
        .run(x.carteira, x.tipo, x.status, x.descricao, x.contraparte || null, x.valor, enc.categoria || null, enc.subcategoria || null,
          tem('vencimento') ? x.vencimento : (!pago && tem('data') ? x.data : (l.vencimento || (!pago ? l.data : null))), pago ? capHoje(tem('data') ? x.data : l.status !== 'pago' ? (l.vencimento || x.data) : (l.pago_em || l.data)) : null, cfId, pcId, m.id);
      alt++;
    }
    for (const n of a.novos.filter(n => quer(novos, n.linha))) {
      const x = n.alvo; const pago = x.status === 'pago'; const enc = x.plano ? { categoria: x.categoria, subcategoria: x.plano } : PL.encaixarNoPlano(contaId, x.carteira, x.tipo, { categoria: x.categoria === 'Sem categoria' ? null : x.categoria }).a;
      const hj = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); let dia = x.data || x.vencimento || hj; if (pago && dia > hj) dia = hj;
      db.prepare("INSERT INTO fin_lancamentos (conta_id, carteira, tipo, valor, descricao, contraparte, categoria, subcategoria, status, data, vencimento, pago_em, origem, conta_fin_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'planilha',?)")
        .run(contaId, x.carteira, x.tipo, x.valor, x.descricao, x.contraparte || null, enc.categoria || null, enc.subcategoria || null, x.status, dia, x.vencimento || (pago ? null : dia), pago ? dia : null, x.conta_fin_id);
      cri++;
    }
    for (const r of a.removidos.filter(r => quer(remover, r.id))) { db.prepare("UPDATE fin_lancamentos SET oculto=1, comprovante=COALESCE(comprovante,'') || ' [removido pela planilha]' WHERE id=? AND conta_id=?").run(r.id, contaId); rem++; }
  })();
  db.prepare('UPDATE fin_espelho SET alterada=0 WHERE conta_id=?').run(contaId);
  await sincronizar(contaId, { forcar: true, ignorarEdicao: true });
  return { ok: true, alterados: alt, criados: cri, removidos: rem, erros: a.erros };
}
/** Descarta as edições da planilha: ela volta a espelhar o Fiel. */
export async function descartarEdicoes(contaId) { db.prepare('UPDATE fin_espelho SET alterada=0 WHERE conta_id=?').run(contaId); return sincronizar(contaId, { forcar: true, ignorarEdicao: true }); }

/** Confere agora se o dono editou a planilha (usado ao abrir o Financeiro). No máximo 1 leitura a cada 20 s por conta. */
const ultimaChecagem = new Map();
export async function verificarEdicao(contaId) {
  const e = espelhoDe(contaId); if (!e) return false; if (e.alterada) return true;
  if (Date.now() - (ultimaChecagem.get(contaId) || 0) < 20e3 || !e.hash_planilha) return false; ultimaChecagem.set(contaId, Date.now());
  try { if (hashAba(await lerAba(contaId)) !== e.hash_planilha) { db.prepare('UPDATE fin_espelho SET alterada=1 WHERE conta_id=?').run(contaId); return true; } } catch {}
  return false;
}
