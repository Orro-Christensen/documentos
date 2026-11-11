"""Baixa a base pública do CAEPI (Ministério do Trabalho) e publica um resumo por CA.

Saída: caepi/ca/<grupo>.json, com grupo = número do CA // 1000.
Cada arquivo: {"<CA>": ["validade dd/mm/aaaa", "situação", "equipamento", "fabricante", "marca"]}.
Também grava caepi/info.json com a data da atualização.
"""
import csv, gzip, zlib, io, json, os, re, sys, tarfile, zipfile, datetime, collections
import requests

URL = 'https://caepi.trabalho.gov.br/internet/consultacainternet.aspx'
AQUI = os.path.dirname(os.path.abspath(__file__))
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'}

def baixar():
    s = requests.Session()
    r = s.get(URL, headers=H, timeout=120)
    r.raise_for_status()
    campos = dict(re.findall(r'<input[^>]*name="(__[A-Z]+)"[^>]*value="([^"]*)"', r.text))
    campos.update({'__EVENTTARGET': 'ctl00$PlaceHolderConteudo$LinkButton1', '__EVENTARGUMENT': ''})
    r = s.post(URL, data=campos, headers=H, timeout=600)
    r.raise_for_status()
    print('download:', r.headers.get('Content-Type'), len(r.content), 'bytes')
    return r.content

def ler(conteudo):
    if conteudo[:2] == b'\x1f\x8b':
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)   # ignora o lixo que o site põe depois do gzip
        conteudo = d.decompress(conteudo) + d.flush()
        print('gzip ->', len(conteudo), 'bytes')
    if len(conteudo) > 262 and conteudo[257:262] == b'ustar':
        t = tarfile.open(fileobj=io.BytesIO(conteudo))
        m = [x for x in t.getmembers() if x.isfile()][0]
        print('arquivo no tar:', m.name)
        conteudo = t.extractfile(m).read()
    if conteudo[:2] == b'PK':
        z = zipfile.ZipFile(io.BytesIO(conteudo))
        nome = z.namelist()[0]
        print('arquivo no zip:', nome)
        conteudo = z.read(nome)
    try:
        texto = conteudo.decode('utf-8')
    except UnicodeDecodeError:
        texto = conteudo.decode('cp1252', errors='replace')
    primeira = texto.split('\n', 1)[0]
    sep = max([';', '|', '\t', ','], key=primeira.count)
    print('separador:', repr(sep), '| cabeçalho:', primeira[:400])
    return list(csv.reader(io.StringIO(texto, newline=''), delimiter=sep))

def coluna(cab, *nomes):
    n = [c.strip().upper() for c in cab]
    for alvo in nomes:
        for i, c in enumerate(n):
            if alvo in c:
                return i
    return None

def main():
    linhas = ler(baixar())
    cab, dados = linhas[0], linhas[1:]
    iCA = coluna(cab, 'NR_REGISTRO_CA', 'REGISTRO_CA', 'NUMERO CA', 'NÚMERO CA', 'CA')
    iVal = coluna(cab, 'DATA_VALIDADE', 'VALIDADE')
    iSit = coluna(cab, 'SITUACAO', 'SITUAÇÃO')
    iEq = coluna(cab, 'EQUIPAMENTO', 'NOME_EQUIPAMENTO')
    iFab = coluna(cab, 'RAZAO SOCIAL', 'RAZAO_SOCIAL', 'RAZÃO SOCIAL', 'FABRICANTE')
    iMarca = coluna(cab, 'MARCA')
    print('colunas:', iCA, iVal, iSit, iEq, iFab)
    if iCA is None or iVal is None:
        sys.exit('Não encontrei as colunas de CA e validade.')
    grupos = collections.defaultdict(dict)
    for l in dados:
        if len(l) <= max(i for i in (iCA, iVal) if i is not None):
            continue
        ca = re.sub(r'\D', '', l[iCA])
        if not ca:
            continue
        val = l[iVal].strip()[:10]
        reg = [val, l[iSit].strip() if iSit is not None else '',
               (l[iEq].strip() if iEq is not None else '')[:80],
               (l[iFab].strip() if iFab is not None else '')[:60],
               (l[iMarca].strip() if iMarca is not None else '')[:40]]
        g = grupos[str(int(ca) // 1000)]
        ant = g.get(str(int(ca)))
        if ant is None or data_(val) >= data_(ant[0]):
            g[str(int(ca))] = reg
    pasta = os.path.join(AQUI, 'ca')
    os.makedirs(pasta, exist_ok=True)
    total = 0
    for k, v in grupos.items():
        total += len(v)
        with open(os.path.join(pasta, k + '.json'), 'w', encoding='utf-8') as f:
            json.dump(v, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    with open(os.path.join(AQUI, 'info.json'), 'w', encoding='utf-8') as f:
        json.dump({'atualizado': datetime.date.today().isoformat(), 'cas': total, 'cabecalho': cab}, f, ensure_ascii=False)
    print('CAs:', total, 'grupos:', len(grupos))

def data_(s):
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', s or '')
    if m:
        return m.group(3) + m.group(2) + m.group(1)
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s or '')
    return ''.join(m.groups()) if m else ''

if __name__ == '__main__':
    main()
