// Leitura do manual da marca (PDF ou imagem) pela MIA: extrai nome, @, cores em HEX, fontes e regras
// com o Gemini (visão/PDF) e grava no kit de marca da conta. Usado no envio direto e pela ferramenta ler_manual_marca.
import { lerArquivoJSON } from './gemini.js';
import * as kit from './marca-kit.js';

// legenda ou nome de arquivo que indica manual/identidade da marca
export const MANUAL_RX = /\b(manual(?:\s+d[ae])?\s*(?:marca|identidade)?|brand\s*book|brandbook|brand\s*guide|guia\s+d[ae]\s+marca|identidade\s+visual|paleta(?:\s+de\s+cores)?|cores\s+da\s+marca|kit\s+de\s+marca)\b/i;
export const ehManual = ({ legenda = '', nome = '', mime = '' } = {}) => {
  const t = `${legenda} ${String(nome).replace(/[_\-.]+/g, ' ')}`;
  if (!/^(application\/pdf|image\/(png|jpe?g|webp))/i.test(mime)) return false;
  if (/^image\//i.test(mime)) return /\b(manual|brand\s*book|brandbook|brand\s*guide|guia\s+d[ae]\s+marca|paleta|cores\s+da\s+marca)\b/i.test(t);
  return MANUAL_RX.test(t);
};

const INSTRUCAO = `Você recebeu o MANUAL DE MARCA (ou uma página dele) de uma empresa. Leia todo o conteúdo: textos, tabelas de cores, amostras de cor e tipografia.
Devolva SÓ este JSON:
{"legivel": true|false,
 "nome": "nome da marca ou empresa",
 "assinatura": "@ do Instagram se aparecer, senão vazio",
 "cores_encontradas": [{"nome": "nome da cor no manual (ex.: Azul Valora)", "hex": "#RRGGBB", "uso": "principal | secundária | destaque | fundo | texto | apoio"}],
 "cores": {"fundo": "#RRGGBB cor principal/escura da marca", "titulo": "#RRGGBB cor do texto sobre o fundo (geralmente branco ou claro)", "destaque": "#RRGGBB cor de acento", "apoio": "#RRGGBB cor secundária"},
 "fontes": "fontes do manual (títulos / textos)",
 "regras": ["até 5 regras curtas de uso da marca (área de proteção, usos proibidos, tom de voz)"],
 "resumo": "uma frase dizendo o que o manual contém"}
Regras: HEX sempre com # e 6 dígitos. Se o manual traz só CMYK ou RGB, converta para HEX. Se uma cor não está no manual, deixe "" (nunca invente). Se não conseguir ler, "legivel": false.`;

const HEX = /^#[0-9a-f]{6}$/i;

/** Lê o manual (bytes + mime) e, se salvar=true, grava no kit. Devolve o que leu e o que foi salvo. */
export async function lerManual(contaId, bytes, mime, { salvar = true } = {}) {
  if (!bytes?.length) throw new Error('arquivo vazio');
  if (bytes.length > 19 * 1048576) throw new Error('o manual tem mais de 19 MB — mande só as páginas de cores e tipografia (ou prints delas)');
  const j = await lerArquivoJSON(Buffer.from(bytes), mime, INSTRUCAO);
  const cores = {};
  for (const k of ['fundo', 'titulo', 'destaque', 'apoio']) if (HEX.test(String(j?.cores?.[k] || '').trim())) cores[k] = j.cores[k].trim().toUpperCase();
  const encontradas = (Array.isArray(j?.cores_encontradas) ? j.cores_encontradas : []).filter(c => HEX.test(String(c?.hex || '').trim())).slice(0, 12).map(c => ({ nome: String(c.nome || '').slice(0, 40), hex: c.hex.trim().toUpperCase(), uso: String(c.uso || '').slice(0, 30) }));
  // sem papel definido: usa as duas primeiras cores do manual
  if (!cores.fundo && encontradas[0]) cores.fundo = encontradas[0].hex;
  if (!cores.destaque && encontradas[1]) cores.destaque = encontradas[1].hex;
  const regras = (Array.isArray(j?.regras) ? j.regras : []).map(r => String(r).trim()).filter(Boolean).slice(0, 5);
  const lido = { legivel: j?.legivel !== false && (encontradas.length > 0 || Object.keys(cores).length > 0 || !!j?.fontes), nome: String(j?.nome || '').trim(), assinatura: String(j?.assinatura || '').trim(), cores, cores_encontradas: encontradas, fontes: String(j?.fontes || '').trim(), regras, resumo: String(j?.resumo || '').trim() };
  if (!salvar || !lido.legivel) return { ...lido, salvo: false };
  const atual = kit.lerKit(contaId) || {};
  const campos = { cores };
  if (lido.nome && !atual.nome) campos.nome = lido.nome;
  if (lido.assinatura && !atual.assinatura) campos.assinatura = lido.assinatura;
  if (lido.fontes) campos.fontes = lido.fontes;
  const obs = [regras.join(' · '), encontradas.length ? 'Paleta do manual: ' + encontradas.map(c => `${c.nome || c.uso} ${c.hex}`).join(', ') : ''].filter(Boolean).join('\n');
  if (obs) campos.observacoes = obs;
  const k = kit.salvarKit(contaId, campos);
  return { ...lido, salvo: true, kit: { nome: k.nome, assinatura: k.assinatura, cores: k.cores, fontes: k.fontes, logos: Object.keys(k.logos || {}).filter(v => k.logos[v]) } };
}

/** Texto de contexto para a MIA confirmar ao dono. */
export function contextoParaMIA(r, nomeArquivo = '') {
  if (!r.legivel) return `[O dono enviou o manual da marca${nomeArquivo ? ` (${nomeArquivo})` : ''}, mas NÃO consegui extrair cores nem fontes (arquivo escaneado em baixa qualidade, só imagens ou protegido). Diga isso com honestidade em 2 linhas e peça: um print da página de cores (com os códigos) ou os HEX digitados. Não invente cores.]`;
  const falta = [];
  if (!r.kit?.logos?.length) falta.push('as logos (versão clara e escura, como imagem com a legenda "logo")');
  if (!r.kit?.assinatura) falta.push('o @ do Instagram');
  return `[Manual da marca LIDO e salvo no kit de marca${nomeArquivo ? ` (${nomeArquivo})` : ''}. ${r.resumo ? 'Conteúdo: ' + r.resumo + '. ' : ''}Cores salvas: ${Object.entries(r.kit?.cores || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}. Paleta do manual: ${r.cores_encontradas.map(c => `${c.nome || c.uso} ${c.hex}`).join(', ') || '—'}. Fontes: ${r.fontes || 'não identificadas'}. Regras: ${r.regras.join(' · ') || '—'}. Confirme ao dono em até 6 linhas o que leu e salvou (cores com HEX, fontes, 1–2 regras), pergunte se as cores de fundo e destaque estão certas${falta.length ? ` e peça ${falta.join(' e ')}` : ''}. NÃO crie post, legenda nem arte.]`;
}
