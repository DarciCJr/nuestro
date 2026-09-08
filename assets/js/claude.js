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

const inteiro = { type: 'integer', minimum: 0 };

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
          confianca: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    total_pecas: inteiro,
    observacoes: { type: 'string' },
  },
};

const ESQUEMA_PLANILHA = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'responsavel', 'horas', 'linhas', 'observacoes'],
  properties: {
    data: { type: 'string', description: 'data escrita no formulário, no formato dd/mm/aaaa; vazio se ilegível' },
    responsavel: { type: 'string' },
    horas: {
      type: 'array',
      description: 'horários das colunas Produção 1, 2 e 3 no formato HH:MM; string vazia quando em branco',
      items: { type: 'string' },
    },
    linhas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['produto_id', 'rotulo_planilha', 'producao_1', 'producao_2', 'producao_3', 'perdido', 'confianca'],
        properties: {
          produto_id: { type: 'string', enum: [...IDS_VALIDOS, 'outro'] },
          rotulo_planilha: { type: 'string' },
          producao_1: inteiro,
          producao_2: inteiro,
          producao_3: inteiro,
          perdido: inteiro,
          confianca: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    observacoes: { type: 'string' },
  },
};

// ---------------------------------------------------------------- prompts

const SISTEMA = `Você é o assistente de produção da padaria Nuestro Gusto.
Sua função é ler fotos tiradas na produção e devolver dados prontos para a folha
"PRODUÇÃO - CONTROLE DIÁRIO". Responda sempre no formato JSON solicitado, em português.
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

function promptPlanilha() {
  return `Esta foto é da folha "PRODUÇÃO - CONTROLE DIÁRIO" da Nuestro Gusto, preenchida à mão.
Transcreva os valores manuscritos.

LINHAS DA FOLHA (use exatamente o produto_id da esquerda):
${catalogoParaPrompt()}

Regras de transcrição:
1. Uma entrada em "linhas" para cada linha que tenha algum número escrito. Célula em branco = 0.
2. As colunas são, nesta ordem: PRODUÇÃO 1, PRODUÇÃO 2, PRODUÇÃO 3, TOTAL, PERDIDO, RESULTADO.
   Transcreva apenas PRODUÇÃO 1/2/3 e PERDIDO — TOTAL e RESULTADO são recalculados pelo sistema.
3. Linhas escritas à mão na seção "OUTROS PRODUTOS" usam produto_id "outro" e o nome escrito em "rotulo_planilha".
4. Se a célula tiver algo como "2/2" ou "14 (rasurado)", registre o valor final pretendido e explique em "observacoes".
5. Números rasurados ou ambíguos ⇒ confiança baixa naquela linha.
6. "data" no formato dd/mm/aaaa e "horas" com os três horários (string vazia quando em branco).`;
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

/** Transcreve uma foto da folha preenchida à mão. */
export async function analisarPlanilha({ apiKey, modelo, esforco, imagem }) {
  const cliente = await criarCliente(apiKey);
  const resposta = await pedir(cliente, {
    modelo,
    esforco,
    esquema: ESQUEMA_PLANILHA,
    instrucao: promptPlanilha(),
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
