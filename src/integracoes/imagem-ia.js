// Imagem com IA usando só as chaves que o Fiel já tem (Gemini + fal.ai):
//  • "fal"    → FLUX schnell (rápido e barato, igual ao bot KM) — padrão
//  • "gemini" → "Realista": modelo de imagem do Gemini (nano-banana / Flash Image), escolhido entre os que a chave tem ativos
// Retoque por instrução e banner de produto (mantém o produto, troca o fundo): Gemini Flash Image, com FLUX Kontext (fal) de reserva.
import { contextoUso, escolherModelo } from './gemini.js';
import { cobrar } from '../creditos/index.js';
import * as cdn from './cloudinary.js';
import { gerarImagemFal } from './instagram.js';

const GKEY = () => process.env.GEMINI_API_KEY;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Preferência de modelos de imagem do Gemini (o primeiro ativo na chave é usado; o Google desliga modelos antigos sem aviso)
const MODELOS_IMAGEM = (process.env.GEMINI_IMAGE_MODELS || 'gemini-nano-banana-2.1,gemini-3.1-flash-lite-image,gemini-3.1-flash-image,gemini-2.5-flash-image').split(',').map(s => s.trim()).filter(Boolean);
const cobra = (tipo) => { try { cobrar(contextoUso.contaId, tipo, { modulo: 'social' }); import('../custos.js').then(c => c.registrarUsoExtra(contextoUso.contaId, tipo, { modulo: 'social' })).catch(() => {}); } catch {} };

export function provedoresDisponiveis() {
  return [
    process.env.FAL_API_KEY && { id: 'fal', nome: 'FLUX (rápida)', formatos: ['1:1', '3:4', '4:5', '9:16', '16:9'] },
    GKEY() && { id: 'gemini', nome: 'Realista (Google)', formatos: ['1:1', '3:4', '4:5', '9:16', '16:9'] },
  ].filter(Boolean);
}

async function subir(bytes) { return cdn.upload(Buffer.from(bytes), { pasta: `assessor/${contextoUso.contaId || 'geral'}/ia` }); }

/** Chama o modelo de imagem do Gemini (gera ou edita). partes = [{text}|{inline_data}]. Devolve bytes ou null. */
async function geminiImagem(partes, ratio) {
  const tentados = [];
  for (const nome of [escolherModelo(MODELOS_IMAGEM), ...MODELOS_IMAGEM].filter((m, i, a) => a.indexOf(m) === i)) {
    tentados.push(nome);
    const cfg = { responseModalities: ['IMAGE'], ...(ratio ? { imageConfig: { aspectRatio: ratio } } : {}) };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${nome}:generateContent?key=${GKEY()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: cfg }),
    }).then(r => r.json()).catch(e => ({ error: { message: e.message } }));
    const parte = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
    const b64 = parte?.inlineData?.data || parte?.inline_data?.data;
    if (b64) return Buffer.from(b64, 'base64');
    const msg = r?.error?.message || 'sem imagem';
    console.error(`[imagem-ia] ${nome}: ${msg.slice(0, 160)}`);
    if (!/not found|not supported|unknown|deprecat|404|no longer/i.test(msg)) break; // erro do pedido (não do modelo): não adianta tentar outro
  }
  return null;
}

/** Gera imagem. provedor: fal (padrão) | gemini (realista). ratio: 1:1 | 3:4 | 4:5 | 9:16 | 16:9. Devolve URL. */
export async function gerarImagem({ prompt, ratio = '4:5', provedor = 'fal' }) {
  const disp = provedoresDisponiveis().map(p => p.id);
  if (!disp.includes(provedor)) provedor = disp[0];
  if (!provedor) throw new Error('Nenhuma IA de imagem configurada.');
  if (provedor === 'fal') return gerarImagemFal(prompt, ratio); // FLUX schnell, igual ao bot KM
  cobra('ia_imagem');
  const bytes = await geminiImagem([{ text: prompt }], ratio);
  if (bytes) return subir(bytes);
  // reserva: FLUX (não deixa o cliente sem a imagem)
  return gerarImagemFal(prompt, ratio);
}

/** Edita uma imagem existente por instrução. manterProduto=true → banner de produto (só troca o fundo). Devolve URL. */
export async function editarImagem({ url, instrucao, manterProduto = false }) {
  cobra('ia_edicao_imagem');
  const prompt = manterProduto
    ? `Keep the product EXACTLY as shown: same shape, label, brand, text and colors. Do NOT change the product. Only change the background and lighting. Scenario: ${instrucao}. Professional advertising photography. No extra text.`
    : `Edit this image: ${instrucao}. Keep the same composition, subject and any logo/text unless asked. High quality.`;
  const img = await fetch(url).then(r => { if (!r.ok) throw new Error('não consegui baixar a imagem'); return r.arrayBuffer(); });
  const mime = /\.png(\?|$)/i.test(url) ? 'image/png' : 'image/jpeg';
  if (GKEY()) {
    const bytes = await geminiImagem([{ inline_data: { mime_type: mime, data: Buffer.from(img).toString('base64') } }, { text: prompt }]).catch(() => null);
    if (bytes) return subir(bytes);
  }
  // reserva: FLUX Kontext (fal)
  if (process.env.FAL_API_KEY) {
    const modelo = 'fal-ai/flux-pro/kontext';
    const h = { 'Content-Type': 'application/json', Authorization: `Key ${process.env.FAL_API_KEY}` };
    let r = await fetch(`https://queue.fal.run/${modelo}`, { method: 'POST', headers: h, body: JSON.stringify({ prompt, image_url: url }) }).then(r => r.json());
    if (r.images) return r.images[0].url;
    for (let i = 0; i < 40 && r.request_id; i++) {
      await sleep(2500);
      const s = await fetch(`https://queue.fal.run/${modelo}/requests/${r.request_id}`, { headers: h }).then(r => r.json());
      if (s.images) return s.images[0].url;
      if (s.status === 'COMPLETED' && s.output?.images) return s.output.images[0].url;
      if (['FAILED', 'CANCELLED'].includes(s.status)) throw new Error(`fal: ${s.error || s.status}`);
    }
  }
  throw new Error('Não consegui editar a imagem agora (nenhuma IA de edição respondeu).');
}
