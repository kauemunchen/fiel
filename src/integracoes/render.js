// Cliente do serviço de renderização (render/render_km.py — código fiel ao bot Instagram KM)
import { inflateRawSync } from 'node:zlib';
const BASE = process.env.RENDER_URL || 'http://render:5055';
async function post(path, body, json = true) {
  const r = await fetch(BASE + path, { method: 'POST', headers: json ? { 'content-type': 'application/json' } : {}, body: json ? JSON.stringify(body) : body });
  if (!r.ok) throw new Error(`render ${path}: ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}
export const paletas = () => fetch(BASE + '/paletas').then(r => r.json());
// Paletas do bot KM (escolha opcional; padrão = cores da marca da conta). 'personalizada' usa as cores informadas.
export const PALETAS = {
  preto: { nome: 'Preto Premium', fundo: '#000000', destaque: '#C8A96E', titulo: '#FFFFFF' },
  copa: { nome: 'Copa Brasil', fundo: '#1A3A1A', destaque: '#009C3B', titulo: '#FFFFFF' },
  azul: { nome: 'Azul Corporativo', fundo: '#1A2A4A', destaque: '#4A90D9', titulo: '#FFFFFF' },
  vinho: { nome: 'Vinho', fundo: '#3A1A1A', destaque: '#C8A96E', titulo: '#FFFFFF' },
};
/** Marca da conta com a paleta escolhida por cima (mantém logo e @). */
async function marcaComPaleta(contaId, paleta, cores) {
  const base = await marcaDe(contaId);
  const preset = PALETAS[paleta] || (paleta === 'personalizada' && cores?.fundo ? cores : null);
  if (!preset) return base;
  const { nome, ...c } = preset;
  return { ...(base || { km: true }), cores: { ...(base?.cores || {}), ...c } };
}
export async function frase(texto, { paleta = 'km', cores, autoria, template = 'manual', palavra_dourada, etiqueta, contaId } = {}) {
  const marca = await marcaComPaleta(contaId, paleta, cores);
  return post('/frase', { frase: texto, paleta, autoria: autoria ?? (marca ? undefined : '@kauemunchen'), template: marca ? 'manual' : template, palavra_dourada, etiqueta, marca });
}
export const letreiro = (gancho) => post('/letreiro', { gancho });
import { contextoUso } from './gemini.js';
import { cobrar } from '../creditos/index.js';
import { marcaParaRender } from './marca-kit.js';
/** Identidade da conta para o render (null = padrão KM). contaId explícito > conta da conversa atual. */
const marcaDe = (contaId) => marcaParaRender(contaId ?? contextoUso.contaId).catch(e => { console.error('[render] marca', e.message); return null; });
const cobra = (item, vezes = 1) => cobrar(contextoUso.contaId, item, { modulo: contextoUso.modulo || 'social', vezes });

export async function marcaDagua(bytes, { posicao = 'inferior-direito', proporcao = 0.14, assinatura = false, contaId } = {}) {
  const marca = await marcaDe(contaId);
  const url = `${BASE}/marca-dagua?posicao=${posicao}&proporcao=${proporcao}&assinatura=${assinatura ? 1 : 0}`;
  const r = marca ? await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imagem_b64: Buffer.from(bytes).toString('base64'), marca }) })
    : await fetch(url, { method: 'POST', body: bytes });
  if (!r.ok) throw new Error(`render /marca-dagua: ${r.status} ${await r.text()}`);
  let info = {}; try { info = JSON.parse(r.headers.get('x-marca-info') || '{}'); } catch {}
  return { bytes: Buffer.from(await r.arrayBuffer()), info };
}
export const comLogo = (bytes) => post('/logo', bytes, false);
/** Logo enviada pelo cliente: tem transparência? é clara ou escura? → sugestão de variante (claro = para fundo escuro). */
export async function analisarLogo(bytes) { const r = await fetch(BASE + '/logo/analisar', { method: 'POST', body: bytes }); if (!r.ok) throw new Error('analisar logo falhou'); return r.json(); }
export async function carrossel(dados, { paleta = 'km', cores, template = 'manual', contaId } = {}) {
  cobra('render_carrossel');
  const marca = await marcaComPaleta(contaId, paleta, cores);
  const zip = await post('/carrossel', { dados, paleta, template: marca ? 'manual' : template, marca });
  return extrairZip(zip);
}
// ZIP "stored"/deflate mínimo sem dependência
function extrairZip(buf) {
  const out = []; let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const metodo = buf.readUInt16LE(p + 8), csize = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
    const nome = buf.toString('utf8', p + 30, p + 30 + nlen); const ini = p + 30 + nlen + elen; const dados = buf.subarray(ini, ini + csize);
    out.push({ nome, bytes: metodo === 8 ? inflateRawSync(dados) : Buffer.from(dados) });
    p = ini + csize;
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome)).map(x => x.bytes);
}

/** Story 9:16 no padrão KM. dados = {modelo, ...}; foto/capa = Buffer opcional. Devolve {bytes, info}. */
export async function story(dados, { foto, capa, contaId } = {}) {
  cobra('render_story');
  const marca = await marcaDe(contaId);
  const fd = new FormData(); fd.append('json', JSON.stringify(dados)); if (marca) fd.append('marca', JSON.stringify(marca));
  if (foto) fd.append('foto', new Blob([foto]), 'foto.jpg');
  if (capa) fd.append('capa', new Blob([capa]), 'capa.jpg');
  const r = await fetch(BASE + '/story', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`render /story: ${r.status} ${await r.text()}`);
  let info = {}; try { info = JSON.parse(r.headers.get('x-marca-info') || '{}'); } catch {}
  return { bytes: Buffer.from(await r.arrayBuffer()), info };
}

/** Edição de vídeo (ffmpeg no render). ops: {enquadrar, cortar, letreiro, legendas}. Sempre sai com o logo KM. */
export async function editarVideo(bytes, ops, { contaId } = {}) {
  cobra('video_edicao');
  const marca = await marcaDe(contaId);
  const fd = new FormData(); fd.append('json', JSON.stringify(ops)); fd.append('video', new Blob([bytes]), 'in.mp4'); if (marca) fd.append('marca', JSON.stringify(marca));
  const r = await fetch(BASE + '/video/editar', { method: 'POST', body: fd });
  if (!r.ok) { let e = ''; try { e = (await r.json()).erro; } catch { e = await r.text(); } throw new Error(`edição de vídeo: ${String(e).slice(0, 300)}`); }
  let info = {}; try { info = JSON.parse(r.headers.get('x-video-info') || '{}'); } catch {}
  return { bytes: Buffer.from(await r.arrayBuffer()), info };
}
export async function infoVideo(bytes) { const r = await fetch(BASE + '/video/info', { method: 'POST', body: bytes }); if (!r.ok) throw new Error('info do vídeo falhou'); return r.json(); }
export async function audioDoVideo(bytes) { cobra('video_audio'); return post('/video/audio', bytes, false); }
