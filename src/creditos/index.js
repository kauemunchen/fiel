// Créditos (Fiel): ledger por conta, tarifas, bloqueio por saldo e alertas.
// 1 crédito = 1.000 tokens de IA. Render/vídeo/fal têm tarifa fixa. Conta admin (ou plano 'ilimitado') nunca é cobrada nem bloqueada.
import { db } from '../db/index.js';
import { canalAtual } from '../canal/atual.js';

export function prepararCreditos() {
  db.exec(`CREATE TABLE IF NOT EXISTS creditos_mov (
    id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, tipo TEXT NOT NULL, quantidade REAL NOT NULL,
    motivo TEXT, modulo TEXT, ref TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  ); CREATE INDEX IF NOT EXISTS ix_creditos_conta ON creditos_mov (conta_id, criado_em)`);
  // Coluna com o valor em BRL da recarga (preenchida só para créditos pagos; usada pelo limitador de margem)
  try { db.exec(`ALTER TABLE creditos_mov ADD COLUMN valor_brl REAL`); } catch {}
  for (const [c, def] of [['plano', "TEXT DEFAULT 'trial'"], ['status', "TEXT DEFAULT 'ativa'"], ['admin', 'INTEGER DEFAULT 0'], ['creditos_alerta', 'TEXT'], ['email', 'TEXT'], ['pesquisa_web', 'INTEGER DEFAULT 0'], ['aceite_termos_em', 'TEXT'], ['aceite_termos_versao', 'TEXT'], ['aceite_termos_ip', 'TEXT'], ['bloqueada_margem_em', 'TEXT']]) { try { db.exec(`ALTER TABLE contas ADD COLUMN ${c} ${def}`); } catch {} }
  // Primeira conta do banco (a do Kauê) vira admin/ilimitada se ainda não houver nenhum admin.
  if (!db.prepare('SELECT id FROM contas WHERE admin=1').get()) { const p = db.prepare('SELECT id FROM contas ORDER BY id LIMIT 1').get(); if (p) db.prepare("UPDATE contas SET admin=1, plano='ilimitado' WHERE id=?").run(p.id); }
}
try { if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contas'").get()) prepararCreditos(); } catch {}

export const PRODUTO = 'Fiel';
export const SUPORTE_TELEFONE = '(47) 93388-3929';
export const SUPORTE_EMAIL = 'ola@usefiel.com';
export const TRIAL_CREDITOS = Number(process.env.TRIAL_CREDITOS || 250);
export const TOKENS_POR_CREDITO = 1000; // default/fallback; use tokensPorCredito() para o valor vigente (editável no painel admin → Custos & margem)
export function tokensPorCredito() {
  try {
    const r = db.prepare("SELECT valor FROM custos_cfg WHERE chave='tokens_por_credito'").get();
    const v = r?.valor ? Math.max(1, Math.floor(r.valor)) : 0;
    return v || TOKENS_POR_CREDITO;
  } catch { return TOKENS_POR_CREDITO; }
}
/** Tarifas fixas (em créditos) para o que não é medido em tokens. */
export const TARIFAS = {
  render_imagem: 1,      // arte estática / marca d'água composta
  render_story: 1,       // story no padrão da marca
  render_carrossel: 3,   // carrossel completo
  video_edicao: 5,       // corte, faixa, legenda, logo (ffmpeg)
  video_audio: 1,        // extrair/remover áudio
  fal_imagem: 4,         // imagem gerada por IA (fal.ai)
  transcricao_min: 0.5,  // por minuto de áudio transcrito (além dos tokens)
};
export const PACOTES_PADRAO = [
  { id: 'start', nome: 'Start', creditos: 1000, preco: 49, tipo: 'prepago' },
  { id: 'pro', nome: 'Pro', creditos: 3000, preco: 129, tipo: 'prepago' },
  { id: 'max', nome: 'Max', creditos: 8000, preco: 299, tipo: 'prepago' },
  { id: 'mensal_pro', nome: 'Plano Pro (mensal)', creditos: 3000, preco: 99, tipo: 'mensal' },
  { id: 'mensal_max', nome: 'Plano Max (mensal)', creditos: 8000, preco: 249, tipo: 'mensal' },
];
/** Lista de pacotes vigente — lê de pacotes_cfg (editável no painel admin) e cai no padrão se a tabela ainda não existe. */
export function pacotes() { try { if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pacotes_cfg'").get()) { const rows = db.prepare('SELECT id, nome, creditos, preco, tipo FROM pacotes_cfg WHERE ativo=1 ORDER BY ordem, id').all(); if (rows.length) return rows; } } catch {} return PACOTES_PADRAO; }
/** Compat: código antigo lê `PACOTES` como array; agora é um Proxy que delega para `pacotes()`. */
export const PACOTES = new Proxy([], { get(_t, k) { const arr = pacotes(); return typeof arr[k] === 'function' ? arr[k].bind(arr) : arr[k]; }, has(_t, k) { return k in pacotes(); }, ownKeys() { return Reflect.ownKeys(pacotes()); }, getOwnPropertyDescriptor(_t, k) { return Object.getOwnPropertyDescriptor(pacotes(), k); } });

const contaDe = (id) => db.prepare('SELECT id, plano, status, admin, creditos_alerta, nome_dono FROM contas WHERE id=?').get(id);
export function ilimitada(contaId) { const c = contaDe(contaId); return !!c && (c.admin === 1 || c.plano === 'ilimitado'); }
export function saldo(contaId) { return +(db.prepare('SELECT COALESCE(SUM(quantidade),0) s FROM creditos_mov WHERE conta_id=?').get(contaId).s).toFixed(3); }
/** Base para os alertas de 20%/5%: a última recarga (ou o trial). */
export function ultimaRecarga(contaId) { return db.prepare("SELECT quantidade FROM creditos_mov WHERE conta_id=? AND quantidade>0 ORDER BY id DESC LIMIT 1").get(contaId)?.quantidade || TRIAL_CREDITOS; }

export function creditar(contaId, quantidade, { tipo = 'credito', motivo = '', ref = null, valor_brl = null } = {}) {
  if (!(quantidade > 0)) throw new Error('quantidade inválida');
  db.prepare('INSERT INTO creditos_mov (conta_id, tipo, quantidade, motivo, ref, valor_brl) VALUES (?,?,?,?,?,?)').run(contaId, tipo, quantidade, motivo, ref, valor_brl);
  // Toda recarga limpa alertas e destrava bloqueios anteriores (saldo zero OU margem estourada)
  db.prepare("UPDATE contas SET creditos_alerta=NULL, bloqueada_margem_em=NULL, status=CASE WHEN status='bloqueada' THEN 'ativa' ELSE status END WHERE id=?").run(contaId);
  return saldo(contaId);
}

/** Limite de margem: se o custo real da IA desde a última recarga paga passar de
 * (1 - margem_piso) × valor_pago, bloqueia novos consumos até nova compra.
 * Trial e contas sem recarga paga ficam fora da regra. Não aplica a admin/ilimitada.
 * Lido via SQL direto para não criar dependência circular com src/custos.js. */
export function limiteMargem(contaId) {
  try {
    const c = contaDe(contaId); if (!c) return { aplicavel: false };
    if (c.admin === 1 || c.plano === 'ilimitado') return { aplicavel: false };
    const recarga = db.prepare("SELECT id, valor_brl, criado_em FROM creditos_mov WHERE conta_id=? AND quantidade>0 AND valor_brl>0 ORDER BY id DESC LIMIT 1").get(contaId);
    if (!recarga || !(recarga.valor_brl > 0)) return { aplicavel: false };
    const p = Object.fromEntries(db.prepare("SELECT chave, valor FROM custos_cfg").all().map(r => [r.chave, r.valor]));
    const piso = p['margem_piso'] ?? 0.50;
    const cambio = p['usd_brl'] || 5.6;
    const normal = (m) => { const s = String(m||'').toLowerCase(); if (s.includes('2.5-flash')&&!s.includes('lite')) return 'gemini-2.5-flash'; if (s.includes('2.5-pro')) return 'gemini-2.5-pro'; if (s.includes('flash-lite')) return 'gemini-flash-lite'; if (s.includes('2.0-flash')) return 'gemini-2.0-flash'; if (s.includes('1.5-flash')) return 'gemini-1.5-flash'; if (s.includes('1.5-pro')) return 'gemini-1.5-pro'; return 'gemini-2.5-flash'; };
    const u = db.prepare("SELECT modelo, SUM(tokens_in) ti, SUM(tokens_out) tout FROM uso WHERE conta_id=? AND criado_em >= ? GROUP BY modelo").all(contaId, recarga.criado_em);
    let custoUsd = 0;
    for (const r of u) { const k = normal(r.modelo); custoUsd += (r.ti||0)/1e6 * (p[k+'_in']||0) + (r.tout||0)/1e6 * (p[k+'_out']||0); }
    const custoBrl = +(custoUsd * cambio).toFixed(2);
    const limite = +(recarga.valor_brl * (1 - piso)).toFixed(2);
    return {
      aplicavel: true,
      valor_pago_brl: recarga.valor_brl,
      custo_atual_brl: custoBrl,
      limite_brl: limite,
      piso_pct: +(piso * 100).toFixed(0),
      bloqueado: custoBrl >= limite,
      pct_do_limite: limite > 0 ? +(custoBrl / limite * 100).toFixed(1) : 0,
      margem_atual_pct: +((1 - custoBrl / recarga.valor_brl) * 100).toFixed(1),
    };
  } catch (e) { console.error('[limiteMargem]', e.message); return { aplicavel: false, erro: e.message }; }
}
/** Debita (não lança erro: cobrança nunca derruba a operação). Dispara alertas de saldo. */
export function debitar(contaId, quantidade, { tipo = 'debito', motivo = '', modulo = null, ref = null } = {}) {
  try {
    if (!contaId || !(quantidade > 0) || ilimitada(contaId)) return null;
    const q = +Number(quantidade).toFixed(3);
    db.prepare('INSERT INTO creditos_mov (conta_id, tipo, quantidade, motivo, modulo, ref) VALUES (?,?,?,?,?,?)').run(contaId, tipo, -q, motivo, modulo, ref);
    const s = saldo(contaId); verificarAlertas(contaId, s); return s;
  } catch (e) { console.error('[creditos] debitar', e.message); return null; }
}
export function debitarTokens(contaId, modulo, tokens, modelo) { if (!(tokens > 0)) return; return debitar(contaId, tokens / tokensPorCredito(), { motivo: `IA ${modelo || ''}`.trim(), modulo, ref: `tokens:${tokens}` }); }
export function cobrar(contaId, item, { modulo = null, vezes = 1, ref = null } = {}) { const t = TARIFAS[item]; if (!t) return; return debitar(contaId, t * vezes, { motivo: item.replace(/_/g, ' '), modulo, ref }); }
export function concederTrial(contaId) { if (db.prepare("SELECT id FROM creditos_mov WHERE conta_id=? AND tipo='trial'").get(contaId)) return; creditar(contaId, TRIAL_CREDITOS, { tipo: 'trial', motivo: `Boas-vindas ao ${PRODUTO}` }); }

/** Pode consumir? (admin/ilimitada sempre; senão saldo > 0 + conta ativa + não bateu o piso de margem). */
export function podeUsar(contaId, { tolerancia = 0 } = {}) {
  const c = contaDe(contaId); if (!c) return false; if (c.admin === 1 || c.plano === 'ilimitado') return true;
  if (c.status === 'suspensa') return false;
  if (!(saldo(contaId) > -tolerancia)) return false;
  // Piso de margem: se o custo real da IA desde a última recarga passar do limite, trava e marca a conta.
  const lm = limiteMargem(contaId);
  if (lm.aplicavel && lm.bloqueado) {
    try { db.prepare("UPDATE contas SET bloqueada_margem_em=COALESCE(bloqueada_margem_em, CURRENT_TIMESTAMP) WHERE id=?").run(contaId); } catch {}
    return false;
  }
  return true;
}
export const COMANDOS_LIVRES = /^(cr[ée]ditos?|saldo|status|ajuda|web \d{6}|sim|n[ãa]o|ok|cancela|deixa|comprar|planos?)\b/i;
export function mensagemBloqueio(contaId) {
  // Mesma leitura para o usuário em qualquer motivo de bloqueio (saldo zerado ou piso de margem interno):
  // "seu consumo de créditos expirou" + como recarregar. O detalhe técnico de margem fica no painel admin.
  const link = process.env.WEBAPP_URL ? ` (${process.env.WEBAPP_URL}/app)` : '';
  return `🔒 Seu *consumo de créditos expirou*. Para continuar usando a equipe do ${PRODUTO}, faça uma nova recarga em *Créditos* no app${link} ou mande "comprar". Agenda e publicações já programadas continuam saindo.`;
}
export const fmt = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function verificarAlertas(contaId, s) {
  try {
    const c = contaDe(contaId); if (!c) return;
    const base = ultimaRecarga(contaId); const pct = s / base * 100;
    const nivel = s <= 0 ? 'zero' : pct <= 5 ? '5' : pct <= 20 ? '20' : null;
    const ordem = ['20', '5', 'zero']; // só avisa quando piora de nível; zera na recarga
    if (!nivel || ordem.indexOf(nivel) <= ordem.indexOf(c.creditos_alerta)) return;
    db.prepare('UPDATE contas SET creditos_alerta=? WHERE id=?').run(nivel, contaId);
    if (nivel === 'zero') db.prepare("UPDATE contas SET status='bloqueada' WHERE id=? AND status='ativa'").run(contaId);
    const dono = db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' AND canal='telegram' LIMIT 1").get(contaId)?.chat_id;
    const txt = nivel === 'zero' ? mensagemBloqueio(contaId) : `⚠️ Créditos do ${PRODUTO} em ${fmt(s)} (${nivel}% da última recarga). Recarregue em *Créditos* no app ou mande "comprar" para não parar.`;
    const canal = canalAtual(); if (dono && canal) canal.enviar(null, dono, txt).catch(() => {});
  } catch (e) { console.error('[creditos] alerta', e.message); }
}

/** Resumo para o comando "créditos" e para a API. */
export function resumo(contaId) {
  const c = contaDe(contaId); const ilim = ilimitada(contaId); const s = saldo(contaId);
  const porDia = db.prepare("SELECT date(criado_em) d, -SUM(CASE WHEN quantidade<0 THEN quantidade ELSE 0 END) gasto FROM creditos_mov WHERE conta_id=? AND criado_em >= datetime('now','-30 days') GROUP BY d ORDER BY d").all(contaId);
  const porModulo = db.prepare("SELECT COALESCE(modulo,'sistema') modulo, -SUM(quantidade) gasto, COUNT(*) n FROM creditos_mov WHERE conta_id=? AND quantidade<0 AND criado_em >= datetime('now','-30 days') GROUP BY modulo ORDER BY gasto DESC").all(contaId);
  const porTipo = db.prepare("SELECT CASE WHEN ref LIKE 'tokens:%' THEN 'IA (tokens)' ELSE motivo END item, -SUM(quantidade) gasto, COUNT(*) n FROM creditos_mov WHERE conta_id=? AND quantidade<0 AND criado_em >= datetime('now','-30 days') GROUP BY item ORDER BY gasto DESC").all(contaId);
  const gasto30 = porDia.reduce((a, b) => a + b.gasto, 0);
  const mediaDia = porDia.length ? gasto30 / Math.max(porDia.length, 1) : 0;
  const historico = db.prepare('SELECT id, tipo, quantidade, motivo, modulo, ref, criado_em FROM creditos_mov WHERE conta_id=? ORDER BY id DESC LIMIT 60').all(contaId);
  return { produto: PRODUTO, saldo: s, ilimitada: ilim, plano: c?.plano, status: c?.status, base: ultimaRecarga(contaId), gasto_30d: +gasto30.toFixed(1), media_dia: +mediaDia.toFixed(2), dias_restantes: ilim ? null : mediaDia > 0 ? Math.floor(Math.max(s, 0) / mediaDia) : null, por_dia: porDia, por_modulo: porModulo, por_tipo: porTipo, historico, tarifas: TARIFAS, tokens_por_credito: tokensPorCredito(), pacotes: PACOTES, trial: TRIAL_CREDITOS };
}
export function textoResumo(contaId) {
  const r = resumo(contaId);
  if (r.ilimitada) return `💳 *${PRODUTO} · Créditos*\nSua conta é ilimitada (admin). Consumo nos últimos 30 dias: ${fmt(r.gasto_30d)} créditos.`;
  const linhas = [`💳 *${PRODUTO} · Créditos*`, `Saldo: *${fmt(r.saldo)}* créditos${r.plano && r.plano !== 'trial' ? ` · plano ${r.plano}` : r.plano === 'trial' ? ' · período de teste' : ''}`, `Últimos 30 dias: ${fmt(r.gasto_30d)} gastos (média ${fmt(r.media_dia)}/dia${r.dias_restantes != null ? `, dá para ~${r.dias_restantes} dias` : ''})`];
  if (r.por_modulo.length) linhas.push('Por assessor: ' + r.por_modulo.map(m => `${m.modulo} ${fmt(m.gasto)}`).join(' · '));
  linhas.push(`1 crédito = ${tokensPorCredito()} tokens de IA; story/arte 1, carrossel 3, vídeo 5, imagem IA 4.`, 'Para recarregar: "comprar" ou a tela Créditos no app.');
  return linhas.join('\n');
}
