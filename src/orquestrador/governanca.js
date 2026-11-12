// Comandos de governança tratados antes da IA: ligar/desligar módulos, conectar Google, ajustar persona.
import { db } from '../db/index.js';
import { urlAutorizacao, listarEventos, listarCalendarios, obterOuCriarCalendario } from '../integracoes/google-calendar.js';
const MODS = { secretaria: 'Secretária', producao: 'Produção', documentos: 'Documentos', financeiro: 'Financeiro', social: 'MIA (Social Media)' };
const alias = { secretária: 'secretaria', produção: 'producao', financeira: 'financeiro', 'social media': 'social', instagram: 'social', mia: 'social', docs: 'documentos' };
const semAcento = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s) => alias[s] || alias[semAcento(s)] || semAcento(s);

const fmtHora = (e) => e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : 'dia todo';
const fmtDia = (e) => new Date(e.start?.dateTime || e.start?.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
async function agenda(conta, dias, titulo) {
  const ini = new Date(); ini.setHours(0, 0, 0, 0); if (dias === 'amanha') ini.setDate(ini.getDate() + 1);
  const fim = new Date(ini); fim.setDate(fim.getDate() + (dias === 'semana' ? 7 : 1));
  const evs = await listarEventos(conta.id, { inicio: ini.toISOString(), fim: fim.toISOString() });
  if (!evs.length) return `${titulo}: nada marcado.`;
  const linhas = evs.map(e => `- ${dias === 'semana' ? fmtDia(e) + ' ' : ''}${fmtHora(e)} ${e.summary || '(sem título)'}${e.categoria && e.categoria !== conta.nome_dono ? ' [' + e.categoria + ']' : ''}${e.location ? ' · ' + e.location : ''}`);
  return `*${titulo}* (${evs.length})\n${linhas.join('\n')}`;
}

export async function governanca(msg, conta) {
  const orig = msg.texto.trim();
  const t = orig.toLowerCase();
  const caso = (frag) => orig.slice(t.indexOf(frag), t.indexOf(frag) + frag.length); // mesmo trecho com a caixa original
  let m;
  if ((m = orig.match(/^igok:(\d+)$/))) {
    if (db.prepare('SELECT admin FROM contas WHERE id=?').get(conta.id)?.admin !== 1) return 'Esse botão é do suporte do Fiel.';
    try { const l = await import('../integracoes/instagram-liberacao.js'); const r = await l.marcarLiberado(Number(m[1])); return `✅ Cliente avisado: ${r.arroba} liberado (conta #${r.conta_id}). Ele vai aceitar o convite e conectar.`; } catch (e) { return `Não consegui marcar: ${e.message}`; }
  }
  if ((m = t.match(/^(?:me chamo|meu nome é|pode me chamar de)\s+(.+)$/))) { db.prepare('UPDATE contas SET nome_dono=? WHERE id=?').run(caso(m[1]), conta.id); return `Anotado, ${caso(m[1])}.`; }
  if ((m = t.match(/^(?:minha empresa é|a empresa é|empresa:)\s+(.+)$/))) { db.prepare('UPDATE contas SET empresa=? WHERE id=?').run(caso(m[1]), conta.id); return `Empresa principal: ${caso(m[1])}.`; }
  if ((m = t.match(/^(?:diretor,?\s*)?(ativa|liga|ativar|ligar)\s+(?:o|a|módulo|modulo)?\s*([\wçãõáéíóú ]+)$/))) {
    const mod = norm(m[2].trim()); if (!MODS[mod]) return `Não conheço o módulo "${m[2]}". Disponíveis: ${Object.values(MODS).join(', ')}.`;
    db.prepare('INSERT INTO modulos (conta_id, modulo, ligado) VALUES (?,?,1) ON CONFLICT(conta_id, modulo) DO UPDATE SET ligado=1').run(conta.id, mod);
    return `✅ ${MODS[mod]} ligado. ${mod === 'producao' ? 'Preciso do token do AgilFac da sua empresa.' : mod === 'social' ? 'Preciso conectar seu Instagram.' : mod === 'documentos' ? 'Diga "conectar google" de novo e aceite o acesso ao Drive; depois é só mandar foto, PDF ou link do Drive. Para escolher a pasta: documentos pasta <link>.' : 'Já pode usar.'}`;
  }
  if ((m = t.match(/^(?:diretor,?\s*)?(desativa|desliga|desativar|desligar)\s+(?:o|a|módulo|modulo)?\s*([\wçãõáéíóú ]+)$/))) {
    const mod = norm(m[2].trim()); if (!MODS[mod]) return `Não conheço o módulo "${m[2]}".`;
    db.prepare('UPDATE modulos SET ligado=0 WHERE conta_id=? AND modulo=?').run(conta.id, mod);
    return `${MODS[mod]} desligado. Os dados ficam guardados.`;
  }
  if ((m = String(orig || t).trim().match(/^\/?cupom\s+([A-Za-z0-9_-]{3,40})$/i))) {
    const CU = await import('../creditos/cupons.js');
    try { const r = CU.resgatarCupom(conta.id, m[1]); return `🎁 Cupom *${r.codigo}* ativado: ${r.beneficio}.${r.ilimitado_ate ? `\nUso sem limite até ${r.ilimitado_ate.split('-').reverse().join('/')} — use à vontade.` : ''}${r.creditos ? `\n+${r.creditos.toLocaleString('pt-BR')} créditos já estão no seu saldo.` : ''}${r.desconto_pct ? `\nO desconto vale até ${r.desconto_ate.split('-').reverse().join('/')} — é só digitar *comprar*.` : ''}`; }
    catch (e) { return `Não consegui ativar o cupom: ${e.message}`; }
  }
  if (/^(cr[ée]ditos?|saldo)$/.test(t)) { const c = await import('../creditos/index.js'); return c.textoResumo(conta.id); }
  // ---- Compra de créditos: fluxo guiado com botões (pacote → forma → CPF/e-mail uma vez → QR/fatura) ----
  if (/^(comprar|planos?|recarregar|recarga)( cr[ée]ditos?)?$/.test(t) || /^comprar\s/.test(t) || compraPendente.has(msg.chatId)) {
    const r = await fluxoCompra(msg, conta, t, orig); if (r) return r;
  }
  if (/^status$|^conex[õo]es$/.test(t)) {
    const g = db.prepare('SELECT token_json FROM google_auth WHERE conta_id=?').get(conta.id);
    const ig = db.prepare('SELECT * FROM instagram_auth WHERE conta_id=?').get(conta.id);
    let igStatus = ig ? '✅' : '❌';
    if (ig) { try { const r = await fetch(`https://graph.instagram.com/me?fields=username&access_token=${ig.token}`).then(r => r.json()); igStatus = r.error ? `❌ token inválido (${r.error.code}) — gere um novo e mande "conectar instagram <id> <token>"` : `✅ @${r.username}`; } catch { igStatus = '⚠️ não consegui validar'; } }
    return `Conexões:\n- Google Agenda/Gmail: ${g ? '✅ conectado' : '❌ não conectado (diga "conectar google")'}\n- Google Drive: ${g && /auth\/drive/.test(JSON.parse(g.token_json || '{}').scope || '') ? '✅' : '❌ (diga "conectar google" de novo e aceite o Drive)'}\n- Google Tasks: ${g && /auth\/tasks/.test(JSON.parse(g.token_json || '{}').scope || '') ? '✅' : '❌ (diga "conectar google" de novo e aceite as tarefas)'}\n- Instagram: ${igStatus}\n- AgilFac: ${process.env.AGILFAC_API_URL ? '✅' : '❌'}`;
  }
  if (/^agenda( de)? hoje$|^(o que|oq) (eu )?tenho hoje\??$|^hoje\??$/.test(t)) return agenda(conta, 'hoje', 'Hoje');
  if (/^agenda( de)? amanh[ãa]$|^(o que|oq) (eu )?tenho amanh[ãa]\??$/.test(t)) return agenda(conta, 'amanha', 'Amanhã');
  if (/^agenda( da)? semana$|^(o que|oq) (eu )?tenho (essa |nesta |na )?semana\??$|^semana$/.test(t)) return agenda(conta, 'semana', 'Próximos 7 dias');
  if (/^(programa[çc][ãa]o|posts? agendados?|calend[áa]rio editorial)$/.test(t)) {
    const ps = db.prepare("SELECT id, formato, tema, data, status FROM posts WHERE conta_id=? AND status IN ('rascunho','agendado') ORDER BY data IS NULL, data").all(conta.id);
    if (!ps.length) return 'Nada programado. Peça à MIA: "cria um post sobre …".';
    return `*Programação* (${ps.length})\n${ps.map(p => `- #${p.id} ${p.status === 'agendado' ? new Date(p.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'rascunho'} · ${p.formato}: ${p.tema || '(sem tema)'}`).join('\n')}`;
  }
  if (/^(categorias|marcadores|calend[áa]rios)$/.test(t)) {
    const c = await listarCalendarios(conta.id);
    return `Marcadores da agenda:\n${c.map(x => `- ${x.nome}${x.primario ? ' (principal)' : ''}`).join('\n')}\n\nPara criar: "criar marcador Família". Para usar: "marca dentista quinta 15h, marcador Saúde".`;
  }
  if ((m = t.match(/^(?:cria|criar|novo|nova) (?:marcador|categoria|calend[áa]rio)[:\s]+(.+)$/))) {
    const c = await obterOuCriarCalendario(conta.id, caso(m[1].trim()));
    return `✅ Marcador *${c.nome}* pronto na sua agenda Google.`;
  }
  if ((m = msg.texto.trim().match(/^conectar?\s+instagram\s+(.+)$/i))) {
    // Aceita: "conectar instagram <token>" ou "conectar instagram <id|@usuario> <token>", com ou sem < >
    const partes = m[1].replace(/[<>]/g, ' ').trim().split(/\s+/);
    const token = partes.find(x => /^(IGAA|EAA)[A-Za-z0-9_-]{30,}$/.test(x)) || partes.at(-1);
    if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) return 'Não reconheci o token. Mande: `conectar instagram <token IGAA…>` (só o token já basta; o ID eu descubro).';
    let me; try { me = await fetch(`https://graph.instagram.com/me?fields=user_id,username,account_type&access_token=${token}`).then(r => r.json()); } catch (e) { return `Não consegui validar o token na Meta: ${e.message}`; }
    if (me.error) return `❌ A Meta recusou esse token (${me.error.code}): ${me.error.message.slice(0, 160)}. Gere outro em Meus apps → KM Graph API → Instagram → Gerar tokens.`;
    const igId = String(me.user_id || me.id);
    db.prepare('INSERT INTO instagram_auth (conta_id, ig_user_id, token, expira_em) VALUES (?,?,?,?) ON CONFLICT(conta_id) DO UPDATE SET ig_user_id=excluded.ig_user_id, token=excluded.token, expira_em=excluded.expira_em').run(conta.id, igId, token, new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));
    db.prepare('INSERT INTO modulos (conta_id, modulo, ligado) VALUES (?,?,1) ON CONFLICT(conta_id, modulo) DO UPDATE SET ligado=1').run(conta.id, 'social');
    const pausados = db.prepare("SELECT id, tema, data FROM posts WHERE conta_id=? AND status='erro' ORDER BY data").all(conta.id);
    return `✅ Instagram conectado: @${me.username} (ID ${igId}, ${me.account_type || 'business'}). Token válido por ~60 dias; eu aviso 7 dias antes de vencer.${pausados.length ? `\n\nPosts que falharam e podem ser reagendados: ${pausados.map(p => `#${p.id}`).join(', ')} — diga "MIA, reagenda o post #N para <dia hora>".` : ''}\n\n⚠️ Apague a mensagem com o token do seu histórico do Telegram.`;
  }
  if (/^conectar? instagram$/.test(t)) { const igo = await import('../integracoes/instagram-oauth.js'); const u = igo.urlAutorizacao(conta.id); if (u) return `📸 Toque no link, entre no Instagram da empresa e autorize:\n${u}\n\n(O perfil precisa ser Profissional. Enquanto o Fiel está em liberação pela Meta, o seu @ precisa estar cadastrado como testador — se der erro, fale com o suporte.)`; }
  if (/^conectar? instagram$/.test(t)) return 'Me mande numa linha: `conectar instagram <token IGAA…>` (gerado em Meus apps → KM Graph API → Instagram → Gerar tokens de acesso). O ID da conta eu descubro pelo token.';
  if (/^(quais|que) módulos|^módulos$|^equipe$/.test(t)) {
    const nomeDe = (mod) => { const r = db.prepare('SELECT nome FROM persona_config WHERE conta_id=? AND modulo=?').get(conta.id, mod); return r?.nome ? `${r.nome} (${mod === 'diretor' ? 'Diretor' : MODS[mod]})` : (mod === 'diretor' ? 'Diretor' : MODS[mod]); };
    const ligados = db.prepare('SELECT modulo FROM modulos WHERE conta_id=? AND ligado=1').all(conta.id).map(r => r.modulo);
    const off = Object.keys(MODS).filter(k => !ligados.includes(k));
    return `Equipe ativa: ${['diretor', ...ligados].map(nomeDe).join(', ')}.\nDesligados: ${off.map(k => MODS[k]).join(', ') || 'nenhum'}.`;
  }
  if (/^(mia,?\s*)?biblioteca(\s+(v[íi]deos?|fotos?|stories))?$/.test(t)) {
    const { listarBiblioteca } = await import('../ferramentas/social.js');
    const tipo = /v[íi]deo/.test(t) ? 'video' : /foto/.test(t) ? 'imagem' : /stor/.test(t) ? 'story' : undefined;
    const b = listarBiblioteca(conta.id, { tipo, max: 12 });
    if (!b.length) return 'Biblioteca vazia. Fotos e vídeos que você manda para a MIA ficam guardados aqui.';
    const dias = Number(process.env.BIBLIOTECA_RETENCAO_DIAS || 15);
    const rest = (em) => { const d = dias - Math.floor((Date.now() - new Date(em.replace(' ', 'T') + 'Z')) / 864e5); return d; };
    return `📚 Biblioteca (${b.length} últimas · apaga sozinha após ${dias} dias):\n` + b.map(x => { const p = db.prepare('SELECT protegida FROM biblioteca WHERE id=?').get(x.id)?.protegida; const r = rest(x.em); return `- #${x.id} ${x.tipo}${x.duracao ? ` ${Math.round(x.duracao)}s` : ''} · ${x.descricao || '(sem descrição)'}${x.usada ? ' · usada' : ''} · ${p ? '🔒 guardada' : r <= 0 ? '⏳ apaga hoje' : `⏳ ${r}d`}`; }).join('\n') + '\n\nUsar: "MIA, cria um post com a mídia #ID" · manter: "guarda #ID" · apagar: "apaga #ID".';
  }
  if ((m = t.match(/^(guarda|guardar|proteger?|mant[eé]m|manter)\s+#?(\d+)$/))) {
    const r = db.prepare('UPDATE biblioteca SET protegida=1 WHERE id=? AND conta_id=?').run(m[2], conta.id);
    return r.changes ? `🔒 Mídia #${m[2]} guardada — não entra na limpeza automática. Para liberar: "libera #${m[2]}".` : `Não achei a mídia #${m[2]}.`;
  }
  if ((m = t.match(/^(libera|liberar|desproteger?)\s+#?(\d+)$/))) {
    const r = db.prepare('UPDATE biblioteca SET protegida=0 WHERE id=? AND conta_id=?').run(m[2], conta.id);
    return r.changes ? `Mídia #${m[2]} volta a seguir a limpeza de ${process.env.BIBLIOTECA_RETENCAO_DIAS || 15} dias.` : `Não achei a mídia #${m[2]}.`;
  }
  if ((m = t.match(/^(apaga|apagar|exclui|excluir|remove|remover)\s+(?:a\s+)?(?:m[íi]dia\s+)?#?(\d+)(?:\s+da\s+biblioteca)?$/))) {
    const b = db.prepare('SELECT * FROM biblioteca WHERE id=? AND conta_id=?').get(m[2], conta.id); if (!b) return `Não achei a mídia #${m[2]}.`;
    const emUso = db.prepare("SELECT id FROM posts WHERE conta_id=? AND status IN ('agendado','rascunho') AND (midia_url LIKE ? OR midia_url LIKE ?)").get(conta.id, `%${b.url}%`, `%${b.marcada_url || '∅'}%`);
    if (emUso) return `A mídia #${m[2]} está no post #${emUso.id} (${db.prepare('SELECT status FROM posts WHERE id=?').get(emUso.id).status}). Cancele o post antes.`;
    const { apagar } = await import('../integracoes/cloudinary.js');
    for (const u of [b.url, b.marcada_url].filter(Boolean)) { try { await apagar(u); } catch {} }
    db.prepare('DELETE FROM biblioteca WHERE id=?').run(b.id);
    return `🗑 Mídia #${m[2]} apagada da biblioteca e do armazenamento.`;
  }
  if (/^(web|app|app web|abrir web|entrar na web)$/.test(t)) { const dom = process.env.PUBLIC_URL || process.env.WEBAPP_URL || 'https://seu-dominio'; return `💻 Abra ${dom.replace(/\/$/, '')}/app no navegador. Ele mostra um código de 6 dígitos. Volte aqui e me mande *web 123456* (seu código). Nessa mesma conta você vê a conversa em tempo real, o calendário editorial, documentos e créditos.`; }
  if ((m = t.match(/^(?:web|entrar web|login)\s+(\d{6})$/))) {
    const { concluirLogin } = await import('../canal/web.js');
    return concluirLogin(m[1], conta.id, msg.chatId) ? '💻 Login no app liberado. Pode voltar ao navegador.' : 'Código inválido ou expirado (vale 10 min). Gere outro no app.';
  }
  if ((m = msg.texto.trim().match(/^convidar?\s+(.+)$/i))) {
    // Bug antigo: usava caso(m[1]) para recuperar a caixa original, mas caso() busca em `t` (lowercase),
    // nunca achava um fragmento com maiúsculas e devolvia "" — nome ia vazio pro banco e a pessoa
    // ficava fantasma (Olga não achava depois). m[1] já veio do msg.texto, com a caixa certa.
    const { criarConvite } = await import('./equipe.js'); const nome = m[1].trim();
    if (!nome) return 'Diga o nome: *convidar <Nome>*.';
    const codigo = criarConvite(conta.id, nome);
    return `Convite para ${nome} criado. Peça para a pessoa abrir @${process.env.TELEGRAM_BOT_USERNAME || 'AssessorKM_bot'} no Telegram e mandar:\n\nentrar ${codigo}\n\nQuando entrar, eu te aviso. Depois: "Olga, avisa ${nome.split(' ')[0]} que…" ou "Olga, repassa para ${nome.split(' ')[0]}: <tarefa> até sexta".`;
  }
  if (/^(pessoas|minha equipe|equipe externa|colaboradores)$/.test(t)) {
    const { listarPessoas } = await import('./equipe.js'); const ps = listarPessoas(conta.id);
    return ps.length ? `Pessoas no Telegram:\n${ps.map(p => `- ${p.nome}`).join('\n')}\n\nPara adicionar: convidar <Nome>. Para tirar: remover pessoa <Nome>.` : 'Ninguém da sua equipe entrou ainda. Use: convidar <Nome>.';
  }
  if ((m = msg.texto.trim().match(/^remover pessoa\s+(.+)$/i))) {
    const { acharPessoa } = await import('./equipe.js'); const p = acharPessoa(conta.id, m[1]); if (!p) return `Não achei ${m[1]}.`;
    db.prepare('DELETE FROM usuarios WHERE id=?').run(p.id); return `${p.nome} removido(a) da equipe.`;
  }
  if ((m = msg.texto.trim().match(/^(?:minhas )?empresas\s*[:=]\s*(.+)$/i))) {
    const lista = m[1].split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
    db.prepare('UPDATE contas SET empresas=? WHERE id=?').run(JSON.stringify(lista), conta.id);
    return `🏢 Empresas fixadas: ${lista.join(', ')}. Documentos pessoais vão para "PF". As pastas no Drive usam exatamente esses nomes.`;
  }
  if (/^(minhas )?empresas$/.test(t)) { const l = JSON.parse(conta.empresas || '[]'); return l.length ? `🏢 ${l.join(', ')} (+ PF para pessoal)\nPara alterar: empresas: Nome A, Nome B, …` : 'Nenhuma empresa fixada. Mande: empresas: Mais Têxtil, Douglas Confecções, KM, …'; }
  if ((m = msg.texto.trim().match(/^documentos?\s+pasta\s+(\S+)$/i))) {
    try { const { definirPastaRaiz } = await import('../integracoes/google-drive.js'); const r = await definirPastaRaiz(conta.id, m[1]); return `📂 Pasta raiz dos documentos: "${r.nome}". Vou criar dentro dela Empresa/Tipo/Ano.`; }
    catch (e) { return `Não consegui usar essa pasta: ${e.message}`; }
  }
  if (/^documentos?\s+pasta$/.test(t)) { try { const d = await import('../integracoes/google-drive.js'); const id = await d.pastaRaiz(conta.id); return `📂 Documentos ficam em: https://drive.google.com/drive/folders/${id}\nPara trocar: documentos pasta <link da pasta>`; } catch (e) { return e.message; } }
  if (/conectar? (o )?google|conectar? (a )?agenda|conectar? (o )?drive/.test(t)) {
    const base = process.env.PUBLIC_URL || '';
    return `Abra este link para autorizar o Google Agenda:\n${base}/oauth/google/iniciar/${conta.id}\n\n(ou direto: ${urlAutorizacao(conta.id)})`;
  }
  if ((m = t.match(/^(?:diretor,?\s*)?(?:a|o)?\s*([\wÀ-ÿ]+) (?:agora )?se chama (.+)$/))) {
    const mod = norm(m[1]); if (!MODS[mod] && mod !== 'diretor') return null;
    db.prepare('INSERT INTO persona_config (conta_id, modulo, nome) VALUES (?,?,?) ON CONFLICT(conta_id, modulo) DO UPDATE SET nome=excluded.nome').run(conta.id, mod, caso(m[2].trim()));
    return `Combinado. ${MODS[mod] || 'Diretor'} agora se chama ${caso(m[2].trim())}.`;
  }
  if ((m = t.match(/^(?:me )?(?:chame|trate|chama) (?:de|como) (.+)$/))) {
    db.prepare('INSERT INTO persona_config (conta_id, modulo, tratamento) VALUES (?,?,?) ON CONFLICT(conta_id, modulo) DO UPDATE SET tratamento=excluded.tratamento').run(conta.id, 'diretor', caso(m[1].trim()));
    return `Certo, ${caso(m[1].trim())}.`;
  }
  if ((m = t.match(/^foco do m[êe]s[:\s]+(.+)$/))) { db.prepare('UPDATE contas SET foco_mes=? WHERE id=?').run(caso(m[1].trim()), conta.id); return `Foco do mês: ${caso(m[1].trim())}. Toda a equipe vai priorizar isso.`; }
  return null;
}


// ---------------- Compra de créditos (estado por chat, 15 min) ----------------
const compraPendente = new Map(); // chatId → { pacote, forma, passo: 'forma'|'dados', em }
const PAC_RX = /(mensal[_ ]?pro|mensal[_ ]?max|plano pro|plano max|start|pro|max)\b/;
const normPac = (x) => { x = x.replace(/[_ ]/g, ' '); if (/plano pro|mensal pro/.test(x)) return 'mensal_pro'; if (/plano max|mensal max/.test(x)) return 'mensal_max'; return x; };
async function fluxoCompra(msg, conta, t, orig) {
  const c = await import('../creditos/index.js'); const as = await import('../integracoes/pagamento.js');
  const est = compraPendente.get(msg.chatId); if (est && Date.now() - est.em > 15 * 60000) compraPendente.delete(msg.chatId);
  const e = compraPendente.get(msg.chatId);
  const nomePac = (id) => c.PACOTES.find(p => p.id === id)?.nome || id;
  // cancelar
  if (e && /^(cancela|deixa|n[ãa]o|sair)\b/.test(t)) { compraPendente.delete(msg.chatId); return '👍 Ok, compra cancelada. Nada foi cobrado.'; }
  // 1) lista de pacotes (sem pacote ainda)
  const mp = t.match(/^comprar\s+(.+)$/); const pacTxt = mp && PAC_RX.exec(mp[1])?.[0];
  if (!e && !pacTxt) {
    const txt = `🛒 *${c.PRODUTO} · Recarga*\n` + c.PACOTES.map(p => `- ${p.nome}: ${p.creditos.toLocaleString('pt-BR')} créditos · R$ ${p.preco}${p.tipo === 'mensal' ? '/mês' : ''}`).join('\n') + '\n\nQual você quer?';
    return { texto: txt, botoes: [c.PACOTES.filter(p => p.tipo === 'prepago').map(p => ({ t: p.nome, d: `comprar ${p.id}` })), c.PACOTES.filter(p => p.tipo === 'mensal').map(p => ({ t: p.nome.replace(' (mensal)', ' mensal'), d: `comprar ${p.id}` }))] };
  }
  if (!as.configurado()) return `O pagamento online ainda não está ativo neste servidor. Fale com o suporte do ${c.PRODUTO}: ${c.SUPORTE_EMAIL} · ${c.SUPORTE_TELEFONE}.`;
  // 2) pacote escolhido → forma
  if (pacTxt) {
    const pacote = normPac(pacTxt); const resto = mp[1].replace(PAC_RX, ' ');
    const forma = /cart/.test(resto) ? 'cartao' : /boleto/.test(resto) ? 'boleto' : /pix/.test(resto) ? 'pix' : null;
    const doc = resto.match(/\d[\d.\/-]{9,17}\d/)?.[0]; const email = resto.match(/\S+@\S+\.\S+/)?.[0];
    compraPendente.set(msg.chatId, { pacote, forma, passo: forma ? 'dados' : 'forma', em: Date.now(), doc, email });
    if (!forma) { const p = c.PACOTES.find(x => x.id === pacote); return { texto: `${p.nome}: ${p.creditos.toLocaleString('pt-BR')} créditos · R$ ${p.preco}${p.tipo === 'mensal' ? '/mês' : ''}. Como quer pagar?`, botoes: [[{ t: '⚡ Pix', d: 'pix' }, { t: '💳 Cartão', d: 'cartão' }, ...(p.tipo === 'mensal' ? [] : [{ t: '🧾 Boleto', d: 'boleto' }])], [{ t: '❌ Cancelar', d: 'cancela' }]] }; }
    return concluirCompra(msg, conta, c, as);
  }
  // 3) forma escolhida
  if (e && e.passo === 'forma') {
    const forma = /cart/.test(t) ? 'cartao' : /boleto/.test(t) ? 'boleto' : /pix/.test(t) ? 'pix' : null;
    if (!forma) return { texto: 'Escolha a forma de pagamento:', botoes: [[{ t: '⚡ Pix', d: 'pix' }, { t: '💳 Cartão', d: 'cartão' }], [{ t: '❌ Cancelar', d: 'cancela' }]] };
    e.forma = forma; e.passo = 'dados'; return concluirCompra(msg, conta, c, as);
  }
  // 4) dados do pagador (CPF/CNPJ + e-mail opcional)
  if (e && e.passo === 'dados') {
    const doc = orig.match(/\d[\d.\/-]{9,17}\d/)?.[0]; const email = orig.match(/\S+@\S+\.\S+/)?.[0];
    if (doc) e.doc = doc; if (email) e.email = email;
    if (!doc && !email) return { texto: 'Preciso do CPF ou CNPJ do pagador (só números serve). Pode mandar junto o e-mail para o recibo.\nEx.: 000.000.000-00 nome@email.com', botoes: [[{ t: '❌ Cancelar', d: 'cancela' }]] };
    return concluirCompra(msg, conta, c, as);
  }
  return null;
}
async function concluirCompra(msg, conta, c, as) {
  const e = compraPendente.get(msg.chatId); if (!e) return null;
  const docOk = as.docValido(e.doc || conta.cpf_cnpj);
  if (!docOk) { e.passo = 'dados'; return { texto: `Para emitir a cobrança preciso do seu CPF ou CNPJ (só na primeira vez). Mande aqui, e se quiser o e-mail para o recibo junto.\nEx.: 000.000.000-00 nome@email.com`, botoes: [[{ t: '❌ Cancelar', d: 'cancela' }]] }; }
  try {
    const cb = await as.comprar(conta.id, e.pacote, { forma: e.forma, cpfCnpj: e.doc, email: e.email }); compraPendente.delete(msg.chatId); const p = cb.pacote;
    const cab = `🛒 ${p.nome}: ${p.creditos.toLocaleString('pt-BR')} créditos · R$ ${p.preco}${p.tipo === 'mensal' ? '/mês' : ''}`;
    if (cb.pix_qr) return { foto: `data:image/png;base64,${cb.pix_qr}`, texto: `${cab}\nPix copia e cola:\n${cb.pix_payload}\n\nAssim que o pagamento cair eu aviso e os créditos entram sozinhos.${cb.invoice_url ? '\nFatura: ' + cb.invoice_url : ''}` };
    return `${cab}\nPague por aqui: ${cb.invoice_url}\nAssim que confirmar, os créditos entram sozinhos e eu aviso.`;
  } catch (err) { compraPendente.delete(msg.chatId); return `Não consegui gerar a cobrança: ${err.message}`; }
}
