// Google Sheets do dono (usa o escopo drive já autorizado). Planilhas cadastradas por nome na tabela `planilhas`.
import { google } from 'googleapis';
import { db } from '../db/index.js';
import { extrairId } from './google-drive.js';
function auth(contaId) {
  const row = db.prepare('SELECT token_json FROM google_auth WHERE conta_id=?').get(contaId);
  if (!row) throw new Error('Google não conectado. Diga "conectar google".');
  const tok = JSON.parse(row.token_json);
  if (!/auth\/(drive|spreadsheets)(\b|\.)/.test(tok.scope || '')) throw new Error('A autorização atual não inclui o Drive/Planilhas. Diga "conectar google" de novo.');
  const a = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  a.setCredentials(tok);
  a.on('tokens', (t) => db.prepare('UPDATE google_auth SET token_json=? WHERE conta_id=?').run(JSON.stringify({ ...tok, ...t }), contaId));
  return google.sheets({ version: 'v4', auth: a });
}
function traduzErro(e) {
  const m = String(e?.message || e);
  if (/has not been used in project|is disabled/i.test(m)) return new Error('A Google Sheets API não está ativada no projeto km-assistente. Ative em: https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=km-assistente');
  if (/Unable to parse range/i.test(m)) return new Error('Aba ou intervalo não encontrado na planilha.');
  if (/not found|notFound/i.test(m)) return new Error('Planilha não encontrada (ou sem permissão).');
  return new Error(`Sheets: ${m.slice(0, 200)}`);
}
const link = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export function listarCadastradas(contaId) { return db.prepare('SELECT nome, spreadsheet_id, aba_padrao, cabecalhos FROM planilhas WHERE conta_id=? ORDER BY nome').all(contaId).map(p => ({ nome: p.nome, aba_padrao: p.aba_padrao, cabecalhos: JSON.parse(p.cabecalhos || '[]'), link: link(p.spreadsheet_id) })); }
export function acharCadastrada(contaId, nome) {
  const n = String(nome || '').trim().toLowerCase(); const todas = db.prepare('SELECT * FROM planilhas WHERE conta_id=?').all(contaId);
  return todas.find(p => p.nome.toLowerCase() === n) || todas.find(p => p.nome.toLowerCase().includes(n) || n.includes(p.nome.toLowerCase())) || null;
}
async function info(contaId, spreadsheetId) {
  const r = await auth(contaId).spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' }).catch(e => { throw traduzErro(e); });
  return { titulo: r.data.properties.title, abas: r.data.sheets.map(s => s.properties.title) };
}
async function cabecalhos(contaId, spreadsheetId, aba) {
  const r = await auth(contaId).spreadsheets.values.get({ spreadsheetId, range: `'${aba}'!1:1` }).catch(e => { throw traduzErro(e); });
  return (r.data.values?.[0] || []).map(String);
}
/** Cadastra planilha existente pelo link; lê abas e cabeçalhos da primeira (ou da aba indicada). */
export async function cadastrar(contaId, { link_ou_id, nome, aba }) {
  const id = extrairId(link_ou_id); if (!id) throw new Error('Não reconheci o link da planilha.');
  const i = await info(contaId, id); const abaPadrao = aba && i.abas.includes(aba) ? aba : i.abas[0];
  const cab = await cabecalhos(contaId, id, abaPadrao);
  const nomeFinal = (nome || i.titulo).trim();
  db.prepare('INSERT INTO planilhas (conta_id, nome, spreadsheet_id, aba_padrao, cabecalhos) VALUES (?,?,?,?,?) ON CONFLICT(conta_id, nome) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id, aba_padrao=excluded.aba_padrao, cabecalhos=excluded.cabecalhos').run(contaId, nomeFinal, id, abaPadrao, JSON.stringify(cab));
  return { nome: nomeFinal, abas: i.abas, aba_padrao: abaPadrao, cabecalhos: cab, link: link(id) };
}
/** Cria planilha nova no Drive (na pasta raiz do Assessor se houver) com abas e cabeçalhos. */
export async function criar(contaId, { nome, abas = [{ nome: 'Lançamentos', cabecalhos: ['Data', 'Descrição', 'Categoria', 'Valor', 'Obs'] }] }) {
  const svc = auth(contaId);
  const r = await svc.spreadsheets.create({ requestBody: { properties: { title: nome, locale: 'pt_BR', timeZone: 'America/Sao_Paulo' }, sheets: abas.map(a => ({ properties: { title: a.nome } })) }, fields: 'spreadsheetId' }).catch(e => { throw traduzErro(e); });
  const id = r.data.spreadsheetId;
  for (const a of abas) if (a.cabecalhos?.length) await svc.spreadsheets.values.update({ spreadsheetId: id, range: `'${a.nome}'!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [a.cabecalhos] } });
  // negrito no cabeçalho + congelar linha 1
  try {
    const meta = await svc.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties' });
    const reqs = meta.data.sheets.flatMap(s => [{ repeatCell: { range: { sheetId: s.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.216, green: 0.255, blue: 0.306 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } }, { updateSheetProperties: { properties: { sheetId: s.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }]);
    await svc.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: reqs } });
  } catch {}
  try { const drive = await import('./google-drive.js'); const raiz = await drive.pastaRaiz(contaId); const pasta = await drive.obterOuCriarPasta(contaId, 'Planilhas', raiz); await drive.mover(contaId, id, pasta); } catch {}
  db.prepare('INSERT INTO planilhas (conta_id, nome, spreadsheet_id, aba_padrao, cabecalhos) VALUES (?,?,?,?,?) ON CONFLICT(conta_id, nome) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id, aba_padrao=excluded.aba_padrao, cabecalhos=excluded.cabecalhos').run(contaId, nome, id, abas[0].nome, JSON.stringify(abas[0].cabecalhos || []));
  return { nome, link: link(id), abas: abas.map(a => a.nome), cabecalhos: abas[0].cabecalhos };
}
function resolver(contaId, nome) { const p = acharCadastrada(contaId, nome); if (!p) throw new Error(`Planilha "${nome}" não cadastrada. Cadastradas: ${listarCadastradas(contaId).map(x => x.nome).join(', ') || 'nenhuma'}. Mande o link dela ou peça para criar.`); return p; }
/** Acrescenta linha(s). `linha` pode ser array (ordem das colunas) ou objeto {Coluna: valor} casado com o cabeçalho. */
export async function adicionarLinhas(contaId, { planilha, aba, linhas }) {
  const p = resolver(contaId, planilha); const ab = aba || p.aba_padrao;
  const cab = await cabecalhos(contaId, p.spreadsheet_id, ab);
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const values = linhas.map(l => Array.isArray(l) ? l : cab.map(c => { const k = Object.keys(l).find(k => norm(k) === norm(c)); return k != null ? l[k] : ''; }));
  const r = await auth(contaId).spreadsheets.values.append({ spreadsheetId: p.spreadsheet_id, range: `'${ab}'!A:A`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values } }).catch(e => { throw traduzErro(e); });
  const faixa = r.data.updates?.updatedRange || '';
  return { planilha: p.nome, aba: ab, linhas_adicionadas: values.length, onde: faixa, link: link(p.spreadsheet_id), cabecalhos: cab, ignorados: linhas.flatMap(l => Array.isArray(l) ? [] : Object.keys(l).filter(k => !cab.some(c => norm(c) === norm(k)))) };
}
export async function ler(contaId, { planilha, aba, intervalo, max = 50 }) {
  const p = resolver(contaId, planilha); const ab = aba || p.aba_padrao;
  const range = intervalo ? `'${ab}'!${intervalo}` : `'${ab}'`;
  const r = await auth(contaId).spreadsheets.values.get({ spreadsheetId: p.spreadsheet_id, range }).catch(e => { throw traduzErro(e); });
  const vals = r.data.values || []; const total = vals.length;
  return { planilha: p.nome, aba: ab, total_linhas: total, cabecalho: vals[0] || [], linhas: vals.slice(Math.max(1, total - max)), link: link(p.spreadsheet_id) };
}
export async function atualizarCelulas(contaId, { planilha, aba, intervalo, valores }) {
  const p = resolver(contaId, planilha); const ab = aba || p.aba_padrao;
  const r = await auth(contaId).spreadsheets.values.update({ spreadsheetId: p.spreadsheet_id, range: `'${ab}'!${intervalo}`, valueInputOption: 'USER_ENTERED', requestBody: { values: valores } }).catch(e => { throw traduzErro(e); });
  return { atualizado: r.data.updatedRange, celulas: r.data.updatedCells, link: link(p.spreadsheet_id) };
}
export async function abas(contaId, planilha) { const p = resolver(contaId, planilha); return { ...(await info(contaId, p.spreadsheet_id)), link: link(p.spreadsheet_id) }; }

/** Cria uma aba nova numa planilha cadastrada, com cabeçalho formatado (mesmo padrão de criar()). Se já existir, só informa. */
export async function criarAba(contaId, { planilha, aba, cabecalhos = [] }) {
  const p = resolver(contaId, planilha); const svc = auth(contaId); const nome = String(aba || '').trim().slice(0, 90);
  if (!nome) throw new Error('Informe o nome da aba.');
  const atual = await info(contaId, p.spreadsheet_id);
  if (atual.abas.some(a => a.toLowerCase() === nome.toLowerCase())) return { ok: true, ja_existia: true, aba: nome, abas: atual.abas, link: link(p.spreadsheet_id) };
  const r = await svc.spreadsheets.batchUpdate({ spreadsheetId: p.spreadsheet_id, requestBody: { requests: [{ addSheet: { properties: { title: nome, gridProperties: { frozenRowCount: cabecalhos.length ? 1 : 0 } } } }] } }).catch(e => { throw traduzErro(e); });
  const sheetId = r.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (cabecalhos.length) {
    await svc.spreadsheets.values.update({ spreadsheetId: p.spreadsheet_id, range: `'${nome}'!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [cabecalhos.map(String)] } }).catch(e => { throw traduzErro(e); });
    try { await svc.spreadsheets.batchUpdate({ spreadsheetId: p.spreadsheet_id, requestBody: { requests: [{ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.216, green: 0.255, blue: 0.306 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } }] } }); } catch {}
  }
  return { ok: true, aba: nome, cabecalhos, abas: [...atual.abas, nome], link: link(p.spreadsheet_id) };
}

/** Renomeia uma aba existente. */
export async function renomearAba(contaId, { planilha, aba, novo_nome }) {
  const p = resolver(contaId, planilha); const svc = auth(contaId);
  const meta = await svc.spreadsheets.get({ spreadsheetId: p.spreadsheet_id, fields: 'sheets.properties' }).catch(e => { throw traduzErro(e); });
  const s = meta.data.sheets.find(x => x.properties.title.toLowerCase() === String(aba || '').trim().toLowerCase());
  if (!s) throw new Error(`Aba "${aba}" não existe. Abas: ${meta.data.sheets.map(x => x.properties.title).join(', ')}`);
  const novo = String(novo_nome || '').trim().slice(0, 90); if (!novo) throw new Error('Informe o novo nome.');
  await svc.spreadsheets.batchUpdate({ spreadsheetId: p.spreadsheet_id, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: s.properties.sheetId, title: novo }, fields: 'title' } }] } }).catch(e => { throw traduzErro(e); });
  if (p.aba_padrao === s.properties.title) db.prepare('UPDATE planilhas SET aba_padrao=? WHERE id=?').run(novo, p.id);
  return { ok: true, de: s.properties.title, para: novo, link: link(p.spreadsheet_id) };
}
