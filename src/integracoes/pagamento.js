// Seletor de gateway de pagamento (Fiel). PAGAMENTO_PROVEDOR=mercadopago (padrão) ou asaas.
// Re-exporta a interface do provedor escolhido para que o resto do sistema (governanca, scheduler, api-marca, index) não precise saber qual é.
const alvo = (process.env.PAGAMENTO_PROVEDOR || 'mercadopago').toLowerCase() === 'asaas' ? './asaas.js' : './mercadopago.js';
const mod = await import(alvo);
export const configurado = mod.configurado;
export const comprar = mod.comprar;
export const cobranca = mod.cobranca;
export const listarCobrancas = mod.listarCobrancas;
export const assinaturaAtiva = mod.assinaturaAtiva;
export const cancelarAssinatura = mod.cancelarAssinatura;
export const confirmarPagamento = mod.confirmarPagamento;
export const rotaWebhook = mod.rotaWebhook;
export const conferirPendentes = mod.conferirPendentes;
export const docValido = mod.docValido;
export const limparDoc = mod.limparDoc;
export const atualizarValorAssinatura = mod.atualizarValorAssinatura;
export const provedor = alvo === './asaas.js' ? 'asaas' : 'mercadopago';
