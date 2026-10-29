import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { criarCanal } from './canal/index.js';
import { tratarMensagem } from './orquestrador/roteador.js';
import { comBotoes } from './orquestrador/botoes.js';
import { rotasConfig } from './canal/api-config.js';
import { rotasMarca } from './canal/api-marca.js';
import { rotasDados } from './canal/api-dados.js';
import { iniciarRotinas } from './rotinas/scheduler.js';
import { migrar } from './db/migrate.js';
import { setCanal } from './canal/atual.js';
import { db } from './db/index.js';

migrar();
const app = express();
app.use(express.json({ limit: '2mb' }));
const servidor = http.createServer(app);
// Contador público da landing: interações reais (fuso de São Paulo). Só totais, sem dado de conta.
let _cont = { em: 0, hoje: 0, semana: 0, total: 0 };
app.get('/api/publico/solucionados-hoje', (_, res) => {
  if (Date.now() - _cont.em > 30000) {
    const r = db.prepare(`SELECT
      SUM(CASE WHEN date(criado_em, '-3 hours') = date('now', '-3 hours') THEN 1 ELSE 0 END) AS hoje,
      SUM(CASE WHEN date(criado_em, '-3 hours') > date('now', '-3 hours', '-7 days') THEN 1 ELSE 0 END) AS semana,
      COUNT(*) AS total FROM interacoes`).get();
    _cont = { em: Date.now(), hoje: r?.hoje || 0, semana: r?.semana || 0, total: r?.total || 0 };
  }
  res.set({ 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*' });
  res.json({ hoje: _cont.hoje, semana: _cont.semana, total: _cont.total, data: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) });
});
// App web (estático) em /app
// HTML/JS/CSS sempre revalidam (ETag): depois de cada deploy o navegador pega a versão nova sem precisar limpar cache.
const semCache = (res, p) => { if (/\.(html|js|css|webmanifest)$/i.test(p)) res.setHeader('Cache-Control', 'no-cache'); };
app.use('/app', express.static(path.resolve('src/painel'), { index: 'index.html', extensions: ['html'], setHeaders: semCache }));
app.get(['/admin', '/admin/'], (_, res) => res.set('Cache-Control', 'no-cache').sendFile(path.resolve('src/painel/admin/index.html')));
app.use('/admin', express.static(path.resolve('src/painel/admin'), { index: false, redirect: false, setHeaders: semCache }));
// Manual público — sem auth, serve pra quem acabou de criar conta e precisa do passo-a-passo
app.get(['/ajuda', '/ajuda/'], (_, res) => res.set('Cache-Control', 'no-cache').sendFile(path.resolve('src/painel/ajuda/index.html')));
app.use('/ajuda', express.static(path.resolve('src/painel/ajuda'), { index: false, redirect: false, setHeaders: semCache }));
// Jurídico: Termos de Uso e Política de Privacidade — públicos, pré e pós cadastro
app.get(['/termos', '/termos/'], (_, res) => res.set('Cache-Control', 'no-cache').sendFile(path.resolve('src/painel/termos/index.html')));
app.use('/termos', express.static(path.resolve('src/painel/termos'), { index: false, redirect: false, setHeaders: semCache }));
app.get(['/privacidade', '/privacidade/'], (_, res) => res.set('Cache-Control', 'no-cache').sendFile(path.resolve('src/painel/privacidade/index.html')));
app.use('/privacidade', express.static(path.resolve('src/painel/privacidade'), { index: false, redirect: false, setHeaders: semCache }));
app.get('/', (_, res) => res.redirect('/app'));

const canal = criarCanal(process.env.CANAL || 'telegram', app, servidor);
setCanal(canal);
rotasConfig(app);
rotasMarca(app);
rotasDados(app);
import('./canal/api-admin.js').then(a => a.rotasAdmin(app)).catch(e => console.error('admin', e.message));
import('./integracoes/pagamento.js').then(a => a.rotaWebhook(app)).catch(e => console.error('asaas', e.message));
app.use('/api', (err, req, res, _next) => { console.error('[api]', req.path, err.message); res.status(500).json({ erro: err.message }); });
canal.aoReceber(async (msg) => {
  const t0 = Date.now(); canal.digitando?.(msg.chatId); const tick = setInterval(() => canal.digitando?.(msg.chatId), 4500);
  try {
    const resposta = await tratarMensagem(msg, canal);
    clearInterval(tick); console.log(`[tempo] ${msg.chatId} ${Date.now() - t0}ms`);
    if (resposta) await canal.enviar(msg.conta, msg.chatId, comBotoes(resposta));
  } catch (e) {
    clearInterval(tick); console.error('[erro]', msg.chatId, e?.stack || e);
    await canal.enviar(msg.conta, msg.chatId, `⚠️ Deu erro aqui: ${String(e?.message || e).slice(0, 300)}`).catch(() => {});
  }
});

iniciarRotinas(canal);
app.get('/health', (_, res) => res.json({ ok: true }));
servidor.listen(process.env.PORT || 3000, () => console.log('assessor-km up'));

import { urlAutorizacao, salvarCodigo } from './integracoes/google-calendar.js';
app.get('/oauth/google/iniciar/:contaId', (req, res) => res.redirect(urlAutorizacao(req.params.contaId)));
app.get('/oauth/google/callback', async (req, res) => {
  const { state, code, error } = req.query;
  if (error || !code) { console.error('[oauth] google retornou erro:', error || 'sem code', req.query); return res.status(400).send(`Google não autorizou: ${error || 'sem código'}. Volte ao Telegram e peça "conectar google" de novo.`); }
  try { await salvarCodigo(state, code); res.send('Google conectado. Pode voltar ao Telegram.'); }
  catch (e) { console.error('[oauth] falha ao salvar token:', e?.message); res.status(500).send(`Erro ao conectar: ${e?.message}`); }
});
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));
