// Leitura de extratos bancários e documentos financeiros.
// OFX e CSV são lidos localmente (sem custo de IA); PDF, imagem e CSV fora do padrão vão para a IA.
// Saída normalizada: { tipo, banco, saldo_final, lancamentos: [{ data:'YYYY-MM-DD', descricao, valor (negativo = saída), fitid? }], boleto?, comprovante? }

const num = (s) => {
  if (s == null) return NaN; let t = String(s).trim().replace(/[R$\s]/g, '');
  let neg = /^-|^\(.*\)$|[Dd]$/.test(t); t = t.replace(/[()DdCc+-]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const v = parseFloat(t); return isNaN(v) ? NaN : (neg ? -v : v);
};
const data = (s) => {
  const t = String(s || '').trim(); let m;
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};

export function lerOFX(texto) {
  const tag = (bloco, t) => (bloco.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim();
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0]);
  const lancamentos = blocos.map(b => ({ data: data(tag(b, 'DTPOSTED')), descricao: [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || 'sem descrição', valor: num(tag(b, 'TRNAMT')), fitid: tag(b, 'FITID') || null }))
    .filter(l => l.data && !isNaN(l.valor) && l.valor !== 0);
  const bal = texto.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)[\s\S]*?(?:<DTASOF>([^<\r\n]+))?/i);
  return { tipo: 'extrato', banco: tag(texto, 'ORG') || tag(texto, 'BANKID') || null, saldo_final: bal ? num(bal[1]) : null, saldo_data: bal?.[2] ? data(bal[2]) : null, lancamentos };
}

export function lerCSV(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) return null;
  const amostra = linhas.slice(0, 10).join('\n'); const sep = [';', '\t', ','].sort((a, b) => amostra.split(b).length - amostra.split(a).length)[0];
  const cel = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let hi = linhas.findIndex(l => { const c = cel(l).map(norm); return c.some(x => /^data|date|dt\b/.test(x)) && c.some(x => /valor|amount|debito|credito|entrada|saida/.test(x)); });
  if (hi < 0) return null;
  const h = cel(linhas[hi]).map(norm);
  const iData = h.findIndex(x => /^data|date|dt\b/.test(x));
  const iDesc = h.findIndex(x => /descri|historico|hist\b|lancamento|memo|estabelecimento|detalhe/.test(x));
  const iValor = h.findIndex(x => /^valor|amount|^vlr/.test(x));
  const iDeb = h.findIndex(x => /debito|saida/.test(x)), iCred = h.findIndex(x => /credito|entrada/.test(x));
  const iTipo = h.findIndex(x => /^tipo$|^d\/c$|natureza/.test(x));
  const lancamentos = [];
  for (const l of linhas.slice(hi + 1)) {
    const c = cel(l); const d = data(c[iData]); if (!d) continue;
    let v = iValor >= 0 ? num(c[iValor]) : NaN;
    if (isNaN(v) && (iDeb >= 0 || iCred >= 0)) { const deb = num(c[iDeb]), cr = num(c[iCred]); v = !isNaN(cr) && cr ? Math.abs(cr) : !isNaN(deb) && deb ? -Math.abs(deb) : NaN; }
    if (!isNaN(v) && iTipo >= 0 && /^d|deb|saida/i.test(c[iTipo] || '')) v = -Math.abs(v);
    if (isNaN(v) || v === 0) continue;
    const desc = (iDesc >= 0 ? c[iDesc] : c.filter((_, i) => ![iData, iValor, iDeb, iCred].includes(i)).join(' ')).trim();
    if (/^saldo|saldo anterior|saldo do dia|^s\.?a\.?l\.?d/i.test(desc)) continue;
    lancamentos.push({ data: d, descricao: desc || 'sem descrição', valor: v });
  }
  // Fatura de cartão no padrão Nubank/Inter (date,title,amount): compra vem POSITIVA → inverte para saída negativa.
  const fatura = h.includes('title') && h.includes('amount') || h.some(x => /fatura|estabelecimento|parcela/.test(x));
  if (fatura) lancamentos.forEach(l => { l.valor = -l.valor; });
  return lancamentos.length ? { tipo: fatura ? 'fatura' : 'extrato', banco: fatura && h.includes('title') ? 'Nubank (fatura)' : null, saldo_final: null, lancamentos } : null;
}

const INSTRUCAO = `Você recebeu um documento financeiro brasileiro. Classifique e extraia SOMENTE o que está escrito (nunca invente valores). Responda em JSON:
{"tipo":"extrato"|"fatura"|"boleto"|"comprovante"|"outro",   // conta a pagar sem ser boleto (fatura de serviço, cobrança com PIX) também é "boleto"
 "banco": string|null, "saldo_final": number|null, "saldo_data": "YYYY-MM-DD"|null,
 "lancamentos": [{"data":"YYYY-MM-DD","descricao":string,"valor":number}],   // extrato/fatura: cada linha; SAÍDA/compra/débito NEGATIVO, entrada/crédito positivo; ignore linhas de saldo
 "boleto": {"beneficiario":string,"valor":number,"vencimento":"YYYY-MM-DD","linha_digitavel":string|null,"codigo_barras":string|null,"pix_chave":string|null,"pix_copia_cola":string|null,"link_pagamento":string|null}|null,   // boleto OU qualquer conta/fatura/cobrança a pagar (luz, condomínio, nota com PIX); copie EXATAMENTE os dígitos/códigos; pix_copia_cola começa com 000201; link = URL do boleto/pagamento
 "comprovante": {"favorecido":string,"valor":number,"data":"YYYY-MM-DD","tipo":"pix"|"ted"|"boleto"|"cartao"|"outro"}|null,
 "legivel": boolean}
Fatura de cartão: as compras são saídas (negativas); pagamentos da fatura anterior e estornos, positivos.`;

/** Lê qualquer arquivo financeiro. bytes: Buffer; mime/nome ajudam a escolher o leitor. */
export async function lerDocumentoFinanceiro(bytes, mime = '', nome = '') {
  const ext = (nome.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const texto = () => { const b = Buffer.from(bytes); const u = b.toString('utf8'); return u.includes('�') ? b.toString('latin1') : u; };
  if (ext === 'ofx' || /ofx/i.test(mime) || /<OFX>|OFXHEADER/i.test(texto().slice(0, 600))) { const r = lerOFX(texto()); if (r.lancamentos.length) return { ...r, origem: 'ofx', legivel: true }; }
  if (ext === 'csv' || /csv|text\/plain/i.test(mime)) {
    const r = lerCSV(texto()); if (r) return { ...r, origem: 'csv', legivel: true };
    const { gerarJSON } = await import('./gemini.js');
    const j = await gerarJSON(`${INSTRUCAO}\n\nConteúdo do arquivo (${nome || 'csv'}):\n${texto().slice(0, 40000)}`);
    return { ...j, lancamentos: (j.lancamentos || []).map(l => ({ data: data(l.data), descricao: l.descricao, valor: Number(l.valor) })).filter(l => l.data && l.valor), origem: 'csv-ia' };
  }
  const { lerArquivoJSON } = await import('./gemini.js');
  const j = await lerArquivoJSON(bytes, mime || 'application/pdf', INSTRUCAO);
  return { ...j, lancamentos: (j.lancamentos || []).map(l => ({ data: data(l.data), descricao: l.descricao, valor: Number(l.valor) })).filter(l => l.data && l.valor), origem: 'ia' };
}
