// Instagram Graph API + fal.ai. Portado de telegram-instagram-bot/bot.py (publicar_ig, gerar_imagem_fal).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const ehVideo = (url = '') => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url) || /\/video\/upload\//.test(url);
/** Espera o container de mídia ficar pronto (vídeos levam de 10 s a alguns minutos). */
async function aguardarContainer(id, token, maxMs = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await fetch(`https://graph.instagram.com/${id}?fields=status_code,status&access_token=${token}`).then(r => r.json()).catch(() => ({}));
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram recusou a mídia: ${s.status || s.status_code}. Para vídeo: MP4 (H.264/AAC), 9:16 ou 4:5, até 100 MB para Story (≤60 s) e Reels (3 s a 15 min).`);
    await sleep(5000);
  }
  throw new Error('Instagram demorou demais para processar a mídia. Tente de novo em alguns minutos.');
}
export async function publicar({ igUserId, token, legenda, url, tipo = 'imagem' }) {
  const params = new URLSearchParams({ access_token: token });
  const video = ehVideo(url);
  if (tipo === 'story') { params.set('media_type', 'STORIES'); params.set(video ? 'video_url' : 'image_url', url); }
  else if (tipo === 'reels' || video) { params.set('media_type', 'REELS'); params.set('video_url', url); params.set('caption', legenda); params.set('share_to_feed', 'true'); }
  else { params.set('image_url', url); params.set('caption', legenda); }
  const c = await fetch(`https://graph.instagram.com/${igUserId}/media`, { method: 'POST', body: params }).then(r => r.json());
  if (!c.id) throw new Error(`Instagram: ${JSON.stringify(c)}`);
  await aguardarContainer(c.id, token, video ? 300000 : 60000);
  const p = await fetch(`https://graph.instagram.com/${igUserId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: c.id, access_token: token }) }).then(r => r.json());
  if (!p.id) throw new Error(`Instagram publish: ${JSON.stringify(p)}`);
  return p.id;
}

export async function publicarCarrossel({ igUserId, token, legenda, urls }) {
  const children = [];
  for (const url of urls) {
    const j = await fetch(`https://graph.instagram.com/${igUserId}/media`, { method: 'POST', body: new URLSearchParams({ image_url: url, is_carousel_item: 'true', access_token: token }) }).then(r => r.json());
    if (!j.id) throw new Error(`Instagram item: ${JSON.stringify(j)}`);
    children.push(j.id); await sleep(2000);
  }
  const c = await fetch(`https://graph.instagram.com/${igUserId}/media`, { method: 'POST', body: new URLSearchParams({ media_type: 'CAROUSEL', children: children.join(','), caption: legenda, access_token: token }) }).then(r => r.json());
  if (!c.id) throw new Error(`Instagram carrossel: ${JSON.stringify(c)}`);
  await sleep(5000);
  const p = await fetch(`https://graph.instagram.com/${igUserId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: c.id, access_token: token }) }).then(r => r.json());
  if (!p.id) throw new Error(`Instagram publish: ${JSON.stringify(p)}`);
  return p.id;
}

export async function metricas({ igUserId, token, desde }) {
  const u = `https://graph.instagram.com/${igUserId}/insights?metric=reach,accounts_engaged,profile_views,follower_count&period=day&since=${desde}&access_token=${token}`;
  return fetch(u).then(r => r.json());
}

const TAMANHOS = { '1:1': 'square_hd', '3:4': 'portrait_4_3', '9:16': 'portrait_16_9', '16:9': 'landscape_16_9', '4:3': 'landscape_4_3', '4:5': 'portrait_4_3' };
export async function gerarImagemFal(prompt, ratio = '3:4', modelo = 'fal-ai/flux/schnell') {
  try { const { contextoUso } = await import('./gemini.js'); const { cobrar } = await import('../creditos/index.js'); cobrar(contextoUso.contaId, 'fal_imagem', { modulo: 'social' }); (await import('../custos.js')).registrarUsoExtra(contextoUso.contaId, 'fal_imagem', { modulo: 'social' }); } catch {}
  const h = { 'Content-Type': 'application/json', Authorization: `Key ${process.env.FAL_API_KEY}` };
  let r = await fetch(`https://queue.fal.run/${modelo}`, { method: 'POST', headers: h, body: JSON.stringify({ prompt, image_size: TAMANHOS[ratio] || 'portrait_4_3', num_images: 1, enable_safety_checker: true, output_format: 'jpeg' }) }).then(r => r.json());
  if (r.images) return r.images[0].url;
  for (let i = 0; i < 30 && r.request_id; i++) {
    await sleep(2000);
    const s = await fetch(`https://queue.fal.run/${modelo}/requests/${r.request_id}`, { headers: h }).then(r => r.json());
    if (s.status === 'COMPLETED') return s.output.images[0].url;
    if (['FAILED', 'CANCELLED'].includes(s.status)) throw new Error(`fal: ${s.error || s.status}`);
  }
  throw new Error('fal: timeout');
}
