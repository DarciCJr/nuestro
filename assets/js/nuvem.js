// Acesso à tabela de lançamentos no Supabase (REST puro, sem SDK).

import { NUVEM } from './config.js';

const endereco = `${NUVEM.url}/rest/v1/${NUVEM.tabela}`;
const enderecoConfig = `${NUVEM.url}/rest/v1/${NUVEM.tabelaConfig}`;

const cabecalhos = (extra = {}) => ({
  apikey: NUVEM.chave,
  Authorization: `Bearer ${NUVEM.chave}`,
  'Content-Type': 'application/json',
  ...extra,
});

export function configurada() {
  return Boolean(NUVEM.url && NUVEM.chave);
}

/** Converte o formato do banco (snake_case) para o usado no app. */
function paraApp(linha) {
  return {
    id: linha.id,
    data: linha.data,
    hora: linha.hora || '',
    responsavel: linha.responsavel || '',
    tipo: linha.tipo || 'producao',
    origem: linha.origem || 'manual',
    dispositivo: linha.dispositivo || '',
    itens: linha.itens || [],
    observacoes: linha.observacoes || '',
    removido: Boolean(linha.removido),
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
    pendente: false,
  };
}

function paraBanco(lancamento) {
  return {
    id: lancamento.id,
    data: lancamento.data,
    hora: lancamento.hora || '',
    responsavel: lancamento.responsavel || '',
    tipo: lancamento.tipo || 'producao',
    origem: lancamento.origem || 'manual',
    dispositivo: lancamento.dispositivo || '',
    itens: lancamento.itens || [],
    observacoes: lancamento.observacoes || '',
    removido: Boolean(lancamento.removido),
  };
}

async function verificar(resposta) {
  if (resposta.ok) return resposta;
  const detalhe = await resposta.text().catch(() => '');
  throw new Error(`Nuvem respondeu ${resposta.status}. ${detalhe.slice(0, 200)}`);
}

/** Lança (insere ou atualiza) os registros informados. */
export async function enviar(lancamentos) {
  if (!lancamentos.length) return 0;
  const resposta = await fetch(endereco, {
    method: 'POST',
    headers: cabecalhos({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(lancamentos.map(paraBanco)),
  });
  await verificar(resposta);
  return lancamentos.length;
}

/** Baixa tudo que mudou depois de `desde` (ISO) — sem `desde`, baixa tudo. */
export async function baixar(desde) {
  const parametros = new URLSearchParams({ select: '*', order: 'atualizado_em.asc', limit: '2000' });
  if (desde) parametros.set('atualizado_em', `gt.${desde}`);

  const resposta = await fetch(`${endereco}?${parametros}`, { headers: cabecalhos() });
  await verificar(resposta);
  return (await resposta.json()).map(paraApp);
}

// ------------------------------------------------------------------ configuração

/** Lê uma linha da configuração compartilhada (chave da API, senha de acesso…). */
export async function lerConfig(chave) {
  const parametros = new URLSearchParams({ select: 'valor', chave: `eq.${chave}`, limit: '1' });
  const resposta = await fetch(`${enderecoConfig}?${parametros}`, { headers: cabecalhos() });
  await verificar(resposta);
  const linhas = await resposta.json();
  return linhas[0]?.valor || null;
}

/** Grava (ou substitui) uma linha da configuração compartilhada. */
export async function gravarConfig(chave, valor) {
  const resposta = await fetch(enderecoConfig, {
    method: 'POST',
    headers: cabecalhos({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ chave, valor }]),
  });
  await verificar(resposta);
  return true;
}
