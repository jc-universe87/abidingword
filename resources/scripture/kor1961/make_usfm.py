"""How kor1961_usfm.zip was made (kept for provenance; not used by the app).

Converts the Korean Bible Society's 개역한글 (HAN) reader pages
(https://bskorea.or.kr/bible/korbibReadpage.php?version=HAN&book=<code>&chap=<n>,
saved as <CODE>_<nnn>.html) into USFM.

Every word of the text is kept as published. Psalm titles become \\d,
translator's notes become \\f footnotes (kept in the file), and the reader's
name/place highlighting is dropped (it is presentation, not text).
Usage: python3 -I to_usfm.py <kbs-html-dir> <books.tsv> <chapters.tsv> <out-dir>
"""
import html
import os
import re
import sys

src, books_tsv, chapters_tsv, out = sys.argv[1:5]
names = dict(l.split("\t") for l in open(books_tsv, encoding="utf-8").read().split("\n") if l)
chapters = [l.split("\t") for l in open(chapters_tsv, encoding="utf-8").read().split("\n") if l]
os.makedirs(out, exist_ok=True)

ORDER = [code for code, _ in chapters]


def clean(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", " ", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return re.sub(r"\s+", " ", html.unescape(fragment).replace("\xa0", " ")).strip()


def chapter(code: str, number: int):
    """The chapter as an ordered list of ("title", text), ("heading", text) and ("verse", n, text)."""
    page = open(f"{src}/{code}_{number:03d}.html", "rb").read().decode("utf-8")
    body = page[page.index('id="tdBible1"'):]
    body = body[: body.index('<div style="width:100%;text-align: center">')]
    # translator's notes: the popup text, keyed by id, and the marker in the verse
    notes = {m.group(1): clean(m.group(2)) for m in re.finditer(r"<div id='(D_[^']+)'[^>]*>(.*?)</div>", body, re.S)}
    body = re.sub(r"<div id='D_[^']+'[^>]*>.*?</div>", "", body, flags=re.S)
    body = re.sub(
        r"<a class=comment[^>]*clickPopUp\('(D_[^']+)'[^>]*>(.*?)</a>",
        lambda m: f"\x01{notes.get(m.group(1), '')}\x03",
        body,
        flags=re.S,
    )
    items = []
    token = re.compile(r'<font class="smallTitle">(.*?)</font><br|<span class="number">(\d+(?:-\d+)?)(?:&nbsp;|\s)*</span>', re.S)
    matches = list(token.finditer(body))
    for i, m in enumerate(matches):
        if m.group(1) is not None:
            text = clean(m.group(1))
            # a title before verse 1 of a psalm is the psalm's own title; the reader's other titles are headings
            kind = "title" if code == "PSA" and not any(it[0] == "verse" for it in items) else "heading"
            items.append((kind, text))
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        text = clean(body[m.end():end])
        text = re.sub(r"\s*\x01([^\x03]*)\x03", lambda n: f" \\f + \\fr {number}:{m.group(2)} \\ft {n.group(1)}\\f*", text)
        # a few verses are joined in this translation and numbered as a range ("4-5")
        items.append(("verse", m.group(2), re.sub(r"[ ]{2,}", " ", text).strip()))
    return items


report = []
for index, (code, count) in enumerate(chapters, start=1):
    lines = [f"\\id {code} 성경전서 개역한글판", "\\usfm 3.0", f"\\h {names[code]}", f"\\toc1 {names[code]}", f"\\mt1 {names[code]}"]
    for c in range(1, int(count) + 1):
        items = chapter(code, c)
        lines += [f"\\c {c}"]
        opened = False
        for item in items:
            if item[0] == "title":
                lines += [f"\\d {item[1]}"]
            elif item[0] == "heading":
                lines += [f"\\s1 {item[1]}"]
                opened = False
            else:
                if not opened:
                    lines += ["\\p"]
                    opened = True
                lines += [f"\\v {item[1]} {item[2]}"]
        numbers = []
        for it in items:
            if it[0] == "verse":
                lo, _, hi = it[1].partition("-")
                numbers += list(range(int(lo), int(hi or lo) + 1))
        if numbers != list(range(1, len(numbers) + 1)):
            report.append(f"{code} {c}: verse numbers {numbers}")
    with open(f"{out}/{index + (1 if index > 39 else 0):02d}-{code}kor1961.usfm", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
print("\n".join(report) or "all chapters: verses numbered 1..n without gaps")
