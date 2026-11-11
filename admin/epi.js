// ===================== Módulo EPI (só administração) =====================
// Catálogo de EPIs com CA, matriz por cargo (PGR), entregas com recibo para assinar,
// ficha de EPI da NR-6 em branco, anexos (recibos assinados e fichas antigas) e pendências.
// Depende de: chamar, esc, dataBR, aviso, sem, fechar, $ (admin/index.html) e window.PDFLib.

const EMPRESA = {
  nome: 'Orro & Christensen Business Ltda.',
  cnpj: '71.446.207/0001-32',
  endereco: 'Rua Colômbia, 876, Sala 34, Guilhermina, Praia Grande/SP',
  cidade: 'Praia Grande'
};
const CAEPI = new URL('../caepi/', location.href).href;
const MOTIVOS = ['Entrega inicial', 'Troca periódica', 'Troca por desgaste', 'Perda', 'Dano', 'Outro'];
let epi = null;                                  // dados do servidor
let epiV = { v: 'func', m: null, busca: '' };    // vista atual
const caCache = {};                              // grupos da base CAEPI já baixados

const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const diasAte = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(hojeISO() + 'T12:00:00')) / 86400000);
const br = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const mesmoCargo = (a, b) => sem(a).join(' ') === sem(b).join(' ');

async function carregarEpi() { epi = await chamar({ action: 'epiDados' }); }

// ---------- base CAEPI publicada pelo GitHub (caepi/ca/<grupo>.json) ----------
async function consultaCA(ca) {
  ca = String(ca || '').replace(/\D/g, '');
  if (!ca) return null;
  const g = String(Math.floor(Number(ca) / 1000));
  if (!(g in caCache)) {
    try { const r = await fetch(CAEPI + 'ca/' + g + '.json', { cache: 'no-cache' }); caCache[g] = r.ok ? await r.json() : {}; }
    catch (e) { caCache[g] = {}; }
  }
  const r = caCache[g][String(Number(ca))];
  if (!r) return { ca, achou: false };
  const m = String(r[0]).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return { ca, achou: true, validade: m ? `${m[3]}-${m[2]}-${m[1]}` : '', situacao: r[1] || '', equipamento: r[2] || '', fabricante: r[3] || '', marca: r[4] || '' };
}
// Situação do CA para exibição: {cls, txt}
function estadoCA(item) {
  if (!item.ca) return { cls: 'alerta', txt: 'Sem CA' };
  if (item.situacao && !/V[ÁA]LIDO/i.test(item.situacao)) return { cls: 'erro', txt: item.situacao };
  if (item.validade && item.validade < hojeISO()) return { cls: 'erro', txt: 'Vencido em ' + br(item.validade) };
  if (item.validade && diasAte(item.validade) <= 60) return { cls: 'alerta', txt: 'Vence em ' + br(item.validade) };
  if (item.validade) return { cls: 'ok', txt: 'Válido até ' + br(item.validade) };
  return { cls: 'nao', txt: 'Validade não conferida' };
}
const selo = e => `<span class="epi-selo ${e.cls}">${esc(e.txt)}</span>`;

// ---------- regras ----------
const catDe = cod => epi.catalogo.find(i => i.codigo === cod);
function epiDoCargo(cargo) {
  const m = epi.matriz.find(x => mesmoCargo(x.cargo, cargo));
  return m ? m.codigos.map(catDe).filter(i => i && i.ativo) : [];
}
function situacaoFunc(f) {
  const ents = epi.entregas.filter(e => e.matricula === f.matricula);
  const itens = epiDoCargo(f.cargo).map(i => {
    const ult = ents.filter(e => e.codigo === i.codigo).sort((a, b) => b.data.localeCompare(a.data))[0];
    let st;
    if (!ult) st = { cls: 'erro', txt: 'Nunca entregue', pend: true };
    else if (i.troca > 0) {
      const prox = somaDias(ult.data, i.troca), d = diasAte(prox);
      st = d < 0 ? { cls: 'erro', txt: 'Troca vencida em ' + br(prox), pend: true, prox }
        : d <= 7 ? { cls: 'alerta', txt: 'Trocar até ' + br(prox), prox } : { cls: 'ok', txt: 'Próxima troca ' + br(prox), prox };
    } else st = { cls: 'ok', txt: 'Entregue (sem prazo de troca)' };
    return { item: i, ult, st };
  });
  const recs = epi.recibos.filter(r => r.matricula === f.matricula).sort((a, b) => b.data.localeCompare(a.data) || b.recibo.localeCompare(a.recibo));
  const semAssin = recs.filter(r => r.tipo === 'Recibo de entrega' && !r.anexo);
  return { itens, recs, semAssin, pend: itens.filter(x => x.st.pend).length + semAssin.length, ultima: ents.map(e => e.data).sort().pop() || '' };
}
const ativos = () => epi.funcionarios.filter(f => !f.demissao);

// ---------- tela principal ----------
async function telaEpi() {
  const c = $('#conteudo');
  try { if (!epi) { c.innerHTML = '<div class="carregando">Carregando EPI…</div>'; await carregarEpi(); } }
  catch (e) { c.innerHTML = `<div class="vazio-msg">${esc(e.message)}${/Ação desconhecida|desconhec/i.test(e.message) ? '<br>O script ainda não tem o módulo de EPI: implante a nova versão.' : ''}</div>`; return; }
  if (epiV.v === 'ver') return telaEpiFunc();
  if (epiV.v === 'entregar') return telaEpiEntregar();
  const sub = [['func', '👷 Por funcionário'], ['pend', '⚠️ Pendências'], ['cat', '📦 Catálogo e CA'], ['matriz', '🧩 EPI por cargo']];
  c.innerHTML = `<div class="sub-abas">${sub.map(([k, t]) => `<button data-s="${k}" class="${epiV.v === k ? 'on' : ''}">${t}</button>`).join('')}</div><div id="epiCorpo"></div>`;
  c.querySelectorAll('.sub-abas button').forEach(b => b.onclick = () => { epiV.v = b.dataset.s; telaEpi(); });
  if (epiV.v === 'pend') epiPendencias(); else if (epiV.v === 'cat') epiCatalogo(); else if (epiV.v === 'matriz') epiMatriz(); else epiLista();
}

function epiLista() {
  const q = sem(epiV.busca).join(' ');
  const lista = ativos().filter(f => !q || sem([f.nome, f.cargo, f.matricula].join(' ')).join(' ').includes(q));
  const semCargo = ativos().filter(f => !epi.matriz.some(m => mesmoCargo(m.cargo, f.cargo)));
  $('#epiCorpo').innerHTML = `<div class="cartao"><input id="epiBusca" placeholder="🔎 Buscar funcionário ou cargo" value="${esc(epiV.busca)}"></div>
    ${semCargo.length ? `<div class="cartao epi-aviso">⚠️ Cargo sem EPIs definidos: ${semCargo.map(f => esc(f.nome) + ' (' + esc(f.cargo || 'sem cargo') + ')').join(', ')}. Ajuste em <b>🧩 EPI por cargo</b>.</div>` : ''}
    <div class="cartao tabela-rolagem"><table class="tab-cad"><thead><tr><th>Funcionário</th><th>Cargo</th><th>Última entrega</th><th>Pendências</th></tr></thead>
    <tbody>${lista.map(f => { const s = situacaoFunc(f); return `<tr data-m="${esc(f.matricula)}" style="cursor:pointer">
      <td><b>${esc(f.nome)}</b><div class="meta">Matrícula ${esc(f.matricula)}</div></td><td>${esc(f.cargo)}</td>
      <td>${s.ultima ? br(s.ultima) : '<span class="nao">—</span>'}</td>
      <td>${s.pend ? `<span class="epi-selo erro">${s.pend}</span>` : '<span class="epi-selo ok">em dia</span>'}</td></tr>`; }).join('')}</tbody></table>
    ${!lista.length ? '<p class="meta">Ninguém encontrado. O EPI usa o cadastro da aba 👷 Funcionários.</p>' : ''}</div>`;
  const b = $('#epiBusca');
  b.oninput = () => { epiV.busca = b.value; const p = b.selectionStart; epiLista(); const n = $('#epiBusca'); n.focus(); n.setSelectionRange(p, p); };
  $('#epiCorpo').querySelectorAll('tr[data-m]').forEach(tr => tr.onclick = () => { epiV = Object.assign(epiV, { v: 'ver', m: tr.dataset.m, voltar: 'func' }); telaEpi(); });
}

// ---------- funcionário ----------
function telaEpiFunc() {
  const f = epi.funcionarios.find(x => x.matricula === epiV.m);
  if (!f) { epiV.v = 'func'; return telaEpi(); }
  const s = situacaoFunc(f);
  const c = $('#conteudo');
  c.innerHTML = `<div class="cartao cad-topo">
      <button class="mini" id="eVoltar">‹ Voltar</button>
      <div style="flex:1;min-width:200px"><div style="font-size:20px;font-weight:700">${esc(f.nome)}</div>
        <div class="meta">Matrícula ${esc(f.matricula)} · ${esc(f.cargo || 'sem cargo')}${f.admissao ? ' · admissão ' + esc(f.admissao) : ''}${f.demissao ? ' · <span style="color:var(--perigo)">desligado em ' + esc(f.demissao) + '</span>' : ''}</div></div>
      <button class="btn btn-ok" id="eEntregar" style="flex:none">➕ Nova entrega</button></div>
    <div class="cartao"><div class="epi-botoes">
      <button class="mini" id="eFicha">📄 Ficha de EPI em branco (PDF)</button>
      <button class="mini" id="eAntiga">📎 Anexar ficha antiga</button>
      <button class="mini" id="eLancar">🗂️ Lançar entregas de ficha antiga</button>
      <button class="mini" id="eHist">🖨️ Histórico (PDF)</button></div>
      <div class="epi-tam">Tamanhos: <label>Botina <input id="tCal" value="${esc(f.calcado)}" maxlength="6"></label>
        <label>Luva <input id="tLuv" value="${esc(f.luva)}" maxlength="6"></label>
        <label>Roupa <input id="tRou" value="${esc(f.roupa)}" maxlength="6"></label><button class="mini" id="tSalvar">💾</button></div></div>
    <div class="titulo">EPIs do cargo</div>
    <div class="cartao tabela-rolagem">${s.itens.length ? `<table class="tab-cad"><thead><tr><th>EPI</th><th>CA</th><th>Última entrega</th><th>Situação</th></tr></thead><tbody>
      ${s.itens.map(x => `<tr><td><b>${esc(x.item.epi)}</b><div class="meta">${esc(x.item.codigo)}</div></td>
        <td>${esc(x.ult ? x.ult.ca || '—' : x.item.ca || '—')}</td><td>${x.ult ? br(x.ult.data) + ' · ' + esc(x.ult.motivo) : '<span class="nao">—</span>'}</td>
        <td>${selo(x.st)}</td></tr>`).join('')}</tbody></table>` : '<p class="meta">Nenhum EPI definido para este cargo. Ajuste em 🧩 EPI por cargo.</p>'}</div>
    <div class="titulo">Recibos, fichas e anexos</div>
    <div class="cartao">${s.recs.length ? s.recs.map(r => `<div class="epi-rec">
        <div class="tx"><b>${esc(r.recibo)}</b> · ${esc(r.tipo)} · ${br(r.data)}${r.itens ? ' · ' + r.itens + ' item(ns)' : ''}
          ${r.obs ? `<div class="meta">${esc(r.obs)}</div>` : ''}
          <div>${r.anexo ? '<span class="epi-selo ok">assinado / anexado</span>' : r.tipo === 'Recibo de entrega' ? '<span class="epi-selo erro">falta anexar o recibo assinado</span>' : '<span class="epi-selo alerta">sem anexo</span>'}</div></div>
        <div class="epi-botoes">${r.anexo ? `<button class="mini" data-ver="${esc(r.recibo)}">👁 Ver</button>` : ''}
          <button class="mini" data-anx="${esc(r.recibo)}">📎 ${r.anexo ? 'Trocar anexo' : 'Anexar'}</button>
          ${r.tipo === 'Recibo de entrega' ? `<button class="mini" data-imp="${esc(r.recibo)}">🖨️ Recibo</button>` : ''}
          <button class="mini" data-exc="${esc(r.recibo)}">🗑</button></div></div>`).join('')
      : '<p class="meta">Nenhum recibo ou ficha ainda.</p>'}</div>`;
  $('#eVoltar').onclick = () => { epiV.v = epiV.voltar || 'func'; telaEpi(); };
  $('#eEntregar').onclick = () => { epiV.v = 'entregar'; epiV.antiga = false; telaEpi(); };
  $('#eLancar').onclick = () => { epiV.v = 'entregar'; epiV.antiga = true; telaEpi(); };
  $('#eFicha').onclick = () => pdfFicha(f).catch(e => aviso(e.message));
  $('#eHist').onclick = () => pdfHistorico(f).catch(e => aviso(e.message));
  $('#eAntiga').onclick = () => modalAnexo({ f });
  $('#tSalvar').onclick = async () => {
    try { await chamar({ action: 'epiTamanhos', matricula: f.matricula, calcado: $('#tCal').value.trim(), luva: $('#tLuv').value.trim(), roupa: $('#tRou').value.trim() });
      f.calcado = $('#tCal').value.trim(); f.luva = $('#tLuv').value.trim(); f.roupa = $('#tRou').value.trim(); cad = null; aviso('Tamanhos salvos'); }
    catch (e) { aviso(e.message); }
  };
  c.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => verAnexo(b.dataset.ver));
  c.querySelectorAll('[data-anx]').forEach(b => b.onclick = () => modalAnexo({ f, recibo: b.dataset.anx }));
  c.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => {
    const r = epi.recibos.find(x => x.recibo === b.dataset.imp);
    const itens = epi.entregas.filter(e => e.recibo === r.recibo);
    pdfRecibo(f, r.recibo, r.data, itens).catch(e => aviso(e.message));
  });
  c.querySelectorAll('[data-exc]').forEach(b => b.onclick = async () => {
    if (!confirm(`Excluir ${b.dataset.exc}? As entregas deste lançamento deixam de contar e o anexo vai para a lixeira do Drive.`)) return;
    try { await chamar({ action: 'epiExcluir', recibo: b.dataset.exc }); await carregarEpi(); aviso('Excluído'); telaEpiFunc(); } catch (e) { aviso(e.message); }
  });
}

// ---------- nova entrega / lançamento de ficha antiga ----------
function telaEpiEntregar() {
  const f = epi.funcionarios.find(x => x.matricula === epiV.m);
  const s = situacaoFunc(f), antiga = !!epiV.antiga;
  const doCargo = new Set(s.itens.map(x => x.item.codigo));
  const outros = epi.catalogo.filter(i => i.ativo && !doCargo.has(i.codigo));
  const linha = (i, marcado, motivo) => { const e = estadoCA(i); return `<tr>
    <td><input type="checkbox" data-c="${esc(i.codigo)}" ${marcado ? 'checked' : ''} style="width:auto"></td>
    <td><b>${esc(i.epi)}</b><div class="meta">${esc(i.codigo)}</div></td>
    <td><input data-ca="${esc(i.codigo)}" value="${esc(i.ca)}" inputmode="numeric" style="width:90px">${antiga ? '' : '<div>' + selo(e) + '</div>'}</td>
    <td><input data-q="${esc(i.codigo)}" type="number" min="1" value="1" style="width:70px"></td>
    <td><select data-mo="${esc(i.codigo)}">${MOTIVOS.map(m => `<option ${m === motivo ? 'selected' : ''}>${m}</option>`).join('')}</select></td></tr>`; };
  const c = $('#conteudo');
  c.innerHTML = `<div class="cartao cad-topo"><button class="mini" id="nVoltar">‹ Voltar</button>
      <div style="flex:1"><div style="font-size:20px;font-weight:700">${antiga ? '🗂️ Lançar entregas de ficha antiga' : '➕ Nova entrega de EPI'}</div>
      <div class="meta">${esc(f.nome)} · ${esc(f.cargo)}</div></div></div>
    ${antiga ? `<div class="cartao epi-aviso">Use para passar para o sistema o que está anotado nas fichas de papel. Não gera recibo novo.
      Depois, anexe a imagem da ficha em <b>📎 Anexar</b> no lançamento criado. Lance uma data por vez.</div>` : ''}
    <div class="cartao"><label class="meta">Data da entrega</label><input id="nData" type="date" value="${hojeISO()}" style="max-width:200px"></div>
    <div class="cartao tabela-rolagem"><table class="tab-cad epi-ent"><thead><tr><th></th><th>EPI</th><th>CA</th><th>Qtd</th><th>Motivo</th></tr></thead><tbody>
      ${s.itens.map(x => linha(x.item, !antiga && x.st.pend, x.ult ? 'Troca periódica' : 'Entrega inicial')).join('')}
      ${outros.length ? `<tr><td colspan="5" class="meta" style="padding-top:14px"><b>Outros EPIs do catálogo</b></td></tr>${outros.map(i => linha(i, false, 'Entrega inicial')).join('')}` : ''}
    </tbody></table></div>
    <div class="cartao"><label class="meta">Observação (opcional)</label><input id="nObs" maxlength="300"></div>
    <div class="acoes"><button class="btn btn-claro" id="nCancelar">Cancelar</button>
      <button class="btn btn-ok" id="nOk">${antiga ? '💾 Lançar' : '💾 Registrar e gerar recibo'}</button></div>`;
  $('#nVoltar').onclick = $('#nCancelar').onclick = () => { epiV.v = 'ver'; telaEpi(); };
  $('#nOk').onclick = async () => {
    const itens = [...c.querySelectorAll('[data-c]:checked')].map(x => { const k = x.dataset.c; return {
      codigo: k, ca: c.querySelector(`[data-ca="${k}"]`).value.trim(), qtd: Number(c.querySelector(`[data-q="${k}"]`).value) || 1,
      motivo: c.querySelector(`[data-mo="${k}"]`).value }; });
    const data = $('#nData').value;
    if (!itens.length) return aviso('Marque pelo menos um EPI');
    if (!data) return aviso('Informe a data');
    if (!antiga) {
      const prob = itens.map(i => ({ i, e: estadoCA(Object.assign({}, catDe(i.codigo), { ca: i.ca })) })).filter(x => x.e.cls === 'erro' || !x.i.ca);
      if (prob.length && !confirm('Atenção, CA com problema:\n' + prob.map(x => '• ' + catDe(x.i.codigo).epi + ': ' + (x.i.ca ? x.e.txt : 'sem CA')).join('\n') + '\n\nA NR-6 exige CA válido. Registrar assim mesmo?')) return;
    }
    const btn = $('#nOk'); btn.disabled = true; btn.textContent = 'Gravando…';
    try {
      const r = await chamar({ action: 'epiEntregar', matricula: f.matricula, data, itens, obs: $('#nObs').value.trim(), antiga });
      await carregarEpi();
      if (!antiga) await pdfRecibo(f, r.recibo, data, r.itens);
      aviso(antiga ? 'Lançado: ' + r.recibo : 'Recibo ' + r.recibo + ' gerado. Imprima, colha a assinatura e anexe.');
      epiV.v = 'ver'; telaEpi();
    } catch (e) { aviso(e.message); btn.disabled = false; btn.textContent = antiga ? '💾 Lançar' : '💾 Registrar e gerar recibo'; }
  };
}

// ---------- anexos ----------
async function arquivoParaEnvio(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 15e6) throw new Error('PDF muito grande (máx. 15 MB)');
    return { mime: file.type, base64: App.base64DeBytes(new Uint8Array(await file.arrayBuffer())) };
  }
  if (!/^image\//.test(file.type)) throw new Error('Envie PDF ou foto');
  // reduz a foto para no máximo 2200 px (continua legível e o envio fica rápido)
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('Não consegui abrir a imagem')); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 2200 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.85));
  return { mime: 'image/jpeg', base64: App.base64DeBytes(new Uint8Array(await blob.arrayBuffer())) };
}

function modalAnexo({ f, recibo }) {
  const antiga = !recibo;
  $('#modal').innerHTML = `<div class="fundo-modal" id="fm"><div class="modal">
    <div class="titulo" style="margin-top:0">📎 ${antiga ? 'Anexar ficha antiga' : 'Anexar ' + esc(recibo)}</div>
    <p class="meta">${esc(f.nome)}. ${antiga ? 'Imagem ou PDF de ficha de EPI preenchida antes do sistema.' : 'Foto ou PDF do documento assinado pelo funcionário.'}</p>
    ${antiga ? `<label class="meta">Data da ficha (ou da última anotação)</label><input id="aData" type="date" value="${hojeISO()}">
      <label class="meta">Tipo</label><select id="aTipo"><option>Ficha anterior</option><option>Recibo anterior</option><option>Outro documento de EPI</option></select>
      <label class="meta">Observação</label><input id="aObs" maxlength="300" placeholder="ex.: ficha de 2024 a 2025">` : ''}
    <label class="arquivo" style="margin-top:12px">📷 Tirar foto ou escolher arquivo<input type="file" id="aArq" accept="image/*,application/pdf" capture="environment" hidden></label>
    <div class="meta" id="aNome"></div>
    <div class="acoes"><button class="btn btn-claro" id="aX">Cancelar</button><button class="btn btn-ok" id="aOk">Enviar</button></div></div></div>`;
  let file = null;
  $('#aArq').onchange = e => { file = e.target.files[0]; $('#aNome').textContent = file ? file.name : ''; };
  $('#aX').onclick = fechar; $('#fm').onclick = e => { if (e.target.id === 'fm') fechar(); };
  $('#aOk').onclick = async () => {
    if (!file) return aviso('Escolha o arquivo');
    const btn = $('#aOk'); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const a = await arquivoParaEnvio(file);
      const body = Object.assign({ action: 'epiAnexar', matricula: f.matricula }, a);
      if (recibo) body.recibo = recibo; else Object.assign(body, { data: $('#aData').value, tipo: $('#aTipo').value, obs: $('#aObs').value.trim() });
      await chamar(body, 120000);
      await carregarEpi(); fechar(); aviso('Anexo enviado'); telaEpiFunc();
    } catch (e) { aviso(e.message); btn.disabled = false; btn.textContent = 'Enviar'; }
  };
}

async function verAnexo(recibo) {
  aviso('Abrindo…');
  try {
    const r = await chamar({ action: 'epiAnexo', recibo });
    const u8 = App.bytesDeBase64(r.base64);
    const url = URL.createObjectURL(new Blob([u8], { type: r.mime }));
    $('#modal').innerHTML = `<div class="fundo-modal" id="fm"><div class="modal largo">
      <div class="titulo" style="margin-top:0">${esc(recibo)}</div>
      ${/^image\//.test(r.mime) ? `<img src="${url}" style="width:100%;border-radius:10px">` : `<iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe>`}
      <div class="acoes"><button class="btn btn-claro" id="vX">Fechar</button><button class="btn btn-ok" id="vB">⬇ Baixar</button></div></div></div>`;
    $('#vX').onclick = fechar; $('#fm').onclick = e => { if (e.target.id === 'fm') fechar(); };
    $('#vB').onclick = () => App.baixar(u8, r.nome, r.mime);
  } catch (e) { aviso(e.message); }
}

// ---------- pendências ----------
function epiPendencias() {
  const linhas = [];
  ativos().forEach(f => {
    const s = situacaoFunc(f);
    s.itens.filter(x => x.st.pend).forEach(x => linhas.push({ f, o: x.item.epi, st: x.st }));
    s.semAssin.forEach(r => linhas.push({ f, o: r.recibo + ' (' + br(r.data) + ')', st: { cls: 'erro', txt: 'Recibo sem assinatura anexada' } }));
  });
  const cats = epi.catalogo.filter(i => i.ativo && epi.matriz.some(m => m.codigos.includes(i.codigo))).map(i => ({ i, e: estadoCA(i) })).filter(x => x.e.cls !== 'ok');
  $('#epiCorpo').innerHTML = `<div class="cartao"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1" class="meta">${linhas.length} pendência(s) de funcionários · ${cats.length} EPI(s) com CA a conferir</div>
      <button class="mini" id="pCA">🔄 Conferir CAs agora</button></div></div>
    ${cats.length ? `<div class="titulo">CA dos EPIs</div><div class="cartao tabela-rolagem"><table class="tab-cad"><tbody>
      ${cats.map(x => `<tr><td><b>${esc(x.i.epi)}</b><div class="meta">${esc(x.i.codigo)}</div></td><td>${esc(x.i.ca || '—')}</td><td>${selo(x.e)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="titulo">Funcionários</div>
    <div class="cartao tabela-rolagem">${linhas.length ? `<table class="tab-cad"><tbody>${linhas.map(l => `<tr data-m="${esc(l.f.matricula)}" style="cursor:pointer">
      <td><b>${esc(l.f.nome)}</b><div class="meta">${esc(l.f.cargo)}</div></td><td>${esc(l.o)}</td><td>${selo(l.st)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="meta">Tudo em dia. 👍</p>'}</div>`;
  $('#epiCorpo').querySelectorAll('tr[data-m]').forEach(tr => tr.onclick = () => { epiV = Object.assign(epiV, { v: 'ver', m: tr.dataset.m, voltar: 'pend' }); telaEpi(); });
  $('#pCA').onclick = async () => {
    const b = $('#pCA'); b.disabled = true; b.textContent = 'Conferindo…';
    try { const r = await chamar({ action: 'epiConferirCA' }, 120000); await carregarEpi(); aviso(r.conferidos + ' CA(s) conferidos'); telaEpi(); }
    catch (e) { aviso(e.message); b.disabled = false; b.textContent = '🔄 Conferir CAs agora'; }
  };
}

// ---------- catálogo ----------
function epiCatalogo() {
  const itens = epi.catalogo.map(i => Object.assign({}, i));
  const desenha = () => {
    $('#epiCorpo').innerHTML = `<div class="cartao epi-aviso">Os códigos são os mesmos do <b>Pede Aí</b> (categoria EPI e Uniformes).
      Digite o CA e toque em <b>🔎</b> para buscar a validade na base do Ministério do Trabalho (atualizada toda semana).
      Troca (dias) = prazo de troca; 0 = sem controle (descartáveis).</div>
      <div class="cartao tabela-rolagem"><table class="tab-cad epi-cat"><thead><tr><th>Código</th><th>EPI</th><th>CA</th><th>Situação</th><th>Troca (dias)</th><th>Observação</th><th>Ativo</th></tr></thead><tbody>
      ${itens.map((i, n) => `<tr>
        <td><input data-n="${n}" data-k="codigo" value="${esc(i.codigo)}" style="width:90px"></td>
        <td><input data-n="${n}" data-k="epi" value="${esc(i.epi)}" style="min-width:220px"></td>
        <td style="white-space:nowrap"><input data-n="${n}" data-k="ca" value="${esc(i.ca)}" inputmode="numeric" style="width:80px"> <button class="mini" data-busca="${n}" title="Buscar na base do CAEPI">🔎</button></td>
        <td>${selo(estadoCA(i))}${i.equipamento ? `<div class="meta">${esc(i.equipamento)}</div>` : ''}${i.conferido ? `<div class="meta">conferido em ${br(i.conferido)}</div>` : ''}</td>
        <td><input data-n="${n}" data-k="troca" type="number" min="0" value="${i.troca}" style="width:70px"></td>
        <td><input data-n="${n}" data-k="obs" value="${esc(i.obs)}" style="min-width:180px"></td>
        <td><input type="checkbox" data-n="${n}" data-k="ativo" ${i.ativo ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}
      </tbody></table></div>
      <div class="acoes"><button class="btn btn-claro" id="cNovo">➕ Novo EPI</button><button class="btn btn-ok" id="cSalvar">💾 Salvar catálogo</button></div>`;
    const corpo = $('#epiCorpo');
    corpo.querySelectorAll('[data-k]').forEach(el => el.onchange = () => {
      const i = itens[el.dataset.n], k = el.dataset.k;
      i[k] = k === 'ativo' ? el.checked : k === 'troca' ? Number(el.value) || 0 : el.value.trim();
      if (k === 'ca') { i.validade = ''; i.situacao = ''; i.conferido = ''; i.equipamento = ''; }
    });
    corpo.querySelectorAll('[data-busca]').forEach(b => b.onclick = async () => {
      const i = itens[b.dataset.busca]; i.ca = corpo.querySelector(`[data-n="${b.dataset.busca}"][data-k="ca"]`).value.replace(/\D/g, '');
      if (!i.ca) return aviso('Digite o número do CA');
      const r = await consultaCA(i.ca);
      if (!r || !r.achou) { i.validade = ''; i.situacao = 'CA não encontrado'; i.equipamento = ''; aviso('CA ' + i.ca + ' não encontrado na base'); }
      else { Object.assign(i, { validade: r.validade, situacao: r.situacao, equipamento: [r.equipamento, r.fabricante].filter(Boolean).join(' · '), conferido: hojeISO() });
        aviso('CA ' + i.ca + ': ' + r.situacao + ', validade ' + br(r.validade)); }
      desenha();
    });
    $('#cNovo').onclick = () => { itens.push({ codigo: 'EPI-', epi: '', ca: '', validade: '', situacao: '', troca: 0, obs: '', ativo: true }); desenha(); };
    $('#cSalvar').onclick = async () => {
      try { await chamar({ action: 'epiCatalogo', itens }); await carregarEpi(); aviso('Catálogo salvo'); epiCatalogo(); } catch (e) { aviso(e.message); }
    };
  };
  desenha();
}

// ---------- matriz por cargo ----------
function epiMatriz() {
  const cats = epi.catalogo.filter(i => i.ativo);
  const mat = epi.matriz.map(m => ({ cargo: m.cargo, codigos: new Set(m.codigos), obs: m.obs }));
  ativos().forEach(f => { if (f.cargo && !mat.some(m => mesmoCargo(m.cargo, f.cargo))) mat.push({ cargo: f.cargo, codigos: new Set(), obs: '' }); });
  $('#epiCorpo').innerHTML = `<div class="cartao epi-aviso">Marque os EPIs obrigatórios de cada cargo (conforme o PGR). O nome do cargo precisa ser igual ao do cadastro do funcionário.
      ${mat[0] && mat[0].obs ? '<br>Origem: ' + esc(mat[0].obs) : ''}</div>
    <div class="cartao tabela-rolagem"><table class="tab-cad epi-mat"><thead><tr><th>EPI</th>${mat.map(m => `<th>${esc(m.cargo)}</th>`).join('')}</tr></thead><tbody>
    ${cats.map(i => `<tr><td><b>${esc(i.epi)}</b><div class="meta">${esc(i.codigo)}</div></td>${mat.map((m, n) =>
      `<td style="text-align:center"><input type="checkbox" data-m="${n}" data-c="${esc(i.codigo)}" ${m.codigos.has(i.codigo) ? 'checked' : ''} style="width:auto"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="acoes"><button class="btn btn-ok" id="mSalvar">💾 Salvar EPI por cargo</button></div>`;
  $('#epiCorpo').querySelectorAll('[data-m]').forEach(cb => cb.onchange = () => { const s = mat[cb.dataset.m].codigos; cb.checked ? s.add(cb.dataset.c) : s.delete(cb.dataset.c); });
  $('#mSalvar').onclick = async () => {
    try { await chamar({ action: 'epiMatriz', matriz: mat.map(m => ({ cargo: m.cargo, codigos: [...m.codigos], obs: m.obs })) }); await carregarEpi(); aviso('Salvo'); }
    catch (e) { aviso(e.message); }
  };
}

// ===================== PDFs (pdf-lib) =====================
async function pdfBase() {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const doc = await PDFDocument.create();
  const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await doc.embedPng(await (await fetch('../img/logo.png')).arrayBuffer()); } catch (e) {}
  const cinza = rgb(0.35, 0.35, 0.35), preto = rgb(0, 0, 0), linha = rgb(0.7, 0.7, 0.7), fundo = rgb(0.9, 0.93, 0.96);
  // texto com quebra de linha; devolve o novo y
  const quebra = (txt, fonte, tam, larg) => {
    const out = [];
    String(txt).split('\n').forEach(par => {
      let l = '';
      par.split(' ').forEach(p => { const t = l ? l + ' ' + p : p; if (fonte.widthOfTextAtSize(t, tam) > larg && l) { out.push(l); l = p; } else l = t; });
      out.push(l);
    });
    return out;
  };
  const escreve = (pg, txt, x, y, { f = F, t = 10, larg = 515, cor = preto, entre = 1.3 } = {}) => {
    quebra(txt, f, t, larg).forEach(l => { pg.drawText(l, { x, y, size: t, font: f, color: cor }); y -= t * entre; });
    return y;
  };
  const cabecalho = (pg, titulo, sub) => {
    const { height } = pg.getSize();
    let y = height - 40;
    if (logo) { const k = 34 / logo.height; pg.drawImage(logo, { x: 40, y: y - 30, width: logo.width * k, height: 34 }); }
    pg.drawText(titulo, { x: 555 - B.widthOfTextAtSize(titulo, 14), y: y - 10, size: 14, font: B });
    if (sub) pg.drawText(sub, { x: 555 - F.widthOfTextAtSize(sub, 10), y: y - 26, size: 10, font: F, color: cinza });
    y -= 46;
    pg.drawText(EMPRESA.nome + ' · CNPJ ' + EMPRESA.cnpj, { x: 40, y, size: 9, font: B });
    pg.drawText(EMPRESA.endereco, { x: 40, y: y - 12, size: 9, font: F, color: cinza });
    pg.drawLine({ start: { x: 40, y: y - 20 }, end: { x: 555, y: y - 20 }, thickness: 1, color: linha });
    return y - 36;
  };
  const caixaFunc = (pg, f, y) => {
    const campos = [['Funcionário', f.nome, 300], ['Matrícula', f.matricula, 90], ['CPF', f.cpf || '', 125],
      ['Cargo / função', f.cargo || '', 300], ['Setor', f.setor || '', 90], ['Admissão', f.admissao || '', 125]];
    let x = 40, yy = y;
    campos.forEach(([r, v, w], n) => {
      if (n === 3) { x = 40; yy -= 30; }
      pg.drawRectangle({ x, y: yy - 22, width: w, height: 28, borderColor: linha, borderWidth: 0.8 });
      pg.drawText(r, { x: x + 4, y: yy - 2, size: 7, font: F, color: cinza });
      pg.drawText(String(v).slice(0, 60), { x: x + 4, y: yy - 15, size: 10, font: B });
      x += w;
    });
    return yy - 38;
  };
  const tabela = (pg, y, cols, linhas, { alt = 18, cab = true } = {}) => {
    const tot = cols.reduce((s, c) => s + c[1], 0); let x0 = 40;
    if (cab) {
      pg.drawRectangle({ x: x0, y: y - alt + 5, width: tot, height: alt, color: fundo });
      let x = x0; cols.forEach(([t, w]) => { let tm = 8.5; while (tm > 6 && B.widthOfTextAtSize(t, tm) > w - 8) tm -= 0.5; pg.drawText(t, { x: x + 4, y: y - 8, size: tm, font: B }); x += w; });
      y -= alt;
    }
    linhas.forEach(l => {
      let x = x0;
      cols.forEach(([, w], i) => {
        pg.drawRectangle({ x, y: y - alt + 5, width: w, height: alt, borderColor: linha, borderWidth: 0.6 });
        const v = String(l[i] ?? ''); let t = 9;
        while (t > 6 && F.widthOfTextAtSize(v, t) > w - 8) t -= 0.5;
        pg.drawText(v, { x: x + 4, y: y - 8, size: t, font: F });
        x += w;
      });
      y -= alt;
    });
    return y - 6;
  };
  const assinatura = (pg, x, y, w, rotulo, nome) => {
    pg.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.8, color: preto });
    pg.drawText(rotulo, { x, y: y - 12, size: 8.5, font: B });
    if (nome) pg.drawText(nome, { x, y: y - 24, size: 8.5, font: F, color: cinza });
  };
  const rodape = (pg, txt) => pg.drawText(txt, { x: 40, y: 22, size: 7.5, font: F, color: cinza });
  return { doc, F, B, cinza, escreve, cabecalho, caixaFunc, tabela, assinatura, rodape };
}

const TERMO = n => `Declaro que recebi da empresa, gratuitamente, os Equipamentos de Proteção Individual (EPI) relacionados ${n}, novos e em perfeito estado, ` +
  `adequados ao risco da minha atividade e com Certificado de Aprovação (CA), e que fui orientado e treinado sobre o uso correto, a guarda e a conservação de cada um. ` +
  `Comprometo-me, conforme o item 6.6.1 da NR-6, a: a) usar o EPI apenas para a finalidade a que se destina e durante todo o trabalho em que for exigido; ` +
  `b) responsabilizar-me pela guarda e conservação; c) comunicar à empresa qualquer alteração que o torne impróprio para uso e pedir a troca; ` +
  `d) cumprir as orientações da empresa sobre o uso adequado. Estou ciente de que a recusa injustificada ao uso do EPI constitui ato faltoso ` +
  `(art. 158, parágrafo único, alínea "b", da CLT) e de que o extravio ou dano causado por mau uso poderá ser descontado, nos termos do art. 462, § 1º, da CLT.`;
const dataExtenso = iso => { const [a, m, d] = iso.split('-').map(Number); return `${EMPRESA.cidade}, ${d} de ${App.MESES[m - 1].toLowerCase()} de ${a}`; };

async function pdfRecibo(f, recibo, data, itens) {
  const P = await pdfBase();
  const pg = P.doc.addPage([595, 842]);
  let y = P.cabecalho(pg, 'RECIBO DE ENTREGA DE EPI', 'Nº ' + recibo);
  y = P.caixaFunc(pg, f, y);
  pg.drawText('EPIs entregues em ' + br(data), { x: 40, y, size: 11, font: P.B }); y -= 16;
  y = P.tabela(pg, y, [['EPI', 255], ['CA', 70], ['Qtd', 45], ['Motivo', 145]],
    itens.map(i => [i.epi, i.ca || '', i.qtd, i.motivo]), { alt: 20 });
  y -= 6;
  pg.drawText('Termo de recebimento e responsabilidade', { x: 40, y, size: 11, font: P.B }); y -= 15;
  y = P.escreve(pg, TERMO('acima'), 40, y, { t: 9.5, larg: 515, entre: 1.35 });
  y -= 18;
  pg.drawText(dataExtenso(data) + '.', { x: 40, y, size: 10, font: P.F });
  y -= 60;
  P.assinatura(pg, 40, y, 240, 'Assinatura do funcionário', f.nome);
  P.assinatura(pg, 315, y, 240, 'Responsável pela entrega', 'Nome legível:');
  P.rodape(pg, `Recibo ${recibo} gerado pelo Documentos O&C em ${br(hojeISO())}. Depois de assinado, fotografe e anexe no sistema (EPI > funcionário > Anexar).`);
  App.baixar(await P.doc.save(), `Recibo EPI ${recibo} - ${f.nome}.pdf`, 'application/pdf');
}

async function pdfFicha(f) {
  const P = await pdfBase();
  const pg = P.doc.addPage([595, 842]);
  let y = P.cabecalho(pg, 'FICHA DE CONTROLE DE EPI', 'NR-6, item 6.5.1, alínea "d"');
  y = P.caixaFunc(pg, f, y);
  const doCargo = epiDoCargo(f.cargo);
  pg.drawText('EPIs obrigatórios do cargo (PGR)', { x: 40, y, size: 10.5, font: P.B }); y -= 14;
  y = P.escreve(pg, doCargo.map(i => i.epi + (i.ca ? ' (CA ' + i.ca + ')' : '')).join(' · ') || '—', 40, y, { t: 8.5, larg: 515 });
  y -= 6;
  y = P.escreve(pg, TERMO('nesta ficha, a cada entrega anotada e assinada por mim'), 40, y, { t: 7.8, larg: 515, entre: 1.3, cor: P.cinza });
  y -= 6;
  pg.drawText('Preencher à caneta, a cada entrega, sem rasuras, com o número do CA.', { x: 40, y, size: 8.5, font: P.B }); y -= 14;
  const linhas = Math.max(8, Math.floor((y - 120) / 21));
  y = P.tabela(pg, y, [['Data', 60], ['EPI', 170], ['CA', 52], ['Qtd', 30], ['Motivo', 70], ['Assinatura do funcionário', 133]],
    Array.from({ length: linhas }, () => ['', '', '', '', '', '']), { alt: 21 });
  pg.drawText('Motivo: E = entrega inicial · T = troca (desgaste/prazo) · P = perda · D = dano', { x: 40, y, size: 7.5, font: P.F, color: P.cinza });
  y -= 44;
  P.assinatura(pg, 40, y, 240, 'Ciência do funcionário (data e assinatura)', f.nome);
  P.assinatura(pg, 315, y, 240, 'Responsável pela empresa', '');
  P.rodape(pg, `Ficha gerada pelo Documentos O&C em ${br(hojeISO())}. Quando a ficha estiver cheia ou para guardar, fotografe e anexe no sistema.`);
  App.baixar(await P.doc.save(), `Ficha de EPI - ${f.nome}.pdf`, 'application/pdf');
}

async function pdfHistorico(f) {
  const P = await pdfBase();
  const ents = epi.entregas.filter(e => e.matricula === f.matricula).sort((a, b) => b.data.localeCompare(a.data));
  const assin = {}; epi.recibos.forEach(r => assin[r.recibo] = r.anexo ? 'sim' : 'não');
  const porPag = 30;
  for (let i = 0; i === 0 || i < ents.length; i += porPag) {
    const pg = P.doc.addPage([595, 842]);
    let y = P.cabecalho(pg, 'HISTÓRICO DE ENTREGAS DE EPI', 'Emitido em ' + br(hojeISO()));
    y = P.caixaFunc(pg, f, y);
    P.tabela(pg, y, [['Data', 62], ['EPI', 205], ['CA', 55], ['Qtd', 32], ['Motivo', 80], ['Recibo', 81]],
      ents.slice(i, i + porPag).map(e => [br(e.data), e.epi, e.ca, e.qtd, e.motivo, e.recibo + (assin[e.recibo] === 'sim' ? ' (ass.)' : '')]), { alt: 19 });
    if (!ents.length) pg.drawText('Nenhuma entrega registrada.', { x: 40, y: y - 30, size: 10, font: P.F });
    P.rodape(pg, '(ass.) = recibo assinado anexado no sistema. Relatório gerado pelo Documentos O&C.');
  }
  App.baixar(await P.doc.save(), `Historico EPI - ${f.nome}.pdf`, 'application/pdf');
}
