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
const CAB = ['ID', 'Data', 'Mês', 'Vencimento', 'Carteira', 'PJ/PF', 'Tipo', 'Status', 'Descrição', 'Contraparte', 'Categoria', 'Conta do plano', 'Conta/cartão', 'Valor', 'Valor (±)', 'Transferência', 'Origem'];
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
  ['Carteira', 'Todas'], ['Mês', 'Todos'], ['Conta / cartão', 'Todas'], ['Escolha nos campos acima. "Todas/Todos" mostra tudo.'], [],
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
export async function sincronizar(contaId, { forcar = false } = {}) {
  const e = espelhoDe(contaId); if (!e) return { ok: false, erro: 'sem espelho' };
  const { linhas } = dados(contaId); const contas = await contasLinhas(contaId);
  const assin = crypto.createHash('md5').update(JSON.stringify([linhas, contas])).digest('hex');
  if (!forcar && assin === e.assinatura) return { ok: true, sem_mudanca: true };
  try {
    const svc = await svcDe(contaId); const id = e.spreadsheet_id;
    const meta = await svc.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties' }); const sid = (t) => meta.data.sheets.find(s => s.properties.title === t)?.properties.sheetId;
    await svc.spreadsheets.values.batchClear({ spreadsheetId: id, requestBody: { ranges: ["'Lançamentos'!A2:Q", 'Contas!A2:E'] } });
    const data = [{ range: 'Painel!A2', values: [[`Atualizado pelo Fiel em ${agoraBR()} · ${linhas.length} lançamentos. As abas Lançamentos e Contas são reescritas a cada atualização; crie suas próprias abas à vontade.`]] }];
    if (linhas.length) data.push({ range: "'Lançamentos'!A2", values: linhas }); if (contas.length) data.push({ range: 'Contas!A2', values: contas });
    await svc.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'USER_ENTERED', data } });
    const sP = sid('Painel');
    if (sP != null) {
      const carts = [...new Set(linhas.map(l => l[4]).concat(contas.filter(c => c[1] === 'Carteira').map(c => c[0])))];
      const meses = [...new Set(linhas.map(l => l[2].slice(1)))].sort().reverse(); const nomesC = [...new Set(contas.filter(c => c[1] !== 'Carteira').map(c => c[2]))];
      const dv = (row, vals) => ({ setDataValidation: { range: { sheetId: sP, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 }, rule: lista(vals) } });
      await svc.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [dv(3, ['Todas', ...carts]), dv(4, ['Todos', ...meses]), dv(5, ['Todas', ...nomesC])] } });
    }
    db.prepare('UPDATE fin_espelho SET assinatura=?, sincronizado_em=CURRENT_TIMESTAMP, erro=NULL WHERE conta_id=?').run(assin, contaId);
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
