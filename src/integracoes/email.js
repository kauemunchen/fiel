// Envio de e-mail transacional do Fiel (redefinição de senha, avisos) via SMTP.
// Configure no .env do servidor:
//   SMTP_HOST=smtp.hostinger.com   SMTP_PORT=465   SMTP_USER=ola@usefiel.com   SMTP_PASS=***
//   SMTP_FROM="Fiel <ola@usefiel.com>"   (opcional; padrão = SMTP_USER)
import nodemailer from 'nodemailer';

let _tx = null;
export const emailConfigurado = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function transporte() {
  if (_tx) return _tx;
  const porta = Number(process.env.SMTP_PORT || 465);
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: porta, secure: porta === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _tx;
}

export async function enviarEmail({ para, assunto, texto, html }) {
  if (!emailConfigurado()) throw new Error('SMTP não configurado');
  const de = process.env.SMTP_FROM || `Fiel <${process.env.SMTP_USER}>`;
  return transporte().sendMail({ from: de, to: para, subject: assunto, text: texto, html });
}

/** Moldura visual padrão dos e-mails do Fiel (papel creme, tinta escura, coral). */
export function moldura({ titulo, corpoHtml, rodape = 'Fiel · Delegue. Fiel resolve. · usefiel.com' }) {
  return `<!doctype html><html><body style="margin:0;background:#FAF5EC;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#1C1E26">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#E85D4A;margin-bottom:24px">fiel</div>
    <div style="background:#fff;border:1px solid rgba(28,30,38,.12);border-radius:14px;padding:28px 24px">
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 14px">${titulo}</h1>
      ${corpoHtml}
    </div>
    <p style="font-size:12px;color:#7A7D87;margin-top:18px;text-align:center">${rodape}</p>
  </div></body></html>`;
}
