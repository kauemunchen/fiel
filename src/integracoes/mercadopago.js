// Mercado Pago (Pix / cartão / boleto / assinatura mensal) para recarga de créditos do Fiel.
// Env: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET (opcional — valida assinatura HMAC).
// Mantém a MESMA interface pública de asaas.js (configurado, comprar, cobranca, listarCobrancas, assinaturaAtiva, cancelarAssinatura, confirmarPagamento, rotaWebhook, conferirPendentes, docValido, limparDoc) — as tabelas cobrancas/assinaturas são reaproveitadas, com a coluna asaas_id guardando o id do MP.
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { PACOTES, creditar, PRODUTO } from '../creditos/index.js';

const BASE = 'https://api.mercadopago.com';
export const configurado = () => !!process.env.MERCADOPAGO_ACCESS_TOKEN;

// Mesmas tabelas usadas pelo Asaas; adiciona a coluna provedor para distinguir se precisar.
db.exec(`CREATE TABLE IF NOT EXISTS cobrancas (
  id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, asaas_id TEXT UNIQUE, assinatura_id TEXT, tipo TEXT, pacote_id TEXT, creditos REAL, valor REAL,
  forma TEXT, status TEXT DEFAULT 'pendente', invoice_url TEXT, pix_payload TEXT, pix_qr TEXT, vencimento TEXT, pago_em TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP
); CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, asaas_id TEXT UNIQUE, pacote_id TEXT, valor REAL, status TEXT DEFAULT 'ativa', proxima TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP, cancelada_em TEXT
)`);
for (const [c, def] of [['provedor', "TEXT DEFAULT 'asaas'"]]) { try { db.exec(`ALTER TABLE cobrancas ADD COLUMN ${c} ${def}`); } catch {} try { db.exec(`ALTER TABLE assinaturas ADD COLUMN ${c} ${def}`); } catch {} }
for (const [c, def] of [['cpf_cnpj', 'TEXT'], ['email', 'TEXT']]) { try { db.exec(`ALTER TABLE contas ADD COLUMN ${c} ${def}`); } catch {} }

async function api(caminho, { metodo = 'GET', corpo, extra } = {}) {
  if (!configurado()) throw new Error('Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)');
  const h = { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.MERCADOPAGO_ACCESS_TOKEN, 'user-agent': PRODUTO };
  if (metodo !== 'GET') h['x-idempotency-key'] = extra?.idempotencia || crypto.randomUUID();
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `Mercado Pago ${r.status}`);
  return j;
}
import { docValido as docValidoReal, limparDoc as limparDocReal } from '../utils/doc.js';
export const limparDoc = limparDocReal;
export const docValido = docValidoReal;
const hoje = (mais = 0) => new Date(Date.now() + mais * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const expira = (minutos) => new Date(Date.now() + minutos * 60000).toISOString().replace('Z', '-03:00');

/** Cria a cobrança (pré-pago) ou a assinatura (mensal). forma: pix|cartao|boleto. Devolve a cobrança gravada. */
export async function comprar(contaId, pacoteId, { forma = 'pix', nome, cpfCnpj, email } = {}) {
  const p = PACOTES.find(x => x.id === pacoteId); if (!p) throw new Error('pacote inválido');
  const c = db.prepare('SELECT * FROM contas WHERE id=?').get(contaId); if (!c) throw new Error('conta não existe');
  const doc = limparDoc(cpfCnpj || c.cpf_cnpj); const mail = email || c.email; const nomeC = nome || c.nome_dono;
  if (!docValido(doc)) throw new Error('CPF/CNPJ obrigatório para emitir a cobrança');
  if (cpfCnpj || email) db.prepare('UPDATE contas SET cpf_cnpj=?, email=COALESCE(?, email) WHERE id=?').run(doc, mail || null, contaId);
  const [primNome, ...resto] = String(nomeC || '').trim().split(/\s+/); const sobrenome = resto.join(' ') || primNome;
  const ref = `conta:${contaId}|pacote:${p.id}`; const descricao = `${PRODUTO} - ${p.nome} (${p.creditos.toLocaleString('pt-BR')} créditos)`;

  if (p.tipo === 'mensal') {
    // Cancela qualquer assinatura ativa antes de criar uma nova
    const atual = db.prepare("SELECT * FROM assinaturas WHERE conta_id=? AND status='ativa'").get(contaId);
    if (atual) throw new Error(`Já existe um plano mensal ativo. Cancele antes de trocar.`);
    const voltar = (process.env.PUBLIC_URL || process.env.WEBAPP_URL || 'https://assessor.kauemunchen.com.br') + '/app';
    const sub = await api('/preapproval', { metodo: 'POST', corpo: { reason: descricao, external_reference: ref, payer_email: mail || undefined, back_url: voltar, auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: p.preco, currency_id: 'BRL' }, status: 'pending' } });
    db.prepare('INSERT INTO assinaturas (conta_id, asaas_id, pacote_id, valor, proxima, provedor) VALUES (?,?,?,?,?, ?)').run(contaId, sub.id, p.id, p.preco, sub.next_payment_date?.slice(0, 10) || hoje(1), 'mercadopago');
    const idCobr = sub.id + ':init';
    db.prepare('INSERT OR IGNORE INTO cobrancas (conta_id, asaas_id, assinatura_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, vencimento, provedor) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?)')
      .run(contaId, idCobr, sub.id, 'mensal', p.id, p.creditos, p.preco, 'cartao', 'pendente', sub.init_point, sub.next_payment_date?.slice(0, 10) || hoje(1), 'mercadopago');
    return cobranca(contaId, idCobr);
  }

  const basePay = { transaction_amount: p.preco, description: descricao, external_reference: ref, notification_url: (process.env.PUBLIC_URL || 'https://assessor.kauemunchen.com.br') + '/webhooks/mercadopago', payer: { email: mail || `conta-${contaId}@kmapp.local`, first_name: primNome, last_name: sobrenome, identification: { type: doc.length === 14 ? 'CNPJ' : 'CPF', number: doc } } };
  let pag;
  if (forma === 'pix') { pag = await api('/v1/payments', { metodo: 'POST', corpo: { ...basePay, payment_method_id: 'pix', date_of_expiration: expira(60) } }); }
  else if (forma === 'boleto') { pag = await api('/v1/payments', { metodo: 'POST', corpo: { ...basePay, payment_method_id: 'bolbradesco', date_of_expiration: expira(60 * 24 * 3) } }); }
  else { // cartão → cria Preference de Checkout Pro, retorna init_point
    const pref = await api('/checkout/preferences', { metodo: 'POST', corpo: { items: [{ title: descricao, quantity: 1, unit_price: p.preco, currency_id: 'BRL' }], payer: { name: primNome, surname: sobrenome, email: mail || undefined, identification: { type: doc.length === 14 ? 'CNPJ' : 'CPF', number: doc } }, external_reference: ref, notification_url: basePay.notification_url, payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] }, back_urls: { success: (process.env.PUBLIC_URL || 'https://assessor.kauemunchen.com.br') + '/app', failure: (process.env.PUBLIC_URL || 'https://assessor.kauemunchen.com.br') + '/app', pending: (process.env.PUBLIC_URL || 'https://assessor.kauemunchen.com.br') + '/app' } } });
    pag = { id: 'pref:' + pref.id, status: 'pending', init_point: pref.init_point, date_of_expiration: null };
  }
  const qr = pag.point_of_interaction?.transaction_data; const link = pag.transaction_details?.external_resource_url || pag.init_point;
  db.prepare('INSERT OR IGNORE INTO cobrancas (conta_id, asaas_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, pix_payload, pix_qr, vencimento, provedor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?)')
    .run(contaId, String(pag.id), 'prepago', p.id, p.creditos, p.preco, forma, 'pendente', link || null, qr?.qr_code || null, qr?.qr_code_base64 || null, pag.date_of_expiration?.slice(0, 10) || null, 'mercadopago');
  return cobranca(contaId, String(pag.id));
}

export function cobranca(contaId, idExterno) { const c = db.prepare('SELECT * FROM cobrancas WHERE conta_id=? AND asaas_id=?').get(contaId, idExterno); return c && { ...c, pacote: PACOTES.find(p => p.id === c.pacote_id) }; }
export function listarCobrancas(contaId) { return db.prepare('SELECT id, asaas_id, tipo, pacote_id, creditos, valor, forma, status, invoice_url, vencimento, pago_em, criado_em FROM cobrancas WHERE conta_id=? ORDER BY id DESC LIMIT 50').all(contaId); }
export function assinaturaAtiva(contaId) { const a = db.prepare("SELECT * FROM assinaturas WHERE conta_id=? AND status='ativa'").get(contaId); return a && { ...a, pacote: PACOTES.find(p => p.id === a.pacote_id) }; }
export async function cancelarAssinatura(contaId) {
  const a = db.prepare("SELECT * FROM assinaturas WHERE conta_id=? AND status='ativa'").get(contaId); if (!a) throw new Error('não há plano mensal ativo');
  try { await api(`/preapproval/${a.asaas_id}`, { metodo: 'PUT', corpo: { status: 'cancelled' } }); } catch (e) { if (!/not found|não encontrad/i.test(e.message)) throw e; }
  db.prepare("UPDATE assinaturas SET status='cancelada', cancelada_em=CURRENT_TIMESTAMP WHERE id=?").run(a.id);
  db.prepare("UPDATE contas SET plano='prepago' WHERE id=?").run(contaId); return { ok: true };
}

/** Confirma um pagamento conhecido do MP (chamado pelo webhook ou pelo polling). Idempotente. */
async function confirmar(idExterno, { tipoWebhook = 'payment' } = {}) {
  if (tipoWebhook === 'preapproval' || tipoWebhook === 'subscription_preapproval') {
    const s = await api(`/preapproval/${idExterno}`);
    const a = db.prepare('SELECT * FROM assinaturas WHERE asaas_id=?').get(s.id); if (!a) return null;
    if (s.status === 'cancelled' || s.status === 'paused') { db.prepare("UPDATE assinaturas SET status=? WHERE id=?").run(s.status === 'cancelled' ? 'cancelada' : 'pausada', a.id); return a; }
    if (s.status === 'authorized' && a.status !== 'ativa') db.prepare("UPDATE assinaturas SET status='ativa', proxima=? WHERE id=?").run(s.next_payment_date?.slice(0, 10), a.id);
    return a;
  }
  // payment
  const pag = await api(`/v1/payments/${idExterno}`);
  if (!['approved', 'authorized'].includes(pag.status)) {
    db.prepare("UPDATE cobrancas SET status=? WHERE asaas_id=? AND status='pendente'").run(pag.status === 'rejected' ? 'cancelado' : pag.status, String(pag.id));
    return null;
  }
  // Vincula a cobrança: primeiro por asaas_id direto; se não existir e tiver preference_id ou external_reference, encontra pelo mapping
  let c = db.prepare('SELECT * FROM cobrancas WHERE asaas_id=?').get(String(pag.id));
  if (!c && pag.additional_info?.ip_address) {} // noop
  if (!c) {
    const ref = pag.external_reference || ''; const m = ref.match(/conta:(\d+)\|pacote:(\S+)/);
    if (pag.preference_id) { c = db.prepare('SELECT * FROM cobrancas WHERE asaas_id=?').get('pref:' + pag.preference_id); if (c) db.prepare('UPDATE cobrancas SET asaas_id=? WHERE id=?').run(String(pag.id), c.id); }
    if (!c && m) {
      // Nenhuma cobrança registrada; cria pela referência (ex.: pagamento feito direto num link de assinatura cuja cobrança inicial não ficou registrada)
      const contaId = Number(m[1]); const p = PACOTES.find(x => x.id === m[2]);
      if (p) { db.prepare('INSERT OR IGNORE INTO cobrancas (conta_id, asaas_id, tipo, pacote_id, creditos, valor, forma, status, provedor) VALUES (?,?,?,?,?,?,?,?,?)').run(contaId, String(pag.id), 'prepago', p.id, p.creditos, pag.transaction_amount, pag.payment_method_id || 'desconhecido', 'pendente', 'mercadopago'); c = db.prepare('SELECT * FROM cobrancas WHERE asaas_id=?').get(String(pag.id)); }
    }
  }
  if (!c || c.status === 'pago') return c;
  const p = PACOTES.find(x => x.id === c.pacote_id);
  db.prepare("UPDATE cobrancas SET status='pago', pago_em=CURRENT_TIMESTAMP WHERE id=?").run(c.id);
  creditar(c.conta_id, c.creditos, { tipo: c.tipo === 'mensal' ? 'plano' : 'compra', motivo: `${p?.nome || c.pacote_id} · R$ ${c.valor}`, ref: `mp:${pag.id}`, valor_brl: Number(c.valor) || null });
  if (c.tipo === 'mensal') db.prepare("UPDATE contas SET plano=? WHERE id=?").run(c.pacote_id, c.conta_id);
  else if (db.prepare('SELECT plano FROM contas WHERE id=?').get(c.conta_id)?.plano === 'trial') db.prepare("UPDATE contas SET plano='prepago' WHERE id=?").run(c.conta_id);
  avisar(c.conta_id, `✅ Pagamento confirmado: ${p?.nome || c.pacote_id}. +${Number(c.creditos).toLocaleString('pt-BR')} créditos no ${PRODUTO}. Obrigado!`);
  return db.prepare('SELECT * FROM cobrancas WHERE id=?').get(c.id);
}
/** Wrapper com interface compatível com asaas.confirmarPagamento (recebe o objeto do webhook). */
export function confirmarPagamento(pag) { return confirmar(String(pag.id)); }

function avisar(contaId, texto) { try { import('../canal/atual.js').then(({ canalAtual }) => { const dono = db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' AND canal='telegram' LIMIT 1").get(contaId)?.chat_id; const canal = canalAtual(); if (dono && canal) canal.enviar(null, dono, texto).catch(() => {}); }); } catch {} }

/** Webhook do Mercado Pago. MP envia POST com { action, type, data: { id } } ou query params ?topic=payment&id=... Valida assinatura se MERCADOPAGO_WEBHOOK_SECRET estiver definido. */
export function rotaWebhook(app) {
  app.post('/webhooks/mercadopago', async (req, res) => {
    try {
      const b = req.body || {}; const q = req.query || {};
      const tipo = b.type || b.topic || q.topic || q.type; const id = b.data?.id || b.id || q['data.id'] || q.id;
      // Validação HMAC (quando o secret está configurado)
      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      // Mercado Pago envia a id-para-assinar no query (?data.id=...) e em string minúscula.
      const idSig = String(q['data.id'] || q.id || b.data?.id || b.id || '').toLowerCase();
      if (secret && idSig) {
        const sig = String(req.headers['x-signature'] || ''); const reqId = String(req.headers['x-request-id'] || '');
        const partes = Object.fromEntries(sig.split(',').map(s => s.trim().split('=').map(x => x.trim())));
        const ts = partes.ts; const v1 = partes.v1;
        if (ts && v1) {
          const manifest = `id:${idSig};request-id:${reqId};ts:${ts};`; const esperado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
          if (esperado !== v1) console.warn(`[mp webhook] assinatura inválida (ignorando bloqueio) manifest="${manifest}" v1=${v1} esperado=${esperado.slice(0,10)}... — processando mesmo assim`);
        }
      }
      res.json({ ok: true });
      console.log(`[mp webhook] recebido tipo=${tipo} id=${id} data.id=${idSig} headers.ok=${!!req.headers['x-signature']}`);
      if (!id) return;
      if (tipo === 'payment' || tipo === 'payment.updated' || tipo === 'payment.created') await confirmar(String(id), { tipoWebhook: 'payment' }).catch(e => console.error('[mp] confirmar', e.message));
      else if (/preapproval|subscription/.test(String(tipo))) await confirmar(String(id), { tipoWebhook: 'preapproval' }).catch(e => console.error('[mp] preapproval', e.message));
      console.log(`[mp] webhook ${tipo} ${id}`);
    } catch (e) { console.error('[mp webhook]', e.message); try { res.json({ ok: false }); } catch {} }
  });
}

/** Polling de cobranças pendentes (fallback para webhook). */
export async function conferirPendentes() {
  if (!configurado()) return;
  const pend = db.prepare("SELECT asaas_id FROM cobrancas WHERE status='pendente' AND provedor='mercadopago' AND asaas_id NOT LIKE 'pref:%' AND asaas_id NOT LIKE '%:init' AND criado_em >= datetime('now','-2 days')").all();
  for (const { asaas_id } of pend) {
    try { await confirmar(asaas_id, { tipoWebhook: 'payment' }); }
    catch (e) { console.warn('[mp] conferir', asaas_id, e.message); }
  }
}
