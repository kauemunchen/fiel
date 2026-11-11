// API: Calendário editorial (posts, biblioteca) e Documentos (arquivo, vencimentos, cadastros).
import { db } from '../db/index.js';
import { sessao } from './web.js';
import { contextoUso } from '../integracoes/gemini.js';

const cacheAgenda = new Map();
export function rotasDados(app) {
  const auth = (req, res, next) => { const s = sessao(req); if (!s) return res.status(401).json({ erro: 'não autenticado' }); req.contaId = s.conta_id; req.chatId = s.chat_id; contextoUso.contaId = s.conta_id; next(); };
  const conta = (req) => db.prepare('SELECT * FROM contas WHERE id=?').get(req.contaId);
  const mapaPost = (p) => ({ id: p.id, formato: p.formato, pilar: p.pilar, tema: p.tema, data: p.data, legenda: p.legenda, hashtags: p.hashtags, status: p.status, ig_media_id: p.ig_media_id, publicado_em: p.publicado_em, criado_em: p.criado_em,
    midias: p.midia_url ? (p.midia_url.startsWith('[') ? JSON.parse(p.midia_url) : [p.midia_url]) : [], video: !!p.midia_url && /\.(mp4|mov|webm)(\?|$)|\/video\/upload\//.test(p.midia_url) });

  // ---------- Calendário editorial ----------
  app.get('/api/editorial', auth, (req, res) => {
    const { de, ate } = req.query;
    const rows = de && ate ? db.prepare("SELECT * FROM posts WHERE conta_id=? AND ((data BETWEEN ? AND ?) OR data IS NULL) ORDER BY data IS NULL, data").all(req.contaId, de, ate + 'T23:59') : db.prepare('SELECT * FROM posts WHERE conta_id=? ORDER BY data IS NULL, data DESC LIMIT 300').all(req.contaId);
    res.json(rows.map(mapaPost));
  });
  app.post('/api/editorial/:id', auth, async (req, res) => {
    const soc = await import('../ferramentas/social.js'); const c = conta(req); const b = req.body || {};
    const p = db.prepare('SELECT * FROM posts WHERE id=? AND conta_id=?').get(req.params.id, req.contaId); if (!p) return res.status(404).json({ erro: 'post não existe' });
    if (b.data !== undefined) {
      if (b.data) { await soc.executar('agendar_post', { post_id: p.id, data: b.data }, c, { chatId: req.chatId }); }
      else { db.prepare("UPDATE posts SET status='rascunho', data=NULL WHERE id=?").run(p.id); }
    }
    const campos = {}; for (const k of ['legenda', 'hashtags', 'tema', 'pilar', 'formato']) if (b[k] !== undefined) campos[k] = b[k];
    if (Object.keys(campos).length) await soc.executar('atualizar_post', { post_id: p.id, ...campos }, c, { chatId: req.chatId });
    res.json(mapaPost(db.prepare('SELECT * FROM posts WHERE id=?').get(p.id)));
  });
  app.post('/api/editorial/:id/publicar', auth, async (req, res) => {
    const soc = await import('../ferramentas/social.js');
    try { const r = await soc.publicarPost(req.contaId, Number(req.params.id)); res.json({ ok: true, ...r }); } catch (e) { db.prepare("UPDATE posts SET status='erro' WHERE id=? AND conta_id=?").run(req.params.id, req.contaId); res.status(400).json({ erro: e.message }); }
  });
  app.delete('/api/editorial/:id', auth, async (req, res) => {
    const p = db.prepare('SELECT * FROM posts WHERE id=? AND conta_id=?').get(req.params.id, req.contaId); if (!p) return res.status(404).json({ erro: 'post não existe' });
    if (p.status === 'publicado') return res.status(400).json({ erro: 'post já publicado; apague no Instagram' });
    if (p.gcal_event_id) { try { const g = await import('../integracoes/google-calendar.js'); await g.cancelarEvento(req.contaId, p.gcal_event_id); } catch {} }
    db.prepare('DELETE FROM posts WHERE id=?').run(p.id); res.json({ ok: true });
  });
  // Descarta de uma vez os rascunhos de post sem data (nunca toca em agendados nem publicados).
  app.delete('/api/rascunhos-sem-data', auth, (req, res) => {
    const r = db.prepare("DELETE FROM posts WHERE conta_id=? AND status='rascunho' AND data IS NULL").run(req.contaId); res.json({ ok: true, removidos: r.changes });
  });
  app.get('/api/biblioteca', auth, async (req, res) => {
    const soc = await import('../ferramentas/social.js');
    const aj = await import('./api-marca.js'); const dias = Number(aj.ajuste(req.contaId, 'retencao_biblioteca_dias', process.env.BIBLIOTECA_RETENCAO_DIAS || 15));
    const rows = db.prepare('SELECT * FROM biblioteca WHERE conta_id=? ORDER BY id DESC LIMIT 200').all(req.contaId);
    res.json(rows.map(b => ({ id: b.id, tipo: b.tipo, origem: b.origem, descricao: b.descricao, url: b.marcada_url || b.url, original: b.url, duracao: b.duracao, largura: b.largura, altura: b.altura, usada: !!b.usado_em, protegida: !!b.protegida, em: b.criado_em, dias_restantes: b.protegida ? null : dias - Math.floor((Date.now() - new Date(b.criado_em.replace(' ', 'T') + 'Z')) / 864e5) })));
  });
  app.post('/api/biblioteca/:id', auth, (req, res) => {
    const b = req.body || {}; if (b.protegida !== undefined) db.prepare('UPDATE biblioteca SET protegida=? WHERE id=? AND conta_id=?').run(b.protegida ? 1 : 0, req.params.id, req.contaId);
    if (b.descricao !== undefined) db.prepare('UPDATE biblioteca SET descricao=? WHERE id=? AND conta_id=?').run(b.descricao, req.params.id, req.contaId);
    res.json({ ok: true });
  });
  app.delete('/api/biblioteca/:id', auth, async (req, res) => {
    const b = db.prepare('SELECT * FROM biblioteca WHERE id=? AND conta_id=?').get(req.params.id, req.contaId); if (!b) return res.status(404).json({ erro: 'não existe' });
    const emUso = db.prepare("SELECT id FROM posts WHERE conta_id=? AND status IN ('agendado','rascunho') AND (midia_url LIKE ? OR midia_url LIKE ?)").get(req.contaId, `%${b.url}%`, `%${b.marcada_url || '∅'}%`);
    if (emUso) return res.status(400).json({ erro: `em uso no post #${emUso.id}` });
    const { apagar } = await import('../integracoes/cloudinary.js'); for (const u of [b.url, b.marcada_url].filter(Boolean)) { try { await apagar(u); } catch {} }
    db.prepare('DELETE FROM biblioteca WHERE id=?').run(b.id); res.json({ ok: true });
  });
  app.post('/api/biblioteca/:id/post', auth, async (req, res) => {
    const b = db.prepare('SELECT * FROM biblioteca WHERE id=? AND conta_id=?').get(req.params.id, req.contaId); if (!b) return res.status(404).json({ erro: 'não existe' });
    const soc = await import('../ferramentas/social.js'); const { formato = (b.tipo === 'video' ? 'reels' : 'post'), data, legenda = '' } = req.body || {};
    const r = await soc.executar('criar_post', { formato, tema: b.descricao || formato, legenda, midia_url: b.marcada_url || b.url, data: data || undefined }, conta(req), { chatId: req.chatId });
    db.prepare('UPDATE biblioteca SET usado_em=CURRENT_TIMESTAMP WHERE id=?').run(b.id); res.json(r);
  });

  // ---------- Documentos ----------
  app.get('/api/documentos', auth, (req, res) => {
    const { q, empresa, tipo } = req.query; const termos = String(q || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    let rows = db.prepare(`SELECT * FROM documentos WHERE conta_id=? AND status='ativo' ${empresa ? 'AND empresa=?' : ''} ${tipo ? 'AND tipo=?' : ''} ORDER BY data_doc DESC LIMIT 500`).all(req.contaId, ...(empresa ? [empresa] : []), ...(tipo ? [tipo] : []));
    if (termos.length) rows = rows.filter(d => { const t = `${d.titulo} ${d.contraparte} ${d.empresa} ${d.tipo} ${d.resumo} ${d.dados_json}`.toLowerCase(); return termos.every(x => t.includes(x)); });
    const empresas = db.prepare("SELECT empresa, COUNT(*) n FROM documentos WHERE conta_id=? AND status='ativo' GROUP BY empresa ORDER BY n DESC").all(req.contaId);
    const tipos = db.prepare("SELECT tipo, COUNT(*) n FROM documentos WHERE conta_id=? AND status='ativo' GROUP BY tipo ORDER BY n DESC").all(req.contaId);
    const c = conta(req);
    res.json({ docs: rows.slice(0, 200).map(d => ({ id: d.id, titulo: d.titulo, empresa: d.empresa, tipo: d.tipo, contraparte: d.contraparte, data: d.data_doc, pasta: d.pasta, link: d.drive_link, resumo: d.resumo, sensivel: !!d.sensivel, mime: d.mime, em: d.criado_em })), empresas, tipos, pasta_raiz: c.drive_pasta_id ? `https://drive.google.com/drive/folders/${c.drive_pasta_id}` : null });
  });
  app.post('/api/documentos/:id', auth, async (req, res) => {
    const doc = await import('../ferramentas/documentos.js'); const b = req.body || {};
    try { res.json(await doc.executar('atualizar_documento', { documento_id: Number(req.params.id), titulo: b.titulo, empresa: b.empresa, tipo: b.tipo, contraparte: b.contraparte, data_doc: b.data }, conta(req), {})); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.get('/api/vencimentos', auth, (req, res) => {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const rows = db.prepare(`SELECT v.*, d.drive_link, d.titulo doc_titulo FROM vigencias v LEFT JOIN documentos d ON d.id=v.documento_id WHERE v.conta_id=? AND v.status='ativa' ORDER BY v.vence_em`).all(req.contaId);
    res.json(rows.map(v => ({ id: v.id, descricao: v.descricao, empresa: v.empresa, tipo: v.tipo, inicio: v.inicio, vence_em: v.vence_em, dias: Math.ceil((new Date(v.vence_em) - new Date(hoje)) / 864e5), aviso_previo_dias: v.aviso_previo_dias, renovacao_auto: !!v.renovacao_auto, link: v.drive_link, documento: v.doc_titulo, avisos: v.avisos_enviados })));
  });
  app.post('/api/vencimentos', auth, async (req, res) => {
    const doc = await import('../ferramentas/documentos.js'); const b = req.body || {};
    try { res.json(await doc.executar('registrar_vigencia', b, conta(req), {})); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.post('/api/vencimentos/:id/encerrar', auth, async (req, res) => {
    const doc = await import('../ferramentas/documentos.js');
    try { res.json(await doc.executar('encerrar_vigencia', { vigencia_id: Number(req.params.id), nova_data: req.body?.nova_data, motivo: req.body?.motivo }, conta(req), { confirmado: true })); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.get('/api/cadastros', auth, (req, res) => {
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    res.json(db.prepare('SELECT * FROM cadastros WHERE conta_id=? AND (lower(nome) LIKE ? OR documento LIKE ? OR lower(email) LIKE ? OR telefone LIKE ?) ORDER BY nome LIMIT 300').all(req.contaId, q, q, q, q)
      .map(c => ({ id: c.id, tipo: c.tipo, nome: c.nome, documento: c.documento, email: c.email, telefone: c.telefone, endereco: c.endereco, empresa_vinculo: c.empresa_vinculo, campos: JSON.parse(c.campos_json || '{}'), completo: !!c.completo, em: c.atualizado_em })));
  });
  app.post('/api/cadastros', auth, async (req, res) => {
    const doc = await import('../ferramentas/documentos.js');
    try { res.json(await doc.executar('salvar_cadastro', req.body || {}, conta(req), { confirmado: true })); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  app.delete('/api/cadastros/:id', auth, (req, res) => { db.prepare('DELETE FROM cadastros WHERE id=? AND conta_id=?').run(req.params.id, req.contaId); res.json({ ok: true }); });

  // ---------- Hoje: o dia do dono em sequência (precisa de você → equipe já fez → ainda hoje) ----------
  app.get('/api/hoje', auth, async (req, res) => {
    const id = req.contaId; const TZ = 'America/Sao_Paulo';
    const agora = new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16); const hoje = agora.slice(0, 10);
    const amanha = new Date(new Date(hoje + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);
    const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
    const nomes = Object.fromEntries(q('SELECT modulo, nome FROM persona_config WHERE conta_id=?', id).map(r => [r.modulo, r.nome]));
    const quem = (m) => nomes[m] || { diretor: 'Alfred', secretaria: 'Olga', documentos: 'Estag', financeiro: 'Tina', social: 'MIA' }[m] || 'Fiel';
    const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const curto = (t, n = 90) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
    const precisa = [], feito = [], depois = [];

    // 1. Precisa de você
    for (const f of q(`SELECT id, descricao, contraparte, valor, vencimento, documento FROM fin_lancamentos WHERE conta_id=? AND tipo='saida' AND status IN ('pendente','previsto') AND oculto=0 AND vencimento IS NOT NULL AND vencimento<=? ORDER BY vencimento LIMIT 6`, id, hoje)) {
      const atrasado = f.vencimento < hoje;
      precisa.push({ tipo: 'conta', modulo: 'financeiro', quem: quem('financeiro'), titulo: `${curto(f.descricao || f.contraparte || 'Conta a pagar', 60)} · ${brl(f.valor)}`,
        detalhe: atrasado ? `venceu em ${f.vencimento.split('-').reverse().join('/')}` : 'vence hoje', alerta: true,
        acoes: [...(f.documento && /^[\d .]{30,}$/.test(f.documento) ? [{ rotulo: 'Copiar código', copiar: f.documento.replace(/\D/g, '') }] : []), { rotulo: 'Já paguei', cmd: `Tina, já paguei: ${f.descricao || f.contraparte} (${brl(f.valor)}).`, sec: true }] });
    }
    for (const p of q(`SELECT id, tema FROM posts WHERE conta_id=? AND status='erro' ORDER BY id DESC LIMIT 3`, id))
      precisa.push({ tipo: 'post', modulo: 'social', quem: quem('social'), titulo: `Post não publicou: ${curto(p.tema || 'sem tema', 50)}`, detalhe: 'precisa tentar de novo', alerta: true,
        acoes: [{ rotulo: 'Abrir no calendário', tela: 'editorial' }, { rotulo: 'Descartar', excluir: `/api/editorial/${p.id}`, sec: true }] });
    // Rascunhos sem data: até 2 aparecem um a um; mais que isso viram UM cartão (não lotam a tela).
    const rasc = q(`SELECT id, tema FROM posts WHERE conta_id=? AND status='rascunho' AND data IS NULL ORDER BY id DESC`, id);
    if (rasc.length && rasc.length <= 2) for (const p of rasc)
      precisa.push({ tipo: 'post', modulo: 'social', quem: quem('social'), titulo: `Rascunho de post: ${curto(p.tema || 'sem tema', 50)}`, detalhe: 'escolha a data ou descarte',
        acoes: [{ rotulo: 'Abrir no calendário', tela: 'editorial' }, { rotulo: 'Descartar', excluir: `/api/editorial/${p.id}`, sec: true }] });
    else if (rasc.length > 2)
      precisa.push({ tipo: 'post', modulo: 'social', quem: quem('social'), titulo: `${rasc.length} rascunhos de post sem data`, detalhe: `o mais recente: ${curto(rasc[0].tema || 'sem tema', 40)}`,
        acoes: [{ rotulo: 'Abrir no calendário', tela: 'editorial' }, { rotulo: 'Descartar todos', excluir: '/api/rascunhos-sem-data', sec: true }] });
    for (const t of q(`SELECT titulo, prazo FROM tarefas WHERE conta_id=? AND status='aberta' AND prazo IS NOT NULL AND prazo<=? ORDER BY prazo LIMIT 4`, id, hoje))
      precisa.push({ tipo: 'tarefa', modulo: 'secretaria', quem: quem('secretaria'), titulo: curto(t.titulo, 70), detalhe: t.prazo < hoje ? 'tarefa atrasada' : 'prazo hoje', alerta: t.prazo < hoje,
        acoes: [{ rotulo: 'Concluir', cmd: `Olga, marca como concluída a tarefa "${t.titulo}".` }] });
    for (const r of q(`SELECT pessoa, assunto, direcao FROM retornos WHERE conta_id=? AND status='aberto' ORDER BY id DESC LIMIT 3`, id))
      precisa.push({ tipo: 'retorno', modulo: 'secretaria', quem: quem('secretaria'), titulo: String(r.direcao).startsWith('devo') ? `Retornar ${curto(r.pessoa, 30)}` : `Aguardando ${curto(r.pessoa, 30)}`, detalhe: curto(r.assunto, 70),
        acoes: [{ rotulo: 'Ver com a Olga', cmd: `Olga, como está o retorno com ${r.pessoa} sobre ${r.assunto}?`, sec: true }] });

    // 2. A equipe já fez (hoje)
    for (const i of q(`SELECT modulo, entrada, saida, datetime(criado_em,'-3 hours') em FROM interacoes WHERE conta_id=? AND date(criado_em,'-3 hours')=? AND saida IS NOT NULL AND saida<>'' ORDER BY id DESC LIMIT 8`, id, hoje))
      feito.push({ modulo: i.modulo, quem: quem(i.modulo), titulo: curto(i.entrada || 'Pedido atendido', 80), detalhe: curto(String(i.saida).split(/\n/)[0], 90), hora: (i.em || '').slice(11, 16) });
    for (const p of q(`SELECT tema, datetime(publicado_em,'-3 hours') em FROM posts WHERE conta_id=? AND status='publicado' AND date(publicado_em,'-3 hours')=?`, id, hoje))
      feito.push({ modulo: 'social', quem: quem('social'), titulo: `Post publicado: ${curto(p.tema || 'Instagram', 60)}`, detalhe: 'no Instagram', hora: (p.em || '').slice(11, 16) });
    feito.sort((a, b) => (b.hora || '').localeCompare(a.hora || ''));

    // 3. Ainda hoje
    try {
      // Agenda do Google: cache de 3 min por conta e no máximo 2,5 s de espera (a tela não fica presa no Google).
      const gcal = await import('../integracoes/google-calendar.js'); const c = cacheAgenda.get(id);
      let evs;
      if (c && Date.now() - c.t < 180000 && c.dia === hoje) evs = c.evs.filter(e => !e.start?.dateTime || new Date(e.start.dateTime) >= new Date(agora + ':00-03:00'));
      else { const busca = gcal.listarEventos(id, { inicio: new Date(hoje + 'T00:00:00-03:00').toISOString(), fim: new Date(amanha + 'T00:00:00-03:00').toISOString(), max: 20 }).then(l => { cacheAgenda.set(id, { t: Date.now(), dia: hoje, evs: l || [] }); return l; });
        busca.catch(() => {}); evs = await Promise.race([busca, new Promise((_, r) => setTimeout(() => r(new Error('tempo')), 2500))]); evs = (evs || []).filter(e => !e.start?.dateTime || new Date(e.start.dateTime) >= new Date(agora + ':00-03:00')); }
      for (const e of evs || []) { const h = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : 'dia todo';
        depois.push({ hora: h, titulo: curto(e.summary || 'Compromisso', 60), detalhe: curto(e.location || '', 60), modulo: 'secretaria', quem: quem('secretaria') }); }
    } catch {}
    for (const l of q(`SELECT texto, quando, modulo FROM lembretes WHERE conta_id=? AND enviado=0 AND quando>=? AND quando<? ORDER BY quando LIMIT 8`, id, agora, amanha + 'T00:00'))
      depois.push({ hora: (l.quando || '').slice(11, 16), titulo: curto(l.texto, 70), detalhe: `${quem(l.modulo || 'secretaria')} vai te lembrar`, modulo: l.modulo || 'secretaria', quem: quem(l.modulo || 'secretaria') });
    for (const p of q(`SELECT tema, data FROM posts WHERE conta_id=? AND status='agendado' AND data>=? AND data<? ORDER BY data`, id, agora, amanha + 'T00:00'))
      depois.push({ hora: (p.data || '').slice(11, 16), titulo: `Post vai ao ar: ${curto(p.tema || 'Instagram', 50)}`, detalhe: `${quem('social')} publica sozinha`, modulo: 'social', quem: quem('social') });
    depois.sort((a, b) => (a.hora === 'dia todo' ? '00:00' : a.hora).localeCompare(b.hora === 'dia todo' ? '00:00' : b.hora));

    let saldo = null;
    const s = q(`SELECT carteira, saldo, data FROM fin_saldos WHERE conta_id=? ORDER BY data DESC, id DESC LIMIT 1`, id)[0];
    if (s) saldo = { carteira: s.carteira, valor: s.saldo, texto: brl(s.saldo), data: s.data };
    const h = Number(agora.slice(11, 13));
    res.json({ data: hoje, saudacao: h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite', precisa, feito, depois, saldo,
      total: precisa.length + feito.length + depois.length });
  });

  // ---------- Financeiro (Tina): painel gerencial ----------
  app.get('/api/financeiro/painel', auth, async (req, res) => {
    const F = await import('../ferramentas/financeiro.js'); F.prepararFinanceiro();
    const id = req.contaId; const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    const soma = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
    const mesAnt = (m) => { const [a, b] = m.split('-').map(Number); return b === 1 ? `${a - 1}-12` : `${a}-${String(b - 1).padStart(2, '0')}`; };
    const todas = [...new Set([...F.carteirasDe(id), ...db.prepare('SELECT DISTINCT carteira FROM fin_lancamentos WHERE conta_id=? AND oculto=0').all(id).map(r => r.carteira), ...db.prepare('SELECT DISTINCT carteira FROM fin_saldos WHERE conta_id=?').all(id).map(r => r.carteira)])].filter(Boolean);
    const cart = req.query.carteira && todas.includes(req.query.carteira) ? req.query.carteira : null;
    const carts = cart ? [cart] : todas;
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoje.slice(0, 7);
    const cond = cart ? ' AND carteira=?' : ''; const ca = cart ? [cart] : [];
    const efet = 'COALESCE(pago_em, data)'; const semTransf = "AND COALESCE(categoria,'')<>'Transferência'";
    const r2 = (v) => +Number(v || 0).toFixed(2);
    const totMes = (m) => { const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) ent, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor END),0) sai, COUNT(*) n FROM fin_lancamentos WHERE conta_id=?${cond} AND status='pago' AND oculto=0 ${semTransf} AND substr(${efet},1,7)=?`).get(id, ...ca, m); return { recebido: r2(r.ent), pago: r2(r.sai), resultado: r2(r.ent - r.sai), lancamentos: r.n }; };
    const atual = totMes(mes), anterior = totMes(mesAnt(mes));
    const saldos = carts.map(c => ({ carteira: c, ...F.saldoAtual(id, c) }));
    const saldoHoje = r2(saldos.reduce((a, s) => a + s.saldo, 0));
    const prev = db.prepare(`SELECT id, carteira, tipo, valor, descricao, contraparte, categoria, COALESCE(vencimento,data) venc, documento FROM fin_lancamentos WHERE conta_id=?${cond} AND status IN ('previsto','pendente') AND oculto=0 ORDER BY venc`).all(id, ...ca);
    const ate = (d) => prev.filter(p => p.venc <= d);
    const somaT = (l, t) => r2(l.filter(p => p.tipo === t).reduce((a, p) => a + p.valor, 0));
    const atras = prev.filter(p => p.venc < hoje);
    const p30 = ate(soma(hoje, 30));
    // Previsão: saldo dia a dia nos próximos 90 dias (atrasados entram hoje)
    const serie = []; let corr = saldoHoje; const porDia = {};
    for (const p of prev) { const d = p.venc < hoje ? hoje : p.venc; porDia[d] = (porDia[d] || 0) + (p.tipo === 'entrada' ? p.valor : -p.valor); }
    let minimo = { valor: saldoHoje, dia: hoje };
    for (let k = 0; k <= 90; k++) { const d = soma(hoje, k); corr += porDia[d] || 0; serie.push({ d, v: r2(corr) }); if (corr < minimo.valor) minimo = { valor: r2(corr), dia: d }; }
    const proj = (n) => serie[n]?.v ?? saldoHoje;
    // Últimos 6 meses
    const meses = []; let m = mes; for (let k = 0; k < 6; k++) { meses.unshift(m); m = mesAnt(m); }
    const historico = meses.map(mm => ({ mes: mm, ...totMes(mm) }));
    const categorias = db.prepare(`SELECT COALESCE(categoria,'Sem categoria') categoria, SUM(valor) total FROM fin_lancamentos WHERE conta_id=?${cond} AND status='pago' AND oculto=0 AND tipo='saida' ${semTransf} AND substr(${efet},1,7)=? GROUP BY 1 ORDER BY total DESC LIMIT 6`).all(id, ...ca, mes).map(c => ({ categoria: c.categoria, total: r2(c.total) }));
    const ultimos = db.prepare(`SELECT id, carteira, tipo, valor, descricao, contraparte, categoria, ${efet} quando FROM fin_lancamentos WHERE conta_id=?${cond} AND status='pago' AND oculto=0 ORDER BY ${efet} DESC, id DESC LIMIT 10`).all(id, ...ca);
    res.json({ hoje, mes, carteira: cart, carteiras: todas, vazio: !prev.length && !ultimos.length && !saldos.some(s => s.tem_saldo_inicial),
      saldo: { hoje: saldoHoje, por_carteira: saldos.map(s => ({ carteira: s.carteira, saldo: s.saldo, base: s.base })) },
      mes_atual: atual, mes_anterior: { mes: mesAnt(mes), ...anterior },
      abertos: { a_receber_30: somaT(p30, 'entrada'), a_pagar_30: somaT(p30, 'saida'), atrasado_receber: somaT(atras, 'entrada'), atrasado_pagar: somaT(atras, 'saida'), n_atrasados: atras.length },
      previsao: { d30: proj(30), d60: proj(60), d90: proj(90), menor: minimo, serie },
      historico, categorias, ultimos,
      vencimentos: prev.filter(p => p.venc <= soma(hoje, 30)).slice(0, 12).map(p => ({ ...p, atrasado: p.venc < hoje, hoje: p.venc === hoje })) });
  });
}
