import * as gcal from '../integracoes/google-calendar.js';
import * as gmail from '../integracoes/gmail.js';
import * as gtasks from '../integracoes/google-tasks.js';
import * as equipe from '../orquestrador/equipe.js';
import * as sheets from '../integracoes/google-sheets.js';
const mapaEv = (e) => ({ id: e.id, categoria: e.categoria, titulo: e.summary, inicio: e.start?.dateTime || e.start?.date, fim: e.end?.dateTime || e.end?.date, local: e.location, meet: e.hangoutLink, descricao: (e.description || '').slice(0, 200) });
import { db } from '../db/index.js';

// Declarações no formato function-calling do Gemini
export function ferramentas(_conta) {
  return [
    { name: 'criar_evento', description: 'Cria compromisso no Google Agenda do dono. categoria = marcador/calendário (ex.: Financeiro PF, Financeiro PJ, Profissional, Família, Saúde); se o dono não disser, deduza pelo contexto ou deixe vazio (Principal).', parameters: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, categoria: { type: 'STRING' }, inicio: { type: 'STRING', description: 'YYYY-MM-DDTHH:MM' }, fim: { type: 'STRING' }, local: { type: 'STRING' }, convidados: { type: 'ARRAY', items: { type: 'STRING' } }, meet: { type: 'BOOLEAN' }, lembrete_min: { type: 'NUMBER' } }, required: ['titulo', 'inicio'] } },
    { name: 'listar_agenda', description: 'Lista compromissos de um período (padrão: próximos 90 dias). Datas ISO YYYY-MM-DD.', parameters: { type: 'OBJECT', properties: { inicio: { type: 'STRING' }, fim: { type: 'STRING' }, categoria: { type: 'STRING', description: 'filtrar por marcador' } } } },
    { name: 'listar_categorias', description: 'Lista os marcadores (calendários) da agenda do dono', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'criar_categoria', description: 'Cria um marcador (calendário) novo na agenda', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' } }, required: ['nome'] } },
    { name: 'buscar_evento', description: 'Busca compromissos pelo texto (nome de pessoa, lugar, tipo: "Dedi", "dentista", "consulta") nos próximos 365 dias. Use para "quando é minha próxima X com Y".', parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING' }, dias: { type: 'NUMBER' }, categoria: { type: 'STRING' } }, required: ['texto'] } },
    { name: 'mover_evento', description: 'Altera data/hora/título/local de um evento (qualquer marcador). Passe titulo atual para referência.', parameters: { type: 'OBJECT', properties: { event_id: { type: 'STRING' }, inicio: { type: 'STRING' }, fim: { type: 'STRING' }, titulo: { type: 'STRING' }, local: { type: 'STRING' } }, required: ['event_id'] } },
    { name: 'cancelar_evento', description: 'Cancela um evento (requer confirmação). Passe também titulo para o dono saber qual é. Para cancelar vários, chame uma vez por evento na MESMA rodada.', parameters: { type: 'OBJECT', properties: { event_id: { type: 'STRING' }, titulo: { type: 'STRING' } }, required: ['event_id'] } },
    { name: 'criar_lembrete', description: 'Cria lembrete pontual ou recorrente', parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING' }, quando: { type: 'STRING', description: 'YYYY-MM-DDTHH:MM' }, recorrencia: { type: 'STRING', description: 'diario|semanal|mensal|null' } }, required: ['texto', 'quando'] } },
    { name: 'ler_emails', description: 'Lista e-mails recentes do Gmail do dono (somente leitura). q = filtro Gmail (ex.: "newer_than:1d is:unread", "from:joao", "assunto"). Padrão: últimas 24h sem promoções/social.', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' }, max: { type: 'NUMBER' } } } },
    { name: 'ler_email', description: 'Lê o conteúdo completo de um e-mail pelo id (vindo de ler_emails)', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] } },
    { name: 'enviar_email', description: 'Envia e-mail pelo Gmail do dono. Exige confirmação (o sistema pergunta — NÃO escreva uma "proposta" em texto antes; chame a ferramenta direto). Para responder um e-mail existente, passe respondendo_id. DOCUMENTOS: nunca mande só link — passe os ids do Drive em anexos_drive_ids (vindos de buscar_documento/listar_documentos: campo link ou drive_id) e o sistema ANEXA o arquivo e libera leitura do Drive para o destinatário automaticamente. Links do Drive no texto também viram anexo.', parameters: { type: 'OBJECT', properties: { para: { type: 'STRING' }, assunto: { type: 'STRING' }, texto: { type: 'STRING' }, cc: { type: 'STRING' }, respondendo_id: { type: 'STRING' }, anexos_drive_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'ids ou links do Drive dos arquivos a anexar' } }, required: ['texto'] } },
    { name: 'criar_rascunho_email', description: 'Salva um rascunho no Gmail do dono (não envia), com anexos do Drive se informados em anexos_drive_ids.', parameters: { type: 'OBJECT', properties: { para: { type: 'STRING' }, assunto: { type: 'STRING' }, texto: { type: 'STRING' }, cc: { type: 'STRING' }, respondendo_id: { type: 'STRING' }, anexos_drive_ids: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['texto'] } },
    { name: 'criar_tarefa', description: 'Cria tarefa no Google Tasks do dono (aparece no app Tarefas e na lateral do Gmail/Agenda). Use para "anota uma tarefa", "coloca na minha lista", "preciso fazer X até sexta". prazo = YYYY-MM-DD (Tasks só guarda a data). lista = nome da lista (opcional; cria se não existir).', parameters: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, notas: { type: 'STRING' }, prazo: { type: 'STRING' }, lista: { type: 'STRING' } }, required: ['titulo'] } },
    { name: 'listar_tarefas', description: 'Lista tarefas abertas do Google Tasks (todas as listas ou uma).', parameters: { type: 'OBJECT', properties: { lista: { type: 'STRING' }, concluidas: { type: 'BOOLEAN' } } } },
    { name: 'concluir_tarefa', description: 'Marca tarefa do Google Tasks como concluída (por id ou título exato).', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] } },
    { name: 'atualizar_tarefa', description: 'Altera título, notas ou prazo de uma tarefa do Google Tasks.', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' }, titulo: { type: 'STRING' }, notas: { type: 'STRING' }, prazo: { type: 'STRING' } }, required: ['id'] } },
    { name: 'enviar_recado', description: 'Manda um recado pelo Telegram para alguém da equipe do dono (pessoa já cadastrada via convite). Requer confirmação. Escreva o recado em nome do dono, claro e curto.', parameters: { type: 'OBJECT', properties: { pessoa: { type: 'STRING' }, texto: { type: 'STRING' } }, required: ['pessoa', 'texto'] } },
    { name: 'delegar_tarefa', description: 'Repassa uma tarefa para alguém da equipe pelo Telegram, com prazo (YYYY-MM-DD) e detalhes. A pessoa recebe, pode responder e marca "feito"; o dono é avisado. Requer confirmação.', parameters: { type: 'OBJECT', properties: { pessoa: { type: 'STRING' }, titulo: { type: 'STRING' }, prazo: { type: 'STRING' }, detalhes: { type: 'STRING' } }, required: ['pessoa', 'titulo'] } },
    { name: 'listar_pessoas', description: 'Lista as pessoas da equipe que estão no Telegram (para recados e tarefas).', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'listar_delegadas', description: 'Lista tarefas delegadas à equipe (abertas por padrão), opcionalmente de uma pessoa.', parameters: { type: 'OBJECT', properties: { pessoa: { type: 'STRING' }, status: { type: 'STRING', description: 'aberta|concluida|todas' } } } },
    { name: 'listar_planilhas', description: 'Lista as planilhas Google (Sheets) cadastradas do dono, com abas e colunas.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'cadastrar_planilha', description: 'Cadastra uma planilha Google existente pelo link, dando um nome curto para o dono se referir a ela depois ("planilha de gastos").', parameters: { type: 'OBJECT', properties: { link: { type: 'STRING' }, nome: { type: 'STRING' }, aba: { type: 'STRING' } }, required: ['link'] } },
    { name: 'criar_planilha', description: 'Cria uma planilha Google nova no Drive do dono (pasta Fiel/Planilhas) com abas e cabeçalhos. Use quando ele pedir "cria uma planilha de X".', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, abas: { type: 'ARRAY', items: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, cabecalhos: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['nome'] } } }, required: ['nome'] } },
    { name: 'lancar_na_planilha', description: 'Acrescenta uma ou mais linhas ao final de uma planilha cadastrada. Informe colunas (nomes exatamente como no cabeçalho — veja listar_planilhas) e linhas (valores na mesma ordem das colunas). O sistema encaixa cada valor na coluna certa. Datas em DD/MM/AAAA, valores numéricos sem R$.', parameters: { type: 'OBJECT', properties: { planilha: { type: 'STRING' }, aba: { type: 'STRING' }, colunas: { type: 'ARRAY', items: { type: 'STRING' } }, linhas: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } } }, required: ['planilha', 'colunas', 'linhas'] } },
    { name: 'ler_planilha', description: 'Lê uma planilha cadastrada (últimas linhas ou um intervalo A1 como "A1:F20") para consultar, somar ou conferir.', parameters: { type: 'OBJECT', properties: { planilha: { type: 'STRING' }, aba: { type: 'STRING' }, intervalo: { type: 'STRING' }, max: { type: 'NUMBER' } }, required: ['planilha'] } },
    { name: 'criar_aba', description: 'Cria uma aba nova numa planilha cadastrada, com cabeçalhos (ex.: aba "Indústria" com Empresa, Segmento, WhatsApp...). Se a aba já existir, apenas informa.', parameters: { type: 'OBJECT', properties: { planilha: { type: 'STRING' }, aba: { type: 'STRING' }, cabecalhos: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['planilha', 'aba'] } },
    { name: 'renomear_aba', description: 'Renomeia uma aba de uma planilha cadastrada.', parameters: { type: 'OBJECT', properties: { planilha: { type: 'STRING' }, aba: { type: 'STRING' }, novo_nome: { type: 'STRING' } }, required: ['planilha', 'aba', 'novo_nome'] } },
    { name: 'iniciar_tarefa_longa', description: 'Use quando o pedido é grande demais para uma resposta só (ex.: levantar 100 contatos por aba, preencher e-mails de 250 empresas, pesquisar muitos itens). Cria uma tarefa em SEGUNDO PLANO que roda sozinha em lotes (até ~20 itens por lote) e só avisa o dono ao terminar — o dono NÃO precisa mandar "continua". Antes, garanta que a planilha/abas de destino existem (criar_planilha/criar_aba). Exige confirmação do dono (mostre quantos lotes).', parameters: { type: 'OBJECT', properties: { objetivo: { type: 'STRING', description: 'meta completa e verificável, com planilha, abas e quantidades (ex.: "Planilha Contatos Jaraguá: completar 100 empresas em cada aba Clínicas e Saúde e Eventos, colunas Empresa, Segmento, WhatsApp Link, WhatsApp, Fixo")' }, instrucao_lote: { type: 'STRING', description: 'o que fazer em cada lote (ex.: "pesquisar na web 20 empresas novas da próxima aba incompleta, validar WhatsApp/telefone e lançar com lancar_na_planilha; não repetir empresas já na planilha")' }, total_lotes: { type: 'NUMBER', description: 'quantos lotes no máximo (itens ÷ 20, arredonde para cima). Máx 40.' } }, required: ['objetivo', 'instrucao_lote', 'total_lotes'] } },
    { name: 'ver_tarefas_longas', description: 'Mostra o andamento das tarefas em segundo plano (lotes feitos, status).', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'cancelar_tarefa_longa', description: 'Cancela uma tarefa em segundo plano pelo número.', parameters: { type: 'OBJECT', properties: { id: { type: 'NUMBER' } }, required: ['id'] } },
    { name: 'retomar_tarefa_longa', description: 'Retoma uma tarefa em segundo plano que foi pausada (por erro ou falta de créditos).', parameters: { type: 'OBJECT', properties: { id: { type: 'NUMBER' } }, required: ['id'] } },
    { name: 'atualizar_planilha', description: 'Altera células específicas (intervalo A1, ex.: "D7" ou "B2:C2") de uma planilha cadastrada. Requer confirmação.', parameters: { type: 'OBJECT', properties: { planilha: { type: 'STRING' }, aba: { type: 'STRING' }, intervalo: { type: 'STRING' }, valores: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } } }, required: ['planilha', 'intervalo', 'valores'] } },
    { name: 'registrar_retorno', description: 'Registra quem deve resposta a quem. Use quando o dono mencionar "preciso de retorno de X sobre Y", "aguardando a Y confirmar Z", "mandei pedir X para o João".', parameters: { type: 'OBJECT', properties: { pessoa: { type: 'STRING' }, assunto: { type: 'STRING' }, direcao: { type: 'STRING', description: 'devo_responder|aguardo_resposta' } }, required: ['pessoa', 'assunto', 'direcao'] } },
    { name: 'listar_retornos', description: 'Lista os retornos em aberto (quem está devendo resposta, de qual lado). Use para mostrar as pendências, ou antes de fechar_retorno para achar o id certo pelo nome e assunto.', parameters: { type: 'OBJECT', properties: { pessoa: { type: 'STRING', description: 'filtra por nome (parcial, case-insensitive)' } } } },
    { name: 'fechar_retorno', description: 'Marca um retorno como respondido/confirmado. Use quando o dono disser "Casan confirmou", "ok, deu certo", "a Mariza enviou", "pode marcar como OK". Se tiver só o nome, chame listar_retornos primeiro para achar o id — ou passe `pessoa` e opcional `assunto` que o sistema acha o(s) mais recente(s).', parameters: { type: 'OBJECT', properties: { id: { type: 'NUMBER' }, pessoa: { type: 'STRING' }, assunto: { type: 'STRING' } } } },
  ];
}
export const requerConfirmacao = new Set(['cancelar_evento', 'enviar_recado', 'delegar_tarefa', 'enviar_email', 'atualizar_planilha', 'iniciar_tarefa_longa']);

export async function executar(nome, a, conta, ctx) {
  switch (nome) {
    case 'criar_evento': return gcal.criarEvento(conta.id, { titulo: a.titulo, inicio: a.inicio, fim: a.fim, local: a.local, convidados: a.convidados || [], meet: !!a.meet, lembreteMin: a.lembrete_min ?? 30, categoria: a.categoria });
    case 'listar_agenda': return (await gcal.listarEventos(conta.id, { inicio: a.inicio ? new Date(a.inicio).toISOString() : undefined, fim: a.fim ? new Date(a.fim + 'T23:59:59').toISOString() : new Date(Date.now() + 90 * 864e5).toISOString(), max: 100, categoria: a.categoria })).map(mapaEv);
    case 'listar_categorias': return gcal.listarCalendarios(conta.id);
    case 'criar_categoria': return gcal.obterOuCriarCalendario(conta.id, a.nome);
    case 'buscar_evento': return (await gcal.buscarEventos(conta.id, a.texto, a.dias || 365, a.categoria)).map(mapaEv);
    case 'mover_evento': return { id: await gcal.atualizarEvento(conta.id, a.event_id, a) };
    case 'cancelar_evento': await gcal.cancelarEvento(conta.id, a.event_id); return { ok: true };
    case 'criar_lembrete': { const r = db.prepare('INSERT INTO lembretes (conta_id, modulo, texto, quando, recorrencia, destino_chat_id) VALUES (?,?,?,?,?,?)').run(conta.id, 'secretaria', a.texto, a.quando, a.recorrencia || null, ctx.chatId); return { id: r.lastInsertRowid }; }
    case 'ler_emails': return gmail.listar(conta.id, { q: a.q, max: a.max || 15 });
    case 'ler_email': return gmail.ler(conta.id, a.id);
    case 'enviar_email': return gmail.enviar(conta.id, { ...a, anexos_drive_ids: (a.anexos_drive_ids || []).map(x => /drive|docs/.test(x) ? x : x) });
    case 'criar_rascunho_email': return gmail.criarRascunho(conta.id, a);
    case 'criar_tarefa': return gtasks.criarTarefa(conta.id, a);
    case 'listar_tarefas': return gtasks.listarTarefas(conta.id, { lista: a.lista, concluidas: !!a.concluidas });
    case 'concluir_tarefa': return gtasks.concluirTarefa(conta.id, a.id);
    case 'atualizar_tarefa': return gtasks.atualizarTarefa(conta.id, a.id, a);
    case 'enviar_recado': return equipe.enviarRecado(conta, a);
    case 'delegar_tarefa': return equipe.delegarTarefa(conta, a);
    case 'listar_pessoas': return equipe.listarPessoas(conta.id).map(p => p.nome);
    case 'listar_delegadas': return equipe.listarDelegadas(conta.id, { pessoa: a.pessoa, status: a.status === 'todas' ? null : (a.status || 'aberta') });
    case 'listar_planilhas': return sheets.listarCadastradas(conta.id);
    case 'cadastrar_planilha': return sheets.cadastrar(conta.id, { link_ou_id: a.link, nome: a.nome, aba: a.aba });
    case 'criar_planilha': return sheets.criar(conta.id, { nome: a.nome, abas: a.abas?.length ? a.abas : undefined });
    case 'lancar_na_planilha': return sheets.adicionarLinhas(conta.id, { planilha: a.planilha, aba: a.aba, linhas: (a.linhas || []).map(l => a.colunas?.length ? Object.fromEntries(a.colunas.map((c, i) => [c, l[i] ?? ''])) : l) });
    case 'ler_planilha': return sheets.ler(conta.id, { planilha: a.planilha, aba: a.aba, intervalo: a.intervalo, max: a.max || 50 });
    case 'criar_aba': return sheets.criarAba(conta.id, { planilha: a.planilha, aba: a.aba, cabecalhos: a.cabecalhos || [] });
    case 'renomear_aba': return sheets.renomearAba(conta.id, { planilha: a.planilha, aba: a.aba, novo_nome: a.novo_nome });
    case 'iniciar_tarefa_longa': return (await import('../orquestrador/tarefas-longas.js')).criarTarefa(conta, ctx?.chatId, 'secretaria', a);
    case 'ver_tarefas_longas': return (await import('../orquestrador/tarefas-longas.js')).listarTarefas(conta.id);
    case 'cancelar_tarefa_longa': return (await import('../orquestrador/tarefas-longas.js')).cancelarTarefa(conta.id, a.id);
    case 'retomar_tarefa_longa': return (await import('../orquestrador/tarefas-longas.js')).retomarTarefa(conta.id, a.id);
    case 'atualizar_planilha': return sheets.atualizarCelulas(conta.id, { planilha: a.planilha, aba: a.aba, intervalo: a.intervalo, valores: a.valores });
    case 'registrar_retorno': { const r = db.prepare('INSERT INTO retornos (conta_id, pessoa, assunto, direcao) VALUES (?,?,?,?)').run(conta.id, a.pessoa, a.assunto, a.direcao); return { id: r.lastInsertRowid }; }
    case 'listar_retornos': {
      const abertos = a.pessoa
        ? db.prepare("SELECT id, pessoa, assunto, direcao, criado_em FROM retornos WHERE conta_id=? AND status='aberto' AND LOWER(pessoa) LIKE ? ORDER BY id DESC").all(conta.id, `%${String(a.pessoa).toLowerCase()}%`)
        : db.prepare("SELECT id, pessoa, assunto, direcao, criado_em FROM retornos WHERE conta_id=? AND status='aberto' ORDER BY id DESC").all(conta.id);
      return abertos;
    }
    case 'fechar_retorno': {
      let ids = [];
      if (a.id) ids = [a.id];
      else if (a.pessoa) {
        const q = a.assunto
          ? db.prepare("SELECT id FROM retornos WHERE conta_id=? AND status='aberto' AND LOWER(pessoa) LIKE ? AND LOWER(assunto) LIKE ? ORDER BY id DESC").all(conta.id, `%${String(a.pessoa).toLowerCase()}%`, `%${String(a.assunto).toLowerCase()}%`)
          : db.prepare("SELECT id FROM retornos WHERE conta_id=? AND status='aberto' AND LOWER(pessoa) LIKE ? ORDER BY id DESC").all(conta.id, `%${String(a.pessoa).toLowerCase()}%`);
        ids = q.map(x => x.id);
      }
      if (!ids.length) throw new Error(`Nenhum retorno aberto encontrado${a.pessoa ? ` para "${a.pessoa}"` : ''}${a.assunto ? ` sobre "${a.assunto}"` : ''}. Use listar_retornos para ver os abertos.`);
      const r = db.prepare(`UPDATE retornos SET status='fechado' WHERE id IN (${ids.map(() => '?').join(',')}) AND status='aberto'`).run(...ids);
      return { fechados: r.changes, ids };
    }
    default: throw new Error(`secretaria.${nome}: não implementada`);
  }
}
