// Cupons do Fiel: cada cupom pode dar créditos de brinde e/ou um desconto (%) por alguns dias a partir do resgate.
// O desconto vale para as compras feitas dentro da janela (pacotes pré-pagos e/ou plano mensal); no plano mensal,
// as mensalidades voltam ao preço cheio quando a janela termina (rotina diária).
import { db } from '../db/index.js';
import { creditar } from './index.js';

db.exec(`CREATE TABLE IF NOT EXISTS cupons (id INTEGER PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, descricao TEXT, creditos INTEGER DEFAULT 0,
    desconto_pct REAL DEFAULT 0, desconto_dias INTEGER DEFAULT 0, aplica TEXT DEFAULT 'todos', validade_ate TEXT, max_resgates INTEGER, so_novos INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS cupom_resgates (id INTEGER PRIMARY KEY, cupom_id INTEGER NOT NULL, conta_id INTEGER NOT NULL, creditos_dados INTEGER DEFAULT 0,
    desconto_pct REAL DEFAULT 0, desconto_ate TEXT, aplica TEXT, resgatado_em TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (cupom_id, conta_id))`);
try { db.exec('ALTER TABLE assinaturas ADD COLUMN valor_cheio REAL'); } catch {}
try { db.exec('ALTER TABLE assinaturas ADD COLUMN desconto_ate TEXT'); } catch {}
try { db.exec('ALTER TABLE cobrancas ADD COLUMN cupom TEXT'); } catch {}
try { db.exec('ALTER TABLE cupons ADD COLUMN ilimitado_dias INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE cupom_resgates ADD COLUMN ilimitado_ate TEXT'); } catch {}

const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const somaDias = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const normCodigo = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
const resgates = (cupomId) => db.prepare('SELECT COUNT(*) n FROM cupom_resgates WHERE cupom_id=?').get(cupomId).n;

/** O que o cupom dá, em português, para mostrar ao cliente. */
export function descreverCupom(c) {
  const p = []; if (c.ilimitado_dias > 0) p.push(`${c.ilimitado_dias} dias de uso sem limite`); if (c.creditos > 0) p.push(`${Number(c.creditos).toLocaleString('pt-BR')} créditos de brinde`);
  if (c.desconto_pct > 0) p.push(`${Number(c.desconto_pct).toLocaleString('pt-BR')}% de desconto${c.aplica === 'prepago' ? ' em pacotes de créditos' : c.aplica === 'mensal' ? ' no plano mensal' : ''}${c.desconto_dias > 0 ? ` por ${c.desconto_dias} dia${c.desconto_dias > 1 ? 's' : ''}` : ''}`);
  return p.join(' + ') || 'sem benefício';
}

/** Confere se o cupom pode ser usado por esta conta. Devolve o cupom ou lança erro com o motivo. */
export function validarCupom(contaId, codigo) {
  const c = db.prepare('SELECT * FROM cupons WHERE codigo=?').get(normCodigo(codigo));
  if (!c || !c.ativo) throw new Error('Cupom não encontrado. Confira as letras e números.');
  if (c.validade_ate && hojeBR() > c.validade_ate) throw new Error('Esse cupom expirou.');
  if (c.max_resgates && resgates(c.id) >= c.max_resgates) throw new Error('Esse cupom já atingiu o limite de usos.');
  if (contaId && db.prepare('SELECT 1 FROM cupom_resgates WHERE cupom_id=? AND conta_id=?').get(c.id, contaId)) throw new Error('Você já usou esse cupom.');
  if (contaId && c.so_novos && db.prepare("SELECT 1 FROM cobrancas WHERE conta_id=? AND status='pago'").get(contaId)) throw new Error('Esse cupom é só para quem ainda não fez nenhuma compra.');
  return c;
}

/** Resgata: dá os créditos na hora e abre a janela de desconto. */
export function resgatarCupom(contaId, codigo) {
  const c = validarCupom(contaId, codigo); const ate = c.desconto_pct > 0 ? somaDias(hojeBR(), Math.max(1, c.desconto_dias || 30) - 1) : null;
  const ilimAte = c.ilimitado_dias > 0 ? somaDias(hojeBR(), c.ilimitado_dias - 1) : null;
  db.transaction(() => {
    db.prepare('INSERT INTO cupom_resgates (cupom_id, conta_id, creditos_dados, desconto_pct, desconto_ate, aplica, ilimitado_ate) VALUES (?,?,?,?,?,?,?)').run(c.id, contaId, c.creditos || 0, c.desconto_pct || 0, ate, c.aplica || 'todos', ilimAte);
    if (c.creditos > 0) creditar(contaId, c.creditos, { tipo: 'cupom', motivo: `Cupom ${c.codigo}${c.descricao ? ' · ' + c.descricao : ''}`, ref: `cupom:${c.id}` });
  })();
  return { ok: true, codigo: c.codigo, ilimitado_ate: ilimAte, creditos: c.creditos || 0, desconto_pct: c.desconto_pct || 0, desconto_ate: ate, aplica: c.aplica, beneficio: descreverCupom(c) };
}

/** Melhor desconto ativo da conta para um tipo de pacote ('prepago' | 'mensal'). */
export function descontoAtivo(contaId, tipo) {
  const r = db.prepare(`SELECT r.desconto_pct pct, r.desconto_ate ate, c.codigo FROM cupom_resgates r JOIN cupons c ON c.id=r.cupom_id
    WHERE r.conta_id=? AND r.desconto_pct>0 AND r.desconto_ate>=? AND (r.aplica='todos' OR r.aplica=?) ORDER BY r.desconto_pct DESC LIMIT 1`).get(contaId, hojeBR(), tipo);
  return r ? { pct: r.pct, ate: r.ate, codigo: r.codigo } : null;
}
export const precoComDesconto = (preco, pct) => Math.max(1, Math.round(preco * (1 - pct / 100) * 100) / 100);

/** Para a tela Créditos: benefícios em vigor e histórico de cupons. */
export function cuponsDaConta(contaId) {
  const lista = db.prepare(`SELECT c.codigo, c.descricao, r.creditos_dados, r.desconto_pct, r.desconto_ate, r.aplica, r.ilimitado_ate, r.resgatado_em FROM cupom_resgates r JOIN cupons c ON c.id=r.cupom_id WHERE r.conta_id=? ORDER BY r.id DESC`).all(contaId);
  return { ativos: lista.filter(x => x.desconto_pct > 0 && x.desconto_ate >= hojeBR()), lista };
}

/** Plano mensal comprado com desconto: quando a janela acaba, volta ao preço cheio no gateway. */
export async function encerrarDescontosVencidos(atualizarValor) {
  const rows = db.prepare("SELECT * FROM assinaturas WHERE status='ativa' AND desconto_ate IS NOT NULL AND desconto_ate < ? AND valor_cheio IS NOT NULL").all(hojeBR());
  for (const a of rows) {
    try { await atualizarValor(a, a.valor_cheio); db.prepare('UPDATE assinaturas SET valor=valor_cheio, desconto_ate=NULL WHERE id=?').run(a.id); console.log('[cupons] plano voltou ao preço cheio', a.conta_id); }
    catch (e) { console.error('[cupons] não consegui voltar o preço do plano', a.conta_id, e.message); }
  }
}

// ---------- admin ----------
export function listarCupons() {
  return db.prepare('SELECT c.*, (SELECT COUNT(*) FROM cupom_resgates r WHERE r.cupom_id=c.id) resgates, (SELECT COUNT(*) FROM cobrancas b WHERE b.cupom=c.codigo AND b.status=\'pago\') compras FROM cupons c ORDER BY c.ativo DESC, c.id DESC').all();
}
export function salvarCupom(b = {}) {
  const codigo = normCodigo(b.codigo); if (!/^[A-Z0-9_-]{3,40}$/.test(codigo)) throw new Error('código: 3 a 40 letras/números, sem espaço');
  const creditos = Math.max(0, Math.round(Number(b.creditos) || 0)), pct = Math.min(90, Math.max(0, Number(b.desconto_pct) || 0)), dias = Math.max(0, Math.round(Number(b.desconto_dias) || 0));
  const ilim = Math.max(0, Math.round(Number(b.ilimitado_dias) || 0));
  if (!creditos && !pct && !ilim) throw new Error('o cupom precisa dar créditos, desconto ou dias de uso sem limite');
  const aplica = ['todos', 'prepago', 'mensal'].includes(b.aplica) ? b.aplica : 'todos';
  const vals = [codigo, String(b.descricao || '').slice(0, 120) || null, creditos, pct, pct ? (dias || 30) : 0, aplica, /^\d{4}-\d{2}-\d{2}$/.test(b.validade_ate || '') ? b.validade_ate : null, Number(b.max_resgates) > 0 ? Math.round(b.max_resgates) : null, b.so_novos ? 1 : 0, b.ativo === false || b.ativo === 0 ? 0 : 1, ilim];
  if (b.id) { db.prepare('UPDATE cupons SET codigo=?, descricao=?, creditos=?, desconto_pct=?, desconto_dias=?, aplica=?, validade_ate=?, max_resgates=?, so_novos=?, ativo=?, ilimitado_dias=? WHERE id=?').run(...vals, Number(b.id)); return { ok: true, id: Number(b.id) }; }
  if (db.prepare('SELECT 1 FROM cupons WHERE codigo=?').get(codigo)) throw new Error('já existe um cupom com esse código');
  return { ok: true, id: Number(db.prepare('INSERT INTO cupons (codigo, descricao, creditos, desconto_pct, desconto_dias, aplica, validade_ate, max_resgates, so_novos, ativo, ilimitado_dias) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...vals).lastInsertRowid) };
}
export function resgatesDoCupom(id) {
  return db.prepare('SELECT r.*, k.nome_dono, k.empresa, k.email FROM cupom_resgates r JOIN contas k ON k.id=r.conta_id WHERE r.cupom_id=? ORDER BY r.id DESC LIMIT 200').all(Number(id));
}
