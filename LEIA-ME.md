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
2. **Enviar documentos** → escolha o PDF que veio da contabilidade.
3. O site lê o PDF **no próprio navegador** e mostra uma linha por página com matrícula e nome. Confira:
   - **Competência** (já vem do PDF) e **Tipo** (Holerite, Adiantamento, 13º salário, Recibo de férias…).
   - **Funcionário (Pede Aí)**: no primeiro mês, escolha quem é quem nas linhas em laranja. A ligação **matrícula → funcionário** fica salva, então nos meses seguintes já vem tudo preenchido.
4. **Enviar**. Cada página vira um PDF separado na pasta privada (`Documentos O&C (privado)/2026-10/…`). O PDF original da contabilidade também fica guardado na mesma pasta.

Enviou errado? Mandar o mesmo mês e tipo de novo **substitui** o arquivo daquele funcionário. Também dá para **Excluir** na aba "Enviados e vistos".

**Funcionário novo:** cadastre primeiro na aba **Funcionarios** da planilha do Pede Aí (nome, Ativo = SIM, senha de 4 números). Depois ele aparece na lista para ser ligado à matrícula.

## 3. Avisos (segurança, feriados, comunicados)

Na administração, aba **📢 Avisos**: título, texto, anexo opcional (PDF ou foto; foto é reduzida automaticamente) e para quem: **todos** ou funcionários escolhidos. O aviso aparece no topo do app com o selo **NOVO**. Em "Ver quem leu" aparece quem já abriu e quem ainda não. **Arquivar** tira o aviso do app (o registro continua na planilha).

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

- `limparDuplicados`: junta registros repetidos do mesmo mês/tipo/matrícula (fica o mais recente, mantém o "visto").
- `corrigirNome`: troca o nome de um funcionário em tudo (Pede Aí: Funcionarios e Pedidos; Documentos: Matriculas, Avisos, Leituras). Preencha `NOME_ANTIGO` e `NOME_NOVO` no código e rode.

Atalhos para planilhas, pasta, script e repositório: botão **🛠️ Administrar**. Link e QR Code do app: **🔗 Link do app**.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | App dos funcionários |
| `admin/index.html` | Administração (envio e acompanhamento) |
| `config.js` | URL do Apps Script e link do app (público) |
| `comum.js`, `estilo.css` | Funções e visual compartilhados |
| `lib/` | pdf.js (ler/mostrar PDF) e pdf-lib (separar páginas), cópias locais |
| `apps-script/Codigo.gs` | Cópia do código do Apps Script (não tem dado pessoal nem PIN) |
