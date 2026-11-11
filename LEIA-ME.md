# Documentos O&C — contra-cheques e documentos dos funcionários

Cada funcionário entra com o **nome + senha de 4 números (a mesma do Pede Aí)** e vê **só os próprios documentos**: o mês atual em destaque e os meses anteriores logo abaixo.

- **Telas** (`index.html`, `admin/`) → **GitHub Pages** (público, mas **sem nenhum dado pessoal**)
- **Documentos** → pasta **privada** do Google Drive ("Documentos O&C (privado)"), entregues pelo **Apps Script** (`apps-script/Codigo.gs`) só depois de conferir a senha

> **Nunca** coloque PDF, planilha de funcionários, CPF ou senha neste repositório. Tudo que está aqui pode ser visto por qualquer pessoa.

Endereços:
- Funcionários: `https://orro-christensen.github.io/documentos/`
- Administração: `https://orro-christensen.github.io/documentos/admin/`

---

## 1. Instalação do Apps Script (uma vez, cerca de 10 min)

1. Entre em **script.google.com** com a conta dona da planilha do Pede Aí → **Novo projeto**. Dê o nome **Documentos O&C**.
2. Apague o conteúdo do editor, cole todo o arquivo `apps-script/Codigo.gs` e **salve**.
3. No código, troque `const NOVO_PIN_ADMIN = '';` por um PIN de **6 números ou mais**, ex.: `'482915'`. Salve.
4. Na barra de cima escolha a função **`configurar`** → **Executar**.
   - O Google pede autorização (Planilhas, Drive e e-mail). Se aparecer "O Google não verificou este app": **Avançado → Acessar (não seguro)**. O app é seu.
   - Ela cria a pasta privada **Documentos O&C (privado)** no seu Drive, com a planilha **Documentos O&C — controle** dentro.
5. Depois de rodar, **apague o PIN do código** (volte para `''`) e salve. Ele já ficou guardado nas propriedades do script.
6. **Implantar → Nova implantação** → engrenagem → **App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - **Implantar** e copie a URL (termina em `/exec`).
7. Cole a URL no `config.js` deste repositório (`window.API_URL = '...'`).

> Alterou o código depois? **Implantar → Gerenciar implantações → lápis → Versão: Nova versão → Implantar.** A URL continua a mesma.
>
> Trocar o PIN de administração: coloque o novo em `NOVO_PIN_ADMIN`, rode `configurar` de novo (não apaga nada) e depois apague do código.

## 2. Todo mês: enviar os contra-cheques

1. Abra a **Administração** e digite o PIN.
2. Aba **🧾 Holerites** → escolha o PDF que veio da contabilidade. Dá para escolher **vários meses de uma vez** (segure Ctrl): cada arquivo aparece num quadro com a sua competência, e um botão envia tudo.
3. O site lê o PDF **no próprio navegador** e mostra uma linha por página com matrícula e nome. Confira:
   - **Competência** (já vem do PDF) e **Tipo** (Holerite, Adiantamento, 13º salário, Recibo de férias…).
   - **Funcionário (Pede Aí)**: no primeiro mês, escolha quem é quem nas linhas em laranja. A ligação **matrícula → funcionário** fica salva, então nos meses seguintes já vem tudo preenchido.
4. **Enviar**. Cada página vira um PDF separado na pasta privada (`Documentos O&C (privado)/2026-10/…`). O PDF original da contabilidade também fica guardado na mesma pasta.

Enviou errado? Mandar o mesmo mês e tipo de novo **substitui** o arquivo daquele funcionário. Também dá para **Excluir** na aba "Enviados e vistos".

**Funcionário novo:** cadastre primeiro na aba **Funcionarios** da planilha do Pede Aí (nome, Ativo = SIM, senha de 4 números). Depois ele aparece na lista para ser ligado à matrícula.

## 2b. Imposto de Renda (informe de rendimentos, uma vez por ano)

Aba **📊 Imposto de Renda** → escolha o PDF do "Comprovante de Rendimentos Pagos e de IRRF" que a contabilidade manda (todos os funcionários num arquivo só). O site separa as páginas de cada pessoa (comprovante + complemento), liga ao funcionário pelo nome completo dos holerites e mostra o total de rendimentos para conferência. Ex-funcionários ficam em laranja e não são enviados. O funcionário vê, na seção **📊 Imposto de Renda** do app, um resumo com o que vai na declaração (fonte pagadora, CNPJ e os valores de cada quadro) e o PDF completo.

## 2c. Cadastro de funcionários (só na administração)

Aba **👷 Funcionários**: lista com busca (nome, cargo, matrícula, cidade). Tocando no nome abre a ficha por seções (identificação, contato, contrato, documentos, banco, saúde, observações), com **✏️ Editar**, **📄 Ficha completa (PDF)** e o **histórico de alterações** (quem mudou o quê e quando). **⬆ Importar fichas (PDF)** lê a "Ficha de Registro de Empregado" da contabilidade; importar de novo só atualiza o que veio preenchido no PDF e não apaga o que foi digitado à mão. **➕ Novo funcionário** cadastra manualmente. Os dados ficam nas abas **Cadastro** e **Alteracoes** da planilha de controle (privada) e a ficha em PDF na subpasta **Fichas**. Nada disso aparece no app dos funcionários.

## 2d. EPI (só na administração)

Aba **🦺 EPI**. Usa o cadastro da aba 👷 Funcionários (cargo, CPF, admissão). Os funcionários **não** veem nada de EPI no app.

- **📦 Catálogo e CA**: os EPIs com o mesmo código do Pede Aí (EPI-xxx), o CA, o prazo de troca em dias (0 = descartável, sem controle) e observações. Digite o CA e toque em 🔎 para buscar validade e situação na base do Ministério do Trabalho.
- **🧩 EPI por cargo**: os EPIs obrigatórios de cada cargo (PGR). Começou com a matriz do PGR de 10/2025 mais os itens novos, aguardando a revisão da Doctor's. O nome do cargo tem que ser igual ao do cadastro.
- **👷 Por funcionário** → **➕ Nova entrega**: marque os EPIs, a quantidade e o motivo. O sistema grava a entrega e baixa o **Recibo de entrega de EPI** (PDF) com o termo da NR-6. Imprima, colha a assinatura e depois toque em **📎 Anexar** no recibo para enviar a foto ou o PDF assinado. Enquanto não houver anexo, o recibo aparece em Pendências.
- **📄 Ficha de EPI em branco**: a ficha de controle da NR-6 para preencher à caneta, como pede o PGR.
- **📎 Anexar ficha antiga**: guarda a imagem ou o PDF de fichas de papel anteriores ao sistema. **🗂️ Lançar entregas de ficha antiga** passa para o sistema o que está anotado nessas fichas (não gera recibo).
- **🖨️ Histórico (PDF)**: todas as entregas do funcionário, com o número do recibo e se está assinado.
- **⚠️ Pendências**: EPI nunca entregue, troca vencida, recibo sem assinatura e CA vencido ou em branco.
- Numeração: **R-AAAA-NNNN** = recibo de entrega; **L-AAAA-NNNN** = lançamento de ficha antiga; **F-AAAA-…** = ficha antiga anexada. O 🗑 cancela um lançamento feito por engano (fica registrado como excluído na planilha).

Planilha de controle: abas **EPI_Catalogo**, **EPI_Matriz**, **EPI_Entregas** e **EPI_Recibos**. Anexos na pasta privada, subpasta **EPI**.

**Conferência automática do CA.** Toda segunda-feira o GitHub baixa a base pública do CAEPI (Ministério do Trabalho) e publica um resumo em `caepi/` no site (só dados públicos de CA). Depois, às 9h, o script confere todos os CAs do catálogo, atualiza validade e situação e manda e-mail se algum estiver vencido, suspenso ou não for encontrado. Também dá para conferir na hora em ⚠️ Pendências > 🔄 Conferir CAs agora. A tarefa do GitHub fica em `.github/workflows/caepi.yml` (aba Actions do repositório).

## 3. Avisos (segurança, feriados, comunicados)

Na administração, aba **📢 Avisos**: título, texto, anexo opcional (PDF ou foto; foto é reduzida automaticamente) e para quem: **todos** ou funcionários escolhidos. O aviso aparece no topo do app com o selo **NOVO**. Em "Ver quem leu" aparece quem já abriu e quem ainda não. **🗑 Excluir** apaga o aviso de vez (some do app dos funcionários e da administração; o anexo vai para a lixeira do Drive).

## 4. Troca de senha pelo funcionário

No app, depois de entrar: **🔑 Quero trocar minha senha** → senha atual + nova (2 vezes). A nova é gravada na aba Funcionarios do Pede Aí e vale nos dois apps. Senhas fáceis (1234, 0000, 1212…) são recusadas.

## 5. Acompanhamento

A aba **Enviados e vistos** mostra, por mês, quem já abriu o documento e quando. O mesmo registro fica na planilha de controle (colunas "Visto em" e "Vezes visto"). Serve de comprovante de que o documento foi disponibilizado.

## 6. Segurança

- Os PDFs ficam numa pasta do Drive que **só você** acessa. O Apps Script roda como você e entrega cada arquivo apenas para o dono, depois de conferir a senha.
- Senha errada: 5 seguidas → pausa de 15 min; **10 seguidas → bloqueado** até você clicar em **Liberar** na administração. Você recebe um e-mail quando isso acontece.
- A sessão do funcionário vale 30 minutos e o app sai sozinho depois de 10 minutos parado. Nada fica salvo no celular, a não ser que ele toque em **Baixar PDF**.
- PIN de administração: 5 erros seguidos bloqueiam a administração por 15 min (com aviso por e-mail).
- A senha de 4 números é a mesma do Pede Aí. Se alguém descobrir a senha de um colega, verá os documentos dele. Por isso: **cada um deve guardar a sua**, e senhas fáceis (0000, 1234, ano de nascimento) devem ser trocadas na planilha.

## 7. Manutenção (funções no Apps Script)

- `configurarEPI`: cria as abas do EPI com o catálogo e a matriz iniciais (não apaga nada se já existirem).
- `instalarConferenciaCA`: liga a conferência semanal dos CAs (rodar uma vez).
- `verificarCAs`: confere os CAs do catálogo na hora.

- `limparDuplicados`: junta registros repetidos do mesmo mês/tipo/matrícula (fica o mais recente, mantém o "visto").
- `corrigirNome`: troca o nome de um funcionário em tudo (Pede Aí: Funcionarios e Pedidos; Documentos: Matriculas, Avisos, Leituras). Preencha `NOME_ANTIGO` e `NOME_NOVO` no código e rode.

Atalhos para planilhas, pasta, script e repositório: botão **🛠️ Administrar**. Link e QR Code do app: **🔗 Link do app**. A administração também pode ser instalada como app próprio (ícone laranja "DOCS ADMIN"): botão **📲 Instalar** no alto.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | App dos funcionários |
| `admin/index.html` | Administração (envio e acompanhamento) |
| `config.js` | URL do Apps Script e link do app (público) |
| `comum.js`, `estilo.css` | Funções e visual compartilhados |
| `lib/` | pdf.js (ler/mostrar PDF) e pdf-lib (separar páginas), cópias locais |
| `apps-script/Codigo.gs` | Cópia do código do Apps Script (não tem dado pessoal nem PIN) |
