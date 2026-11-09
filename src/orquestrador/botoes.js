// Regra global: toda pergunta com opções fechadas vira botão inline. Vale para todos os assessores e para o sistema.
// Detecta no texto final: "(sim/não)", "Confirma?", listas numeradas 1️⃣/1) /1., "X ou Y?", opções conhecidas (Reels/Story, manter/retirar áudio…).
const SIM_NAO = [[{ t: '✅ Sim', d: 'sim' }, { t: '❌ Não', d: 'não' }]];
const corta = (s, n = 30) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const linhas = (arr, por = 2) => { const out = []; for (let i = 0; i < arr.length; i += por) out.push(arr.slice(i, i + por)); return out; };

export function inferirBotoes(texto = '') {
  const t = String(texto || ''); if (!t.trim()) return null;
  const fim = t.slice(-400);
  // 1) listas numeradas (1️⃣ Foto / 1) Foto / 1. Foto / 1 - Foto) — até 6 itens
  const itens = [...t.matchAll(/^\s*(?:(\d)[️⃣]*\s*[)\.\-:]?|(\d)[️⃣]+)\s*(.{2,60})$/gm)].map(m => ({ n: m[1] || m[2], label: m[3].trim().replace(/\s*\(.*?\)\s*$/, '') }));
  const unicos = itens.filter((x, i, a) => a.findIndex(y => y.n === x.n) === i).filter(x => !/\?$/.test(x.label)); // itens que são perguntas não são opções
  if (unicos.length >= 2 && unicos.length <= 6) {
    const b = unicos.map(x => ({ t: corta(`${x.n}. ${x.label}`), d: x.n }));
    return [...linhas(b, b.length > 3 ? 2 : 1), ...(/\bsim\b.*\bn[ãa]o\b/i.test(fim) ? SIM_NAO : [])];
  }
  // 1b) várias perguntas com opções conhecidas no mesmo texto → junta os pares
  const juntos = [];
  if (/\bmanter\b.*[áa]udio|\bretirar\b.*[áa]udio|\bmanter o som\b/i.test(t)) juntos.push([{ t: '🔊 Manter áudio', d: 'manter áudio' }, { t: '🔇 Retirar áudio', d: 'retirar áudio' }]);
  if (/\breels\b.*\bou\b.*\bstory\b|\bstory\b.*\bou\b.*\breels\b/i.test(t)) juntos.push([{ t: '🎞 Reels', d: 'reels' }, { t: '📣 Story', d: 'story' }]);
  if (/\bagora\b.*\bou\b.*\bagend/i.test(t)) juntos.push([{ t: '📣 Publicar agora', d: 'publicar agora' }, { t: '📅 Agendar', d: 'agendar' }]);
  if (juntos.length >= 2) return juntos;
  // 1c) etapas do fluxo de conteúdo (padrão do bot KM): aprovar / ajustar / refazer · publicar agora / agendar / cancelar
  if (/\baprov\w*\b[^?\n]{0,40}\bajust\w*\b[^?\n]{0,40}\b(refa\w*|outra|nova vers)/i.test(fim)) return [[{ t: '✅ Aprovar', d: 'aprovar' }, { t: '✏️ Ajustar', d: 'quero ajustar' }, { t: '🔄 Refazer', d: 'refazer' }]];
  if (/\bpublicar agora\b[^?\n]{0,40}\bagendar\b[^?\n]{0,40}\bcancel/i.test(fim)) return [[{ t: '📣 Publicar agora', d: 'publicar agora' }, { t: '📅 Agendar', d: 'agendar' }], [{ t: '❌ Cancelar', d: 'cancelar' }]];
  if (/\bagend\w*/i.test(fim) && /\bpublicar agora\b/i.test(fim) && /\bajust\w*/i.test(fim)) return [[{ t: '📅 Agendar como sugerido', d: 'aprovado, agenda no horário sugerido' }, { t: '📣 Publicar agora', d: 'publicar agora' }], [{ t: '✏️ Ajustar', d: 'quero ajustar' }]];
  if (/\bflux\b[^?\n]{0,30}\bimagen\b/i.test(fim)) return [[{ t: '⚡ FLUX', d: 'FLUX' }, { t: '📸 Imagen', d: 'Imagen' }]];
  // 2) sim/não explícito
  if (/\(sim\s*\/\s*n[ãa]o\)|\bconfirma(r)?\??\s*$|\bconfirma o envio\??|\bposso (enviar|publicar|cancelar|seguir)\??|\bquer que eu\b.*\?\s*$|\baprova\??\s*$|\bpode ser\??\s*$|\bt[áa] certo\??\s*$|\bok\??\s*$/im.test(fim)) return SIM_NAO;
  // 3) pares conhecidos
  const pares = [
    [/\breels\b.*\bou\b.*\bstory\b|\bstory\b.*\bou\b.*\breels\b/i, [[{ t: '🎞 Reels', d: 'reels' }, { t: '📣 Story', d: 'story' }]]],
    [/\bmanter\b.*[áa]udio.*\bou\b.*\bretirar\b|\bretirar\b.*[áa]udio|\bmanter o som\b/i, [[{ t: '🔊 Manter áudio', d: 'manter áudio' }, { t: '🔇 Retirar áudio', d: 'retirar áudio' }]]],
    [/\bpost\b.*\bou\b.*\bstory\b|\bfeed\b.*\bou\b.*\bstory\b/i, [[{ t: '🖼 Post (feed)', d: 'post' }, { t: '📣 Story', d: 'story' }]]],
    [/\bpublicar agora\b.*\bou\b.*\bagendar\b|\bagora ou agend/i, [[{ t: '📣 Publicar agora', d: 'publicar agora' }, { t: '📅 Agendar', d: 'agendar' }]]],
    [/\brascunho\b.*\bou\b.*\benviar\b|\benviar\b.*\bou\b.*\brascunho\b/i, [[{ t: '✉️ Enviar', d: 'enviar' }, { t: '📝 Rascunho', d: 'rascunho' }]]],
    [/\bmanh[ãa]\b.*\bou\b.*\btarde\b/i, [[{ t: '🌅 Manhã', d: 'manhã' }, { t: '🌇 Tarde', d: 'tarde' }]]],
  ];
  for (const [rx, b] of pares) if (rx.test(fim)) return b;
  // 4a) "(X ou Y)" entre parênteses
  const par = fim.match(/\(([^()]{1,24}?)\s+ou\s+([^()]{1,24}?)\)/);
  if (par) return [[{ t: corta(par[1].trim(), 24), d: par[1].trim().toLowerCase() }, { t: corta(par[2].trim(), 24), d: par[2].trim().toLowerCase() }]];
  // 4) "A ou B?" genérico no fim (palavras curtas)
  const m = fim.match(/\b([A-Za-zÀ-ÿ0-9][^?.!\n]{1,24}?)\s+ou\s+([A-Za-zÀ-ÿ0-9][^?.!\n]{1,24}?)\?\s*$/m);
  if (m) { const a = m[1].replace(/^(prefere|quer|é|será|vai ser|devo)\s+/i, '').trim(), b = m[2].trim(); if (a.length <= 24 && b.length <= 24) return [[{ t: corta(a, 24), d: a.toLowerCase() }, { t: corta(b, 24), d: b.toLowerCase() }]]; }
  return null;
}
/** Aplica botões a qualquer resposta (string ou objeto) que ainda não os tenha. */
export function comBotoes(resposta) {
  if (!resposta) return resposta;
  if (typeof resposta === 'string') { const b = inferirBotoes(resposta); return b ? { texto: resposta, botoes: b } : resposta; }
  if (!resposta.botoes) { const b = inferirBotoes(resposta.texto); if (b) resposta.botoes = b; }
  return resposta;
}
