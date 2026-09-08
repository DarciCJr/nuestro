// Catálogo de produtos da folha "PRODUÇÃO - CONTROLE DIÁRIO" da Nuestro Gusto.
// A descrição visual é enviada para a Claude e é o que permite mapear
// o que aparece na foto para a linha correta da planilha.

export const SECOES = [
  {
    id: 'medialunas',
    titulo: 'MEDIALUNAS',
    produtos: [
      {
        id: 'medialuna_doce_de_leite',
        nome: 'Medialuna Doce de Leite',
        visual: 'medialuna com corte no topo preenchido com doce de leite (creme caramelo claro/bege), normalmente polvilhada com açúcar de confeiteiro',
      },
      {
        id: 'medialuna_chocolate',
        nome: 'Medialuna Chocolate',
        visual: 'medialuna com creme de chocolate ao leite (marrom escuro) no corte do topo, sem castanhas por cima',
      },
      {
        id: 'medialuna_chocolate_branco',
        nome: 'Medialuna Chocolate Branco',
        visual: 'medialuna com creme de chocolate branco (branco/marfim brilhante) no corte do topo',
      },
      {
        id: 'medialuna_avela_nozes',
        nome: 'Medialuna Avelã com Nozes',
        visual: 'medialuna com creme de avelã (marrom) e pedaços visíveis de nozes/castanhas trituradas por cima, acabamento brilhante',
      },
      {
        id: 'medialuna_pistacho',
        nome: 'Medialuna Pistacho',
        visual: 'medialuna com creme de pistache (verde-claro/verde-acinzentado), às vezes com pistache picado',
      },
      {
        id: 'medialuna_goiabada',
        nome: 'Medialuna Goiabada',
        visual: 'medialuna com goiabada (vermelho/vinho translúcido) no corte do topo',
      },
      {
        id: 'medialuna_simples_doce',
        nome: 'Medialuna Simples Doce',
        visual: 'medialuna sem recheio aparente, superfície lisa e brilhante (glaçada), formato de meia-lua fechada',
      },
      {
        id: 'medialuna_simples_salgada',
        nome: 'Medialuna Simples Salgada',
        visual: 'medialuna sem recheio e sem brilho de calda, aspecto mais fosco/amanteigado',
      },
      {
        id: 'medialuna_croissant',
        nome: 'Medialuna Croissant (formato)',
        visual: 'peça no formato alongado de croissant francês, com pontas afiladas, e não no formato curto de medialuna',
      },
      {
        id: 'vigilantes',
        nome: 'Vigilantes',
        visual: 'pãezinhos pequenos e arredondados tipo vigilante, sem recheio visível',
      },
    ],
  },
  {
    id: 'outros',
    titulo: 'OUTROS',
    produtos: [
      { id: 'tartas_salgadas', nome: 'Tartas Salgadas', visual: 'tortas/tartas salgadas individuais ou fatias, recheio salgado visível' },
      { id: 'tartas_doces', nome: 'Tartas Doces', visual: 'tortas/tartas doces individuais ou fatias, com frutas, creme ou doce de leite' },
      { id: 'canoncitos', nome: 'Cañoncitos', visual: 'canudos de massa folhada recheados com doce de leite nas pontas' },
      { id: 'margueritas_tradicional', nome: 'Margueritas Tradicional', visual: 'biscoito/margarita tradicional, redondo e claro' },
      { id: 'margueritas_doce_de_leite', nome: 'Margueritas Doce de Leite', visual: 'margarita recheada com doce de leite' },
    ],
  },
];

export const LINHAS_LIVRES = 4; // seção "OUTROS PRODUTOS" da folha impressa

export const PRODUTOS = SECOES.flatMap((s) => s.produtos);

export const PRODUTOS_POR_ID = Object.fromEntries(PRODUTOS.map((p) => [p.id, p]));

export const IDS_VALIDOS = PRODUTOS.map((p) => p.id);

/** Lista formatada usada dentro do prompt enviado para a Claude. */
export function catalogoParaPrompt() {
  return SECOES.map((secao) => {
    const linhas = secao.produtos
      .map((p) => `- ${p.id} — "${p.nome}": ${p.visual}`)
      .join('\n');
    return `${secao.titulo}\n${linhas}`;
  }).join('\n\n');
}
