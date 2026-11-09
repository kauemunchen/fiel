// Fiel — onboarding do cliente novo (até 2 minutos). Cada etapa tem "depois"; ao concluir, sai a boas-vindas oficial no chat.
(() => {
  const $o = (s, r = document) => r.querySelector(s);
  const escO = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const chamar = (p, o = {}) => api(p, o.body && !(o.body instanceof FormData) ? { ...o, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o.body) } : o);
  let E = null, i = 0, poll = null, inicio = 0;

  const SEGMENTOS = ['Imobiliária', 'Loja / varejo', 'Serviços', 'Saúde e estética', 'Alimentação', 'Educação', 'Mentoria / consultoria', 'Indústria', 'Outro'];
  const TONS_MARCA = ['Profissional', 'Próximo e acolhedor', 'Inspirador', 'Descontraído', 'Sofisticado'];
  const EQUIPE = [
    { id: 'secretaria', nome: 'Olga', papel: 'Secretária', desc: 'agenda, lembretes, e-mails' },
    { id: 'documentos', nome: 'Estag', papel: 'Documentos', desc: 'arquiva no Drive, avisa vencimentos' },
    { id: 'financeiro', nome: 'Tina', papel: 'Financeiro', desc: 'extratos, contas, caixa' },
    { id: 'social', nome: 'MIA', papel: 'Social media', desc: 'posts, artes e agenda do Instagram' },
  ];

  // etapas visíveis conforme a equipe escolhida
  const etapas = () => [
    'perfil', 'equipe', 'telegram',
    (E.modulos.secretaria || E.modulos.documentos) && 'google',
    E.modulos.social && 'mia', E.modulos.social && 'instagram',
    'teste',
  ].filter(Boolean);

  function chips(nome, opcoes, atual) {
    return `<div class="onb-chips" data-nome="${nome}">${opcoes.map(o => `<button type="button" class="onb-chip${o === atual ? ' on' : ''}" data-v="${escO(o)}">${escO(o)}</button>`).join('')}</div>`;
  }
  const valorChip = (nome) => $o(`.onb-chips[data-nome="${nome}"] .on`)?.dataset.v || '';

  const TELAS = {
    perfil: () => ({ titulo: 'Você e a empresa', sub: 'Como a equipe vai te tratar.', html: `
      <label>Seu nome<input id="oNome" value="${escO(E.conta.nome_dono)}" autocomplete="name"></label>
      <label>Empresa<input id="oEmpresa" value="${escO(E.conta.empresa)}" placeholder="Nome da empresa"></label>
      <div class="onb-lbl">A equipe te chama de</div>${chips('tratamento', ['primeiro nome', 'você', 'senhor', 'chefe'], E.tratamento)}
      <div class="onb-lbl">Jeito de falar com você</div>${chips('tom', ['direto', 'cordial', 'formal', 'descontraído'], E.tom)}`,
      salvar: () => chamar('/api/onboarding/passo', { method: 'POST', body: { passo: 'perfil', dados: { nome_dono: $o('#oNome').value, empresa: $o('#oEmpresa').value, tratamento: valorChip('tratamento'), tom: valorChip('tom') } } }) }),

    equipe: () => ({ titulo: 'Ative sua equipe', sub: 'Toque para ligar ou desligar. Dá para mudar depois em Equipe.', html: `<div class="onb-equipe">${EQUIPE.map(m => `
      <button type="button" class="onb-membro${E.modulos[m.id] ? ' on' : ''}" data-id="${m.id}"><span class="onb-tg"></span><b>${m.nome}</b><small>${m.papel} — ${m.desc}</small></button>`).join('')}</div>`,
      montar: () => document.querySelectorAll('.onb-membro').forEach(b => b.onclick = () => b.classList.toggle('on')),
      salvar: () => { const d = {}; document.querySelectorAll('.onb-membro').forEach(b => d[b.dataset.id] = b.classList.contains('on')); return chamar('/api/onboarding/passo', { method: 'POST', body: { passo: 'equipe', dados: d } }); } }),

    telegram: () => ({ titulo: 'Conectar o Telegram', sub: 'Fale com a equipe pelo celular, por texto ou áudio.', html: E.telegram ? '<div class="onb-ok">✅ Telegram conectado</div>' : `
      <a class="btn ouro onb-grande" id="oTgLink" target="_blank" rel="noopener">Abrir o Telegram</a>
      <p class="onb-dica">No Telegram, toque em <b>Começar</b>. Se abrir no computador sem Telegram, mande ao bot <b id="oTgBot"></b>: <code id="oTgCod">…</code></p>
      <div class="onb-espera" id="oTgEspera">Aguardando a conexão…</div>`,
      montar: async () => { if (E.telegram) return; const r = await chamar('/api/telegram/vincular', { method: 'POST' }); $o('#oTgLink').href = r.link; $o('#oTgBot').textContent = '@' + r.bot; $o('#oTgCod').textContent = 'vincular ' + r.codigo;
        vigiar(() => E.telegram, '#oTgEspera', '✅ Telegram conectado'); } }),

    google: () => ({ titulo: 'Conectar o Google', sub: 'Agenda, envio de e-mails, Drive, planilhas e tarefas para a Olga e o Estag.', html: E.google.conectado ? '<div class="onb-ok">✅ Google conectado</div>' : `
      <button type="button" class="btn ouro onb-grande" id="oGoogle">Conectar com o Google</button>
      <p class="onb-dica">Abre uma janela do Google. Escolha sua conta e toque em <b>Continuar</b>. O Fiel só mexe nos arquivos que ele mesmo criar ou que você liberar.</p>
      <div class="onb-espera oculto" id="oGEspera">Aguardando a autorização…</div>`,
      montar: () => { const b = $o('#oGoogle'); if (!b) return; b.onclick = () => { const w = window.open(E.google.url, 'fielGoogle', 'width=520,height=680'); if (!w) location.href = E.google.url; $o('#oGEspera').classList.remove('oculto'); vigiar(() => E.google.conectado, '#oGEspera', '✅ Google conectado'); }; } }),

    mia: () => { const id = E.mia.identidade || {}; const c = E.mia.cores || {}; return { titulo: 'MIA — sua marca', sub: 'Para os posts e artes saírem com a cara da sua empresa.', html: `
      <label>@ do Instagram<input id="oPerfil" value="${escO(id.perfil || E.mia.assinatura || '')}" placeholder="@suaempresa"></label>
      <div class="onb-lbl">Segmento</div>${chips('nicho', SEGMENTOS, id.nicho)}
      <div class="onb-lbl">Tom da marca nos posts</div>${chips('tomMarca', TONS_MARCA, id.tom)}
      <div class="onb-lbl">Cores e logo <small>(toque na cor para escolher)</small></div>
      <div class="onb-cores"><label class="onb-cor">Cor principal<input type="color" id="oFundo" value="${escO(c.fundo || '#1F2A44')}"></label><label class="onb-cor">Cor de destaque<input type="color" id="oDestaque" value="${escO(c.destaque || '#E85D4A')}"></label>
        <button type="button" class="btn onb-sec" id="oArq">📎 Logo ou manual (PDF)</button><input type="file" id="oArqIn" accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden></div>
      <div class="onb-dica" id="oMarcaStatus">${E.mia.logos.length ? `✅ ${E.mia.logos.length} logo(s) salva(s)` : 'Com o manual em PDF, a MIA lê as cores e fontes sozinha.'}</div>`,
      montar: () => { ['#oFundo', '#oDestaque'].forEach(q => $o(q).addEventListener('input', () => $o(q).dataset.mudou = '1')); if (c.fundo) $o('#oFundo').dataset.mudou = '1'; if (c.destaque) $o('#oDestaque').dataset.mudou = '1'; $o('#oArq').onclick = () => $o('#oArqIn').click(); $o('#oArqIn').onchange = async (ev) => {
        const st = $o('#oMarcaStatus');
        for (const f of [...ev.target.files].slice(0, 5)) {
          st.textContent = `Enviando ${f.name}…`; const fd = new FormData(); fd.append('arquivo', f, f.name);
          try { const r = await chamar('/api/onboarding/marca', { method: 'POST', body: fd });
            if (r.erro) throw new Error(r.erro);
            if (r.tipo === 'manual') { if (r.cores?.fundo) { $o('#oFundo').value = r.cores.fundo.toLowerCase(); $o('#oFundo').dataset.mudou = '1'; } if (r.cores?.destaque) { $o('#oDestaque').value = r.cores.destaque.toLowerCase(); $o('#oDestaque').dataset.mudou = '1'; } st.textContent = `✅ Manual lido: ${(r.paleta || []).map(p => p.hex).slice(0, 5).join(' ') || 'cores salvas'}${r.fontes ? ' · ' + r.fontes : ''}`; }
            else st.textContent = `✅ Logo salva (${r.variante === 'claro' ? 'versão clara' : r.variante === 'escuro' ? 'versão escura' : r.variante})`;
          } catch (e) { st.textContent = '⚠️ ' + e.message; }
        } ev.target.value = ''; }; },
      salvar: () => chamar('/api/onboarding/passo', { method: 'POST', body: { passo: 'mia', dados: { perfil: $o('#oPerfil').value, nicho: valorChip('nicho'), categoria: valorChip('nicho'), tom: valorChip('tomMarca'), cor_fundo: $o('#oFundo').dataset.mudou ? $o('#oFundo').value : '', cor_destaque: $o('#oDestaque').dataset.mudou ? $o('#oDestaque').value : '' } } }) }; },

    instagram: () => ({ titulo: 'Publicar no Instagram', sub: 'Opcional agora. Sem isso, a MIA cria e agenda; publicar fica para quando conectar.', html: E.instagram ? '<div class="onb-ok">✅ Instagram conectado</div>' : `
      <label>Token do Instagram (conta profissional)<input id="oIgTok" placeholder="Cole aqui o token" autocomplete="off"></label>
      <p class="onb-dica">Não tem o token? Toque em <b>Depois</b> — o passo a passo está no <a href="/ajuda#instagram" target="_blank" rel="noopener">manual</a> e em Conexões.</p><div class="onb-dica" id="oIgSt"></div>`,
      salvar: async () => { const t = $o('#oIgTok')?.value.trim(); if (!t) return; const r = await chamar('/api/conexoes/instagram', { method: 'POST', body: { token: t } }); if (r.erro) { $o('#oIgSt').textContent = '⚠️ ' + r.erro; throw new Error(r.erro); } } }),

    teste: () => ({ titulo: 'Teste rápido', sub: 'Conferindo o que ficou pronto.', html: '<ul class="onb-teste" id="oTeste"><li>Testando…</li></ul>',
      montar: async () => { const r = await chamar('/api/onboarding/teste', { method: 'POST' }).catch(() => ({ itens: [] }));
        $o('#oTeste').innerHTML = (r.itens || []).map(t => `<li class="${t.ok === true ? 'ok' : t.ok === false ? 'erro' : 'pend'}"><span>${t.ok === true ? '✓' : t.ok === false ? '!' : '–'}</span>${escO(t.texto)}</li>`).join('') || '<li class="ok"><span>✓</span>Tudo certo</li>'; } }),
  };

  function vigiar(cond, sel, txtOk) {
    clearInterval(poll);
    poll = setInterval(async () => { try { E = await chamar('/api/onboarding'); if (cond()) { clearInterval(poll); const el = $o(sel); if (el) { el.textContent = txtOk; el.classList.add('onb-ok'); } setTimeout(() => avancar(), 900); } } catch {} }, 2500);
  }
  window.addEventListener('message', (ev) => { if (ev.data === 'fiel:google-ok' && $o('#onb')) chamar('/api/onboarding').then(e => { E = e; desenhar(); }); });

  function desenhar() {
    const lista = etapas(); i = Math.min(i, lista.length - 1); const id = lista[i]; const t = TELAS[id]();
    const restante = Math.max(15, (lista.length - i) * 15);
    $o('#onb').innerHTML = `<div class="onb-caixa" role="dialog" aria-modal="true" aria-label="Configuração inicial">
      <div class="onb-topo"><span>Configuração inicial · ${i + 1} de ${lista.length}</span><span>~${restante < 120 ? restante + ' s' : Math.ceil(restante / 60) + ' min'}</span></div>
      <div class="onb-barra"><i style="width:${Math.round(i / lista.length * 100)}%"></i></div>
      <h2>${t.titulo}</h2><p class="onb-sub">${t.sub}</p>
      <div class="onb-corpo">${t.html}</div>
      <div class="onb-acoes"><button type="button" class="onb-link" id="oVoltar"${i === 0 ? ' disabled' : ''}>Voltar</button><span></span>
        ${id === 'teste' ? '' : '<button type="button" class="onb-link" id="oDepois">Depois</button>'}
        <button type="button" class="btn ouro" id="oSeguir">${id === 'teste' ? 'Começar a usar' : 'Continuar'}</button></div>
      <div class="onb-erro" id="oErro"></div></div>`;
    document.querySelectorAll('.onb-chips').forEach(g => g.querySelectorAll('.onb-chip').forEach(b => b.onclick = () => { g.querySelectorAll('.onb-chip').forEach(x => x.classList.toggle('on', x === b)); }));
    $o('#oVoltar').onclick = () => { clearInterval(poll); i = Math.max(0, i - 1); desenhar(); };
    $o('#oDepois') && ($o('#oDepois').onclick = () => { clearInterval(poll); avancar(); });
    $o('#oSeguir').onclick = async () => {
      const b = $o('#oSeguir'); b.disabled = true; $o('#oErro').textContent = '';
      try { if (t.salvar) { const r = await t.salvar(); if (r?.erro) throw new Error(r.erro); if (r?.estado) E = r.estado; } if (id === 'teste') return concluir(); clearInterval(poll); avancar(); }
      catch (e) { $o('#oErro').textContent = e.message; b.disabled = false; }
    };
    try { t.montar?.(); } catch (e) { console.error(e); }
    $o('.onb-corpo input')?.focus({ preventScroll: true });
  }
  async function avancar() { try { E = await chamar('/api/onboarding'); } catch {} i++; desenhar(); }
  async function concluir() {
    clearInterval(poll);
    try { await chamar('/api/onboarding/concluir', { method: 'POST' }); } catch {}
    console.log('[onboarding] concluído em', Math.round((Date.now() - inicio) / 1000), 's');
    $o('#onb')?.remove(); document.body.classList.remove('onb-aberto');
    try { _guiaAberto = false; carregarGuia?.(); } catch {}
  }

  function intro() {
    const nome = (E.conta.nome_dono || '').split(' ')[0];
    $o('#onb').innerHTML = `<div class="onb-caixa onb-intro" role="dialog" aria-modal="true" aria-label="Boas-vindas">
      <div class="onb-selo">F</div><h2>Olá${nome ? ', ' + escO(nome) : ''}! Vamos deixar sua equipe pronta.</h2>
      <p class="onb-sub">Ativações, Telegram, Google e a marca da MIA — leva menos de <b>2 minutos</b>. Tudo pode ser ajustado depois.</p>
      <button type="button" class="btn ouro onb-grande" id="oComecar">Começar</button>
      <button type="button" class="onb-link" id="oPular">Pular e configurar depois</button></div>`;
    $o('#oComecar').onclick = () => { inicio = Date.now(); i = 0; desenhar(); };
    $o('#oPular').onclick = concluir;
  }

  window.verificarOnboarding = async () => {
    if ($o('#onb')) return;
    try { E = await chamar('/api/onboarding'); } catch { return; }
    if (E.concluido) return;
    const d = document.createElement('div'); d.id = 'onb'; d.className = 'onb'; document.body.appendChild(d); document.body.classList.add('onb-aberto');
    intro();
  };
})();
