// Liberação do @ do Instagram do cliente como Testador no app da Meta (enquanto o app não passa pela análise).
// Cliente informa o @ → suporte recebe aviso com botão → inclui o @ nos testadores (até 12 h) → toca "Liberei"
// → cliente recebe o passo a passo: aceitar o convite e tocar em Conectar Instagram.
import { db } from '../db/index.js';

db.exec(`CREATE TABLE IF NOT EXISTS ig_liberacoes (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, arroba TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendente',
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP, liberado_em TEXT, conectado_em TEXT)`);

export const PRAZO_HORAS = 12;
const APP_META = () => process.env.META_APP_ID || '1400044095327742';
export const linkFuncoes = () => `https://developers.facebook.com/apps/${APP_META()}/roles/roles/`;
export const LINK_CONVITE = 'https://www.instagram.com/accounts/manage_access/';
const APP = () => (process.env.WEBAPP_URL || process.env.PUBLIC_URL || 'https://usefiel.com').replace(/\/$/, '').replace(/\/app$/, '') + '/app';

export function normalizar(v) {
  const s = String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@+/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) throw new Error('@ inválido — use só letras, números, ponto e _ (ex.: @suaempresa)');
  return '@' + s.toLowerCase();
}

export function statusDaConta(contaId) {
  return db.prepare("SELECT id, arroba, status, criado_em, liberado_em FROM ig_liberacoes WHERE conta_id=? AND status<>'cancelado' ORDER BY id DESC LIMIT 1").get(contaId) || null;
}

const donoChat = (contaId) => db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' ORDER BY canal<>'telegram', id LIMIT 1").get(contaId)?.chat_id;
async function canal() { const { canalAtual } = await import('../canal/atual.js'); return canalAtual(); }

/** Cliente pede a liberação do @. Avisa os administradores do Fiel com botão "Liberei". */
export async function solicitar(contaId, arrobaBruto) {
  const arroba = normalizar(arrobaBruto);
  const atual = statusDaConta(contaId);
  if (atual && atual.arroba === arroba && atual.status !== 'pendente') return { ...atual, ja: true };
  let id;
  if (atual && atual.status === 'pendente') { db.prepare('UPDATE ig_liberacoes SET arroba=?, criado_em=CURRENT_TIMESTAMP WHERE id=?').run(arroba, atual.id); id = atual.id; }
  else id = db.prepare('INSERT INTO ig_liberacoes (conta_id, arroba) VALUES (?,?)').run(contaId, arroba).lastInsertRowid;
  const conta = db.prepare('SELECT nome_dono, empresa FROM contas WHERE id=?').get(contaId) || {};
  const admins = db.prepare("SELECT c.id FROM contas c WHERE c.admin=1").all();
  try {
    const c = await canal();
    for (const a of admins) {
      const chat = donoChat(a.id); if (!chat || !c) continue;
      await c.enviar(null, chat, { modulo: 'diretor', texto: `📸 *Liberar Instagram* (prazo ${PRAZO_HORAS} h)\nCliente: ${conta.nome_dono || '—'} · ${conta.empresa || '—'} (conta #${contaId})\nPerfil: *${arroba}*\n\n1) Funções do app → Adicionar pessoas → Testador do Instagram → ${arroba}\n2) Toque em "Liberei" — o cliente recebe o passo a passo para aceitar e conectar.`,
        botoes: [[{ t: '🔗 Abrir Funções do app', url: linkFuncoes() }], [{ t: `✅ Liberei ${arroba}`, d: `igok:${id}` }]] }).catch(() => {});
    }
  } catch (e) { console.error('[ig-liberacao] aviso admin', e.message); }
  return { id, arroba, status: 'pendente', prazo_horas: PRAZO_HORAS };
}

/** Suporte confirmou que incluiu o @ nos testadores. Avisa o cliente. */
export async function marcarLiberado(id) {
  const r = db.prepare('SELECT * FROM ig_liberacoes WHERE id=?').get(id); if (!r) throw new Error('pedido não encontrado');
  if (r.status === 'pendente') db.prepare("UPDATE ig_liberacoes SET status='liberado', liberado_em=CURRENT_TIMESTAMP WHERE id=?").run(id);
  const chat = donoChat(r.conta_id);
  try { const c = await canal(); if (c && chat) await c.enviar(null, chat, { modulo: 'social', texto: `✅ Seu Instagram *${r.arroba}* foi liberado no Fiel!\n\nFalta 1 minuto:\n1) Logado no ${r.arroba}, abra o link abaixo → aba *Convites de testador* → *Aceitar*.\n2) No app do Fiel: *Conexões → Conectar Instagram* (ou mande aqui "conectar instagram").`,
    botoes: [[{ t: '📩 Aceitar o convite', url: LINK_CONVITE }], [{ t: '🔌 Conectar Instagram', url: `${APP()}#conexoes` }]] }); } catch (e) { console.error('[ig-liberacao] aviso cliente', e.message); }
  return { ok: true, arroba: r.arroba, conta_id: r.conta_id };
}

export function marcarConectado(contaId) {
  db.prepare("UPDATE ig_liberacoes SET status='conectado', conectado_em=CURRENT_TIMESTAMP WHERE conta_id=? AND status IN ('pendente','liberado')").run(contaId);
}

export function listar() {
  return db.prepare(`SELECT l.*, c.nome_dono, c.empresa, CAST((julianday('now') - julianday(l.criado_em)) * 24 AS REAL) horas
    FROM ig_liberacoes l JOIN contas c ON c.id=l.conta_id ORDER BY CASE l.status WHEN 'pendente' THEN 0 WHEN 'liberado' THEN 1 ELSE 2 END, l.id DESC LIMIT 200`).all();
}
