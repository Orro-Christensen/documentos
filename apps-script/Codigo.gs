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
      case 'adminLiberar': sessaoAdmin_(b.token); liberar_(b.nome); return json_({ ok: true });
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
