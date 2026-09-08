// Ligações da interface: configurações protegidas por senha, importação de
// imagem com análise pela Claude e cadastro do controle diário.

import * as cofre from './cofre.js';
import * as planilha from './planilha.js';
import { prepararImagem } from './imagem.js';
import { analisarBandeja, analisarPlanilha, testarChave } from './claude.js';
import { PRODUTOS_POR_ID } from './produtos.js';

const CHAVE_RASCUNHO = 'nuestro_gusto:rascunho';

const estado = {
  apiKey: null, // só em memória, enquanto a aba estiver aberta
  senha: null,
  imagem: null,
  analise: null,
  tipoAnalise: 'bandeja',
};

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ avisos

let timerAviso = null;
function avisar(texto, tipo = 'info') {
  const el = $('aviso');
  el.textContent = texto;
  el.className = `aviso aviso-${tipo}`;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => {
    el.hidden = true;
  }, 6000);
}

function status(el, texto, tipo = 'info') {
  el.textContent = texto;
  el.className = `status status-${tipo}`;
  el.hidden = !texto;
}

function mensagemErro(erro) {
  if (erro?.status === 401) return 'Chave da API inválida ou sem permissão (401).';
  if (erro?.status === 429) return 'Limite de requisições atingido (429). Tente novamente em instantes.';
  if (erro?.status >= 500) return 'A API da Claude está indisponível no momento. Tente novamente.';
  return erro?.message || 'Erro inesperado.';
}

// ------------------------------------------------------------------ rascunho

function salvarRascunho() {
  try {
    localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(planilha.obterRegistro()));
  } catch {
    /* armazenamento indisponível — segue sem rascunho */
  }
}

function carregarRascunho() {
  try {
    const bruto = localStorage.getItem(CHAVE_RASCUNHO);
    if (bruto) planilha.aplicarRegistro(JSON.parse(bruto));
  } catch {
    /* rascunho corrompido — ignora */
  }
}

// ------------------------------------------------------------------ início

function iniciar() {
  planilha.montarPlanilha($('corpo-planilha'), salvarRascunho);
  $('campo-data').value = new Date().toISOString().slice(0, 10);
  carregarRascunho();

  for (const campo of ['campo-data', 'campo-responsavel', 'hora-1', 'hora-2', 'hora-3', 'campo-observacoes']) {
    $(campo).addEventListener('input', salvarRascunho);
  }

  for (const botao of document.querySelectorAll('[data-fechar]')) {
    botao.addEventListener('click', () => botao.closest('dialog').close());
  }

  ligarConfiguracoes();
  ligarImportacao();
  ligarAcoes();

  const prefs = cofre.lerPreferencias();
  $('config-modelo').value = prefs.modelo;
  $('config-esforco').value = prefs.esforco;
}

// ------------------------------------------------------------------ configurações

function ligarConfiguracoes() {
  $('btn-config').addEventListener('click', () => abrirConfiguracoes());

  $('btn-desbloquear').addEventListener('click', desbloquear);
  $('config-senha').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      desbloquear();
    }
  });

  $('btn-salvar-chave').addEventListener('click', salvarChave);
  $('btn-remover-chave').addEventListener('click', removerChave);
  $('btn-testar').addEventListener('click', testarConexao);
  $('btn-trocar-senha').addEventListener('click', trocarSenha);

  for (const campo of ['config-modelo', 'config-esforco']) {
    $(campo).addEventListener('change', () => {
      cofre.gravarPreferencias({ modelo: $('config-modelo').value, esforco: $('config-esforco').value });
    });
  }
}

function abrirConfiguracoes(mensagem = '') {
  $('config-bloqueado').hidden = Boolean(estado.apiKey);
  $('config-aberto').hidden = !estado.apiKey;
  $('config-senha').value = '';
  $('config-erro-senha').hidden = true;
  status($('config-status'), mensagem, 'info');
  $('dlg-config').showModal();
  if (!estado.apiKey) $('config-senha').focus();
}

async function desbloquear() {
  const senha = $('config-senha').value;
  const erro = $('config-erro-senha');

  if (!(await cofre.senhaCorreta(senha))) {
    erro.textContent = 'Senha incorreta.';
    erro.hidden = false;
    return;
  }

  estado.senha = senha;

  if (cofre.temChaveGravada()) {
    try {
      estado.apiKey = await cofre.lerChaveApi(senha);
      $('config-chave').value = estado.apiKey;
    } catch (e) {
      erro.textContent = mensagemErro(e);
      erro.hidden = false;
      return;
    }
  }

  $('config-bloqueado').hidden = true;
  $('config-aberto').hidden = false;
  status($('config-status'), cofre.temChaveGravada() ? 'Chave cadastrada neste navegador.' : 'Nenhuma chave cadastrada ainda.', 'info');
}

async function salvarChave() {
  const chave = $('config-chave').value.trim();
  if (!chave) {
    status($('config-status'), 'Informe a chave da API.', 'erro');
    return;
  }
  await cofre.gravarChaveApi(estado.senha, chave);
  cofre.gravarPreferencias({ modelo: $('config-modelo').value, esforco: $('config-esforco').value });
  estado.apiKey = chave;
  status($('config-status'), 'Chave salva e criptografada neste navegador.', 'ok');
}

function removerChave() {
  if (!confirm('Remover a chave da API deste navegador?')) return;
  cofre.removerChaveApi();
  estado.apiKey = null;
  $('config-chave').value = '';
  status($('config-status'), 'Chave removida.', 'ok');
}

async function testarConexao() {
  const chave = $('config-chave').value.trim() || estado.apiKey;
  if (!chave) {
    status($('config-status'), 'Cadastre a chave antes de testar.', 'erro');
    return;
  }
  status($('config-status'), 'Testando…', 'info');
  try {
    await testarChave({ apiKey: chave, modelo: $('config-modelo').value });
    status($('config-status'), 'Conexão com a API da Claude funcionando.', 'ok');
  } catch (e) {
    status($('config-status'), mensagemErro(e), 'erro');
  }
}

async function trocarSenha() {
  const nova = $('config-nova-senha').value;
  const repetida = $('config-nova-senha2').value;
  if (nova.length < 6) {
    status($('config-status'), 'A nova senha precisa ter ao menos 6 caracteres.', 'erro');
    return;
  }
  if (nova !== repetida) {
    status($('config-status'), 'As senhas não conferem.', 'erro');
    return;
  }
  await cofre.trocarSenha(estado.senha, nova);
  estado.senha = nova;
  $('config-nova-senha').value = '';
  $('config-nova-senha2').value = '';
  status($('config-status'), 'Senha alterada.', 'ok');
}

// ------------------------------------------------------------------ importação

function ligarImportacao() {
  $('btn-importar').addEventListener('click', () => {
    if (!estado.apiKey) {
      avisar('Cadastre a chave da API em Configurações para usar a análise de imagem.', 'erro');
      abrirConfiguracoes();
      return;
    }
    abrirImportacao();
  });

  $('imp-tipo').addEventListener('change', () => {
    estado.tipoAnalise = $('imp-tipo').value;
    $('campo-coluna').hidden = estado.tipoAnalise === 'planilha';
  });

  $('imp-arquivo').addEventListener('change', async (e) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    try {
      estado.imagem = await prepararImagem(arquivo);
      $('imp-previa-img').src = estado.imagem.dataUrl;
      $('imp-previa').hidden = false;
      status($('imp-status'), `Imagem pronta (${estado.imagem.largura}×${estado.imagem.altura}).`, 'info');
    } catch (erro) {
      status($('imp-status'), mensagemErro(erro), 'erro');
    }
  });

  $('btn-analisar').addEventListener('click', analisar);
  $('btn-aplicar').addEventListener('click', aplicarAnalise);
}

function abrirImportacao() {
  estado.imagem = null;
  estado.analise = null;
  $('imp-arquivo').value = '';
  $('imp-previa').hidden = true;
  $('imp-resultado').hidden = true;
  $('btn-aplicar').hidden = true;
  $('btn-analisar').disabled = false;
  $('campo-coluna').hidden = $('imp-tipo').value === 'planilha';
  status($('imp-status'), '', 'info');
  $('dlg-importar').showModal();
}

async function analisar() {
  if (!estado.imagem) {
    status($('imp-status'), 'Selecione uma imagem primeiro.', 'erro');
    return;
  }

  const prefs = cofre.lerPreferencias();
  const tipo = $('imp-tipo').value;
  $('btn-analisar').disabled = true;
  status($('imp-status'), 'Analisando a imagem com a Claude… isso pode levar alguns segundos.', 'info');

  try {
    const parametros = { apiKey: estado.apiKey, modelo: prefs.modelo, esforco: prefs.esforco, imagem: estado.imagem };
    estado.analise = tipo === 'planilha' ? await analisarPlanilha(parametros) : await analisarBandeja(parametros);
    estado.tipoAnalise = tipo;
    mostrarResultado();
    status($('imp-status'), 'Análise concluída. Confira os valores antes de aplicar.', 'ok');
  } catch (erro) {
    console.error(erro);
    status($('imp-status'), mensagemErro(erro), 'erro');
  } finally {
    $('btn-analisar').disabled = false;
  }
}

function nomeDoItem(id, rotulo) {
  return PRODUTOS_POR_ID[id]?.nome || rotulo || 'Não identificado';
}

function celula(texto) {
  const td = document.createElement('td');
  td.textContent = texto;
  return td;
}

function celulaNumero(valor, classe) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.className = classe;
  input.value = valor;
  td.appendChild(input);
  return td;
}

function celulaSelecao(marcado) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'aplicar';
  input.checked = marcado;
  td.appendChild(input);
  return td;
}

function celulaConfianca(valor) {
  const pct = Math.round((valor ?? 0) * 100);
  const td = celula(`${pct}%`);
  td.className = pct >= 80 ? 'conf-alta' : pct >= 50 ? 'conf-media' : 'conf-baixa';
  return td;
}

function mostrarResultado() {
  const cabecalho = document.querySelector('#tabela-resultado thead tr');
  const corpo = $('corpo-resultado');
  cabecalho.innerHTML = '';
  corpo.innerHTML = '';

  const colunas =
    estado.tipoAnalise === 'planilha'
      ? ['Aplicar', 'Produto', 'Prod. 1', 'Prod. 2', 'Prod. 3', 'Perdido', 'Confiança']
      : ['Aplicar', 'Produto', 'Visto na imagem', 'Qtd.', 'Confiança'];
  for (const titulo of colunas) {
    const th = document.createElement('th');
    th.textContent = titulo;
    cabecalho.appendChild(th);
  }

  if (estado.tipoAnalise === 'planilha') {
    for (const linha of estado.analise.linhas || []) {
      const tr = document.createElement('tr');
      tr.dataset.produto = linha.produto_id;
      tr.dataset.rotulo = linha.rotulo_planilha || '';
      tr.appendChild(celulaSelecao(true));
      tr.appendChild(celula(nomeDoItem(linha.produto_id, linha.rotulo_planilha)));
      tr.appendChild(celulaNumero(linha.producao_1 || 0, 'v1'));
      tr.appendChild(celulaNumero(linha.producao_2 || 0, 'v2'));
      tr.appendChild(celulaNumero(linha.producao_3 || 0, 'v3'));
      tr.appendChild(celulaNumero(linha.perdido || 0, 'vp'));
      tr.appendChild(celulaConfianca(linha.confianca));
      corpo.appendChild(tr);
    }
  } else {
    for (const item of estado.analise.itens || []) {
      const tr = document.createElement('tr');
      tr.dataset.produto = item.produto_id;
      tr.dataset.rotulo = item.rotulo_visto || '';
      tr.appendChild(celulaSelecao(true));
      tr.appendChild(celula(nomeDoItem(item.produto_id, item.rotulo_visto)));
      tr.appendChild(celula(item.rotulo_visto || '—'));
      tr.appendChild(celulaNumero(item.quantidade || 0, 'v1'));
      tr.appendChild(celulaConfianca(item.confianca));
      corpo.appendChild(tr);
    }
  }

  const partes = [];
  if (estado.tipoAnalise === 'bandeja' && estado.analise.total_pecas != null) {
    partes.push(`Total de peças contadas: ${estado.analise.total_pecas}.`);
  }
  if (estado.analise.observacoes) partes.push(estado.analise.observacoes);
  $('imp-observacoes').textContent = partes.join(' ');

  $('imp-resultado').hidden = false;
  $('btn-aplicar').hidden = false;
}

function dataBrParaIso(texto) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec((texto || '').trim());
  if (!m) return '';
  const [, d, mes, a] = m;
  const ano = a.length === 2 ? `20${a}` : a;
  return `${ano}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function aplicarAnalise() {
  const modo = $('imp-modo').value;
  const coluna = Number($('imp-coluna').value);
  const linhas = [...$('corpo-resultado').querySelectorAll('tr')].filter(
    (tr) => tr.querySelector('.aplicar').checked,
  );
  let aplicadas = 0;

  if (estado.tipoAnalise === 'planilha') {
    const iso = dataBrParaIso(estado.analise.data);
    if (iso) $('campo-data').value = iso;
    if (estado.analise.responsavel) $('campo-responsavel').value = estado.analise.responsavel;
    (estado.analise.horas || []).forEach((hora, i) => {
      if (/^\d{1,2}:\d{2}$/.test(hora || '')) $(`hora-${i + 1}`).value = hora.padStart(5, '0');
    });

    for (const tr of linhas) {
      const valores = [1, 2, 3].map((c) => Number(tr.querySelector(`.v${c}`).value) || 0);
      const perdido = Number(tr.querySelector('.vp').value) || 0;
      const id = tr.dataset.produto;
      const ehProduto = id && id !== 'outro' && PRODUTOS_POR_ID[id];

      valores.forEach((valor, i) => {
        if (!valor && modo === 'somar') return;
        if (ehProduto) planilha.lancarProduto(id, i + 1, valor, modo);
        else if (valor) planilha.lancarLivre(tr.dataset.rotulo || 'Outro produto', i + 1, valor, modo);
      });
      if (ehProduto && perdido) planilha.definirPerdido(id, perdido);
      aplicadas += 1;
    }
  } else {
    if (modo === 'substituir') planilha.limparColuna(coluna);
    for (const tr of linhas) {
      const quantidade = Number(tr.querySelector('.v1').value) || 0;
      if (!quantidade) continue;
      const id = tr.dataset.produto;
      if (PRODUTOS_POR_ID[id]) planilha.lancarProduto(id, coluna, quantidade, modo);
      else planilha.lancarLivre(tr.dataset.rotulo || 'Não identificado', coluna, quantidade, modo);
      aplicadas += 1;
    }
  }

  planilha.recalcular();
  salvarRascunho();
  $('dlg-importar').close();
  avisar(`${aplicadas} linha(s) lançada(s) na planilha. Confira antes de cadastrar.`, 'ok');
}

// ------------------------------------------------------------------ ações da folha

function ligarAcoes() {
  $('btn-salvar').addEventListener('click', () => {
    const registro = planilha.obterRegistro();
    if (!registro.linhas.length) {
      avisar('Nada para cadastrar: a folha está vazia.', 'erro');
      return;
    }
    if (!registro.data) {
      avisar('Informe a data do controle.', 'erro');
      return;
    }
    planilha.salvarRegistro(registro);
    avisar('Controle cadastrado. Veja em "Histórico".', 'ok');
  });

  $('btn-csv').addEventListener('click', () => {
    const registro = planilha.obterRegistro();
    planilha.baixarArquivo(`controle-diario-${registro.data || 'sem-data'}.csv`, planilha.registroParaCsv(registro));
  });

  $('btn-imprimir').addEventListener('click', () => window.print());

  $('btn-limpar').addEventListener('click', () => {
    if (!confirm('Limpar todos os campos da folha?')) return;
    planilha.limparTudo();
    $('campo-responsavel').value = '';
    $('campo-observacoes').value = '';
    salvarRascunho();
  });

  $('btn-historico').addEventListener('click', abrirHistorico);
  $('btn-exportar-tudo').addEventListener('click', () => {
    planilha.baixarArquivo(
      'controles-nuestro-gusto.json',
      JSON.stringify(planilha.listarRegistros(), null, 2),
      'application/json',
    );
  });
}

function abrirHistorico() {
  const registros = planilha.listarRegistros();
  const corpo = $('corpo-historico');
  corpo.innerHTML = '';
  $('historico-vazio').hidden = registros.length > 0;

  for (const registro of registros) {
    const tr = document.createElement('tr');
    tr.appendChild(celula(registro.data || '—'));
    tr.appendChild(celula(registro.responsavel || '—'));
    tr.appendChild(celula(registro.totais?.total ?? 0));
    tr.appendChild(celula(registro.totais?.perdido ?? 0));
    tr.appendChild(celula(registro.totais?.resultado ?? 0));

    const acoes = document.createElement('td');
    acoes.className = 'acoes-linha';

    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'btn btn-pequeno';
    abrir.textContent = 'Abrir';
    abrir.addEventListener('click', () => {
      planilha.aplicarRegistro(registro);
      salvarRascunho();
      $('dlg-historico').close();
      avisar('Controle carregado na folha.', 'ok');
    });

    const excluir = document.createElement('button');
    excluir.type = 'button';
    excluir.className = 'btn btn-pequeno btn-perigo';
    excluir.textContent = 'Excluir';
    excluir.addEventListener('click', () => {
      if (!confirm('Excluir este controle?')) return;
      planilha.removerRegistro(registro.id);
      abrirHistorico();
    });

    acoes.append(abrir, excluir);
    tr.appendChild(acoes);
    corpo.appendChild(tr);
  }

  $('dlg-historico').showModal();
}

iniciar();
