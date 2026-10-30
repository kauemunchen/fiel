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

const BASE = () => (process.env.WEBAPP_URL || process.env.PUBLIC_URL || 'https://usefiel.com').replace(/\/$/, '').replace(/\/app$/, '');
const TELEGRAM = () => process.env.TELEGRAM_BOT_LINK || 'https://t.me/AssessorKM_bot';
// Identidade (mesma da landing): papel creme, tinta azul-noite, coral; Fraunces nos títulos, Inter no texto.
const C = { papel: '#FAF5EC', papel2: '#F3EBDA', tinta: '#17152B', tintaMid: '#4A4D59', mudo: '#7A7D87', coral: '#E85D4A', noite: '#17152B', noiteTexto: '#E4DFF2', noiteMudo: '#B9B2D4', linha: '#E8E0CF' };
const SERIF = "Fraunces,Georgia,'Times New Roman',serif"; const SANS = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/** Botão "à prova de e-mail" (tabela), coral, cantos arredondados como no site. */
export function botaoEmail(texto, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr><td align="center" bgcolor="${C.coral}" style="border-radius:999px"><a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${texto}</a></td></tr></table>`;
}

/** Moldura padrão de todo e-mail do Fiel: logo no topo, cartão branco, rodapé azul-noite igual ao da landing.
 *  nota = linha final do rodapé (ex.: motivo do envio + descadastro). preheader = prévia que aparece na caixa de entrada. */
export function moldura({ titulo, corpoHtml, rodape, nota, botao, preheader = '' }) {
  const b = BASE(); const linhaNota = nota ?? rodape ?? 'Você recebeu este e-mail porque tem uma conta no Fiel.';
  const link = (href, txt) => `<a href="${href}" target="_blank" style="color:${C.noiteTexto};text-decoration:none">${txt}</a>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${titulo || 'Fiel'}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${C.papel};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.papel}">${preheader}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.papel}" style="background:${C.papel}"><tr><td align="center" style="padding:32px 16px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td style="padding:0 4px 22px"><a href="${b}" target="_blank"><img src="${b}/app/email/fiel.png" width="120" height="45" alt="Fiel" style="display:block;border:0;width:120px;height:auto"></a></td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${C.linha};border-radius:16px;padding:32px 28px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.tinta}">
      ${titulo ? `<h1 style="margin:0 0 16px;font-family:${SERIF};font-weight:700;font-size:26px;line-height:1.2;letter-spacing:-.01em;color:${C.tinta}">${titulo}</h1>` : ''}
      ${corpoHtml}
      ${botao?.texto && botao?.url ? botaoEmail(botao.texto, botao.url) : ''}
    </td></tr>
    <tr><td style="padding:18px 4px 28px;font-family:${SERIF};font-size:15px;color:${C.tintaMid}">Delegue. <b style="color:${C.coral}">Fiel</b> resolve.</td></tr>
  </table>
</td></tr>
<tr><td bgcolor="${C.noite}" style="background:${C.noite};padding:28px 16px" align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td style="padding:0 4px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle"><a href="${b}" target="_blank"><img src="${b}/app/email/fiel-branco.png" width="84" height="32" alt="Fiel" style="display:block;border:0;width:84px;height:auto"></a></td>
        <td valign="middle" style="padding:0 14px"><div style="width:1px;height:28px;background:#3A3658"></div></td>
        <td valign="middle"><a href="https://kauemunchen.com.br" target="_blank"><img src="${b}/app/email/km-branco.png" width="40" height="28" alt="KM" style="display:block;border:0;width:40px;height:auto"></a></td>
        <td valign="middle" style="padding-left:8px;font-family:${SANS};font-size:11px;line-height:1.3;color:${C.noiteMudo}">um produto<br><b style="color:${C.papel};font-weight:600">kauemunchen.com.br</b></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 4px 16px;font-family:${SANS};font-size:13px;color:${C.noiteTexto}">${link(`${b}/app/`, 'Entrar no app')} &nbsp;·&nbsp; ${link(TELEGRAM(), 'Telegram')} &nbsp;·&nbsp; ${link('https://kauemunchen.com.br', 'kauemunchen.com.br')} &nbsp;·&nbsp; ${link('https://wa.me/5547933883929', 'Suporte (47) 93388-3929')}</td></tr>
    <tr><td style="padding:14px 4px 0;border-top:1px solid #2C2948;font-family:${SANS};font-size:11px;line-height:1.6;color:${C.noiteMudo}">
      ${linhaNota}<br>
      KAUE WESLEY MUNCHEN MEI · CNPJ 65.356.258/0001-70 · Jaraguá do Sul/SC · ${link(`${b}/termos`, 'Termos')} · ${link(`${b}/privacidade`, 'Privacidade')}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}
