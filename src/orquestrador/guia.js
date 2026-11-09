// Guia de primeiros passos do cliente novo:
//  1) checklist no app (detecta sozinho o que já foi feito)
//  2) dicas no 1º, 3º e 7º dia, só do que ainda não foi usado
//  3) aviso quando o crédito de boas-vindas passa de 80% de uso, com o que já foi resolvido e os pacotes
// + vínculo do Telegram a uma conta criada pelo site (código / link direto do bot).
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { pacotes as listarPacotes } from '../creditos/index.js';

db.exec(`CREATE TABLE IF NOT EXISTS telegram_vinculos (codigo TEXT PRIMARY KEY, conta_id INTEGER NOT NULL, criado_em TEXT DEFAULT CURRENT_TIMESTAMP, usado_em TEXT, chat_id TEXT);
  CREATE TABLE IF NOT EXISTS guia_envios (conta_id INTEGER NOT NULL, chave TEXT NOT NULL, enviado_em TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (conta_id, chave))`);
try { db.exec('ALTER TABLE contas ADD COLUMN guia_dispensado INTEGER DEFAULT 0'); } catch {}

const BOT = () => process.env.TELEGRAM_BOT_USERNAME || 'AssessorKM_bot';
const APP = () => (process.env.WEBAPP_URL || process.env.PUBLIC_URL || 'https://usefiel.com').replace(/\/$/, '').replace(/\/app$/, '') + '/app';
const existe = (sql, ...a) => { try { return !!db.prepare(sql).get(...a); } catch { return false; } };

// ---------- vínculo do Telegram ----------
export function gerarCodigoTelegram(contaId) {
  db.prepare("DELETE FROM telegram_vinculos WHERE conta_id=? AND usado_em IS NULL").run(contaId);
  const codigo = crypto.randomBytes(6).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8).padEnd(8, 'X');
  db.prepare('INSERT INTO telegram_vinculos (codigo, conta_id) VALUES (?,?)').run(codigo, contaId);
  return { codigo, bot: BOT(), link: `https://t.me/${BOT()}?start=v_${codigo}`, validade_min: 30 };
}
export const PADRAO_VINCULO = /^(?:\/start\s+v_|vincular\s+|v_)([A-Z0-9]{8})$/i;
/** Mensagem no bot com o código: liga este chat do Telegram à conta como dono. Devolve a resposta (ou null se não é código). */
export function vincularTelegram(msg) {
  const m = String(msg.texto || '').trim().match(PADRAO_VINCULO); if (!m) return null;
  const v = db.prepare("SELECT * FROM telegram_vinculos WHERE codigo=? AND usado_em IS NULL AND criado_em >= datetime('now','-30 minutes')").get(m[1].toUpperCase());
  if (!v) return 'Esse código expirou ou já foi usado. No app, toque de novo em *Conectar Telegram* para gerar outro.';
  const conta = db.prepare('SELECT id, nome_dono FROM contas WHERE id=?').get(v.conta_id); if (!conta) return 'Conta não encontrada.';
  const atual = db.prepare('SELECT conta_id FROM usuarios WHERE chat_id=?').get(String(msg.chatId));
  if (atual && atual.conta_id !== conta.id) return 'Este Telegram já está ligado a outra conta do Fiel. Fale com o suporte se quiser trocar: https://wa.me/5547933883929';
  if (!atual) db.prepare("INSERT INTO usuarios (conta_id, canal, chat_id, nome, papel) VALUES (?, 'telegram', ?, ?, 'dono')").run(conta.id, String(msg.chatId), conta.nome_dono || 'Dono');
  db.prepare("UPDATE telegram_vinculos SET usado_em=CURRENT_TIMESTAMP, chat_id=? WHERE codigo=?").run(String(msg.chatId), v.codigo);
  const nome = (conta.nome_dono || '').split(' ')[0];
  return `✅ Pronto${nome ? ', ' + nome : ''}! Seu Telegram está ligado ao Fiel. A conversa aqui e no app é a mesma.\n\nTesta agora: mande um *áudio* dizendo "Olga, me lembra amanhã às 9h de ligar pro contador".`;
}

// ---------- checklist ----------
export function passos(contaId) {
  const lista = [
    { id: 'telegram', titulo: 'Conectar o Telegram', detalhe: 'Fale com a equipe pelo celular, por texto ou áudio.', feito: existe("SELECT 1 FROM usuarios WHERE conta_id=? AND canal='telegram'", contaId) },
    { id: 'google', titulo: 'Conectar o Google', detalhe: 'Agenda, e-mail e Drive para a Olga e o Estag.', feito: existe('SELECT 1 FROM google_auth WHERE conta_id=?', contaId) },
    { id: 'audio', titulo: 'Mandar o primeiro áudio', detalhe: 'Ex.: "Olga, me lembra amanhã às 9h de ligar pro contador".', feito: existe("SELECT 1 FROM mensagens WHERE conta_id=? AND direcao='entrada' AND tipo IN ('audio','voice')", contaId) || existe("SELECT 1 FROM interacoes WHERE conta_id=? AND entrada LIKE '%[áudio%'", contaId) },
    { id: 'post', titulo: 'Pedir o primeiro post à MIA', detalhe: 'Mande uma foto com uma ideia de legenda.', feito: existe('SELECT 1 FROM posts WHERE conta_id=?', contaId) },
    { id: 'extrato', titulo: 'Mandar um extrato para a Tina', detalhe: 'O arquivo do banco (OFX ou CSV) com o nome da empresa.', feito: existe("SELECT 1 FROM fin_lancamentos WHERE conta_id=? AND origem IN ('extrato','boleto')", contaId) || existe('SELECT 1 FROM fin_importacoes WHERE conta_id=?', contaId) },
  ];
  const c = db.prepare('SELECT guia_dispensado, plano, admin FROM contas WHERE id=?').get(contaId) || {};
  // só os passos da equipe ativa
  const lig = new Set(db.prepare('SELECT modulo FROM modulos WHERE conta_id=? AND ligado=1').all(contaId).map(x => x.modulo));
  const precisa = { google: lig.has('secretaria') || lig.has('documentos'), audio: true, telegram: true, post: lig.has('social'), extrato: lig.has('financeiro') };
  for (let k = lista.length - 1; k >= 0; k--) if (!precisa[lista[k].id]) lista.splice(k, 1);
  const feitos = lista.filter(p => p.feito).length;
  return { passos: lista, feitos, total: lista.length, completo: feitos === lista.length, dispensado: !!c.guia_dispensado };
}
export function dispensarGuia(contaId) { db.prepare('UPDATE contas SET guia_dispensado=1 WHERE id=?').run(contaId); return { ok: true }; }

// ---------- dicas do 1º, 3º e 7º dia ----------
const DICA = {
  telegram: () => `📱 *Dica do Fiel:* sua equipe também atende pelo Telegram — dá para mandar áudio no meio do trânsito. No app, toque em *Conectar Telegram* (leva 10 segundos): ${APP()}`,
  google: () => '📅 *Dica do Fiel:* conecte seu Google e a Olga passa a cuidar da sua agenda e dos seus e-mails. Mande aqui: *conectar google*.',
  audio: () => '🎤 *Dica do Fiel:* o jeito mais rápido de delegar é por áudio. Experimente agora: "Olga, me lembra amanhã às 9h de ligar pro contador".',
  post: () => '📸 *Dica do Fiel:* mande uma foto aqui com uma ideia de legenda ("MIA, post sobre…") e a MIA monta o post no padrão da sua marca.',
  extrato: () => '💰 *Dica do Fiel:* exporte o extrato do banco em OFX ou CSV e mande aqui com o nome da empresa na legenda. A Tina organiza tudo por categoria e mostra o fluxo de caixa.',
};
export async function enviarDicasDoGuia(canal) {
  const contas = db.prepare("SELECT id, criado_em FROM contas WHERE COALESCE(admin,0)=0 AND COALESCE(guia_dispensado,0)=0 AND COALESCE(status,'ativa')='ativa'").all();
  for (const c of contas) {
    const dias = Math.floor((Date.now() - new Date(String(c.criado_em).replace(' ', 'T') + 'Z').getTime()) / 864e5);
    const marco = [1, 3, 7].find(d => d === dias); if (!marco) continue;
    if (existe('SELECT 1 FROM guia_envios WHERE conta_id=? AND chave=?', c.id, 'dia' + marco)) continue;
    const g = passos(c.id); const prox = g.passos.find(p => !p.feito); if (!prox) continue;
    const dono = db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' ORDER BY canal<>'telegram', id LIMIT 1").get(c.id)?.chat_id; if (!dono) continue;
    try { await canal.enviar(null, dono, DICA[prox.id]() + `\n\n_Primeiros passos: ${g.feitos} de ${g.total} feitos._`); db.prepare('INSERT OR IGNORE INTO guia_envios (conta_id, chave) VALUES (?,?)').run(c.id, 'dia' + marco); }
    catch (e) { console.error('[guia] dica', c.id, e.message); }
  }
}

// ---------- fim do crédito de boas-vindas ----------
/** Mensagem para quem está em trial e já usou ~80% dos créditos de boas-vindas: o que já resolveu + pacotes. */
export function mensagemFimTrial(contaId, saldoAtual) {
  const n = (sql) => { try { return db.prepare(sql).get(contaId)?.n || 0; } catch { return 0; } };
  const feitos = [
    [n("SELECT COUNT(*) n FROM mensagens WHERE conta_id=? AND direcao='entrada'"), 'pedidos atendidos', 'pedido atendido'],
    [n('SELECT COUNT(*) n FROM posts WHERE conta_id=?'), 'posts/stories criados', 'post/story criado'],
    [n('SELECT COUNT(*) n FROM documentos WHERE conta_id=?'), 'documentos organizados', 'documento organizado'],
    [n('SELECT COUNT(*) n FROM lembretes WHERE conta_id=?'), 'lembretes e compromissos', 'lembrete ou compromisso'],
    [n("SELECT COUNT(*) n FROM fin_lancamentos WHERE conta_id=? AND oculto=0"), 'lançamentos financeiros', 'lançamento financeiro'],
  ].filter(([q]) => q > 0).map(([q, t, t1]) => `• ${q} ${q === 1 ? t1 : t}`);
  let pacotes = []; try { pacotes = listarPacotes(); } catch {}
  const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `⏳ *Seus créditos de boas-vindas estão acabando* (restam ${Math.max(0, Math.round(saldoAtual))}).\n\n${feitos.length ? 'Até aqui a equipe já resolveu:\n' + feitos.join('\n') + '\n\n' : ''}Para continuar sem parar:\n${pacotes.length ? pacotes.map(p => `• *${p.nome}*: ${Number(p.creditos).toLocaleString('pt-BR')} créditos — ${brl(p.preco)}${p.tipo === 'mensal' ? '/mês' : ''}`).join('\n') : '• veja os pacotes no app'}\n\nRecarregue em *Créditos* no app (${APP()}) ou mande *comprar*. Créditos comprados não expiram.`;
}
