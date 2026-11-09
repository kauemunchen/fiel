// API de configuração do app web: Equipe (módulos, personas, pessoas) e Conexões (Google, Instagram, Drive, empresas, planilhas).
import { db } from '../db/index.js';
import { sessao } from './web.js';
import { urlAutorizacao } from '../integracoes/google-calendar.js';

const MODULOS = [
  { id: 'diretor', nome: 'Diretor', fixo: true, desc: 'Central gerencial e consultiva. Coordena a equipe e tem as ferramentas de todos os módulos ativos.' },
  { id: 'secretaria', nome: 'Secretária', desc: 'Agenda, lembretes, e-mail, Google Tasks, planilhas, recados e tarefas para a equipe.' },
  { id: 'documentos', nome: 'Documentos', desc: 'Arquivo no Drive, OCR, vigências com aviso, cadastros, dossiê.' },
  { id: 'social', nome: 'Social Media', desc: 'Instagram: legendas, artes no padrão da marca, Reels/Stories, agendamento.' },
  { id: 'financeiro', nome: 'Financeiro', desc: 'PJ+PF: lançamentos, baixas, DRE, análise. (em construção)' },
  { id: 'producao', nome: 'Produção', desc: 'Integração com o AgilFac: OPs, eficiência, embarques. (aguarda API)' },
];
const CAMPOS_PERSONA = ['nome', 'tratamento', 'tom', 'tamanho', 'proatividade', 'autonomia', 'perfil_analise', 'hora_resumo', 'hora_fechamento', 'hora_semana', 'hora_retornos', 'hora_checagem', 'padrao_tarde', 'emojis'];
const OPCOES = {
  tom: ['direto', 'cordial', 'formal', 'descontraído'],
  tamanho: ['curta', 'média', 'completa'],
  proatividade: ['mínima', 'essencial', 'alta'],
  autonomia: ['confirma ação externa', 'confirma tudo', 'age e avisa'],
  perfil_analise: ['conservador', 'equilibrado', 'agressivo'],
  tratamento: ['primeiro nome', 'você', 'senhor', 'chefe'],
};

// Atalhos sugeridos: top 5 mensagens curtas que o dono repete, com fallback para iniciantes.
const ATALHOS_PADRAO = [
  { cmd: 'hoje', rotulo: 'Agenda de hoje' },
  { cmd: 'créditos', rotulo: 'Meu saldo' },
  { cmd: 'status', rotulo: 'Conexões' },
  { cmd: 'programação', rotulo: 'Programação da MIA' },
  { cmd: 'biblioteca', rotulo: 'Biblioteca de mídia' },
];
export function rotasConfig(app) {
  // handlers async: encaminha rejeições ao middleware de erro (JSON)
  for (const m of ['get', 'post', 'delete']) { const orig = app[m].bind(app); app[m] = (path, ...fns) => orig(path, ...fns.map(f => (typeof f === 'function' && f.constructor.name === 'AsyncFunction' && f.length < 3) ? (req, res, next) => f(req, res).catch(next) : f)); }
  const auth = (req, res, next) => { const s = sessao(req); if (!s) return res.status(401).json({ erro: 'não autenticado' }); req.sessao = s; req.contaId = s.conta_id; next(); };

  // ---------- Equipe ----------
  app.get('/api/atalhos', auth, (_, res) => {
    const contaId = res.req.contaId;
    // Pega as 60 últimas mensagens curtas do dono (entrada, texto), agrupa por texto normalizado, pega top 5 por frequência.
    const rows = db.prepare("SELECT lower(trim(texto)) t, COUNT(*) n FROM mensagens WHERE conta_id=? AND direcao='entrada' AND tipo='texto' AND length(trim(texto))<=35 AND criado_em>=datetime('now','-60 days') GROUP BY t HAVING n>=2 ORDER BY n DESC, MAX(criado_em) DESC LIMIT 12").all(contaId);
    const limpar = (s) => s.replace(/^\s+|\s+$/g,'').replace(/\s+/g,' ');
    const ehUtil = (s) => s.length >= 3 && !/^(sim|n[ãa]o|ok|cancela|oi|olá|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|opa)$/i.test(s) && !/^\d+$/.test(s) && !/^(start|pro|max|pix|cart[ãa]o|boleto)$/i.test(s);
    const dinamicos = rows.filter(r => ehUtil(r.t)).slice(0, 5).map(r => ({ cmd: limpar(r.t), rotulo: limpar(r.t).charAt(0).toUpperCase() + limpar(r.t).slice(1), freq: r.n }));
    // Se tem menos de 5, completa com padrões que o dono ainda não usou.
    const usados = new Set(dinamicos.map(x => x.cmd.toLowerCase()));
    const fallback = ATALHOS_PADRAO.filter(x => !usados.has(x.cmd.toLowerCase()));
    const atalhos = [...dinamicos, ...fallback].slice(0, 5);
    res.json({ atalhos, origem: dinamicos.length >= 5 ? 'uso-real' : dinamicos.length > 0 ? 'misto' : 'padrão' });
  });

  app.get('/api/equipe', auth, (req, res) => {
    const ligados = new Set(db.prepare('SELECT modulo FROM modulos WHERE conta_id=? AND ligado=1').all(req.contaId).map(x => x.modulo));
    const cfg = Object.fromEntries(db.prepare('SELECT * FROM persona_config WHERE conta_id=?').all(req.contaId).map(r => [r.modulo, r]));
    const conta = db.prepare('SELECT nome_dono, empresa, foco_mes, janela_silencio FROM contas WHERE id=?').get(req.contaId);
    res.json({ conta, opcoes: OPCOES, modulos: MODULOS.map(m => ({ ...m, ligado: m.fixo || ligados.has(m.id), persona: cfg[m.id] || {} })),
      pessoas: db.prepare("SELECT id, nome FROM usuarios WHERE conta_id=? AND papel<>'dono'").all(req.contaId),
      convites: db.prepare('SELECT codigo, nome, criado_em FROM convites WHERE conta_id=? AND usado=0').all(req.contaId) });
  });
  app.post('/api/equipe/modulo', auth, (req, res) => {
    const { modulo, ligado } = req.body || {}; if (!MODULOS.find(m => m.id === modulo && !m.fixo)) return res.status(400).json({ erro: 'módulo inválido' });
    db.prepare('INSERT INTO modulos (conta_id, modulo, ligado) VALUES (?,?,?) ON CONFLICT(conta_id, modulo) DO UPDATE SET ligado=excluded.ligado').run(req.contaId, modulo, ligado ? 1 : 0);
    res.json({ ok: true });
  });
  app.post('/api/equipe/persona', auth, (req, res) => {
    const { modulo, ...campos } = req.body || {}; if (!MODULOS.find(m => m.id === modulo)) return res.status(400).json({ erro: 'módulo inválido' });
    db.prepare('INSERT OR IGNORE INTO persona_config (conta_id, modulo) VALUES (?,?)').run(req.contaId, modulo);
    for (const [k, v] of Object.entries(campos)) if (CAMPOS_PERSONA.includes(k)) db.prepare(`UPDATE persona_config SET ${k}=? WHERE conta_id=? AND modulo=?`).run(k === 'emojis' ? (v ? 1 : 0) : (v === '' ? null : v), req.contaId, modulo);
    res.json({ ok: true });
  });
  app.post('/api/equipe/conta', auth, (req, res) => {
    const { nome_dono, empresa, foco_mes, janela_silencio } = req.body || {};
    for (const [k, v] of Object.entries({ nome_dono, empresa, foco_mes, janela_silencio })) if (v !== undefined) db.prepare(`UPDATE contas SET ${k}=? WHERE id=?`).run(v, req.contaId);
    res.json({ ok: true });
  });
  app.post('/api/equipe/convite', auth, async (req, res) => {
    const { criarConvite } = await import('../orquestrador/equipe.js'); const nome = String(req.body?.nome || '').trim(); if (!nome) return res.status(400).json({ erro: 'nome?' });
    res.json({ codigo: criarConvite(req.contaId, nome), bot: process.env.TELEGRAM_BOT_USERNAME || 'AssessorKM_bot' });
  });
  app.delete('/api/equipe/pessoa/:id', auth, (req, res) => { db.prepare("DELETE FROM usuarios WHERE id=? AND conta_id=? AND papel<>'dono'").run(req.params.id, req.contaId); res.json({ ok: true }); });
  app.delete('/api/equipe/convite/:codigo', auth, (req, res) => { db.prepare('DELETE FROM convites WHERE codigo=? AND conta_id=?').run(req.params.codigo, req.contaId); res.json({ ok: true }); });

  // ---------- Conexões ----------
  app.get('/api/conexoes', auth, async (req, res) => {
    const g = db.prepare('SELECT token_json, atualizado_em FROM google_auth WHERE conta_id=?').get(req.contaId);
    const scope = g ? (JSON.parse(g.token_json).scope || '') : '';
    const ig = db.prepare('SELECT ig_user_id, expira_em, atualizado_em FROM instagram_auth WHERE conta_id=?').get(req.contaId);
    let igInfo = null; if (ig) { try { const tok = db.prepare('SELECT token FROM instagram_auth WHERE conta_id=?').get(req.contaId).token; const r = await fetch(`https://graph.instagram.com/me?fields=username,account_type&access_token=${tok}`).then(r => r.json()); igInfo = r.error ? { ok: false, erro: `${r.error.code}: ${r.error.message}` } : { ok: true, username: r.username, tipo: r.account_type }; } catch (e) { igInfo = { ok: false, erro: e.message }; } }
    const conta = db.prepare('SELECT drive_pasta_id, empresas FROM contas WHERE id=?').get(req.contaId);
    const { listarCadastradas } = await import('../integracoes/google-sheets.js');
    res.json({
      google: { conectado: !!g, desde: g?.atualizado_em, escopos: { agenda: /calendar/.test(scope), gmail_ler: /gmail.readonly/.test(scope), gmail_enviar: /gmail.send/.test(scope), drive: /auth\/drive(\.file)?(\s|$)/.test(scope), drive_total: /auth\/drive(\s|$)/.test(scope), planilhas: /auth\/(spreadsheets|drive)(\s|$)/.test(scope), tasks: /auth\/tasks/.test(scope) }, modo: (await import('../integracoes/google-calendar.js')).modoEscopos(req.contaId), url_autorizar: urlAutorizacao(req.contaId) },
      telegram: !!db.prepare("SELECT 1 FROM usuarios WHERE conta_id=? AND canal='telegram'").get(req.contaId),
      instagram: { ...(ig ? { conectado: true, ig_user_id: ig.ig_user_id, expira_em: ig.expira_em, desde: ig.atualizado_em, ...igInfo } : { conectado: false }), url_autorizar: (await import('../integracoes/instagram-oauth.js')).urlAutorizacao(req.contaId), liberacao: (await import('../integracoes/instagram-liberacao.js')).statusDaConta(req.contaId) },
      drive: { pasta_id: conta.drive_pasta_id, link: conta.drive_pasta_id ? `https://drive.google.com/drive/folders/${conta.drive_pasta_id}` : null },
      empresas: JSON.parse(conta.empresas || '[]'),
      planilhas: listarCadastradas(req.contaId),
      agilfac: { configurado: !!process.env.AGILFAC_API_URL },
      ia: { modelos: (process.env.MODELOS || process.env.MODELO_PADRAO || '').split(',').filter(Boolean), rapido: process.env.MODELO_RAPIDO || null, fal: !!process.env.FAL_API_KEY, cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME },
    });
  });
  app.post('/api/conexoes/instagram', auth, async (req, res) => {
    const token = String(req.body?.token || '').trim(); if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) return res.status(400).json({ erro: 'token inválido' });
    const me = await fetch(`https://graph.instagram.com/me?fields=user_id,username,account_type&access_token=${token}`).then(r => r.json()).catch(e => ({ error: { message: e.message } }));
    if (me.error) return res.status(400).json({ erro: `Meta recusou: ${me.error.message}` });
    db.prepare('INSERT INTO instagram_auth (conta_id, ig_user_id, token, expira_em) VALUES (?,?,?,?) ON CONFLICT(conta_id) DO UPDATE SET ig_user_id=excluded.ig_user_id, token=excluded.token, expira_em=excluded.expira_em').run(req.contaId, String(me.user_id || me.id), token, new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));
    db.prepare('INSERT INTO modulos (conta_id, modulo, ligado) VALUES (?,?,1) ON CONFLICT(conta_id, modulo) DO UPDATE SET ligado=1').run(req.contaId, 'social');
    res.json({ ok: true, username: me.username });
  });
  app.delete('/api/conexoes/instagram', auth, (req, res) => { db.prepare('DELETE FROM instagram_auth WHERE conta_id=?').run(req.contaId); res.json({ ok: true }); });
  app.delete('/api/conexoes/google', auth, async (req, res) => {
    // revoga no Google (o acesso some também em myaccount.google.com) e apaga os tokens daqui
    try { const t = JSON.parse(db.prepare('SELECT token_json FROM google_auth WHERE conta_id=?').get(req.contaId)?.token_json || '{}'); const tk = t.refresh_token || t.access_token; if (tk) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tk), { method: 'POST' }).catch(() => {}); } catch {}
    db.prepare('DELETE FROM google_auth WHERE conta_id=?').run(req.contaId); res.json({ ok: true });
  });
  app.post('/api/conexoes/drive', auth, async (req, res) => {
    try { const d = await import('../integracoes/google-drive.js'); const r = await d.definirPastaRaiz(req.contaId, String(req.body?.link || '')); res.json({ ok: true, ...r }); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.post('/api/conexoes/empresas', auth, (req, res) => {
    const lista = (Array.isArray(req.body?.empresas) ? req.body.empresas : String(req.body?.empresas || '').split(/[,;\n]/)).map(x => String(x).trim()).filter(Boolean);
    db.prepare('UPDATE contas SET empresas=? WHERE id=?').run(JSON.stringify(lista), req.contaId); res.json({ ok: true, empresas: lista });
  });
  app.post('/api/conexoes/planilha', auth, async (req, res) => {
    try { const s = await import('../integracoes/google-sheets.js'); res.json(await s.cadastrar(req.contaId, { link_ou_id: req.body?.link, nome: req.body?.nome, aba: req.body?.aba })); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.delete('/api/conexoes/planilha/:nome', auth, (req, res) => { db.prepare('DELETE FROM planilhas WHERE conta_id=? AND nome=?').run(req.contaId, req.params.nome); res.json({ ok: true }); });
}
