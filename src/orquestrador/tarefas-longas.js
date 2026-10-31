// Tarefas longas em segundo plano: o dono pede algo grande ("100 contatos em cada aba"), aprova uma vez,
// e o sistema roda lote por lote sozinho, gravando o progresso, e só avisa quando termina (ou se travar).
import { db } from '../db/index.js';

db.exec(`CREATE TABLE IF NOT EXISTS tarefas_longas (
  id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, chat_id TEXT, modulo TEXT NOT NULL, objetivo TEXT NOT NULL, instrucao_lote TEXT NOT NULL,
  total_lotes INTEGER NOT NULL, lote_atual INTEGER DEFAULT 0, status TEXT DEFAULT 'ativa', falhas INTEGER DEFAULT 0, progresso TEXT DEFAULT '',
  ultimo_resultado TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP, proxima_em TEXT DEFAULT CURRENT_TIMESTAMP, concluido_em TEXT);
  CREATE INDEX IF NOT EXISTS ix_tarefas_longas ON tarefas_longas (status, proxima_em)`);
// Se o container reiniciou no meio de um lote, devolve a tarefa para a fila.
db.prepare("UPDATE tarefas_longas SET status='ativa' WHERE status='rodando'").run();

export const MAX_LOTES = 40;
const INTERVALO_S = 15;           // pausa entre lotes (respiro para APIs e para o modelo)
const MAX_FALHAS_SEGUIDAS = 3;

export function criarTarefa(conta, chatId, modulo, { objetivo, instrucao_lote, total_lotes }) {
  const total = Math.max(1, Math.min(MAX_LOTES, Math.round(Number(total_lotes) || 1)));
  if (!objetivo || !instrucao_lote) throw new Error('informe objetivo e instrução por lote');
  const abertas = db.prepare("SELECT COUNT(*) n FROM tarefas_longas WHERE conta_id=? AND status IN ('ativa','rodando')").get(conta.id).n;
  if (abertas >= 3) throw new Error('já existem 3 tarefas em andamento nesta conta; espere terminar ou cancele uma');
  const id = Number(db.prepare('INSERT INTO tarefas_longas (conta_id, chat_id, modulo, objetivo, instrucao_lote, total_lotes) VALUES (?,?,?,?,?,?)').run(conta.id, chatId || null, modulo, String(objetivo).slice(0, 1500), String(instrucao_lote).slice(0, 1500), total).lastInsertRowid);
  setTimeout(() => tick().catch(() => {}), 2000);
  return { id, total_lotes: total, status: 'ativa', aviso: `Tarefa #${id} criada: ${total} lote(s) em segundo plano. Aviso quando terminar.` };
}
export function listarTarefas(contaId) {
  return db.prepare("SELECT id, objetivo, total_lotes, lote_atual, status, falhas, ultimo_resultado, criado_em, concluido_em FROM tarefas_longas WHERE conta_id=? ORDER BY id DESC LIMIT 10").all(contaId)
    .map(t => ({ ...t, andamento: `${t.lote_atual}/${t.total_lotes} lotes` }));
}
export function cancelarTarefa(contaId, id) {
  const r = db.prepare("UPDATE tarefas_longas SET status='cancelada', atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND conta_id=? AND status IN ('ativa','rodando','pausada')").run(Number(id), contaId);
  if (!r.changes) throw new Error(`tarefa #${id} não está em andamento`);
  return { ok: true, id: Number(id), status: 'cancelada' };
}
export function retomarTarefa(contaId, id) {
  const r = db.prepare("UPDATE tarefas_longas SET status='ativa', falhas=0, proxima_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND conta_id=? AND status='pausada'").run(Number(id), contaId);
  if (!r.changes) throw new Error(`tarefa #${id} não está pausada`);
  setTimeout(() => tick().catch(() => {}), 1000);
  return { ok: true, id: Number(id), status: 'ativa' };
}

async function avisar(t, texto) {
  try {
    const { canalAtual } = await import('../canal/atual.js'); const c = canalAtual(); if (!c) return;
    const destino = t.chat_id || db.prepare("SELECT chat_id FROM usuarios WHERE conta_id=? AND papel='dono' ORDER BY canal<>'telegram', id LIMIT 1").get(t.conta_id)?.chat_id;
    if (destino) await c.enviar(null, destino, texto);
  } catch (e) { console.error('[tarefas] aviso falhou', e.message); }
}

let rodando = false;
/** Pega UMA tarefa pronta e roda o próximo lote. Chamado a cada 20s pelo agendador e logo após criar/retomar. */
export async function tick({ responderFn } = {}) {
  if (rodando) return; rodando = true;
  try {
    const t = db.prepare("SELECT * FROM tarefas_longas WHERE status='ativa' AND proxima_em <= CURRENT_TIMESTAMP ORDER BY atualizado_em LIMIT 1").get();
    if (!t) return;
    if (!db.prepare("UPDATE tarefas_longas SET status='rodando', atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status='ativa'").run(t.id).changes) return;
    await rodarLote(t, responderFn);
  } finally { rodando = false; }
}

async function rodarLote(t, responderFn) {
  const { obterConta, modulosAtivos } = await import('../db/contas.js');
  const cred = await import('../creditos/index.js');
  const conta = db.prepare('SELECT * FROM contas WHERE id=?').get(t.conta_id);
  const pausar = async (motivo, aviso) => { db.prepare("UPDATE tarefas_longas SET status='pausada', ultimo_resultado=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(motivo, t.id); if (aviso) await avisar(t, aviso); };
  if (!conta) return pausar('conta não encontrada');
  if (!cred.podeUsar(conta.id)) return pausar('sem créditos', `⏸️ Pausei a tarefa #${t.id} (${t.lote_atual}/${t.total_lotes} lotes feitos): ${cred.mensagemBloqueio(conta.id).replace(/^🔒\s*/, '')}\nDepois de recarregar, mande *retomar tarefa ${t.id}*.`);

  const n = t.lote_atual + 1;
  const ativos = modulosAtivos(conta.id); const { montarPrompt } = await import('./montador-prompt.js'); const responder = responderFn || (await import('./ia.js')).responder;
  const { rodarComContexto } = await import('../integracoes/gemini.js');
  const texto = `[TAREFA EM SEGUNDO PLANO #${t.id} — lote ${n} de ${t.total_lotes}]
Objetivo geral (já aprovado pelo dono): ${t.objetivo}
O que fazer em CADA lote: ${t.instrucao_lote}
Progresso até agora:
${t.progresso || '(nenhum lote feito ainda — este é o primeiro)'}

Regras deste lote: o dono NÃO está acompanhando — não pergunte nada, não peça confirmação, não ofereça opções. Antes de gravar, leia a planilha/estado atual se precisar para continuar de onde parou e não repetir itens. Faça SOMENTE este lote com as suas ferramentas. Só grave dados reais que você encontrou (sem inventar telefone, e-mail ou endereço; se não achar, deixe em branco).
Responda em UMA linha, começando exatamente com:
- "LOTE OK: <o que foi feito, com números>" se fez o lote; ou
- "TAREFA CONCLUIDA: <resumo final>" se o objetivo geral já está cumprido; ou
- "ERRO: <motivo>" se não conseguiu.`;
  let resp; let erroExec = null;
  try {
    resp = await rodarComContexto({ contaId: conta.id, modulo: t.modulo }, () =>
      responder({ prompt: montarPrompt({ modulo: t.modulo, conta, ativos, texto }), conta, modulo: t.modulo, msg: { texto, chatId: t.chat_id, conta: 'telegram', tipo: 'texto' }, ativos, autoConfirmar: true, rodadas: 10 }));
  } catch (e) { erroExec = e.message; }
  const linha = String(typeof resp === 'string' ? resp : resp?.texto || erroExec || 'sem resposta').trim().split('\n').find(Boolean)?.slice(0, 500) || 'sem resposta';
  const fim = (status) => db.prepare(`UPDATE tarefas_longas SET status=?, lote_atual=?, progresso=?, ultimo_resultado=?, falhas=0, atualizado_em=CURRENT_TIMESTAMP, concluido_em=CURRENT_TIMESTAMP WHERE id=?`).run(status, n, novoProgresso, linha, t.id);
  const novoProgresso = (t.progresso + `\n- Lote ${n}: ${linha.replace(/^(LOTE OK|TAREFA CONCLUIDA):\s*/i, '')}`).trim().slice(-2500);
  console.log(`[tarefas] #${t.id} lote ${n}/${t.total_lotes}: ${linha.slice(0, 160)}`);

  if (/^TAREFA CONCLU[IÍ]DA/i.test(linha) || (/^LOTE OK/i.test(linha) && n >= t.total_lotes)) {
    fim('concluida');
    return avisar(t, `✅ *Tarefa #${t.id} concluída* (${n} lote${n > 1 ? 's' : ''}).\n${t.objetivo.slice(0, 160)}\n\n${linha.replace(/^(LOTE OK|TAREFA CONCLUIDA):\s*/i, '')}`);
  }
  if (/^LOTE OK/i.test(linha)) {
    db.prepare(`UPDATE tarefas_longas SET status='ativa', lote_atual=?, progresso=?, ultimo_resultado=?, falhas=0, atualizado_em=CURRENT_TIMESTAMP, proxima_em=datetime('now', '+${INTERVALO_S} seconds') WHERE id=?`).run(n, novoProgresso, linha, t.id);
    return;
  }
  // Erro (ou resposta fora do formato): tenta de novo o MESMO lote; depois de 3 seguidas, pausa e avisa.
  const falhas = t.falhas + 1;
  if (falhas >= MAX_FALHAS_SEGUIDAS || /créditos|sem créditos/i.test(linha)) {
    db.prepare("UPDATE tarefas_longas SET falhas=? WHERE id=?").run(falhas, t.id);
    return pausar(linha, `⏸️ Pausei a tarefa #${t.id} no lote ${n} de ${t.total_lotes} depois de ${falhas} tentativa(s): ${linha.replace(/^ERRO:\s*/i, '')}\nMande *retomar tarefa ${t.id}* para tentar de novo ou *cancelar tarefa ${t.id}*.`);
  }
  db.prepare(`UPDATE tarefas_longas SET status='ativa', falhas=?, ultimo_resultado=?, atualizado_em=CURRENT_TIMESTAMP, proxima_em=datetime('now', '+60 seconds') WHERE id=?`).run(falhas, linha, t.id);
}
