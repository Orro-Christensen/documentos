// Leitura do "Comprovante de Rendimentos Pagos e de IRRF" (modelo da Receita, gerado pela contabilidade).
// Usado na administração (no navegador). Agrupa as páginas por pessoa: o comprovante oficial e,
// em seguida, a página "Complemento do Informe de Rendimentos" (que traz a matrícula), quando existir.
(function () {
  const DINHEIRO = /^\d{1,3}(\.\d{3})*,\d{2}$/;
  const QUADROS = [
    { n: 3, re: /^3\.\s*Rendimentos Tribut/i, titulo: 'Rendimentos tributáveis, deduções e IRRF' },
    { n: 4, re: /^4\.\s*Rendimentos Isentos/i, titulo: 'Rendimentos isentos e não tributáveis' },
    { n: 5, re: /^5\.\s*Rendimentos Sujeitos/i, titulo: 'Rendimentos sujeitos à tributação exclusiva' },
    { n: 6, re: /^6\.\s*Rendimentos Recebidos Acum/i, titulo: 'Rendimentos recebidos acumuladamente' },
    { n: 7, re: /^7\.\s*Informa[çc][õo]es Complementares/i, titulo: 'Informações complementares' },
    { n: 8, re: /^8\.\s*Respons[áa]vel/i, titulo: '' }
  ];

  function itens(tc) {
    return tc.items.filter(x => x.str.trim()).map(x => ({ s: x.str.trim(), x: x.transform[4], y: x.transform[5] }));
  }
  const texto = it => it.slice().sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join('\n');

  // Lê uma página do comprovante oficial
  function lerComprovante(it) {
    const t = texto(it);
    const r = { ano: (t.match(/Ano-Calend[áa]rio de\s*\n?\s*(\d{4})/) || [])[1] || '' };
    const fonte = it.find(i => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(i.s));
    if (fonte) { r.cnpj = fonte.s; const nm = it.find(i => Math.abs(i.y - fonte.y) < 3 && i.x > fonte.x + 20); r.fonte = nm ? nm.s : ''; }
    const cab = it.find(i => i.s === 'Nome Completo' && i.x > 200 && it.some(j => /^CPF$/.test(j.s) && Math.abs(j.y - i.y) < 3));
    if (cab) {
      const nome = it.filter(i => i.y < cab.y - 3 && i.y > cab.y - 15 && i.x >= cab.x - 5).sort((a, b) => b.y - a.y)[0];
      r.nome = nome ? nome.s : '';
    }
    // Quadros pela altura (y) dos títulos
    const tit = QUADROS.map(q => { const i = it.find(k => q.re.test(k.s)); return i ? Object.assign({ y: i.y }, q) : null; }).filter(Boolean)
      .sort((a, b) => b.y - a.y);
    const quadroDe = y => { let q = null; tit.forEach(t => { if (y <= t.y + 1) q = t; }); return q; };
    const rotulos = it.filter(i => i.x < 60 && /^\d+(\.\d+)?\.?\s/.test(i.s) && !QUADROS.some(q => q.re.test(i.s)));
    r.linhas = [];
    it.filter(i => DINHEIRO.test(i.s) && i.x > 400).forEach(v => {
      const rot = rotulos.filter(l => Math.abs(l.y - v.y) <= 3)[0];
      const q = quadroDe(v.y);
      if (!rot || !q || q.n > 6) return;
      r.linhas.push({ quadro: q.n, item: rot.s.match(/^(\d+(\.\d+)?)/)[1], descricao: rot.s.replace(/^\d+(\.\d+)?\.?\s*/, ''), valor: v.s });
    });
    // Quadro 7: texto livre
    const q7 = tit.find(t => t.n === 7), q8 = tit.find(t => t.n === 8);
    if (q7) r.complementares = it.filter(i => i.y < q7.y - 2 && (!q8 || i.y > q8.y + 2)).sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ').trim();
    return r;
  }

  // Lê o PDF inteiro e devolve uma entrada por pessoa
  async function lerInforme(bytes) {
    const doc = await App.pdfjs().getDocument({ data: bytes.slice() }).promise;
    const pessoas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const it = itens(await (await doc.getPage(n)).getTextContent());
      const t = texto(it);
      if (/Comprovante de Rendimentos Pagos/i.test(t) && /Pessoa F[íi]sica Benefici[áa]ria/i.test(t)) {
        pessoas.push(Object.assign({ paginas: [n], matricula: '' }, lerComprovante(it)));
      } else if (/Complemento do Informe de Rendimentos/i.test(t) && pessoas.length) {
        const p = pessoas[pessoas.length - 1];
        p.paginas.push(n);
        // linha "0067 ALEXANDRE SOARES DA COSTA" (a do nome da pessoa, não o código da empresa)
        const primeiro = (p.nome || '').split(' ')[0];
        const m = [...t.matchAll(/(?:^|\n)\s*(\d{3,6})\s+([A-ZÀ-Ý][A-ZÀ-Ý' .-]{3,})/g)].find(x => primeiro && x[2].trim().startsWith(primeiro));
        if (m && !p.matricula) p.matricula = m[1];
      } else if (pessoas.length) {
        pessoas[pessoas.length - 1].paginas.push(n);       // página extra da mesma pessoa
      }
    }
    return { paginas: doc.numPages, pessoas };
  }

  window.IRPF = { lerInforme, QUADROS };
})();
