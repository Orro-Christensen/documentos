// Funções compartilhadas entre o app dos funcionários (index.html) e a administração (admin/).
(function () {
  const RAIZ = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;

  async function comTempo(p, ms) {
    let t; const limite = new Promise((_, rej) => t = setTimeout(() => rej(new Error('Sem resposta do servidor. Confira a internet.')), ms));
    try { return await Promise.race([p, limite]); } finally { clearTimeout(t); }
  }

  // Tudo vai por POST (senha e PIN nunca aparecem no endereço).
  // Sem cabeçalho Content-Type: o navegador envia text/plain e o Apps Script aceita sem bloqueio de CORS.
  async function post(body, ms) {
    if (!window.API_URL) throw new Error('App ainda não configurado (falta a URL do Apps Script no config.js).');
    let r;
    try { r = await comTempo(fetch(window.API_URL, { method: 'POST', body: JSON.stringify(body) }), ms || 30000); }
    catch (e) { throw new Error(e.message === 'Failed to fetch' ? 'Sem conexão com o servidor. Confira a internet.' : e.message); }
    const j = await r.json();
    if (j.erro) { const e = new Error(j.erro); e.sessao = !!j.sessao; throw e; }
    return j;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  function competencia(c) {                 // '2026-10' -> 'Outubro/2026'
    const m = String(c || '').match(/^(\d{4})-(\d{2})$/);
    return m ? MESES[+m[2] - 1] + '/' + m[1] : String(c || '');
  }
  function dataBR(iso) {
    const d = new Date(iso); if (!iso || isNaN(d)) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function base64DeBytes(u8) {
    let s = ''; const passo = 0x8000;
    for (let i = 0; i < u8.length; i += passo) s += String.fromCharCode.apply(null, u8.subarray(i, i + passo));
    return btoa(s);
  }
  function bytesDeBase64(b64) {
    const s = atob(b64), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  // ---------- PDF (pdf.js) ----------
  function pdfjs() {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('Leitor de PDF não carregou. Recarregue a página.');
    lib.GlobalWorkerOptions.workerSrc = RAIZ + 'lib/pdf.worker.min.js';
    return lib;
  }
  // Desenha todas as páginas do PDF dentro do elemento, na largura dele.
  async function desenharPdf(u8, alvo) {
    const doc = await pdfjs().getDocument({ data: u8.slice() }).promise;
    alvo.innerHTML = '';
    const largura = Math.max(280, alvo.clientWidth || 340), dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      const base = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: (largura / base.width) * dpr });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height; cv.style.width = '100%';
      alvo.appendChild(cv);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
  }

  function baixar(u8, nome) {
    const url = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  function aviso(msg, erro) {
    const d = document.createElement('div'); d.className = 'aviso' + (erro ? ' erro' : ''); d.textContent = msg;
    document.body.appendChild(d); setTimeout(() => d.remove(), erro ? 5000 : 2500);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(RAIZ + 'sw.js').catch(() => {});

  window.App = { RAIZ, post, esc, competencia, dataBR, base64DeBytes, bytesDeBase64, pdfjs, desenharPdf, baixar, aviso, MESES };
})();
