// Base de clientes (CRM) + Campanhas por e-mail e Telegram, para o painel admin.
// Regras de envio (LGPD + Política de Privacidade do Fiel):
//  - tipo 'aviso'  (comunicado do serviço: manutenção, mudança de preço, nova função) → todos do público escolhido
//  - tipo 'oferta' (oferta, promoção, lançamento) → só contas com marketing_optin=1, e todo e-mail leva link de descadastro
import crypto from 'node:crypto';
import { db } from '../db/index.js';

export function prepararClientes() {
  for (const [c, def] of [['telefone', 'TEXT'], ['marketing_optin', 'INTEGER'], ['marketing_optin_em', 'TEXT'], ['descadastro_token', 'TEXT'], ['tags', 'TEXT'], ['notas', 'TEXT']]) { try { db.exec(`ALTER TABLE contas ADD COLUMN ${c} ${def}`); } catch {} }
  db.exec(`CREATE TABLE IF NOT EXISTS campanhas (
      id INTEGER PRIMARY KEY, titulo TEXT, assunto TEXT, texto TEXT NOT NULL, tipo TEXT NOT NULL, canais TEXT NOT NULL, filtro TEXT,
      status TEXT DEFAULT 'rascunho', total INTEGER DEFAULT 0, ok_email INTEGER DEFAULT 0, ok_telegram INTEGER DEFAULT 0, falhas INTEGER DEFAULT 0,
      admin_id INTEGER, criado_em TEXT DEFAULT CURRENT_TIMESTAMP, enviado_em TEXT, concluido_em TEXT);
    CREATE TABLE IF NOT EXISTS campanha_envios (id INTEGER PRIMARY KEY, campanha_id INTEGER, conta_id INTEGER, canal TEXT, destino TEXT, status TEXT, erro TEXT, enviado_em TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS ix_camp_envios ON campanha_envios (campanha_id)`);
  for (const [c, def] of [['botao_texto', 'TEXT'], ['botao_url', 'TEXT'], ['preheader', 'TEXT']]) { try { db.exec(`ALTER TABLE campanhas ADD COLUMN ${c} ${def}`); } catch {} }
}
prepararClientes();

const tokenDescadastro = (contaId) => {
  let t = db.prepare('SELECT descadastro_token FROM contas WHERE id=?').get(contaId)?.descadastro_token;
  if (!t) { t = crypto.randomBytes(16).toString('hex'); db.prepare('UPDATE contas SET descadastro_token=? WHERE id=?').run(t, contaId); }
  return t;
};
const base = () => (process.env.WEBAPP_URL || process.env.PUBLIC_URL || 'https://usefiel.com').replace(/\/$/, '');

/** Lista completa de clientes com dados de contato, plano, receita, uso e consentimento. */
export async function listarClientes({ q = '', filtro = '' } = {}) {
  let custos = {}; try { custos = (await import('../custos.js')).custoIAPorConta(); } catch {}
  const rows = db.prepare(`SELECT c.id, c.nome_dono, c.empresa, c.email, c.telefone, c.cpf_cnpj, c.plano, c.status, c.admin, c.criado_em,
      c.marketing_optin, c.marketing_optin_em, c.tags, c.notas, c.aceite_termos_em,
      (SELECT u.email FROM usuarios u WHERE u.conta_id=c.id AND u.papel='dono' AND u.email IS NOT NULL LIMIT 1) email_login,
      (SELECT u.chat_id FROM usuarios u WHERE u.conta_id=c.id AND u.canal='telegram' LIMIT 1) telegram_id,
      (SELECT COUNT(*) FROM usuarios u WHERE u.conta_id=c.id) usuarios,
      (SELECT COALESCE(SUM(valor),0) FROM cobrancas WHERE conta_id=c.id AND status='pago') total_pago,
      (SELECT COUNT(*) FROM cobrancas WHERE conta_id=c.id AND status='pago') compras,
      (SELECT MAX(pago_em) FROM cobrancas WHERE conta_id=c.id AND status='pago') ultima_compra,
      (SELECT COALESCE(SUM(quantidade),0) FROM creditos_mov WHERE conta_id=c.id) saldo,
      (SELECT MAX(criado_em) FROM interacoes WHERE conta_id=c.id) ultimo_uso
    FROM contas c ORDER BY c.id DESC`).all();
  let out = rows.map(r => ({ ...r, email: r.email || r.email_login || '', tem_telegram: !!r.telegram_id, custo_ia_brl: custos[r.id]?.total_brl || 0 }));
  const termo = String(q || '').toLowerCase().trim();
  if (termo) out = out.filter(r => `${r.nome_dono} ${r.empresa} ${r.email} ${r.telefone} ${r.cpf_cnpj} ${r.tags}`.toLowerCase().includes(termo));
  if (filtro) out = out.filter(r => passaFiltro(r, filtro));
  return out;
}

const dias = (s) => s ? (Date.now() - new Date(s.replace(' ', 'T') + 'Z').getTime()) / 864e5 : Infinity;
function passaFiltro(r, filtro) {
  switch (filtro) {
    case 'todas': return true;
    case 'ativas': return r.status === 'ativa';
    case 'trial': return r.plano === 'trial';
    case 'pagantes': return r.compras > 0;
    case 'nunca_pagou': return !r.compras && !r.admin;
    case 'mensal': return String(r.plano || '').startsWith('mensal');
    case 'bloqueadas': return r.status === 'bloqueada';
    case 'inativas': return dias(r.ultimo_uso) > 14;
    case 'com_telegram': return r.tem_telegram;
    case 'optin': return r.marketing_optin === 1;
    default: return filtro.startsWith('tag:') ? String(r.tags || '').toLowerCase().split(',').map(x => x.trim()).includes(filtro.slice(4).toLowerCase()) : true;
  }
}

/** Quem recebe uma campanha, por canal. Admin nunca entra no disparo em massa (recebe só o teste). */
export async function publico({ filtro = 'ativas', tipo = 'aviso', canais = ['email', 'telegram'] } = {}) {
  const todos = (await listarClientes({ filtro })).filter(r => !r.admin && r.status !== 'suspensa');
  const elegiveis = tipo === 'oferta' ? todos.filter(r => r.marketing_optin === 1) : todos;
  const email = canais.includes('email') ? elegiveis.filter(r => /@/.test(r.email)) : [];
  const telegram = canais.includes('telegram') ? elegiveis.filter(r => r.tem_telegram) : [];
  return { total_publico: todos.length, sem_consentimento: todos.length - elegiveis.length, email, telegram };
}

const personalizar = (t, r) => String(t || '').replace(/\{nome\}/g, (r.nome_dono || '').split(' ')[0] || 'olá').replace(/\{empresa\}/g, r.empresa || '');
const paraHtml = (t) => String(t).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  .replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#E85D4A">$1</a>')
  .split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, '<br>')}</p>`).join('');

/** Monta o e-mail de campanha (HTML + texto) — usado no envio real, no teste e na pré-visualização do admin. */
export async function montarEmailCampanha(camp, r) {
  const { moldura } = await import('../integracoes/email.js');
  const texto = personalizar(camp.texto, r);
  const desc = camp.tipo === 'oferta' && r.id ? `${base()}/descadastrar?t=${tokenDescadastro(r.id)}` : (camp.tipo === 'oferta' ? `${base()}/descadastrar` : null);
  const nota = desc ? `Você recebe ofertas do Fiel porque aceitou no cadastro. <a href="${desc}" style="color:#E4DFF2">Não quero mais receber</a>.` : 'Comunicado sobre o serviço Fiel que você usa.';
  const botao = camp.botao_texto && camp.botao_url ? { texto: personalizar(camp.botao_texto, r), url: camp.botao_url } : null;
  const assunto = personalizar(camp.assunto || camp.titulo || 'Novidade do Fiel', r);
  const html = moldura({ titulo: personalizar(camp.titulo || '', r), corpoHtml: paraHtml(texto), nota, botao, preheader: personalizar(camp.preheader || texto.replace(/\s+/g, ' ').slice(0, 110), r) });
  const txt = texto + (botao ? `\n\n${botao.texto}: ${botao.url}` : '') + (desc ? `\n\n—\nPara não receber mais ofertas: ${desc}` : '') + '\n\nFiel · Delegue. Fiel resolve. · usefiel.com';
  return { assunto, html, texto: txt };
}
async function enviarEmailCliente(camp, r) {
  const { enviarEmail } = await import('../integracoes/email.js');
  const m = await montarEmailCampanha(camp, r);
  await enviarEmail({ para: r.email, assunto: m.assunto, texto: m.texto, html: m.html });
}
async function enviarTelegramCliente(camp, r) {
  const { canalAtual } = await import('./atual.js'); const c = canalAtual(); if (!c) throw new Error('canal indisponível');
  const msg = `📣 *Fiel*${camp.titulo ? ` — ${personalizar(camp.titulo, r)}` : ''}\n\n${personalizar(camp.texto, r)}${camp.botao_texto && camp.botao_url ? `\n\n👉 ${personalizar(camp.botao_texto, r)}: ${camp.botao_url}` : ''}${camp.tipo === 'oferta' ? '\n\n_Para não receber ofertas, responda "parar ofertas"._' : ''}`;
  await c.enviar(null, r.telegram_id, msg); // hub: entra também no histórico do app web
}

const pausa = (ms) => new Promise(r => setTimeout(r, ms));
/** Dispara a campanha em segundo plano, com ritmo seguro (e-mail ~3/s, Telegram ~20/s), e grava cada envio. */
export async function dispararCampanha(id) {
  const camp = db.prepare('SELECT * FROM campanhas WHERE id=?').get(id); if (!camp) throw new Error('campanha não encontrada');
  const canais = camp.canais.split(','); const pub = await publico({ filtro: camp.filtro, tipo: camp.tipo, canais });
  db.prepare("UPDATE campanhas SET status='enviando', enviado_em=CURRENT_TIMESTAMP, total=? WHERE id=?").run(pub.email.length + pub.telegram.length, id);
  const reg = db.prepare('INSERT INTO campanha_envios (campanha_id, conta_id, canal, destino, status, erro) VALUES (?,?,?,?,?,?)');
  const conta = (campo) => db.prepare(`UPDATE campanhas SET ${campo}=${campo}+1 WHERE id=?`).run(id);
  (async () => {
    for (const r of pub.email) { try { await enviarEmailCliente(camp, r); reg.run(id, r.id, 'email', r.email, 'ok', null); conta('ok_email'); } catch (e) { reg.run(id, r.id, 'email', r.email, 'falha', String(e.message).slice(0, 200)); conta('falhas'); } await pausa(350); }
    for (const r of pub.telegram) { try { await enviarTelegramCliente(camp, r); reg.run(id, r.id, 'telegram', r.telegram_id, 'ok', null); conta('ok_telegram'); } catch (e) { reg.run(id, r.id, 'telegram', r.telegram_id, 'falha', String(e.message).slice(0, 200)); conta('falhas'); } await pausa(60); }
    db.prepare("UPDATE campanhas SET status='concluida', concluido_em=CURRENT_TIMESTAMP WHERE id=?").run(id);
  })().catch(e => { console.error('[campanha]', id, e.message); db.prepare("UPDATE campanhas SET status='erro' WHERE id=?").run(id); });
}

const toCSV = (rows, cols) => [cols.join(';'), ...rows.map(r => cols.map(k => { const v = r[k]; if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return /[;"\n,]/.test(s) ? `"${s}"` : s; }).join(';'))].join('\n');

export function rotasClientes(app, auth, logAdmin) {
  app.get('/api/admin/clientes', auth, async (req, res) => res.json(await listarClientes({ q: req.query.q, filtro: req.query.filtro })));
  app.get('/api/admin/clientes.csv', auth, async (req, res) => {
    const rows = await listarClientes({ q: req.query.q, filtro: req.query.filtro });
    const cols = ['id', 'nome_dono', 'empresa', 'email', 'telefone', 'cpf_cnpj', 'plano', 'status', 'criado_em', 'ultimo_uso', 'compras', 'total_pago', 'ultima_compra', 'saldo', 'custo_ia_brl', 'tem_telegram', 'marketing_optin', 'marketing_optin_em', 'tags', 'notas'];
    logAdmin(req.contaId, 'clientes.exportar', null, { filtro: req.query.filtro || '', total: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="clientes-fiel-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + toCSV(rows, cols));
  });
  app.post('/api/admin/clientes/:id', auth, (req, res) => {
    const b = req.body || {}; const id = Number(req.params.id); const sets = []; const vals = [];
    for (const k of ['telefone', 'tags', 'notas', 'empresa', 'email']) if (k in b) { sets.push(`${k}=?`); vals.push(String(b[k] ?? '').trim().slice(0, k === 'notas' ? 2000 : 200) || null); }
    if ('marketing_optin' in b) { sets.push('marketing_optin=?', "marketing_optin_em=CURRENT_TIMESTAMP"); vals.push(b.marketing_optin ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ erro: 'nada para salvar' });
    db.prepare(`UPDATE contas SET ${sets.join(', ')} WHERE id=?`).run(...vals, id); logAdmin(req.contaId, 'cliente.editar', id, b); res.json({ ok: true });
  });

  app.post('/api/admin/campanhas/previa', auth, async (req, res) => {
    const b = req.body || {}; const canais = [].concat(b.canais || []); const p = await publico({ filtro: b.filtro, tipo: b.tipo, canais });
    let smtp = false; try { smtp = (await import('../integracoes/email.js')).emailConfigurado(); } catch {}
    res.json({ total_publico: p.total_publico, sem_consentimento: p.sem_consentimento, email: p.email.length, telegram: p.telegram.length, smtp });
  });
  app.post('/api/admin/campanhas/render', auth, async (req, res) => {
    const b = req.body || {}; const exemplo = { id: 0, nome_dono: 'Maria Souza', empresa: 'Ateliê Exemplo' };
    const camp = { titulo: b.titulo, assunto: b.assunto, texto: b.texto || 'Escreva a mensagem ao lado para ver a prévia.', tipo: b.tipo, botao_texto: b.botao_texto, botao_url: b.botao_url, preheader: b.preheader };
    const m = await montarEmailCampanha(camp, exemplo);
    const tg = `📣 *Fiel*${camp.titulo ? ` — ${personalizar(camp.titulo, exemplo)}` : ''}\n\n${personalizar(camp.texto, exemplo)}${camp.botao_texto && camp.botao_url ? `\n\n👉 ${personalizar(camp.botao_texto, exemplo)}: ${camp.botao_url}` : ''}${camp.tipo === 'oferta' ? '\n\n_Para não receber ofertas, responda "parar ofertas"._' : ''}`;
    res.json({ assunto: m.assunto, html: m.html, telegram: tg });
  });
  app.post('/api/admin/campanhas/teste', auth, async (req, res) => {
    const b = req.body || {}; const canais = [].concat(b.canais || []);
    const eu = (await listarClientes()).find(r => r.id === req.contaId); if (!eu) return res.status(400).json({ erro: 'conta admin não encontrada' });
    const camp = { titulo: b.titulo, assunto: `[TESTE] ${b.assunto || b.titulo || ''}`, texto: b.texto, tipo: b.tipo, botao_texto: b.botao_texto, botao_url: b.botao_url, preheader: b.preheader };
    const r = { email: null, telegram: null };
    if (canais.includes('email')) { try { if (!eu.email) throw new Error('sua conta não tem e-mail'); await enviarEmailCliente(camp, eu); r.email = `ok → ${eu.email}`; } catch (e) { r.email = 'falhou: ' + e.message; } }
    if (canais.includes('telegram')) { try { if (!eu.tem_telegram) throw new Error('sua conta não tem Telegram vinculado'); await enviarTelegramCliente(camp, eu); r.telegram = 'ok'; } catch (e) { r.telegram = 'falhou: ' + e.message; } }
    res.json({ ok: true, ...r });
  });
  app.post('/api/admin/campanhas', auth, async (req, res) => {
    const b = req.body || {}; const canais = [].concat(b.canais || []).filter(c => ['email', 'telegram'].includes(c));
    if (!b.texto || String(b.texto).trim().length < 3) return res.status(400).json({ erro: 'escreva a mensagem' });
    if (!canais.length) return res.status(400).json({ erro: 'escolha ao menos um canal' });
    if (canais.includes('email') && !b.assunto) return res.status(400).json({ erro: 'e-mail precisa de assunto' });
    const tipo = b.tipo === 'oferta' ? 'oferta' : 'aviso';
    if ((b.botao_texto && !b.botao_url) || (!b.botao_texto && b.botao_url)) return res.status(400).json({ erro: 'botão precisa de texto e link' });
    const id = Number(db.prepare('INSERT INTO campanhas (titulo, assunto, texto, tipo, canais, filtro, admin_id, botao_texto, botao_url, preheader) VALUES (?,?,?,?,?,?,?,?,?,?)').run(b.titulo || null, b.assunto || null, String(b.texto), tipo, canais.join(','), b.filtro || 'ativas', req.contaId, b.botao_texto || null, b.botao_url || null, b.preheader || null).lastInsertRowid);
    await dispararCampanha(id); logAdmin(req.contaId, 'campanha.enviar', id, { tipo, canais, filtro: b.filtro });
    res.json({ ok: true, id, ...db.prepare('SELECT total FROM campanhas WHERE id=?').get(id) });
  });
  app.get('/api/admin/campanhas', auth, (req, res) => res.json(db.prepare('SELECT * FROM campanhas ORDER BY id DESC LIMIT 100').all()));
  app.get('/api/admin/campanhas/:id/envios', auth, (req, res) => res.json(db.prepare('SELECT e.*, c.nome_dono, c.empresa FROM campanha_envios e LEFT JOIN contas c ON c.id=e.conta_id WHERE campanha_id=? ORDER BY e.id').all(Number(req.params.id))));

  // Descadastro público (link no rodapé dos e-mails de oferta)
  app.get('/descadastrar', (req, res) => {
    const t = String(req.query.t || ''); const c = t && db.prepare('SELECT id, nome_dono FROM contas WHERE descadastro_token=?').get(t);
    if (c) db.prepare('UPDATE contas SET marketing_optin=0, marketing_optin_em=CURRENT_TIMESTAMP WHERE id=?').run(c.id);
    res.set('Cache-Control', 'no-store').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fiel · descadastro</title><body style="margin:0;background:#FAF5EC;font-family:Inter,-apple-system,Arial,sans-serif;color:#1C1E26;display:grid;place-items:center;min-height:100vh;padding:16px"><div style="max-width:420px;background:#fff;border:1px solid rgba(28,30,38,.12);border-radius:14px;padding:28px 24px;text-align:center"><div style="font-family:Georgia,serif;font-size:26px;color:#E85D4A;margin-bottom:12px">fiel</div>${c ? `<h1 style="font-family:Georgia,serif;font-weight:400;font-size:22px">Pronto, ${(c.nome_dono || '').split(' ')[0]}.</h1><p>Você não vai mais receber ofertas e lançamentos do Fiel. Comunicados importantes sobre a sua conta continuam chegando.</p>` : '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:22px">Link inválido</h1><p>Se quiser parar de receber ofertas, escreva para <a href="mailto:ola@usefiel.com">ola@usefiel.com</a>.</p>'}<p style="margin-top:18px"><a href="/app" style="color:#E85D4A">Voltar ao Fiel</a></p></div></body>`);
  });
}
