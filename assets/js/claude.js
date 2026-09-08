// Integração com a API da Claude (Anthropic).
// O SDK oficial é carregado por ESM/CDN para que a página continue 100% estática
// (sem build, sem servidor) e possa rodar no GitHub Pages.

import { catalogoParaPrompt, IDS_VALIDOS } from './produtos.js';

const URL_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.124.0/+esm';
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

let sdkPromise = null;

async function carregarSdk() {
  if (!sdkPromise) {
    sdkPromise = import(URL_SDK)
      .then((m) => m.default)
      .catch((erro) => {
        sdkPromise = null;
        throw new Error(
          'Não foi possível carregar o SDK da Anthropic pelo CDN (jsdelivr). ' +
            'Verifique a conexão/bloqueio de rede. Detalhe: ' + erro.message,
        );
      });
  }
  return sdkPromise;
}

async function criarCliente(apiKey) {
  const Anthropic = await carregarSdk();
  // A chave fica no navegador do operador; ver a seção "Segurança" do README.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// ---------------------------------------------------------------- esquemas

// A API não aceita restrições numéricas (minimum/maximum) no schema de structured outputs.
const inteiro = { type: 'integer' };
const confianca = { type: 'number', description: 'certeza da leitura, de 0 a 1' };

const ESQUEMA_BANDEJA = {
  type: 'object',
  additionalProperties: false,
  required: ['itens', 'total_pecas', 'observacoes'],
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['produto_id', 'rotulo_visto', 'quantidade', 'confianca'],
        properties: {
          produto_id: { type: 'string', enum: [...IDS_VALIDOS, 'nao_identificado'] },
          rotulo_visto: { type: 'string', description: 'como o item aparece na foto, em português' },
          quantidade: inteiro,
          confianca,
        },
      },
    },
    total_pecas: inteiro,
    observacoes: { type: 'string' },
  },
};

// ---------------------------------------------------------------- prompts

const SISTEMA = `Você é o assistente de produção da padaria Nuestro Gusto.
Sua função é contar as peças em fotos de bandejas e vitrines e devolver os dados prontos para a
folha "PRODUÇÃO - CONTROLE DIÁRIO". Responda sempre no formato JSON solicitado, em português.
Nunca invente produtos que não estejam no catálogo e nunca chute números: quando não tiver
certeza, use uma confiança baixa e explique em "observacoes".`;

function promptBandeja() {
  return `Conte as peças visíveis nesta foto de bandeja/vitrine e classifique cada uma no catálogo abaixo.

CATÁLOGO (use exatamente o produto_id da esquerda):
${catalogoParaPrompt()}

Regras de contagem:
1. Conte peça por peça, inclusive as parcialmente visíveis nas bordas da foto; some por tipo.
2. Peças empilhadas atrás de outras só entram se der para vê-las — não estime o que está escondido.
3. Diferencie os recheios pela cor do creme no corte: doce de leite (caramelo claro), chocolate (marrom escuro),
   chocolate branco (branco/marfim), avelã com nozes (marrom com castanha triturada por cima),
   pistacho (verde-claro), goiabada (vermelho).
4. Se um tipo aparecer na foto mas não existir no catálogo, use produto_id "nao_identificado" e descreva em "rotulo_visto".
5. "confianca" é de 0 a 1 e reflete a certeza da contagem daquele tipo (peças sobrepostas ⇒ confiança menor).
6. "total_pecas" é a soma de todas as quantidades.
7. Em "observacoes", registre o que atrapalhou a leitura (foco, sobreposição, corte da foto).`;
}

// ---------------------------------------------------------------- chamada

function extrairJson(resposta) {
  if (resposta.stop_reason === 'refusal') {
    throw new Error('A Claude recusou a solicitação para esta imagem.');
  }
  const texto = resposta.content
    .filter((bloco) => bloco.type === 'text')
    .map((bloco) => bloco.text)
    .join('');
  if (!texto.trim()) throw new Error('A resposta da Claude veio vazia.');
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error('A resposta da Claude não veio em JSON válido.');
  }
}

async function pedir(cliente, { modelo, esforco, esquema, instrucao, imagem }) {
  const corpo = {
    model: modelo,
    max_tokens: 16000,
    system: SISTEMA,
    thinking: { type: 'adaptive' },
    output_config: { effort: esforco, format: { type: 'json_schema', schema: esquema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imagem.tipo, data: imagem.base64 } },
          { type: 'text', text: instrucao },
        ],
      },
    ],
  };

  try {
    // fallback do lado do servidor: se uma recusa acontecer, a própria API reencaminha o pedido.
    return await cliente.beta.messages.create({ ...corpo, betas: [BETA_FALLBACK], fallbacks: 'default' });
  } catch (erro) {
    if (erro?.status === 400) {
      // conta sem acesso ao beta de fallback — repete sem ele
      return cliente.messages.create(corpo);
    }
    throw erro;
  }
}

/** Conta as peças de uma foto de bandeja/vitrine. */
export async function analisarBandeja({ apiKey, modelo, esforco, imagem }) {
  const cliente = await criarCliente(apiKey);
  const resposta = await pedir(cliente, {
    modelo,
    esforco,
    esquema: ESQUEMA_BANDEJA,
    instrucao: promptBandeja(),
    imagem,
  });
  return extrairJson(resposta);
}

/** Chamada mínima só para validar a chave nas configurações. */
export async function testarChave({ apiKey, modelo }) {
  const cliente = await criarCliente(apiKey);
  const resposta = await cliente.messages.create({
    model: modelo,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Responda apenas: ok' }],
  });
  return resposta.content.some((b) => b.type === 'text');
}
