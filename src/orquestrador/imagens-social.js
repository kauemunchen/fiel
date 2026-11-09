// Intenção das imagens que chegam para a MIA (sem gastar IA):
//  • legenda com "logo/logotipo/identidade visual…" → guarda como logo da marca e confirma (sem post)
//  • fotos sem legenda (ou álbum) → guarda e faz UMA pergunta com botões: usar em post / são logos / só guardar
//  • álbum com legenda de pedido → vai para a MIA UMA vez, com todas as fotos
import { db } from '../db/index.js';
import * as kit from '../integracoes/marca-kit.js';

db.exec(`CREATE TABLE IF NOT EXISTS imagens_pendentes (conta_id INTEGER PRIMARY KEY, itens TEXT NOT NULL, criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);

export const LOGO_RX = /\b(logos?|logotipos?|logomarcas?|s[íi]mbolos? da marca|identidade visual|kit de marca|marca d[ao] (empresa|imobili[áa]ria|loja))\b/i;
export const varianteDaLegenda = (t = '') => /\b(branc|clar[ao]|negativ|para fundo escuro|fundo escuro)/i.test(t) ? 'claro' : /\b(escur[ao]|pret[ao]|positiv|para fundo claro|fundo claro)/i.test(t) ? 'escuro' : 'principal';

const JANELA_MS = 3500;          // tempo para juntar fotos de um álbum / envio em sequência
const LOGO_CONTINUA_MS = 120000; // depois de logos, a pergunta sobre fotos sem legenda mostra "São logos" primeiro
const coletas = new Map();       // contaId → { itens: [{id, url, legenda, grupo}], timer, chatId, canal, conta }
const ultimoLogo = new Map();    // contaId → timestamp

/** Esta imagem deve passar pelo coletor (em vez de ir direto à MIA)? */
export function deveColetar(contaId, { legenda = '', grupo = null } = {}) {
  if (LOGO_RX.test(legenda)) return true;
  if (grupo) return true;
  if (!legenda.trim()) return true;
  return false;
}

/** Guarda a imagem e agenda a decisão do lote. Devolve null (a resposta sai quando o lote fecha). */
export async function coletar({ conta, msg, canal, bytes, processar }) {
  const { guardarImagemEnviada } = await import('../ferramentas/social.js');
  const legenda = msg.texto || '';
  // logo só com pedido explícito (a legenda do álbum vale para todas as fotos do mesmo álbum, decidido no fechamento)
  const ehLogo = LOGO_RX.test(legenda);
  const [r, analise] = await Promise.all([
    guardarImagemEnviada(conta.id, bytes, { tipo: ehLogo ? 'logo' : 'imagem', marcar: false }),
    import('../integracoes/render.js').then(m => m.analisarLogo(bytes)).catch(() => null),
  ]);
  const c = coletas.get(conta.id) || { itens: [], chatId: msg.chatId };
  const explicita = varianteDaLegenda(legenda);
  c.itens.push({ id: r.id, url: r.original, legenda, grupo: msg.grupo || null, logo: ehLogo, variante: explicita !== 'principal' ? explicita : (analise?.sugestao || 'principal') });
  c.canal = canal; c.conta = conta; c.processar = processar; c.msgBase = { conta: msg.conta, remetente: msg.remetente, recebidoEm: msg.recebidoEm, origem: msg.origem };
  clearTimeout(c.timer);
  c.timer = setTimeout(() => fechar(conta.id).catch(e => console.error('[imagens] fechar', e.message)), JANELA_MS);
  coletas.set(conta.id, c);
  return null;
}

async function fechar(contaId) {
  const c = coletas.get(contaId); coletas.delete(contaId); if (!c?.itens.length) return;
  const legenda = c.itens.map(i => i.legenda).find(t => t.trim()) || '';
  const enviar = (r) => c.canal.enviar(null, c.chatId, typeof r === 'string' ? { texto: r, modulo: 'social' } : { modulo: 'social', ...r });
  // 1) logos
  if (LOGO_RX.test(legenda) || c.itens.every(i => i.logo)) {
    ultimoLogo.set(contaId, Date.now());
    return enviar(salvarComoLogos(contaId, c.itens));
  }
  // 2) álbum com pedido → MIA uma vez só
  if (legenda.trim()) {
    const urls = c.itens.map(i => i.url);
    const texto = `${legenda}\n[${urls.length} foto(s) enviada(s) pelo dono, já hospedada(s), sem marca d'água: ${urls.join(' ')}. Use estas URLs; faça só o que ele pediu nesta legenda.]`;
    const resp = await c.processar({ ...c.msgBase, chatId: c.chatId, tipo: 'texto', texto, forcarModulo: 'social', midia: null, grupo: null });
    if (resp) return enviar(resp);
    return;
  }
  // 3) sem pedido → uma pergunta
  db.prepare('INSERT INTO imagens_pendentes (conta_id, itens) VALUES (?,?) ON CONFLICT(conta_id) DO UPDATE SET itens=excluded.itens, criado_em=CURRENT_TIMESTAMP').run(contaId, JSON.stringify(c.itens.map(i => ({ id: i.id, url: i.url, variante: i.variante }))));
  const n = c.itens.length;
  const logoRecente = Date.now() - (ultimoLogo.get(contaId) || 0) < LOGO_CONTINUA_MS;
  const bLogo = [{ t: n === 1 ? '🏷️ É a logo da marca' : '🏷️ São logos da marca', d: 'imgs:logo' }], bPost = [{ t: '📌 Usar em um post', d: 'imgs:post' }], bGuardar = [{ t: '🗂️ Só guardar', d: 'imgs:guardar' }];
  return enviar({
    texto: `📥 Recebi ${n === 1 ? 'a imagem' : `${n} imagens`} e já ${n === 1 ? 'guardei' : 'guardei todas'} na Biblioteca. O que faço com ${n === 1 ? 'ela' : 'elas'}?`,
    botoes: logoRecente ? [bLogo, bPost, bGuardar] : [bPost, bLogo, bGuardar],
  });
}

function salvarComoLogos(contaId, itens) {
  const salvas = [];
  for (const i of itens) {
    const v = i.variante || 'principal';
    try { const r = kit.salvarLogo(contaId, i.url, v); salvas.push(r.variante); db.prepare("UPDATE biblioteca SET tipo='logo' WHERE id=?").run(i.id); } catch (e) { console.error('[imagens] logo', e.message); }
  }
  db.prepare('DELETE FROM imagens_pendentes WHERE conta_id=?').run(contaId);
  const k = kit.lerKit(contaId) || {}; const l = k.logos || {};
  const nomes = { principal: 'principal', claro: 'versão clara (para fundo escuro)', escuro: 'versão escura (para fundo claro)' };
  const extras = salvas.filter(v => v === 'extra').length;
  const falta = [];
  if (!k.cores?.fundo) falta.push('as cores da marca (ou o manual em PDF)');
  if (!k.assinatura) falta.push('o @ do Instagram');
  return `🏷️ ${salvas.length === 1 ? 'Logo guardada' : `${salvas.length} logos guardadas`} na identidade da marca.\nEm uso: ${['principal', 'claro', 'escuro'].filter(v => l[v]).map(v => nomes[v]).join(' · ') || '—'}${extras ? ` (+${extras} guardada${extras > 1 ? 's' : ''} como alternativa — para trocar, diga "MIA, usa a outra logo")` : ''}.\nNão criei nenhum post. As artes (carrossel, frase, story) passam a sair com esta logo${falta.length ? `\n\nPara as artes ficarem 100% na identidade, me mande ${falta.join(' e ')}.` : '.'}`;
}

function pendentes(contaId) {
  const r = db.prepare("SELECT itens FROM imagens_pendentes WHERE conta_id=? AND criado_em >= datetime('now','-2 hours')").get(contaId);
  try { return r ? JSON.parse(r.itens) : []; } catch { return []; }
}

/** Resposta aos botões da pergunta. Devolve {resposta} (encerra) ou {msg} (segue para a MIA) ou null (não é comigo). */
export function tratarBotao(conta, msg) {
  const t = String(msg.texto || '').trim();
  if (!/^imgs:(post|logo|guardar)$/.test(t)) return null;
  const itens = pendentes(conta.id);
  if (!itens.length) return { resposta: 'Essas imagens já foram resolvidas. Se quiser usar alguma, peça "listar biblioteca".' };
  if (t === 'imgs:guardar') { db.prepare('DELETE FROM imagens_pendentes WHERE conta_id=?').run(conta.id); return { resposta: `🗂️ Feito — ${itens.length === 1 ? 'a imagem ficou' : `as ${itens.length} imagens ficaram`} na Biblioteca. Quando quiser usar: "MIA, post com a foto #${itens[0].id}".` }; }
  if (t === 'imgs:logo') { ultimoLogo.set(conta.id, Date.now()); return { resposta: salvarComoLogos(conta.id, itens) }; }
  db.prepare('DELETE FROM imagens_pendentes WHERE conta_id=?').run(conta.id);
  return { msg: { ...msg, botao: false, tipo: 'texto', forcarModulo: 'social', texto: `[O dono quer usar ${itens.length === 1 ? 'esta foto' : `estas ${itens.length} fotos`} em post: ${itens.map(i => i.url).join(' ')}. Pergunte em UMA mensagem o tema/ideia e o formato (post único, carrossel de fotos ou story). Não gere legenda nem arte antes da resposta.]` } };
}

/** Contexto para a MIA quando o dono responde por texto em vez de tocar no botão. */
export function contextoPendente(contaId) {
  const itens = pendentes(contaId); if (!itens.length) return '';
  return `\n[Há ${itens.length} imagem(ns) recém-enviada(s) aguardando decisão do dono: ${itens.map(i => i.url).join(' ')}. Se ele disser que são logos, chame salvar_logo para cada URL; se pedir post, use-as; não gere nada que ele não pediu.]`;
}
export function limparPendentes(contaId) { db.prepare('DELETE FROM imagens_pendentes WHERE conta_id=?').run(contaId); }
