// Kit de marca por conta (multi-cliente): cores, assinatura (@), nome e logos.
// A conta admin (KM) sem kit próprio usa o padrão KM do serviço de render.
// Clientes: artes saem com as cores/logos deles; marca d'água automática em fotos fica DESLIGADA
// (só aplica quando o cliente pedir, com a logo dele).
import { db } from '../db/index.js';

db.exec(`CREATE TABLE IF NOT EXISTS marca_kit (conta_id INTEGER PRIMARY KEY, dados TEXT NOT NULL, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);

const HEX = /^#?[0-9a-f]{6}$/i;
export const POSICOES = ['inferior-direito', 'inferior-esquerdo', 'superior-direito', 'superior-esquerdo'];
const normHex = (v) => { const s = String(v || '').trim(); if (!HEX.test(s)) return null; return ('#' + s.replace('#', '')).toUpperCase(); };
const ehAdmin = (contaId) => db.prepare('SELECT admin FROM contas WHERE id=?').get(contaId)?.admin === 1;

export function lerKit(contaId) {
  const r = db.prepare('SELECT dados, atualizado_em FROM marca_kit WHERE conta_id=?').get(contaId);
  if (!r) return null;
  try { return { ...JSON.parse(r.dados), atualizado_em: r.atualizado_em }; } catch { return null; }
}

/** Mescla campos no kit. cores: {fundo, titulo, destaque, apoio} em hex. */
export function salvarKit(contaId, campos = {}) {
  const atual = lerKit(contaId) || { logos: {} };
  const novo = { ...atual };
  delete novo.atualizado_em;
  if (campos.nome !== undefined) novo.nome = String(campos.nome || '').slice(0, 80);
  if (campos.assinatura !== undefined) { const a = String(campos.assinatura || '').trim(); novo.assinatura = a && !a.startsWith('@') && !/\s/.test(a) ? '@' + a : a.slice(0, 60); }
  if (campos.cores) {
    novo.cores = { ...(atual.cores || {}) };
    for (const k of ['fundo', 'titulo', 'destaque', 'apoio']) if (campos.cores[k] !== undefined) { const h = normHex(campos.cores[k]); if (h) novo.cores[k] = h; else if (!campos.cores[k]) delete novo.cores[k]; }
  }
  if (campos.fontes !== undefined) novo.fontes = String(campos.fontes || '').slice(0, 120);
  if (campos.observacoes !== undefined) novo.observacoes = String(campos.observacoes || '').slice(0, 1500);
  if (campos.marca_dagua_auto !== undefined) novo.marca_dagua_auto = !!campos.marca_dagua_auto;
  if (campos.logo_posicao !== undefined && POSICOES.includes(campos.logo_posicao)) novo.logo_posicao = campos.logo_posicao;
  novo.logos = novo.logos || {};
  db.prepare('INSERT INTO marca_kit (conta_id, dados) VALUES (?,?) ON CONFLICT(conta_id) DO UPDATE SET dados=excluded.dados, atualizado_em=CURRENT_TIMESTAMP').run(contaId, JSON.stringify(novo));
  return lerKit(contaId);
}

/** variante: principal | claro (para fundo escuro) | escuro (para fundo claro).
 *  Se a variante já está ocupada, a nova fica guardada como extra (não substitui), a menos que substituir=true. */
export function salvarLogo(contaId, url, variante = 'principal', { substituir = false } = {}) {
  if (!/^https?:\/\//.test(String(url || ''))) throw new Error('URL da logo inválida');
  const v = ['principal', 'claro', 'escuro'].includes(variante) ? variante : 'principal';
  const kit = lerKit(contaId) || { logos: {} };
  const logos = { ...(kit.logos || {}) };
  let extras = (kit.logos_extras || []).filter(u => u !== url);
  let alvo = v;
  if (logos[v] && logos[v] !== url && !substituir) alvo = 'extra';
  if (alvo === 'extra') extras.push(url);
  else { if (logos[alvo] && logos[alvo] !== url) extras.push(logos[alvo]); logos[alvo] = url; }
  extras = extras.slice(-12);
  const novo = { ...kit, logos, logos_extras: extras }; delete novo.atualizado_em;
  db.prepare('INSERT INTO marca_kit (conta_id, dados) VALUES (?,?) ON CONFLICT(conta_id) DO UPDATE SET dados=excluded.dados, atualizado_em=CURRENT_TIMESTAMP').run(contaId, JSON.stringify(novo));
  return { variante: alvo, logos };
}
export function removerLogo(contaId, variante) {
  const kit = lerKit(contaId); if (!kit?.logos?.[variante]) return lerKit(contaId);
  const logos = { ...kit.logos }; delete logos[variante];
  const novo = { ...kit, logos }; delete novo.atualizado_em;
  db.prepare('UPDATE marca_kit SET dados=?, atualizado_em=CURRENT_TIMESTAMP WHERE conta_id=?').run(JSON.stringify(novo), contaId);
  return lerKit(contaId);
}

/** É a identidade KM? (conta admin sem kit próprio) */
export function usaKM(contaId) { return ehAdmin(contaId) && !lerKit(contaId)?.cores; }

/** Marca d'água automática em fotos enviadas: KM sim (regra antiga); clientes só se ligarem no kit E tiverem logo. */
export function marcaDaguaAutomatica(contaId) {
  if (usaKM(contaId)) return true;
  const k = lerKit(contaId); return !!(k?.marca_dagua_auto && temLogo(contaId));
}
/** Opção do cliente: logo SEMPRE nas imagens (fotos enviadas, geradas por IA, retocadas e banners). Precisa ter logo. */
export function logoEmImagens(contaId) { const k = lerKit(contaId); return !!(k?.marca_dagua_auto && temLogo(contaId)); }
export function posicaoLogo(contaId) { return lerKit(contaId)?.logo_posicao || 'inferior-direito'; }
export function temLogo(contaId) { if (usaKM(contaId)) return true; const l = lerKit(contaId)?.logos || {}; return !!(l.principal || l.claro || l.escuro); }

const cacheB64 = new Map();
async function b64(url) {
  if (!url) return null;
  if (cacheB64.has(url)) return cacheB64.get(url);
  const r = await fetch(url); if (!r.ok) throw new Error(`não consegui baixar a logo (${r.status})`);
  const s = Buffer.from(await r.arrayBuffer()).toString('base64');
  if (cacheB64.size > 200) cacheB64.clear();
  cacheB64.set(url, s); return s;
}

/** Objeto `marca` para o serviço de render. null = padrão KM. */
export async function marcaParaRender(contaId) {
  if (!contaId || usaKM(contaId)) return null;
  const k = lerKit(contaId) || {};
  const conta = db.prepare('SELECT empresa, nome_dono FROM contas WHERE id=?').get(contaId) || {};
  const logos = {};
  for (const v of ['principal', 'claro', 'escuro']) { try { if (k.logos?.[v]) logos[v] = await b64(k.logos[v]); } catch (e) { console.error('[marca] logo', v, e.message); } }
  return { km: false, nome: k.nome || conta.empresa || '', assinatura: k.assinatura || '', cores: k.cores || {}, logos };
}

/** Texto curto da identidade visual para o prompt da MIA. */
export function resumoParaPrompt(contaId) {
  if (usaKM(contaId)) return null;
  const k = lerKit(contaId);
  const conta = db.prepare('SELECT empresa FROM contas WHERE id=?').get(contaId) || {};
  if (!k) return `IDENTIDADE VISUAL: ainda NÃO cadastrada para ${conta.empresa || 'esta empresa'}. Antes de criar arte (carrossel, frase, story), peça ao dono: cores da marca (fundo e destaque, em hex se tiver), o @ do Instagram e as logos (versão clara e escura) — ou o manual da marca. Sem isso, a arte sai em cores neutras e sem logo.`;
  const l = k.logos || {};
  return `IDENTIDADE VISUAL DE ${(k.nome || conta.empresa || '').toUpperCase()} (cadastrada — use SEMPRE; nunca use a identidade KM):\n- Cores: fundo ${k.cores?.fundo || '(não definido)'} · título ${k.cores?.titulo || 'automático'} · destaque ${k.cores?.destaque || '(não definido)'} · apoio ${k.cores?.apoio || 'automático'}\n- Assinatura: ${k.assinatura || '(sem @)'}${k.fontes ? `\n- Fontes do manual: ${k.fontes} (o render usa Poppins)` : ''}\n- Logos: ${['principal', 'claro', 'escuro'].filter(v => l[v]).join(', ') || 'nenhuma ainda'}${k.observacoes ? `\n- Regras do manual: ${k.observacoes}` : ''}\n- Logo nas imagens: ${k.marca_dagua_auto ? `SEMPRE (o sistema aplica sozinho em fotos, imagens de IA, retoques e banners, canto ${k.logo_posicao || 'inferior-direito'}; se o dono pedir "sem logo" numa imagem, use sem_logo=true)` : 'só quando o dono pedir (aplicar_marca)'}`;
}
