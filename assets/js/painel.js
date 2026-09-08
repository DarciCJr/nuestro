// Painel de controle: agrega os controles cadastrados, aplica os filtros
// e desenha os gráficos (SVG puro, sem biblioteca externa).

import { SECOES, PRODUTOS_POR_ID } from './produtos.js';
import { listarRegistros } from './planilha.js';

const NS = 'http://www.w3.org/2000/svg';
const numero = new Intl.NumberFormat('pt-BR');

// ------------------------------------------------------------------ agregação

/** Aplica período, responsável e produto sobre os controles cadastrados. */
export function filtrar(registros, { de, ate, responsavel, produto }) {
  return registros
    .filter((r) => r.data && (!de || r.data >= de) && (!ate || r.data <= ate))
    .filter((r) => !responsavel || r.responsavel === responsavel)
    .map((r) => ({ ...r, linhas: r.linhas.filter((l) => combinaProduto(l, produto)) }))
    .filter((r) => r.linhas.length);
}

function combinaProduto(linha, produto) {
  if (!produto) return true;
  if (produto.startsWith('secao:')) {
    const secao = SECOES.find((s) => s.id === produto.slice(6));
    return Boolean(secao && linha.produtoId && secao.produtos.some((p) => p.id === linha.produtoId));
  }
  if (produto === 'livres') return !linha.produtoId;
  return linha.produtoId === produto;
}

const somaLinha = (l) => (l.p1 || 0) + (l.p2 || 0) + (l.p3 || 0);

/** Resume os registros filtrados em totais, série diária e ranking de produtos. */
export function agregar(registros) {
  const dias = new Map();
  const produtos = new Map();
  const totais = { produzido: 0, perdido: 0, resultado: 0, controles: registros.length };

  for (const registro of registros) {
    const dia = dias.get(registro.data) || { data: registro.data, produzido: 0, perdido: 0 };

    for (const linha of registro.linhas) {
      const produzido = somaLinha(linha);
      const perdido = linha.perdido || 0;

      dia.produzido += produzido;
      dia.perdido += perdido;
      totais.produzido += produzido;
      totais.perdido += perdido;

      const nome = linha.produtoId ? PRODUTOS_POR_ID[linha.produtoId]?.nome || linha.nome : linha.nome;
      const item = produtos.get(nome) || { nome, produzido: 0, perdido: 0 };
      item.produzido += produzido;
      item.perdido += perdido;
      produtos.set(nome, item);
    }

    dias.set(registro.data, dia);
  }

  totais.resultado = totais.produzido - totais.perdido;
  totais.perdaPercentual = totais.produzido ? (totais.perdido / totais.produzido) * 100 : 0;
  totais.dias = dias.size;
  totais.mediaDiaria = dias.size ? Math.round(totais.produzido / dias.size) : 0;

  return {
    totais,
    porDia: [...dias.values()].sort((a, b) => a.data.localeCompare(b.data)),
    porProduto: [...produtos.values()].sort((a, b) => b.produzido - a.produzido),
  };
}

// ------------------------------------------------------------------ helpers SVG

function el(nome, atributos = {}) {
  const node = document.createElementNS(NS, nome);
  for (const [chave, valor] of Object.entries(atributos)) node.setAttribute(chave, valor);
  return node;
}

function texto(x, y, conteudo, classe = 'rotulo') {
  const node = el('text', { x, y, class: classe });
  node.textContent = conteudo;
  return node;
}

/** Barra com as pontas de dados arredondadas e a base reta. */
function caminhoBarra(x, y, largura, altura, raio, orientacao = 'cima') {
  const r = Math.max(0, Math.min(raio, largura / 2, altura));
  if (orientacao === 'cima') {
    return `M${x} ${y + altura} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} L${x + largura - r} ${y} Q${x + largura} ${y} ${x + largura} ${y + r} L${x + largura} ${y + altura} Z`;
  }
  return `M${x} ${y} L${x + largura - r} ${y} Q${x + largura} ${y} ${x + largura} ${y + r} L${x + largura} ${y + altura - r} Q${x + largura} ${y + altura} ${x + largura - r} ${y + altura} L${x} ${y + altura} Z`;
}

/** Escala com topo em números redondos (0 / 50 / 100…). */
function escala(maximo) {
  if (maximo <= 0) return { topo: 10, passos: [0, 5, 10] };
  const bruto = maximo / 4;
  const magnitude = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((v) => v >= bruto) || magnitude * 10;
  const topo = Math.ceil(maximo / passo) * passo;
  const passos = [];
  for (let v = 0; v <= topo + 1e-9; v += passo) passos.push(Math.round(v));
  return { topo, passos };
}

const diaCurto = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ------------------------------------------------------------------ dica (tooltip)

let dica = null;

function mostrarDica(evento, linhas) {
  dica ||= document.getElementById('dica-grafico');
  dica.innerHTML = linhas.map((l) => `<span>${l}</span>`).join('');
  dica.hidden = false;
  const ponto = evento.touches?.[0] || evento;
  const largura = dica.offsetWidth;
  dica.style.left = `${Math.max(8, Math.min(ponto.clientX - largura / 2, window.innerWidth - largura - 8))}px`;
  dica.style.top = `${Math.max(8, ponto.clientY - dica.offsetHeight - 14)}px`;
}

function esconderDica() {
  dica ||= document.getElementById('dica-grafico');
  dica.hidden = true;
}

function comDica(node, linhas) {
  node.addEventListener('mouseenter', (e) => mostrarDica(e, linhas));
  node.addEventListener('mousemove', (e) => mostrarDica(e, linhas));
  node.addEventListener('mouseleave', esconderDica);
  node.addEventListener('touchstart', (e) => mostrarDica(e, linhas), { passive: true });
  node.addEventListener('touchend', esconderDica);
  return node;
}

// ------------------------------------------------------------------ gráficos

const ALTURA = 260;
const MARGEM = { topo: 18, direita: 12, baixo: 34, esquerda: 44 };
const ESPESSURA_MAXIMA = 24;
const VAO = 2; // respiro entre marcas, na cor da superfície

/** Colunas empilhadas: resultado + perdido = produzido do dia. */
export function graficoDias(container, porDia) {
  container.innerHTML = '';
  if (!porDia.length) {
    container.innerHTML = '<p class="ajuda">Sem dados no período.</p>';
    return;
  }

  const larguraFaixa = 34; // largura mínima por dia antes de virar rolagem
  const largura = Math.max(container.clientWidth || 320, MARGEM.esquerda + MARGEM.direita + porDia.length * larguraFaixa);
  const faixa = (largura - MARGEM.esquerda - MARGEM.direita) / porDia.length;
  const espessura = Math.min(ESPESSURA_MAXIMA, faixa * 0.6);
  const alturaPlot = ALTURA - MARGEM.topo - MARGEM.baixo;
  const { topo, passos } = escala(Math.max(...porDia.map((d) => d.produzido)));
  const y = (valor) => MARGEM.topo + alturaPlot - (valor / topo) * alturaPlot;

  const svg = el('svg', { class: 'grafico', width: largura, height: ALTURA, role: 'img' });

  for (const passo of passos) {
    svg.appendChild(el('line', { class: 'grade', x1: MARGEM.esquerda, x2: largura - MARGEM.direita, y1: y(passo), y2: y(passo) }));
    svg.appendChild(texto(MARGEM.esquerda - 8, y(passo) + 4, numero.format(passo), 'rotulo eixo-y'));
  }

  // rótulos do eixo x rareiam quando há muitos dias
  const salto = Math.ceil(porDia.length / Math.max(1, Math.floor((largura - 60) / 52)));

  porDia.forEach((dia, i) => {
    const centro = MARGEM.esquerda + faixa * i + faixa / 2;
    const x = centro - espessura / 2;
    const resultado = Math.max(0, dia.produzido - dia.perdido);
    const base = MARGEM.topo + alturaPlot;
    const alturaPerdido = dia.perdido ? Math.max(2, base - y(dia.perdido)) : 0;
    const alturaResultado = Math.max(0, base - y(dia.produzido)) - alturaPerdido - (alturaPerdido ? VAO : 0);

    const descricao = [
      `<strong>${diaCurto(dia.data)}</strong>`,
      `Produzido: ${numero.format(dia.produzido)}`,
      `Perdido: ${numero.format(dia.perdido)}`,
      `Resultado: ${numero.format(resultado)}`,
    ];

    if (alturaResultado > 0) {
      const topoArredondado = alturaPerdido === 0;
      svg.appendChild(
        comDica(
          el('path', {
            class: 'marca serie-1',
            d: caminhoBarra(x, base - alturaResultado, espessura, alturaResultado, topoArredondado ? 4 : 0),
          }),
          descricao,
        ),
      );
    }
    if (alturaPerdido > 0) {
      svg.appendChild(
        comDica(
          el('path', {
            class: 'marca serie-2',
            d: caminhoBarra(x, base - alturaResultado - VAO - alturaPerdido, espessura, alturaPerdido, 4),
          }),
          descricao,
        ),
      );
    }

    if (i % salto === 0 || i === porDia.length - 1) {
      svg.appendChild(texto(centro, ALTURA - 12, diaCurto(dia.data), 'rotulo eixo-x'));
    }
  });

  svg.appendChild(el('line', { class: 'base', x1: MARGEM.esquerda, x2: largura - MARGEM.direita, y1: y(0), y2: y(0) }));
  container.appendChild(svg);
}

/** Barras horizontais: total produzido por produto no período. */
export function graficoProdutos(container, porProduto, limite = 10) {
  container.innerHTML = '';
  if (!porProduto.length) {
    container.innerHTML = '<p class="ajuda">Sem dados no período.</p>';
    return;
  }

  const principais = porProduto.slice(0, limite);
  const resto = porProduto.slice(limite);
  const itens = resto.length
    ? [...principais, { nome: 'Outros', produzido: resto.reduce((t, p) => t + p.produzido, 0), perdido: 0 }]
    : principais;

  const larguraRotulo = 150;
  const largura = Math.max(container.clientWidth || 320, 320);
  const espessura = 18;
  const faixa = espessura + 12;
  const altura = itens.length * faixa + 12;
  const maximo = Math.max(...itens.map((p) => p.produzido), 1);
  const larguraPlot = largura - larguraRotulo - 56;

  const svg = el('svg', { class: 'grafico', width: largura, height: altura, role: 'img' });

  itens.forEach((item, i) => {
    const y = i * faixa + 10;
    const comprimento = Math.max(2, (item.produzido / maximo) * larguraPlot);

    svg.appendChild(texto(larguraRotulo - 8, y + espessura / 2 + 4, item.nome, 'rotulo rotulo-item'));
    svg.appendChild(
      comDica(
        el('path', {
          class: 'marca serie-1',
          d: caminhoBarra(larguraRotulo, y, comprimento, espessura, 4, 'direita'),
        }),
        [`<strong>${item.nome}</strong>`, `Produzido: ${numero.format(item.produzido)}`, `Perdido: ${numero.format(item.perdido)}`],
      ),
    );
    svg.appendChild(texto(larguraRotulo + comprimento + 8, y + espessura / 2 + 4, numero.format(item.produzido), 'rotulo valor'));
  });

  container.appendChild(svg);
}

// ------------------------------------------------------------------ indicadores

export function indicadores(container, totais) {
  const cartoes = [
    { rotulo: 'Produzido', valor: numero.format(totais.produzido), destaque: true },
    { rotulo: 'Perdido', valor: numero.format(totais.perdido) },
    { rotulo: 'Resultado', valor: numero.format(totais.resultado) },
    { rotulo: 'Perda', valor: `${totais.perdaPercentual.toFixed(1).replace('.', ',')}%` },
    { rotulo: 'Média por dia', valor: numero.format(totais.mediaDiaria) },
    { rotulo: 'Dias com registro', valor: numero.format(totais.dias) },
  ];

  container.innerHTML = cartoes
    .map(
      (c) => `<div class="kpi${c.destaque ? ' kpi-destaque' : ''}">
        <span class="kpi-rotulo">${c.rotulo}</span>
        <strong class="kpi-valor">${c.valor}</strong>
      </div>`,
    )
    .join('');
}

/** Reexporta a leitura crua para quem só quer a lista completa. */
export { listarRegistros };
