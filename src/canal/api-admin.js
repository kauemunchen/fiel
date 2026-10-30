// Painel administrativo do Fiel (/admin): contas, créditos manuais, pacotes/preços, financeiro.
// Auth: a mesma sessão web, mas restrita a contas com admin=1 (ou plano='ilimitado').
import { db } from '../db/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { sessao } from './web.js';
import { PACOTES as PACOTES_PADRAO, TARIFAS, TRIAL_CREDITOS, PRODUTO, saldo, creditar, debitar, ilimitada } from '../creditos/index.js';

db.exec(`CREATE TABLE IF NOT EXISTS pacotes_cfg (id TEXT PRIMARY KEY, nome TEXT, creditos INTEGER, preco REAL, tipo TEXT, ativo INTEGER DEFAULT 1, ordem INTEGER DEFAULT 0)`);
// Semeia uma vez com os defaults
if (!db.prepare('SELECT COUNT(*) n FROM pacotes_cfg').get().n) { const ins = db.prepare('INSERT INTO pacotes_cfg (id, nome, creditos, preco, tipo, ordem) VALUES (?,?,?,?,?,?)'); PACOTES_PADRAO.forEach((p, i) => ins.run(p.id, p.nome, p.creditos, p.preco, p.tipo, i)); }
/** Lista oficial de pacotes (lida do banco). Substitui PACOTES_PADRAO em runtime. */
export function pacotesAtivos() { return db.prepare('SELECT id, nome, creditos, preco, tipo FROM pacotes_cfg WHERE ativo=1 ORDER BY ordem, id').all(); }


db.exec(`CREATE TABLE IF NOT EXISTS logs_admin (id INTEGER PRIMARY KEY, admin_id INTEGER, acao TEXT, alvo TEXT, detalhes TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
function logAdmin(adminId, acao, alvo = null, detalhes = null) { try { db.prepare('INSERT INTO logs_admin (admin_id, acao, alvo, detalhes) VALUES (?,?,?,?)').run(adminId, acao, alvo && String(alvo), detalhes && JSON.stringify(detalhes)); } catch {} }
function toCSV(rows) { if (!rows.length) return ''; const cols = Object.keys(rows[0]); const esc = (v) => { if (v === null || v === undefined) return ''; const s = String(v).replace(/"/g, '""'); return /[,"\n;]/.test(s) ? `"${s}"` : s; }; return cols.join(';') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(';')).join('\n'); }

export function rotasAdmin(app) {
  const auth = (req, res, next) => {
    const s = sessao(req); if (!s) return res.status(401).json({ erro: 'não autenticado' });
    const c = db.prepare('SELECT admin, plano FROM contas WHERE id=?').get(s.conta_id);
    if (!c || !(c.admin === 1 || c.plano === 'ilimitado')) return res.status(403).json({ erro: 'acesso restrito ao administrador do Fiel' });
    req.contaId = s.conta_id; next();
  };

  import('./api-clientes.js').then(m => m.rotasClientes(app, auth, logAdmin)).catch(e => console.error('[admin] clientes', e.message));

  // Painel inicial — números e séries dos últimos 30 dias
  app.get('/api/admin/resumo', auth, (req, res) => {
    const q = (sql, ...a) => db.prepare(sql).get(...a); const l = (sql, ...a) => db.prepare(sql).all(...a);
    const contas = q("SELECT COUNT(*) total, SUM(status='ativa') ativas, SUM(status='bloqueada') bloqueadas, SUM(status='suspensa') suspensas, SUM(plano='trial') em_trial, SUM(plano LIKE 'mensal_%') em_plano FROM contas");
    const novas = l("SELECT date(criado_em) d, COUNT(*) n FROM contas WHERE criado_em >= datetime('now','-30 days') GROUP BY d ORDER BY d");
    const faturamento = q("SELECT COALESCE(SUM(valor), 0) bruto, COUNT(*) n FROM cobrancas WHERE status='pago' AND pago_em >= datetime('now','-30 days')");
    const faturamentoHoje = q("SELECT COALESCE(SUM(valor), 0) bruto, COUNT(*) n FROM cobrancas WHERE status='pago' AND date(pago_em)=date('now','localtime')");
    const pendente = q("SELECT COALESCE(SUM(valor), 0) bruto, COUNT(*) n FROM cobrancas WHERE status='pendente'");
    const porDia = l("SELECT date(pago_em) d, SUM(valor) r FROM cobrancas WHERE status='pago' AND pago_em >= datetime('now','-30 days') GROUP BY d ORDER BY d");
    const assinaturas = q("SELECT COUNT(*) ativas, SUM(valor) mrr FROM assinaturas WHERE status='ativa'");
    const creditos = q("SELECT COALESCE(SUM(CASE WHEN quantidade>0 THEN quantidade END),0) emitidos, COALESCE(-SUM(CASE WHEN quantidade<0 THEN quantidade END),0) consumidos FROM creditos_mov WHERE criado_em >= datetime('now','-30 days')");
    const uso = q("SELECT COUNT(*) chamadas, COALESCE(SUM(tokens_in+tokens_out),0) tokens FROM uso WHERE criado_em >= datetime('now','-30 days')");
    const porModulo = l("SELECT modulo, COUNT(*) chamadas, SUM(tokens_in+tokens_out) tokens FROM uso WHERE criado_em >= datetime('now','-30 days') GROUP BY modulo ORDER BY tokens DESC");
    const topGasto = l("SELECT c.id, c.nome_dono, c.empresa, -SUM(cm.quantidade) gasto FROM creditos_mov cm JOIN contas c ON c.id=cm.conta_id WHERE cm.quantidade<0 AND cm.criado_em>=datetime('now','-30 days') GROUP BY c.id ORDER BY gasto DESC LIMIT 10");
    res.json({ produto: PRODUTO, contas, novas, faturamento_30d: faturamento, faturamento_hoje: faturamentoHoje, pendente, por_dia: porDia, assinaturas, creditos_30d: creditos, uso_30d: uso, por_modulo: porModulo, top_gasto: topGasto });
  });

  // Lista completa de contas
  app.get('/api/admin/contas', auth, async (req, res) => {
    let custos = {}; try { custos = (await import('../custos.js')).custoIAPorConta(); } catch (e) { console.error('[admin] custoIAPorConta', e.message); }
    const q = String(req.query.q || '').toLowerCase(); const filtro = req.query.filtro || '';
    let sql = `SELECT c.id, c.nome_dono, c.empresa, c.plano, c.status, c.admin, c.pesquisa_web, c.email, c.cpf_cnpj, c.criado_em,
      (SELECT COALESCE(SUM(quantidade),0) FROM creditos_mov WHERE conta_id=c.id) saldo,
      (SELECT COALESCE(-SUM(quantidade),0) FROM creditos_mov WHERE conta_id=c.id AND quantidade<0 AND criado_em>=datetime('now','-30 days')) gasto_30d,
      (SELECT MAX(criado_em) FROM interacoes WHERE conta_id=c.id) ultimo_uso,
      (SELECT chat_id FROM usuarios WHERE conta_id=c.id AND papel='dono' LIMIT 1) chat_id
      FROM contas c`;
    const cond = []; const args = [];
    if (filtro === 'ativas') cond.push("c.status='ativa'"); else if (filtro === 'bloqueadas') cond.push("c.status='bloqueada'"); else if (filtro === 'trial') cond.push("c.plano='trial'"); else if (filtro === 'mensal') cond.push("c.plano LIKE 'mensal_%'"); else if (filtro === 'inativas') cond.push("(SELECT MAX(criado_em) FROM interacoes WHERE conta_id=c.id) < datetime('now','-14 days')");
    if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY c.id DESC LIMIT 500';
    let rows = db.prepare(sql).all(...args);
    if (q) rows = rows.filter(c => `${c.nome_dono} ${c.empresa} ${c.email} ${c.cpf_cnpj}`.toLowerCase().includes(q));
    for (const r of rows) { const k = custos[r.id] || {}; r.custo_ia_brl = k.total_brl || 0; r.custo_ia_30d_brl = k.d30_brl || 0; r.custo_gemini_brl = k.ia_brl || 0; r.custo_fal_brl = k.fal_brl || 0; r.tokens_total = k.tokens || 0; r.imagens_fal = k.imagens || 0; }
    res.json(rows);
  });

  // Detalhe de uma conta
  app.get('/api/admin/conta/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM contas WHERE id=?').get(id); if (!c) return res.status(404).json({ erro: 'não existe' });
    const movs = db.prepare('SELECT id, tipo, quantidade, motivo, modulo, ref, criado_em FROM creditos_mov WHERE conta_id=? ORDER BY id DESC LIMIT 100').all(id);
    const cobs = db.prepare('SELECT asaas_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, vencimento, pago_em, criado_em FROM cobrancas WHERE conta_id=? ORDER BY id DESC LIMIT 50').all(id);
    const assin = db.prepare("SELECT asaas_id, pacote_id, valor, status, proxima, criado_em, cancelada_em FROM assinaturas WHERE conta_id=? ORDER BY id DESC").all(id);
    const usuarios = db.prepare('SELECT id, nome, papel, chat_id, canal FROM usuarios WHERE conta_id=?').all(id);
    const uso = db.prepare("SELECT modulo, COUNT(*) chamadas, SUM(tokens_in+tokens_out) tokens FROM uso WHERE conta_id=? AND criado_em>=datetime('now','-30 days') GROUP BY modulo ORDER BY tokens DESC").all(id);
    res.json({ conta: c, saldo: saldo(id), ilimitada: ilimitada(id), movimentos: movs, cobrancas: cobs, assinaturas: assin, usuarios, uso_30d: uso });
  });

  // Crédito/débito manual
  app.post('/api/admin/conta/:id/creditos', auth, (req, res) => {
    const id = Number(req.params.id); const { operacao, quantidade, motivo = '' } = req.body || {};
    const q = Math.abs(Number(quantidade)); if (!(q > 0) || !['credito', 'debito'].includes(operacao)) return res.status(400).json({ erro: 'operação inválida' });
    const ref = `admin:${req.contaId}`;
    logAdmin(req.contaId, 'creditos', id, { operacao, quantidade: q, motivo });
    if (operacao === 'credito') creditar(id, q, { tipo: 'ajuste', motivo: motivo || 'ajuste manual (+)', ref });
    else db.prepare('INSERT INTO creditos_mov (conta_id, tipo, quantidade, motivo, ref) VALUES (?,?,?,?,?)').run(id, 'ajuste', -q, motivo || 'ajuste manual (-)', ref);
    res.json({ ok: true, saldo: saldo(id) });
  });

  // Mudar status/plano/admin
  app.post('/api/admin/conta/:id', auth, (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    logAdmin(req.contaId, 'conta', id, b);
    if (b.status && ['ativa', 'bloqueada', 'suspensa'].includes(b.status)) db.prepare('UPDATE contas SET status=? WHERE id=?').run(b.status, id);
    if (b.plano) db.prepare('UPDATE contas SET plano=? WHERE id=?').run(b.plano, id);
    if (b.admin !== undefined) {
      if (!b.admin && id === req.contaId) return res.status(400).json({ erro: 'você não pode remover seu próprio acesso de admin' });
      db.prepare('UPDATE contas SET admin=? WHERE id=?').run(b.admin ? 1 : 0, id);
    }
    if (b.pesquisa_web !== undefined) db.prepare('UPDATE contas SET pesquisa_web=? WHERE id=?').run(b.pesquisa_web ? 1 : 0, id);
    res.json({ ok: true });
  });

  // Pacotes & preços
  app.get('/api/admin/pacotes', auth, (req, res) => res.json({ pacotes: db.prepare('SELECT * FROM pacotes_cfg ORDER BY ordem, id').all(), tarifas: TARIFAS, trial: TRIAL_CREDITOS }));
  app.post('/api/admin/pacotes/:id', auth, (req, res) => {
    const { nome, creditos, preco, tipo, ativo, ordem } = req.body || {};
    const atual = db.prepare('SELECT * FROM pacotes_cfg WHERE id=?').get(req.params.id);
    if (atual) db.prepare('UPDATE pacotes_cfg SET nome=?, creditos=?, preco=?, tipo=?, ativo=?, ordem=? WHERE id=?').run(nome ?? atual.nome, creditos ?? atual.creditos, preco ?? atual.preco, tipo ?? atual.tipo, ativo === undefined ? atual.ativo : (ativo ? 1 : 0), ordem ?? atual.ordem, req.params.id);
    else db.prepare('INSERT INTO pacotes_cfg (id, nome, creditos, preco, tipo, ativo, ordem) VALUES (?,?,?,?,?,?,?)').run(req.params.id, nome, Number(creditos), Number(preco), tipo || 'prepago', ativo === false ? 0 : 1, Number(ordem || 99));
    res.json({ ok: true });
  });
  app.delete('/api/admin/pacotes/:id', auth, (req, res) => { db.prepare('DELETE FROM pacotes_cfg WHERE id=?').run(req.params.id); logAdmin(req.contaId, 'pacote.delete', req.params.id); res.json({ ok: true }); });

  // Financeiro: cobranças (todas as contas)
  app.get('/api/admin/financeiro', auth, (req, res) => {
    const status = req.query.status || null;
    const rows = db.prepare(`SELECT cb.id, cb.asaas_id, cb.tipo, cb.pacote_id, cb.valor, cb.creditos, cb.forma, cb.status, cb.vencimento, cb.pago_em, cb.criado_em, cb.invoice_url, c.id conta_id, c.nome_dono, c.empresa FROM cobrancas cb JOIN contas c ON c.id=cb.conta_id ${status ? "WHERE cb.status=?" : ''} ORDER BY cb.id DESC LIMIT 500`).all(...(status ? [status] : []));
    const mes = db.prepare("SELECT strftime('%Y-%m', pago_em) m, SUM(valor) r, COUNT(*) n FROM cobrancas WHERE status='pago' GROUP BY m ORDER BY m DESC LIMIT 12").all();
    res.json({ cobrancas: rows, por_mes: mes });
  });

  // Broadcast rápido para todos os donos (Telegram): aviso de manutenção, feature nova, etc.
  app.post('/api/admin/broadcast', auth, async (req, res) => {
    const { texto, filtro = 'ativas' } = req.body || {}; if (!texto || texto.length < 3) return res.status(400).json({ erro: 'texto curto demais' });
    const cond = filtro === 'todas' ? '' : filtro === 'trial' ? "AND c.plano='trial'" : filtro === 'bloqueadas' ? "AND c.status='bloqueada'" : "AND c.status='ativa'";
    const donos = db.prepare(`SELECT u.chat_id FROM usuarios u JOIN contas c ON c.id=u.conta_id WHERE u.papel='dono' AND u.canal='telegram' ${cond}`).all();
    const canal = (await import('./atual.js')).canalAtual();
    let enviados = 0; for (const d of donos) { try { await canal.enviar(null, d.chat_id, `📣 *Fiel* — ${texto}`); enviados++; } catch {} }
    res.json({ ok: true, enviados, total: donos.length });
  });
  // ---------- Custos: quanto você paga de IA + MP + VPS, e qual sua margem ----------
  app.get('/api/admin/custos', auth, async (req, res) => {
    const { resumo, margemPacotes } = await import('../custos.js');
    const { limiteMargem } = await import('../creditos/index.js');
    const dias = Number(req.query.dias || 30);
    const geral = resumo({ dias }); const admin = resumo({ contaId: req.contaId, dias });
    const margens = await margemPacotes();
    const matriz = await (await import('../custos.js')).matrizCustos();
    // Contas bloqueadas pelo piso de margem (ou com consumo acima de 90% do limite — alerta amarelo)
    const todas = db.prepare("SELECT id, nome_dono, empresa, plano, status, bloqueada_margem_em FROM contas WHERE admin=0 AND plano<>'ilimitado' AND status<>'suspensa'").all();
    const limites = []; let bloqueadas = 0; let alerta = 0;
    for (const c of todas) { const lm = limiteMargem(c.id); if (!lm.aplicavel) continue; if (lm.bloqueado || lm.pct_do_limite >= 90) { limites.push({ ...c, ...lm }); if (lm.bloqueado) bloqueadas++; else alerta++; } }
    limites.sort((a, b) => (b.pct_do_limite || 0) - (a.pct_do_limite || 0));
    const fixos = (await import('../custos.js')).listarCustosFixos();
    res.json({ geral, admin, margens, matriz, fixos, admin_conta: db.prepare('SELECT nome_dono, plano, admin FROM contas WHERE id=?').get(req.contaId), piso: { bloqueadas, alerta, contas: limites.slice(0, 50) } });
  });
  // Custos fixos mensais detalhados
  app.get('/api/admin/custos-fixos', auth, async (req, res) => res.json((await import('../custos.js')).listarCustosFixos()));
  app.post('/api/admin/custos-fixos', auth, async (req, res) => {
    try { const { salvarCustoFixo, listarCustosFixos } = await import('../custos.js'); const id = salvarCustoFixo(req.body || {}); logAdmin(req.contaId, 'custo_fixo.salvar', String(id), req.body); res.json({ ok: true, id, ...listarCustosFixos() }); }
    catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.delete('/api/admin/custos-fixos/:id', auth, async (req, res) => { const { removerCustoFixo, listarCustosFixos } = await import('../custos.js'); removerCustoFixo(Number(req.params.id)); logAdmin(req.contaId, 'custo_fixo.remover', req.params.id); res.json({ ok: true, ...listarCustosFixos() }); });
  app.post('/api/admin/custos/resetar', auth, async (req, res) => { const { PRECOS_PADRAO, definirPreco } = await import('../custos.js'); for (const [k, v] of Object.entries(PRECOS_PADRAO)) definirPreco(k, v); logAdmin(req.contaId, 'custos.resetar'); res.json({ ok: true }); });
  app.post('/api/admin/custos/preco', auth, async (req, res) => { const { definirPreco } = await import('../custos.js'); const b = req.body || {}; if (!b.chave) return res.status(400).json({ erro: 'chave?' }); definirPreco(b.chave, b.valor); logAdmin(req.contaId, 'custos.preco', b.chave, { valor: b.valor }); res.json({ ok: true }); });

  // ---------- Operação (etapa E): logs, exportação, backup, limpeza, métricas ----------
  app.get('/api/admin/logs', auth, (req, res) => res.json(db.prepare('SELECT l.*, c.nome_dono admin_nome FROM logs_admin l LEFT JOIN contas c ON c.id=l.admin_id ORDER BY l.id DESC LIMIT 200').all()));

  app.get('/api/admin/exportar/:tipo.csv', auth, (req, res) => {
    const t = req.params.tipo; let rows = [];
    if (t === 'contas') rows = db.prepare(`SELECT c.id, c.nome_dono, c.empresa, c.email, c.cpf_cnpj, c.plano, c.status, c.admin, c.criado_em, (SELECT COALESCE(SUM(quantidade),0) FROM creditos_mov WHERE conta_id=c.id) saldo, (SELECT MAX(criado_em) FROM interacoes WHERE conta_id=c.id) ultimo_uso FROM contas c ORDER BY c.id`).all();
    else if (t === 'cobrancas') rows = db.prepare(`SELECT cb.id, c.nome_dono, c.empresa, cb.asaas_id, cb.pacote_id, cb.tipo, cb.valor, cb.creditos, cb.forma, cb.status, cb.criado_em, cb.pago_em, cb.vencimento FROM cobrancas cb JOIN contas c ON c.id=cb.conta_id ORDER BY cb.id DESC`).all();
    else if (t === 'creditos') rows = db.prepare(`SELECT cm.id, c.nome_dono, c.empresa, cm.tipo, cm.quantidade, cm.motivo, cm.modulo, cm.ref, cm.criado_em FROM creditos_mov cm JOIN contas c ON c.id=cm.conta_id ORDER BY cm.id DESC`).all();
    else if (t === 'uso') rows = db.prepare(`SELECT u.id, c.nome_dono, u.modulo, u.modelo, u.tokens_in, u.tokens_out, u.criado_em FROM uso u JOIN contas c ON c.id=u.conta_id ORDER BY u.id DESC LIMIT 20000`).all();
    else return res.status(400).json({ erro: 'tipo inválido' });
    logAdmin(req.contaId, 'exportar.' + t, null, { linhas: rows.length });
    res.setHeader('content-type', 'text/csv; charset=utf-8'); res.setHeader('content-disposition', `attachment; filename="km-app-${t}-${new Date().toISOString().slice(0, 10)}.csv"`); res.send('﻿' + toCSV(rows));
  });

  // Backups: listar, gerar agora, baixar
  const BK = () => 'backups';
  app.get('/api/admin/backups', auth, (req, res) => { try { if (!fs.existsSync(BK())) return res.json([]); res.json(fs.readdirSync(BK()).filter(f => f.endsWith('.tar.gz')).sort().reverse().slice(0, 50).map(f => ({ nome: f, mb: +(fs.statSync(path.join(BK(), f)).size / 1048576).toFixed(2), em: fs.statSync(path.join(BK(), f)).mtime.toISOString() }))); } catch (e) { res.status(500).json({ erro: e.message }); } });
  app.post('/api/admin/backup', auth, async (req, res) => {
    const { exec } = await import('node:child_process');
    logAdmin(req.contaId, 'backup.rodar');
    exec('bash scripts/backup.sh', { timeout: 180000 }, (err, out) => { if (err) return res.status(500).json({ erro: err.message, saida: out }); res.json({ ok: true, saida: out.trim().split('\n').slice(-5) }); });
  });
  app.get('/api/admin/backup/:nome', auth, (req, res) => { const p = path.join(BK(), path.basename(req.params.nome)); if (!fs.existsSync(p)) return res.status(404).json({ erro: 'não existe' }); logAdmin(req.contaId, 'backup.baixar', req.params.nome); res.download(p); });
  app.delete('/api/admin/backup/:nome', auth, (req, res) => { const p = path.join(BK(), path.basename(req.params.nome)); if (fs.existsSync(p)) fs.unlinkSync(p); logAdmin(req.contaId, 'backup.apagar', req.params.nome); res.json({ ok: true }); });

  // Limpeza / contas inativas: configuração + preview + aplicar (marca status='inativa', opcionalmente apaga após X dias)
  app.get('/api/admin/limpeza', auth, (req, res) => {
    const diasInativa = Number(req.query.dias || 60);
    const candidatas = db.prepare(`SELECT c.id, c.nome_dono, c.empresa, c.plano, c.status, c.criado_em,
      (SELECT MAX(criado_em) FROM interacoes WHERE conta_id=c.id) ultimo_uso,
      (SELECT COALESCE(SUM(quantidade),0) FROM creditos_mov WHERE conta_id=c.id) saldo,
      (SELECT COUNT(*) FROM cobrancas WHERE conta_id=c.id AND status='pago') pagas
      FROM contas c WHERE c.admin=0 AND c.plano NOT IN ('ilimitado')
      AND COALESCE((SELECT MAX(criado_em) FROM interacoes WHERE conta_id=c.id), c.criado_em) < datetime('now','-'||?||' days')
      ORDER BY ultimo_uso`).all(diasInativa);
    res.json({ dias: diasInativa, candidatas });
  });
  app.post('/api/admin/limpeza/marcar', auth, (req, res) => {
    const ids = (req.body?.ids || []).map(Number).filter(Boolean); if (!ids.length) return res.status(400).json({ erro: 'nenhum id' });
    const stm = db.prepare("UPDATE contas SET status='suspensa' WHERE id=? AND admin=0 AND plano<>'ilimitado'");
    const t = db.transaction(() => { for (const id of ids) stm.run(id); }); t();
    logAdmin(req.contaId, 'limpeza.suspender', null, { ids, n: ids.length }); res.json({ ok: true, n: ids.length });
  });

  // Métricas: conversão trial→pago, churn de plano mensal, cohort de criação
  app.get('/api/admin/metricas', auth, (req, res) => {
    const q = (sql, ...a) => db.prepare(sql).get(...a);
    const trial30 = q("SELECT COUNT(*) n FROM contas WHERE criado_em >= datetime('now','-30 days')");
    const trialComprou = q("SELECT COUNT(DISTINCT c.id) n FROM contas c JOIN cobrancas cb ON cb.conta_id=c.id AND cb.status='pago' WHERE c.criado_em >= datetime('now','-30 days')");
    const assinaturaAtiva = q("SELECT COUNT(*) n FROM assinaturas WHERE status='ativa'");
    const assinaturaCancelada30 = q("SELECT COUNT(*) n FROM assinaturas WHERE status='cancelada' AND cancelada_em >= datetime('now','-30 days')");
    const cohort = db.prepare("SELECT strftime('%Y-%m', c.criado_em) m, COUNT(*) criadas, SUM(CASE WHEN (SELECT 1 FROM cobrancas WHERE conta_id=c.id AND status='pago' LIMIT 1) THEN 1 ELSE 0 END) pagantes FROM contas c WHERE c.criado_em >= datetime('now','-12 months') GROUP BY m ORDER BY m").all();
    const receitaMensal = db.prepare("SELECT strftime('%Y-%m', pago_em) m, SUM(valor) r, COUNT(*) n FROM cobrancas WHERE status='pago' GROUP BY m ORDER BY m DESC LIMIT 12").all();
    const ativas14d = q("SELECT COUNT(DISTINCT conta_id) n FROM interacoes WHERE criado_em >= datetime('now','-14 days')");
    res.json({ trial_30d: trial30.n, trial_virou_pagante_30d: trialComprou.n, taxa_conversao: trial30.n ? (trialComprou.n / trial30.n) : 0, assinaturas_ativas: assinaturaAtiva.n, canceladas_30d: assinaturaCancelada30.n, churn_mensal: assinaturaAtiva.n ? (assinaturaCancelada30.n / (assinaturaAtiva.n + assinaturaCancelada30.n)) : 0, ativas_14d: ativas14d.n, cohort, receita_mensal: receitaMensal });
  });

}
