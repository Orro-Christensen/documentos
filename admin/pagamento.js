// Relação de pagamento (só administração): lê o PDF de holerites ou de adiantamento da contabilidade,
// pega o valor líquido de cada funcionário, junta com os dados bancários do cadastro e gera um PDF
// para imprimir e mandar ao financeiro.
// Depende de: chamar, esc, aviso, competencia, dataBR, dados, cad, carregarCad, matN, nomeBanco, sem, $ (admin/index.html),
// pdfjs (comum.js), pdfBase (epi.js) e window.PDFLib.

let pag = { comp: '', tipo: 'Holerite', lido: null, carregando: false };
const TIPOS_PAG = ['Holerite', 'Adiantamento'];
const realBR = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numBR = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
const DINHEIRO = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;

// Valor líquido de uma página: procura o rótulo "Líquido" e pega o valor em dinheiro mais perto
// à direita (mesma linha) ou logo abaixo. Funciona com o layout do holerite e do adiantamento.
function liquidoDaPagina(itens) {
  const its = itens.map(i => ({ s: String(i.str).trim(), x: i.transform[4], y: i.transform[5], w: i.width })).filter(i => i.s);
  const rots = its.filter(i => /l[íi]quido/i.test(i.s));
  for (const r of rots) {
    // valor no próprio item ("Líquido a Receber 1.234,56")
    const m = r.s.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
    if (m) return numBR(m[1]);
    const cands = its.filter(i => DINHEIRO.test(i.s) && (
      (Math.abs(i.y - r.y) <= 4 && i.x > r.x) ||                     // mesma linha, à direita
      (i.y < r.y && r.y - i.y <= 30 && Math.abs(i.x - r.x) <= 160)    // logo abaixo
    )).map(i => ({ i, d: Math.abs(i.y - r.y) * 3 + Math.abs(i.x - r.x) / 10 }));
    if (cands.length) return numBR(cands.sort((a, b) => a.d - b.d)[0].i.s);
  }
  return null;
}

async function lerPagamentos(bytes) {
  const doc = await pdfjs().getDocument({ data: bytes.slice() }).promise;
  const linhas = []; let tipo = '', comp = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const txt = tc.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('');
    const m = txt.match(/(?:^|\n)\s*([^\n]*?)\s*\n\s*(\d{5,6})\s+([A-ZÀ-Ý][A-ZÀ-Ý' .-]+?)\s*\n?\s*PIS:/);
    if (!m) continue;   // página sem funcionário (capa, resumo da folha)
    const d = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!comp && d) comp = d[3] + '-' + d[2];
    if (!tipo) tipo = tipoDoTexto(m[1]);
    linhas.push({ pag: n, matricula: m[2], nomeDoc: m[3].trim(), liquido: liquidoDaPagina(tc.items) });
  }
  // a mesma matrícula em duas páginas (holerite que continua na página seguinte): fica o valor que apareceu
  const porMat = {};
  linhas.forEach(l => { const k = matN(l.matricula); if (!porMat[k] || (porMat[k].liquido == null && l.liquido != null)) porMat[k] = l; });
  return { linhas: Object.values(porMat), tipo, comp };
}

async function telaPagamento() {
  const c = $('#conteudo');
  try { if (!cad) await carregarCad(); } catch (e) { c.innerHTML = `<div class="vazio-msg">${esc(e.message)}</div>`; return; }
  const meses = [...new Set(dados.documentos.filter(d => d.competencia.length === 7 && TIPOS_PAG.includes(d.tipo)).map(d => d.competencia))].sort().reverse();
  if (!pag.comp) pag.comp = meses[0] || '';
  const temDoTipo = dados.documentos.some(d => d.competencia === pag.comp && d.tipo === pag.tipo);
  c.innerHTML = `<div class="cartao">
      <div class="titulo" style="margin-top:0">💰 Relação de pagamento para o financeiro</div>
      <p class="meta">Lê o PDF da contabilidade (o mesmo dos contra-cheques), pega o <b>valor líquido</b> de cada funcionário e junta com os dados bancários do cadastro. Gera um PDF para imprimir.</p>
      <div class="linha2">
        <div><label class="campo">Competência</label><input type="month" id="pgComp" value="${esc(pag.comp)}"></div>
        <div><label class="campo">Tipo</label><select id="pgTipo">${TIPOS_PAG.map(t => `<option${t === pag.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="acoes">
        <label class="btn btn-claro" style="cursor:pointer">📄 Escolher o PDF da contabilidade<input type="file" id="pgArq" accept="application/pdf,.pdf" hidden></label>
        <button class="btn btn-ok" id="pgLer" ${temDoTipo ? '' : 'disabled'}>📥 Usar o PDF já enviado</button>
      </div>
      <p class="meta">${temDoTipo ? `Já existe ${esc(pag.tipo.toLowerCase())} de ${esc(competencia(pag.comp))} enviado aos funcionários: dá para usar o PDF guardado.`
        : `Nenhum ${esc(pag.tipo.toLowerCase())} de ${esc(competencia(pag.comp) || '—')} enviado ainda: escolha o PDF da contabilidade (não precisa enviar aos funcionários antes).`}</p>
    </div><div id="pgCorpo">${pag.carregando ? '<div class="carregando">Lendo o PDF…</div>' : ''}</div>`;
  $('#pgComp').onchange = e => { pag.comp = e.target.value; pag.lido = null; telaPagamento(); };
  $('#pgTipo').onchange = e => { pag.tipo = e.target.value; pag.lido = null; telaPagamento(); };
  const ler = async (bytes, nomeArquivo) => {
    $('#pgCorpo').innerHTML = '<div class="carregando">Lendo o PDF…</div>';
    try {
      const r = await lerPagamentos(bytes);
      if (!r.linhas.length) throw new Error('Não achei nenhum funcionário nesse PDF.');
      const confere = [r.tipo && r.tipo !== pag.tipo ? `o PDF parece ser de <b>${esc(r.tipo)}</b>, não de ${esc(pag.tipo)}` : '',
        r.comp && r.comp !== pag.comp ? `a data do PDF é de <b>${esc(competencia(r.comp))}</b>, não de ${esc(competencia(pag.comp))}` : ''].filter(Boolean);
      pag.lido = { comp: pag.comp, tipo: pag.tipo, nomeArquivo, linhas: r.linhas.map(montarLinhaPag), confere };
      desenharPagamento();
    } catch (e) { pag.lido = null; $('#pgCorpo').innerHTML = `<div class="vazio-msg">${esc(e.message)}</div>`; }
  };
  $('#pgArq').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!/^\d{4}-\d{2}$/.test(pag.comp)) return aviso('Escolha a competência', true);
    await ler(new Uint8Array(await f.arrayBuffer()), f.name);
  };
  $('#pgLer').onclick = async () => {
    $('#pgCorpo').innerHTML = '<div class="carregando">Buscando o PDF na pasta privada…</div>';
    try { const r = await chamar({ action: 'relOriginal', competencia: pag.comp, tipo: pag.tipo }, 90000); await ler(App.bytesDeBase64(r.base64), r.nomeArquivo); }
    catch (e) { $('#pgCorpo').innerHTML = `<div class="vazio-msg">${esc(e.message)}</div>`; }
  };
  if (pag.lido && pag.lido.comp === pag.comp && pag.lido.tipo === pag.tipo) desenharPagamento();
}

function montarLinhaPag(l) {
  const f = cad.find(x => matN(x.matricula) === matN(l.matricula)) || {};
  return {
    matricula: String(l.matricula).padStart(5, '0'), nome: f.nome || l.nomeDoc, liquido: l.liquido, incluir: l.liquido > 0,
    banco: f.banco || '', bancoNome: f.banco_nome || nomeBanco(f.banco), agencia: f.agencia || '', conta: f.conta || '', pix: f.pix || '',
    noCadastro: !!f.matricula
  };
}
const temBanco = l => !!(l.pix || (l.banco && l.agencia && l.conta));

function desenharPagamento() {
  const L = pag.lido, b = $('#pgCorpo');
  const inc = L.linhas.filter(l => l.incluir);
  const total = inc.reduce((s, l) => s + (l.liquido || 0), 0);
  const semValor = L.linhas.filter(l => l.liquido == null).length, semBanco = inc.filter(l => !temBanco(l)).length;
  L.linhas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  b.innerHTML = `<div class="cartao tabela-rolagem">
      <div class="titulo" style="margin-top:0">${esc(L.tipo)} · ${esc(competencia(L.comp))} <span class="meta" style="text-transform:none">— ${esc(L.nomeArquivo)}</span></div>
      ${L.confere && L.confere.length ? `<p style="color:var(--perigo);font-weight:600">⚠ Confira: ${L.confere.join(' e ')}. Se o arquivo estiver certo, corrija a competência ou o tipo acima e leia de novo.</p>` : ''}
      ${semValor ? `<p style="color:var(--perigo);font-weight:600">⚠ ${semValor} funcionário(s) sem valor líquido encontrado no PDF. Digite o valor na linha em laranja.</p>` : ''}
      ${semBanco ? `<p style="color:var(--acento);font-weight:600">⚠ ${semBanco} funcionário(s) sem dados bancários completos no cadastro (👷 Funcionários). O PDF sai com o espaço em branco.</p>` : ''}
      <table class="tab-cad"><thead><tr><th></th><th>Funcionário</th><th>Banco / agência / conta</th><th>PIX</th><th style="text-align:right">Líquido (R$)</th></tr></thead>
      <tbody>${L.linhas.map((l, i) => `<tr class="${l.liquido == null ? 'falta' : ''}">
        <td><input type="checkbox" class="pgInc" data-i="${i}" ${l.incluir ? 'checked' : ''} style="width:auto"></td>
        <td><b>${esc(l.nome)}</b><div class="meta">Matrícula ${esc(l.matricula)}${l.noCadastro ? '' : ' · <span style="color:var(--perigo)">fora do cadastro</span>'}</div></td>
        <td>${l.banco || l.agencia || l.conta ? `${esc([l.banco, l.bancoNome].filter(Boolean).join(' - '))}<div class="meta">Ag. ${esc(l.agencia || '—')} · C/C ${esc(l.conta || '—')}</div>` : '<span class="nao">—</span>'}</td>
        <td>${esc(l.pix) || '<span class="nao">—</span>'}</td>
        <td style="text-align:right"><input class="pgVal" data-i="${i}" inputmode="decimal" value="${l.liquido == null ? '' : realBR(l.liquido)}" style="width:110px;text-align:right" placeholder="0,00"></td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td colspan="3"><b>${inc.length} funcionário(s) na relação</b></td><td style="text-align:right"><b>R$ ${realBR(total)}</b></td></tr></tfoot></table>
      <p class="meta">Desmarque quem não deve entrar (ex.: líquido zero, desligado pago na rescisão). Valor corrigido aqui vale só para esta relação; não muda o contra-cheque.</p>
    </div>
    <div class="cartao"><label class="campo">Data do pagamento</label><input type="date" id="pgData" value="${esc(L.data || '')}" style="max-width:200px">
      <label class="campo" style="margin-top:8px">Observação para o financeiro (opcional)</label><input id="pgObs" value="${esc(L.obs || '')}" placeholder="ex.: pagar até o 5º dia útil">
      <div class="acoes"><button class="btn btn-ok" id="pgPdf">🖨️ Gerar PDF da relação</button></div></div>
    <div id="pgVisor"></div>`;
  b.querySelectorAll('.pgInc').forEach(x => x.onchange = () => { L.linhas[x.dataset.i].incluir = x.checked; desenharPagamento(); });
  b.querySelectorAll('.pgVal').forEach(x => x.onchange = () => {
    const v = x.value.trim(), l = L.linhas[x.dataset.i];
    if (!v) { l.liquido = null; l.incluir = false; return desenharPagamento(); }
    const n = /,/.test(v) ? numBR(v) : Number(v);
    if (!isFinite(n) || n < 0) return aviso('Valor inválido', true);
    l.liquido = Math.round(n * 100) / 100; l.incluir = l.liquido > 0; desenharPagamento();
  });
  $('#pgData').onchange = e => L.data = e.target.value;
  $('#pgObs').onchange = e => L.obs = e.target.value.trim();
  $('#pgPdf').onclick = async () => {
    L.data = $('#pgData').value; L.obs = $('#pgObs').value.trim();
    const lista = L.linhas.filter(l => l.incluir && l.liquido > 0);
    if (!lista.length) return aviso('Nenhum funcionário marcado com valor', true);
    if (L.linhas.some(l => l.incluir && l.liquido == null)) return aviso('Há funcionário marcado sem valor', true);
    try {
      const bytes = await pdfRelacaoPagamento(L, lista);
      const nome = `Relação de pagamento - ${L.tipo} ${L.comp}.pdf`;
      App.baixar(bytes, nome, 'application/pdf');
      $('#pgVisor').innerHTML = '';
      aviso('PDF gerado: ' + nome);
    } catch (e) { aviso('Erro ao gerar o PDF: ' + e.message, true); }
  };
}

async function pdfRelacaoPagamento(L, lista) {
  const P = await pdfBase(), { rgb } = window.PDFLib;
  const total = lista.reduce((s, l) => s + l.liquido, 0);
  const titulo = 'Relação de pagamento', sub = `${L.tipo} · competência ${competencia(L.comp)}`;
  const cols = [['Nº', 18], ['Funcionário', 168], ['Banco', 80], ['Agência', 42], ['Conta corrente', 62], ['Chave PIX', 85], ['Líquido (R$)', 60]];
  const linha = (l, n) => [String(n + 1), l.nome, [l.banco, l.bancoNome].filter(Boolean).join(' - '), l.agencia, l.conta, l.pix, realBR(l.liquido)];
  const POR_PAG = 25, paginas = [];
  for (let i = 0; i < lista.length; i += POR_PAG) paginas.push(lista.slice(i, i + POR_PAG));
  const gerado = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  paginas.forEach((parte, k) => {
    const pg = P.doc.addPage([595.28, 841.89]);
    let y = P.cabecalho(pg, titulo, sub);
    if (k === 0) {
      const info = [L.data ? 'Data do pagamento: ' + L.data.split('-').reverse().join('/') : '', `${lista.length} funcionário(s)`, 'Total: R$ ' + realBR(total)].filter(Boolean).join('   ·   ');
      pg.drawText(info, { x: 40, y, size: 10, font: P.B }); y -= 14;
      if (L.obs) y = P.escreve(pg, 'Observação: ' + L.obs, 40, y, { t: 9 }) - 2;
      y -= 6;
    }
    y = P.tabela(pg, y, cols, parte.map((l, i) => linha(l, k * POR_PAG + i)), { alt: 20, direita: [6] });
    if (k === paginas.length - 1) {
      pg.drawRectangle({ x: 40, y: y - 13, width: 515, height: 20, color: rgb(0.9, 0.93, 0.96) });
      pg.drawText('TOTAL', { x: 44, y: y - 7, size: 10, font: P.B });
      const t = realBR(total);
      pg.drawText(t, { x: 551 - P.B.widthOfTextAtSize(t, 10), y: y - 7, size: 10, font: P.B });
      y -= 70;
      P.assinatura(pg, 40, y, 220, 'Conferido por (RH)', '');
      P.assinatura(pg, 335, y, 220, 'Autorizado por', '');
    }
    P.rodape(pg, `Gerado em ${gerado} pelo Documentos O&C a partir do PDF da contabilidade (${L.nomeArquivo}) · página ${k + 1} de ${paginas.length}`);
  });
  return P.doc.save();
}
