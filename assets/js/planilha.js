// Folha do dia: uma coluna para cada horário de produção, mais a coluna de perdas.
// As colunas são dinâmicas — cada uma vira um lançamento gravado por hora.

import { SECOES, LINHAS_LIVRES, PRODUTOS_POR_ID } from './produtos.js';

const LIMITE_COLUNAS = 8;

let elementos = null;
let aoMudar = () => {};
let colunasAtuais = [];

// ------------------------------------------------------------------ montagem

export function montarPlanilha(alvos, callbackMudanca = () => {}) {
  elementos = alvos;
  aoMudar = callbackMudanca;

  elementos.corpo.addEventListener('input', (e) => {
    if (e.target.classList.contains('hora-coluna')) {
      const coluna = colunasAtuais.find((c) => c.id === e.target.dataset.coluna);
      if (coluna) coluna.hora = e.target.value;
    }
    recalcular();
    aoMudar();
  });

  elementos.cabecalho.addEventListener('input', (e) => {
    if (!e.target.classList.contains('hora-coluna')) return;
    const coluna = colunasAtuais.find((c) => c.id === e.target.dataset.coluna);
    if (coluna) coluna.hora = e.target.value;
    aoMudar();
  });

  elementos.cabecalho.addEventListener('click', (e) => {
    const botao = e.target.closest('.remover-coluna');
    if (botao) removerColuna(botao.dataset.coluna);
  });
}

export const colunas = () => colunasAtuais.map((c) => ({ ...c }));

export function definirColunas(lista) {
  const valores = elementos ? lerValores() : {};
  colunasAtuais = lista.length ? lista.map((c) => ({ id: c.id, hora: c.hora || '' })) : [novaColuna()];
  renderizar();
  escreverValores(valores);
  recalcular();
}

function novaColuna(hora = horaAgora()) {
  return { id: crypto.randomUUID(), hora };
}

export function adicionarColuna(hora = horaAgora()) {
  if (colunasAtuais.length >= LIMITE_COLUNAS) return null;
  const coluna = novaColuna(hora);
  definirColunas([...colunasAtuais, coluna]);
  aoMudar();
  return coluna;
}

export function removerColuna(id) {
  if (colunasAtuais.length <= 1) return;
  definirColunas(colunasAtuais.filter((c) => c.id !== id));
  aoMudar();
}

function horaAgora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ desenho

function renderizar() {
  desenharCabecalho();
  desenharCorpo();
  desenharRodape();
}

function desenharCabecalho() {
  const tr = document.createElement('tr');
  tr.appendChild(th('Produto', 'col-produto'));

  for (const [i, coluna] of colunasAtuais.entries()) {
    const celula = document.createElement('th');
    celula.className = 'col-hora';
    celula.innerHTML = `<span class="titulo-coluna">Produção ${i + 1}</span>`;

    const hora = document.createElement('input');
    hora.type = 'time';
    hora.className = 'hora-coluna';
    hora.dataset.coluna = coluna.id;
    hora.value = coluna.hora || '';
    celula.appendChild(hora);

    if (colunasAtuais.length > 1) {
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'remover-coluna';
      remover.dataset.coluna = coluna.id;
      remover.title = 'Remover este horário';
      remover.textContent = '×';
      celula.appendChild(remover);
    }
    tr.appendChild(celula);
  }

  tr.appendChild(th('Total', 'col-total'));
  tr.appendChild(th('Perdido', 'col-perdido'));
  tr.appendChild(th('Resultado', 'col-resultado'));

  elementos.cabecalho.innerHTML = '';
  elementos.cabecalho.appendChild(tr);
}

function th(texto, classe) {
  const celula = document.createElement('th');
  celula.className = classe;
  celula.textContent = texto;
  return celula;
}

function desenharCorpo() {
  elementos.corpo.innerHTML = '';

  for (const secao of SECOES) {
    elementos.corpo.appendChild(linhaSecao(secao.titulo));
    for (const produto of secao.produtos) elementos.corpo.appendChild(linhaProduto(produto.id, produto.nome));
  }

  elementos.corpo.appendChild(linhaSecao('OUTROS PRODUTOS'));
  for (let i = 0; i < LINHAS_LIVRES; i += 1) elementos.corpo.appendChild(linhaLivre(i));
}

function desenharRodape() {
  const tr = document.createElement('tr');
  tr.appendChild(th('Totais do dia', 'col-produto'));
  for (const coluna of colunasAtuais) {
    const celula = th('0', 'total-coluna');
    celula.dataset.coluna = coluna.id;
    tr.appendChild(celula);
  }
  tr.appendChild(th('0', 'rodape-total'));
  tr.appendChild(th('0', 'rodape-perdido'));
  tr.appendChild(th('0', 'rodape-resultado'));

  elementos.rodape.innerHTML = '';
  elementos.rodape.appendChild(tr);
}

function linhaSecao(titulo) {
  const tr = document.createElement('tr');
  tr.className = 'linha-secao';
  const celula = document.createElement('th');
  celula.colSpan = colunasAtuais.length + 4;
  celula.textContent = titulo;
  tr.appendChild(celula);
  return tr;
}

function celulaNumero(classe, colunaId) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.inputMode = 'numeric';
  input.className = classe;
  if (colunaId) input.dataset.coluna = colunaId;
  td.appendChild(input);
  return td;
}

function celulaCalculada(classe) {
  const td = document.createElement('td');
  td.className = `calculada ${classe}`;
  td.textContent = '';
  return td;
}

function montarCelulas(tr) {
  for (const coluna of colunasAtuais) tr.appendChild(celulaNumero('q', coluna.id));
  tr.appendChild(celulaCalculada('total'));
  tr.appendChild(celulaNumero('perdido'));
  tr.appendChild(celulaCalculada('resultado'));
  return tr;
}

function linhaProduto(id, nome) {
  const tr = document.createElement('tr');
  tr.dataset.produto = id;
  const celula = document.createElement('th');
  celula.className = 'col-produto';
  celula.scope = 'row';
  celula.textContent = nome;
  tr.appendChild(celula);
  return montarCelulas(tr);
}

function linhaLivre(indice) {
  const tr = document.createElement('tr');
  tr.dataset.livre = String(indice);
  const celula = document.createElement('th');
  celula.className = 'col-produto';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nome-livre';
  input.placeholder = 'Outro produto…';
  celula.appendChild(input);
  tr.appendChild(celula);
  return montarCelulas(tr);
}

// ------------------------------------------------------------------ leitura/escrita

const num = (el) => {
  const v = Number.parseInt(el?.value ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const linhas = () => [...elementos.corpo.querySelectorAll('tr[data-produto], tr[data-livre]')];

const chaveDaLinha = (tr) => tr.dataset.produto || `livre:${tr.dataset.livre}`;

function lerValores() {
  const valores = {};
  for (const tr of linhas()) {
    const registro = { quantidades: {}, perdido: num(tr.querySelector('.perdido')) };
    if (tr.dataset.livre !== undefined) registro.nome = tr.querySelector('.nome-livre').value.trim();
    for (const input of tr.querySelectorAll('.q')) {
      const valor = num(input);
      if (valor) registro.quantidades[input.dataset.coluna] = valor;
    }
    valores[chaveDaLinha(tr)] = registro;
  }
  return valores;
}

function escreverValores(valores) {
  for (const tr of linhas()) {
    const registro = valores[chaveDaLinha(tr)];
    if (!registro) continue;
    if (registro.nome !== undefined) tr.querySelector('.nome-livre').value = registro.nome;
    tr.querySelector('.perdido').value = registro.perdido || '';
    for (const input of tr.querySelectorAll('.q')) {
      input.value = registro.quantidades[input.dataset.coluna] || '';
    }
  }
}

// ------------------------------------------------------------------ cálculo

export function recalcular() {
  const soma = { total: 0, perdido: 0, resultado: 0 };
  const porColuna = Object.fromEntries(colunasAtuais.map((c) => [c.id, 0]));

  for (const tr of linhas()) {
    let total = 0;
    for (const input of tr.querySelectorAll('.q')) {
      const valor = num(input);
      total += valor;
      porColuna[input.dataset.coluna] = (porColuna[input.dataset.coluna] || 0) + valor;
    }
    const perdido = num(tr.querySelector('.perdido'));
    const resultado = total - perdido;

    tr.querySelector('.total').textContent = total || '';
    const celulaResultado = tr.querySelector('.resultado');
    celulaResultado.textContent = total || perdido ? resultado : '';
    celulaResultado.classList.toggle('negativa', resultado < 0);

    soma.total += total;
    soma.perdido += perdido;
    soma.resultado += resultado;
  }

  for (const celula of elementos.rodape.querySelectorAll('.total-coluna')) {
    celula.textContent = porColuna[celula.dataset.coluna] || 0;
  }
  elementos.rodape.querySelector('.rodape-total').textContent = soma.total;
  elementos.rodape.querySelector('.rodape-perdido').textContent = soma.perdido;
  elementos.rodape.querySelector('.rodape-resultado').textContent = soma.resultado;
  return soma;
}

// ------------------------------------------------------------------ lançamentos

function linhaDoProduto(produtoId) {
  return elementos.corpo.querySelector(`tr[data-produto="${produtoId}"]`);
}

export function lancarProduto(produtoId, colunaId, valor, modo = 'substituir') {
  const tr = linhaDoProduto(produtoId);
  if (!tr) return false;
  const input = tr.querySelector(`.q[data-coluna="${colunaId}"]`);
  if (!input) return false;
  input.value = modo === 'somar' ? num(input) + valor : valor;
  return true;
}

/** Usa a primeira linha livre com o mesmo nome ou vazia. */
export function lancarLivre(nome, colunaId, valor, modo = 'substituir') {
  const alvo = [...elementos.corpo.querySelectorAll('tr[data-livre]')].find((tr) => {
    const campo = tr.querySelector('.nome-livre').value.trim().toLowerCase();
    return campo === nome.trim().toLowerCase() || campo === '';
  });
  if (!alvo) return false;
  alvo.querySelector('.nome-livre').value = nome;
  const input = alvo.querySelector(`.q[data-coluna="${colunaId}"]`);
  if (!input) return false;
  input.value = modo === 'somar' ? num(input) + valor : valor;
  return true;
}

export function definirPerdido(produtoId, valor, modo = 'substituir') {
  const tr = linhaDoProduto(produtoId);
  if (!tr) return false;
  const input = tr.querySelector('.perdido');
  input.value = modo === 'somar' ? num(input) + valor : valor || '';
  return true;
}

export function limparColuna(colunaId) {
  for (const input of elementos.corpo.querySelectorAll(`.q[data-coluna="${colunaId}"]`)) input.value = '';
}

export function limparTudo() {
  for (const input of elementos.corpo.querySelectorAll('input')) input.value = '';
  recalcular();
}

// ------------------------------------------------------------------ dia <-> lançamentos

const nomeDaLinha = (tr) =>
  tr.dataset.produto ? PRODUTOS_POR_ID[tr.dataset.produto].nome : tr.querySelector('.nome-livre').value.trim();

/** Converte o que está na tela em itens por coluna e a lista de perdas. */
export function lerDia() {
  const porColuna = Object.fromEntries(colunasAtuais.map((c) => [c.id, []]));
  const perdas = [];

  for (const tr of linhas()) {
    const nome = nomeDaLinha(tr);
    if (!nome) continue;
    const produtoId = tr.dataset.produto || null;

    for (const input of tr.querySelectorAll('.q')) {
      const quantidade = num(input);
      if (quantidade) porColuna[input.dataset.coluna].push({ produtoId, nome, quantidade });
    }

    const perdido = num(tr.querySelector('.perdido'));
    if (perdido) perdas.push({ produtoId, nome, quantidade: perdido });
  }

  return {
    colunas: colunasAtuais.map((c) => ({ ...c, itens: porColuna[c.id] })),
    perdas,
  };
}

/** Reconstrói a folha a partir dos lançamentos de um dia. */
export function aplicarDia(lancamentos) {
  const producoes = lancamentos.filter((l) => l.tipo !== 'perda').sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  const perdas = lancamentos.filter((l) => l.tipo === 'perda');

  colunasAtuais = producoes.length ? producoes.map((l) => ({ id: l.id, hora: l.hora || '' })) : [novaColuna()];
  renderizar();
  limparTudo();

  for (const lancamento of producoes) {
    for (const item of lancamento.itens || []) {
      if (item.produtoId) lancarProduto(item.produtoId, lancamento.id, item.quantidade);
      else lancarLivre(item.nome, lancamento.id, item.quantidade);
    }
  }

  for (const lancamento of perdas) {
    for (const item of lancamento.itens || []) {
      if (item.produtoId) definirPerdido(item.produtoId, item.quantidade, 'somar');
      else somarPerdaLivre(item.nome, item.quantidade);
    }
  }

  recalcular();
}

function somarPerdaLivre(nome, quantidade) {
  const alvo = [...elementos.corpo.querySelectorAll('tr[data-livre]')].find((tr) => {
    const campo = tr.querySelector('.nome-livre').value.trim().toLowerCase();
    return campo === nome.trim().toLowerCase() || campo === '';
  });
  if (!alvo) return;
  alvo.querySelector('.nome-livre').value = nome;
  const input = alvo.querySelector('.perdido');
  input.value = num(input) + quantidade;
}

// ------------------------------------------------------------------ exportação

export function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV da folha que está na tela. */
export function diaParaCsv({ data, responsavel, observacoes }) {
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const dia = lerDia();
  const cabecalho = ['Produto', ...dia.colunas.map((c, i) => `Produção ${i + 1} (${c.hora || 'sem hora'})`), 'Total', 'Perdido', 'Resultado'];
  const saida = [
    ['Data', data, 'Responsável', responsavel].map(escapar).join(';'),
    '',
    cabecalho.map(escapar).join(';'),
  ];

  for (const tr of linhas()) {
    const nome = nomeDaLinha(tr);
    if (!nome) continue;
    const quantidades = dia.colunas.map((c) => (dia.colunas.find((x) => x.id === c.id).itens.find((i) => i.nome === nome)?.quantidade) || 0);
    const total = quantidades.reduce((t, v) => t + v, 0);
    const perdido = dia.perdas.find((p) => p.nome === nome)?.quantidade || 0;
    if (!total && !perdido) continue;
    saida.push([nome, ...quantidades, total, perdido, total - perdido].map(escapar).join(';'));
  }

  if (observacoes) saida.push('', ['Observações', observacoes].map(escapar).join(';'));
  return saida.join('\n');
}
