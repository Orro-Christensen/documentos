/**
 * Documentos O&C — backend (Google Apps Script)
 *
 * Guarda os documentos dos funcionários (contra-cheques, avisos e outros) numa pasta PRIVADA do Google Drive
 * e só entrega cada arquivo a quem tem direito, depois de conferir a senha de 4 números
 * (a mesma do Pede Aí, da aba "Funcionarios" da planilha do Pede Aí).
 *
 * Nada de dado pessoal fica no GitHub: lá ficam só as telas.
 *
 * Instalação (uma vez):
 *  1) Cole este arquivo num projeto novo em script.google.com e salve.
 *  2) Troque o valor de NOVO_PIN_ADMIN (mais abaixo) e rode a função "configurar".
 *     Ela cria a pasta privada "Documentos O&C (privado)" e a planilha de controle dentro dela.
 *  3) Implantar > Nova implantação > App da Web > Executar como: Eu / Quem pode acessar: Qualquer pessoa.
 *  4) Cole a URL /exec no config.js do site.
 * Alterou o código? Implantar > Gerenciar implantações > lápis > Versão: Nova versão > Implantar.
 */

// Planilha do Pede Aí (aba Funcionarios: Nome, Ativo, Senha).
// Este script lê os nomes e senhas e só ESCREVE na coluna Senha quando o funcionário troca a própria senha.
const PLANILHA_PEDEAI_ID = '12xfUT4sbeSyINRmJhTsSd3VkouEKVhEJYkCTwraNL5E';

// PIN da tela de administração (envio dos documentos). Use 6 números ou mais.
// Para trocar: altere aqui, rode "configurar" de novo (não apaga nada) e depois apague daqui.
const NOVO_PIN_ADMIN = '';

const NOME_PASTA = 'Documentos O&C (privado)';
const NOME_PLANILHA = 'Documentos O&C — controle';
const ABA = { DOC: 'Documentos', MAT: 'Matriculas', AV: 'Avisos', LEI: 'Leituras', IR: 'IR' };
const CAB = {
  DOC: ['ID', 'Competência', 'Tipo', 'Matrícula', 'Nome no documento', 'Arquivo', 'Enviado em', 'Visto em', 'Vezes visto'],
  MAT: ['Matrícula', 'Nome no documento', 'Funcionário (Pede Aí)'],
  AV:  ['ID', 'Data', 'Título', 'Texto', 'Arquivo', 'Tipo do arquivo', 'Nome do arquivo', 'Destinatários', 'Ativo'],
  LEI: ['Aviso', 'Funcionário', 'Lido em'],
  IR:  ['Documento', 'Ano', 'Matrícula', 'Dados']   // resumo dos quadros do informe de rendimentos (JSON)
};
const TIPO_IR = 'Informe de rendimentos';
const COMP_OK = /^\d{4}(-\d{2})?$/;   // AAAA-MM (mensal) ou AAAA (informe anual)
const TZ_ = 'America/Sao_Paulo';
const SESSAO_FUNC_SEG = 30 * 60;      // funcionário: 30 min
const SESSAO_ADMIN_SEG = 2 * 3600;    // administração: 2 h
const FALHAS_PAUSA = 5;               // 5 senhas erradas seguidas -> pausa de 15 min
const FALHAS_BLOQUEIO = 10;           // 10 seguidas -> bloqueado até liberar na administração

const props_ = () => PropertiesService.getScriptProperties();
const cache_ = () => CacheService.getScriptCache();

// ---------- Instalação ----------
function configurar() {
  const p = props_();
  let pasta = p.getProperty('PASTA_ID') ? DriveApp.getFolderById(p.getProperty('PASTA_ID')) : null;
  if (!pasta) {
    pasta = DriveApp.createFolder(NOME_PASTA);
    p.setProperty('PASTA_ID', pasta.getId());
  }
  try { pasta.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) {}

  let ss = p.getProperty('PLANILHA_ID') ? SpreadsheetApp.openById(p.getProperty('PLANILHA_ID')) : null;
  if (!ss) {
    ss = SpreadsheetApp.create(NOME_PLANILHA);
    ss.setSpreadsheetTimeZone(TZ_);
    const arq = DriveApp.getFileById(ss.getId());
    pasta.addFile(arq);
    try { DriveApp.getRootFolder().removeFile(arq); } catch (e) {}
    p.setProperty('PLANILHA_ID', ss.getId());
  }
  Object.keys(ABA).forEach(k => criarAba_(ss, ABA[k], CAB[k]));
  const sobra = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (sobra && ss.getSheets().length > 1) ss.deleteSheet(sobra);

  if (NOVO_PIN_ADMIN) {
    if (!/^\d{6,}$/.test(NOVO_PIN_ADMIN)) throw new Error('NOVO_PIN_ADMIN precisa ter 6 números ou mais.');
    p.setProperty('PIN_ADMIN', NOVO_PIN_ADMIN);
  }
  if (!p.getProperty('PIN_ADMIN')) throw new Error('Defina NOVO_PIN_ADMIN (6 números ou mais) e rode "configurar" de novo.');

  const n = funcionariosPedeAi_().length;
  Logger.log('Pronto. Pasta: ' + pasta.getUrl() + ' | Planilha: ' + ss.getUrl() + ' | Funcionários ativos no Pede Aí: ' + n);
}

function criarAba_(ss, nome, cab) {
  let sh = ss.getSheetByName(nome);
  if (sh) return sh;
  sh = ss.insertSheet(nome);
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#2f3b4c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

const planilha_ = () => SpreadsheetApp.openById(props_().getProperty('PLANILHA_ID'));
const pasta_ = () => DriveApp.getFolderById(props_().getProperty('PASTA_ID'));
const aba_ = nome => criarAba_(planilha_(), nome, CAB[Object.keys(ABA).find(k => ABA[k] === nome)]);

function tabela_(sh) {
  const v = sh.getDataRange().getValues();
  const cab = v.shift() || [];
  return v.map((l, i) => {
    const o = { _linha: i + 2 }; cab.forEach((c, j) => o[c] = l[j]); return o;
  }).filter(o => Object.keys(o).some(k => k !== '_linha' && String(o[k]) !== ''));
}
const ativo_ = v => !/^N[ÃA]O$/i.test(String(v).trim());
const texto_ = v => v instanceof Date ? Utilities.formatDate(v, TZ_, "yyyy-MM-dd'T'HH:mm:ss") : String(v ?? '');
const agora_ = () => Utilities.formatDate(new Date(), TZ_, "yyyy-MM-dd'T'HH:mm:ss");
// A planilha transforma "00078" em 78 e "2026-10" em data: tudo é normalizado na leitura
// e gravado com apóstrofo (texto) na escrita.
const mat_ = v => String(v ?? '').trim().replace(/^0+(?=\d)/, '');
const comp_ = v => v instanceof Date ? Utilities.formatDate(v, TZ_, 'yyyy-MM') : String(v ?? '').trim();
function irDados_() { const o = {}; tabela_(aba_(ABA.IR)).forEach(l => { try { o[String(l['Documento'])] = JSON.parse(l['Dados']); } catch (e) {} }); return o; }
const txt_ = v => "'" + String(v ?? '');

function funcionariosPedeAi_() {
  const sh = SpreadsheetApp.openById(PLANILHA_PEDEAI_ID).getSheetByName('Funcionarios');
  if (!sh) throw new Error('Aba Funcionarios não encontrada na planilha do Pede Aí');
  return tabela_(sh).filter(f => f['Nome'] && ativo_(f['Ativo']))
    .map(f => ({ nome: String(f['Nome']).trim(), senha: String(f['Senha'] ?? '').trim(), linha: f._linha }));
}
function matriculas_() {
  return tabela_(aba_(ABA.MAT)).map(m => ({
    linha: m._linha, matricula: mat_(m['Matrícula']), nomeDoc: String(m['Nome no documento'] || ''),
    funcionario: String(m['Funcionário (Pede Aí)'] || '').trim()
  }));
}
function documentos_() {
  return tabela_(aba_(ABA.DOC)).map(d => ({
    linha: d._linha, id: String(d['ID']), competencia: comp_(d['Competência']), tipo: String(d['Tipo']).trim(),
    matricula: mat_(d['Matrícula']), nomeDoc: String(d['Nome no documento'] || ''), arquivo: String(d['Arquivo']),
    enviadoEm: texto_(d['Enviado em']), vistoEm: texto_(d['Visto em']), vezes: Number(d['Vezes visto']) || 0
  }));
}
function avisos_() {
  return tabela_(aba_(ABA.AV)).map(a => ({
    linha: a._linha, id: String(a['ID']), data: texto_(a['Data']), titulo: String(a['Título'] || ''), texto: String(a['Texto'] || ''),
    arquivo: String(a['Arquivo'] || ''), mime: String(a['Tipo do arquivo'] || ''), nomeArquivo: String(a['Nome do arquivo'] || ''),
    destinatarios: String(a['Destinatários'] || 'TODOS'), ativo: ativo_(a['Ativo'])
  }));
}
function leituras_() {
  return tabela_(aba_(ABA.LEI)).map(l => ({ aviso: String(l['Aviso']), funcionario: String(l['Funcionário']), em: texto_(l['Lido em']) }));
}
const paraQuem_ = (a, nome) => a.destinatarios === 'TODOS' || a.destinatarios.split('|').indexOf(nome) >= 0;

// ---------- API ----------
function doGet() { return json_({ ok: true, app: 'documentos-oc' }); }

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ erro: 'Requisição inválida' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    switch (b.action) {
      case 'funcionarios': return json_({ nomes: funcionariosPedeAi_().map(f => f.nome).sort((x, y) => x.localeCompare(y, 'pt-BR')) });
      case 'login':        return json_(login_(b));
      case 'meus':         { const n = sessaoFunc_(b.token); return json_({ docs: meusDocs_(n), avisos: meusAvisos_(n) }); }
      case 'abrir':        return json_(abrir_(b));
      case 'abrirAviso':   return json_(abrirAviso_(b));
      case 'trocarSenha':  return json_(trocarSenha_(b));
      case 'sair':         cache_().remove('tf_' + b.token); return json_({ ok: true });
      case 'adminLogin':   return json_(adminLogin_(b));
      case 'adminDados':   sessaoAdmin_(b.token); return json_(adminDados_());
      case 'adminEnviar':  sessaoAdmin_(b.token); return json_(adminEnviar_(b));
      case 'adminOriginal':sessaoAdmin_(b.token); return json_(adminOriginal_(b));
      case 'adminExcluir': sessaoAdmin_(b.token); return json_(adminExcluir_(b));
      case 'adminAviso':   sessaoAdmin_(b.token); return json_(adminAviso_(b));
      case 'adminArquivarAviso': sessaoAdmin_(b.token); return json_(adminArquivarAviso_(b));
      case 'adminExcluirAviso': sessaoAdmin_(b.token); return json_(adminExcluirAviso_(b));
      case 'adminLiberar': sessaoAdmin_(b.token); liberar_(b.nome); return json_({ ok: true });
      case 'cadLista':     sessaoAdmin_(b.token); return json_(cadLista_());
      case 'cadVer':       sessaoAdmin_(b.token); return json_(cadVer_(b));
      case 'cadSalvar':    sessaoAdmin_(b.token); return json_(cadSalvar_(b.matricula, b.dados, 'manual', b.novo));
      case 'cadImportar':  sessaoAdmin_(b.token); return json_(cadImportar_(b));
      case 'cadFicha':     sessaoAdmin_(b.token); return json_(cadFicha_(b));
      case 'epiDados':     sessaoAdmin_(b.token); return json_(epiDados_());
      case 'epiCatalogo':  sessaoAdmin_(b.token); return json_(epiSalvarCatalogo_(b));
      case 'epiMatriz':    sessaoAdmin_(b.token); return json_(epiSalvarMatriz_(b));
      case 'epiEntregar':  sessaoAdmin_(b.token); return json_(epiEntregar_(b));
      case 'epiAnexar':    sessaoAdmin_(b.token); return json_(epiAnexar_(b));
      case 'epiAnexo':     sessaoAdmin_(b.token); return json_(epiAbrirAnexo_(b));
      case 'epiExcluir':   sessaoAdmin_(b.token); return json_(epiExcluirRecibo_(b));
      case 'epiTamanhos':  sessaoAdmin_(b.token); return json_(epiTamanhos_(b));
      case 'epiConferirCA':sessaoAdmin_(b.token); return json_(verificarCAs());
      default: return json_({ erro: 'Ação desconhecida' });
    }
  } catch (err) {
    const m = String(err.message || err);
    if (m.indexOf('SESSAO|') === 0) return json_({ erro: m.slice(7), sessao: true });
    return json_({ erro: m });
  } finally { lock.releaseLock(); }
}

// ---------- Senha do funcionário ----------
/** Confere a senha com as regras de bloqueio. Lança erro se estiver errada. */
function conferirSenha_(nome, senha) {
  const f = funcionariosPedeAi_().find(x => x.nome === nome);
  if (!f) throw new Error('Funcionário não encontrado');
  const p = props_(), c = cache_();
  if (p.getProperty('bloq_' + nome)) throw new Error('Acesso bloqueado por excesso de senhas erradas. Fale com o responsável para liberar.');
  if (c.get('pausa_' + nome)) throw new Error('Muitas senhas erradas. Aguarde 15 minutos.');
  let certa = f.senha;
  if (/^\d{1,4}$/.test(certa)) certa = certa.padStart(4, '0');
  if (!certa) throw new Error('Você ainda não tem senha. Fale com o responsável.');
  if (String(senha || '').trim() !== certa) {
    const falhas = Number(p.getProperty('falhas_' + nome) || 0) + 1;
    p.setProperty('falhas_' + nome, String(falhas));
    if (falhas >= FALHAS_BLOQUEIO) {
      p.setProperty('bloq_' + nome, agora_());
      avisarDono_('Documentos O&C: acesso bloqueado',
        'O acesso de "' + nome + '" foi bloqueado depois de ' + falhas + ' senhas erradas seguidas.\n' +
        'Se foi o próprio funcionário, libere na tela de administração (botão Liberar).');
      throw new Error('Acesso bloqueado por excesso de senhas erradas. Fale com o responsável para liberar.');
    }
    if (falhas % FALHAS_PAUSA === 0) {
      c.put('pausa_' + nome, '1', 900);
      throw new Error('Senha incorreta. Acesso pausado por 15 minutos.');
    }
    throw new Error('Senha incorreta');
  }
  p.deleteProperty('falhas_' + nome);
  return f;
}

function login_(b) {
  const nome = String(b.nome || '').trim();
  conferirSenha_(nome, b.senha);
  const token = Utilities.getUuid();
  cache_().put('tf_' + token, nome, SESSAO_FUNC_SEG);
  return { token, nome, docs: meusDocs_(nome), avisos: meusAvisos_(nome) };
}

function senhaFraca_(s) {
  if (/^(\d)\1{3}$/.test(s)) return true;                                   // 0000, 1111...
  const d = s.split('').map(Number), passo = d[1] - d[0];
  if (Math.abs(passo) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === passo)) return true;   // 1234, 4321
  if (s.slice(0, 2) === s.slice(2)) return true;                              // 1212
  return false;
}

/** O funcionário troca a própria senha (vale para o Pede Aí também). */
function trocarSenha_(b) {
  const nome = sessaoFunc_(b.token);
  const f = conferirSenha_(nome, b.atual);
  const nova = String(b.nova || '').trim();
  if (!/^\d{4}$/.test(nova)) throw new Error('A senha nova precisa ter 4 números.');
  if (senhaFraca_(nova)) throw new Error('Senha muito fácil (sequência ou números repetidos). Escolha outra.');
  if (nova === String(b.atual || '').trim()) throw new Error('A senha nova é igual à atual.');
  const sh = SpreadsheetApp.openById(PLANILHA_PEDEAI_ID).getSheetByName('Funcionarios');
  const col = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('Senha') + 1;
  if (!col) throw new Error('Coluna Senha não encontrada no Pede Aí');
  sh.getRange(f.linha, col).setValue(txt_(nova));
  return { ok: true };
}

function sessaoFunc_(token) {
  const nome = token && cache_().get('tf_' + token);
  if (!nome) throw new Error('SESSAO|Sessão expirada. Entre de novo.');
  cache_().put('tf_' + token, nome, SESSAO_FUNC_SEG);
  return nome;
}
function matsDe_(nome) { return new Set(matriculas_().filter(m => m.funcionario === nome).map(m => m.matricula)); }

function meusDocs_(nome) {
  const mats = matsDe_(nome);
  const ir = irDados_();
  return documentos_().filter(d => mats.has(d.matricula))
    .map(d => Object.assign({ id: d.id, competencia: d.competencia, tipo: d.tipo, enviadoEm: d.enviadoEm, visto: !!d.vistoEm },
      d.tipo === TIPO_IR && ir[d.id] ? { dados: ir[d.id] } : {}))
    .sort((a, b) => (b.competencia + b.enviadoEm).localeCompare(a.competencia + a.enviadoEm));
}

function abrir_(b) {
  const nome = sessaoFunc_(b.token);
  const d = documentos_().find(x => x.id === String(b.id));
  if (!d || !matsDe_(nome).has(d.matricula)) throw new Error('Documento não encontrado');
  const blob = DriveApp.getFileById(d.arquivo).getBlob();
  const sh = aba_(ABA.DOC);
  if (!d.vistoEm) sh.getRange(d.linha, CAB.DOC.indexOf('Visto em') + 1).setValue(agora_());
  sh.getRange(d.linha, CAB.DOC.indexOf('Vezes visto') + 1).setValue(d.vezes + 1);
  return { nomeArquivo: d.tipo + ' ' + d.competencia + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------- Avisos ----------
function meusAvisos_(nome) {
  const lidos = new Set(leituras_().filter(l => l.funcionario === nome).map(l => l.aviso));
  return avisos_().filter(a => a.ativo && paraQuem_(a, nome))
    .map(a => ({ id: a.id, data: a.data, titulo: a.titulo, anexo: !!a.arquivo, lido: lidos.has(a.id) }))
    .sort((x, y) => y.data.localeCompare(x.data));
}

function abrirAviso_(b) {
  const nome = sessaoFunc_(b.token);
  const a = avisos_().find(x => x.id === String(b.id));
  if (!a || !a.ativo || !paraQuem_(a, nome)) throw new Error('Aviso não encontrado');
  if (!leituras_().some(l => l.aviso === a.id && l.funcionario === nome)) aba_(ABA.LEI).appendRow([a.id, nome, agora_()]);
  const r = { id: a.id, data: a.data, titulo: a.titulo, texto: a.texto, mime: a.mime, nomeArquivo: a.nomeArquivo };
  if (a.arquivo) r.base64 = Utilities.base64Encode(DriveApp.getFileById(a.arquivo).getBlob().getBytes());
  return r;
}

function adminAviso_(b) {
  const titulo = String(b.titulo || '').trim(), texto = String(b.texto || '').trim();
  if (!titulo) throw new Error('Informe o título do aviso');
  let dest = 'TODOS';
  if (Array.isArray(b.destinatarios)) {
    const validos = new Set(funcionariosPedeAi_().map(f => f.nome));
    const l = b.destinatarios.map(String).filter(n => validos.has(n));
    if (!l.length) throw new Error('Escolha pelo menos um funcionário');
    dest = l.join('|');
  }
  let arqId = '', mime = '', nomeArq = '';
  if (b.base64) {
    mime = String(b.mime || 'application/octet-stream');
    if (!/^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(mime)) throw new Error('Anexo precisa ser PDF ou imagem');
    nomeArq = limpa_(b.nomeArquivo || 'anexo');
    const bytes = Utilities.base64Decode(String(b.base64));
    arqId = subpasta_('Avisos').createFile(Utilities.newBlob(bytes, mime, Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd') + ' ' + nomeArq)).getId();
  }
  const id = 'AV-' + Utilities.getUuid().slice(0, 8);
  aba_(ABA.AV).appendRow([id, agora_(), titulo, texto, arqId, mime, nomeArq, dest, 'SIM']);
  return { ok: true, id };
}

function adminArquivarAviso_(b) {
  const a = avisos_().find(x => x.id === String(b.id));
  if (!a) throw new Error('Aviso não encontrado');
  aba_(ABA.AV).getRange(a.linha, CAB.AV.indexOf('Ativo') + 1).setValue('NÃO');
  return { ok: true };
}

/** Apaga o aviso de vez: some do app dos funcionários e da administração; o anexo vai para a lixeira do Drive
 *  e o registro de quem leu é apagado junto. */
function adminExcluirAviso_(b) {
  const a = avisos_().find(x => x.id === String(b.id));
  if (!a) throw new Error('Aviso não encontrado');
  if (a.arquivo) { try { DriveApp.getFileById(a.arquivo).setTrashed(true); } catch (e) {} }
  const shL = aba_(ABA.LEI);
  tabela_(shL).filter(l => String(l['Aviso']) === a.id).map(l => l._linha).sort((x, y) => y - x).forEach(n => shL.deleteRow(n));
  aba_(ABA.AV).deleteRow(a.linha);
  return { ok: true };
}

// ---------- Administração ----------
function adminLogin_(b) {
  const c = cache_(), k = 'tent_admin';
  const tent = Number(c.get(k) || 0);
  if (tent >= 5) throw new Error('Administração bloqueada: muitas tentativas erradas. Aguarde 15 minutos.');
  const certo = props_().getProperty('PIN_ADMIN');
  if (!certo) throw new Error('PIN de administração não definido. Rode "configurar" no Apps Script.');
  if (String(b.pin || '') !== certo) {
    c.put(k, String(tent + 1), 900);
    if (tent + 1 >= 5) avisarDono_('Documentos O&C: administração bloqueada', '5 PINs de administração errados seguidos. Bloqueada por 15 minutos.');
    throw new Error('PIN incorreto');
  }
  c.remove(k);
  const token = Utilities.getUuid();
  c.put('ta_' + token, '1', SESSAO_ADMIN_SEG);
  return { token };
}
function sessaoAdmin_(token) {
  if (!token || !cache_().get('ta_' + token)) throw new Error('SESSAO|Sessão expirada. Digite o PIN de novo.');
  cache_().put('ta_' + token, '1', SESSAO_ADMIN_SEG);
}

function adminDados_() {
  const p = props_().getProperties();
  const bloqueados = Object.keys(p).filter(k => k.indexOf('bloq_') === 0).map(k => ({ nome: k.slice(5), desde: p[k] }));
  const funcionarios = funcionariosPedeAi_().map(f => f.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const lei = leituras_();
  return {
    funcionarios,
    matriculas: matriculas_().map(m => ({ matricula: m.matricula, nomeDoc: m.nomeDoc, funcionario: m.funcionario })),
    documentos: documentos_().map(d => ({ id: d.id, competencia: d.competencia, tipo: d.tipo, matricula: d.matricula,
      nomeDoc: d.nomeDoc, enviadoEm: d.enviadoEm, vistoEm: d.vistoEm, vezes: d.vezes })),
    avisos: avisos_().filter(a => a.ativo).map(a => {
      const para = a.destinatarios === 'TODOS' ? funcionarios : a.destinatarios.split('|');
      const leram = lei.filter(l => l.aviso === a.id);
      return { id: a.id, data: a.data, titulo: a.titulo, texto: a.texto, anexo: a.nomeArquivo, todos: a.destinatarios === 'TODOS',
        para, leram: leram.map(l => ({ nome: l.funcionario, em: l.em })) };
    }).sort((x, y) => y.data.localeCompare(x.data)),
    bloqueados,
    pastaUrl: pasta_().getUrl(),
    planilhaUrl: planilha_().getUrl(),
    pedeAiUrl: 'https://docs.google.com/spreadsheets/d/' + PLANILHA_PEDEAI_ID + '/edit'
  };
}

function subpasta_(nome) {
  const pai = pasta_(), it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}
const limpa_ = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim();

function adminEnviar_(b) {
  const comp = String(b.competencia || ''), tipo = limpa_(b.tipo), matTxt = String(b.matricula || '').trim(), mat = mat_(matTxt);
  if (!COMP_OK.test(comp)) throw new Error('Competência inválida (use AAAA-MM, ou AAAA para informe anual)');
  if (!tipo) throw new Error('Informe o tipo de documento');
  if (!/^\d{1,10}$/.test(matTxt)) throw new Error('Matrícula inválida');
  const bytes = Utilities.base64Decode(String(b.base64 || ''));
  if (!bytes.length) throw new Error('Arquivo vazio');

  // Vincula a matrícula ao funcionário do Pede Aí (fica salvo para os próximos meses).
  const shM = aba_(ABA.MAT);
  const m = matriculas_().find(x => x.matricula === mat);
  const func = String(b.funcionario || '').trim();
  if (m) {
    if (func && func !== m.funcionario) shM.getRange(m.linha, 3).setValue(func);
    if (b.nomeDoc && b.nomeDoc !== m.nomeDoc) shM.getRange(m.linha, 2).setValue(String(b.nomeDoc));
  } else {
    shM.appendRow([txt_(matTxt), String(b.nomeDoc || ''), func]);
  }

  const pasta = subpasta_(comp);
  const arq = pasta.createFile(Utilities.newBlob(bytes, 'application/pdf', comp + ' ' + tipo + ' ' + matTxt + '.pdf'));

  // Mesmo documento enviado de novo (correção): troca o arquivo, mantém a linha e zera o "visto".
  const sh = aba_(ABA.DOC);
  const linha = [txt_(comp), tipo, txt_(matTxt), String(b.nomeDoc || ''), arq.getId(), agora_(), '', 0];
  const antigo = documentos_().find(d => d.competencia === comp && d.tipo === tipo && d.matricula === mat);
  if (antigo) {
    try { DriveApp.getFileById(antigo.arquivo).setTrashed(true); } catch (e) {}
    sh.getRange(antigo.linha, 1, 1, CAB.DOC.length).setValues([[antigo.id].concat(linha)]);
    salvarIr_(antigo.id, comp, matTxt, b.dados);
    return { ok: true, id: antigo.id, substituido: true };
  }
  const id = Utilities.getUuid().slice(0, 13);
  sh.appendRow([id].concat(linha));
  salvarIr_(id, comp, matTxt, b.dados);
  return { ok: true, id };
}

/** Resumo dos quadros do informe de rendimentos (mostrado ao funcionário junto com o PDF). */
function salvarIr_(id, comp, mat, dados) {
  if (!dados) return;
  const sh = aba_(ABA.IR), l = tabela_(sh).find(x => String(x['Documento']) === id);
  const linha = [id, txt_(comp), txt_(mat), JSON.stringify(dados)];
  if (l) sh.getRange(l._linha, 1, 1, 4).setValues([linha]); else sh.appendRow(linha);
}

/** Guarda o PDF original da contabilidade na pasta da competência (reenvio substitui). */
function adminOriginal_(b) {
  const comp = String(b.competencia || '');
  if (!COMP_OK.test(comp)) throw new Error('Competência inválida');
  const bytes = Utilities.base64Decode(String(b.base64 || ''));
  const nome = comp + ' ' + limpa_(b.tipo) + ' - original - ' + limpa_(b.nomeArquivo || 'arquivo.pdf');
  const pasta = subpasta_(comp), it = pasta.getFilesByName(nome);
  while (it.hasNext()) it.next().setTrashed(true);
  pasta.createFile(Utilities.newBlob(bytes, 'application/pdf', nome));
  return { ok: true };
}

function adminExcluir_(b) {
  const d = documentos_().find(x => x.id === String(b.id));
  if (!d) throw new Error('Documento não encontrado');
  try { DriveApp.getFileById(d.arquivo).setTrashed(true); } catch (e) {}
  aba_(ABA.DOC).deleteRow(d.linha);
  const shI = aba_(ABA.IR), l = tabela_(shI).find(x => String(x['Documento']) === d.id);
  if (l) shI.deleteRow(l._linha);
  return { ok: true };
}

function liberar_(nome) {
  nome = String(nome || '');
  const p = props_();
  p.deleteProperty('bloq_' + nome); p.deleteProperty('falhas_' + nome);
  cache_().remove('pausa_' + nome);
}

function avisarDono_(assunto, texto) {
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), assunto, texto); } catch (e) {}
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Cadastro de funcionários (só administração) ----------
// Aba "Cadastro": uma linha por funcionário; a 1ª linha tem as chaves dos campos (colunas criadas sob demanda).
// Aba "Alteracoes": registro de cada campo alterado (quando, matrícula, campo, de, para, origem).
const CAD = 'Cadastro', ALT = 'Alteracoes';
const CAD_FIXOS = ['matricula', 'nome', 'atualizado_em', 'arquivo_ficha'];

function abaCad_() {
  const ss = planilha_();
  let sh = ss.getSheetByName(CAD);
  if (!sh) {
    sh = ss.insertSheet(CAD);
    sh.getRange(1, 1, 1, CAD_FIXOS.length).setValues([CAD_FIXOS]).setFontWeight('bold').setBackground('#2f3b4c').setFontColor('#ffffff');
    sh.setFrozenRows(1); sh.setFrozenColumns(2);
  }
  return sh;
}
function abaAlt_() {
  const ss = planilha_();
  let sh = ss.getSheetByName(ALT);
  if (!sh) {
    sh = ss.insertSheet(ALT);
    sh.getRange(1, 1, 1, 6).setValues([['Quando', 'Matrícula', 'Campo', 'De', 'Para', 'Origem']]).setFontWeight('bold').setBackground('#2f3b4c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function cadTabela_() {
  const sh = abaCad_(), v = sh.getDataRange().getValues(), cab = (v.shift() || []).map(String);
  const linhas = v.map((l, i) => { const o = { _linha: i + 2 }; cab.forEach((c, j) => { if (c) o[c] = texto_(l[j]); }); return o; })
    .filter(o => o.matricula);
  linhas.forEach(o => o.matricula = mat_(o.matricula).padStart(5, '0'));
  return { sh, cab, linhas };
}
const chaveOk_ = k => /^[a-z][a-z0-9_]{0,40}$/.test(k);

function cadLista_() {
  const { linhas } = cadTabela_();
  const mats = {}; matriculas_().forEach(m => mats[m.matricula] = m.funcionario);
  const alt = {}; tabela_(abaAlt_()).forEach(a => { const m = mat_(a['Matrícula']); alt[m] = (alt[m] || 0) + 1; });
  return {
    funcionarios: linhas.map(o => { const r = Object.assign({}, o); delete r._linha; r.pedeAi = mats[mat_(o.matricula)] || ''; r.alteracoes = alt[mat_(o.matricula)] || 0; r.temFicha = !!o.arquivo_ficha; delete r.arquivo_ficha; return r; })
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
  };
}

function cadVer_(b) {
  const m = mat_(b.matricula);
  return { alteracoes: tabela_(abaAlt_()).filter(a => mat_(a['Matrícula']) === m)
    .map(a => ({ em: texto_(a['Quando']), campo: String(a['Campo']), de: String(a['De']), para: String(a['Para']), origem: String(a['Origem']) }))
    .sort((x, y) => y.em.localeCompare(x.em)).slice(0, 200) };
}

/** Grava os campos informados. origem 'manual' grava tudo o que veio (inclusive apagar);
 *  'importação' só grava valores não vazios (não apaga o que foi preenchido à mão). */
function cadSalvar_(matricula, dados, origem, novo) {
  const matTxt = String(matricula || '').trim();
  if (!/^\d{1,10}$/.test(matTxt)) throw new Error('Matrícula inválida');
  const mat = matTxt.padStart(5, '0');
  dados = dados || {};
  let { sh, cab, linhas } = cadTabela_();
  let atual = linhas.find(o => mat_(o.matricula) === mat_(mat));
  if (novo && atual) throw new Error('Já existe funcionário com a matrícula ' + mat);
  if (!atual && !String(dados.nome || '').trim()) throw new Error('Informe o nome');
  // colunas novas
  const novas = Object.keys(dados).filter(k => chaveOk_(k) && cab.indexOf(k) < 0);
  if (novas.length) {
    sh.getRange(1, cab.length + 1, 1, novas.length).setValues([novas]).setFontWeight('bold').setBackground('#2f3b4c').setFontColor('#ffffff');
    cab = cab.concat(novas);
  }
  const linha = atual ? atual._linha : sh.getLastRow() + 1;
  const antes = atual || {};
  const quando = agora_(), log = [];
  if (!atual) {
    sh.getRange(linha, 1).setValue(txt_(mat));
    log.push([quando, txt_(mat), 'cadastro', '', 'criado', origem]);
  }
  Object.keys(dados).forEach(k => {
    if (!chaveOk_(k) || k === 'matricula' || k === 'atualizado_em' || k === 'arquivo_ficha') return;
    const v = String(dados[k] ?? '').trim().slice(0, 2000);
    const de = String(antes[k] ?? '');
    if (origem !== 'manual' && !v) return;
    if (v === de) return;
    sh.getRange(linha, cab.indexOf(k) + 1).setValue(txt_(v));
    if (atual) log.push([quando, txt_(mat), k, txt_(de), txt_(v), origem]);
  });
  sh.getRange(linha, cab.indexOf('atualizado_em') + 1).setValue(quando);
  if (log.length) { const a = abaAlt_(); a.getRange(a.getLastRow() + 1, 1, log.length, 6).setValues(log); }
  return { ok: true, matricula: mat, alterados: atual ? log.length : 0, criado: !atual };
}

function cadImportar_(b) {
  const r = cadSalvar_(b.matricula, b.dados, 'importação');
  if (b.base64) {
    const mat = String(b.matricula).padStart(5, '0');
    const pasta = subpasta_('Fichas'), nome = 'Ficha ' + mat + '.pdf';
    const it = pasta.getFilesByName(nome); while (it.hasNext()) it.next().setTrashed(true);
    const arq = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(String(b.base64)), 'application/pdf', nome));
    const { sh, cab, linhas } = cadTabela_();
    const o = linhas.find(x => mat_(x.matricula) === mat_(mat));
    sh.getRange(o._linha, cab.indexOf('arquivo_ficha') + 1).setValue(arq.getId());
  }
  return r;
}

function cadFicha_(b) {
  const o = cadTabela_().linhas.find(x => mat_(x.matricula) === mat_(b.matricula));
  if (!o || !o.arquivo_ficha) throw new Error('Ficha em PDF não encontrada');
  return { nomeArquivo: 'Ficha ' + o.matricula + ' ' + (o.nome || '') + '.pdf', base64: Utilities.base64Encode(DriveApp.getFileById(o.arquivo_ficha).getBlob().getBytes()) };
}

// ---------- Manutenção (rodar pelo editor) ----------

/** Junta registros repetidos (mesma competência + tipo + matrícula): fica o envio mais recente,
 *  os arquivos antigos vão para a lixeira e o "visto" é mantido. Também regrava matrícula e
 *  competência como texto (00078, 2026-10). */
function limparDuplicados() {
  const sh = aba_(ABA.DOC), docs = documentos_(), grupos = {};
  docs.forEach(d => { const k = d.competencia + '|' + d.tipo + '|' + d.matricula; (grupos[k] = grupos[k] || []).push(d); });
  const apagar = [];
  Object.keys(grupos).forEach(k => {
    const l = grupos[k].sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm));
    const fica = l[0];
    const visto = l.map(x => x.vistoEm).filter(Boolean).sort()[0] || '';
    const vezes = l.reduce((s, x) => s + x.vezes, 0);
    sh.getRange(fica.linha, 8, 1, 2).setValues([[visto, vezes]]);
    l.slice(1).forEach(x => { try { DriveApp.getFileById(x.arquivo).setTrashed(true); } catch (e) {} apagar.push(x.linha); });
  });
  apagar.sort((a, b) => b - a).forEach(n => sh.deleteRow(n));
  // regrava como texto com zeros à esquerda
  documentos_().forEach(d => {
    sh.getRange(d.linha, 2).setValue(txt_(d.competencia));
    sh.getRange(d.linha, 4).setValue(txt_(d.matricula.padStart(5, '0')));
  });
  const shM = aba_(ABA.MAT);
  matriculas_().forEach(m => shM.getRange(m.linha, 1).setValue(txt_(m.matricula.padStart(5, '0'))));
  Logger.log('Removidos ' + apagar.length + ' registros repetidos. Ficaram ' + documentos_().length + '.');
}

/** Corrige o nome de um funcionário em todo lugar: Pede Aí (Funcionarios e Pedidos) e Documentos (Matriculas, Leituras, Avisos).
 *  Preencha os dois nomes abaixo e rode "corrigirNome". */
const NOME_ANTIGO = 'Abraâo';
const NOME_NOVO = 'Abraão';
function corrigirNome() {
  const de = NOME_ANTIGO.trim(), para = NOME_NOVO.trim();
  if (!de || !para) throw new Error('Preencha NOME_ANTIGO e NOME_NOVO');
  let n = 0;
  const troca = (sh, cabecalho) => {
    if (!sh) return;
    const col = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf(cabecalho) + 1;
    if (!col || sh.getLastRow() < 2) return;
    const r = sh.getRange(2, col, sh.getLastRow() - 1, 1), v = r.getValues();
    let mudou = false;
    v.forEach(l => { if (String(l[0]).trim() === de) { l[0] = para; mudou = true; n++; } });
    if (mudou) r.setValues(v);
  };
  const pede = SpreadsheetApp.openById(PLANILHA_PEDEAI_ID);
  troca(pede.getSheetByName('Funcionarios'), 'Nome');
  troca(pede.getSheetByName('Pedidos'), 'Funcionário');
  troca(aba_(ABA.MAT), 'Funcionário (Pede Aí)');
  troca(aba_(ABA.LEI), 'Funcionário');
  const shA = aba_(ABA.AV);
  avisos_().forEach(a => {
    if (a.destinatarios === 'TODOS') return;
    const l = a.destinatarios.split('|'), i = l.indexOf(de);
    if (i >= 0) { l[i] = para; shA.getRange(a.linha, CAB.AV.indexOf('Destinatários') + 1).setValue(l.join('|')); n++; }
  });
  ['falhas_', 'bloq_'].forEach(k => { const v = props_().getProperty(k + de); if (v) { props_().setProperty(k + para, v); props_().deleteProperty(k + de); } });
  Logger.log('"' + de + '" → "' + para + '": ' + n + ' célula(s) alteradas.');
}

// ---------- EPI: catálogo, matriz por cargo, entregas e recibos (só administração) ----------
// Abas: EPI_Catalogo, EPI_Matriz, EPI_Entregas, EPI_Recibos. Anexos (recibos assinados e fichas antigas) na subpasta "EPI".
const EPI = {
  CAT: ['Código', 'Ativo', 'EPI', 'CA', 'Validade CA', 'Situação CA', 'Troca (dias)', 'Observação', 'CA conferido em'],
  MAT: ['Cargo', 'Códigos', 'Observação'],
  ENT: ['ID', 'Data', 'Matrícula', 'Nome', 'Código', 'EPI', 'CA', 'Qtd', 'Motivo', 'Recibo', 'Registrado em', 'Situação'],
  REC: ['Recibo', 'Tipo', 'Data', 'Matrícula', 'Nome', 'Itens', 'Arquivo', 'Tipo do arquivo', 'Anexado em', 'Observação', 'Situação']
};
const ABA_EPI = { CAT: 'EPI_Catalogo', MAT: 'EPI_Matriz', ENT: 'EPI_Entregas', REC: 'EPI_Recibos' };
const MATRIZ_OBS = "PGR 10/2025 + itens novos (aguardando revisão da Doctor's)";
const EPI_SEED = [
  ['EPI-008', 'SIM', 'Botina de segurança com biqueira', '3151', '', '', 180, 'CA dos laudos (bota com bico de PVC) - vencido em 21/08/2025'],
  ['EPI-002', 'SIM', 'Óculos de proteção incolor', '10346', '', '', 90, ''],
  ['EPI-005', 'SIM', 'Protetor facial (face shield)', '', '', '', 180, ''],
  ['EPI-018', 'SIM', 'Viseira de reposição para protetor facial', '', '', '', 0, 'Peça de reposição do EPI-005'],
  ['EPI-004', 'SIM', 'Protetor auricular tipo plug', '19578', '', '', 30, ''],
  ['EPI-003', 'SIM', 'Protetor auricular tipo concha', '', '', '', 180, 'Fora da matriz do PGR'],
  ['EPI-006', 'SIM', 'Respirador PFF2', '', '', '', 7, 'Substitui a PFF1 do PGR'],
  ['EPI-007', 'SIM', 'Respirador semifacial com filtro químico', '33596', '', '', 365, 'CA do respirador usado na amostragem (Alltec)'],
  ['EPI-015', 'SIM', 'Cartucho químico para vapores orgânicos', '', '', '', 30, ''],
  ['EPI-016', 'SIM', 'Pré-filtro P2 com retentor', '', '', '', 7, ''],
  ['EPI-013', 'SIM', 'Luva de vaqueta ou anticorte', '', '', '', 30, 'Substitui a luva de algodão do PGR'],
  ['EPI-011', 'SIM', 'Luva de algodão', '', '', '', 15, 'Está no PGR; substituída pela EPI-013'],
  ['EPI-001', 'SIM', 'Luva nitrílica reutilizável', '', '', '', 30, 'Substitui a luva de látex do PGR'],
  ['EPI-014', 'SIM', 'Luva nitrílica descartável', '', '', '', 0, 'Descartável: sem prazo de troca'],
  ['EPI-017', 'SIM', 'Macacão descartável para pintura', '', '', '', 0, 'Descartável: sem prazo de troca'],
  ['EPI-012', 'SIM', 'Creme protetor para as mãos', '', '', '', 0, ''],
];
const PRODUCAO_ = 'EPI-008, EPI-002, EPI-005, EPI-004, EPI-006, EPI-013';
const MATRIZ_SEED = [
  ['Ajudante Geral', PRODUCAO_ + ', EPI-014', MATRIZ_OBS],
  ['Marceneiro', PRODUCAO_ + ', EPI-014', MATRIZ_OBS],
  ['1/2 Oficial marceneiro', PRODUCAO_ + ', EPI-014', MATRIZ_OBS],
  ['Operador de CNC', PRODUCAO_, MATRIZ_OBS],
  ['Pintor Serv Correlatos', 'EPI-008, EPI-002, EPI-004, EPI-006, EPI-007, EPI-015, EPI-016, EPI-001, EPI-017, EPI-012', MATRIZ_OBS],
  ['Motorista', 'EPI-008, EPI-004, EPI-013', MATRIZ_OBS],
];

/** Cria as abas do EPI com o catálogo e a matriz iniciais. Não apaga nada se já existirem. */
function configurarEPI() {
  const ss = planilha_();
  const novo = (nome, cab, linhas) => {
    if (ss.getSheetByName(nome)) return false;
    const sh = criarAba_(ss, nome, cab);
    if (linhas.length) sh.getRange(2, 1, linhas.length, cab.length).setValues(linhas.map(l => cab.map((_, i) => l[i] ?? '')));
    sh.autoResizeColumns(1, cab.length);
    return true;
  };
  const a = novo(ABA_EPI.CAT, EPI.CAT, EPI_SEED.map(l => l.map((v, i) => i === 3 && v ? "'" + v : v)));
  const b = novo(ABA_EPI.MAT, EPI.MAT, MATRIZ_SEED);
  novo(ABA_EPI.ENT, EPI.ENT, []); novo(ABA_EPI.REC, EPI.REC, []);
  subpasta_('EPI');
  Logger.log('EPI pronto. Catálogo ' + (a ? 'criado' : 'já existia') + '; matriz ' + (b ? 'criada' : 'já existia') + '.');
}

const abaEpi_ = k => criarAba_(planilha_(), ABA_EPI[k], EPI[k]);
const dia_ = v => v instanceof Date ? Utilities.formatDate(v, TZ_, 'yyyy-MM-dd') : String(v ?? '').trim().slice(0, 10);
const dataTxtOk_ = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

function epiCatalogo_() {
  return tabela_(abaEpi_('CAT')).filter(l => l['Código']).map(l => ({
    codigo: String(l['Código']).trim(), ativo: ativo_(l['Ativo']), epi: String(l['EPI']), ca: String(l['CA']).replace(/\D/g, ''),
    validade: dia_(l['Validade CA']), situacao: String(l['Situação CA'] || ''), troca: Number(l['Troca (dias)']) || 0,
    obs: String(l['Observação'] || ''), conferido: dia_(l['CA conferido em'])
  }));
}
function epiMatriz_() {
  return tabela_(abaEpi_('MAT')).filter(l => l['Cargo']).map(l => ({
    cargo: String(l['Cargo']).trim(), codigos: String(l['Códigos'] || '').split(/[,;\s]+/).filter(Boolean), obs: String(l['Observação'] || '')
  }));
}

function epiDados_() {
  const func = cadTabela_().linhas.map(o => ({ matricula: o.matricula, nome: o.nome || '', cargo: o.cargo || '', cpf: o.cpf || '',
    rg: o.rg || '', admissao: o.admissao || '', demissao: o.demissao || '', setor: o.local || '',
    calcado: o.tam_calcado || '', luva: o.tam_luva || '', roupa: o.tam_roupa || '' }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const entregas = tabela_(abaEpi_('ENT')).filter(l => l['ID'] && String(l['Situação']) !== 'Excluída').map(l => ({
    id: String(l['ID']), data: dia_(l['Data']), matricula: mat_(l['Matrícula']).padStart(5, '0'), codigo: String(l['Código']),
    epi: String(l['EPI']), ca: String(l['CA']).replace(/\D/g, ''), qtd: Number(l['Qtd']) || 1, motivo: String(l['Motivo'] || ''), recibo: String(l['Recibo'] || '')
  }));
  const recibos = tabela_(abaEpi_('REC')).filter(l => l['Recibo'] && String(l['Situação']) !== 'Excluído').map(l => ({
    recibo: String(l['Recibo']), tipo: String(l['Tipo']), data: dia_(l['Data']), matricula: mat_(l['Matrícula']).padStart(5, '0'),
    nome: String(l['Nome']), itens: Number(l['Itens']) || 0, anexo: !!l['Arquivo'], tipoArquivo: String(l['Tipo do arquivo'] || ''),
    anexadoEm: texto_(l['Anexado em']), obs: String(l['Observação'] || '')
  }));
  return { catalogo: epiCatalogo_(), matriz: epiMatriz_(), funcionarios: func, entregas, recibos };
}

function epiSalvarCatalogo_(b) {
  const itens = (b.itens || []).filter(i => /^[A-Z0-9-]{2,20}$/.test(String(i.codigo || '').trim()));
  const vistos = new Set();
  itens.forEach(i => { if (vistos.has(i.codigo)) throw new Error('Código repetido: ' + i.codigo); vistos.add(i.codigo); });
  const sh = abaEpi_('CAT');
  const linhas = itens.map(i => [i.codigo, i.ativo === false ? 'NÃO' : 'SIM', String(i.epi || '').slice(0, 120),
    i.ca ? "'" + String(i.ca).replace(/\D/g, '') : '', i.validade && dataTxtOk_(i.validade) ? "'" + i.validade : '',
    String(i.situacao || '').slice(0, 40), Math.max(0, Math.round(Number(i.troca) || 0)), String(i.obs || '').slice(0, 300),
    i.conferido && dataTxtOk_(i.conferido) ? "'" + i.conferido : '']);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, EPI.CAT.length).clearContent();
  if (linhas.length) sh.getRange(2, 1, linhas.length, EPI.CAT.length).setValues(linhas);
  return { ok: true, itens: linhas.length };
}

function epiSalvarMatriz_(b) {
  const cods = new Set(epiCatalogo_().map(i => i.codigo));
  const linhas = (b.matriz || []).filter(m => String(m.cargo || '').trim()).map(m => {
    const c = (m.codigos || []).map(String).filter(x => cods.has(x));
    return [String(m.cargo).trim().slice(0, 80), c.join(', '), String(m.obs || '').slice(0, 300)];
  });
  const sh = abaEpi_('MAT');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, EPI.MAT.length).clearContent();
  if (linhas.length) sh.getRange(2, 1, linhas.length, EPI.MAT.length).setValues(linhas);
  return { ok: true };
}

function proximoRecibo_(sh, ano, letra) {
  const pref = (letra || 'R') + '-' + ano + '-';
  let max = 0;
  tabela_(sh).forEach(l => { const r = String(l['Recibo']); if (r.indexOf(pref) === 0) max = Math.max(max, Number(r.slice(pref.length)) || 0); });
  return pref + String(max + 1).padStart(4, '0');
}

/** Registra uma entrega (um ou mais EPIs para um funcionário) e devolve o número do recibo para imprimir. */
function epiEntregar_(b) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const data = String(b.data || '').trim();
    if (!dataTxtOk_(data)) throw new Error('Data inválida');
    const f = cadTabela_().linhas.find(o => mat_(o.matricula) === mat_(b.matricula));
    if (!f) throw new Error('Funcionário não encontrado no cadastro');
    const cat = {}; epiCatalogo_().forEach(i => cat[i.codigo] = i);
    const itens = (b.itens || []).filter(i => cat[i.codigo] && Number(i.qtd) > 0);
    if (!itens.length) throw new Error('Escolha pelo menos um EPI');
    const shR = abaEpi_('REC'), shE = abaEpi_('ENT');
    const recibo = proximoRecibo_(shR, data.slice(0, 4), b.antiga ? 'L' : 'R'), quando = agora_();
    const linhas = itens.map((i, n) => [recibo + '-' + (n + 1), "'" + data, txt_(f.matricula), f.nome, i.codigo, cat[i.codigo].epi,
      i.ca ? "'" + String(i.ca).replace(/\D/g, '') : (cat[i.codigo].ca ? "'" + cat[i.codigo].ca : ''),
      Math.round(Number(i.qtd)), String(i.motivo || 'Entrega').slice(0, 40), recibo, quando, 'Ativa']);
    shE.getRange(shE.getLastRow() + 1, 1, linhas.length, EPI.ENT.length).setValues(linhas);
    shR.appendRow([recibo, b.antiga ? 'Lançamento de ficha antiga' : 'Recibo de entrega', "'" + data, txt_(f.matricula), f.nome, linhas.length, '', '', '', String(b.obs || '').slice(0, 300), 'Ativo']);
    return { ok: true, recibo, itens: linhas.map(l => ({ codigo: l[4], epi: l[5], ca: String(l[6]).replace(/\D/g, ''), qtd: l[7], motivo: l[8] })) };
  } finally { lock.releaseLock(); }
}

/** Anexa a foto/PDF do recibo assinado (b.recibo) ou registra uma ficha antiga (sem recibo). */
function epiAnexar_(b) {
  const mime = String(b.mime || '');
  if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(mime)) throw new Error('Envie PDF ou foto (JPG/PNG)');
  if (!b.base64) throw new Error('Arquivo vazio');
  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  const pasta = subpasta_('EPI'), sh = abaEpi_('REC');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    let linha, rec, matTxt, nomeF;
    if (b.recibo) {
      const r = tabela_(sh).find(l => String(l['Recibo']) === String(b.recibo));
      if (!r) throw new Error('Recibo não encontrado');
      linha = r._linha; rec = String(r['Recibo']); matTxt = mat_(r['Matrícula']).padStart(5, '0'); nomeF = String(r['Nome']);
      if (r['Arquivo']) { try { DriveApp.getFileById(String(r['Arquivo'])).setTrashed(true); } catch (e) {} }
    } else {
      const f = cadTabela_().linhas.find(o => mat_(o.matricula) === mat_(b.matricula));
      if (!f) throw new Error('Funcionário não encontrado no cadastro');
      const data = String(b.data || '').trim();
      if (!dataTxtOk_(data)) throw new Error('Informe a data da ficha');
      rec = 'F-' + data.slice(0, 4) + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
      matTxt = f.matricula; nomeF = f.nome;
      sh.appendRow([rec, String(b.tipo || 'Ficha anterior').slice(0, 40), "'" + data, txt_(matTxt), nomeF, '', '', '', '', String(b.obs || '').slice(0, 300), 'Ativo']);
      linha = sh.getLastRow();
    }
    const nome = limpa_(rec + ' ' + matTxt + ' ' + nomeF) + '.' + ext;
    const arq = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(String(b.base64)), mime, nome));
    sh.getRange(linha, EPI.REC.indexOf('Arquivo') + 1, 1, 3).setValues([[arq.getId(), mime, agora_()]]);
    return { ok: true, recibo: rec };
  } finally { lock.releaseLock(); }
}

function epiAbrirAnexo_(b) {
  const r = tabela_(abaEpi_('REC')).find(l => String(l['Recibo']) === String(b.recibo));
  if (!r || !r['Arquivo']) throw new Error('Anexo não encontrado');
  const blob = DriveApp.getFileById(String(r['Arquivo'])).getBlob();
  return { nome: blob.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/** Cancela um recibo lançado por engano (as entregas dele deixam de contar). O anexo vai para a lixeira. */
function epiExcluirRecibo_(b) {
  const shR = abaEpi_('REC'), shE = abaEpi_('ENT');
  const r = tabela_(shR).find(l => String(l['Recibo']) === String(b.recibo));
  if (!r) throw new Error('Recibo não encontrado');
  shR.getRange(r._linha, EPI.REC.indexOf('Situação') + 1).setValue('Excluído');
  if (r['Arquivo']) { try { DriveApp.getFileById(String(r['Arquivo'])).setTrashed(true); } catch (e) {} }
  const col = EPI.ENT.indexOf('Situação') + 1;
  tabela_(shE).filter(l => String(l['Recibo']) === String(b.recibo)).forEach(l => shE.getRange(l._linha, col).setValue('Excluída'));
  return { ok: true };
}

/** Grava tamanhos (botina, luva, roupa) no cadastro do funcionário. */
function epiTamanhos_(b) {
  return cadSalvar_(b.matricula, { tam_calcado: b.calcado || '', tam_luva: b.luva || '', tam_roupa: b.roupa || '' }, 'manual');
}

// ---------- Conferência automática dos CAs ----------
// A base pública do CAEPI (Ministério do Trabalho) é baixada toda semana pelo GitHub (caepi/atualizar.py)
// e publicada em caepi/ca/<grupo>.json no site. Esta função lê de lá a validade e a situação de cada CA do catálogo.
const CAEPI_URL = 'https://orro-christensen.github.io/documentos/caepi/';

function verificarCAs() {
  const sh = abaEpi_('CAT'), v = sh.getDataRange().getValues(), cab = v[0].map(String);
  const iCA = cab.indexOf('CA'), iVal = cab.indexOf('Validade CA'), iSit = cab.indexOf('Situação CA'), iConf = cab.indexOf('CA conferido em'), iEpi = cab.indexOf('EPI');
  const grupos = {}, hoje = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd'), alertas = [];
  const busca = ca => {
    const g = String(Math.floor(Number(ca) / 1000));
    if (!(g in grupos)) {
      try { const r = UrlFetchApp.fetch(CAEPI_URL + 'ca/' + g + '.json?t=' + Date.now(), { muteHttpExceptions: true });
        grupos[g] = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : {}; } catch (e) { grupos[g] = {}; }
    }
    return grupos[g][String(Number(ca))];
  };
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    const ca = String(v[i][iCA]).replace(/\D/g, '');
    if (!ca) continue;
    const r = busca(ca);
    const val = r ? isoDeBR_(r[0]) : '', sit = r ? (r[1] || '') : 'CA não encontrado';
    sh.getRange(i + 1, iVal + 1).setValue(val ? "'" + val : '');
    sh.getRange(i + 1, iSit + 1).setValue(sit);
    sh.getRange(i + 1, iConf + 1).setValue("'" + hoje);
    n++;
    if (!r || (val && val < hoje) || (sit && !/V[AÁ]LIDO/i.test(sit))) alertas.push(v[i][iEpi] + ' — CA ' + ca + ': ' + (val ? 'validade ' + val.split('-').reverse().join('/') + ', ' : '') + sit);
  }
  if (alertas.length) avisarDono_('Documentos O&C: CA de EPI com problema', 'Confira no catálogo de EPI:\n\n' + alertas.join('\n'));
  Logger.log('CAs conferidos: ' + n + (alertas.length ? ' | alertas: ' + alertas.length : ''));
  return { ok: true, conferidos: n, alertas };
}
function isoDeBR_(s) { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : (String(s || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]; }

/** Liga a conferência semanal dos CAs (toda segunda, entre 9h e 10h). Rodar uma vez. */
function instalarConferenciaCA() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'verificarCAs').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verificarCAs').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  Logger.log('Conferência semanal dos CAs ligada.');
}
