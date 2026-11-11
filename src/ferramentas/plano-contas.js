// Plano de contas por carteira (opcional). Cada carteira pode aderir a um modelo e ajustar as contas.
// Cada conta do plano aponta para um "grupo" do DRE gerencial (Receita operacional, Despesas fixas…),
// então o DRE e o painel continuam funcionando; a conta do plano fica em `subcategoria` ("3.4 Energia, água e internet").
import { db } from '../db/index.js';

export function prepararPlano() {
  db.exec(`CREATE TABLE IF NOT EXISTS fin_plano_cfg (conta_id INTEGER NOT NULL, carteira TEXT NOT NULL, ativo INTEGER DEFAULT 0, modelo TEXT, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (conta_id, carteira));
    CREATE TABLE IF NOT EXISTS fin_plano (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, carteira TEXT NOT NULL, codigo TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL, grupo TEXT NOT NULL, ativo INTEGER DEFAULT 1, ordem INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_fin_plano ON fin_plano (conta_id, carteira)`);
}
prepararPlano();

export const GRUPOS_PJ = ['Receita operacional', 'Outras receitas', 'Custos variáveis', 'Despesas fixas', 'Despesas financeiras', 'Investimentos', 'Retiradas', 'Transferência'];
export const GRUPOS_PF = ['Renda', 'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros', 'Transferência'];

const E = 'entrada', S = 'saida';
export const MODELOS = {
  empresa: { nome: 'Empresa (comércio e serviços)', contas: [
    ['1.1', 'Vendas de produtos', E, 'Receita operacional'], ['1.2', 'Prestação de serviços', E, 'Receita operacional'], ['1.3', 'Rendimentos e outras receitas', E, 'Outras receitas'],
    ['2.1', 'Compra de mercadorias e insumos', S, 'Custos variáveis'], ['2.2', 'Serviços terceirizados', S, 'Custos variáveis'], ['2.3', 'Impostos sobre vendas', S, 'Custos variáveis'], ['2.4', 'Comissões', S, 'Custos variáveis'], ['2.5', 'Fretes e entregas', S, 'Custos variáveis'], ['2.6', 'Taxas de cartão e marketplace', S, 'Custos variáveis'],
    ['3.1', 'Salários e encargos', S, 'Despesas fixas'], ['3.2', 'Pró-labore', S, 'Despesas fixas'], ['3.3', 'Aluguel e condomínio', S, 'Despesas fixas'], ['3.4', 'Energia, água e internet', S, 'Despesas fixas'], ['3.5', 'Contabilidade', S, 'Despesas fixas'], ['3.6', 'Sistemas e assinaturas', S, 'Despesas fixas'], ['3.7', 'Marketing', S, 'Despesas fixas'], ['3.8', 'Manutenção', S, 'Despesas fixas'], ['3.9', 'Material de escritório e limpeza', S, 'Despesas fixas'],
    ['4.1', 'Tarifas bancárias', S, 'Despesas financeiras'], ['4.2', 'Juros e multas', S, 'Despesas financeiras'], ['4.3', 'Parcelas de empréstimos', S, 'Despesas financeiras'],
    ['5.1', 'Máquinas e equipamentos', S, 'Investimentos'], ['5.2', 'Reformas e melhorias', S, 'Investimentos'],
    ['6.1', 'Retirada dos sócios', S, 'Retiradas'],
    ['9.1', 'Transferência entre contas', S, 'Transferência']] },
  industria: { nome: 'Indústria / confecção', contas: [
    ['1.1', 'Venda de produção', E, 'Receita operacional'], ['1.2', 'Serviços de facção / industrialização', E, 'Receita operacional'], ['1.3', 'Outras receitas', E, 'Outras receitas'],
    ['2.1', 'Matéria-prima e aviamentos', S, 'Custos variáveis'], ['2.2', 'Facção e serviços terceirizados', S, 'Custos variáveis'], ['2.3', 'Impostos sobre vendas', S, 'Custos variáveis'], ['2.4', 'Embalagens', S, 'Custos variáveis'], ['2.5', 'Fretes', S, 'Custos variáveis'], ['2.6', 'Comissões de representantes', S, 'Custos variáveis'],
    ['3.1', 'Folha de produção e encargos', S, 'Despesas fixas'], ['3.2', 'Folha administrativa e encargos', S, 'Despesas fixas'], ['3.3', 'Pró-labore', S, 'Despesas fixas'], ['3.4', 'Aluguel do galpão', S, 'Despesas fixas'], ['3.5', 'Energia, água e internet', S, 'Despesas fixas'], ['3.6', 'Manutenção de máquinas', S, 'Despesas fixas'], ['3.7', 'Contabilidade e sistemas', S, 'Despesas fixas'], ['3.8', 'Outras despesas administrativas', S, 'Despesas fixas'],
    ['4.1', 'Tarifas bancárias', S, 'Despesas financeiras'], ['4.2', 'Juros e multas', S, 'Despesas financeiras'], ['4.3', 'Parcelas de empréstimos', S, 'Despesas financeiras'],
    ['5.1', 'Máquinas e equipamentos', S, 'Investimentos'], ['6.1', 'Retirada dos sócios', S, 'Retiradas'], ['9.1', 'Transferência entre contas', S, 'Transferência']] },
  pessoal: { nome: 'Pessoal / família', contas: [
    ['1.1', 'Salário e pró-labore', E, 'Renda'], ['1.2', 'Recebimentos e rendas extras', E, 'Renda'],
    ['2.1', 'Aluguel ou financiamento', S, 'Moradia'], ['2.2', 'Condomínio e IPTU', S, 'Moradia'], ['2.3', 'Energia, água, gás e internet', S, 'Moradia'], ['2.4', 'Manutenção da casa', S, 'Moradia'],
    ['3.1', 'Mercado', S, 'Alimentação'], ['3.2', 'Restaurantes e delivery', S, 'Alimentação'],
    ['4.1', 'Combustível', S, 'Transporte'], ['4.2', 'Carro (parcela, seguro, IPVA, manutenção)', S, 'Transporte'], ['4.3', 'Aplicativos e transporte', S, 'Transporte'],
    ['5.1', 'Plano de saúde', S, 'Saúde'], ['5.2', 'Farmácia e consultas', S, 'Saúde'],
    ['6.1', 'Escola e cursos', S, 'Educação'], ['7.1', 'Viagens e passeios', S, 'Lazer'], ['8.1', 'Streaming e aplicativos', S, 'Assinaturas'],
    ['9.1', 'Consórcios e investimentos', S, 'Outros'], ['9.2', 'Presentes e doações', S, 'Outros'], ['9.3', 'Outros gastos', S, 'Outros'], ['9.9', 'Transferência entre contas', S, 'Transferência']] },
};

const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const rotulo = (c) => `${c.codigo} ${c.nome}`;

export function cfgPlano(contaId, carteira) { return db.prepare('SELECT * FROM fin_plano_cfg WHERE conta_id=? AND carteira=?').get(contaId, carteira) || null; }
export function planoAtivo(contaId, carteira) { return !!carteira && !!cfgPlano(contaId, carteira)?.ativo; }
export function contasPlano(contaId, carteira, { todas = false } = {}) {
  return db.prepare(`SELECT * FROM fin_plano WHERE conta_id=? AND carteira=? ${todas ? '' : 'AND ativo=1'} ORDER BY ordem, codigo`).all(contaId, carteira);
}
export function aplicarModelo(contaId, carteira, modelo, { substituir = false } = {}) {
  const m = MODELOS[modelo]; if (!m) throw new Error(`modelo "${modelo}" não existe (${Object.keys(MODELOS).join(', ')})`);
  const tem = db.prepare('SELECT COUNT(*) n FROM fin_plano WHERE conta_id=? AND carteira=?').get(contaId, carteira).n;
  db.transaction(() => {
    if (tem && substituir) db.prepare('DELETE FROM fin_plano WHERE conta_id=? AND carteira=?').run(contaId, carteira);
    if (!tem || substituir) { const ins = db.prepare('INSERT INTO fin_plano (conta_id, carteira, codigo, nome, tipo, grupo, ordem) VALUES (?,?,?,?,?,?,?)'); m.contas.forEach(([cod, nome, tipo, grupo], i) => ins.run(contaId, carteira, cod, nome, tipo, grupo, i)); }
    db.prepare(`INSERT INTO fin_plano_cfg (conta_id, carteira, ativo, modelo) VALUES (?,?,1,?) ON CONFLICT(conta_id, carteira) DO UPDATE SET ativo=1, modelo=excluded.modelo, atualizado_em=CURRENT_TIMESTAMP`).run(contaId, carteira, modelo);
  })();
  return contasPlano(contaId, carteira);
}
export function definirAtivo(contaId, carteira, ativo) {
  db.prepare(`INSERT INTO fin_plano_cfg (conta_id, carteira, ativo) VALUES (?,?,?) ON CONFLICT(conta_id, carteira) DO UPDATE SET ativo=excluded.ativo, atualizado_em=CURRENT_TIMESTAMP`).run(contaId, carteira, ativo ? 1 : 0);
}

/** Acha a conta do plano por código ("3.4"), rótulo ("3.4 Energia…") ou nome aproximado. */
export function acharConta(contaId, carteira, ref, tipo) {
  const lista = contasPlano(contaId, carteira).filter(c => !tipo || c.tipo === tipo || c.grupo === 'Transferência'); if (!ref) return null;
  const r = semAcento(ref); const cod = (String(ref).match(/^\s*(\d+(?:\.\d+)*)/) || [])[1];
  return (cod && lista.find(c => c.codigo === cod)) || lista.find(c => semAcento(c.nome) === r || semAcento(rotulo(c)) === r)
    || lista.find(c => semAcento(c.nome).includes(r) || (r.length > 4 && r.includes(semAcento(c.nome)))) || null;
}

/**
 * Antes de gravar um lançamento: se a carteira usa plano de contas, coloca categoria = grupo do DRE e
 * subcategoria = conta do plano. `a.conta_plano` inválida → erro com as opções (a Tina pergunta ao dono).
 */
export function encaixarNoPlano(contaId, carteira, tipo, a) {
  if (!planoAtivo(contaId, carteira)) return { a };
  if (a.conta_plano) {
    const c = acharConta(contaId, carteira, a.conta_plano, tipo);
    if (!c) throw new Error(`"${a.conta_plano}" não está no plano de contas da carteira ${carteira}. Contas de ${tipo === 'entrada' ? 'entrada' : 'saída'}: ${contasPlano(contaId, carteira).filter(x => x.tipo === tipo).map(rotulo).join(' · ')}`);
    return { a: { ...a, categoria: c.grupo, subcategoria: rotulo(c) }, conta_plano: rotulo(c) };
  }
  const c = acharConta(contaId, carteira, a.subcategoria, tipo) || acharConta(contaId, carteira, a.categoria, tipo);
  if (c) return { a: { ...a, categoria: c.grupo, subcategoria: rotulo(c) }, conta_plano: rotulo(c) };
  return { a, aviso: `Carteira ${carteira} usa plano de contas e este lançamento ficou sem conta. Pergunte ao dono qual conta usar (listar_plano_contas) e corrija com recategorizar(conta_plano).` };
}

/** Uma linha para o prompt: quais carteiras usam plano. */
export function resumoPlanos(contaId) {
  try { const l = db.prepare('SELECT carteira, modelo FROM fin_plano_cfg WHERE conta_id=? AND ativo=1').all(contaId); return l.length ? l.map(x => `${x.carteira} (plano de contas ${MODELOS[x.modelo]?.nome || 'personalizado'})`).join(', ') : ''; } catch { return ''; }
}
