// Service worker: deixa o app abrir mesmo sem internet (a produção nem sempre
// tem sinal). Estratégia "rede primeiro": online sempre pega a versão nova;
// offline, cai para o que está no cache.

const CACHE = 'nuestro-gusto-v1';

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/estilo.css',
  './assets/js/app.js',
  './assets/js/planilha.js',
  './assets/js/painel.js',
  './assets/js/dados.js',
  './assets/js/nuvem.js',
  './assets/js/config.js',
  './assets/js/cofre.js',
  './assets/js/claude.js',
  './assets/js/imagem.js',
  './assets/js/produtos.js',
  './assets/icones/icone-192.png',
  './assets/icones/icone-512.png',
];

self.addEventListener('install', (evento) => {
  self.skipWaiting();
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)).catch(() => {}));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return; // nuvem e API da Claude passam direto

  evento.respondWith(
    fetch(requisicao)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(requisicao, copia)).catch(() => {});
        return resposta;
      })
      .catch(() => caches.match(requisicao).then((guardada) => guardada || caches.match('./index.html'))),
  );
});
