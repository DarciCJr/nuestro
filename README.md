# Nuestro Gusto — Controle Diário de Produção com análise de imagem (Claude)

Aplicação web **100% estática** (sem servidor, sem build) que reproduz a folha impressa
*PRODUÇÃO — CONTROLE DIÁRIO* e permite **preencher a planilha automaticamente a partir de uma foto**,
usando a API da Claude (Anthropic).

Dois tipos de foto são reconhecidos:

| Tipo | O que faz |
|---|---|
| **Bandeja / vitrine** | conta as medialunas por sabor (doce de leite, chocolate, chocolate branco, avelã com nozes, pistacho, goiabada…) e lança as quantidades numa das colunas de Produção |
| **Planilha preenchida à mão** | transcreve data, responsável, horários e todos os números escritos, inclusive as linhas de "Outros produtos" |

Depois da análise, os itens aparecem numa tela de conferência (com quantidade editável, nível de
confiança e caixa de seleção por linha) — nada é lançado sem revisão. Em seguida é possível
**cadastrar o controle**, acompanhar tudo no **Painel**, exportar **CSV/JSON** e **imprimir** a folha.

## Painel

A aba **Painel** reúne os controles já cadastrados:

- **Filtros**: período (atalhos de 7 dias, 30 dias, este mês, tudo — ou datas escolhidas à mão),
  responsável e produto (um produto, uma seção inteira ou as linhas livres).
- **Indicadores**: produzido, perdido, resultado, % de perda, média por dia e dias com registro.
- **Produção por dia**: colunas empilhadas (resultado + perdido = produzido), com detalhe ao tocar/passar o mouse.
- **Produtos mais produzidos** no período, em ranking.
- **Tabela dos controles**, com botão para reabrir um dia na folha ou excluí-lo, além de exportar
  o período em CSV.

### Onde os dados ficam salvos

Cada controle cadastrado fica no **armazenamento do próprio navegador** (`localStorage`) do aparelho
que fez o lançamento — sobrevive a recarregar a página e a fechar o app, mas **não é compartilhado**
entre celulares nem com o computador do escritório, e some se o usuário limpar os dados do navegador.

Para um histórico único da padaria (todo mundo lançando no mesmo lugar, painel consolidado), o passo
seguinte é um banco de dados — por exemplo Supabase, que também resolveria de uma vez a questão da
chave da API ficar no servidor em vez do navegador.

## Como usar

1. Abra a página (localmente ou pelo GitHub Pages — veja abaixo). O sistema abre numa
   **tela de senha** — nada aparece antes de entrar (senha padrão: `Araxa@2019`).
   O botão **🔒 Bloquear**, no topo, trava tudo de novo e descarta a chave da memória.
2. Clique em **Configurações**.
3. Cole a **chave da API da Claude** (`sk-ant-…`), escolha o modelo e clique em **Salvar chave**.
   Use **Testar conexão** para confirmar que está tudo certo.
   A chave é obtida em <https://console.anthropic.com/settings/keys>.
4. Na folha, clique em **📷 Importar imagem e analisar**, escolha o tipo de foto, a coluna de destino
   (Produção 1, 2 ou 3) e se os valores devem **substituir** ou **somar** ao que já está lançado.
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
assets/js/planilha.js          montagem da tabela, cálculos, histórico e exportações
assets/js/painel.js            agregações, filtros e gráficos do painel (SVG puro)
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
