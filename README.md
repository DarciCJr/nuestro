# Nuestro Gusto — Controle Diário de Produção com análise de imagem (Claude)

Aplicação web **100% estática** (sem servidor, sem build) que reproduz a folha impressa
*PRODUÇÃO — CONTROLE DIÁRIO* e permite **preencher a planilha automaticamente a partir de uma foto**,
usando a API da Claude (Anthropic).

A foto é sempre da **bandeja ou da vitrine**: o sistema conta as medialunas por sabor (doce de leite,
chocolate, chocolate branco, avelã com nozes, pistacho, goiabada…) e lança as quantidades no horário
escolhido. Dá para **tirar a foto na hora** (abre a câmera traseira) ou **escolher uma imagem do
celular**.

Depois da análise, os itens aparecem numa tela de conferência (com quantidade editável, nível de
confiança e caixa de seleção por linha) — nada é lançado sem revisão. Em seguida é possível
**cadastrar o controle**, acompanhar tudo no **Painel**, exportar **CSV/JSON** e **imprimir** a folha.

## Painel

A aba **Painel** reúne os controles já cadastrados:

- **Filtros**: período (atalhos de 7 dias, 30 dias, este mês, tudo — ou datas escolhidas à mão),
  responsável e produto (um produto, uma seção inteira ou as linhas livres).
- **Indicadores**: produzido, perdido, resultado, % de perda, média por dia e dias com registro.
- **Produção por dia**: colunas empilhadas (resultado + perdido = produzido), com detalhe ao tocar/passar o mouse.
- **Produção por hora**: soma das reposições por faixa de horário no período.
- **Produtos mais produzidos** no período, em ranking.
- **Tabela dos lançamentos** (data, hora, tipo, responsável, quantidade e aparelho de origem; 📷 marca
  o que veio de foto), com
  botão para reabrir o dia na folha ou excluir o lançamento, além de exportar o período em CSV.

## Lançamentos por hora e sincronia entre aparelhos

A folha do dia tem **uma coluna por horário de reposição**. Ao salvar, **cada coluna vira um
lançamento** guardado em JSON — e a folha já abre o **próximo horário em branco**, para a fornada
seguinte virar um lançamento novo em vez de sobrescrever o anterior. As colunas já gravadas ficam
marcadas com ✓ (editar ali corrige aquele lançamento; o × exclui de vez, em todos os aparelhos);
a coluna em amarelo é a que ainda não foi salva. O botão *Novo horário* serve para abrir mais de um
horário antes de salvar.

```json
{
  "id": "uuid",
  "data": "2026-09-08",
  "hora": "08:00",
  "responsavel": "Carlos",
  "tipo": "producao",          // ou "perda"
  "origem": "manual",          // manual | imagem | migracao
  "dispositivo": "Celular da produção",
  "itens": [{ "produtoId": "medialuna_doce_de_leite", "nome": "…", "quantidade": 14 }]
}
```

### Onde os dados ficam

Os lançamentos são gravados **no aparelho** (`localStorage`) **e na nuvem** (Supabase), então qualquer
celular ou navegador com a senha vê o mesmo histórico:

- **Funciona offline.** Sem internet, o lançamento fica guardado no aparelho e o indicador no topo
  mostra quantos estão pendentes; assim que a conexão volta, ele sobe sozinho.
- **Sincronia automática** ao entrar, ao salvar, a cada 90 s e quando a internet volta. O botão
  ☁ no topo força a sincronia na hora. A primeira sincronia é aguardada antes de desenhar a folha,
  para o dia não aparecer vazio num aparelho que ainda não baixou nada; depois disso, lançamento novo
  vindo de outro aparelho entra na folha sozinho (nunca por cima de quem está digitando).
- **Junção entre aparelhos**: cada horário é uma linha própria (dois celulares podem lançar 08:00 e
  11:30 no mesmo dia sem se atropelar); as **perdas do dia** têm um identificador derivado da data,
  então todos escrevem na mesma linha em vez de duplicá-la. Em caso de edição simultânea, vale a
  gravação mais recente.
- **Exclusão** é lógica (`removido`), para que sumir num aparelho suma nos outros.

### Instalar no celular (PWA)

A página é instalável: no celular, *Adicionar à tela de início* (Android: menu do Chrome; iPhone:
Compartilhar → Adicionar à Tela de Início) cria o atalho com ícone próprio e abre em tela cheia, sem
barra do navegador. Um *service worker* ([`sw.js`](sw.js)) guarda os arquivos do app: online sempre
busca a versão mais nova (rede primeiro), e sem sinal ele abre pelo que está guardado — os
lançamentos feitos offline ficam na fila e sobem depois.

### Chave da API e senha compartilhadas

Cadastrar a chave uma vez basta para a padaria inteira:

- Ao salvar, a chave é cifrada com a senha de acesso (PBKDF2 + AES-GCM) e só o **envelope cifrado**
  sobe para a linha `api_claude` da tabela `nuestro_config` — o banco nunca vê a chave em claro.
- Quem entra em qualquer aparelho baixa esse envelope e o abre com a senha; a chave fica só na
  memória da aba. O modelo e o esforço escolhidos viajam junto.
- **Trocar a senha** vale para todos: o novo hash vai para a linha `acesso` e o envelope é recifrado
  com a senha nova. **Remover a chave** também remove da nuvem.
- Sem internet, cada aparelho continua com o que já tinha gravado localmente.
- Se um aparelho abriu antes de a chave existir, ele **busca de novo** ao tentar analisar uma foto ou
  ao abrir Configurações — não precisa recarregar a página nem cadastrar de novo.
- Um aparelho que tenha a chave só localmente (cadastro anterior à nuvem) a **publica sozinho** no
  próximo login ou ao abrir Configurações.

> Como a senha do app é a única coisa que protege esse envelope, vale trocar a senha padrão por uma
> que não circule fora da equipe (Configurações → Alterar senha de acesso).

### Banco de dados

Tabelas `public.nuestro_lancamentos` (os lançamentos) e `public.nuestro_config` (chave da API cifrada
e senha de acesso) no projeto Supabase configurado em
[`assets/js/config.js`](assets/js/config.js) — trocar de projeto é trocar `url` e `chave` ali.
A tabela tem RLS ligado com políticas de leitura/gravação para a chave publicável (não há política de
`delete`; a exclusão é o campo `removido`). A migração que a cria está versionada no próprio Supabase
com o nome `nuestro_gusto_lancamentos`.

A chave que fica no código é a **publicável** — ela é feita para aparecer no navegador. Na prática isso
significa que a porta da nuvem é a senha do app: quem chegasse ao endereço do site conseguiria ler e
gravar os lançamentos de produção. Para fechar isso de vez, o caminho é login de verdade (Supabase Auth)
com as políticas exigindo usuário autenticado — dá para fazer depois sem mexer no resto.

Controles cadastrados no formato antigo (Produção 1/2/3 num registro por dia) são **convertidos
automaticamente** em lançamentos por hora no primeiro acesso, e o formato antigo fica guardado como
backup em `nuestro_gusto:registros_backup`.

## Como usar

1. Abra a página (localmente ou pelo GitHub Pages — veja abaixo). O sistema abre numa
   **tela de senha** — nada aparece antes de entrar (senha padrão: `Araxa@2019`).
   O botão **🔒 Bloquear**, no topo, trava tudo de novo e descarta a chave da memória.
2. Clique em **Configurações**.
3. Cole a **chave da API da Claude** (`sk-ant-…`), escolha o modelo e clique em **Salvar chave**.
   Isso é feito **uma vez só**: a chave sobe cifrada para a nuvem e todo aparelho que entrar com a
   senha passa a usá-la, sem precisar cadastrar de novo. Use **Testar conexão** para confirmar.
   A chave é obtida em <https://console.anthropic.com/settings/keys>.
4. Na folha, toque em **📷 Importar imagem e analisar**, escolha entre *Tirar foto agora* e
   *Escolher do celular*, confira o horário de destino (já vem o horário novo) e se os valores devem
   **substituir** ou **somar** ao que já está lançado.
5. Confira o resultado e clique em **Aplicar na planilha**.
6. **Cadastrar controle** grava o dia no histórico (armazenamento do próprio navegador).

TOTAL e RESULTADO são calculados sozinhos: `TOTAL = Produção 1 + 2 + 3` e `RESULTADO = TOTAL − PERDIDO`.

## Rodando localmente

A página usa módulos ES, então precisa ser servida por HTTP (abrir o arquivo direto com `file://` não funciona):

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Publicando no GitHub Pages (página de teste no ar)

Sim — dá para colocar no ar direto pelo GitHub, sem contratar hospedagem, e só depois apontar
para um domínio/hospedagem definitiva.

1. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**
   (esse passo é manual — o token do Actions não tem permissão para ligar o Pages sozinho).
2. **Actions → Publicar no GitHub Pages → Run workflow** (ou faça um novo push). O workflow
   [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica a pasta inteira.
3. A URL aparece no fim do run e em **Settings → Pages**
   (formato `https://<usuário>.github.io/<repositório>/`).

> **Repositório privado:** publicar Pages a partir de um repositório privado exige plano pago
> (GitHub Pro/Team/Enterprise). No plano gratuito, torne o repositório público
> (**Settings → General → Change visibility**) — a chave da API **não** fica no código, então o
> código-fonte pode ser público sem expor credenciais.

Alternativa sem Actions: **Settings → Pages → Source: Deploy from a branch**, escolhendo a branch e a pasta `/ (root)`.

Para um domínio próprio depois, é só apontar o DNS e preencher o campo **Custom domain** na mesma tela —
ou copiar os arquivos para qualquer hospedagem estática (Netlify, Vercel, Cloudflare Pages, hospedagem comum).

## Segurança — leia antes de publicar

Esta versão foi feita para **teste**, e por isso conversa direto do navegador com a API da Claude:

- A senha protege a entrada do sistema e é a mesma que abre o cofre da chave: enquanto ninguém entra,
  a chave nem é decifrada. Ao recarregar a página ou clicar em **Bloquear**, a chave sai da memória.
- A chave fica **criptografada** no navegador (AES-GCM, senha derivada por PBKDF2 com 210 mil iterações)
  e só é decifrada com a senha de acesso. Ela **não** vai para o repositório nem para servidores próprios.
- Ainda assim, quem usar aquele navegador com a senha em mãos consegue usar a chave, e a chave trafega
  do navegador para `api.anthropic.com`. A senha da tela é um **controle de acesso operacional**, não uma
  barreira criptográfica contra alguém que já tenha acesso à máquina.
- Para uso em produção, o caminho correto é um **backend** (Cloudflare Worker, Vercel Function, etc.) que
  guarde a chave do lado do servidor e receba apenas a imagem. A camada de análise
  (`assets/js/claude.js`) já está isolada justamente para essa troca.
- Cada análise consome tokens da conta. A imagem é reduzida para 1568 px no lado maior antes do envio,
  o que reduz bastante o custo.

## Estrutura

```
index.html                     folha, modais de configuração/importação/histórico
assets/css/estilo.css          layout inspirado na folha impressa (inclui estilo de impressão)
assets/js/produtos.js          catálogo de produtos + descrição visual usada no prompt
assets/js/claude.js            chamadas à API da Claude (SDK oficial via CDN, structured outputs)
assets/js/imagem.js            redimensionamento e conversão da foto para base64
assets/js/cofre.js             senha de acesso e criptografia da chave da API
assets/js/planilha.js          folha do dia: colunas por horário, cálculos e exportações
assets/js/dados.js             lançamentos: armazenamento local, fila offline e sincronia
assets/js/nuvem.js             acesso REST à tabela do Supabase
assets/js/config.js            endereço e chave publicável da nuvem
assets/js/painel.js            agregações, filtros e gráficos do painel (SVG puro)
sw.js                          service worker (abre offline, rede primeiro)
manifest.webmanifest           dados do app instalável no celular
assets/icones/                 ícones do atalho na tela de início
assets/js/app.js               ligação da interface
.github/workflows/pages.yml    publicação automática no GitHub Pages
```

## Detalhes técnicos da integração

- Modelo padrão: **`claude-opus-5`** (também dá para escolher Sonnet 5 ou Haiku 4.5 nas configurações).
- **Structured outputs** (`output_config.format` com JSON Schema): a resposta já chega como JSON válido
  com o `produto_id` restrito ao catálogo — sem parsing frágil de texto.
- **Adaptive thinking** ligado e `effort` configurável: contar peças sobrepostas numa bandeja é tarefa
  que se beneficia de raciocínio.
- SDK oficial `@anthropic-ai/sdk` carregado por ESM/CDN com `dangerouslyAllowBrowser: true`
  (necessário para chamadas feitas do navegador).
