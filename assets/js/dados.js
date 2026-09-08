// Repositório dos lançamentos: guarda tudo localmente (funciona sem internet)
// e sincroniza com a nuvem, para que qualquer celular ou navegador veja o
// mesmo histórico. Cada lançamento é um horário de produção.

import * as nuvem from './nuvem.js';

const CHAVE_LANCAMENTOS = 'nuestro_gusto:lancamentos';
const CHAVE_SINCRONIA = 'nuestro_gusto:sincronizado_em';
const CHAVE_DISPOSITIVO = 'nuestro_gusto:dispositivo';
const CHAVE_ANTIGA = 'nuestro_gusto:registros';

const ouvintes = new Set();

export const estadoSincronia = {
  situacao: 'ocioso', // ocioso | sincronizando | ok | erro | offline
  pendentes: 0,
  em: null,
  mensagem: '',
};

export function aoMudar(callback) {
  ouvintes.add(callback);
  return () => ouvintes.delete(callback);
}

function avisarMudanca() {
  estadoSincronia.pendentes = ler().filter((l) => l.pendente).length;
  for (const callback of ouvintes) callback();
}

// ------------------------------------------------------------------ identidade

/** Nome do aparelho, para saber de onde veio cada lançamento. */
export function dispositivo() {
  let nome = localStorage.getItem(CHAVE_DISPOSITIVO);
  if (!nome) {
    const movel = /Android|iPhone|iPad/i.test(navigator.userAgent);
    nome = `${movel ? 'Celular' : 'Computador'} ${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(CHAVE_DISPOSITIVO, nome);
  }
  return nome;
}

export function definirDispositivo(nome) {
  localStorage.setItem(CHAVE_DISPOSITIVO, nome.trim() || dispositivo());
  avisarMudanca();
}

export const novoId = () => crypto.randomUUID();

/**
 * Identificador estável para as perdas de um dia: todos os aparelhos escrevem
 * na mesma linha, em vez de criar uma perda duplicada por celular.
 */
export async function idDaPerda(data) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nuestro-perda-${data}`));
  const b = [...new Uint8Array(digest)].slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante
  const hex = b.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------------ local

function ler() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_LANCAMENTOS) || '[]');
  } catch {
    return [];
  }
}

function gravar(lancamentos) {
  localStorage.setItem(CHAVE_LANCAMENTOS, JSON.stringify(lancamentos));
}

/** Lançamentos ativos (sem os excluídos), do mais recente para o mais antigo. */
export function listar() {
  return ler()
    .filter((l) => !l.removido)
    .sort((a, b) => `${b.data} ${b.hora}`.localeCompare(`${a.data} ${a.hora}`));
}

export function doDia(data) {
  return listar()
    .filter((l) => l.data === data)
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
}

/** Grava (ou atualiza) lançamentos e agenda o envio para a nuvem. */
export function salvar(lancamentos) {
  const atuais = ler();
  const agora = new Date().toISOString();

  for (const lancamento of lancamentos) {
    const indice = atuais.findIndex((l) => l.id === lancamento.id);
    const anterior = indice >= 0 ? atuais[indice] : null;
    const completo = {
      origem: 'manual',
      tipo: 'producao',
      observacoes: '',
      removido: false,
      ...lancamento,
      // o aparelho e a criação são de quem lançou primeiro, não de quem editou depois
      dispositivo: anterior?.dispositivo || dispositivo(),
      criadoEm: anterior?.criadoEm || agora,
      atualizadoEm: agora,
      pendente: true,
    };
    if (anterior) atuais[indice] = { ...anterior, ...completo };
    else atuais.push(completo);
  }

  gravar(atuais);
  avisarMudanca();
  sincronizar();
  return lancamentos;
}

/** Exclusão lógica: some das telas e a remoção se propaga para os outros aparelhos. */
export function remover(id) {
  const atuais = ler();
  const alvo = atuais.find((l) => l.id === id);
  if (!alvo) return;
  alvo.removido = true;
  alvo.pendente = true;
  alvo.atualizadoEm = new Date().toISOString();
  gravar(atuais);
  avisarMudanca();
  sincronizar();
}

// ------------------------------------------------------------------ sincronia

let sincronizando = null;

export async function sincronizar({ silencioso = true } = {}) {
  if (!nuvem.configurada()) return { situacao: 'ocioso' };
  if (sincronizando) return sincronizando;

  estadoSincronia.situacao = 'sincronizando';
  if (!silencioso) estadoSincronia.mensagem = 'Sincronizando…';
  avisarMudanca();

  sincronizando = (async () => {
    try {
      const pendentes = ler().filter((l) => l.pendente);
      if (pendentes.length) {
        await nuvem.enviar(pendentes);
        const atuais = ler();
        for (const enviado of pendentes) {
          const local = atuais.find((l) => l.id === enviado.id);
          if (local && local.atualizadoEm === enviado.atualizadoEm) local.pendente = false;
        }
        gravar(atuais);
      }

      const desde = localStorage.getItem(CHAVE_SINCRONIA) || '';
      const recebidos = await nuvem.baixar(desde);
      if (recebidos.length) mesclar(recebidos);

      estadoSincronia.situacao = 'ok';
      estadoSincronia.em = new Date();
      estadoSincronia.mensagem = '';
      return { situacao: 'ok', enviados: pendentes.length, recebidos: recebidos.length };
    } catch (erro) {
      estadoSincronia.situacao = navigator.onLine ? 'erro' : 'offline';
      estadoSincronia.mensagem = navigator.onLine ? erro.message : 'Sem internet — os lançamentos ficam guardados no aparelho.';
      return { situacao: estadoSincronia.situacao, erro: erro.message };
    } finally {
      sincronizando = null;
      avisarMudanca();
    }
  })();

  return sincronizando;
}

/** Junta o que veio da nuvem com o que está no aparelho (vence o mais recente). */
function mesclar(recebidos) {
  const atuais = ler();
  const porId = new Map(atuais.map((l) => [l.id, l]));
  let maisRecente = localStorage.getItem(CHAVE_SINCRONIA) || '';

  for (const remoto of recebidos) {
    if (remoto.atualizadoEm > maisRecente) maisRecente = remoto.atualizadoEm;
    const local = porId.get(remoto.id);
    if (!local) {
      porId.set(remoto.id, remoto);
    } else if (!local.pendente || remoto.atualizadoEm > local.atualizadoEm) {
      porId.set(remoto.id, { ...remoto, pendente: false });
    }
  }

  gravar([...porId.values()]);
  if (maisRecente) localStorage.setItem(CHAVE_SINCRONIA, maisRecente);
}

/** Liga a sincronia automática: ao voltar a internet e de tempos em tempos. */
let automaticaLigada = false;

export function iniciarSincroniaAutomatica(intervaloSegundos = 90) {
  if (automaticaLigada) return sincronizar();
  automaticaLigada = true;
  window.addEventListener('online', () => sincronizar());
  setInterval(() => {
    if (navigator.onLine && document.visibilityState === 'visible') sincronizar();
  }, intervaloSegundos * 1000);
  sincronizar();
}

// ------------------------------------------------------------------ migração

/** Converte os controles diários antigos (Produção 1/2/3) em lançamentos por hora. */
export async function migrarControlesAntigos() {
  let antigos;
  try {
    antigos = JSON.parse(localStorage.getItem(CHAVE_ANTIGA) || '[]');
  } catch {
    return 0;
  }
  if (!antigos.length) return 0;

  const novos = [];

  for (const registro of antigos) {
    if (!registro.data) continue;

    for (const coluna of [1, 2, 3]) {
      const itens = (registro.linhas || [])
        .filter((l) => l[`p${coluna}`] > 0)
        .map((l) => ({ produtoId: l.produtoId || null, nome: l.nome, quantidade: l[`p${coluna}`] }));
      if (!itens.length) continue;
      novos.push({
        id: novoId(),
        data: registro.data,
        hora: (registro.horas || [])[coluna - 1] || '',
        responsavel: registro.responsavel || '',
        tipo: 'producao',
        origem: 'migracao',
        itens,
        observacoes: registro.observacoes || '',
      });
    }

    const perdas = (registro.linhas || [])
      .filter((l) => l.perdido > 0)
      .map((l) => ({ produtoId: l.produtoId || null, nome: l.nome, quantidade: l.perdido }));
    if (perdas.length) {
      novos.push({
        id: await idDaPerda(registro.data),
        data: registro.data,
        hora: '',
        responsavel: registro.responsavel || '',
        tipo: 'perda',
        origem: 'migracao',
        itens: perdas,
      });
    }
  }

  if (novos.length) salvar(novos);
  localStorage.setItem(`${CHAVE_ANTIGA}_backup`, localStorage.getItem(CHAVE_ANTIGA));
  localStorage.removeItem(CHAVE_ANTIGA);
  return novos.length;
}

export function exportarTudo() {
  return JSON.stringify(listar(), null, 2);
}
