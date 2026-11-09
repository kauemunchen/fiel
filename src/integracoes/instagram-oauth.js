// "Conectar Instagram" por login (API do Instagram com login do Instagram), sem o cliente ver token:
//  1) link de autorização (instagram.com/oauth/authorize) com estado assinado da conta
//  2) callback troca o code por token curto → token longo (60 dias) e grava em instagram_auth
//  3) rotina renova sozinha os tokens antes de vencer (refresh_access_token)
// Enquanto o app da Meta não passa pela análise, só funciona para perfis cadastrados como Testadores do Instagram.
import { db } from '../db/index.js';
import { estadoAssinado, contaDoEstado } from './google-calendar.js';

const APP_ID = () => process.env.INSTAGRAM_APP_ID || '';
const SECRET = () => process.env.INSTAGRAM_APP_SECRET || '';
const BASE = () => (process.env.PUBLIC_URL || process.env.WEBAPP_URL || 'https://usefiel.com').replace(/\/$/, '').replace(/\/app$/, '');
export const REDIRECT = () => process.env.INSTAGRAM_REDIRECT_URI || `${BASE()}/oauth/instagram/callback`;
const ESCOPOS = () => (process.env.INSTAGRAM_SCOPES || 'instagram_business_basic,instagram_business_content_publish').split(/[,\s]+/).filter(Boolean).join(',');

export const configurado = () => !!(APP_ID() && SECRET());

export function urlAutorizacao(contaId) {
  if (!configurado()) return null;
  const p = new URLSearchParams({ client_id: APP_ID(), redirect_uri: REDIRECT(), response_type: 'code', scope: ESCOPOS(), state: estadoAssinado(contaId), enable_fb_login: '0', force_authentication: '1' });
  return `https://www.instagram.com/oauth/authorize?${p}`;
}

function gravar(contaId, igId, token, expiraEmSeg) {
  const expira = new Date(Date.now() + (Number(expiraEmSeg) || 60 * 864e2) * 1000).toISOString().slice(0, 10);
  db.prepare('INSERT INTO instagram_auth (conta_id, ig_user_id, token, expira_em) VALUES (?,?,?,?) ON CONFLICT(conta_id) DO UPDATE SET ig_user_id=excluded.ig_user_id, token=excluded.token, expira_em=excluded.expira_em').run(contaId, String(igId), token, expira);
  db.prepare('INSERT INTO modulos (conta_id, modulo, ligado) VALUES (?,?,1) ON CONFLICT(conta_id, modulo) DO UPDATE SET ligado=1').run(contaId, 'social');
  return expira;
}

/** Callback: code → token curto → token longo. Devolve { contaId, username, expira }. */
export async function concluir(state, code) {
  const contaId = contaDoEstado(state);
  const limpo = String(code || '').replace(/#_$/, '');
  const curto = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: APP_ID(), client_secret: SECRET(), grant_type: 'authorization_code', redirect_uri: REDIRECT(), code: limpo }),
  }).then(r => r.json());
  const tokCurto = curto.access_token || curto.data?.[0]?.access_token;
  if (!tokCurto) throw new Error(curto.error_message || curto.error?.message || 'a Meta não devolveu o token');
  const longo = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(SECRET())}&access_token=${encodeURIComponent(tokCurto)}`).then(r => r.json());
  const token = longo.access_token || tokCurto;
  const me = await fetch(`https://graph.instagram.com/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(token)}`).then(r => r.json());
  if (me.error) throw new Error(`Meta: ${me.error.message}`);
  const expira = gravar(contaId, me.user_id || me.id || curto.user_id, token, longo.expires_in || 3600);
  return { contaId, username: me.username, tipo: me.account_type, expira };
}

/** Renova tokens que vencem nos próximos 15 dias (o token precisa ter mais de 24 h e estar válido). */
export async function renovarTokens() {
  const limite = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare("SELECT conta_id, ig_user_id, token, expira_em FROM instagram_auth WHERE expira_em IS NOT NULL AND expira_em<=? AND expira_em>=date('now')").all(limite);
  const r = { renovados: 0, falhas: 0 };
  for (const a of rows) {
    try {
      const j = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(a.token)}`).then(x => x.json());
      if (!j.access_token) throw new Error(j.error?.message || 'sem token');
      gravar(a.conta_id, a.ig_user_id, j.access_token, j.expires_in); r.renovados++;
    } catch (e) { r.falhas++; console.error('[instagram] renovar', a.conta_id, e.message); }
  }
  return r;
}
