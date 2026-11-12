// API: Identidade & Marca (MIA) e Ajustes (preferências por conta, uso, backups, logs).
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { sessao } from './web.js';
import { debitarTokens, resumo as resumoCreditos } from '../creditos/index.js';

const CONHECIMENTO = path.resolve('src/conhecimento');
db.exec(`CREATE TABLE IF NOT EXISTS ajustes (conta_id INTEGER, chave TEXT, valor TEXT, PRIMARY KEY (conta_id, chave));
CREATE TABLE IF NOT EXISTS uso (id INTEGER PRIMARY KEY, conta_id INTEGER, modulo TEXT, tokens_in INTEGER, tokens_out INTEGER, modelo TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
// Tokens de entrada que o Gemini cobrou com desconto de cache implícito (parte de tokens_in).
try { db.exec('ALTER TABLE uso ADD COLUMN tokens_cache INTEGER DEFAULT 0'); } catch {}

export function ajuste(contaId, chave, padrao = null) { const r = db.prepare('SELECT valor FROM ajustes WHERE conta_id=? AND chave=?').get(contaId, chave); if (!r) return padrao; try { return JSON.parse(r.valor); } catch { return r.valor; } }
export function definirAjuste(contaId, chave, valor) { db.prepare('INSERT INTO ajustes (conta_id, chave, valor) VALUES (?,?,?) ON CONFLICT(conta_id, chave) DO UPDATE SET valor=excluded.valor').run(contaId, chave, JSON.stringify(valor)); }
/** Registro de uso de IA (chamado pelo gemini.js quando houver usageMetadata). */
export function registrarUso(contaId, modulo, modelo, meta) { try { if (!meta) return; db.prepare('INSERT INTO uso (conta_id, modulo, tokens_in, tokens_out, modelo, tokens_cache) VALUES (?,?,?,?,?,?)').run(contaId || 0, modulo || null, meta.promptTokenCount || 0, meta.candidatesTokenCount || 0, modelo || null, meta.cachedContentTokenCount || 0); debitarTokens(contaId, modulo, (meta.totalTokenCount || (meta.promptTokenCount || 0) + (meta.candidatesTokenCount || 0)), modelo); } catch {} }

const CAMPOS_ID = ['perfil', 'nicho', 'publico', 'tom', 'pilares', 'hashtags_fixas', 'hashtags_pilar', 'ctas', 'agenda', 'fase', 'formatos', 'cores', 'tipografia', 'provas', 'series', 'descricao'];
const AJUSTES_PADRAO = { grade_horarios: ['12:00', '19:00'], retencao_biblioteca_dias: Number(process.env.BIBLIOTECA_RETENCAO_DIAS || 15), video_sem_audio_padrao: true, story_posicao_faixa: 'base', marcador_social: 'Social Media', marcador_vencimentos: 'Profissional', avisos_vencimento: [30, 7, 1], hora_vencimentos: '08:00', hora_limpeza: '03:00' };

export function rotasMarca(app) {
  const auth = (req, res, next) => { const s = sessao(req); if (!s) return res.status(401).json({ erro: 'não autenticado' }); req.contaId = s.conta_id; next(); };
  const lerRegras = () => { const p = path.join(CONHECIMENTO, 'estrategia-conteudo.md'); const t = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; const i = t.indexOf('## Regras operacionais'); return { completo: t, regras: i >= 0 ? t.slice(i) : '', antes: i >= 0 ? t.slice(0, i) : t }; };

  // ---------- Identidade & Marca ----------
  app.get('/api/marca', auth, async (req, res) => {
    const row = db.prepare('SELECT dados, atualizado_em FROM social_identidade WHERE conta_id=?').get(req.contaId);
    const id = row ? JSON.parse(row.dados) : {};
    const { regras } = lerRegras();
    const kitM = await import('../integracoes/marca-kit.js'); const km = kitM.usaKM(req.contaId);
    const logos = km ? ['logo_km_escuro.png', 'logo_km_claro.png', 'logo_km_branco.png'].filter(f => fs.existsSync(path.resolve('render', f))).map(f => `/api/marca/logo/${f}`) : [];
    res.json({ km, kit: km ? null : (kitM.lerKit(req.contaId) || {}), admin: db.prepare('SELECT admin FROM contas WHERE id=?').get(req.contaId)?.admin === 1, identidade: id, campos: CAMPOS_ID, atualizado_em: row?.atualizado_em, regras_operacionais: db.prepare('SELECT admin FROM contas WHERE id=?').get(req.contaId)?.admin === 1 ? regras : '', logos, ajustes: { ...AJUSTES_PADRAO, ...Object.fromEntries(Object.keys(AJUSTES_PADRAO).map(k => [k, ajuste(req.contaId, k, AJUSTES_PADRAO[k])])) } });
  });
  app.post('/api/marca/identidade', auth, (req, res) => {
    const atual = (() => { const r = db.prepare('SELECT dados FROM social_identidade WHERE conta_id=?').get(req.contaId); return r ? JSON.parse(r.dados) : {}; })();
    const novo = { ...atual };
    for (const [k, v] of Object.entries(req.body || {})) if (CAMPOS_ID.includes(k)) novo[k] = v;
    db.prepare('INSERT INTO social_identidade (conta_id, dados, atualizado_em) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(conta_id) DO UPDATE SET dados=excluded.dados, atualizado_em=CURRENT_TIMESTAMP').run(req.contaId, JSON.stringify(novo));
    res.json({ ok: true });
  });
  // ---------- Kit visual da marca (clientes) ----------
  app.post('/api/marca/kit', auth, async (req, res) => {
    const kitM = await import('../integracoes/marca-kit.js'); const b = req.body || {};
    res.json(kitM.salvarKit(req.contaId, { nome: b.nome, assinatura: b.assinatura, cores: b.cores || {}, marca_dagua_auto: b.marca_dagua_auto, logo_posicao: b.logo_posicao }));
  });
  app.post('/api/marca/kit/logo', auth, async (req, res) => {
    try {
      const b = req.body || {}; const bytes = Buffer.from(String(b.imagem_b64 || '').replace(/^data:[^,]+,/, ''), 'base64');
      if (bytes.length < 100 || bytes.length > 8 * 1024 * 1024) return res.status(400).json({ erro: 'imagem inválida (até 8 MB)' });
      const cdn = await import('../integracoes/cloudinary.js'); const kitM = await import('../integracoes/marca-kit.js');
      const url = await cdn.upload(bytes, { pasta: `assessor/${req.contaId}/marca` });
      res.json(kitM.salvarLogo(req.contaId, url, b.variante || 'principal', { substituir: true }));
    } catch (e) { res.status(500).json({ erro: e.message }); }
  });
  app.delete('/api/marca/kit/logo/:variante', auth, async (req, res) => { const kitM = await import('../integracoes/marca-kit.js'); res.json(kitM.removerLogo(req.contaId, req.params.variante)); });
  app.post('/api/marca/regras', auth, (req, res) => {
    if (db.prepare('SELECT admin FROM contas WHERE id=?').get(req.contaId)?.admin !== 1) return res.status(403).json({ erro: 'só o administrador edita as regras do manual KM' });
    const txt = String(req.body?.regras || ''); if (!txt.startsWith('## Regras operacionais')) return res.status(400).json({ erro: 'O texto precisa começar com "## Regras operacionais".' });
    const { antes } = lerRegras(); const p = path.join(CONHECIMENTO, 'estrategia-conteudo.md');
    fs.copyFileSync(p, p + '.bak'); fs.writeFileSync(p, antes + txt.trimEnd() + '\n'); res.json({ ok: true });
  });
  app.get('/api/marca/logo/:nome', (req, res) => { const p = path.resolve('render', path.basename(req.params.nome)); if (!fs.existsSync(p)) return res.sendStatus(404); res.sendFile(p); });
  // prévia de story no padrão da marca (render ao vivo)
  app.post('/api/marca/previa', auth, async (req, res) => {
    try { const render = await import('../integracoes/render.js'); const { modelo = 'frase', texto = 'Processo não é burocracia, é liberdade', palavra_dourada = 'liberdade', etiqueta = 'Gestão' } = req.body || {};
      const r = await render.story({ modelo, texto, titulo: texto, palavra_dourada, etiqueta, itens: ['Defina o resultado', 'Documente o como', 'Acompanhe pelo indicador'], quando: 'Quinta, 19h' }, { contaId: req.contaId });
      res.setHeader('content-type', 'image/jpeg'); res.send(r.bytes); } catch (e) { res.status(500).json({ erro: e.message }); }
  });

  // ---------- Créditos ----------
  app.get('/api/creditos', auth, async (req, res) => { const as = await import('../integracoes/pagamento.js'); const c = db.prepare('SELECT cpf_cnpj, email, nome_dono FROM contas WHERE id=?').get(req.contaId);
    const CU = await import('../creditos/cupons.js'); const dP = CU.descontoAtivo(req.contaId, 'prepago'), dM = CU.descontoAtivo(req.contaId, 'mensal');
    res.json({ ...resumoCreditos(req.contaId), cupons: CU.cuponsDaConta(req.contaId), desconto: { prepago: dP, mensal: dM }, asaas: as.configurado(), ambiente: process.env.ASAAS_AMBIENTE || 'sandbox', assinatura: as.assinaturaAtiva(req.contaId) || null, cobrancas: as.listarCobrancas(req.contaId), pagador: { nome: c.nome_dono, cpf_cnpj: c.cpf_cnpj, email: c.email } }); });
  app.post('/api/cupom/resgatar', auth, async (req, res) => { const CU = await import('../creditos/cupons.js'); try { res.json(CU.resgatarCupom(req.contaId, req.body?.codigo)); } catch (e) { res.status(400).json({ erro: e.message }); } });
  app.get('/api/cupom/validar', async (req, res) => { const CU = await import('../creditos/cupons.js'); try { const c = CU.validarCupom(null, req.query.codigo); res.json({ ok: true, codigo: c.codigo, beneficio: CU.descreverCupom(c) }); } catch (e) { res.status(400).json({ erro: e.message }); } });
  app.post('/api/creditos/comprar', auth, async (req, res) => { const as = await import('../integracoes/pagamento.js'); const b = req.body || {};
    try { res.json(await as.comprar(req.contaId, b.pacote_id, { forma: b.forma, nome: b.nome, cpfCnpj: b.cpf_cnpj, email: b.email })); } catch (e) { res.status(400).json({ erro: e.message }); } });
  app.get('/api/creditos/cobranca/:id', auth, async (req, res) => { const as = await import('../integracoes/pagamento.js'); const c = as.cobranca(req.contaId, req.params.id); if (!c) return res.status(404).json({ erro: 'não existe' });
    if (c.status === 'pendente') { await as.conferirPendentes().catch(() => {}); } res.json(as.cobranca(req.contaId, req.params.id)); });
  app.post('/api/creditos/assinatura/cancelar', auth, async (req, res) => { const as = await import('../integracoes/pagamento.js'); try { res.json(await as.cancelarAssinatura(req.contaId)); } catch (e) { res.status(400).json({ erro: e.message }); } });

  // ---------- Ajustes ----------
  app.get('/api/ajustes', auth, (req, res) => {
    const aj = Object.fromEntries(Object.keys(AJUSTES_PADRAO).map(k => [k, ajuste(req.contaId, k, AJUSTES_PADRAO[k])]));
    const uso30 = db.prepare("SELECT modulo, COUNT(*) n, SUM(tokens_in) tin, SUM(tokens_out) tout FROM uso WHERE conta_id=? AND criado_em >= datetime('now','-30 days') GROUP BY modulo").all(req.contaId);
    const usoDia = db.prepare("SELECT date(criado_em) d, COUNT(*) n, SUM(tokens_in)+SUM(tokens_out) t FROM uso WHERE conta_id=? AND criado_em >= datetime('now','-14 days') GROUP BY d ORDER BY d").all(req.contaId);
    const msgs30 = db.prepare("SELECT COUNT(*) n FROM mensagens WHERE conta_id=? AND criado_em >= datetime('now','-30 days') AND direcao='entrada'").get(req.contaId).n;
    const contagens = { posts: db.prepare('SELECT COUNT(*) n FROM posts WHERE conta_id=?').get(req.contaId).n, publicados: db.prepare("SELECT COUNT(*) n FROM posts WHERE conta_id=? AND status='publicado'").get(req.contaId).n, documentos: db.prepare('SELECT COUNT(*) n FROM documentos WHERE conta_id=?').get(req.contaId).n, biblioteca: db.prepare('SELECT COUNT(*) n FROM biblioteca WHERE conta_id=?').get(req.contaId).n, lembretes: db.prepare('SELECT COUNT(*) n FROM lembretes WHERE conta_id=? AND enviado=0').get(req.contaId).n };
    const backups = fs.existsSync('backups') ? fs.readdirSync('backups').filter(f => f.endsWith('.tar.gz')).sort().reverse().slice(0, 10).map(f => ({ nome: f, mb: +(fs.statSync(path.join('backups', f)).size / 1048576).toFixed(2) })) : [];
    const precoIn = 0.30, precoOut = 2.50; // US$/1M (referência Gemini Flash)
    const custo = uso30.reduce((s, u) => s + (u.tin || 0) / 1e6 * precoIn + (u.tout || 0) / 1e6 * precoOut, 0);
    res.json({ ajustes: aj, padrao: AJUSTES_PADRAO, uso: { por_modulo: uso30, por_dia: usoDia, mensagens_30d: msgs30, custo_usd_30d: +custo.toFixed(3) }, contagens, backups, servidor: { modelos: (process.env.MODELOS || '').split(',').filter(Boolean), rapido: process.env.MODELO_RAPIDO || null, tz: process.env.TZ || 'America/Sao_Paulo', versao: versao() } });
  });
  app.post('/api/ajustes', auth, (req, res) => {
    for (const [k, v] of Object.entries(req.body || {})) if (k in AJUSTES_PADRAO) definirAjuste(req.contaId, k, v);
    res.json({ ok: true });
  });
  app.post('/api/ajustes/backup', auth, async (req, res) => {
    const { exec } = await import('node:child_process');
    exec('bash scripts/backup.sh', { timeout: 120000 }, (err, out) => { if (err) return res.status(500).json({ erro: err.message, saida: out }); res.json({ ok: true, saida: out.trim().split('\n').slice(-3) }); });
  });
  app.get('/api/ajustes/logs', auth, (req, res) => {
    const rows = db.prepare('SELECT modulo, entrada, saida, criado_em FROM interacoes WHERE conta_id=? ORDER BY id DESC LIMIT 50').all(req.contaId);
    res.json(rows.map(r => ({ em: r.criado_em, modulo: r.modulo, entrada: (r.entrada || '').slice(0, 160), saida: (r.saida || '').slice(0, 160) })));
  });
}
function versao() { try { return fs.readFileSync('.git/ORIG_HEAD', 'utf8').slice(0, 7); } catch { try { const h = fs.readFileSync('.git/HEAD', 'utf8').trim(); const ref = h.replace('ref: ', ''); return fs.readFileSync(path.join('.git', ref), 'utf8').slice(0, 7); } catch { return '?'; } } }
