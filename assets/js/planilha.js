// Montagem, cálculo e persistência da folha de controle diário.

import { SECOES, LINHAS_LIVRES, PRODUTOS_POR_ID } from './produtos.js';

const CHAVE_REGISTROS = 'nuestro_gusto:registros';

let corpo = null;
let aoMudar = () => {};

// ------------------------------------------------------------------ montagem

export function montarPlanilha(elementoCorpo, callbackMudanca = () => {}) {
  corpo = elementoCorpo;
  aoMudar = callbackMudanca;
  corpo.innerHTML = '';

  for (const secao of SECOES) {
    corpo.appendChild(linhaSecao(secao.titulo));
    for (const produto of secao.produtos) {
      corpo.appendChild(linhaProduto(produto.id, produto.nome));
    }
  }

  corpo.appendChild(linhaSecao('OUTROS PRODUTOS'));
  for (let i = 0; i < LINHAS_LIVRES; i += 1) {
    corpo.appendChild(linhaLivre());
  }

  corpo.addEventListener('input', () => {
    recalcular();
    aoMudar();
  });

  recalcular();
}

function linhaSecao(titulo) {
  const tr = document.createElement('tr');
  tr.className = 'linha-secao';
  const th = document.createElement('th');
  th.colSpan = 7;
  th.textContent = titulo;
  tr.appendChild(th);
  return tr;
}

function celulaNumero(classe) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.inputMode = 'numeric';
  input.className = classe;
  td.appendChild(input);
  return td;
}

function celulaCalculada(classe) {
  const td = document.createElement('td');
  td.className = `calculada ${classe}`;
  td.textContent = '0';
  return td;
}

function montarLinha(tr) {
  tr.appendChild(celulaNumero('p1'));
  tr.appendChild(celulaNumero('p2'));
  tr.appendChild(celulaNumero('p3'));
  tr.appendChild(celulaCalculada('total'));
  tr.appendChild(celulaNumero('perdido'));
  tr.appendChild(celulaCalculada('resultado'));
  return tr;
}

function linhaProduto(id, nome) {
  const tr = document.createElement('tr');
  tr.dataset.produto = id;
  const th = document.createElement('th');
  th.className = 'col-produto';
  th.scope = 'row';
  th.textContent = nome;
  tr.appendChild(th);
  return montarLinha(tr);
}

function linhaLivre() {
  const tr = document.createElement('tr');
  tr.dataset.livre = '1';
  const th = document.createElement('th');
  th.className = 'col-produto';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nome-livre';
  input.placeholder = 'Outro produto…';
  th.appendChild(input);
  tr.appendChild(th);
  return montarLinha(tr);
}

// ------------------------------------------------------------------ cálculo

const num = (el) => {
  const v = Number.parseInt(el?.value ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export function recalcular() {
  const soma = { p1: 0, p2: 0, p3: 0, total: 0, perdido: 0, resultado: 0 };

  for (const tr of corpo.querySelectorAll('tr[data-produto], tr[data-livre]')) {
    const p1 = num(tr.querySelector('.p1'));
    const p2 = num(tr.querySelector('.p2'));
    const p3 = num(tr.querySelector('.p3'));
    const perdido = num(tr.querySelector('.perdido'));
    const total = p1 + p2 + p3;
    const resultado = total - perdido;

    tr.querySelector('.total').textContent = total || '';
    const celulaResultado = tr.querySelector('.resultado');
    celulaResultado.textContent = total || perdido ? resultado : '';
    celulaResultado.classList.toggle('negativa', resultado < 0);

    soma.p1 += p1;
    soma.p2 += p2;
    soma.p3 += p3;
    soma.total += total;
    soma.perdido += perdido;
    soma.resultado += resultado;
  }

  for (const [campo, valor] of Object.entries(soma)) {
    const el = document.getElementById(`rodape-${campo}`);
    if (el) el.textContent = valor;
  }
  return soma;
}

// ------------------------------------------------------------------ escrita

/**
 * Lança um valor numa coluna de produção.
 * @param {'somar'|'substituir'} modo
 */
export function lancarProduto(produtoId, coluna, valor, modo = 'substituir') {
  const tr = corpo.querySelector(`tr[data-produto="${produtoId}"]`);
  if (!tr) return false;
  const input = tr.querySelector(`.p${coluna}`);
  input.value = modo === 'somar' ? num(input) + valor : valor;
  return true;
}

/** Lança um item sem linha própria numa das linhas de "OUTROS PRODUTOS". */
export function lancarLivre(nome, coluna, valor, modo = 'substituir') {
  const alvo = [...corpo.querySelectorAll('tr[data-livre]')].find((tr) => {
    const campoNome = tr.querySelector('.nome-livre');
    return campoNome.value.trim().toLowerCase() === nome.trim().toLowerCase() || campoNome.value.trim() === '';
  });
  if (!alvo) return false;
  alvo.querySelector('.nome-livre').value = nome;
  const input = alvo.querySelector(`.p${coluna}`);
  input.value = modo === 'somar' ? num(input) + valor : valor;
  return true;
}

export function definirPerdido(produtoId, valor) {
  const tr = corpo.querySelector(`tr[data-produto="${produtoId}"]`);
  if (!tr) return false;
  tr.querySelector('.perdido').value = valor || '';
  return true;
}

export function limparColuna(coluna) {
  for (const input of corpo.querySelectorAll(`.p${coluna}`)) input.value = '';
}

export function limparTudo() {
  for (const input of corpo.querySelectorAll('input')) input.value = '';
  recalcular();
}

// ------------------------------------------------------------------ estado

export function obterRegistro() {
  const linhas = [];

  for (const tr of corpo.querySelectorAll('tr[data-produto]')) {
    const produtoId = tr.dataset.produto;
    const valores = {
      p1: num(tr.querySelector('.p1')),
      p2: num(tr.querySelector('.p2')),
      p3: num(tr.querySelector('.p3')),
      perdido: num(tr.querySelector('.perdido')),
    };
    if (valores.p1 || valores.p2 || valores.p3 || valores.perdido) {
      linhas.push({ produtoId, nome: PRODUTOS_POR_ID[produtoId].nome, ...valores });
    }
  }

  for (const tr of corpo.querySelectorAll('tr[data-livre]')) {
    const nome = tr.querySelector('.nome-livre').value.trim();
    const valores = {
      p1: num(tr.querySelector('.p1')),
      p2: num(tr.querySelector('.p2')),
      p3: num(tr.querySelector('.p3')),
      perdido: num(tr.querySelector('.perdido')),
    };
    if (nome && (valores.p1 || valores.p2 || valores.p3 || valores.perdido)) {
      linhas.push({ produtoId: null, nome, ...valores });
    }
  }

  const totais = recalcular();

  return {
    id: crypto.randomUUID(),
    criadoEm: new Date().toISOString(),
    data: document.getElementById('campo-data').value,
    responsavel: document.getElementById('campo-responsavel').value.trim(),
    horas: [1, 2, 3].map((i) => document.getElementById(`hora-${i}`).value),
    observacoes: document.getElementById('campo-observacoes').value.trim(),
    linhas,
    totais,
  };
}

export function aplicarRegistro(registro) {
  limparTudo();
  document.getElementById('campo-data').value = registro.data || '';
  document.getElementById('campo-responsavel').value = registro.responsavel || '';
  (registro.horas || []).forEach((hora, i) => {
    document.getElementById(`hora-${i + 1}`).value = hora || '';
  });
  document.getElementById('campo-observacoes').value = registro.observacoes || '';

  for (const linha of registro.linhas || []) {
    if (linha.produtoId) {
      [1, 2, 3].forEach((c) => lancarProduto(linha.produtoId, c, linha[`p${c}`] || ''));
      definirPerdido(linha.produtoId, linha.perdido);
    } else {
      [1, 2, 3].forEach((c) => {
        if (linha[`p${c}`]) lancarLivre(linha.nome, c, linha[`p${c}`]);
      });
    }
  }
  recalcular();
}

// ------------------------------------------------------------------ registros

export function listarRegistros() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_REGISTROS) || '[]');
  } catch {
    return [];
  }
}

export function salvarRegistro(registro) {
  const registros = listarRegistros();
  registros.unshift(registro);
  localStorage.setItem(CHAVE_REGISTROS, JSON.stringify(registros));
  return registro;
}

export function removerRegistro(id) {
  localStorage.setItem(CHAVE_REGISTROS, JSON.stringify(listarRegistros().filter((r) => r.id !== id)));
}

// ------------------------------------------------------------------ exportação

export function registroParaCsv(registro) {
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [
    ['Data', registro.data, 'Responsável', registro.responsavel].map(escapar).join(';'),
    ['Horários', ...registro.horas].map(escapar).join(';'),
    [],
    ['Produto', 'Produção 1', 'Produção 2', 'Produção 3', 'Total', 'Perdido', 'Resultado'].map(escapar).join(';'),
  ];

  for (const l of registro.linhas) {
    const total = l.p1 + l.p2 + l.p3;
    linhas.push([l.nome, l.p1, l.p2, l.p3, total, l.perdido, total - l.perdido].map(escapar).join(';'));
  }

  const t = registro.totais;
  linhas.push(['TOTAIS', t.p1, t.p2, t.p3, t.total, t.perdido, t.resultado].map(escapar).join(';'));
  if (registro.observacoes) linhas.push([], ['Observações', registro.observacoes].map(escapar).join(';'));

  return linhas.join('\n');
}

export function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
