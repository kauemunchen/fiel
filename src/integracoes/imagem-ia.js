// Imagem com IA no padrão do bot KM: escolha do provedor (FLUX/fal, Imagen/Gemini, OpenAI se houver chave),
// retoque por instrução ("mais contraste, fundo mais claro") e banner de produto (mantém o produto, troca o fundo).
import { contextoUso } from './gemini.js';
import { cobrar } from '../creditos/index.js';
import * as cdn from './cloudinary.js';
import { gerarImagemFal } from './instagram.js';

const GKEY = () => process.env.GEMINI_API_KEY;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cobra = (tipo) => { try { cobrar(contextoUso.contaId, tipo, { modulo: 'social' }); import('../custos.js').then(c => c.registrarUsoExtra(contextoUso.contaId, tipo, { modulo: 'social' })).catch(() => {}); } catch {} };

export function provedoresDisponiveis() {
  return [
    process.env.FAL_API_KEY && { id: 'fal', nome: 'FLUX (fal.ai)', formatos: ['1:1', '3:4', '4:5', '9:16', '16:9'] },
    GKEY() && { id: 'gemini', nome: 'Imagen (Google)', formatos: ['1:1', '3:4', '9:16', '16:9'] },
    process.env.OPENAI_API_KEY && { id: 'openai', nome: 'OpenAI (gpt-image)', formatos: ['1:1', '3:4', '16:9'] },
  ].filter(Boolean);
}

async function subir(bytes) { return cdn.upload(Buffer.from(bytes), { pasta: `assessor/${contextoUso.contaId || 'geral'}/ia` }); }

/** Gera imagem. provedor: fal | gemini | openai. ratio: 1:1 | 3:4 | 4:5 | 9:16 | 16:9. Devolve URL. */
export async function gerarImagem({ prompt, ratio = '4:5', provedor = 'fal' }) {
  const disp = provedoresDisponiveis().map(p => p.id);
  if (!disp.includes(provedor)) provedor = disp[0];
  if (!provedor) throw new Error('Nenhuma IA de imagem configurada.');
  if (provedor === 'fal') return gerarImagemFal(prompt, ratio); // FLUX schnell, igual ao bot KM
  if (provedor === 'gemini') {
    cobra('ia_imagem');
    const ar = { '4:5': '3:4' }[ratio] || ratio;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GKEY()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: ar } }),
    }).then(r => r.json());
    const b64 = r?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('Imagen não devolveu imagem: ' + (r?.error?.message || 'sem resultado'));
    return subir(Buffer.from(b64, 'base64'));
  }
  if (provedor === 'openai') {
    cobra('ia_imagem');
    const size = { '1:1': '1024x1024', '3:4': '1024x1536', '4:5': '1024x1536', '9:16': '1024x1536', '16:9': '1536x1024' }[ratio] || '1024x1024';
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 }),
    }).then(r => r.json());
    const b64 = r?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI não devolveu imagem: ' + (r?.error?.message || 'sem resultado'));
    return subir(Buffer.from(b64, 'base64'));
  }
}

/** Edita uma imagem existente por instrução. manterProduto=true → banner de produto (só troca o fundo). Devolve URL. */
export async function editarImagem({ url, instrucao, manterProduto = false }) {
  cobra('ia_edicao_imagem');
  const prompt = manterProduto
    ? `Keep the product EXACTLY as shown: same shape, label, brand, text and colors. Do NOT change the product. Only change the background and lighting. Scenario: ${instrucao}. Professional advertising photography. No extra text.`
    : `Edit this image: ${instrucao}. Keep the same composition, subject and any logo/text unless asked. High quality.`;
  const img = await fetch(url).then(r => { if (!r.ok) throw new Error('não consegui baixar a imagem'); return r.arrayBuffer(); });
  const mime = /\.png(\?|$)/i.test(url) ? 'image/png' : 'image/jpeg';
  // 1) Gemini (edição de imagem)
  if (GKEY()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_IMAGE_EDIT_MODEL || 'gemini-2.5-flash-image'}:generateContent?key=${GKEY()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: Buffer.from(img).toString('base64') } }, { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
      }).then(r => r.json());
      const parte = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
      const b64 = parte?.inlineData?.data || parte?.inline_data?.data;
      if (b64) return subir(Buffer.from(b64, 'base64'));
      console.error('[imagem-ia] gemini edição sem imagem:', r?.error?.message || JSON.stringify(r).slice(0, 200));
    } catch (e) { console.error('[imagem-ia] gemini edição', e.message); }
  }
  // 2) fal FLUX Kontext (fallback)
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
