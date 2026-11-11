// Leitura da "Ficha de Registro de Empregado" (relatório da contabilidade, várias páginas por pessoa).
// Usado só na administração (no navegador). Uma pessoa começa na página que tem "Dados Principais".
(function () {
  const itens = tc => tc.items.filter(x => x.str.trim()).map(x => ({ s: x.str.trim(), x: x.transform[4], y: x.transform[5], w: x.width || 0 }));
  const so = (it, re) => it.find(i => re.test(i.s));

  // Valor logo abaixo de um rótulo: mesma coluna (até o próximo rótulo da linha), 4 a 16 pontos abaixo.
  function abaixo(it, rot, rotulosLinha, dyMax = 16) {
    const prox = rotulosLinha.filter(r => r.x > rot.x + 2).sort((a, b) => a.x - b.x)[0];
    const xFim = prox ? prox.x - 2 : 9999;
    return it.filter(i => i !== rot && i.y < rot.y - 3 && i.y >= rot.y - dyMax && i.x >= rot.x - 8 && i.x < xFim && !rotulosLinha.includes(i))
      .sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ').trim();
  }
  // Rótulos de uma "faixa" de formulário (mesma altura)
  const linhaDe = (it, rot, nomes) => it.filter(i => Math.abs(i.y - rot.y) <= 3 && nomes.some(n => n === i.s));

  function campo(it, nome, todos, dyMax) {
    const rot = it.find(i => i.s === nome);
    if (!rot) return '';
    return abaixo(it, rot, linhaDe(it, rot, todos), dyMax);
  }

  // Página principal
  function principal(it) {
    const R = {};
    const ROT = ['Código Nome Empregado', 'Sexo', 'C.T.P.S.', 'Série', 'UF', 'Data', 'PIS Cadastro', 'Data Cadastro', 'Cód.Banco', 'Agência',
      'Data Admissão', 'Rais Caged', 'Data Opção', 'Matrícula', 'Pai', 'Mãe', 'CPF / CIC', 'Ced.Identidade', 'Data Emissão', 'Emissor', 'Raça',
      'Deficiência', 'C.N.Habilitação', 'Categ.Habil.', 'Data de Validade', 'C.Reservista', 'Categ.', 'Endereço:Av,Rua,Número,Complemento.',
      'Bairro / Distrito', 'Cidade', 'CEP', 'E-Mail', 'Fone', 'Celular', 'Local Nascimento', 'Data Nascimento', 'Tit.Eleitor', 'Zona', 'Seção',
      'Estado Civil', 'Nome Cônjuge', 'Código do Sindicato', 'Tipo de Contrato', 'Data Término', 'Data Demissão', 'Experiência', 'Prorrogação', 'Nº de dias'];
    const c = (n, d) => campo(it, n, ROT, d);
    // código + nome (mesmo rótulo)
    const rn = it.find(i => i.s === 'Código Nome Empregado');
    if (rn) {
      const v = it.filter(i => i.y < rn.y - 3 && i.y >= rn.y - 16 && i.x >= rn.x - 8 && i.x < 410).sort((a, b) => a.x - b.x);
      R.codigo = (v.find(i => /^\d+$/.test(i.s)) || {}).s || '';
      R.nome = v.filter(i => !/^\d+$/.test(i.s)).map(i => i.s).join(' ');
    }
    R.sexo = c('Sexo');
    // CTPS: número / série / UF / data (mesma faixa)
    const rc = it.find(i => i.s === 'C.T.P.S.');
    if (rc) {
      const v = it.filter(i => i.y < rc.y - 3 && i.y >= rc.y - 16 && i.x < 410).sort((a, b) => a.x - b.x);
      R.ctps = (v[0] || {}).s || ''; R.ctps_serie = (v[1] || {}).s || '';
      R.ctps_uf = (v.find(i => /^[A-Z]{2}$/.test(i.s)) || {}).s || '';
      R.ctps_data = (v.find(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s)) || {}).s || '';
    }
    R.pis = c('PIS Cadastro'); R.banco = c('Cód.Banco'); R.agencia = c('Agência');
    R.admissao = c('Data Admissão'); R.matricula_esocial = c('Matrícula');
    R.pai = c('Pai', 14); R.mae = c('Mãe', 14);
    R.cpf = c('CPF / CIC'); R.rg = c('Ced.Identidade'); R.rg_emissao = c('Data Emissão'); R.rg_emissor = c('Emissor');
    const rcpf = it.find(i => i.s === 'CPF / CIC');
    if (rcpf) { const uf = it.find(i => i.s === 'UF' && Math.abs(i.y - rcpf.y) <= 3); if (uf) R.rg_uf = abaixo(it, uf, linhaDe(it, uf, ROT)); }
    R.raca = c('Raça'); R.deficiencia = c('Deficiência');
    R.cnh = c('C.N.Habilitação'); R.cnh_categoria = c('Categ.Habil.'); R.cnh_validade = c('Data de Validade'); R.reservista = c('C.Reservista');
    R.endereco = c('Endereço:Av,Rua,Número,Complemento.'); R.bairro = c('Bairro / Distrito');
    const rcid = it.filter(i => i.s === 'Cidade').sort((a, b) => a.y - b.y)[0];       // a de baixo (endereço do empregado)
    if (rcid) R.cidade = abaixo(it, rcid, linhaDe(it, rcid, ROT));
    const ruf = it.filter(i => i.s === 'UF' && rcid && Math.abs(i.y - rcid.y) <= 3)[0];
    if (ruf) R.uf = abaixo(it, ruf, linhaDe(it, ruf, ROT));
    const rcep = it.filter(i => i.s === 'CEP').sort((a, b) => a.y - b.y)[0];
    if (rcep) R.cep = (it.filter(i => /^\d{5}-\d{3}$/.test(i.s) && i.y < rcep.y && i.y > rcep.y - 16).sort((a, b) => a.x - b.x)[0] || {}).s || '';
    R.email = c('E-Mail'); R.fone = c('Fone'); R.celular = c('Celular');
    R.nasc_local = c('Local Nascimento');
    const rln = it.find(i => i.s === 'Local Nascimento');
    if (rln) { const uf = it.find(i => i.s === 'UF' && Math.abs(i.y - rln.y) <= 3); if (uf) R.nasc_uf = abaixo(it, uf, linhaDe(it, uf, ROT)); }
    R.nascimento = c('Data Nascimento'); R.titulo = c('Tit.Eleitor'); R.titulo_zona = c('Zona'); R.titulo_secao = c('Seção');
    R.estado_civil = c('Estado Civil'); R.conjuge = c('Nome Cônjuge');
    // sindicato: código + nome na mesma linha
    const rs = it.find(i => i.s === 'Código do Sindicato');
    if (rs) R.sindicato = it.filter(i => i.y < rs.y - 3 && i.y >= rs.y - 16 && i.x < 260).sort((a, b) => a.x - b.x).map(i => i.s).join(' ');
    R.tipo_contrato = c('Tipo de Contrato'); R.experiencia_fim = c('Data Término'); R.demissao = c('Data Demissão');
    Object.keys(R).forEach(k => { R[k] = String(R[k] || '').replace(/\s+/g, ' ').trim(); if (R[k] === '/ /') R[k] = ''; });
    // campos de data: só vale se for data
    ['ctps_data', 'admissao', 'rg_emissao', 'cnh_validade', 'nascimento', 'experiencia_fim', 'demissao'].forEach(k => {
      const m = R[k].match(/\d{2}\/\d{2}\/\d{4}/); R[k] = m ? m[0] : '';
    });
    R.nasc_local = R.nasc_local.replace(/^\d{5,}\s*/, '');
    return R;
  }

  // Páginas seguintes: saúde, cargo, salários
  function complementos(it, R) {
    const t = s => it.find(i => i.s === s);
    const saude = (rot, prox) => {
      const a = t(rot); if (!a) return;
      const b = prox ? t(prox) : null;
      const v = it.filter(i => i.y < a.y - 2 && (!b || i.y > b.y + 2) && i.y > a.y - 60 && i !== a).sort((x, y) => y.y - x.y || x.x - y.x).map(i => i.s).join(' ').trim();
      return v;
    };
    if (t('Tipo Sanguíneo') && !R.tipo_sanguineo) {
      R.tipo_sanguineo = saude('Tipo Sanguíneo', 'Alergias') || '';
      R.alergias = saude('Alergias', 'Doenças') || '';
      R.doencas = saude('Doenças', 'Observações') || '';
    }
    const rc = t('Cargo/Função');
    if (rc && !R.cargo) {
      // linha de valores: a primeira abaixo do cabeçalho que começa com data (mês/ano do cargo)
      const datas = it.filter(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s) && i.y < rc.y - 4 && i.y > rc.y - 70 && i.x < 80).sort((a, b) => b.y - a.y);
      const d = datas[0];
      if (d) {
        const l = it.filter(i => Math.abs(i.y - d.y) <= 2);
        const cbo = t('CBO');
        R.cargo_desde = d.s;
        R.cargo = l.filter(i => i.x > 125 && (!cbo || i.x < cbo.x - 10) && !/^\d+$/.test(i.s)).map(i => i.s).join(' ');
        R.cbo = cbo ? (l.find(i => i.x >= cbo.x - 12 && /^\d{4}-\d{2}$/.test(i.s)) || {}).s || '' : '';
        const prox = it.filter(i => i.y < d.y - 4 && i.y > d.y - 18 && !/^\d+$/.test(i.s)).sort((a, b) => b.y - a.y || a.x - b.x)[0];
        R.local = prox ? prox.s : '';
      }
    }
    // Férias: período aquisitivo e período de gozo
    it.filter(i => i.s === 'PERÍODO AQUISITIVO').forEach(h => {
      const aq = it.filter(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s) && i.y < h.y - 16 && i.y > h.y - 30 && i.x < 140).sort((a, b) => a.x - b.x);
      if (aq.length < 2) return;
      const goz = it.filter(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s) && i.y < h.y - 66 && i.y > h.y - 82 && i.x > 460).sort((a, b) => a.x - b.x);
      const dias = it.find(i => /^\d+,\d$/.test(i.s) && i.y < h.y - 66 && i.y > h.y - 82 && i.x > 395 && i.x < 440);
      (R._ferias = R._ferias || []).push({ ini: aq[0].s, fim: aq[1].s, gozo: goz.length >= 2 ? goz[0].s + ' a ' + goz[1].s + (dias ? ' (' + dias.s.replace(',0', '') + ' dias)' : '') : '' });
    });
    // Salários: pega todas as linhas "dd/mm/aaaa  motivo  tipo  valor"; a mais recente fica como salário atual
    const rsal = it.filter(i => i.s === 'Sal. Contratual');
    rsal.forEach(h => {
      it.filter(i => /^\d{1,3}(\.\d{3})*,\d{2}$/.test(i.s) && i.y < h.y - 3 && Math.abs(i.x - h.x) < 60).forEach(v => {
        const mesma = it.filter(i => Math.abs(i.y - v.y) <= 2);
        const data = (mesma.find(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s)) || {}).s;
        const motivo = (mesma.find(i => /^\d+-/.test(i.s) && !/Mensal|Hora/i.test(i.s)) || {}).s || '';
        if (data) (R._salarios = R._salarios || []).push({ data, motivo: motivo.replace(/^\d+-/, ''), valor: v.s });
      });
    });
  }

  const iso = d => d.split('/').reverse().join('-');
  async function lerFichas(bytes) {
    const doc = await App.pdfjs().getDocument({ data: bytes.slice() }).promise;
    const pessoas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const it = itens(await (await doc.getPage(n)).getTextContent());
      if (so(it, /^Dados Principais$/)) pessoas.push(Object.assign({ paginas: [n] }, principal(it)));
      else if (pessoas.length) pessoas[pessoas.length - 1].paginas.push(n);
      if (pessoas.length) complementos(it, pessoas[pessoas.length - 1]);
    }
    pessoas.forEach(p => {
      const s = (p._salarios || []).sort((a, b) => iso(b.data).localeCompare(iso(a.data)));
      if (s.length) { p.salario = s[0].valor; p.salario_desde = s[0].data; p.salario_motivo = s[0].motivo; }
      p.historico_salarios = s.map(x => `${x.data} ${x.motivo} R$ ${x.valor}`).join(' | ');
      const f = (p._ferias || []).sort((a, b) => iso(b.ini).localeCompare(iso(a.ini)));
      p.ferias = f.map(x => `Aquisitivo ${x.ini} a ${x.fim}: ${x.gozo ? 'gozo ' + x.gozo : 'a gozar'}`).join(' | ');
      delete p._salarios; delete p._ferias;
    });
    return { paginas: doc.numPages, pessoas };
  }

  window.FICHA = { lerFichas };
})();
