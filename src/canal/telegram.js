// Adaptador Telegram Bot API (webhook). Reaproveitar lógica do bot de agenda existente.
const API = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
export class TelegramCanal {
  constructor(app) { this.app = app; this.token = process.env.TELEGRAM_BOT_TOKEN; }
  aoReceber(fn) {
    this.app.post('/webhook/telegram', async (req, res) => {
      res.sendStatus(200);
      // Botão inline tocado → vira mensagem de texto do dono (mesmo fluxo), e o botão some da mensagem original
      const cq = req.body.callback_query;
      if (cq) {
        fetch(`${API}/bot${this.token}/answerCallbackQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback_query_id: cq.id }) }).catch(() => {});
        if (cq.message) fetch(`${API}/bot${this.token}/editMessageReplyMarkup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }) }).catch(() => {});
        const texto = String(cq.data || '');
        console.log(`[telegram] ${cq.message?.chat?.id} botão: ${texto}`);
        await fn({ conta: null, chatId: String(cq.message?.chat?.id || cq.from.id), remetente: String(cq.from.id), tipo: 'texto', texto, midia: null, recebidoEm: new Date(), botao: true });
        return;
      }
      const m = req.body.message; if (!m) return;
      const vid = m.video || m.video_note || m.animation || (m.document && /^video\//.test(m.document.mime_type || '') ? m.document : null);
      console.log(`[telegram] ${m.chat.id} ${m.voice ? 'voice' : m.audio ? 'audio' : vid ? 'video' : m.photo ? 'photo' : m.document ? 'doc' : 'text'}`);
      await fn({
        conta: null, chatId: String(m.chat.id), remetente: String(m.from.id),
        tipo: (m.voice || m.audio) ? 'audio' : vid ? 'video' : m.photo ? 'imagem' : m.document ? 'arquivo' : 'texto',
        texto: m.text || m.caption || '',
        grupo: m.media_group_id || null,
        midia: vid ? { ref: vid.file_id, mime: vid.mime_type || 'video/mp4', nome: vid.file_name, tamanho: vid.file_size, duracao: vid.duration }
             : m.voice ? { ref: m.voice.file_id, mime: 'audio/ogg' }
             : m.audio ? { ref: m.audio.file_id, mime: m.audio.mime_type || 'audio/mpeg' }
             : m.photo ? { ref: m.photo.at(-1).file_id, mime: 'image/jpeg', tamanho: m.photo.at(-1).file_size }
             : m.document ? { ref: m.document.file_id, mime: m.document.mime_type, nome: m.document.file_name, tamanho: m.document.file_size } : null,
        recebidoEm: new Date(m.date * 1000),
      });
    });
  }
  async enviar(_conta, chatId, resposta) {
    if (resposta && typeof resposta === 'object' && resposta.fotos) {
      const media = resposta.fotos.slice(0, 10).map((u, i) => ({ type: 'photo', media: u, caption: i === 0 ? semMarkdown(resposta.texto || '').slice(0, 1000) : undefined }));
      const r = await fetch(`${API}/bot${this.token}/sendMediaGroup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, media }) }).then(r => r.json());
      if (!r.ok) console.error('[telegram] sendMediaGroup falhou:', r.description);
      return;
    }
    if (resposta && typeof resposta === 'object' && resposta.video) {
      const r = await fetch(`${API}/bot${this.token}/sendVideo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, video: resposta.video, caption: semMarkdown(resposta.texto || '').slice(0, 1000), supports_streaming: true, reply_markup: teclado(resposta.botoes) }) }).then(r => r.json());
      if (!r.ok) { console.error('[telegram] sendVideo falhou:', r.description); await this._post({ chat_id: chatId, text: semMarkdown((resposta.texto || '') + '\n' + resposta.video) }); }
      return;
    }
    if (resposta && typeof resposta === 'object' && resposta.foto && String(resposta.foto).startsWith('data:')) { // imagem embutida (ex.: QR Pix) → upload multipart
      const b64 = String(resposta.foto).split(',')[1] || ''; const fd = new FormData(); fd.append('chat_id', String(chatId)); fd.append('photo', new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }), 'qr.png'); fd.append('caption', semMarkdown(resposta.texto || '').slice(0, 1000));
      const r = await fetch(`${API}/bot${this.token}/sendPhoto`, { method: 'POST', body: fd }).then(r => r.json());
      if (!r.ok) { console.error('[telegram] sendPhoto(data) falhou:', r.description); await this._post({ chat_id: chatId, text: semMarkdown(resposta.texto || '') }); }
      return;
    }
    if (resposta && typeof resposta === 'object' && resposta.foto) {
      const r = await fetch(`${API}/bot${this.token}/sendPhoto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, photo: resposta.foto, caption: semMarkdown(resposta.texto || '').slice(0, 1000), reply_markup: teclado(resposta.botoes) }) }).then(r => r.json());
      if (!r.ok) console.error('[telegram] sendPhoto falhou:', r.description);
      return;
    }
    const texto = typeof resposta === 'string' ? resposta : resposta.texto;
    const base = { chat_id: chatId, reply_markup: teclado(resposta?.botoes) };
    const html = paraHTML(texto);
    let r = await this._post({ ...base, text: html, parse_mode: 'HTML' });
    if (!r.ok) r = await this._post({ ...base, text: semMarkdown(texto) });
    if (!r.ok) console.error('[telegram] sendMessage falhou:', r.description);
    return r;
  }
  async digitando(chatId) { fetch(`${API}/bot${this.token}/sendChatAction`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, action: 'typing' }) }).catch(() => {}); }
  // Envio com nova tentativa: falha de rede ou 429 (Telegram pedindo para esperar) não pode perder a mensagem.
  async _post(body, tentativas = 3) {
    let ultimo = { ok: false, description: 'sem resposta' };
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetch(`${API}/bot${this.token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).then(x => x.json());
        if (r.ok || (r.error_code && r.error_code !== 429 && r.error_code < 500)) return r; // ok, ou erro definitivo (ex.: HTML inválido) → quem chamou decide
        ultimo = r; await new Promise(res => setTimeout(res, ((r.parameters?.retry_after || 2) * 1000)));
      } catch (e) { ultimo = { ok: false, description: e.message }; console.warn(`[telegram] envio falhou (tentativa ${i + 1}):`, e.message); await new Promise(res => setTimeout(res, 2000 * (i + 1))); }
    }
    return ultimo;
  }
  async baixarMidia(ref) {
    const r = await fetch(`${API}/bot${this.token}/getFile?file_id=${ref}`).then(r => r.json());
    if (!r.ok) throw new Error(/too big/i.test(r.description || '') ? 'arquivo acima de 20 MB' : r.description || 'getFile falhou');
    const fp = r.result.file_path;
    // Bot API local em modo --local devolve caminho absoluto no disco (volume compartilhado)
    if (fp.startsWith('/')) { const fs = await import('node:fs/promises'); return (await fs.readFile(fp)).buffer; }
    return fetch(`${API}/file/bot${this.token}/${fp}`).then(r => r.arrayBuffer());
  }
}

/** botoes: [[{t:'Publicar', d:'story 1'}, …], …] ou já um reply_markup pronto. callback_data ≤ 64 bytes. */
function teclado(b) {
  if (!b) return undefined; if (b.inline_keyboard || b.keyboard) return b;
  return { inline_keyboard: b.map(linha => linha.map(x => x.url ? { text: x.t, url: x.url } : x.copiar ? { text: x.t, copy_text: { text: String(x.copiar).slice(0, 256) } } : ({ text: x.t, callback_data: String(x.d ?? x.t).slice(0, 64) }))) };
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function paraHTML(t) {
  let s = esc(t);
  s = s.replace(/^\s*#{1,6}\s+(.+)$/gm, '<b>$1</b>');        // títulos (# seguido de espaço) -> negrito; #hashtag fica
  s = s.replace(/^\s*[-*_]{3,}\s*$/gm, '');                   // separadores fora
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');              // **x** -> <b>
  s = s.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<b>$2</b>'); // *x* -> <b>
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/^\s*[*•]\s+/gm, '- ');                       // bullets uniformes
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
function semMarkdown(t) {
  return t.replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*[-*_]{3,}\s*$/gm, '').replace(/\*\*|__|`/g, '').replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2').replace(/^\s*[*•]\s+/gm, '- ').replace(/\n{3,}/g, '\n\n').trim();
}
