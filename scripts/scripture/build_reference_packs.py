#!/usr/bin/env python3
"""Builds the data-driven Bible-reference language packs:

    resources/scripture/reference-packs.json

One shared engine (`src-tauri/src/scripture`) reads references in every
language; this file gives it the book names of the 100 languages it knows
beyond nothing (the six hand-reviewed packs — English, German, Korean, French,
Spanish, Portuguese — keep their curated dictionaries in Rust and are counted
among the 100).

Sources (recorded in the output's "provenance"):

* Which languages: Unicode CLDR supplemental territoryInfo (population of
  each language per territory, summed over territories). Spoken varieties
  whose Bible references are written in another pack's standard form are
  merged into it (MERGE); languages without published book-name data are
  skipped (recorded). The first 100 that remain are the set.
* Book names and abbreviations: the per-language data of the OpenBible.info
  Bible Passage Reference Parser (MIT licence),
  github.com/openbibleinfo/Bible-Passage-Reference-Parser-Languages, data/*.yaml.
  Only the 66 books of the app's canon are taken.

Run (network needed for --fetch; otherwise reads the cache directory):

    python3 scripts/scripture/build_reference_packs.py --fetch --cache /tmp/refdata
    python3 scripts/scripture/build_reference_packs.py --cache /tmp/refdata

The output is deterministic for the same inputs.
"""

import argparse
import collections
import json
import os
import sys
import unicodedata
import urllib.request

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML is needed: pip install pyyaml")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "resources", "scripture", "reference-packs.json")

DATA_REPO = "https://raw.githubusercontent.com/openbibleinfo/Bible-Passage-Reference-Parser-Languages/main"
CLDR = "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json"

# The hand-reviewed packs (Rust: scripture::aliases). Their dictionaries are not generated.
CURATED = {"eng": "en", "deu": "de", "kor": "ko", "fra": "fr", "spa": "es", "por": "pt"}

# CLDR code -> ISO 639-3 code of the data file (standard ISO 639 correspondences;
# for a macrolanguage, the individual language whose data is the written standard).
ISO = {
    "en": "eng", "zh": "zho", "hi": "hin", "es": "spa", "ar": "arb", "fr": "fra", "ur": "urd",
    "bn": "ben", "pt": "por", "pa": "pan", "ru": "rus", "sw": "swh", "id": "ind", "yue": "yue",
    "de": "deu", "ja": "jpn", "te": "tel", "mr": "mar", "jv": "jav", "vi": "vie", "ta": "tam",
    "fa": "pes", "tr": "tur", "ko": "kor", "fil": "tgl", "it": "ita", "gu": "guj", "ps": "pbu",
    "th": "tha", "kn": "kan", "pcm": "pcm", "ml": "mal", "ha": "hau", "or": "ory", "sd": "snd",
    "pl": "pol", "nan": "nan", "ms": "zsm", "am": "amh", "uz": "uzn", "om": "gaz", "my": "mya",
    "hak": "hak", "bho": "bho", "az": "azj", "su": "sun", "nl": "nld", "yo": "yor", "ig": "ibo",
    "skr": "skr", "ceb": "ceb", "awa": "awa", "mg": "plt", "uk": "ukr", "ne": "npi", "mai": "mai",
    "ro": "ron", "ny": "nya", "so": "som", "as": "asm", "mad": "mad", "rkt": "rkt", "bgc": "bgc",
    "mag": "mag", "mwr": "mwr", "tts": "tts", "fuv": "fuv", "hne": "hne", "km": "khm", "zu": "zul",
    "si": "sin", "sr": "srp", "kk": "kaz", "sn": "sna", "ak": "twi", "sv": "swe", "cs": "ces",
    "wo": "wol", "hu": "hun", "el": "ell", "ku": "kmr", "nds": "nds", "rw": "kin", "qu": "quz",
    "ilo": "ilo", "tg": "tgk", "lua": "lua", "ti": "tir", "xh": "xho", "umb": "umb", "bm": "bam",
    "af": "afr", "hil": "hil", "ki": "kik", "ht": "hat", "he": "heb", "kmb": "kmb", "mos": "mos",
    "ff": "fuv", "bal": "bal", "kri": "kri", "rn": "run", "ii": "iii", "min": "min", "syl": "syl",
    "zgh": "zgh", "ca": "cat", "ug": "uig", "man": "man", "bjj": "bjj", "sat": "sat", "bg": "bul",
    "bs": "bos", "dyu": "dyu", "da": "dan", "tk": "tuk",
}

# Spoken varieties whose Bible references are written in another pack's standard form.
MERGE = {
    "wuu": "zh", "hsn": "zh", "gan": "zh",  # written Chinese
    "arz": "ar", "apc": "ar", "arq": "ar", "ary": "ar", "apd": "ar", "aeb": "ar",
    "acm": "ar", "ayl": "ar", "ars": "ar", "mey": "ar", "shu": "ar",  # Modern Standard Arabic
    "bar": "de", "gsw": "de",  # Standard German
    "dcc": "ur",  # Urdu script
    "lah": "pa",  # Lahnda: Punjabi (Shahmukhi) references
}

OSIS = {
    "Gen": "GEN", "Exod": "EXO", "Lev": "LEV", "Num": "NUM", "Deut": "DEU", "Josh": "JOS",
    "Judg": "JDG", "Ruth": "RUT", "1Sam": "1SA", "2Sam": "2SA", "1Kgs": "1KI", "2Kgs": "2KI",
    "1Chr": "1CH", "2Chr": "2CH", "Ezra": "EZR", "Neh": "NEH", "Esth": "EST", "Job": "JOB",
    "Ps": "PSA", "Prov": "PRO", "Eccl": "ECC", "Song": "SNG", "Isa": "ISA", "Jer": "JER",
    "Lam": "LAM", "Ezek": "EZK", "Dan": "DAN", "Hos": "HOS", "Joel": "JOL", "Amos": "AMO",
    "Obad": "OBA", "Jonah": "JON", "Mic": "MIC", "Nah": "NAM", "Hab": "HAB", "Zeph": "ZEP",
    "Hag": "HAG", "Zech": "ZEC", "Mal": "MAL", "Matt": "MAT", "Mark": "MRK", "Luke": "LUK",
    "John": "JHN", "Acts": "ACT", "Rom": "ROM", "1Cor": "1CO", "2Cor": "2CO", "Gal": "GAL",
    "Eph": "EPH", "Phil": "PHP", "Col": "COL", "1Thess": "1TH", "2Thess": "2TH", "1Tim": "1TI",
    "2Tim": "2TI", "Titus": "TIT", "Phlm": "PHM", "Heb": "HEB", "Jas": "JAS", "1Pet": "1PE",
    "2Pet": "2PE", "1John": "1JN", "2John": "2JN", "3John": "3JN", "Jude": "JUD", "Rev": "REV",
}

# Scripts without spaces between words: a book name may touch the text before it.
UNSPACED = {"Han", "Hiragana", "Katakana", "Thai", "Lao", "Khmer", "Myanmar", "Yi"}

SCRIPT_PREFIX = [
    ("CJK", "Han"), ("HIRAGANA", "Hiragana"), ("KATAKANA", "Katakana"), ("HANGUL", "Hangul"),
    ("LATIN", "Latin"), ("CYRILLIC", "Cyrillic"), ("GREEK", "Greek"), ("ARABIC", "Arabic"),
    ("HEBREW", "Hebrew"), ("DEVANAGARI", "Devanagari"), ("BENGALI", "Bengali"),
    ("GURMUKHI", "Gurmukhi"), ("GUJARATI", "Gujarati"), ("ORIYA", "Oriya"), ("TAMIL", "Tamil"),
    ("TELUGU", "Telugu"), ("KANNADA", "Kannada"), ("MALAYALAM", "Malayalam"), ("SINHALA", "Sinhala"),
    ("THAI", "Thai"), ("LAO", "Lao"), ("KHMER", "Khmer"), ("MYANMAR", "Myanmar"),
    ("ETHIOPIC", "Ethiopic"), ("YI ", "Yi"), ("OL CHIKI", "OlChiki"), ("SYLOTI NAGRI", "SylotiNagri"),
    ("TIBETAN", "Tibetan"), ("GEORGIAN", "Georgian"), ("ARMENIAN", "Armenian"),
]


def script_of(ch):
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return None
    for prefix, script in SCRIPT_PREFIX:
        if name.startswith(prefix):
            return script
    return None


def fetch(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as r, open(path, "wb") as f:
        f.write(r.read())


def rank(cache):
    info = json.load(open(os.path.join(cache, "territoryInfo.json")))["supplemental"]["territoryInfo"]
    total = collections.Counter()
    for v in info.values():
        pop = float(v.get("_population", 0))
        for lang, data in v.get("languagePopulation", {}).items():
            total[lang.split("_")[0]] += pop * float(data["_populationPercent"]) / 100
    return total


def available(cache, iso3):
    return os.path.exists(os.path.join(cache, "yaml", iso3 + ".yaml"))


def select(cache, fetch_missing):
    total = rank(cache)
    chosen, merged, skipped = [], [], []
    for code, pop in total.most_common():
        if len(chosen) == 100:
            break
        millions = round(pop / 1e6, 1)
        if code in MERGE:
            merged.append({"code": code, "into": MERGE[code], "millions": millions})
            continue
        iso3 = ISO.get(code)
        if iso3 and fetch_missing and not available(cache, iso3):
            try:
                fetch(f"{DATA_REPO}/data/{iso3}.yaml", os.path.join(cache, "yaml", iso3 + ".yaml"))
            except Exception:
                pass
        if not iso3 or not available(cache, iso3):
            skipped.append({"code": code, "iso3": iso3, "millions": millions})
            continue
        if any(c["iso3"] == iso3 for c in chosen):
            continue
        chosen.append({"code": code, "iso3": iso3, "millions": millions, "rank": len(chosen) + 1})
    return chosen, merged, skipped


def texts_of(entry):
    """(text, exact) pairs of a book entry; `exact` keeps case and accents significant."""
    out = []
    for t in entry.get("texts") or []:
        if isinstance(t, dict):
            if "text" in t:
                out.append((str(t["text"]), t.get("normalize") == "none"))
        else:
            out.append((str(t), False))
    return out


def books_of(data, unspaced, latin_pack):
    """{book code: [(alias, exact)]} from a language's data (the 66-book canon only)."""
    books = collections.defaultdict(list)
    for entry in data.get("books") or []:
        osis = entry.get("osis")
        texts = texts_of(entry)
        items = osis if isinstance(osis, list) else [{"osis": osis}]
        for item in items:
            if isinstance(item, str):
                item = {"osis": item}
            code = OSIS.get(item.get("osis"))
            if not code:
                continue
            before = [str(b) for b in (item.get("before") or [])] or [""]
            after = [str(a) for a in (item.get("after") or [])] or [""]
            for text, exact in texts:
                # In a non-Latin pack the English OSIS code ("Gen", "Exod") is English, not
                # this language; in a Latin-script pack it may be the real name ("Job", "Amos").
                if not latin_pack and text == item.get("osis") and not exact:
                    continue
                for b in before:
                    for a in after:
                        joins = [" "] if not unspaced else ["", " "]
                        for j in joins:
                            alias = text
                            if b:
                                alias = f"{b}{j}{alias}"
                            if a:
                                alias = f"{alias}{j}{a}"
                            books[code].append((alias.strip(), exact))
    return books


def native_name(cache, code, fetch_missing):
    """The language's name in itself (CLDR), when CLDR has it."""
    path = os.path.join(cache, "native", code + ".json")
    if fetch_missing and not os.path.exists(path):
        try:
            fetch(f"{CLDR}/cldr-localenames-full/main/{code}/languages.json", path)
        except Exception:
            return None
    if not os.path.exists(path):
        return None
    try:
        data = json.load(open(path, encoding="utf-8"))
        main = next(iter(data["main"].values()))
        return main["localeDisplayNames"]["languages"].get(code)
    except Exception:
        return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cache", required=True)
    p.add_argument("--fetch", action="store_true")
    args = p.parse_args()
    cache = args.cache
    if args.fetch:
        fetch(f"{CLDR}/cldr-core/supplemental/territoryInfo.json", os.path.join(cache, "territoryInfo.json"))
        fetch(f"{CLDR}/cldr-localenames-full/main/en/languages.json", os.path.join(cache, "languages-en.json"))
    chosen, merged, skipped = select(cache, args.fetch)
    if len(chosen) != 100:
        sys.exit(f"only {len(chosen)} languages have data")
    names = json.load(open(os.path.join(cache, "languages-en.json")))["main"]["en"]["localeDisplayNames"]["languages"]

    packs = []
    for lang in chosen:
        iso3 = lang["iso3"]
        native = native_name(cache, lang["code"], args.fetch)
        meta = {
            "iso3": iso3,
            "code": lang["code"],
            "name": names.get(lang["code"], iso3),
            "native": native,
            "rank": lang["rank"],
            "millions": lang["millions"],
        }
        if iso3 in CURATED:
            meta["curated"] = CURATED[iso3]
            packs.append(meta)
            continue
        data = yaml.load(open(os.path.join(cache, "yaml", iso3 + ".yaml"), encoding="utf-8"), Loader=yaml.BaseLoader)
        # Scripts, from the language's own names (the English OSIS codes aside).
        counts = collections.Counter()
        osis_codes = set(OSIS)
        for entry in data.get("books") or []:
            for text, _ in texts_of(entry):
                if text in osis_codes:
                    continue
                for ch in text:
                    s = script_of(ch)
                    if s:
                        counts[s] += 1
        total = sum(counts.values()) or 1
        scripts = sorted(s for s, n in counts.items() if n / total >= 0.05)
        main_script = counts.most_common(1)[0][0] if counts else "Latin"
        unspaced = main_script in UNSPACED
        books = books_of(data, unspaced, main_script == "Latin")
        variables = data.get("variables") or {}
        units = lambda key: sorted({str(v) for v in (variables.get(key) or []) if isinstance(v, str) and not str(v).isdigit() and all(script_of(c) in UNSPACED | {"Hangul"} for c in str(v) if script_of(c))} - {""})
        # Within one language, a spelling that names two books is not usable: kept apart as ambiguous.
        seen = collections.defaultdict(set)
        for code, aliases in books.items():
            for alias, _ in aliases:
                seen[alias.casefold()].add(code)
        ambiguous = {a: sorted(c) for a, c in seen.items() if len(c) > 1}
        out_books = {}
        for code in sorted(books, key=lambda c: list(OSIS.values()).index(c)):
            kept = []
            for alias, exact in books[code]:
                if alias.casefold() in ambiguous:
                    continue
                item = alias if not exact else {"text": alias, "exact": True}
                if item not in kept:
                    kept.append(item)
            out_books[code] = kept
        missing = [c for c in OSIS.values() if not out_books.get(c)]
        meta.update({
            "script": main_script,
            "scripts": scripts,
            "spaced": not unspaced,
            "chapterUnits": units("chapter"),
            "verseUnits": units("verse"),
            "books": out_books,
            "ambiguous": dict(sorted(ambiguous.items())),
            "missingBooks": missing,
        })
        packs.append(meta)

    out = {
        "format": "abiding-word/reference-packs",
        "version": 1,
        "provenance": {
            "languages": "Unicode CLDR 48 supplemental territoryInfo: language population summed over territories; spoken varieties merged into their written standard; languages without published book-name data skipped; first 100 kept.",
            "bookNames": "OpenBible.info Bible Passage Reference Parser language data (data/<iso639-3>.yaml), MIT licence, Copyright (c) Stephen Smith; https://github.com/openbibleinfo/Bible-Passage-Reference-Parser-Languages",
            "curated": "English, German, Korean, French, Spanish and Portuguese use the hand-reviewed dictionaries in src-tauri/src/scripture/aliases (not generated).",
            "merged": merged,
            "skipped": skipped,
        },
        "packs": packs,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=None, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(packs)} languages")


if __name__ == "__main__":
    main()
