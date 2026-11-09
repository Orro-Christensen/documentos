/**
 * Documentos O&C — backend (Google Apps Script)
 *
 * Guarda os documentos dos funcionários (contra-cheques e outros) numa pasta PRIVADA do Google Drive
 * e só entrega cada arquivo ao próprio funcionário, depois de conferir a senha de 4 números
 * (a mesma do Pede Aí, lida da aba "Funcionarios" da planilha do Pede Aí).
 *
 * Nada de dado pessoal fica no GitHub: lá ficam só as telas.
 *
 * Instalação (uma vez):
 *  1) Cole este arquivo num projeto novo em script.google.com e salve.
 *  2) Troque o valor de NOVO_PIN_ADMIN (mais abaixo) e rode a função "configurar".
 *     Ela cria a pasta privada "Documentos O&C (privado)" e a planilha de controle dentro dela.
 *  3) Implantar > Nova implantação > App da Web > Executar como: Eu / Quem pode acessar: Qualquer pessoa.
 *  4) Cole a URL /exec no config.js do site.
 */

// Planilha do Pede Aí (aba Funcionarios: Nome, Ativo, Senha). Só é LIDA, nunca alterada.
const PLANILHA_PEDEAI_ID = '12xfUT4sbeSyINRmJhTsSd3VkouEKVhEJYkCTwraNL5E';

// PIN da tela de administração (envio dos documentos). Use 6 números ou mais.
// Para trocar: altere aqui e rode "configurar" de novo (não apaga nada).
const NOVO_PIN_ADMIN = '';

const NOME_PASTA = 'Documentos O&C (privado)';
const NOME_PLANILHA = 'Documentos O&C — controle';
const ABA = { DOC: 'Documentos', MAT: 'Matriculas' };
const CAB = {
  DOC: ['ID', 'Competência', 'Tipo', 'Matrícula', 'Nome no documento', 'Arquivo', 'Enviado em', 'Visto em', 'Vezes visto'],
  MAT: ['Matrícula', 'Nome no documento', 'Funcionário (Pede Aí)']
};
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
  // A pasta fica só com o dono. Se alguém tiver compartilhado, desfaz.
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
  criarAba_(ss, ABA.DOC, CAB.DOC);
  criarAba_(ss, ABA.MAT, CAB.MAT);
  const sobra = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (sobra && ss.getSheets().length > 1) ss.deleteSheet(sobra);

  if (NOVO_PIN_ADMIN) {
    if (!/^\d{6,}$/.test(NOVO_PIN_ADMIN)) throw new Error('NOVO_PIN_ADMIN precisa ter 6 números ou mais.');
    p.setProperty('PIN_ADMIN', NOVO_PIN_ADMIN);
  }
  if (!p.getProperty('PIN_ADMIN')) throw new Error('Defina NOVO_PIN_ADMIN (6 números ou mais) e rode "configurar" de novo.');

  // Confere se a planilha do Pede Aí abre (precisa da aba Funcionarios).
  const n = funcionariosPedeAi_().length;
  Logger.log('Pronto. Pasta: ' + pasta.getUrl() + ' | Planilha: ' + ss.getUrl() + ' | Funcionários ativos no Pede Aí: ' + n);
}

function criarAba_(ss, nome, cab) {
  let sh = ss.getSheetByName(nome);
  if (sh) return sh;
  sh = ss.insertSheet(nome);
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#2f3b4c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange('A:Z').setNumberFormat('@');   // tudo como texto (matrícula 00078 não vira 78)
  return sh;
}

const planilha_ = () => SpreadsheetApp.openById(props_().getProperty('PLANILHA_ID'));
const pasta_ = () => DriveApp.getFolderById(props_().getProperty('PASTA_ID'));

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

function funcionariosPedeAi_() {
  const sh = SpreadsheetApp.openById(PLANILHA_PEDEAI_ID).getSheetByName('Funcionarios');
  if (!sh) throw new Error('Aba Funcionarios não encontrada na planilha do Pede Aí');
  return tabela_(sh).filter(f => f['Nome'] && ativo_(f['Ativo']))
    .map(f => ({ nome: String(f['Nome']).trim(), senha: String(f['Senha'] ?? '').trim() }));
}
function matriculas_() {
  return tabela_(planilha_().getSheetByName(ABA.MAT)).map(m => ({
    linha: m._linha, matricula: String(m['Matrícula']).trim(), nomeDoc: String(m['Nome no documento'] || ''),
    funcionario: String(m['Funcionário (Pede Aí)'] || '').trim()
  }));
}
function documentos_() {
  return tabela_(planilha_().getSheetByName(ABA.DOC)).map(d => ({
    linha: d._linha, id: String(d['ID']), competencia: String(d['Competência']), tipo: String(d['Tipo']),
    matricula: String(d['Matrícula']).trim(), nomeDoc: String(d['Nome no documento'] || ''), arquivo: String(d['Arquivo']),
    enviadoEm: texto_(d['Enviado em']), vistoEm: texto_(d['Visto em']), vezes: Number(d['Vezes visto']) || 0
  }));
}

// ---------- API ----------
function doGet() { return json_({ ok: true, app: 'documentos-oc' }); }

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ erro: 'Requisição inválida' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    switch (b.action) {
      case 'funcionarios': return json_({ nomes: nomesComDocumento_() });
      case 'login':        return json_(login_(b));
      case 'meus':         return json_({ docs: meusDocs_(sessaoFunc_(b.token)) });
      case 'abrir':        return json_(abrir_(b));
      case 'sair':         cache_().remove('tf_' + b.token); return json_({ ok: true });
      case 'adminLogin':   return json_(adminLogin_(b));
      case 'adminDados':   sessaoAdmin_(b.token); return json_(adminDados_());
      case 'adminEnviar':  sessaoAdmin_(b.token); return json_(adminEnviar_(b));
      case 'adminOriginal':sessaoAdmin_(b.token); return json_(adminOriginal_(b));
      case 'adminExcluir': sessaoAdmin_(b.token); return json_(adminExcluir_(b));
      case 'adminLiberar': sessaoAdmin_(b.token); liberar_(b.nome); return json_({ ok: true });
      default: return json_({ erro: 'Ação desconhecida' });
    }
  } catch (err) {
    const m = String(err.message || err);
    if (m.indexOf('SESSAO|') === 0) return json_({ erro: m.slice(7), sessao: true });
    return json_({ erro: m });
  } finally { lock.releaseLock(); }
}

// ---------- Funcionário ----------
function nomesComDocumento_() {
  const comMat = new Set(matriculas_().map(m => m.funcionario).filter(Boolean));
  return funcionariosPedeAi_().map(f => f.nome).filter(n => comMat.has(n)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function login_(b) {
  const nome = String(b.nome || '').trim();
  const f = funcionariosPedeAi_().find(x => x.nome === nome);
  if (!f) throw new Error('Funcionário não encontrado');
  const p = props_(), c = cache_();
  if (p.getProperty('bloq_' + nome)) throw new Error('Acesso bloqueado por excesso de senhas erradas. Fale com o responsável para liberar.');
  if (c.get('pausa_' + nome)) throw new Error('Muitas senhas erradas. Aguarde 15 minutos.');
  let certa = f.senha;
  if (/^\d{1,4}$/.test(certa)) certa = certa.padStart(4, '0');
  if (!certa) throw new Error('Você ainda não tem senha. Fale com o responsável.');
  if (String(b.senha || '').trim() !== certa) {
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
  const token = Utilities.getUuid();
  c.put('tf_' + token, nome, SESSAO_FUNC_SEG);
  return { token, nome, docs: meusDocs_(nome) };
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
  return documentos_().filter(d => mats.has(d.matricula))
    .map(d => ({ id: d.id, competencia: d.competencia, tipo: d.tipo, enviadoEm: d.enviadoEm, visto: !!d.vistoEm }))
    .sort((a, b) => (b.competencia + b.enviadoEm).localeCompare(a.competencia + a.enviadoEm));
}

function abrir_(b) {
  const nome = sessaoFunc_(b.token);
  const d = documentos_().find(x => x.id === String(b.id));
  if (!d || !matsDe_(nome).has(d.matricula)) throw new Error('Documento não encontrado');
  const blob = DriveApp.getFileById(d.arquivo).getBlob();
  const sh = planilha_().getSheetByName(ABA.DOC);
  if (!d.vistoEm) sh.getRange(d.linha, CAB.DOC.indexOf('Visto em') + 1).setValue(agora_());
  sh.getRange(d.linha, CAB.DOC.indexOf('Vezes visto') + 1).setValue(String(d.vezes + 1));
  return { nomeArquivo: d.tipo + ' ' + d.competencia + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
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
  return {
    funcionarios: funcionariosPedeAi_().map(f => f.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    matriculas: matriculas_().map(m => ({ matricula: m.matricula, nomeDoc: m.nomeDoc, funcionario: m.funcionario })),
    documentos: documentos_().map(d => ({ id: d.id, competencia: d.competencia, tipo: d.tipo, matricula: d.matricula,
      nomeDoc: d.nomeDoc, enviadoEm: d.enviadoEm, vistoEm: d.vistoEm, vezes: d.vezes })),
    bloqueados,
    pastaUrl: pasta_().getUrl(),
    planilhaUrl: planilha_().getUrl()
  };
}

function subpasta_(nome) {
  const pai = pasta_(), it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}
const limpa_ = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim();

function adminEnviar_(b) {
  const comp = String(b.competencia || ''), tipo = limpa_(b.tipo), mat = String(b.matricula || '').trim();
  if (!/^\d{4}-\d{2}$/.test(comp)) throw new Error('Competência inválida (use AAAA-MM)');
  if (!tipo) throw new Error('Informe o tipo de documento');
  if (!/^\d{1,10}$/.test(mat)) throw new Error('Matrícula inválida');
  const bytes = Utilities.base64Decode(String(b.base64 || ''));
  if (!bytes.length) throw new Error('Arquivo vazio');

  // Vincula a matrícula ao funcionário do Pede Aí (fica salvo para os próximos meses).
  const shM = planilha_().getSheetByName(ABA.MAT);
  const m = matriculas_().find(x => x.matricula === mat);
  const func = String(b.funcionario || '').trim();
  if (m) {
    if (func && func !== m.funcionario) shM.getRange(m.linha, 3).setValue(func);
    if (b.nomeDoc && b.nomeDoc !== m.nomeDoc) shM.getRange(m.linha, 2).setValue(String(b.nomeDoc));
  } else {
    shM.appendRow([mat, String(b.nomeDoc || ''), func]);
  }

  const pasta = subpasta_(comp);
  const arq = pasta.createFile(Utilities.newBlob(bytes, 'application/pdf', comp + ' ' + tipo + ' ' + mat + '.pdf'));

  // Mesmo documento enviado de novo (correção): troca o arquivo e zera o "visto".
  const sh = planilha_().getSheetByName(ABA.DOC);
  const antigo = documentos_().find(d => d.competencia === comp && d.tipo === tipo && d.matricula === mat);
  if (antigo) {
    try { DriveApp.getFileById(antigo.arquivo).setTrashed(true); } catch (e) {}
    sh.getRange(antigo.linha, 1, 1, CAB.DOC.length).setValues([[antigo.id, comp, tipo, mat, String(b.nomeDoc || ''), arq.getId(), agora_(), '', '0']]);
    return { ok: true, id: antigo.id, substituido: true };
  }
  const id = Utilities.getUuid().slice(0, 13);
  sh.appendRow([id, comp, tipo, mat, String(b.nomeDoc || ''), arq.getId(), agora_(), '', '0']);
  return { ok: true, id };
}

/** Guarda o PDF original da contabilidade (o arquivo inteiro) na pasta da competência. */
function adminOriginal_(b) {
  const comp = String(b.competencia || '');
  if (!/^\d{4}-\d{2}$/.test(comp)) throw new Error('Competência inválida');
  const bytes = Utilities.base64Decode(String(b.base64 || ''));
  const nome = comp + ' ' + limpa_(b.tipo) + ' - original - ' + limpa_(b.nomeArquivo || 'arquivo.pdf');
  subpasta_(comp).createFile(Utilities.newBlob(bytes, 'application/pdf', nome));
  return { ok: true };
}

function adminExcluir_(b) {
  const d = documentos_().find(x => x.id === String(b.id));
  if (!d) throw new Error('Documento não encontrado');
  try { DriveApp.getFileById(d.arquivo).setTrashed(true); } catch (e) {}
  planilha_().getSheetByName(ABA.DOC).deleteRow(d.linha);
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
