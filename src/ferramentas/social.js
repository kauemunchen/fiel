import * as ig from '../integracoes/instagram.js';
import * as cdn from '../integracoes/cloudinary.js';
import { gerarJSON } from '../integracoes/gemini.js';
import { db } from '../db/index.js';
import * as gcal from '../integracoes/google-calendar.js';
import * as render from '../integracoes/render.js';
import * as kit from '../integracoes/marca-kit.js';
const MARCADOR = 'Social Media';
/** Nome da marca/dono para os prompts: KM (admin) ou o cliente. */
// Regras do bot KM: texto sem markdown; hashtag da marca SEMPRE a última (KM: #kauemunchen).
export function limparTextoIA(t = '') {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/\*\*(.+?)\*\*/gs, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2').replace(/^>+\s*/gm, '').replace(/^[-*_]{3,}$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
export function hashtagMarca(contaId) {
  const id = identidade(contaId) || {};
  if (id.hashtag_marca) return '#' + String(id.hashtag_marca).replace(/^#/, '').trim();
  if (kit.usaKM(contaId)) return '#kauemunchen';
  const a = kit.lerKit(contaId)?.assinatura; return a ? '#' + a.replace(/^@/, '').replace(/[^\wÀ-ÿ]/g, '') : null;
}
/** Até 5 hashtags do tema + a da marca no fim (sem repetir). */
export function hashtagsFinal(contaId, tags) {
  const marca = hashtagMarca(contaId);
  const lista = String(Array.isArray(tags) ? tags.join(' ') : tags || '').replace(/,/g, ' ').split(/\s+/).map(t => t.trim()).filter(Boolean).map(t => t.startsWith('#') ? t : '#' + t).map(t => t.replace(/[^#\wÀ-ÿ]/g, ''));
  const unicas = [...new Set(lista.map(t => t.toLowerCase()))].map(l => lista.find(t => t.toLowerCase() === l));
  const outras = unicas.filter(t => !marca || t.toLowerCase() !== marca.toLowerCase()).slice(0, 5);
  return [...outras, ...(marca ? [marca] : [])].join(' ');
}
const quemE = (conta) => kit.usaKM(conta.id) ? 'Kauê München' : (kit.lerKit(conta.id)?.nome || conta.empresa || conta.nome_dono);
const manualDe = (conta) => kit.usaKM(conta.id) ? 'o MANUAL DA MARCA KM' : `a identidade de ${quemE(conta)} (${kit.resumoParaPrompt(conta.id)?.replace(/\n/g, ' ') || 'sem kit cadastrado'})`;

const identidade = (contaId) => { const r = db.prepare('SELECT dados FROM social_identidade WHERE conta_id=?').get(contaId); return r ? JSON.parse(r.dados) : null; };
const historico = (contaId, n = 5) => db.prepare("SELECT formato, tema, legenda, hashtags FROM posts WHERE conta_id=? AND status='publicado' ORDER BY id DESC LIMIT ?").all(contaId, n);

export function ferramentas(_conta) {
  return [
    { name: 'definir_identidade', description: 'Salva/atualiza a identidade da marca para conteúdo: nome e @perfil, nicho, categoria (ex.: Mentor, Imobiliária), público-alvo, tom de voz, descrição completa, pilares, hashtags fixas e a hashtag da marca (vai SEMPRE por último em todo post). Chame quando o dono descrever a marca. Se faltar algo, pergunte um campo por vez (1/6 nome e @, 2/6 nicho, 3/6 categoria, 4/6 público, 5/6 tom, 6/6 descrição).', parameters: { type: 'OBJECT', properties: { perfil: { type: 'STRING', description: 'nome e @, ex.: Kauê München | @kauemunchen' }, nicho: { type: 'STRING' }, categoria: { type: 'STRING' }, publico: { type: 'STRING' }, tom: { type: 'STRING' }, descricao: { type: 'STRING' }, pilares: { type: 'STRING' }, hashtags_fixas: { type: 'STRING' }, hashtag_marca: { type: 'STRING', description: 'ex.: #kauemunchen — sempre a última hashtag' } } } },
    { name: 'gerar_pauta', description: 'Pauta editorial (padrão 7 dias): para cada dia, tema, formato (post/carrossel/frase/story/reels), horário sugerido, gancho e pilar — na identidade e no histórico da marca. Só sugere; salvar como rascunhos apenas se o dono pedir.', parameters: { type: 'OBJECT', properties: { dias: { type: 'NUMBER' }, foco: { type: 'STRING', description: 'tema/campanha da semana (opcional)' } } } },
    { name: 'gerar_hashtags', description: 'Gera 5 hashtags estratégicas do nicho para um tema; a hashtag da marca entra automaticamente no fim.', parameters: { type: 'OBJECT', properties: { tema: { type: 'STRING' } }, required: ['tema'] } },
    { name: 'editar_imagem', description: 'Retoca uma imagem existente por instrução (ex.: "mais contraste", "fundo mais claro", "tom mais quente"). Só quando o dono pedir. Devolve a URL nova.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' }, instrucao: { type: 'STRING' } }, required: ['url', 'instrucao'] } },
    { name: 'banner_produto', description: 'Banner de produto: a partir da FOTO do produto (URL), mantém o produto idêntico (rótulo, marca, cores) e troca só o fundo/cenário descrito. Use quando o dono mandar foto de produto pedindo banner/anúncio.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING', description: 'URL da foto do produto' }, cenario: { type: 'STRING', description: 'fundo/cenário desejado' } }, required: ['url', 'cenario'] } },
    { name: 'renomear_midia', description: 'Renomeia uma mídia da biblioteca (pelo id).', parameters: { type: 'OBJECT', properties: { id: { type: 'NUMBER' }, nome: { type: 'STRING' } }, required: ['id', 'nome'] } },
    { name: 'remover_midia', description: 'Remove uma mídia da biblioteca (pelo id). Pede confirmação.', parameters: { type: 'OBJECT', properties: { id: { type: 'NUMBER' } }, required: ['id'] } },
    { name: 'ver_historico', description: 'Lista os últimos posts publicados (tipo, tema, data) — é a base de estilo que a MIA usa para manter o tom.', parameters: { type: 'OBJECT', properties: { max: { type: 'NUMBER' } } } },
    { name: 'ver_identidade', description: 'Mostra a identidade de marca salva', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'gerar_legenda', description: 'Gera legenda no modelo do manual da marca (gancho, contexto, 3 pontos, CTA único, 5 hashtags = fixas + do pilar). Informe o pilar (um dos pilares da marca) e o objetivo do CTA (salvar|compartilhar|comentar|seguir|conversa|direct).', parameters: { type: 'OBJECT', properties: { tema: { type: 'STRING' }, formato: { type: 'STRING', description: 'post|carrossel|reels|story' }, pilar: { type: 'STRING', description: 'pilar de conteúdo da marca (KM: GESTÃO|NEGÓCIOS|IA|AUTOMAÇÃO; clientes: os pilares deles)' }, objetivo_cta: { type: 'STRING', description: 'salvar|compartilhar|comentar|seguir|conversa|direct' }, serie: { type: 'STRING', description: 'Antes do processo | Método 3R | Ferramenta da semana | (vazio)' }, ajuste: { type: 'STRING', description: 'instrução de ajuste sobre uma versão anterior' } }, required: ['tema', 'pilar'] } },
    { name: 'gerar_midia', description: 'Gera imagem com IA a partir de briefing visual (na identidade da marca, sem texto na imagem). provedor: fal (FLUX: rápida e barata, padrão) | gemini (Realista: mais fiel/fotográfica, custa bem mais créditos). Se o dono não disse qual IA ou formato, pergunte numa mensagem só ("FLUX ou Realista? Feed 4:5, quadrado ou story 9:16?"). Retorna URL.', parameters: { type: 'OBJECT', properties: { briefing: { type: 'STRING' }, ratio: { type: 'STRING', description: '1:1|3:4|4:5|9:16|16:9' }, provedor: { type: 'STRING', description: 'fal|gemini' } }, required: ['briefing'] } },
    { name: 'gerar_frase', description: 'Estático: frase forte (até 2 linhas) com UMA palavra na cor de destaque, etiqueta do pilar, nas cores e logo da marca da conta, 3:4. Retorna URL.', parameters: { type: 'OBJECT', properties: { frase: { type: 'STRING' }, palavra_dourada: { type: 'STRING', description: 'a palavra da frase que vai em dourado' }, pilar: { type: 'STRING', description: 'pilar de conteúdo da marca (KM: GESTÃO|NEGÓCIOS|IA|AUTOMAÇÃO; clientes: os pilares deles)' }, template: { type: 'STRING', description: 'manual (padrão) | km' }, paleta: { type: 'STRING', description: 'marca (padrão: cores do kit da conta) | preto | copa | azul | vinho | personalizada' }, cor_fundo: { type: 'STRING', description: 'só p/ paleta personalizada (hex)' }, cor_destaque: { type: 'STRING', description: 'só p/ paleta personalizada (hex)' }, autoria: { type: 'STRING' } }, required: ['frase'] } },
    { name: 'gerar_carrossel', description: 'Carrossel (6–8 slides, 3:4) NA IDENTIDADE DA CONTA (cores, @ e logo cadastrados no kit de marca): capa (etiqueta + título ≤8 palavras com UMA palavra em destaque + subtítulo) → problema → 3–5 conteúdo → resumo → CTA. Para transformar um texto pronto do dono, passe-o em texto_base. Retorna URLs + textos. Depois criar_post(formato=carrossel, midias_urls).', parameters: { type: 'OBJECT', properties: { tema: { type: 'STRING' }, texto_base: { type: 'STRING', description: 'texto pronto do dono a transformar em carrossel (mantenha as ideias dele)' }, pilar: { type: 'STRING', description: 'pilar de conteúdo da marca (KM: GESTÃO|NEGÓCIOS|IA|AUTOMAÇÃO; clientes: os pilares deles)' }, objetivo_cta: { type: 'STRING', description: 'salvar|compartilhar|comentar|seguir|conversa' }, qtd_conteudo: { type: 'NUMBER', description: 'slides de conteúdo, 3 a 5 (padrão 3)' }, instrucoes: { type: 'STRING' }, template: { type: 'STRING', description: 'manual (padrão) | km' }, paleta: { type: 'STRING', description: 'marca (padrão: cores do kit da conta) | preto | copa | azul | vinho | personalizada' }, cor_fundo: { type: 'STRING', description: 'só p/ paleta personalizada (hex)' }, cor_destaque: { type: 'STRING', description: 'só p/ paleta personalizada (hex)' } }, required: ['tema', 'pilar'] } },
    { name: 'aplicar_marca', description: 'Aplica a LOGO DA MARCA DA CONTA como marca d\'água numa imagem (URL), escolhendo a versão clara/escura pelo fundo. Só use quando o dono PEDIR marca d\'água/logo na foto.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' }, posicao: { type: 'STRING', description: 'inferior-direito (padrão) | inferior-esquerdo | superior-direito | superior-esquerdo' }, assinatura: { type: 'BOOLEAN', description: 'escrever @kauemunchen sob o logo (padrão false — só se o dono pedir)' } }, required: ['url'] } },
    { name: 'ver_marca_visual', description: 'Mostra o kit de marca visual da conta (cores, @, logos cadastradas). Use antes de criar arte se não souber a identidade.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'definir_marca_visual', description: 'Salva o kit de marca VISUAL da conta usado nas artes (carrossel, frase, story): cores em hex, @ do Instagram, nome, fontes e regras. Use quando o dono passar as cores/identidade ou mandar o manual da marca (extraia as cores HEX do manual). Depois confirme o que salvou.', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING', description: 'nome da marca como aparece' }, assinatura: { type: 'STRING', description: '@ do Instagram' }, cor_fundo: { type: 'STRING', description: 'hex da cor de fundo das artes (geralmente a cor principal escura)' }, cor_destaque: { type: 'STRING', description: 'hex da cor de destaque (palavra-chave, detalhes)' }, cor_titulo: { type: 'STRING', description: 'hex do texto do título (opcional; automático pelo contraste)' }, cor_apoio: { type: 'STRING', description: 'hex do texto de apoio (opcional)' }, fontes: { type: 'STRING' }, observacoes: { type: 'STRING', description: 'regras do manual em 1–3 linhas (ex.: não distorcer a logo, área de respiro)' } } } },
    { name: 'ler_manual_marca', description: 'LÊ o manual da marca (imagem ou PDF já hospedado, ex.: URL de uma imagem enviada ou da biblioteca) com visão de IA: extrai cores HEX, fontes e regras e SALVA no kit de marca. Use quando o dono mandar uma página/print do manual, a paleta de cores ou perguntar se você conseguiu ler o manual. Nunca diga que não consegue ler imagem sem tentar esta ferramenta.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
    { name: 'salvar_logo', description: 'Guarda uma imagem (URL já hospedada) como LOGO da marca da conta. variante: principal | claro (versão para fundo escuro, ex.: logo branca) | escuro (versão para fundo claro). substituir=true troca a logo daquela variante. NUNCA gere post a partir de uma logo.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' }, variante: { type: 'STRING' }, substituir: { type: 'BOOLEAN' } }, required: ['url'] } },
    { name: 'remover_audio', description: 'Gera uma versão SEM áudio de um vídeo já hospedado (URL do Cloudinary) e devolve a nova URL para usar como midia_url. Use quando o dono pedir vídeo mudo/sem som.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
    { name: 'listar_biblioteca', description: 'Lista mídias guardadas do dono (fotos, vídeos hospedados, stories prontos) para montar um post depois. Devolve id, descrição e URL pronta para midia_url.', parameters: { type: 'OBJECT', properties: { tipo: { type: 'STRING', description: 'imagem|video|story|vazio=todas' }, max: { type: 'NUMBER' } } } },
    { name: 'criar_post', description: 'Salva post no calendário editorial com legenda/hashtags/mídia aprovados. formato: post (foto) | carrossel | reels (vídeo, com legenda) | story (foto ou vídeo ≤60 s, sem legenda). midia_url pode ser imagem ou vídeo (URL do Cloudinary vinda do upload). status: rascunho ou agendado (com data).', parameters: { type: 'OBJECT', properties: { formato: { type: 'STRING' }, tema: { type: 'STRING' }, legenda: { type: 'STRING' }, hashtags: { type: 'STRING' }, midia_url: { type: 'STRING' }, midias_urls: { type: 'ARRAY', items: { type: 'STRING' }, description: 'slides do carrossel, em ordem' }, data: { type: 'STRING', description: 'YYYY-MM-DDTHH:MM para agendar; vazio = rascunho' }, pilar: { type: 'STRING' } }, required: ['formato', 'legenda'] } },
    { name: 'agendar_post', description: 'Agenda um post salvo (rascunho) para uma data/hora; cria o evento no marcador Social Media da agenda. Use quando o dono aprovar e disser quando.', parameters: { type: 'OBJECT', properties: { post_id: { type: 'NUMBER' }, data: { type: 'STRING', description: 'YYYY-MM-DDTHH:MM' } }, required: ['post_id', 'data'] } },
    { name: 'atualizar_post', description: 'Altera legenda, hashtags, mídia, tema, pilar ou formato de um post salvo', parameters: { type: 'OBJECT', properties: { post_id: { type: 'NUMBER' }, legenda: { type: 'STRING' }, hashtags: { type: 'STRING' }, midia_url: { type: 'STRING' }, midias_urls: { type: 'ARRAY', items: { type: 'STRING' } }, tema: { type: 'STRING' }, pilar: { type: 'STRING' }, formato: { type: 'STRING' } }, required: ['post_id'] } },
    { name: 'listar_calendario', description: 'Lista a programação de posts (rascunho, agendado, publicado) num período; use para "o que temos programado"', parameters: { type: 'OBJECT', properties: { inicio: { type: 'STRING' }, fim: { type: 'STRING' }, status: { type: 'STRING' } } } },
    { name: 'publicar', description: 'Publica um post salvo no Instagram agora (requer confirmação)', parameters: { type: 'OBJECT', properties: { post_id: { type: 'NUMBER' } }, required: ['post_id'] } },
    { name: 'ler_metricas', description: 'Métricas da conta nos últimos N dias', parameters: { type: 'OBJECT', properties: { dias: { type: 'NUMBER' } } } },
  ];
}
export const requerConfirmacao = new Set(['publicar', 'remover_midia']);

export async function executar(nome, a, conta, ctx = {}) {
  const cred = db.prepare('SELECT * FROM instagram_auth WHERE conta_id=?').get(conta.id);
  switch (nome) {
    case 'definir_identidade': {
      const atual = identidade(conta.id) || {};
      const novo = { ...atual, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v)) };
      db.prepare('INSERT INTO social_identidade (conta_id, dados) VALUES (?,?) ON CONFLICT(conta_id) DO UPDATE SET dados=excluded.dados').run(conta.id, JSON.stringify(novo));
      return novo;
    }
    case 'ver_identidade': return identidade(conta.id) || { aviso: 'Nenhuma identidade salva. Peça ao dono: perfil, nicho, público, tom, pilares.' };
    case 'gerar_legenda': {
      const id = identidade(conta.id) || {};
      const hist = historico(conta.id);
      const pilarKey = (a.pilar || 'gestao').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const tagsPilar = id.hashtags_pilar?.[pilarKey] || '';
      const cta = id.ctas?.[(a.objetivo_cta || 'salvar').toLowerCase()] || a.objetivo_cta || '';
      const r = await gerarJSON(`Você é a MIA, social media de ${id.perfil || quemE(conta)}. Gere legenda para Instagram em português do Brasil seguindo ${manualDe(conta)} à risca.
IDENTIDADE: ${JSON.stringify({ nicho: id.nicho, publico: id.publico, tom: id.tom, pilares: id.pilares, provas: id.provas, fase: id.fase })}
HISTÓRICO APROVADO (referência de tom): ${JSON.stringify(hist)}
TEMA: ${a.tema}
FORMATO: ${a.formato || 'post'} · PILAR: ${(a.pilar || (kit.usaKM(conta.id) ? 'GESTÃO' : 'CONTEÚDO')).toUpperCase()}${a.serie ? ' · SÉRIE: ' + a.serie : ''}
CTA OBRIGATÓRIO (único, no fim, exatamente este texto): "${cta}"
HASHTAGS OBRIGATÓRIAS (exatamente 5): fixas ${id.hashtags_fixas || ''} + 2 escolhidas de: ${tagsPilar}
${a.ajuste ? 'AJUSTE PEDIDO SOBRE A VERSÃO ANTERIOR: ' + a.ajuste : ''}
MODELO DA LEGENDA: [gancho 1 linha] linha em branco [história/contexto real 2–3 linhas] linha em branco [3 pontos curtos numerados 1. 2. 3.] linha em branco [CTA] linha em branco [5 hashtags].
REGRAS: gancho nas 3 primeiras palavras (fórmulas: número+contraste, frase que dói, confissão, "e se"); uma ideia por post; números só os das provas de autoridade ou os informados; nunca inventar depoimento; sem venda na fase atual; sem emoji além de um no máximo.
Responda JSON: {"etiqueta": "${(a.pilar || (kit.usaKM(conta.id) ? 'GESTÃO' : 'CONTEÚDO')).toUpperCase()}", "gancho": "...", "legenda": "texto completo no modelo, sem as hashtags", "hashtags": "#a #b #c #d #e", "cta": "${cta}", "briefing_imagem": "descrição visual curta na identidade visual da marca"${(a.formato === 'carrossel') ? ', "slides": ["capa: título até 8 palavras com UMA palavra em dourado", "problema", "conteúdo 1", "conteúdo 2", "conteúdo 3", "resumo", "cta"]' : ''}}`);
      if (r) { r.legenda = limparTextoIA(r.legenda); r.hashtags = hashtagsFinal(conta.id, r.hashtags); }
      return r;
    }
    case 'gerar_pauta': {
      const id = identidade(conta.id) || {}; const dias = Math.min(14, Math.max(3, a.dias || 7));
      return gerarJSON(`Você é a MIA, social media de ${id.perfil || quemE(conta)}. Crie uma pauta editorial de ${dias} dias para o Instagram, em português do Brasil.
IDENTIDADE: ${JSON.stringify({ nicho: id.nicho, categoria: id.categoria, publico: id.publico, tom: id.tom, pilares: id.pilares, descricao: id.descricao })}
HISTÓRICO APROVADO (não repita temas recentes): ${JSON.stringify(historico(conta.id, 8).map(h => h.tema))}
${a.foco ? 'FOCO DA SEMANA: ' + a.foco : ''}
Varie formatos (post, carrossel, frase, story, reels) e pilares. Horário no fuso de Brasília, nos melhores horários do público.
Responda JSON: {"pauta": [{"dia": "Seg 10/11", "formato": "carrossel", "pilar": "...", "tema": "...", "gancho": "primeira frase do post", "horario": "19:00"}]}`);
    }
    case 'gerar_hashtags': {
      const id = identidade(conta.id) || {};
      const r = await gerarJSON(`Gere EXATAMENTE 5 hashtags estratégicas em português para um post do Instagram sobre: ${a.tema}. Nicho: ${id.nicho || '—'}. Público: ${id.publico || '—'}. Misture 2 amplas, 2 médias e 1 de nicho. NÃO inclua ${hashtagMarca(conta.id) || 'a hashtag da marca'}. Responda JSON: {"hashtags": "#a #b #c #d #e"}`);
      return { hashtags: hashtagsFinal(conta.id, r?.hashtags) };
    }
    case 'editar_imagem': { const ia = await import('../integracoes/imagem-ia.js'); return { url: await ia.editarImagem({ url: a.url, instrucao: a.instrucao }), instrucao: a.instrucao }; }
    case 'banner_produto': { const ia = await import('../integracoes/imagem-ia.js'); return { url: await ia.editarImagem({ url: a.url, instrucao: a.cenario, manterProduto: true }), cenario: a.cenario }; }
    case 'renomear_midia': { const r = db.prepare('UPDATE biblioteca SET nome=? WHERE id=? AND conta_id=?').run(String(a.nome).slice(0, 80), a.id, conta.id); if (!r.changes) throw new Error(`Mídia #${a.id} não encontrada.`); return { ok: true, id: a.id, nome: a.nome }; }
    case 'remover_midia': { const r = db.prepare('DELETE FROM biblioteca WHERE id=? AND conta_id=?').run(a.id, conta.id); if (!r.changes) throw new Error(`Mídia #${a.id} não encontrada.`); return { ok: true, removida: a.id }; }
    case 'ver_historico': return db.prepare("SELECT id, formato, tema, publicado_em, data FROM posts WHERE conta_id=? AND status='publicado' ORDER BY id DESC LIMIT ?").all(conta.id, Math.min(30, a.max || 10));
    case 'gerar_midia': {
      const id = identidade(conta.id) || {};
      const prompt = `${a.briefing}. Estilo: ${id.estilo_visual || 'limpo, profissional, alto contraste, sem texto na imagem'}.`;
      const ia = await import('../integracoes/imagem-ia.js');
      const provedor = a.provedor || 'fal';
      return { url: await ia.gerarImagem({ prompt: prompt + ' No text. No watermarks.', ratio: a.ratio || '4:5', provedor }), briefing: a.briefing, provedor, disponiveis: ia.provedoresDisponiveis().map(p => p.id) };
    }
    case 'listar_paletas': return render.paletas();
    case 'ver_marca_visual': return kit.usaKM(conta.id) ? { identidade: 'KM (padrão do manual KM)' } : (kit.lerKit(conta.id) || { aviso: 'Nenhum kit de marca visual cadastrado. Peça cores (hex), @ e logos — ou o manual da marca.' });
    case 'definir_marca_visual': {
      const k = kit.salvarKit(conta.id, { nome: a.nome, assinatura: a.assinatura, fontes: a.fontes, observacoes: a.observacoes, cores: { fundo: a.cor_fundo, destaque: a.cor_destaque, titulo: a.cor_titulo, apoio: a.cor_apoio } });
      return { salvo: true, kit: k, falta: [!k.cores?.fundo && 'cor de fundo', !k.cores?.destaque && 'cor de destaque', !kit.temLogo(conta.id) && 'logos (mande as imagens com a legenda "logo")'].filter(Boolean) };
    }
    case 'ler_manual_marca': {
      const r0 = await fetch(a.url); if (!r0.ok) throw new Error(`não consegui baixar o arquivo (${r0.status})`);
      const ct = (r0.headers.get('content-type') || '').split(';')[0];
      const mime = /pdf/i.test(ct) || /\.pdf(\?|$)/i.test(a.url) ? 'application/pdf' : /^image\//.test(ct) ? ct : /\.png(\?|$)/i.test(a.url) ? 'image/png' : 'image/jpeg';
      const mm = await import('../integracoes/manual-marca.js');
      const r = await mm.lerManual(conta.id, Buffer.from(await r0.arrayBuffer()), mime);
      return r.legivel ? r : { legivel: false, aviso: 'Não encontrei cores nem fontes legíveis neste arquivo. Peça um print nítido da página de cores (com os códigos) ou os HEX digitados. Não invente.' };
    }
    case 'salvar_logo': { const r = kit.salvarLogo(conta.id, a.url, a.variante, { substituir: !!a.substituir }); db.prepare("UPDATE biblioteca SET tipo='logo' WHERE conta_id=? AND url=?").run(conta.id, a.url); return { salvo: true, ...r }; }
    case 'aplicar_marca': {
      if (!kit.temLogo(conta.id)) throw new Error('Nenhuma logo cadastrada para esta marca. Peça ao dono para mandar a logo com a legenda "logo".');
      const src = await fetch(a.url).then(r => { if (!r.ok) throw new Error('não consegui baixar a imagem'); return r.arrayBuffer(); });
      const { bytes, info } = await render.marcaDagua(Buffer.from(src), { posicao: a.posicao || 'inferior-direito', assinatura: a.assinatura === true, contaId: conta.id });
      const url = await cdn.upload(bytes, { pasta: `assessor/${conta.id}/marcadas` });
      return { url, ...info };
    }
    case 'gerar_frase': {
      const bytes = await render.frase(limparTextoIA(a.frase), { template: a.template || 'manual', paleta: a.paleta || 'km', cores: a.cor_fundo ? { fundo: a.cor_fundo, destaque: a.cor_destaque } : undefined, autoria: a.autoria, palavra_dourada: a.palavra_dourada, etiqueta: a.pilar, contaId: conta.id });
      const url = await cdn.upload(bytes, { pasta: `assessor/${conta.id}/frases` });
      return { url, frase: a.frase, palavra_dourada: a.palavra_dourada, template: a.template || 'manual' };
    }
    case 'gerar_carrossel': {
      const km = kit.usaKM(conta.id);
      const template = km ? (a.template || 'manual') : 'manual';
      const idd = identidade(conta.id) || {};
      const cta = idd.ctas?.[(a.objetivo_cta || 'salvar').toLowerCase()] || 'Salva para aplicar na segunda-feira.';
      let dados;
      if (template === 'km') {
        const qtd = a.qtd_conteudo || 4;
        dados = await gerarJSON(`Crie conteudo para carrossel Instagram sobre: ${a.tema}.
${a.instrucoes ? 'Instrucoes de estilo: ' + a.instrucoes + '\n' : ''}Formato exato: {"titulo": "TITULO CAPA MAX 3 PALAVRAS", "subtitulo": "subtitulo curto max 8 palavras", "slides": [{"num": "01", "titulo": "MAX 2 PALAVRAS", "texto": "frase curta max 10 palavras"}], "cta": "FRASE CURTA MAX 5 PALAVRAS"}
Crie EXATAMENTE ${qtd} objetos dentro do array slides. Apenas o JSON.`);
      } else {
        const n = Math.min(5, Math.max(3, a.qtd_conteudo || 3));
        dados = await gerarJSON(`Você é a MIA, social media de ${quemE(conta)}. Escreva um carrossel de Instagram seguindo ${km ? 'o Manual da Marca KM' : 'o tom e o público desta marca (NÃO é a marca KM)'}.
IDENTIDADE: ${JSON.stringify({ nicho: idd.nicho, publico: idd.publico, tom: idd.tom, provas: idd.provas })}
TEMA: ${a.tema} · PILAR: ${(a.pilar || (km ? 'GESTÃO' : 'CONTEÚDO')).toUpperCase()}
${a.texto_base ? 'TEXTO DO DONO (transforme ESTE texto em carrossel: mantenha as ideias, a ordem e os dados dele; só divida e enxugue):\n' + String(a.texto_base).slice(0, 4000) + '\n' : ''}${a.instrucoes ? 'INSTRUÇÕES: ' + a.instrucoes + '\n' : ''}ESTRUTURA OBRIGATÓRIA: capa → 1 slide "problema" → ${n} slides "conteudo" → 1 slide "resumo" → CTA.
REGRAS: título da capa com até 8 palavras e UMA palavra-chave para destacar em dourado (palavra_dourada = exatamente uma palavra que aparece no título); subtítulo 1 linha; cada slide interno: título até 6 palavras (pode ter palavra_dourada) e texto de até 30 palavras, direto, de igual para igual, sem jargão; números só os das provas ou do tema; sem emoji.
Responda JSON: {"etiqueta": "${(a.pilar || (km ? 'GESTÃO' : 'CONTEÚDO')).toUpperCase()}", "titulo": "...", "palavra_dourada": "...", "subtitulo": "...", "slides": [{"tipo": "problema", "titulo": "...", "texto": "..."}, {"tipo": "conteudo", "titulo": "...", "palavra_dourada": "...", "texto": "..."}, {"tipo": "resumo", "titulo": "...", "texto": "..."}], "cta": "${cta}"}`);
      }
      if (!dados?.slides?.length) throw new Error('IA não devolveu slides válidos; tente de novo.');
      const slides = await render.carrossel(dados, { template, paleta: a.paleta || 'km', cores: a.cor_fundo ? { fundo: a.cor_fundo, destaque: a.cor_destaque } : undefined, contaId: conta.id });
      const base = Date.now();
      const urls = await Promise.all(slides.map((b, i) => cdn.upload(b, { pasta: `assessor/${conta.id}/carrossel`, nome: `car_${base}_${i}` })));
      return { urls, textos: dados, template };
    }
    case 'remover_audio': {
      const bytes = Buffer.from(await fetch(a.url).then(r => { if (!r.ok) throw new Error('não consegui baixar o vídeo'); return r.arrayBuffer(); }));
      const r = await render.editarVideo(bytes, { sem_audio: true, logo: kit.marcaDaguaAutomatica(conta.id) }, { contaId: conta.id });
      const v = await cdn.uploadVideo(r.bytes, { pasta: `assessor/${conta.id}/videos` });
      db.prepare('INSERT INTO biblioteca (conta_id, url, marcada_url, tipo, origem, descricao, largura, altura, duracao) VALUES (?,?,?,?,?,?,?,?,?)').run(conta.id, v.url, v.url, 'video', 'sem-audio', 'vídeo sem áudio', v.largura || null, v.altura || null, v.duracao || null);
      return { url: v.url, audio: 'removido', logo: r.info.logo };
    }
    case 'listar_biblioteca': return listarBiblioteca(conta.id, { tipo: a.tipo, max: a.max || 15 });
    case 'criar_post': {
      if (a.legenda) a.legenda = limparTextoIA(a.legenda);
      if (a.hashtags || hashtagMarca(conta.id)) a.hashtags = hashtagsFinal(conta.id, a.hashtags) || null;
      if ((a.formato || '') === 'story') a.hashtags = null;
      const status = a.data ? 'agendado' : 'rascunho';
      if (a.midias_urls?.length) { const m = []; for (const u of a.midias_urls) m.push(await garantirMarca(conta.id, u)); a.midias_urls = m; }
      if (a.midia_url) a.midia_url = await garantirMarca(conta.id, a.midia_url);
      const midiaUrl = a.midias_urls?.length ? JSON.stringify(a.midias_urls) : (a.midia_url || null);
      const r = db.prepare('INSERT INTO posts (conta_id, formato, pilar, tema, data, legenda, hashtags, midia_url, status) VALUES (?,?,?,?,?,?,?,?,?)').run(conta.id, a.formato, a.pilar || null, a.tema || null, a.data || null, a.legenda, a.hashtags || null, midiaUrl, status);
      const postId = r.lastInsertRowid; let agenda = null;
      if (a.data) {
        try {
          const ev = await gcal.criarEvento(conta.id, { titulo: `📣 ${a.formato}: ${a.tema || a.legenda.slice(0, 40)}`, inicio: a.data, fim: new Date(new Date(a.data).getTime() + 15 * 60000).toISOString().slice(0, 16), descricao: `Post #${postId} · ${a.legenda.slice(0, 300)}${a.midia_url ? '\n' + a.midia_url : ''}`, categoria: MARCADOR, lembreteMin: 60 });
          db.prepare('UPDATE posts SET gcal_event_id=? WHERE id=?').run(ev.id, postId); agenda = ev.link;
        } catch (e) { agenda = `não entrou na agenda: ${e.message}`; }
      }
      return { id: postId, status, data: a.data || null, tem_midia: !!a.midia_url, agenda };
    }
    case 'agendar_post': {
      const p = db.prepare('SELECT * FROM posts WHERE id=? AND conta_id=?').get(a.post_id, conta.id);
      if (!p) throw new Error(`Post #${a.post_id} não existe.`);
      if (p.status === 'publicado') throw new Error('Esse post já foi publicado.');
      db.prepare("UPDATE posts SET status='agendado', data=? WHERE id=?").run(a.data, p.id);
      let agenda = null;
      try {
        if (p.gcal_event_id) { await gcal.atualizarEvento(conta.id, p.gcal_event_id, { inicio: a.data, fim: new Date(new Date(a.data).getTime() + 15 * 60000).toISOString().slice(0, 16) }); agenda = 'evento atualizado'; }
        else { const ev = await gcal.criarEvento(conta.id, { titulo: `📣 ${p.formato}: ${p.tema || (p.legenda || '').slice(0, 40)}`, inicio: a.data, fim: new Date(new Date(a.data).getTime() + 15 * 60000).toISOString().slice(0, 16), descricao: `Post #${p.id} · ${(p.legenda || '').slice(0, 300)}`, categoria: MARCADOR, lembreteMin: 60 }); db.prepare('UPDATE posts SET gcal_event_id=? WHERE id=?').run(ev.id, p.id); agenda = ev.link; }
      } catch (e) { agenda = `não entrou na agenda: ${e.message}`; }
      return { id: p.id, status: 'agendado', data: a.data, agenda, publica_sozinho: true };
    }
    case 'atualizar_post': {
      const p = db.prepare('SELECT * FROM posts WHERE id=? AND conta_id=?').get(a.post_id, conta.id);
      if (!p) throw new Error(`Post #${a.post_id} não existe.`);
      if (a.midias_urls?.length) { const m = []; for (const u of a.midias_urls) m.push(await garantirMarca(conta.id, u)); a.midias_urls = m; }
      if (a.midia_url) a.midia_url = await garantirMarca(conta.id, a.midia_url);
      if (a.legenda) a.legenda = limparTextoIA(a.legenda);
      if (a.hashtags) a.hashtags = hashtagsFinal(conta.id, a.hashtags);
      const campos = { legenda: a.legenda, hashtags: a.hashtags, tema: a.tema, pilar: a.pilar, formato: a.formato, midia_url: a.midias_urls?.length ? JSON.stringify(a.midias_urls) : a.midia_url };
      for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) db.prepare(`UPDATE posts SET ${k}=? WHERE id=?`).run(v, p.id);
      return { id: p.id, atualizado: Object.keys(campos).filter(k => campos[k] != null) };
    }
    case 'listar_calendario': {
      let q = 'SELECT id, formato, tema, data, status, midia_url IS NOT NULL AS tem_midia FROM posts WHERE conta_id=?'; const p = [conta.id];
      if (a.status) { q += ' AND status=?'; p.push(a.status); }
      if (a.inicio) { q += ' AND (data IS NULL OR data>=?)'; p.push(a.inicio); }
      if (a.fim) { q += ' AND (data IS NULL OR data<=?)'; p.push(a.fim); }
      return db.prepare(q + ' ORDER BY data IS NULL, data').all(...p);
    }
    case 'publicar': return publicarPost(conta.id, a.post_id);
    case 'ler_metricas': { if (!cred) throw new Error('Instagram não conectado. Diga "conectar instagram".'); return ig.metricas({ igUserId: cred.ig_user_id, token: cred.token, desde: Math.floor(Date.now() / 1000) - (a.dias || 30) * 86400 }); }
    default: throw new Error(`social.${nome}: não implementada`);
  }
}

/** REGRA DURA: nenhuma imagem vai para o Instagram sem o símbolo KM no canto padrão.
 *  URL já registrada como marcada (biblioteca.marcada_url ou pastas /marcadas|/stories|/carrossel|/frase do render) passa;
 *  qualquer outra é baixada, marcada e re-hospedada. Vídeo não passa por aqui (não há marca d'água em vídeo nesta etapa). */
export async function garantirMarca(contaId, url) {
  if (!url) return url;
  if (!kit.marcaDaguaAutomatica(contaId)) return url; // clientes: sem marca d'água automática (só quando pedirem, via aplicar_marca)
  if (ig.ehVideo(url)) {
    const ok = db.prepare('SELECT 1 FROM biblioteca WHERE conta_id=? AND marcada_url=? AND tipo=?').get(contaId, url, 'video');
    if (ok) return url;
    const bytes = Buffer.from(await fetch(url).then(r => { if (!r.ok) throw new Error(`não consegui baixar o vídeo (${r.status})`); return r.arrayBuffer(); }));
    if (bytes.byteLength > 200 * 1024 * 1024) throw new Error('vídeo acima de 200 MB — não consigo aplicar o logo KM; reduza o arquivo.');
    const r = await render.editarVideo(bytes, {}, { contaId }); // só o logo
    const v = await cdn.uploadVideo(r.bytes, { pasta: `assessor/${contaId}/videos` });
    db.prepare('INSERT INTO biblioteca (conta_id, url, marcada_url, tipo, origem, largura, altura, duracao) VALUES (?,?,?,?,?,?,?,?)').run(contaId, url, v.url, 'video', 'auto-logo', v.largura || null, v.altura || null, v.duracao || null);
    console.log(`[marca] logo KM aplicado no vídeo → ${r.info.logo}`);
    return v.url;
  }
  const conhecida = db.prepare('SELECT 1 FROM biblioteca WHERE conta_id=? AND marcada_url=?').get(contaId, url) || /\/(marcadas|stories|carrossel|frase|artes)\//.test(url);
  if (conhecida) return url;
  const bytes = Buffer.from(await fetch(url).then(r => { if (!r.ok) throw new Error(`não consegui baixar a imagem (${r.status})`); return r.arrayBuffer(); }));
  const r = await render.marcaDagua(bytes, { contaId });
  const nova = await cdn.upload(r.bytes, { pasta: `assessor/${contaId}/marcadas` });
  db.prepare('INSERT INTO biblioteca (conta_id, url, marcada_url, tipo, origem) VALUES (?,?,?,?,?)').run(contaId, url, nova, 'imagem', 'auto-marca');
  console.log(`[marca] aplicada automaticamente em ${url.slice(-40)} → logo ${r.info.logo}`);
  return nova;
}
async function garantirMarcaPost(contaId, p) {
  if (!p.midia_url) return p;
  let novo;
  if (p.midia_url.startsWith('[')) { const urls = JSON.parse(p.midia_url); const m = []; for (const u of urls) m.push(await garantirMarca(contaId, u)); novo = JSON.stringify(m); }
  else novo = await garantirMarca(contaId, p.midia_url);
  if (novo !== p.midia_url) { db.prepare('UPDATE posts SET midia_url=? WHERE id=?').run(novo, p.id); p.midia_url = novo; }
  return p;
}
export async function publicarPost(contaId, postId) {
  const cred = db.prepare('SELECT * FROM instagram_auth WHERE conta_id=?').get(contaId);
  if (!cred) throw new Error('Instagram não conectado. Diga "conectar instagram".');
  const p = db.prepare('SELECT * FROM posts WHERE id=? AND conta_id=?').get(postId, contaId);
  if (!p) throw new Error(`Post #${postId} não existe.`);
  if (!p.midia_url) throw new Error('Post sem mídia. Gere ou envie uma imagem/vídeo antes.');
  await garantirMarcaPost(contaId, p); // KM: logo em toda imagem antes de sair; clientes: só se ligaram a marca d'água automática
  const legenda = [p.legenda, p.hashtags].filter(Boolean).join('\n\n');
  let id;
  if (p.midia_url?.startsWith('[')) id = await ig.publicarCarrossel({ igUserId: cred.ig_user_id, token: cred.token, legenda, urls: JSON.parse(p.midia_url) });
  else id = await ig.publicar({ igUserId: cred.ig_user_id, token: cred.token, legenda, url: p.midia_url, tipo: p.formato === 'story' ? 'story' : p.formato === 'reels' ? 'reels' : 'imagem' });
  db.prepare("UPDATE posts SET status='publicado', ig_media_id=?, publicado_em=CURRENT_TIMESTAMP WHERE id=?").run(id, p.id);
  if (p.gcal_event_id) gcal.atualizarEvento(contaId, p.gcal_event_id, { titulo: `✅ ${p.formato}: ${p.tema || p.legenda.slice(0, 40)}` }).catch(() => {});
  return { ig_media_id: id, post_id: p.id };
}

/** Story pronto (URL já marcada) → post; publica agora ou agenda. Usado pelo modo edição. */
export async function criarStoryPost(contaId, { midia_url, tema, data, publicarAgora }) {
  const r = db.prepare('INSERT INTO posts (conta_id, formato, tema, data, legenda, midia_url, status) VALUES (?,?,?,?,?,?,?)').run(contaId, 'story', (tema || 'Story').slice(0, 80), data || null, '', midia_url, data ? 'agendado' : 'rascunho');
  const postId = r.lastInsertRowid;
  db.prepare("UPDATE biblioteca SET usado_em=CURRENT_TIMESTAMP WHERE conta_id=? AND marcada_url=?").run(contaId, midia_url);
  if (publicarAgora) { try { const p = await publicarPost(contaId, postId); return { post_id: postId, ...p }; } catch (e) { db.prepare("UPDATE posts SET status='erro' WHERE id=?").run(postId); return { post_id: postId, erro: e.message }; } }
  if (data) { try { const ev = await gcal.criarEvento(contaId, { titulo: `📣 story: ${(tema || 'Story').slice(0, 40)}`, inicio: data, fim: new Date(new Date(data).getTime() + 15 * 60000).toISOString().slice(0, 16), descricao: `Post #${postId}`, categoria: MARCADOR, lembreteMin: 60 }); db.prepare('UPDATE posts SET gcal_event_id=? WHERE id=?').run(ev.id, postId); } catch {} }
  return { post_id: postId, status: data ? 'agendado' : 'rascunho' };
}
export function listarBiblioteca(contaId, { tipo, max = 15 } = {}) {
  return db.prepare(`SELECT id, tipo, origem, descricao, url, marcada_url, duracao, largura, altura, usado_em, criado_em FROM biblioteca WHERE conta_id=? ${tipo ? 'AND tipo=?' : ''} ORDER BY id DESC LIMIT ?`).all(contaId, ...(tipo ? [tipo] : []), max)
    .map(b => ({ id: b.id, tipo: b.tipo, descricao: b.descricao, url: b.marcada_url || b.url, duracao: b.duracao, usada: !!b.usado_em, em: b.criado_em.slice(0, 16) }));
}
// Vídeo enviado pelo dono (Telegram ou Drive) → Cloudinary → URL pública para Reels/Story
export async function guardarVideoEnviado(contaId, bytes) {
  const v = await cdn.uploadVideo(bytes, { pasta: `assessor/${contaId}/videos` });
  db.prepare('INSERT INTO biblioteca (conta_id, url, tipo, origem, largura, altura, duracao) VALUES (?,?,?,?,?,?,?)').run(contaId, v.url, 'video', 'telegram', v.largura || null, v.altura || null, v.duracao || null);
  const prop = v.largura && v.altura ? (v.largura / v.altura).toFixed(2) : null;
  const avisos = [];
  if (v.duracao > 60) avisos.push('acima de 60 s: serve para Reels, não para Story');
  if (prop && Math.abs(prop - 0.5625) > 0.05) avisos.push(`proporção ${v.largura}x${v.altura} (ideal 9:16 = 1080x1920 para Reels/Story)`);
  if (v.bytes > 100 * 1024 * 1024) avisos.push('acima de 100 MB: o Instagram pode recusar');
  return { ...v, avisos };
}
// Upload de imagem enviada pelo dono no chat → URL pública (vira mídia do próximo post)
export async function guardarImagemEnviada(contaId, bytes, { tipo = 'imagem', marcar = null } = {}) {
  const aplicar = marcar ?? kit.marcaDaguaAutomatica(contaId);
  const [original, m] = await Promise.all([
    cdn.upload(bytes, { pasta: `assessor/${contaId}` }),
    !aplicar ? Promise.resolve({ marcada: null, info: { logo: 'não aplicada' } }) : render.marcaDagua(Buffer.from(bytes), { contaId }).then(async r => ({ marcada: await cdn.upload(r.bytes, { pasta: `assessor/${contaId}/marcadas` }), info: r.info })).catch(e => ({ marcada: null, info: { erro: e.message } })),
  ]);
  const id = db.prepare('INSERT INTO biblioteca (conta_id, url, marcada_url, tipo, origem) VALUES (?,?,?,?,?)').run(contaId, original, m.marcada || null, tipo, 'telegram').lastInsertRowid;
  return { id, original, aplicada: aplicar, ...m };
}
