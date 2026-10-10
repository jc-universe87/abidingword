# 성경전서 개역한글판 (kor1961) — source and licence

| | |
|---|---|
| Text | 성경전서 개역한글판 (Korean Revised Version, 1961), 66 books, © 대한성서공회 (Korean Bible Society) |
| File | `kor1961_usfm.zip` (USFM, one file per book), made by Abiding Word from the Society's own online text |
| Text taken from | https://bskorea.or.kr/bible/korbibReadpage.php?version=HAN&book=<book>&chap=<chapter> (all 1,189 chapters) |
| Retrieved on | 2026-10-10 |
| How it was made | [`make_usfm.py`](make_usfm.py), from the saved pages |
| SHA-256 | `025eb4dc52fb62996da0b4e85a45b9567144b7fe686dee7908f2b1c7a2f5fc50` |
| Licence | Economic copyright expired (free to use without permission or fee); the author's moral rights of integrity and attribution apply |

## Licence statement

From the Korean Bible Society's copyright FAQ (posted 2017-10-27), kept verbatim
in [`copyright-statement.txt`](copyright-statement.txt):

> 『성경전서 개역한글판』의 저작재산권 보호기간은 50년이 경과되어 저작권료 지급없이
> 사용 가능합니다.(2013년 이후부터 70년 존속)
> 다만, '동일성유지권'과 '성명표시권'의 인격저작권을 준수하셔서 사용하셔야 합니다.

In English: the economic copyright term of *성경전서 개역한글판* (50 years) has
passed, so it may be used without paying royalties; the moral rights of
**integrity** (the content, form and title are not to be altered) and
**attribution** (the author is to be named) must be respected.

## How Abiding Word respects those rights

- **Integrity.** Every verse is taken word for word from the Society's online
  text, in its 1961 spelling; the title is kept exactly: 성경전서 개역한글판.
  The conversion only moves the text into USFM: psalm titles become `\d`,
  the translator's notes become `\f` footnotes and the reader's section
  headings become `\s1`, all kept in the file. Where the translation joins
  verses, the joined verse keeps its range (`\v 4-5`).
- **Attribution.** The app names the Korean Bible Society as the author in the
  Bible's notice: "성경전서 개역한글판 © 대한성서공회 1961".

## Checks made

- 66 books, 1,189 chapters, every verse number present (31,102 verses counting
  the joined ones), no empty verse.
- Compared with the World English Bible, the only differences are known
  numbering conventions (1 Samuel 30:30–31, 2 Corinthians 13:12–14, 3 John
  14–15, Song of Songs 6:13–7:1, Romans 14:24–26/16:25–27).
- An earlier candidate, eBible.org's `kor` ("Korean Bible 1910", in fact the
  개역한글 text), was rejected: about 110 verses were missing and some Psalms
  were misnumbered. Korean Wikisource's transcription was rejected because it
  modernises the spelling, which would not keep the text unaltered.

## How Abiding Word uses it

The archive is shipped as an application resource. It is not installed
automatically; the user adds it from Settings → Bible Texts (or the Scripture
pane) through the normal import verification screen. As for every Bible, the
reader shows the verses and psalm titles; notes and section headings stay in
the file.
