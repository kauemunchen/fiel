import { montarPrompt } from './montador-prompt.js';
import { transcrever, classificar, responder } from './ia.js';
import { obterConta, obterUsuario, modulosAtivos, configPersona } from '../db/contas.js';
import { tentarEntrar, fluxoColaborador } from './equipe.js';
import * as edicao from './edicao.js';
import { contextoUso } from '../integracoes/gemini.js';
import { executarFerramenta } from '../ferramentas/index.js';
import * as memoria from './memoria.js';
import { db } from '../db/index.js';
import { onboarding } from './onboarding.js';
import { governanca } from './governanca.js';

export async function tratarMensagem(msg, canal) {
  { const { vincularTelegram, PADRAO_VINCULO } = await import('./guia.js');
    if (PADRAO_VINCULO.test(String(msg.texto || '').trim())) return vincularTelegram(msg); }
  const conta = await obterConta(msg.chatId);
  if (!conta) return (await tentarEntrar(msg)) || onboarding(msg);
  contextoUso.contaId = conta.id; contextoUso.modulo = null;
  { const t = (msg.texto || '').trim().toLowerCase();
    const mt = t.match(/^(retomar|cancelar|status|andamento)( da)? tarefas?(?: #?(\d+))?$/);
    if (mt) { const tl = await import('./tarefas-longas.js'); try {
      if (mt[1] === 'retomar' && mt[3]) { tl.retomarTarefa(conta.id, mt[3]); return `▶️ Retomei a tarefa #${mt[3]}. Aviso quando terminar.`; }
      if (mt[1] === 'cancelar' && mt[3]) { tl.cancelarTarefa(conta.id, mt[3]); return `⏹️ Tarefa #${mt[3]} cancelada. O que já foi gravado continua na planilha.`; }
      const ls = tl.listarTarefas(conta.id); return ls.length ? '*Tarefas em segundo plano*\n' + ls.slice(0, 5).map(x => `- #${x.id} ${x.status} · ${x.andamento} · ${x.objetivo.slice(0, 70)}`).join('\n') : 'Nenhuma tarefa em segundo plano.';
    } catch (e) { return `Não consegui: ${e.message}`; } }
    if (/^(parar|cancelar|sair das?) ofertas?$/.test(t)) { db.prepare('UPDATE contas SET marketing_optin=0, marketing_optin_em=CURRENT_TIMESTAMP WHERE id=?').run(conta.id); return 'Pronto — você não vai mais receber ofertas e lançamentos. Comunicados importantes do serviço continuam chegando. Para voltar, mande *receber ofertas*.'; }
    if (/^(receber|quero) ofertas?$/.test(t)) { db.prepare('UPDATE contas SET marketing_optin=1, marketing_optin_em=CURRENT_TIMESTAMP WHERE id=?').run(conta.id); return '✅ Combinado — você vai receber novidades, ofertas e lançamentos do Fiel. Para parar, mande *parar ofertas*.'; } }
  const usuario = obterUsuario(msg.chatId);
  if (usuario && usuario.papel !== 'dono') return fluxoColaborador(msg, conta, usuario);
  // Imagens sem pedido: resposta aos botões "usar em post / são logos / só guardar" (sem IA)
  { const imgs = await import('./imagens-social.js'); const b = imgs.tratarBotao(conta, msg);
    if (b?.resposta) return { texto: b.resposta, modulo: 'social' }; if (b?.msg) Object.assign(msg, b.msg);
    else if (msg.tipo === 'texto' && msg.texto && !msg.texto.startsWith('[')) { const ctx = imgs.contextoPendente(conta.id); if (ctx) msg.texto += ctx; } }
  // Créditos: sem saldo, só comandos livres (status, créditos, sim/não, login web…)
  const cred = await import('../creditos/index.js');
  if (!cred.podeUsar(conta.id) && !(msg.tipo === 'texto' && cred.COMANDOS_LIVRES.test((msg.texto || '').trim()))) return cred.mensagemBloqueio(conta.id);

  if (msg.tipo === 'audio') {
    await canal.enviar(msg.conta, msg.chatId, '🎧 Ouvindo…');
    const bytes = await canal.baixarMidia(msg.midia.ref);
    console.log(`[audio] ${msg.chatId} ${msg.midia.mime} ${bytes.byteLength} bytes`);
    msg.texto = await transcrever(bytes, msg.midia.mime);
    console.log(`[audio] transcrição: ${msg.texto.slice(0, 120)}`);
    if (!msg.texto) return 'Não consegui entender o áudio. Pode repetir ou escrever?';
    await canal.enviar(msg.conta, msg.chatId, `📝 "${msg.texto}"`);
  }
  const ativosAgora = modulosAtivos(conta.id);
  // ----- Modo edição da MIA (só quando o dono pediu). Enquanto ativo, tudo passa por ele. -----
  if (ativosAgora.includes('social')) {
    if (edicao.emEdicao(msg.chatId)) { const r = await edicao.tratar(msg, conta, canal); if (r) return r; }
    else if (edicao.GATILHO.test(msg.texto || '')) {
      let fotoBytes = null, videoBytes = null;
      if (msg.tipo === 'imagem' && msg.midia) { try { fotoBytes = Buffer.from(await canal.baixarMidia(msg.midia.ref)); } catch {} }
      if (msg.tipo === 'video' && msg.midia && !(msg.midia.tamanho > 20 * 1024 * 1024 && !process.env.TELEGRAM_API_BASE)) { try { videoBytes = Buffer.from(await canal.baixarMidia(msg.midia.ref)); } catch {} }
      return edicao.iniciar(msg.chatId, { fotoBytes, videoBytes, texto: msg.texto, contaId: conta.id });
    }
  }
  const DOC_RX = /\b(guarda|arquiva|arquivo|documento|contrato|nota|boleto|certid[ãa]o|alvar[áa]|ap[óo]lice|comprovante|recibo|cadastro|rg|cnh|cpf|cnpj|procura[çc][ãa]o|holerite|extrato)\b/i;
  const SOCIAL_RX = /\b(post|legenda|instagram|story|stories|reels?|carrossel|marca d.?[áa]gua|publica)\b/i;
  const FIN_RX = /\b(extrato|fatura|boleto|comprovante|pix|tina|financeiro|lan[çc]a(r)?|pagar|pago|paguei|recebi|cart[ãa]o de cr[ée]dito)\b/i;
  if (msg.tipo === 'video') {
    if (!ativosAgora.includes('social')) msg.texto = (msg.texto ? msg.texto + '\n' : '') + '[vídeo recebido; para publicar no Instagram, ligue a MIA: "ativa social"]';
    else if (msg.midia?.tamanho > 20 * 1024 * 1024 && !process.env.TELEGRAM_API_BASE) return `🎬 Esse vídeo tem ${(msg.midia.tamanho / 1048576).toFixed(0)} MB e o Telegram só me entrega até 20 MB. Suba no Google Drive e me mande o link aqui dizendo "MIA, esse é o reels de quinta" — eu baixo, hospedo e agendo igual.`;
    else {
      await canal.enviar(msg.conta, msg.chatId, '🎬 Recebi o vídeo, hospedando… (30 a 60 s)');
      try {
        const bytes = await canal.baixarMidia(msg.midia.ref);
        const { guardarVideoEnviado } = await import('../ferramentas/social.js');
        const v = await guardarVideoEnviado(conta.id, bytes);
        msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[Vídeo enviado pelo dono, já hospedado: ${v.url} (${Math.round(v.duracao || 0)} s, ${v.largura}x${v.altura}${v.avisos.length ? '; atenção: ' + v.avisos.join('; ') : ''}). Use como midia_url. PRIMEIRO pergunte, em uma linha, o que faltar: manter ou retirar o áudio (padrão da conta: ${(await import('../canal/api-marca.js')).ajuste(conta.id, 'video_sem_audio_padrao', true) ? 'retirar' : 'manter'})? Reels (com legenda) ou Story? quando? E ofereça: "quer editar (texto na tela, legenda, corte)? diga 'editar'". Se o dono pedir edição/texto/legenda queimada, responda só: "Diga 'MIA, editar esse vídeo' que eu abro o modo edição com ele."  Quando ele responder "sem áudio/retirar", chame remover_audio(url) e use a URL devolvida. Depois salve com criar_post (formato reels|story) com a data e confirme. Não gere imagem nem marca d'água para vídeo (o sistema aplica o logo sozinho).]`;
      } catch (e) { msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[vídeo recebido, mas não consegui hospedar: ${e.message}]`; }
      msg.forcarModulo = 'social';
    }
  }
  if (msg.tipo === 'imagem' || msg.tipo === 'arquivo') {
    // MANUAL DA MARCA (PDF ou imagem com legenda/nome "manual", "identidade visual", "paleta"…): a MIA lê e grava no kit de marca
    const mm = await import('../integracoes/manual-marca.js');
    if (ativosAgora.includes('social') && mm.ehManual({ legenda: msg.texto || '', nome: String(msg.midia?.nome || '').toLowerCase(), mime: msg.midia?.mime || '' })) {
      let bytesM; const midiaM = { ...msg.midia };
      try { bytesM = await canal.baixarMidia(msg.midia.ref); } catch (e) { return `Não consegui baixar o manual (${e.message}). Tente enviar de novo.`; }
      await canal.enviar(msg.conta, msg.chatId, { texto: '🎨 Lendo o manual da marca (cores, fontes e regras)…', modulo: 'social' });
      try {
        const r = await mm.lerManual(conta.id, Buffer.from(bytesM), msg.midia.mime);
        msg.texto = (msg.texto ? msg.texto + '\n' : '') + mm.contextoParaMIA(r, msg.midia?.nome || '');
      } catch (e) { msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[O dono enviou o manual da marca, mas a leitura falhou. Erro real: ${e.message}. Diga isso em 2 linhas e peça um print da página de cores ou os HEX. Não invente cores.]`; }
      // cópia no Drive pela Estag, em segundo plano e sem mensagem extra (se a Estag estiver ligada)
      if (ativosAgora.includes('documentos')) import('../ferramentas/documentos.js').then(d => d.receberArquivo(conta, { bytes: bytesM, mime: midiaM.mime, nome: midiaM.nome || 'manual-da-marca.pdf' })).catch(e => console.error('[manual] arquivar', e.message));
      msg.tipo = 'texto'; msg.midia = null; msg.forcarModulo = 'social';
    }
  }
  if (msg.tipo === 'imagem' || msg.tipo === 'arquivo') {
    const imgs = await import('./imagens-social.js');
    const legenda = msg.texto || '';
    const ehImagem = msg.tipo === 'imagem' || (msg.tipo === 'arquivo' && /^image\/(png|jpe?g|webp)/i.test(msg.midia?.mime || '') && imgs.LOGO_RX.test(legenda));
    const temDoc = ativosAgora.includes('documentos'), temSocial = ativosAgora.includes('social') && ehImagem, temFin = ativosAgora.includes('financeiro');
    const nomeArq = String(msg.midia?.nome || '').toLowerCase();
    let destino = temDoc && !temSocial ? 'documentos' : temSocial && !temDoc ? 'social' : null;
    if (temSocial && imgs.LOGO_RX.test(legenda)) destino = 'social'; // logo da marca → MIA guarda (nunca vira documento nem post)
    if (!destino && temDoc && temSocial) {
      if (SOCIAL_RX.test(legenda)) destino = 'social'; else if (DOC_RX.test(legenda)) destino = 'documentos';
    }
    // Tina: OFX/CSV sempre; legenda financeira (extrato, boleto, comprovante, pix…) vai para ela; sem legenda clara, a IA decide abaixo
    if (temFin && destino !== 'social') {
      if (/\.(ofx|csv)$/.test(nomeArq) || /ofx|csv/i.test(msg.midia?.mime || '') || (FIN_RX.test(legenda) && !SOCIAL_RX.test(legenda) && !/\b(guarda|arquiva)\b/i.test(legenda))) destino = 'financeiro';
      else if (!SOCIAL_RX.test(legenda) && !DOC_RX.test(legenda)) destino = null;
      else if (!destino && !temDoc && !temSocial) destino = 'financeiro';
    }
    let bytes = null;
    if (temDoc || temSocial || temFin) {
      if (msg.midia?.tamanho > 20 * 1024 * 1024 && !process.env.TELEGRAM_API_BASE) {
        return `📦 Esse arquivo tem ${(msg.midia.tamanho / 1048576).toFixed(0)} MB e o Telegram só me entrega até 20 MB. Suba no seu Google Drive e me mande o link do arquivo — eu guardo na pasta certa e registro do mesmo jeito.`;
      }
      try { bytes = await canal.baixarMidia(msg.midia.ref); } catch (e) { return `Não consegui baixar o arquivo (${e.message}). Se for grande, mande o link do Drive.`; }
    }
    if (!destino && temFin && bytes && /^(image\/|application\/pdf)/.test(msg.midia?.mime || '')) {
      try { const { lerImagem } = await import('../integracoes/gemini.js'); const r = await lerImagem(bytes, msg.midia.mime, `Classifique este arquivo. Responda só UMA palavra:\n- financeiro = extrato bancário, fatura de cartão, boleto ou comprovante de pagamento/pix/transferência\n${temDoc ? '- documento = contrato, nota fiscal, certidão, RG/CNH, apólice, formulário, recibo para guardar\n' : ''}${temSocial ? '- foto = foto de pessoa, cena, produto ou paisagem para redes sociais\n' : ''}`);
        destino = /financ/i.test(r) ? 'financeiro' : /foto/i.test(r) && temSocial ? 'social' : temDoc ? 'documentos' : temSocial ? 'social' : 'financeiro'; } catch { destino = temDoc ? 'documentos' : 'financeiro'; }
    }
    if (!destino && temFin && !temDoc && !temSocial) destino = 'financeiro';
    if (!destino && temDoc && temSocial && bytes) {
      // foto sem legenda clara: pergunta rápida à IA se é documento ou foto para post
      try { const { lerImagem } = await import('../integracoes/gemini.js'); const r = await lerImagem(bytes, msg.midia.mime, 'Isto é um DOCUMENTO (contrato, nota, boleto, certidão, RG/CNH, print de texto, formulário, comprovante) ou uma FOTO para redes sociais (pessoa, cena, produto, paisagem)? Responda só: documento ou foto'); destino = /documento/i.test(r) ? 'documentos' : 'social'; } catch { destino = 'social'; }
    }
    if (!destino) destino = temDoc ? 'documentos' : temSocial ? 'social' : temFin ? 'financeiro' : null;
    if (destino === 'documentos') {
      await canal.enviar(msg.conta, msg.chatId, '📂 Lendo e arquivando…');
      try {
        const { receberArquivo } = await import('../ferramentas/documentos.js');
        const doc = await receberArquivo(conta, { bytes, mime: msg.midia.mime, nome: msg.midia.nome || '' });
        if (doc.duplicado) msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[DUPLICADO — NÃO arquivei de novo: ${doc.motivo}. Original: ${JSON.stringify(doc.documento_original)}. Diga em 2 linhas que esse documento já estava guardado (título, pasta, link do original) e que não criei cópia.]`;
        else msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[Documento recebido do dono e JÁ ARQUIVADO no Drive. Dados: ${JSON.stringify(doc)}. Confirme em até 3 linhas: o que é, onde guardou (pasta) e o link; se houver vigência, diga a data e que os avisos estão agendados; se "legivel" for false, peça uma foto melhor ou que ele descreva o documento; se faltar empresa/tipo óbvios, pergunte. Não invente dados.]`;
        msg.forcarModulo = 'documentos';
        // a Estag identificou um manual de marca (sem legenda): a MIA também lê e grava cores/fontes no kit
        if (ativosAgora.includes('social') && !doc.duplicado && /\b(manual|brand ?book|identidade visual|guia de marca|paleta)\b/i.test(`${doc.titulo || ''} ${doc.resumo || ''}`)) {
          try { const mm = await import('../integracoes/manual-marca.js'); const r = await mm.lerManual(conta.id, Buffer.from(bytes), msg.midia.mime);
            msg.texto += '\n' + mm.contextoParaMIA(r, msg.midia?.nome || '').replace('Confirme ao dono em até 6 linhas', 'Depois de dizer onde arquivou, confirme em até 5 linhas'); msg.forcarModulo = 'social'; } catch (e) { console.error('[manual] via estag', e.message); }
        }
      } catch (e) { msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[Documento recebido mas NÃO arquivado. Erro real: ${e.message}. Repita o erro ao dono e diga o que ele precisa fazer.]`; msg.forcarModulo = 'documentos'; }
    } else if (destino === 'financeiro') {
      await canal.enviar(msg.conta, msg.chatId, '🧾 Tina lendo o documento financeiro…');
      try {
        const { lerDocumentoFinanceiro } = await import('../integracoes/extrato.js'); const fin = await import('../ferramentas/financeiro.js');
        const doc = await lerDocumentoFinanceiro(bytes, msg.midia.mime, msg.midia.nome || '');
        const carts = fin.carteirasDe(conta.id); let info;
        if (['extrato', 'fatura'].includes(doc.tipo) && doc.lancamentos?.length) {
          const cart = fin.carteiraNoTexto(conta.id, legenda) || (carts.length === 1 ? carts[0] : null);
          if (cart) { const r = await fin.importarLancamentos(conta.id, cart, doc); info = `[${doc.tipo === 'fatura' ? 'Fatura' : 'Extrato'} IMPORTADO na carteira ${cart}: ${JSON.stringify(r)}. Relate em até 5 linhas: período, quantos lançamentos novos (e duplicados ignorados), entradas e saídas, contas previstas que deram baixa sozinhas, e se houver itens sem categoria ofereça revisar.]`; }
          else { const id = fin.guardarImportacao(conta.id, doc); info = `[${doc.tipo === 'fatura' ? 'Fatura' : 'Extrato'} lido: ${doc.lancamentos.length} lançamentos${doc.banco ? ' (' + doc.banco + ')' : ''}, guardado como importação #${id} aguardando a carteira. ${carts.length ? 'Pergunte de qual carteira é (' + carts.join(', ') + ') e, com a resposta, use importar_extrato_pendente.' : 'Ainda não há carteiras definidas: pergunte ao dono quais são (cada empresa e a vida pessoal), use definir_carteiras e depois importar_extrato_pendente.'}]`; }
        } else if (doc.tipo === 'boleto' && doc.boleto?.valor) info = `[Boleto lido: ${JSON.stringify(doc.boleto)}. Lance com criar_conta_pagar (inclua linha_digitavel e contraparte=beneficiário). Carteira: ${fin.carteiraNoTexto(conta.id, legenda) || (carts.length === 1 ? carts[0] : 'pergunte uma vez (' + (carts.join(', ') || 'defina as carteiras') + ')')}.]`;
        else if (doc.tipo === 'comprovante' && doc.comprovante?.valor) info = `[Comprovante lido: ${JSON.stringify(doc.comprovante)}. Procure a conta prevista com esse valor (contas_em_aberto) e dê baixa com dar_baixa usando comprovante="${(doc.comprovante.tipo || 'comprovante')} ${doc.comprovante.data || ''} ${doc.comprovante.favorecido || ''}". Se não houver conta prevista, registre com registrar_lancamento (pergunte a carteira se preciso).]`;
        else info = `[Arquivo financeiro não reconhecido ou ilegível (tipo: ${doc.tipo || '?'}). Não chute valores: peça o extrato em OFX ou CSV (exportado do internet banking) ou uma foto mais nítida.]`;
        msg.texto = (legenda ? legenda + '\n' : '') + info; msg.forcarModulo = 'financeiro';
      } catch (e) { msg.texto = (legenda ? legenda + '\n' : '') + `[Não consegui ler o documento financeiro. Erro real: ${e.message}. Diga ao dono e sugira enviar o extrato em OFX ou CSV.]`; msg.forcarModulo = 'financeiro'; }
    } else if (destino === 'social' && imgs.deveColetar(conta.id, { legenda, grupo: msg.grupo })) {
      // logo, álbum ou foto sem pedido: guarda e decide o lote de uma vez (sem gerar post por conta própria)
      return imgs.coletar({ conta, msg, canal, bytes: Buffer.from(bytes), processar: (m) => tratarMensagem(m, canal) });
    } else if (destino === 'social') {
      try {
        const { guardarImagemEnviada } = await import('../ferramentas/social.js');
        const r = await guardarImagemEnviada(conta.id, bytes);
        if (!r.aplicada) { msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[Foto enviada pelo dono, já hospedada (SEM marca d'água): ${r.original}. Use esta URL como midia_url. Faça só o que ele pediu na legenda; marca d'água só se ele pedir (aplicar_marca).]`; msg.forcarModulo = 'social'; }
        else msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[Foto enviada pelo dono. Original: ${r.original}. Versão com a logo da marca já aplicada (logo ${r.info.logo || '?'}${r.info.sombra ? ' com sombra' : ''}, canto ${r.info.posicao || 'inferior-direito'}): ${r.marcada || 'falhou: ' + (r.info.erro || '')}. Use a versão marcada como midia_url. Mostre-a na resposta (vira prévia), diga qual cor de logo foi escolhida e por quê, e proponha legenda no modelo do manual (pergunte o pilar se não estiver claro).]`;
        msg.forcarModulo = 'social';
      } catch (e) { msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[imagem recebida, mas não consegui hospedar: ${e.message}]`; }
    } else msg.texto = (msg.texto ? msg.texto + '\n' : '') + `[${msg.tipo === 'imagem' ? 'imagem' : 'arquivo'} recebido; para eu guardar, ligue o módulo Documentos ("ativa documentos").]`;
  }
  // Link do Google Drive em texto → módulo Documentos registra/move
  if (msg.tipo === 'texto' && ativosAgora.includes('social') && /drive\.google\.com\/(file|open|uc)/.test(msg.texto) && !/^documentos pasta/i.test(msg.texto.trim())) {
    // Link do Drive: se for vídeo (ou imagem com pedido de post/story), é mídia para a MIA
    try {
      const drive = await import('../integracoes/google-drive.js'); const id = drive.extrairId(msg.texto); const meta = id ? await drive.metadados(conta.id, id) : null;
      const social = meta && (/^video\//.test(meta.mime) || (/^image\//.test(meta.mime) && (SOCIAL_RX.test(msg.texto) || !ativosAgora.includes('documentos'))));
      if (social) {
        await canal.enviar(msg.conta, msg.chatId, `🎬 Baixando "${meta.nome}" do Drive e hospedando…`);
        const bytes = await drive.baixar(conta.id, id); const soc = await import('../ferramentas/social.js');
        if (/^video\//.test(meta.mime)) { const v = await soc.guardarVideoEnviado(conta.id, bytes); msg.texto += `\n[Vídeo do Drive já hospedado: ${v.url} (${Math.round(v.duracao || 0)} s, ${v.largura}x${v.altura}${v.avisos.length ? '; atenção: ' + v.avisos.join('; ') : ''}). Use como midia_url. Pergunte Reels ou Story e quando, se o dono não disse; senão salve com criar_post e confirme.]`; }
        else { const r = await soc.guardarImagemEnviada(conta.id, bytes); msg.texto += r.aplicada ? `\n[Imagem do Drive hospedada. Original: ${r.original}. Com marca d'água: ${r.marcada || 'falhou'}. Use a marcada como midia_url (story ou post, conforme o dono).]` : `\n[Imagem do Drive hospedada (sem marca d'água): ${r.original}. Use como midia_url (story ou post, conforme o dono).]`; }
        msg.forcarModulo = 'social'; msg.linkTratado = true;
      }
    } catch (e) { if (e.liberar) return { texto: e.message.replace(/: (https?:\/\/\S+)$/, '.'), botoes: [[{ t: '🔓 Liberar arquivo', url: e.message.match(/(https?:\/\/\S+)$/)?.[1] }]] }; console.error('[drive→social]', e.message); }
  }
  if (msg.tipo === 'texto' && !msg.linkTratado && ativosAgora.includes('documentos') && /drive\.google\.com\/(file|open|uc)|docs\.google\.com\/(document|presentation)\/d\//.test(msg.texto) && !/^documentos pasta/i.test(msg.texto.trim())) {
    await canal.enviar(msg.conta, msg.chatId, '📂 Lendo o arquivo do Drive e arquivando…');
    try { const { receberLinkDrive } = await import('../ferramentas/documentos.js'); const doc = await receberLinkDrive(conta, msg.texto);
      if (doc.duplicado) msg.texto += `\n[DUPLICADO — NÃO arquivei de novo: ${doc.motivo}. Original: ${JSON.stringify(doc.documento_original)}. Diga em 2 linhas que já estava guardado (título, pasta, link do original).]`; else
      msg.texto += `\n[Arquivo do Drive JÁ MOVIDO para a pasta certa e registrado. Dados: ${JSON.stringify(doc)}. Confirme em até 3 linhas (o que é, pasta, link, vigência se houver). Não invente dados.]`; }
    catch (e) { if (e.liberar) return { texto: e.message.replace(/: (https?:\/\/\S+)$/, '.'), botoes: [[{ t: '🔓 Liberar arquivo', url: e.message.match(/(https?:\/\/\S+)$/)?.[1] }]] }; msg.texto += `\n[Link do Drive recebido mas não consegui arquivar. Erro real: ${e.message}. Repita ao dono.]`; }
    msg.forcarModulo = 'documentos';
  }
  if (!msg.texto?.trim()) return 'Recebi uma mensagem vazia.';

  // confirmação de ação pendente
  // Pendência só vale por 30 min; mais antiga é descartada (nunca executar ação esquecida por engano).
  db.prepare("DELETE FROM pendencias WHERE chat_id=? AND criado_em < datetime('now','-30 minutes')").run(msg.chatId);
  const pend = db.prepare('SELECT * FROM pendencias WHERE chat_id=? ORDER BY id DESC LIMIT 1').get(msg.chatId);
  // "Sim" só quando a mensagem é SÓ a confirmação ("pode", "iniciar", "bora"…). "Pode fazer de 201 a 300" é pedido novo.
  const SIM = /^[✅👍\s]*(sim|s|ok|okay|confirmo|confirmado|confirma|pode|pode sim|pode ir|pode seguir|pode mandar|pode fazer|vai|isso|isso mesmo|iniciar|inicia|inicie|come[cç]a|manda|manda ver|bora|fechado|claro|positivo|segue|prossiga|aprovado|aprovo|👍|✅)[\s!.,👍✅]*$/i;
  const NAO = /^[❌\s]*(n[aã]o|nao|n|cancela|cancelar|deixa|deixa pra l[aá]|esquece|para|parar|negativo|❌)[\s!.,❌]*$/i;
  if (pend && SIM.test(msg.texto.trim())) {
    db.prepare('DELETE FROM pendencias WHERE id=?').run(pend.id);
    const acoes = pend.ferramenta === '__lote__' ? JSON.parse(pend.args) : [{ name: pend.ferramenta, args: JSON.parse(pend.args) }];
    const resultados = [];
    for (const a of acoes) {
      try { resultados.push({ acao: a.name, args: a.args, ok: true, resultado: await executarFerramenta(pend.modulo, a.name, a.args, conta, { chatId: msg.chatId, confirmado: true }) }); }
      catch (e) { resultados.push({ acao: a.name, args: a.args, ok: false, erro: e.message }); }
    }
    // Devolve à persona para ela relatar e terminar o que faltava (ex.: criar o evento novo depois de cancelar os antigos)
    const ativosC = modulosAtivos(conta.id);
    const prompt = montarPrompt({ modulo: pend.modulo, conta, ativos: ativosC });
    const texto = `[O dono CONFIRMOU. Ações executadas: ${JSON.stringify(resultados)}. Relate em até 4 linhas o que foi feito (e o que falhou, com o erro real). Se o pedido original tinha etapas que ainda não foram feitas (ex.: criar o compromisso novo), execute-as AGORA com suas ferramentas e inclua no relato.]`;
    try { const resposta = await responder({ prompt, conta, modulo: pend.modulo, msg: { ...msg, texto }, ativos: ativosC }); await memoria.registrarInteracao(conta.id, pend.modulo, { ...msg, texto: 'sim (confirmação)' }, resposta); return resposta; }
    catch (e) { return resultados.map(r => r.ok ? `✅ ${r.acao}` : `❌ ${r.acao}: ${r.erro}`).join('\n'); }
  }
  if (pend && NAO.test(msg.texto.trim())) {
    db.prepare('DELETE FROM pendencias WHERE id=?').run(pend.id);
    const acoes = pend.ferramenta === '__lote__' ? JSON.parse(pend.args) : [{ name: pend.ferramenta, args: JSON.parse(pend.args) }];
    const { descreverAcao } = await import('./ia.js');
    return `👍 Ok, não fiz nada — descartei: ${acoes.map(a => descreverAcao(a)).join('; ')}. Tudo continua como estava.`;
  }

  const gov = await governanca(msg, conta); if (gov) return gov;

  const ativos = modulosAtivos(conta.id);
  // Chamou um assessor pelo nome? ("MIA, ...", "Tina: ...", "Secretária, ...") → vai direto para ele
  let modulo = msg.forcarModulo && ativos.includes(msg.forcarModulo) ? msg.forcarModulo : null;
  const cabeca = msg.texto.trim().slice(0, 40).toLowerCase();
  const nomesPadrao = { diretor: ['diretor'], secretaria: ['secretária', 'secretaria'], producao: ['produção', 'producao'], documentos: ['documentos'], financeiro: ['financeiro'], social: ['mia', 'social'] };
  for (const mod of (modulo ? [] : ativos)) {
    const nomes = [...(nomesPadrao[mod] || []), (configPersona(conta.id, mod).nome || '').toLowerCase()].filter(Boolean);
    if (nomes.some(n => new RegExp(`^${n}\\b[,:!]?\\s`).test(cabeca + ' '))) { modulo = mod; break; }
  }
  // Resposta curta de continuação ("aprovar", "agenda pra…", "ajusta", "sim") → fica com quem falou por último (até 30 min)
  if (!modulo) {
    const ult = memoria.ultimoModulo(conta.id);
    const recente = ult && (Date.now() - new Date(ult.criado_em + 'Z').getTime()) < 30 * 60000;
    const continuacao = /^(aprov|sim\b|ok\b|pode|confirm|agend|ajust|troca|muda|mudar|publica|refaz|outra|outro|mais |menos |n[ãa]o\b|cancela|deixa|essa|esse|isso|a segunda|a primeira|prefiro)/i.test(msg.texto.trim()) || msg.texto.trim().length < 25;
    if (recente && continuacao && ativos.includes(ult.modulo)) modulo = ult.modulo;
  }
  // Nome desconhecido no início ("OLGA, …") → ignora o vocativo e classifica pelo conteúdo
  let textoClass = msg.texto;
  const voc = msg.texto.match(/^([A-Za-zÀ-ÿ]{2,20})[,:]\s+/);
  if (!modulo && voc) textoClass = msg.texto.slice(voc[0].length);
  if (!modulo) {
    modulo = await classificar(textoClass, ativos);
    // Conversa em andamento com um assessor (até 30 min): resposta que o classificador mandaria ao Diretor fica com quem estava conversando
    // (ex.: MIA perguntou "o que quer mudar na imagem?" e o dono responde "somos uma facção, quero mais ligado à costura")
    const ult = memoria.ultimoModulo(conta.id);
    if (modulo === 'diretor' && ult && ult.modulo !== 'diretor' && ativos.includes(ult.modulo) && (Date.now() - new Date(ult.criado_em + 'Z').getTime()) < 30 * 60000
      && !/\b(alfred|diretor|prioridade|resumo|semana|m[eê]s|meta|estrat[eé]gia|equipe|todos os|vis[aã]o geral)\b/i.test(textoClass)) modulo = ult.modulo;
  }
  console.log(`[msg] ${msg.chatId} → ${modulo}: ${msg.texto.slice(0, 80)}`); contextoUso.modulo = modulo;
  const prompt = montarPrompt({ modulo, conta, ativos, texto: msg.texto });
  // Pedidos pesados (carrossel, arte, imagem): avisa na hora e deixa demorar
  if (modulo === 'social' && msg.tipo === 'texto' && /\b(carrossel|est[áa]tico|frase|arte|imagem|gera)\b/i.test(msg.texto.replace(/\[[^\]]*\]/g, ''))) {
    await canal.enviar(msg.conta, msg.chatId, '🎨 Montando… isso leva de 20 a 40 segundos. Te mando a prévia assim que ficar pronta.');
  }
  let resposta = await responder({ prompt, conta, modulo, msg, ativos });
  if (resposta && typeof resposta === 'object' && resposta.botoes && !resposta.foto && !resposta.video && !resposta.fotos) { /* confirmação com botões: passa direto */ await memoria.registrarInteracao(conta.id, modulo, msg, resposta.texto); return resposta; }
  await memoria.registrarInteracao(conta.id, modulo, msg, resposta);
  // Resposta com URL de imagem/vídeo hospedado (fal/cloudinary) sai como mídia, nunca como link — vale para qualquer assessor (o Diretor também gera)
  if (typeof resposta === 'string' && (/https?:\/\/(?:[\w.-]*fal\.media|res\.cloudinary\.com)\//i.test(resposta) || (modulo === 'social' && /https?:\/\/\S+\.(?:jpg|jpeg|png|webp)/i.test(resposta)))) {
    const todas = [...resposta.matchAll(/https?:\/\/res\.cloudinary\.com\/\S+?\.(?:jpg|jpeg|png|webp)/gi)].map(x => x[0]);
    if (todas.length > 1) { const txt = todas.reduce((t, u) => t.replace(u, ''), resposta).replace(/^\s*[-•]\s*[^\n:]{0,30}:\s*$/gm, '').replace(/^\s*Pr[ée]via[^\n]*:\s*$/gmi, '').replace(/\n{3,}/g, '\n\n').trim(); return { fotos: [...new Set(todas)], texto: txt }; }
    const m = resposta.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)(?:\?\S*)?|https?:\/\/(?:[\w.-]*fal\.media|res\.cloudinary\.com)\/\S+/i);
    const ehVideo = m && (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(m[0]) || /\/video\/upload\//.test(m[0]));
    if (m && !ehVideo) resposta = { foto: m[0], texto: resposta.replace(m[0], '').trim() };
    else if (m && ehVideo) resposta = { video: m[0], texto: resposta.replace(m[0], '').trim() };
  }
  return resposta;
}
