// Contas financeiras de cada carteira: contas bancárias, cartões de crédito/débito e dinheiro.
// Carteira = de quem é o dinheiro (uma empresa, a vida pessoal). Conta financeira = ONDE ele está ou por onde passa.
import { db } from '../db/index.js';

export const TIPOS = { banco: 'Conta bancária', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro', outro: 'Outro' };

export function prepararContasFin() {
  db.exec(`CREATE TABLE IF NOT EXISTS fin_contas (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, carteira TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL,
      instituicao TEXT, final TEXT, limite REAL, dia_fechamento INTEGER, dia_vencimento INTEGER, pagar_com_id INTEGER, ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0, criado_em TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS ix_fin_contas ON fin_contas (conta_id, carteira)`);
  try { db.exec('ALTER TABLE fin_lancamentos ADD COLUMN conta_fin_id INTEGER'); } catch {}
  try { db.exec('ALTER TABLE fin_saldos ADD COLUMN conta_fin_id INTEGER'); } catch {}
  try { db.exec('ALTER TABLE fin_lancamentos ADD COLUMN pago_com_id INTEGER'); } catch {} // fatura de cartão paga com qual conta
}

const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const rotuloConta = (c) => `${c.nome}${c.final ? ` ••${c.final}` : ''}`;

export function listarContasFin(contaId, carteira, { todas = false } = {}) {
  return db.prepare(`SELECT * FROM fin_contas WHERE conta_id=? ${carteira ? 'AND carteira=?' : ''} ${todas ? '' : 'AND ativo=1'} ORDER BY carteira, principal DESC, tipo, nome`).all(...(carteira ? [contaId, carteira] : [contaId]));
}

/** Acha a conta financeira por nome, instituição, final do cartão ou tipo ("dinheiro"). */
export function acharContaFin(contaId, carteira, ref) {
  if (!ref) return null; const lista = listarContasFin(contaId, carteira); const r = semAcento(ref);
  const fin = (String(ref).match(/(\d{4})\s*$/) || [])[1];
  return (fin && lista.find(c => c.final === fin)) || lista.find(c => semAcento(c.nome) === r || semAcento(rotuloConta(c)) === r)
    || lista.find(c => semAcento(c.nome).includes(r) || r.includes(semAcento(c.nome)) || (c.instituicao && r.includes(semAcento(c.instituicao))))
    || (/dinheiro|especie|caixa/.test(r) ? lista.find(c => c.tipo === 'dinheiro') : null)
    || (/credito/.test(r) ? (l => l.length === 1 ? l[0] : null)(lista.filter(c => c.tipo === 'cartao_credito')) : null) || null;
}

/** Resolve a conta financeira de um lançamento; carteira com várias contas e referência inválida → erro com opções. */
export function resolverContaFin(contaId, carteira, ref) {
  const lista = listarContasFin(contaId, carteira); if (!lista.length) return null; // carteira sem contas cadastradas: segue sem
  if (!ref) return null;
  const c = acharContaFin(contaId, carteira, ref);
  if (!c) throw new Error(`"${ref}" não é uma conta/cartão da carteira ${carteira}. Cadastrados: ${lista.map(x => `${rotuloConta(x)} (${TIPOS[x.tipo]})`).join(' · ')}`);
  return c;
}

/** Vencimento da fatura em que cai uma compra feita em `data` no cartão. */
export function vencimentoFatura(cartao, data) {
  const fech = Number(cartao.dia_fechamento) || 0, venc = Number(cartao.dia_vencimento) || 0; if (!venc) return data;
  const d = new Date(data + 'T12:00:00Z'); let ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  if (fech && d.getUTCDate() > fech) mes += 1;            // comprou depois do fechamento: próxima fatura
  if (fech && venc <= fech) mes += 1;                      // vencimento cai no mês seguinte ao fechamento
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(venc, ultimo), 12)).toISOString().slice(0, 10);
}

/** Saldo de uma conta bancária/dinheiro: último saldo informado + movimentos pagos depois dele. */
export function saldoContaFin(contaId, contaFinId) {
  const s = db.prepare('SELECT saldo, data FROM fin_saldos WHERE conta_id=? AND conta_fin_id=? ORDER BY data DESC, id DESC LIMIT 1').get(contaId, contaFinId);
  const desde = s?.data || '0000-00-00';
  const mov = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) v FROM fin_lancamentos WHERE conta_id=? AND COALESCE(pago_com_id, conta_fin_id)=? AND status='pago' AND oculto=0 AND COALESCE(pago_em,data) > ?`).get(contaId, contaFinId, desde).v;
  return { saldo: +((s?.saldo || 0) + mov).toFixed(2), informado: !!s, data_base: s?.data || null };
}

/** Fatura em aberto de um cartão de crédito (compras previstas agrupadas pelo vencimento). */
export function faturasCartao(contaId, cartaoId) {
  return db.prepare(`SELECT COALESCE(vencimento,data) venc, SUM(valor) total, COUNT(*) n FROM fin_lancamentos WHERE conta_id=? AND conta_fin_id=? AND status IN ('previsto','pendente') AND oculto=0 AND tipo='saida' GROUP BY 1 ORDER BY 1`).all(contaId, cartaoId).map(f => ({ ...f, total: +f.total.toFixed(2) }));
}

export function resumoContasFin(contaId) {
  try { const l = listarContasFin(contaId); if (!l.length) return ''; return l.map(c => `${c.carteira}: ${rotuloConta(c)} (${TIPOS[c.tipo]})`).join(' · '); } catch { return ''; }
}
try { prepararContasFin(); } catch {}
