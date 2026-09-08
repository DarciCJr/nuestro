// Ligações da interface: acesso por senha, folha do dia com lançamentos por
// horário, análise de imagem pela Claude, sincronia com a nuvem e painel.

import * as cofre from './cofre.js';
import * as planilha from './planilha.js';
import * as dados from './dados.js';
import * as painel from './painel.js';
import { prepararImagem } from './imagem.js';
import { analisarBandeja, analisarPlanilha, testarChave } from './claude.js';
import { PRODUTOS_POR_ID, SECOES } from './produtos.js';

const estado = {
  desbloqueado: false,
  apiKey: null, // só em memória, enquanto a aba estiver aberta
  senha: null,
  imagem: null,
  analise: null,
  tipoAnalise: 'bandeja',
  alterado: false,
  assinaturaDoDia: '',
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

// ------------------------------------------------------------------ início

function iniciar() {
  ligarLogin();
  planilha.montarPlanilha(
    { corpo: $('corpo-planilha'), cabecalho: $('cabecalho-planilha'), rodape: $('rodape-planilha') },
    marcarAlterado,
  );
  planilha.definirColunas([]);
  $('campo-data').value = new Date().toISOString().slice(0, 10);

  for (const botao of document.querySelectorAll('[data-fechar]')) {
    botao.addEventListener('click', () => botao.closest('dialog').close());
  }

  ligarConfiguracoes();
  ligarImportacao();
  ligarAcoes();
  ligarPainel();
  ligarSincronia();

  const prefs = cofre.lerPreferencias();
  $('config-modelo').value = prefs.modelo;
  $('config-esforco').value = prefs.esforco;

  window.addEventListener('beforeunload', (e) => {
    if (!estado.alterado) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function marcarAlterado() {
  estado.alterado = true;
  $('btn-salvar').classList.add('pendente');
}

function marcarSalvo() {
  estado.alterado = false;
  $('btn-salvar').classList.remove('pendente');
}

// ------------------------------------------------------------------ acesso

function ligarLogin() {
  $('form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    entrar();
  });
  $('btn-bloquear').addEventListener('click', bloquear);
  $('btn-entrar').disabled = false;
  $('btn-entrar').textContent = 'Entrar';
}

async function entrar() {
  const senha = $('login-senha').value;
  const erro = $('login-erro');
  const botao = $('btn-entrar');
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try {
    // senha e chave da API valem para todos os aparelhos
    const naNuvem = await sincronizarAcesso();

    if (!(await cofre.senhaCorreta(senha))) {
      erro.textContent = 'Senha incorreta.';
      erro.hidden = false;
      $('login-senha').select();
      return;
    }

    estado.senha = senha;
    estado.desbloqueado = true;
    await carregarChaveApi(senha);

    // chave cadastrada só neste aparelho (ou antes da nuvem existir): publica sozinho
    if (estado.apiKey && !naNuvem.temChaveNaNuvem) {
      const publicada = await publicarChave();
      if (publicada) avisar('A chave da API deste aparelho foi compartilhada com os outros.', 'ok');
    }

    $('tela-login').hidden = true;
    $('topo').hidden = false;
    mostrarVista('folha');
    $('login-senha').value = '';

    const migrados = await dados.migrarControlesAntigos();
    if (migrados) avisar(`${migrados} lançamento(s) do formato antigo foram convertidos.`, 'ok');

    // a primeira sincronia precisa terminar antes de desenhar a folha,
    // senão o dia aparece vazio num aparelho que ainda não baixou nada
    await dados.iniciarSincroniaAutomatica();
    await carregarDia($('campo-data').value);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

/** Traz da nuvem a senha de acesso e o envelope cifrado da chave da API. */
async function sincronizarAcesso() {
  const acesso = await dados.lerConfigNuvem('acesso');
  if (acesso?.hash) cofre.definirHashSenha(acesso.hash);

  const api = await dados.lerConfigNuvem('api_claude');
  if (api?.envelope) cofre.aplicarEnvelope(api.envelope);
  if (api?.modelo || api?.esforco) {
    cofre.gravarPreferencias({ modelo: api.modelo, esforco: api.esforco });
    $('config-modelo').value = api.modelo || $('config-modelo').value;
    $('config-esforco').value = api.esforco || $('config-esforco').value;
  }
  return { temChaveNaNuvem: Boolean(api?.envelope) };
}

async function carregarChaveApi(senha) {
  estado.apiKey = null;
  if (!cofre.temChaveGravada()) return;
  try {
    estado.apiKey = await cofre.lerChaveApi(senha);
  } catch {
    avisar('A chave da API gravada não abriu com esta senha. Cadastre-a novamente em Configurações.', 'erro');
  }
}

function bloquear() {
  estado.desbloqueado = false;
  estado.apiKey = null;
  estado.senha = null;
  $('config-chave').value = '';
  for (const dialogo of document.querySelectorAll('dialog[open]')) dialogo.close();
  $('topo').hidden = true;
  $('folha').hidden = true;
  $('painel').hidden = true;
  $('tela-login').hidden = false;
  $('login-erro').hidden = true;
  $('login-senha').focus();
}

// ------------------------------------------------------------------ configurações

function ligarConfiguracoes() {
  $('btn-config').addEventListener('click', () => abrirConfiguracoes());
  $('btn-salvar-chave').addEventListener('click', salvarChave);
  $('btn-remover-chave').addEventListener('click', removerChave);
  $('btn-testar').addEventListener('click', testarConexao);
  $('btn-trocar-senha').addEventListener('click', trocarSenha);
  $('config-aparelho').addEventListener('change', () => {
    dados.definirDispositivo($('config-aparelho').value);
    status($('config-status'), 'Nome do aparelho salvo.', 'ok');
  });

  for (const campo of ['config-modelo', 'config-esforco']) {
    $(campo).addEventListener('change', () => {
      cofre.gravarPreferencias({ modelo: $('config-modelo').value, esforco: $('config-esforco').value });
    });
  }
}

function abrirConfiguracoes(mensagem = '') {
  $('config-chave').value = estado.apiKey || '';
  $('config-aparelho').value = dados.dispositivo();
  status(
    $('config-status'),
    mensagem || (cofre.temChaveGravada() ? 'Chave cadastrada neste navegador.' : 'Nenhuma chave cadastrada ainda.'),
    'info',
  );
  $('dlg-config').showModal();
}

async function salvarChave() {
  const chave = $('config-chave').value.trim();
  if (!chave) {
    status($('config-status'), 'Informe a chave da API.', 'erro');
    return;
  }

  status($('config-status'), 'Salvando…', 'info');
  await cofre.gravarChaveApi(estado.senha, chave);
  cofre.gravarPreferencias({ modelo: $('config-modelo').value, esforco: $('config-esforco').value });
  estado.apiKey = chave;

  const enviada = await publicarChave();
  status(
    $('config-status'),
    enviada
      ? 'Chave salva na nuvem (cifrada). Qualquer aparelho que entrar com a senha já usa esta chave.'
      : 'Chave salva neste aparelho, mas a nuvem não respondeu — tente sincronizar depois para valer nos outros.',
    enviada ? 'ok' : 'erro',
  );
}

/** Sobe o envelope cifrado (nunca a chave em claro) para valer em todo aparelho. */
async function publicarChave() {
  const envelope = cofre.envelope();
  if (!envelope) return false;
  return dados.gravarConfigNuvem('api_claude', {
    envelope,
    modelo: $('config-modelo').value,
    esforco: $('config-esforco').value,
    atualizadoPor: dados.dispositivo(),
  });
}

async function removerChave() {
  if (!confirm('Remover a chave da API de todos os aparelhos?')) return;
  cofre.removerChaveApi();
  estado.apiKey = null;
  $('config-chave').value = '';
  await dados.gravarConfigNuvem('api_claude', {});
  status($('config-status'), 'Chave removida daqui e da nuvem.', 'ok');
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

  const publicada = await dados.gravarConfigNuvem('acesso', { hash: cofre.hashSenhaAtual() });
  if (cofre.temChaveGravada()) await publicarChave(); // o envelope foi recifrado com a senha nova
  status(
    $('config-status'),
    publicada ? 'Senha alterada em todos os aparelhos.' : 'Senha alterada neste aparelho — a nuvem não respondeu.',
    publicada ? 'ok' : 'erro',
  );
}

// ------------------------------------------------------------------ sincronia

function ligarSincronia() {
  dados.aoMudar(desenharSincronia);
  dados.aoMudar(atualizarFolhaSeParada);
  $('sincronia').addEventListener('click', async () => {
    await dados.sincronizar({ silencioso: false });
    if (!$('painel').hidden) desenharPainel();
    else await carregarDia($('campo-data').value, { manterEdicao: true });
  });
  desenharSincronia();
}

/** Redesenha a folha quando chega lançamento novo — sem atropelar quem está digitando. */
function atualizarFolhaSeParada() {
  if (!estado.desbloqueado || estado.alterado || !$('painel').hidden) return;
  const data = $('campo-data').value;
  if (!data) return;
  const doDia = dados.doDia(data);
  const assinatura = JSON.stringify(doDia.map((l) => [l.id, l.atualizadoEm]));
  if (assinatura === estado.assinaturaDoDia) return;
  estado.assinaturaDoDia = assinatura;
  carregarDia(data);
}

function desenharSincronia() {
  const { situacao, pendentes, em } = dados.estadoSincronia;
  const botao = $('sincronia');
  const horario = em ? em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

  const textos = {
    sincronizando: '⏳ sincronizando…',
    ok: pendentes ? `⚠ ${pendentes} pendente(s)` : `☁ ${horario}`,
    erro: `⚠ ${pendentes} pendente(s)`,
    offline: `📵 ${pendentes} no aparelho`,
    ocioso: '☁ —',
  };
  botao.textContent = textos[situacao] || textos.ocioso;
  botao.classList.toggle('alerta', situacao === 'erro' || situacao === 'offline' || pendentes > 0);
  botao.title = dados.estadoSincronia.mensagem || 'Sincronizar agora';
}

// ------------------------------------------------------------------ folha do dia

async function carregarDia(data, { manterEdicao = false } = {}) {
  if (!data) return;
  if (manterEdicao && estado.alterado) return;

  const lancamentos = dados.doDia(data);
  estado.assinaturaDoDia = JSON.stringify(lancamentos.map((l) => [l.id, l.atualizadoEm]));
  planilha.aplicarDia(lancamentos);
  atualizarColunasDaImportacao();

  const comResponsavel = lancamentos.find((l) => l.responsavel);
  if (comResponsavel) $('campo-responsavel').value = comResponsavel.responsavel;
  const comObservacoes = lancamentos.find((l) => l.observacoes);
  $('campo-observacoes').value = comObservacoes?.observacoes || '';

  marcarSalvo();
}

async function salvarDia() {
  const data = $('campo-data').value;
  if (!data) {
    avisar('Informe a data do controle.', 'erro');
    return;
  }

  const responsavel = $('campo-responsavel').value.trim();
  const observacoes = $('campo-observacoes').value.trim();
  const dia = planilha.lerDia();
  const existentes = new Map(dados.doDia(data).map((l) => [l.id, l]));
  const paraSalvar = [];

  for (const coluna of dia.colunas) {
    if (coluna.itens.length) {
      const novo = {
        id: coluna.id,
        data,
        hora: coluna.hora || '',
        responsavel,
        tipo: 'producao',
        origem: 'manual',
        observacoes,
        itens: coluna.itens,
      };
      if (mudou(existentes.get(coluna.id), novo)) paraSalvar.push(novo);
    } else if (existentes.has(coluna.id)) {
      dados.remover(coluna.id); // horário esvaziado na tela
    }
  }

  const idPerda = await dados.idDaPerda(data);
  if (dia.perdas.length) {
    const perda = { id: idPerda, data, hora: '', responsavel, tipo: 'perda', origem: 'manual', itens: dia.perdas };
    if (mudou(existentes.get(idPerda), perda)) paraSalvar.push(perda);
  } else if (existentes.has(idPerda)) {
    dados.remover(idPerda);
  }

  if (!paraSalvar.length && !existentes.size) {
    avisar('Nada para salvar: a folha está vazia.', 'erro');
    return;
  }

  if (paraSalvar.length) dados.salvar(paraSalvar);
  marcarSalvo();
  avisar(
    paraSalvar.length
      ? `${paraSalvar.length} lançamento(s) salvos. Veja o histórico no Painel.`
      : 'Nada mudou desde o último salvamento.',
    'ok',
  );
}

/** Um lançamento só é regravado quando o horário ou as quantidades mudaram. */
function mudou(anterior, novo) {
  if (!anterior) return true;
  const chave = (l) => JSON.stringify([l.hora || '', (l.itens || []).map((i) => [i.produtoId, i.nome, i.quantidade]).sort()]);
  return chave(anterior) !== chave(novo) || (anterior.responsavel || '') !== (novo.responsavel || '');
}

// ------------------------------------------------------------------ importação

function atualizarColunasDaImportacao() {
  const select = $('imp-coluna');
  const anterior = select.value;
  select.innerHTML = '';
  planilha.colunas().forEach((coluna, i) => {
    select.add(new Option(`Produção ${i + 1}${coluna.hora ? ` — ${coluna.hora}` : ''}`, coluna.id));
  });
  if ([...select.options].some((o) => o.value === anterior)) select.value = anterior;
}

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
  atualizarColunasDaImportacao();
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
  const linhas = [...$('corpo-resultado').querySelectorAll('tr')].filter((tr) => tr.querySelector('.aplicar').checked);
  let aplicadas = 0;

  if (estado.tipoAnalise === 'planilha') {
    const iso = dataBrParaIso(estado.analise.data);
    if (iso) $('campo-data').value = iso;
    if (estado.analise.responsavel) $('campo-responsavel').value = estado.analise.responsavel;

    // uma coluna para cada horário lido na foto da folha
    const horas = (estado.analise.horas || []).map((h) => (/^\d{1,2}:\d{2}$/.test(h || '') ? h.padStart(5, '0') : ''));
    const usadas = [0, 1, 2].filter((i) => linhas.some((tr) => Number(tr.querySelector(`.v${i + 1}`).value) > 0));
    planilha.definirColunas(usadas.map((i) => ({ id: crypto.randomUUID(), hora: horas[i] || '' })));
    const colunas = planilha.colunas();

    for (const tr of linhas) {
      const id = tr.dataset.produto;
      const ehProduto = id && id !== 'outro' && PRODUTOS_POR_ID[id];
      usadas.forEach((indiceOriginal, posicao) => {
        const valor = Number(tr.querySelector(`.v${indiceOriginal + 1}`).value) || 0;
        if (!valor) return;
        if (ehProduto) planilha.lancarProduto(id, colunas[posicao].id, valor, modo);
        else planilha.lancarLivre(tr.dataset.rotulo || 'Outro produto', colunas[posicao].id, valor, modo);
      });
      const perdido = Number(tr.querySelector('.vp').value) || 0;
      if (ehProduto && perdido) planilha.definirPerdido(id, perdido);
      aplicadas += 1;
    }
  } else {
    const colunaId = $('imp-coluna').value;
    if (modo === 'substituir') planilha.limparColuna(colunaId);
    for (const tr of linhas) {
      const quantidade = Number(tr.querySelector('.v1').value) || 0;
      if (!quantidade) continue;
      const id = tr.dataset.produto;
      if (PRODUTOS_POR_ID[id]) planilha.lancarProduto(id, colunaId, quantidade, modo);
      else planilha.lancarLivre(tr.dataset.rotulo || 'Não identificado', colunaId, quantidade, modo);
      aplicadas += 1;
    }
  }

  planilha.recalcular();
  marcarAlterado();
  atualizarColunasDaImportacao();
  $('dlg-importar').close();
  avisar(`${aplicadas} linha(s) lançada(s). Confira e clique em Salvar lançamentos.`, 'ok');
}

// ------------------------------------------------------------------ ações da folha

function ligarAcoes() {
  $('btn-salvar').addEventListener('click', salvarDia);

  $('btn-nova-coluna').addEventListener('click', () => {
    const coluna = planilha.adicionarColuna();
    if (!coluna) {
      avisar('Limite de horários por dia atingido.', 'erro');
      return;
    }
    atualizarColunasDaImportacao();
  });

  $('campo-data').addEventListener('change', async () => {
    if (estado.alterado && !confirm('Há lançamentos não salvos. Trocar de dia mesmo assim?')) return;
    marcarSalvo();
    await carregarDia($('campo-data').value);
  });

  for (const campo of ['campo-responsavel', 'campo-observacoes']) {
    $(campo).addEventListener('input', marcarAlterado);
  }

  $('btn-csv').addEventListener('click', () => {
    planilha.baixarArquivo(
      `controle-diario-${$('campo-data').value || 'sem-data'}.csv`,
      planilha.diaParaCsv({
        data: $('campo-data').value,
        responsavel: $('campo-responsavel').value,
        observacoes: $('campo-observacoes').value,
      }),
    );
  });

  $('btn-imprimir').addEventListener('click', () => window.print());

  $('btn-limpar').addEventListener('click', () => {
    if (!confirm('Limpar os campos da folha? (os lançamentos já salvos continuam guardados)')) return;
    planilha.limparTudo();
    $('campo-observacoes').value = '';
    marcarAlterado();
  });
}

// ------------------------------------------------------------------ painel

const filtros = { de: '', ate: '', responsavel: '', produto: '' };

function ligarPainel() {
  $('btn-ver-folha').addEventListener('click', () => mostrarVista('folha'));
  $('btn-ver-painel').addEventListener('click', () => mostrarVista('painel'));

  for (const campo of ['filtro-de', 'filtro-ate', 'filtro-responsavel', 'filtro-produto']) {
    $(campo).addEventListener('change', () => {
      filtros.de = $('filtro-de').value;
      filtros.ate = $('filtro-ate').value;
      filtros.responsavel = $('filtro-responsavel').value;
      filtros.produto = $('filtro-produto').value;
      desenharPainel();
    });
  }

  $('filtro-atalhos').addEventListener('click', (e) => {
    const botao = e.target.closest('button');
    if (!botao) return;
    aplicarAtalho(botao.dataset);
    for (const outro of $('filtro-atalhos').querySelectorAll('button')) outro.classList.remove('ativo');
    botao.classList.add('ativo');
    desenharPainel();
  });

  $('btn-csv-periodo').addEventListener('click', exportarPeriodo);
  $('btn-exportar-tudo').addEventListener('click', () => {
    planilha.baixarArquivo('lancamentos-nuestro-gusto.json', dados.exportarTudo(), 'application/json');
  });

  let redesenhar = null;
  window.addEventListener('resize', () => {
    if ($('painel').hidden) return;
    clearTimeout(redesenhar);
    redesenhar = setTimeout(desenharPainel, 200);
  });
}

function mostrarVista(vista) {
  const noPainel = vista === 'painel';
  $('folha').hidden = noPainel;
  $('painel').hidden = !noPainel;
  $('btn-ver-folha').classList.toggle('ativo', !noPainel);
  $('btn-ver-painel').classList.toggle('ativo', noPainel);
  if (noPainel) {
    prepararFiltros();
    desenharPainel();
  }
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

function diasAtras(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias + 1);
  return d.toISOString().slice(0, 10);
}

function aplicarAtalho({ dias, mes, tudo }) {
  if (dias) {
    filtros.de = diasAtras(Number(dias));
    filtros.ate = hojeIso();
  } else if (mes) {
    filtros.de = `${hojeIso().slice(0, 7)}-01`;
    filtros.ate = hojeIso();
  } else if (tudo) {
    filtros.de = '';
    filtros.ate = '';
  }
  $('filtro-de').value = filtros.de;
  $('filtro-ate').value = filtros.ate;
}

function prepararFiltros() {
  const lancamentos = dados.listar();

  const responsaveis = [...new Set(lancamentos.map((l) => l.responsavel).filter(Boolean))].sort();
  const selResponsavel = $('filtro-responsavel');
  selResponsavel.innerHTML = '<option value="">Todos</option>';
  for (const nome of responsaveis) selResponsavel.add(new Option(nome, nome));
  selResponsavel.value = filtros.responsavel;

  const selProduto = $('filtro-produto');
  if (selProduto.options.length <= 1) {
    for (const secao of SECOES) {
      selProduto.add(new Option(`Seção: ${secao.titulo}`, `secao:${secao.id}`));
      const grupo = document.createElement('optgroup');
      grupo.label = secao.titulo;
      for (const produto of secao.produtos) grupo.appendChild(new Option(produto.nome, produto.id));
      selProduto.appendChild(grupo);
    }
    selProduto.add(new Option('Outros produtos (linhas livres)', 'livres'));
  }
  selProduto.value = filtros.produto;
}

const lancamentosFiltrados = () => painel.filtrar(dados.listar(), filtros);

function desenharPainel() {
  const lancamentos = lancamentosFiltrados();
  const resumo = painel.agregar(lancamentos);

  painel.indicadores($('kpis'), resumo.totais);
  painel.graficoDias($('area-dias'), resumo.porDia);
  painel.graficoHoras($('area-horas'), resumo.porHora);
  painel.graficoProdutos($('area-produtos'), resumo.porProduto);
  $('legenda-dias').hidden = !resumo.porDia.length;
  montarTabelaPainel(lancamentos);
}

function montarTabelaPainel(lancamentos) {
  const corpo = $('corpo-painel');
  corpo.innerHTML = '';
  $('painel-vazio').hidden = lancamentos.length > 0;

  for (const lancamento of lancamentos) {
    const tr = document.createElement('tr');
    tr.appendChild(celula(dataBr(lancamento.data)));
    tr.appendChild(celula(lancamento.hora || '—'));
    tr.appendChild(celula(lancamento.tipo === 'perda' ? 'Perda' : 'Produção'));
    tr.appendChild(celula(lancamento.responsavel || '—'));
    tr.appendChild(celula((lancamento.itens || []).length));
    tr.appendChild(celula(painel.totalDoLancamento(lancamento)));
    tr.appendChild(celula(lancamento.dispositivo || '—'));

    const acoes = document.createElement('td');
    acoes.className = 'acoes-linha';

    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'btn btn-pequeno';
    abrir.textContent = 'Abrir dia';
    abrir.addEventListener('click', async () => {
      $('campo-data').value = lancamento.data;
      await carregarDia(lancamento.data);
      mostrarVista('folha');
      avisar('Dia carregado na folha.', 'ok');
    });

    const excluir = document.createElement('button');
    excluir.type = 'button';
    excluir.className = 'btn btn-pequeno btn-perigo';
    excluir.textContent = 'Excluir';
    excluir.addEventListener('click', () => {
      if (!confirm('Excluir este lançamento? Ele some também nos outros aparelhos.')) return;
      dados.remover(lancamento.id);
      desenharPainel();
    });

    acoes.append(abrir, excluir);
    tr.appendChild(acoes);
    corpo.appendChild(tr);
  }
}

const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

function exportarPeriodo() {
  const lancamentos = lancamentosFiltrados();
  if (!lancamentos.length) {
    avisar('Nada para exportar no período selecionado.', 'erro');
    return;
  }

  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [['Data', 'Hora', 'Tipo', 'Responsável', 'Produto', 'Quantidade', 'Aparelho'].map(escapar).join(';')];

  for (const l of lancamentos) {
    for (const item of l.itens || []) {
      linhas.push(
        [dataBr(l.data), l.hora, l.tipo === 'perda' ? 'Perda' : 'Produção', l.responsavel, item.nome, item.quantidade, l.dispositivo]
          .map(escapar)
          .join(';'),
      );
    }
  }

  const periodo = `${filtros.de || 'inicio'}_a_${filtros.ate || 'hoje'}`;
  planilha.baixarArquivo(`lancamentos-${periodo}.csv`, linhas.join('\n'));
}

iniciar();
