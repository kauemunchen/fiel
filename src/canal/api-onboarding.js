// Onboarding do cliente novo (app web), em até 2 minutos:
// perfil e tom → equipe (ativações) → Telegram → Google → MIA (identidade, marca, tom) → Instagram → teste → boas-vindas oficiais.
// Cada etapa é opcional ("depois"); a boas-vindas só sai ao concluir, já dizendo o que ficou pronto.
import { db } from '../db/index.js';
import { sessao, lerMultipart } from './web.js';

// coluna nova: contas antigas já passaram pelo início (marca como concluído só na criação da coluna)
try { db.exec('ALTER TABLE contas ADD COLUMN onboarding_em TEXT'); db.exec("UPDATE contas SET onboarding_em=COALESCE(criado_em, CURRENT_TIMESTAMP) WHERE onboarding_em IS NULL"); } catch {}

const MODULOS = ['secretaria', 'documentos', 'financeiro', 'social'];
const NOMES = { secretaria: 'Olga', documentos: 'Estag', financeiro: 'Tina', social: 'MIA' };
const ligados = (contaId) => new Set(db.prepare('SELECT modulo FROM modulos WHERE conta_id=? AND ligado=1').all(contaId).map(x => x.modulo));
const identidade = (contaId) => { try { return JSON.parse(db.prepare('SELECT dados FROM social_identidade WHERE conta_id=?').get(contaId)?.dados || 'null'); } catch { return null; } };
const donoChat = (contaId) => db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' ORDER BY canal<>'telegram', id LIMIT 1").get(contaId)?.chat_id;

export async function estado(contaId) {
  const conta = db.prepare('SELECT nome_dono, empresa, admin, onboarding_em FROM contas WHERE id=?').get(contaId) || {};
  const mods = ligados(contaId);
  const diretor = db.prepare("SELECT tom, tratamento FROM persona_config WHERE conta_id=? AND modulo='diretor'").get(contaId) || {};
  const kit = await import('../integracoes/marca-kit.js'); const k = kit.lerKit(contaId) || {};
  let urlGoogle = null; try { urlGoogle = (await import('../integracoes/google-calendar.js')).urlAutorizacao(contaId); } catch {}
  return {
    concluido: !!conta.onboarding_em || conta.admin === 1,
    conta: { nome_dono: conta.nome_dono || '', empresa: conta.empresa || '' },
    tom: diretor.tom || 'direto', tratamento: diretor.tratamento || 'primeiro nome',
    modulos: Object.fromEntries(MODULOS.map(m => [m, mods.has(m)])),
    telegram: !!db.prepare("SELECT 1 FROM usuarios WHERE conta_id=? AND canal='telegram'").get(contaId),
    google: { conectado: !!db.prepare('SELECT 1 FROM google_auth WHERE conta_id=?').get(contaId), url: urlGoogle },
    instagram: !!db.prepare('SELECT 1 FROM instagram_auth WHERE conta_id=?').get(contaId),
    instagram_url: (await import('../integracoes/instagram-oauth.js')).urlAutorizacao(contaId),
    mia: { identidade: identidade(contaId) || {}, cores: k.cores || {}, assinatura: k.assinatura || '', logos: Object.keys(k.logos || {}).filter(v => k.logos[v]), fontes: k.fontes || '' },
  };
}

/** Testa o que foi conectado. Telegram recebe uma mensagem de teste de verdade. */
export async function testar(contaId) {
  const e = await estado(contaId); const r = [];
  if (e.telegram) {
    try {
      const tg = db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND canal='telegram' AND papel='dono' LIMIT 1").get(contaId)?.chat_id;
      const { canalAtual } = await import('./atual.js'); const c = canalAtual();
      if (c?.tg) await c.tg.enviar(null, tg, '✅ Teste do Fiel: seu Telegram está recebendo as mensagens da equipe.');
      else if (c) await c.enviar(null, tg, '✅ Teste do Fiel: seu Telegram está recebendo as mensagens da equipe.');
      r.push({ id: 'telegram', ok: true, texto: 'Telegram: mensagem de teste enviada — confira no celular' });
    } catch (x) { r.push({ id: 'telegram', ok: false, texto: `Telegram: falhou (${x.message})` }); }
  } else r.push({ id: 'telegram', ok: null, texto: 'Telegram: não conectado (dá para ligar depois em Conexões)' });
  if (e.modulos.secretaria || e.modulos.documentos) {
    if (e.google.conectado) {
      try { const g = await import('../integracoes/google-calendar.js'); await g.tokenAcesso(contaId); const modo = g.modoEscopos?.(contaId); r.push({ id: 'google', ok: true, texto: `Google: conectado e respondendo${modo ? ` (${modo})` : ''}` }); }
      catch (x) { r.push({ id: 'google', ok: false, texto: `Google: a autorização não respondeu (${x.message}). Reconecte em Conexões.` }); }
    } else r.push({ id: 'google', ok: null, texto: 'Google: não conectado — Olga e Estag funcionam, mas sem agenda, e-mail e Drive' });
  }
  if (e.modulos.social) {
    const c = e.mia.cores; const kitOk = !!(c.fundo && c.destaque);
    r.push({ id: 'marca', ok: kitOk ? true : null, texto: kitOk ? `MIA: marca pronta (fundo ${c.fundo} · destaque ${c.destaque}${e.mia.logos.length ? ` · ${e.mia.logos.length} logo(s)` : ''})` : 'MIA: sem cores da marca ainda — as artes saem neutras até você mandar' });
    if (e.instagram) {
      try { const tok = db.prepare('SELECT token FROM instagram_auth WHERE conta_id=?').get(contaId).token; const me = await fetch(`https://graph.instagram.com/me?fields=username&access_token=${tok}`).then(x => x.json()); r.push(me.error ? { id: 'instagram', ok: false, texto: `Instagram: token recusado pela Meta (${me.error.message})` } : { id: 'instagram', ok: true, texto: `Instagram: @${me.username} pronto para publicar` }); }
      catch (x) { r.push({ id: 'instagram', ok: false, texto: `Instagram: falhou (${x.message})` }); }
    } else r.push({ id: 'instagram', ok: null, texto: 'Instagram: não conectado — a MIA cria e agenda; publicar fica para quando conectar' });
  }
  return r;
}

/** Boas-vindas oficial, montada com o que ficou pronto no onboarding. */
export function boasVindas(e) {
  const nome = (e.conta.nome_dono || '').split(' ')[0];
  const time = Object.entries(e.modulos).filter(([, v]) => v).map(([m]) => NOMES[m]);
  const pronto = [], pendente = [];
  (e.telegram ? pronto : pendente).push('Telegram');
  if (e.modulos.secretaria || e.modulos.documentos) (e.google.conectado ? pronto : pendente).push('Google (agenda, e-mail, Drive)');
  if (e.modulos.social) { ((e.mia.cores.fundo && e.mia.cores.destaque) ? pronto : pendente).push('marca da MIA'); (e.instagram ? pronto : pendente).push('Instagram'); }
  const ideias = [
    e.modulos.secretaria && '🎤 "Olga, me lembra amanhã às 9h de ligar pro contador"',
    e.modulos.social && '📸 "MIA, cria um post sobre [seu assunto]" (ou mande uma foto com a ideia)',
    e.modulos.documentos && '📂 Mande um contrato ou nota — o Estag lê, arquiva e avisa os vencimentos',
    e.modulos.financeiro && '💰 Mande o extrato do banco (OFX ou CSV) — a Tina organiza o caixa',
    '🧭 "Alfred, qual a prioridade da semana?"',
  ].filter(Boolean).slice(0, 4);
  const base = (process.env.WEBAPP_URL || process.env.PUBLIC_URL || 'https://usefiel.com').replace(/\/$/, '').replace(/\/app$/, '');
  return `🎉 *Tudo pronto${nome ? ', ' + nome : ''}! Bem-vindo ao Fiel.*\nA equipe que você não precisou contratar.\n\nSou Alfred, o seu Diretor. Sua equipe está de pé: ${time.length ? time.map(t => `*${t}*`).join(', ') : 'só eu, por enquanto'}. Você delega — a gente resolve. Nada sai sem o seu "sim".\n\n${pronto.length ? `✅ Configurado: ${pronto.join(' · ')}\n` : ''}${pendente.length ? `⏳ Fica para depois (em Conexões): ${pendente.join(' · ')}\n` : ''}\n*Para começar agora, mande:*\n${ideias.join('\n')}\n\nVocê tem *250 créditos grátis* — nada expira. Manual completo: ${base}/ajuda · Suporte humano: https://wa.me/5547933883929`;
}

export async function concluir(contaId) {
  const ja = db.prepare('SELECT onboarding_em FROM contas WHERE id=?').get(contaId)?.onboarding_em;
  db.prepare('UPDATE contas SET onboarding_em=COALESCE(onboarding_em, CURRENT_TIMESTAMP) WHERE id=?').run(contaId);
  if (ja) return { ok: true, ja: true };
  const texto = boasVindas(await estado(contaId));
  const chat = donoChat(contaId);
  try { const { canalAtual } = await import('./atual.js'); const c = canalAtual(); if (c && chat) await c.enviar(null, chat, { texto, modulo: 'diretor' }); else throw new Error('sem canal'); }
  catch { db.prepare("INSERT INTO mensagens (conta_id, direcao, canal, modulo, tipo, texto) VALUES (?, 'saida', 'bot', 'diretor', 'texto', ?)").run(contaId, texto); }
  return { ok: true };
}

export function rotasOnboarding(app) {
  const auth = (req, res, next) => { const s = sessao(req); if (!s) return res.status(401).json({ erro: 'não autenticado' }); req.contaId = s.conta_id; next(); };
  const seguro = (f) => async (req, res) => { try { res.json(await f(req)); } catch (e) { console.error('[onboarding]', e.message); res.status(400).json({ erro: e.message }); } };

  app.get('/api/onboarding', auth, seguro(req => estado(req.contaId)));

  app.post('/api/onboarding/passo', auth, seguro(async (req) => {
    const { passo, dados = {} } = req.body || {}; const id = req.contaId;
    if (passo === 'perfil') {
      const nome = String(dados.nome_dono || '').trim().slice(0, 80), empresa = String(dados.empresa || '').trim().slice(0, 120);
      if (nome) db.prepare('UPDATE contas SET nome_dono=? WHERE id=?').run(nome, id);
      if (empresa) db.prepare('UPDATE contas SET empresa=? WHERE id=?').run(empresa, id);
      const tom = ['direto', 'cordial', 'formal', 'descontraído'].includes(dados.tom) ? dados.tom : null;
      const trat = ['primeiro nome', 'você', 'senhor', 'chefe'].includes(dados.tratamento) ? dados.tratamento : null;
      for (const m of ['diretor', ...MODULOS]) {
        db.prepare('INSERT OR IGNORE INTO persona_config (conta_id, modulo) VALUES (?,?)').run(id, m);
        if (tom) db.prepare('UPDATE persona_config SET tom=? WHERE conta_id=? AND modulo=?').run(tom, id, m);
        if (trat) db.prepare('UPDATE persona_config SET tratamento=? WHERE conta_id=? AND modulo=?').run(trat, id, m);
      }
    } else if (passo === 'equipe') {
      for (const m of MODULOS) if (dados[m] !== undefined) db.prepare('INSERT INTO modulos (conta_id, modulo, ligado) VALUES (?,?,?) ON CONFLICT(conta_id, modulo) DO UPDATE SET ligado=excluded.ligado').run(id, m, dados[m] ? 1 : 0);
    } else if (passo === 'mia') {
      const atual = identidade(id) || {};
      const perfil = String(dados.perfil || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?].*$/, '');
      const arroba = perfil ? (perfil.startsWith('@') ? perfil : '@' + perfil) : '';
      const novo = { ...atual };
      if (arroba) novo.perfil = arroba;
      for (const k of ['nicho', 'categoria', 'publico', 'tom', 'descricao']) if (String(dados[k] || '').trim()) novo[k] = String(dados[k]).trim().slice(0, 400);
      db.prepare('INSERT INTO social_identidade (conta_id, dados) VALUES (?,?) ON CONFLICT(conta_id) DO UPDATE SET dados=excluded.dados').run(id, JSON.stringify(novo));
      const kit = await import('../integracoes/marca-kit.js');
      const conta = db.prepare('SELECT empresa FROM contas WHERE id=?').get(id) || {};
      const campos = { cores: {} };
      if (dados.cor_fundo) campos.cores.fundo = dados.cor_fundo;
      if (dados.cor_destaque) campos.cores.destaque = dados.cor_destaque;
      if (arroba) campos.assinatura = arroba;
      if (!kit.lerKit(id)?.nome && conta.empresa) campos.nome = conta.empresa;
      kit.salvarKit(id, campos);
    } else throw new Error('etapa inválida');
    return { ok: true, estado: await estado(id) };
  }));

  // logo(s) ou manual da marca enviados no onboarding (PDF → lê cores/fontes; imagem → logo)
  app.post('/api/onboarding/marca', auth, seguro(async (req) => {
    const { campos, arquivo } = await lerMultipart(req); if (!arquivo?.bytes?.length) throw new Error('arquivo vazio');
    const mime = arquivo.mime || ''; const id = req.contaId;
    if (/pdf/i.test(mime) || campos.tipo === 'manual') {
      const mm = await import('../integracoes/manual-marca.js');
      const r = await mm.lerManual(id, arquivo.bytes, /pdf/i.test(mime) ? 'application/pdf' : mime);
      if (!r.legivel) throw new Error('não consegui ler cores nesse arquivo — escolha as cores abaixo ou mande um print da página de cores');
      return { tipo: 'manual', cores: r.kit.cores, fontes: r.fontes, paleta: r.cores_encontradas };
    }
    if (!/^image\//.test(mime)) throw new Error('mande a logo em PNG/JPG ou o manual em PDF');
    const { guardarImagemEnviada } = await import('../ferramentas/social.js');
    const kit = await import('../integracoes/marca-kit.js');
    const g = await guardarImagemEnviada(id, arquivo.bytes, { tipo: 'logo', marcar: false });
    let variante = 'principal'; try { variante = (await (await import('../integracoes/render.js')).analisarLogo(arquivo.bytes))?.sugestao || 'principal'; } catch {}
    const s = kit.salvarLogo(id, g.original, variante);
    return { tipo: 'logo', variante: s.variante, url: g.original };
  }));

  app.post('/api/onboarding/teste', auth, seguro(req => testar(req.contaId).then(itens => ({ itens }))));
  app.post('/api/onboarding/concluir', auth, seguro(req => concluir(req.contaId)));
}
