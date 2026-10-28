// Asaas (Pix / cartão / assinatura mensal) para recarga de créditos do Fiel.
// Env: ASAAS_API_KEY, ASAAS_AMBIENTE=sandbox|producao, ASAAS_WEBHOOK_TOKEN (token configurado no webhook do Asaas).
import { db } from '../db/index.js';
import { PACOTES, creditar, PRODUTO } from '../creditos/index.js';

const BASE = () => process.env.ASAAS_BASE_URL || ((process.env.ASAAS_AMBIENTE || 'sandbox') === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3');
export const configurado = () => !!process.env.ASAAS_API_KEY;

db.exec(`CREATE TABLE IF NOT EXISTS cobrancas (
  id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, asaas_id TEXT UNIQUE, assinatura_id TEXT, tipo TEXT, pacote_id TEXT, creditos REAL, valor REAL,
  forma TEXT, status TEXT DEFAULT 'pendente', invoice_url TEXT, pix_payload TEXT, pix_qr TEXT, vencimento TEXT, pago_em TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP
); CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, asaas_id TEXT UNIQUE, pacote_id TEXT, valor REAL, status TEXT DEFAULT 'ativa', proxima TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP, cancelada_em TEXT
)`);
for (const [c, def] of [['asaas_cliente_id', 'TEXT'], ['cpf_cnpj', 'TEXT'], ['email', 'TEXT']]) { try { db.exec(`ALTER TABLE contas ADD COLUMN ${c} ${def}`); } catch {} }

async function api(caminho, { metodo = 'GET', corpo } = {}) {
  if (!configurado()) throw new Error('Asaas não configurado (ASAAS_API_KEY)');
  const r = await fetch(BASE() + caminho, { method: metodo, headers: { 'content-type': 'application/json', access_token: process.env.ASAAS_API_KEY, 'user-agent': PRODUTO }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.errors?.map(e => e.description).join('; ') || `Asaas ${r.status}`);
  return j;
}
const hoje = (mais = 0) => new Date(Date.now() + mais * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
import { docValido as docValidoReal, limparDoc as limparDocReal } from '../utils/doc.js';
export const limparDoc = limparDocReal;
export const docValido = docValidoReal;

/** Garante o cliente no Asaas (um por conta). Atualiza CPF/CNPJ e e-mail da conta. */
export async function garantirCliente(contaId, { nome, cpfCnpj, email } = {}) {
  const c = db.prepare('SELECT * FROM contas WHERE id=?').get(contaId);
  const doc = limparDoc(cpfCnpj || c.cpf_cnpj); const mail = email || c.email; const nomeC = nome || c.nome_dono;
  if (!docValido(doc)) throw new Error('CPF/CNPJ obrigatório para emitir a cobrança');
  if (cpfCnpj || email) db.prepare('UPDATE contas SET cpf_cnpj=?, email=COALESCE(?, email) WHERE id=?').run(doc, mail || null, contaId);
  if (c.asaas_cliente_id) { try { await api(`/customers/${c.asaas_cliente_id}`, { metodo: 'PUT', corpo: { name: nomeC, cpfCnpj: doc, email: mail || undefined } }); } catch {} return c.asaas_cliente_id; }
  const j = await api('/customers', { metodo: 'POST', corpo: { name: nomeC, cpfCnpj: doc, email: mail || undefined, externalReference: `conta:${contaId}`, notificationDisabled: false } });
  db.prepare('UPDATE contas SET asaas_cliente_id=? WHERE id=?').run(j.id, contaId); return j.id;
}

/** Cria a cobrança (pré-pago) ou a assinatura (mensal). forma: pix | cartao | boleto. Devolve {cobranca} com link/QR. */
export async function comprar(contaId, pacoteId, { forma = 'pix', nome, cpfCnpj, email } = {}) {
  const p = PACOTES.find(x => x.id === pacoteId); if (!p) throw new Error('pacote inválido');
  const cliente = await garantirCliente(contaId, { nome, cpfCnpj, email });
  const billingType = forma === 'cartao' ? 'CREDIT_CARD' : forma === 'boleto' ? 'BOLETO' : 'PIX';
  const descricao = `${PRODUTO} · ${p.nome} (${p.creditos.toLocaleString('pt-BR')} créditos)`;
  let pag, assinaturaId = null;
  if (p.tipo === 'mensal') {
    const atual = db.prepare("SELECT * FROM assinaturas WHERE conta_id=? AND status='ativa'").get(contaId);
    if (atual) throw new Error(`Já existe um plano mensal ativo (${PACOTES.find(x => x.id === atual.pacote_id)?.nome || atual.pacote_id}). Cancele antes de trocar.`);
    const s = await api('/subscriptions', { metodo: 'POST', corpo: { customer: cliente, billingType, value: p.preco, nextDueDate: hoje(1), cycle: 'MONTHLY', description: descricao, externalReference: `conta:${contaId}|pacote:${p.id}` } });
    assinaturaId = s.id;
    db.prepare('INSERT INTO assinaturas (conta_id, asaas_id, pacote_id, valor, proxima) VALUES (?,?,?,?,?)').run(contaId, s.id, p.id, p.preco, s.nextDueDate || hoje(1));
    const lista = await api(`/subscriptions/${s.id}/payments?limit=1`); pag = lista.data?.[0];
    if (!pag) throw new Error('assinatura criada, mas a primeira cobrança ainda não foi gerada; tente de novo em 1 min');
  } else {
    pag = await api('/payments', { metodo: 'POST', corpo: { customer: cliente, billingType, value: p.preco, dueDate: hoje(2), description: descricao, externalReference: `conta:${contaId}|pacote:${p.id}` } });
  }
  let pix = null; if (billingType === 'PIX') { try { pix = await api(`/payments/${pag.id}/pixQrCode`); } catch {} }
  db.prepare('INSERT OR IGNORE INTO cobrancas (conta_id, asaas_id, assinatura_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, pix_payload, pix_qr, vencimento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(contaId, pag.id, assinaturaId, p.tipo, p.id, p.creditos, p.preco, forma, 'pendente', pag.invoiceUrl || null, pix?.payload || null, pix?.encodedImage || null, pag.dueDate || null);
  return cobranca(contaId, pag.id);
}
export function cobranca(contaId, asaasId) { const c = db.prepare('SELECT * FROM cobrancas WHERE conta_id=? AND asaas_id=?').get(contaId, asaasId); return c && { ...c, pacote: PACOTES.find(p => p.id === c.pacote_id) }; }
export function listarCobrancas(contaId) { return db.prepare('SELECT id, asaas_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, vencimento, pago_em, criado_em FROM cobrancas WHERE conta_id=? ORDER BY id DESC LIMIT 50').all(contaId); }
export function assinaturaAtiva(contaId) { const a = db.prepare("SELECT * FROM assinaturas WHERE conta_id=? AND status='ativa'").get(contaId); return a && { ...a, pacote: PACOTES.find(p => p.id === a.pacote_id) }; }
export async function cancelarAssinatura(contaId) {
  const a = db.prepare("SELECT * FROM assinaturas WHERE conta_id=? AND status='ativa'").get(contaId); if (!a) throw new Error('não há plano mensal ativo');
  try { await api(`/subscriptions/${a.asaas_id}`, { metodo: 'DELETE' }); } catch (e) { if (!/não encontrad|not found/i.test(e.message)) throw e; }
  db.prepare("UPDATE assinaturas SET status='cancelada', cancelada_em=CURRENT_TIMESTAMP WHERE id=?").run(a.id);
  db.prepare("UPDATE contas SET plano='prepago' WHERE id=?").run(contaId); return { ok: true };
}

/** Confirma um pagamento (webhook ou polling). Idempotente: credita uma vez por asaas_id. */
export function confirmarPagamento(pag) {
  const asaasId = pag.id; let c = db.prepare('SELECT * FROM cobrancas WHERE asaas_id=?').get(asaasId);
  if (!c && pag.subscription) { // renovação mensal: cobrança nova gerada pelo Asaas
    const a = db.prepare('SELECT * FROM assinaturas WHERE asaas_id=?').get(pag.subscription); if (!a) return null;
    const p = PACOTES.find(x => x.id === a.pacote_id);
    db.prepare('INSERT OR IGNORE INTO cobrancas (conta_id, asaas_id, assinatura_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, vencimento) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(a.conta_id, asaasId, a.asaas_id, 'mensal', a.pacote_id, p?.creditos || 0, pag.value, 'asaas', 'pendente', pag.invoiceUrl || null, pag.dueDate || null);
    c = db.prepare('SELECT * FROM cobrancas WHERE asaas_id=?').get(asaasId);
  }
  if (!c || c.status === 'pago') return c;
  const p = PACOTES.find(x => x.id === c.pacote_id);
  db.prepare("UPDATE cobrancas SET status='pago', pago_em=CURRENT_TIMESTAMP WHERE id=?").run(c.id);
  creditar(c.conta_id, c.creditos, { tipo: c.tipo === 'mensal' ? 'plano' : 'compra', motivo: `${p?.nome || c.pacote_id} · R$ ${c.valor}`, ref: `asaas:${asaasId}`, valor_brl: Number(c.valor) || null });
  if (c.tipo === 'mensal') { db.prepare("UPDATE contas SET plano=? WHERE id=?").run(c.pacote_id, c.conta_id); if (c.assinatura_id) db.prepare("UPDATE assinaturas SET proxima=date(?, '+1 month') WHERE asaas_id=?").run(pag.dueDate || hoje(), c.assinatura_id); }
  else if (db.prepare('SELECT plano FROM contas WHERE id=?').get(c.conta_id)?.plano === 'trial') db.prepare("UPDATE contas SET plano='prepago' WHERE id=?").run(c.conta_id);
  avisar(c.conta_id, `✅ Pagamento confirmado: ${p?.nome || c.pacote_id}. +${Number(c.creditos).toLocaleString('pt-BR')} créditos no ${PRODUTO}. Obrigado!`);
  return db.prepare('SELECT * FROM cobrancas WHERE id=?').get(c.id);
}
function estornar(pag) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE asaas_id=?').get(pag.id); if (!c || c.status !== 'pago') return;
  db.prepare("UPDATE cobrancas SET status='estornado' WHERE id=?").run(c.id);
  db.prepare('INSERT INTO creditos_mov (conta_id, tipo, quantidade, motivo, ref) VALUES (?,?,?,?,?)').run(c.conta_id, 'ajuste', -c.creditos, 'estorno', `asaas:${pag.id}`);
  avisar(c.conta_id, `↩️ Pagamento estornado (${c.pacote_id}); ${Number(c.creditos).toLocaleString('pt-BR')} créditos removidos.`);
}
function avisar(contaId, texto) { try { import('../canal/atual.js').then(({ canalAtual }) => { const dono = db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' AND canal='telegram' LIMIT 1").get(contaId)?.chat_id; const canal = canalAtual(); if (dono && canal) canal.enviar(null, dono, texto).catch(() => {}); }); } catch {} }

/** Webhook do Asaas. Valida o token (header asaas-access-token) se ASAAS_WEBHOOK_TOKEN estiver definido. */
export function rotaWebhook(app) {
  app.post('/webhooks/asaas', (req, res) => {
    const esperado = process.env.ASAAS_WEBHOOK_TOKEN; if (esperado && req.headers['asaas-access-token'] !== esperado) return res.status(401).json({ erro: 'token' });
    const { event, payment } = req.body || {}; res.json({ ok: true }); // responde já; o Asaas reenvia se não receber 200
    try {
      if (!payment) return;
      if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) confirmarPagamento(payment);
      else if (['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(event)) estornar(payment);
      else if (event === 'PAYMENT_OVERDUE') db.prepare("UPDATE cobrancas SET status='vencido' WHERE asaas_id=? AND status='pendente'").run(payment.id);
      else if (event === 'PAYMENT_DELETED') db.prepare("UPDATE cobrancas SET status='cancelado' WHERE asaas_id=? AND status='pendente'").run(payment.id);
      console.log(`[asaas] ${event} ${payment.id} ${payment.status}`);
    } catch (e) { console.error('[asaas webhook]', e.message); }
  });
}
/** Reforço ao webhook: consulta no Asaas as cobranças pendentes das últimas 48 h. */
export async function conferirPendentes() {
  if (!configurado()) return;
  const pend = db.prepare("SELECT asaas_id FROM cobrancas WHERE status='pendente' AND criado_em >= datetime('now','-2 days')").all();
  for (const { asaas_id } of pend) {
    try { const p = await api(`/payments/${asaas_id}`); if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status)) confirmarPagamento(p); else if (p.status === 'OVERDUE') db.prepare("UPDATE cobrancas SET status='vencido' WHERE asaas_id=?").run(asaas_id); }
    catch (e) { console.warn('[asaas] conferir', asaas_id, e.message); }
  }
}
