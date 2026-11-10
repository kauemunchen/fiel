import fs from 'node:fs';
import path from 'node:path';
import { configPersona } from '../db/contas.js';
import { lerMemoria } from './memoria.js';
import { usaKM, resumoParaPrompt } from '../integracoes/marca-kit.js';

const base = (n) => fs.readFileSync(path.resolve(`src/personas/${n}.md`), 'utf8');
const conhecimento = (n) => { const p = path.resolve(`src/conhecimento/${n}.md`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const MAPA_CONHECIMENTO = { diretor: 'metodo-km', secretaria: 'secretariado', producao: 'agilfac-regras', documentos: 'taxonomia-docs', financeiro: 'plano-de-contas', social: 'estrategia-conteudo' };

/** Prompt final = base da persona + ajustes do dono + conhecimento + memória. Ferramentas e regras duras entram por código. */
// Conhecimento pesado só entra quando a mensagem precisa dele (gera conteúdo/analisa). Perguntas curtas, confirmações e escolhas numéricas não carregam.
const PRECISA_CONHECIMENTO = {
  social: /\b(legenda|carrossel|post|reels?|story|stories|frase|arte|hashtag|pilar|identidade|manual|marca|conte[úu]do|estrat[ée]gia|calend[áa]rio|s[ée]rie|cta|tema|ideia|planeja|cria|gera|monta|escreve|texto)\b/i,
  diretor: /\b(m[ée]todo|estrat[ée]gia|prioridade|an[áa]lise|decis|processo|indicador|meta|resultado|o que voc[êe] faria|conselho|plano)\b/i,
  financeiro: /\b(dre|plano de contas|categoria|classific|an[áa]lise|margem|resultado|relat[óo]rio)\b/i,
  documentos: /\b(tipo|pasta|classific|guarda|prazo|validade|cadastro|doss)/i,
  secretaria: /\b(e-?mail|redig|escreve|resposta|rascunho|resumo|prioriza)\b/i,
  producao: /./,
};
const CURTA = (t = '') => t.trim().length < 25 || /^(sim|n[ãa]o|ok|\d{1,2}|[a-e]|aprov|confirm|pode|cancela|essa|esse|isso|a primeira|a segunda|prefiro|troca|muda|agenda|publica|guarda|reels|story|foto|v[íi]deo|agora|hoje|amanh[ãa])\b/i.test(t.trim());

export function montarPrompt({ modulo, conta, ativos, texto: mensagem = '' }) {
  const cfg = configPersona(conta.id, modulo);
  const vars = {
    nome: cfg.nome, dono: conta.nome_dono, tratamento: cfg.tratamento, tom: cfg.tom, tamanho: cfg.tamanho,
    autonomia: cfg.autonomia, perfil_analise: cfg.perfil_analise, foco_mes: conta.foco_mes || 'nenhum',
    modulos_ativos: ativos.join(', '), carteiras: conta.carteiras || 'a definir',
    hora_resumo: cfg.hora_resumo, hora_fechamento: cfg.hora_fechamento, hora_semana: cfg.hora_semana,
    hora_retornos: cfg.hora_retornos, hora_checagem: cfg.hora_checagem, hora_checagem_1: '12h', hora_checagem_2: '17h',
    janela_silencio: conta.janela_silencio || '22h–6h e domingo', padrao_tarde: cfg.padrao_tarde || '14h',
    memoria: '(ver bloco MEMÓRIA no fim destas instruções)',
  };
  // MIA: a conta KM (admin) usa o manual KM; clientes usam a persona genérica + o kit de marca deles.
  const cliente = modulo === 'social' && !usaKM(conta.id);
  if (cliente) vars.marca_visual = resumoParaPrompt(conta.id) || '';
  let texto = base(cliente ? 'social-cliente' : modulo).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  const leve = modulo === 'social' && mensagem && !mensagem.startsWith('[') && (CURTA(mensagem) || !PRECISA_CONHECIMENTO.social.test(mensagem)); // redução só na MIA; os demais sempre com expertise completa
  let ref = leve || cliente ? '' : conhecimento(MAPA_CONHECIMENTO[modulo]); // estrategia-conteudo.md é o manual KM: não vale para clientes
  if (leve && !cliente) texto += '\n\n(Referência de expertise omitida nesta mensagem por ser curta/operacional; se precisar do manual para responder, diga ao dono para repetir o pedido com mais detalhe.)';
  if (ref) {
    // se o arquivo tiver um bloco "## Regras operacionais", usa só dali para baixo (resumo executável); senão corta em 7000 chars
    const i = ref.indexOf('## Regras operacionais'); if (i > 0) ref = ref.slice(i);
    if (ref.length > 7000) ref = ref.slice(0, 7000) + '\n[…]';
    texto += `\n\nREFERÊNCIA DE EXPERTISE\n${ref}`;
  }
  // Memória muda com frequência: fica no FIM para o início do prompt ser idêntico entre mensagens (cache implícito do Gemini = entrada mais barata).
  return texto + MARCA_MEMORIA + (lerMemoria(conta.id, modulo).map(m => `- ${m}`).join('\n') || '- (nada ainda)');
}
export const MARCA_MEMORIA = '\n\nMEMÓRIA (fatos que o dono já te contou):\n';
