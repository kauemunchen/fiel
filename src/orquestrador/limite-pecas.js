// Proteção de consumo: cada mensagem do dono gera no máximo 1 peça visual e 1 rascunho de post,
// a menos que ele tenha pedido uma quantidade ("faz 3 posts") ou aprovado o lote depois da pergunta.
// Peças extras viram uma pergunta com o custo estimado — nunca geração em série por conta própria.
import { TARIFAS, tarifa } from '../creditos/index.js';

// créditos aproximados por peça (render/fal; os tokens de IA da escrita somam ~1–2 créditos)
// getters: o custo das imagens acompanha a tarifa dinâmica (preço do provedor + margem)
export const CUSTO_PECA = {
  get gerar_carrossel() { return TARIFAS.render_carrossel + 2; },
  get gerar_frase() { return TARIFAS.render_imagem + 1; },
  get gerar_midia() { return `${tarifa('fal_imagem')} (FLUX) a ${tarifa('ia_imagem')} (realista)`; },
  get aplicar_marca() { return TARIFAS.render_imagem; },
  get remover_audio() { return TARIFAS.video_audio + TARIFAS.video_edicao; },
  get editar_imagem() { return tarifa('ia_edicao_imagem'); },
  get banner_produto() { return tarifa('ia_edicao_imagem'); },
};
const NOME = { editar_imagem: 'retoque de imagem', banner_produto: 'banner de produto', gerar_carrossel: 'carrossel', gerar_frase: 'arte de frase', gerar_midia: 'imagem com IA', aplicar_marca: 'marca d\'água', remover_audio: 'vídeo sem áudio' };
const RASCUNHO = new Set(['criar_post']);

const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const QTD_RX = /\b(\d{1,2}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:novos?\s+|novas?\s+)?(posts?|artes?|carross[eé]is|carrosseis|carrossel|imagens?|frases?|stories|storys?|pe[çc]as?|varia[çc][õo]es|vers[õo]es|op[çc][õo]es|rascunhos?)\b/i;
const SIM_RX = /^[✅👍\s]*(sim|s|ok|pode|pode sim|pode gerar|gera|gere|faz|fa[çc]a|manda|bora|confirmo|aprovado|isso|todas?|todos)\b/i;

const aprovacoes = new Map(); // contaId → expira (ms): houve pergunta de lote e o dono pode aprovar com "sim"

/** Quantas peças esta mensagem autoriza. */
export function cotaDaMensagem(contaId, texto = '') {
  const t = String(texto || '').trim();
  const m = t.match(QTD_RX);
  let cota = 1;
  if (m) { const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()] || 1; cota = Math.min(10, Math.max(1, n)); }
  const exp = aprovacoes.get(contaId);
  if (exp && exp > Date.now() && SIM_RX.test(t)) { cota = Math.max(cota, 10); aprovacoes.delete(contaId); }
  return cota;
}

/** Contador de uma mensagem. checar(nome) → null (pode) ou {erro} para devolver ao modelo. */
export function novoContador(contaId, texto) {
  const cota = cotaDaMensagem(contaId, texto);
  let pecas = 0, rascunhos = 0;
  return {
    cota,
    checar(nome) {
      if (CUSTO_PECA[nome] !== undefined) {
        if (pecas >= cota) { aprovacoes.set(contaId, Date.now() + 30 * 60000); return { erro: `LIMITE DE PEÇAS: esta mensagem do dono autoriza ${cota} peça(s) e você já gerou ${pecas}. NÃO gere mais agora. Mostre o que já foi feito e, se fizer sentido mais peças, PERGUNTE ao dono quantas quer, dizendo o custo estimado: ${NOME[nome]} ≈ ${CUSTO_PECA[nome]} créditos cada. Só gere depois do "sim".` }; }
        pecas++; return null;
      }
      if (RASCUNHO.has(nome)) {
        if (rascunhos >= cota) { aprovacoes.set(contaId, Date.now() + 30 * 60000); return { erro: `LIMITE DE RASCUNHOS: esta mensagem autoriza ${cota} rascunho(s) de post e você já salvou ${rascunhos}. Não crie mais; pergunte ao dono se ele quer outros.` }; }
        rascunhos++; return null;
      }
      return null;
    },
  };
}
