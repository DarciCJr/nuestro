// Cofre da chave da API: guarda a chave cifrada no localStorage deste navegador.
// A senha de acesso é a mesma usada para derivar a chave de criptografia (PBKDF2 → AES-GCM),
// então sem a senha o conteúdo gravado não é utilizável.
//
// Atenção: isto protege a chave *em repouso* no navegador. Não substitui um backend —
// veja a seção "Segurança" do README.

const CHAVE_COFRE = 'nuestro_gusto:cofre';
const CHAVE_SENHA = 'nuestro_gusto:senha_hash';
const CHAVE_PREFS = 'nuestro_gusto:preferencias';

// SHA-256 da senha padrão combinada de operação ("Araxa@2019").
const HASH_SENHA_PADRAO = '4da8c5148b3932a81830485612c66f1ae7a92394bd38122c537c872eac175123';

const ITERACOES = 210000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function paraBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function deBase64(texto) {
  return Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));
}

export async function hashSenha(senha) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(senha));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function senhaCorreta(senha) {
  const esperado = localStorage.getItem(CHAVE_SENHA) || HASH_SENHA_PADRAO;
  return (await hashSenha(senha)) === esperado;
}

async function derivarChave(senha, salt) {
  const material = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERACOES, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function temChaveGravada() {
  return localStorage.getItem(CHAVE_COFRE) !== null;
}

export async function gravarChaveApi(senha, apiKey) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await derivarChave(senha, salt);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, enc.encode(apiKey));
  localStorage.setItem(
    CHAVE_COFRE,
    JSON.stringify({ v: 1, salt: paraBase64(salt), iv: paraBase64(iv), dados: paraBase64(cifrado) }),
  );
}

export async function lerChaveApi(senha) {
  const bruto = localStorage.getItem(CHAVE_COFRE);
  if (!bruto) return null;
  const { salt, iv, dados } = JSON.parse(bruto);
  const chave = await derivarChave(senha, deBase64(salt));
  try {
    const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(iv) }, chave, deBase64(dados));
    return dec.decode(aberto);
  } catch {
    throw new Error('Não foi possível abrir o cofre com esta senha.');
  }
}

export function removerChaveApi() {
  localStorage.removeItem(CHAVE_COFRE);
}

/** Envelope cifrado da chave — é o que vai para a nuvem, nunca a chave em claro. */
export function envelope() {
  const bruto = localStorage.getItem(CHAVE_COFRE);
  return bruto ? JSON.parse(bruto) : null;
}

export function aplicarEnvelope(envelopeRemoto) {
  if (!envelopeRemoto?.dados) return false;
  localStorage.setItem(CHAVE_COFRE, JSON.stringify(envelopeRemoto));
  return true;
}

/** Aceita o hash de senha vindo da nuvem, para a senha valer em todo aparelho. */
export function definirHashSenha(hash) {
  if (hash) localStorage.setItem(CHAVE_SENHA, hash);
}

export function hashSenhaAtual() {
  return localStorage.getItem(CHAVE_SENHA) || HASH_SENHA_PADRAO;
}

/** Troca a senha: reabre o cofre com a antiga e regrava com a nova. */
export async function trocarSenha(senhaAtual, novaSenha) {
  const apiKey = temChaveGravada() ? await lerChaveApi(senhaAtual) : null;
  localStorage.setItem(CHAVE_SENHA, await hashSenha(novaSenha));
  if (apiKey) await gravarChaveApi(novaSenha, apiKey);
}

export function lerPreferencias() {
  const padrao = { modelo: 'claude-opus-5', esforco: 'high' };
  try {
    return { ...padrao, ...JSON.parse(localStorage.getItem(CHAVE_PREFS) || '{}') };
  } catch {
    return padrao;
  }
}

export function gravarPreferencias(prefs) {
  localStorage.setItem(CHAVE_PREFS, JSON.stringify({ ...lerPreferencias(), ...prefs }));
}
