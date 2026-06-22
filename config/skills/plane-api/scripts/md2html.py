import re, html

LINK = re.compile(r'\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)')

def inline(s):
    s = html.escape(s, quote=False)
    # links [text](url) -> <a>
    def lk(m):
        text=m.group(1).strip() or m.group(2); url=m.group(2)
        return f'<a href="{html.escape(url,quote=True)}">{text}</a>'
    s = LINK.sub(lk, s)
    # bold **x**
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    # inline code `x`
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    # italic _x_  (avoid urls)
    s = re.sub(r'(?<!\w)_([^_]+)_(?!\w)', r'<em>\1</em>', s)
    # leftover escaped punctuation \-  \.  \*  etc.
    s = re.sub(r'\\([-.*_#\[\]()`+!])', r'\1', s)
    return s

def md2html(text):
    if not text or not text.strip(): return ""
    text = html.unescape(text).replace('\xa0',' ').replace('\r','')
    lines = text.split('\n')
    out=[]; i=0; n=len(lines)
    para=[]
    def flush_para():
        if para:
            out.append('<p>'+'<br>'.join(inline(x) for x in para)+'</p>')
            para.clear()
    while i<n:
        ln=lines[i]
        st=ln.strip()
        if not st:
            flush_para(); i+=1; continue
        h=re.match(r'^(#{1,6})\s+(.*)$', st)
        if h:
            flush_para(); lvl=min(len(h.group(1)),4)
            out.append(f'<h{lvl}>{inline(h.group(2))}</h{lvl}>'); i+=1; continue
        if re.match(r'^[-*+]\s+', st):
            flush_para(); items=[]
            while i<n and re.match(r'^[-*+]\s+', lines[i].strip()):
                items.append(inline(re.sub(r'^[-*+]\s+','',lines[i].strip()))); i+=1
            out.append('<ul>'+''.join(f'<li>{x}</li>' for x in items)+'</ul>'); continue
        if re.match(r'^\d+[.)]\s+', st):
            flush_para(); items=[]
            while i<n and re.match(r'^\d+[.)]\s+', lines[i].strip()):
                items.append(inline(re.sub(r'^\d+[.)]\s+','',lines[i].strip()))); i+=1
            out.append('<ol>'+''.join(f'<li>{x}</li>' for x in items)+'</ol>'); continue
        para.append(st); i+=1
    flush_para()
    return ''.join(out)

if __name__ == "__main__":
    import sys
    src = sys.stdin.read() if len(sys.argv) < 2 else open(sys.argv[1]).read()
    print(md2html(src))
