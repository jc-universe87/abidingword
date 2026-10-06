//! Language-aware reference detection (v0.9, sub-phase 2): one parser per
//! source language, never merged. All sentences are invented.

use abiding_word_lib::scripture::language::ReferenceLanguage::{self, De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::parser::ReferenceParser;

fn found(language: ReferenceLanguage, text: &str) -> Vec<(String, String)> {
    ReferenceParser::for_language(language)
        .detect(text)
        .into_iter()
        .map(|d| (d.text, d.reference.canonical))
        .collect()
}

fn canon(language: ReferenceLanguage, text: &str) -> Vec<String> {
    found(language, text).into_iter().map(|(_, c)| c).collect()
}

/// The text between two UTF-16 offsets, as JavaScript would slice it.
fn utf16_slice(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start..end]).unwrap()
}

fn none(language: ReferenceLanguage, texts: &[&str]) {
    for text in texts {
        assert_eq!(
            canon(language, text),
            Vec::<String>::new(),
            "{language:?}: {text}"
        );
    }
}

// --- English: unchanged -----------------------------------------------------

#[test]
fn english_keeps_its_behaviour() {
    assert_eq!(
        canon(En, "Read John 15:1–11 and Rom 8."),
        ["JHN.15.1-JHN.15.11", "ROM.8"]
    );
    assert_eq!(canon(En, "John 3."), ["JHN.3"]);
    assert_eq!(canon(En, "See 1 Cor 13:4-7."), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(En, "As Jn 3.16 says"), ["JHN.3.16"]);
    assert_eq!(canon(En, "Ps. 23"), ["PSA.23"]);
    // a heading, as the section derivation reads it
    assert_eq!(
        canon(En, "John 15:1–11 — The True Vine"),
        ["JHN.15.1-JHN.15.11"]
    );
    none(
        En,
        &[
            "We will mark 4 places on the map.",
            "Mr 5 arrived.",
            "John 99:1 does not exist.",
        ],
    );
}

#[test]
fn english_still_reads_a_capitalised_name_and_a_number_as_a_reference() {
    // The documented English policy: it is a false positive we accept, not hide.
    assert_eq!(canon(En, "Mark 4 Principles of Leadership"), ["MRK.4"]);
    // ... but not in lower case
    none(En, &["we will mark 4 places"]);
}

// --- German -----------------------------------------------------------------

#[test]
fn german_names_abbreviations_and_notation() {
    assert_eq!(canon(De, "Johannes 3,16"), ["JHN.3.16"]);
    assert_eq!(canon(De, "Joh 3,16–18"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(De, "Röm 8,1-4"), ["ROM.8.1-ROM.8.4"]);
    assert_eq!(canon(De, "Psalm 23"), ["PSA.23"]);
    assert_eq!(
        canon(De, "Joh 3:16"),
        ["JHN.3.16"],
        "the colon is accepted too"
    );
    assert_eq!(canon(De, "Joh 15,1–16,4"), ["JHN.15.1-JHN.16.4"]);
    // accents are optional
    assert_eq!(canon(De, "Roem 8,1"), Vec::<String>::new());
    assert_eq!(
        canon(De, "Rom 8,1"),
        Vec::<String>::new(),
        "\"Rom\" is not an alias of Römer"
    );
    assert_eq!(
        canon(De, "Hebräer 11,1 und Hebraer 11,1"),
        ["HEB.11.1", "HEB.11.1"]
    );
}

#[test]
fn german_numbered_books() {
    assert_eq!(canon(De, "1. Korinther 13,4-7"), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(De, "1 Kor 13"), ["1CO.13"]);
    assert_eq!(canon(De, "1Kor 13,4"), ["1CO.13.4"]);
    assert_eq!(canon(De, "2.Kor 5,17"), ["2CO.5.17"]);
    assert_eq!(canon(De, "1. Joh 4,8"), ["1JN.4.8"]);
    assert_eq!(canon(De, "1. Mose 1,1"), ["GEN.1.1"]);
    assert_eq!(canon(De, "2. Mose 20,1-17"), ["EXO.20.1-EXO.20.17"]);
    assert_eq!(canon(De, "5 Mose 6,4"), ["DEU.6.4"]);
    // Johannes and 1. Johannes are different books
    assert_eq!(canon(De, "Joh 1,1 und 1. Joh 1,1"), ["JHN.1.1", "1JN.1.1"]);
}

#[test]
fn german_in_prose_and_headings() {
    assert_eq!(
        found(
            De,
            "Wie Paulus in Röm 8,28 schreibt, wirkt alles zum Guten."
        ),
        [("Röm 8,28".to_string(), "ROM.8.28".to_string())]
    );
    assert_eq!(
        canon(De, "Joh 15,1–11 — Der wahre Weinstock"),
        ["JHN.15.1-JHN.15.11"]
    );
    assert_eq!(
        canon(De, "Vgl. Jes 53,5; Ps 22,2 und Offb 21,4."),
        ["ISA.53.5", "PSA.22.2", "REV.21.4"]
    );
}

#[test]
fn german_false_positives_are_avoided() {
    none(
        De,
        &[
            "Am 3. Mai war es kalt.",
            "Am 3 Tag kam er zurück.",
            "Mal 5 Minuten warten.",
            "Mi 7 Uhr ist Schluss.",
            "Hi 5 Leute kamen.",
            "was joh 3,16 bedeutet", // lower case
            "Röm 99,1 gibt es nicht.",
            "Joh 3,0 ist kein Vers.",
            "Es sind 3,16 Euro.",
        ],
    );
    // "Joh 3, 16 Personen": a comma and a space is a comma in a sentence, not a verse
    assert_eq!(canon(De, "Joh 3, 16 Personen kamen"), ["JHN.3"]);
    // the full names still work for the books whose short forms are left out
    assert_eq!(canon(De, "Amos 3,7"), ["AMO.3.7"]);
    assert_eq!(canon(De, "Maleachi 3,1"), ["MAL.3.1"]);
    assert_eq!(canon(De, "Micha 6,8"), ["MIC.6.8"]);
}

#[test]
fn german_offsets_are_utf16_units() {
    let text = "„Größe“ – so Röm 8,28 – bleibt.";
    let found = ReferenceParser::for_language(De).detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(utf16_slice(text, found[0].start, found[0].end), "Röm 8,28");
}

// --- French -----------------------------------------------------------------

#[test]
fn french_names_abbreviations_and_notation() {
    assert_eq!(canon(Fr, "Jean 3,16"), ["JHN.3.16"]);
    assert_eq!(canon(Fr, "Jn 3,16-18"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(Fr, "Jn 3:16"), ["JHN.3.16"]);
    assert_eq!(canon(Fr, "Rm 8,28"), ["ROM.8.28"]);
    assert_eq!(canon(Fr, "Psaume 23"), ["PSA.23"]);
    assert_eq!(canon(Fr, "Ps 23,1"), ["PSA.23.1"]);
    assert_eq!(
        canon(Fr, "Ésaïe 53,5 et Esaie 53,5"),
        ["ISA.53.5", "ISA.53.5"]
    );
    assert_eq!(canon(Fr, "Apocalypse 21,4"), ["REV.21.4"]);
}

#[test]
fn french_numbered_books() {
    assert_eq!(canon(Fr, "1 Corinthiens 13,4-7"), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(Fr, "1 Co 13"), ["1CO.13"]);
    assert_eq!(canon(Fr, "I Co 13"), ["1CO.13"]);
    assert_eq!(canon(Fr, "1Co 13,4"), ["1CO.13.4"]);
    assert_eq!(canon(Fr, "2 Timothée 3,16"), ["2TI.3.16"]);
    assert_eq!(canon(Fr, "1 Jean 4,8 et Jean 4,8"), ["1JN.4.8", "JHN.4.8"]);
    assert_eq!(canon(Fr, "1 Rois 19,12"), ["1KI.19.12"]);
}

#[test]
fn french_in_prose_and_headings() {
    assert_eq!(
        found(Fr, "Comme l’écrit Paul en Rm 8,28, tout concourt au bien."),
        [("Rm 8,28".to_string(), "ROM.8.28".to_string())]
    );
    assert_eq!(
        canon(Fr, "Jn 15,1-11 — La vraie vigne"),
        ["JHN.15.1-JHN.15.11"]
    );
}

#[test]
fn french_false_positives_are_avoided() {
    none(
        Fr,
        &[
            "Os 3 morceaux restaient.",
            "Mi 5 minutes plus tard.",
            "Je 3 fois, il le dit.",
            "Le 3 juillet, il partit.",
            "Ne 3 fois.",
            "Est 3 heures de route.",
            "Nb 5 de la liste.",
            "av. JC 33 environ",
            "jean 3,16 en minuscules",
            "Jn 99,1 n’existe pas.",
        ],
    );
    assert_eq!(
        canon(Fr, "Osée 6,6 et Néhémie 8,10"),
        ["HOS.6.6", "NEH.8.10"]
    );
}

#[test]
fn french_offsets_are_utf16_units() {
    let text = "« Français » — voir Jn 3,16 aussi.";
    let found = ReferenceParser::for_language(Fr).detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(utf16_slice(text, found[0].start, found[0].end), "Jn 3,16");
}

// --- Spanish ------------------------------------------------------------------

#[test]
fn spanish_names_abbreviations_and_notation() {
    assert_eq!(canon(Es, "Juan 3:16"), ["JHN.3.16"]);
    assert_eq!(canon(Es, "Juan 3,16"), ["JHN.3.16"]);
    assert_eq!(canon(Es, "Jn 3:16-18"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(Es, "Ro 8:28"), ["ROM.8.28"]);
    assert_eq!(canon(Es, "Sal 23"), ["PSA.23"]);
    assert_eq!(
        canon(Es, "Génesis 1:1 y Genesis 1:1"),
        ["GEN.1.1", "GEN.1.1"]
    );
    assert_eq!(canon(Es, "Apocalipsis 21:4"), ["REV.21.4"]);
}

#[test]
fn spanish_numbered_books() {
    assert_eq!(canon(Es, "1 Corintios 13:4-7"), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(Es, "1 Co 13"), ["1CO.13"]);
    assert_eq!(canon(Es, "I Co 13"), ["1CO.13"]);
    assert_eq!(canon(Es, "1Co 13:4"), ["1CO.13.4"]);
    assert_eq!(canon(Es, "2 Timoteo 3:16"), ["2TI.3.16"]);
    assert_eq!(canon(Es, "1 Juan 4:8 y Juan 4:8"), ["1JN.4.8", "JHN.4.8"]);
}

#[test]
fn spanish_in_prose_and_headings() {
    assert_eq!(
        found(Es, "Como escribe Pablo en Ro 8:28, todo ayuda a bien."),
        [("Ro 8:28".to_string(), "ROM.8.28".to_string())]
    );
    assert_eq!(
        canon(Es, "Jn 15:1-11 — La vid verdadera"),
        ["JHN.15.1-JHN.15.11"]
    );
}

#[test]
fn spanish_false_positives_are_avoided() {
    none(
        Es,
        &[
            "El jue 3 de mayo vendremos.",
            "Jue 3 de mayo vendremos.",
            "Ap 3 es mi casa.",
            "Os 3 veces lo dije.",
            "Mal 5 días seguidos.",
            "Mr 5 llegó tarde.",
            "juan 3:16 en minúsculas",
            "Jn 99:1 no existe.",
        ],
    );
    assert_eq!(
        canon(Es, "Jueces 6:12, Oseas 6:6 y Malaquías 3:1"),
        ["JDG.6.12", "HOS.6.6", "MAL.3.1"]
    );
}

#[test]
fn spanish_offsets_are_utf16_units() {
    let text = "¡Cuántas veces! — dice Juan 3:16 — ¿no?";
    let found = ReferenceParser::for_language(Es).detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(utf16_slice(text, found[0].start, found[0].end), "Juan 3:16");
}

// --- Portuguese -----------------------------------------------------------------

#[test]
fn portuguese_names_abbreviations_and_notation() {
    assert_eq!(canon(Pt, "João 3:16"), ["JHN.3.16"]);
    assert_eq!(canon(Pt, "João 3,16"), ["JHN.3.16"]);
    assert_eq!(
        canon(Pt, "Joao 3:16"),
        ["JHN.3.16"],
        "the accent is optional"
    );
    assert_eq!(canon(Pt, "Jo 3,16-18"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(Pt, "Rm 8:28"), ["ROM.8.28"]);
    assert_eq!(canon(Pt, "Sl 23"), ["PSA.23"]);
    assert_eq!(canon(Pt, "Apocalipse 21:4"), ["REV.21.4"]);
    // "Jó" (Job) and "Jo" (João) differ only by the accent, and it decides
    assert_eq!(canon(Pt, "Jó 1:1"), ["JOB.1.1"]);
    assert_eq!(canon(Pt, "Jo 1:1"), ["JHN.1.1"]);
}

#[test]
fn portuguese_numbered_books() {
    assert_eq!(canon(Pt, "1 Coríntios 13:4-7"), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(Pt, "1º Coríntios 13"), ["1CO.13"]);
    assert_eq!(canon(Pt, "1Co 13"), ["1CO.13"]);
    assert_eq!(canon(Pt, "I Co 13"), ["1CO.13"]);
    assert_eq!(canon(Pt, "2 Timóteo 3:16"), ["2TI.3.16"]);
    assert_eq!(canon(Pt, "1 João 4:8 e João 4:8"), ["1JN.4.8", "JHN.4.8"]);
    assert_eq!(canon(Pt, "1 Coríntios 13,4-7"), ["1CO.13.4-1CO.13.7"]);
}

#[test]
fn portuguese_in_prose_and_headings() {
    assert_eq!(
        found(
            Pt,
            "Como Paulo escreve em Rm 8:28, tudo coopera para o bem."
        ),
        [("Rm 8:28".to_string(), "ROM.8.28".to_string())]
    );
    assert_eq!(
        canon(Pt, "Jo 15:1-11 — A videira verdadeira"),
        ["JHN.15.1-JHN.15.11"]
    );
}

#[test]
fn portuguese_false_positives_are_avoided() {
    none(
        Pt,
        &[
            "Os 3 homens chegaram.",
            "Na 3 casas ao lado.",
            "Ap 3 está livre.",
            "Ne 3 vezes.",
            "joão 3:16 em minúsculas",
            "Jo 99:1 não existe.",
        ],
    );
    assert_eq!(
        canon(Pt, "Oseias 6:6, Naum 1:7 e Neemias 8:10"),
        ["HOS.6.6", "NAM.1.7", "NEH.8.10"]
    );
}

#[test]
fn portuguese_offsets_are_utf16_units() {
    let text = "“Coríntios” — veja João 3:16 já.";
    let found = ReferenceParser::for_language(Pt).detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(utf16_slice(text, found[0].start, found[0].end), "João 3:16");
}

// --- Korean ---------------------------------------------------------------------

#[test]
fn korean_names_and_notation() {
    assert_eq!(canon(Ko, "요한복음 3:16"), ["JHN.3.16"]);
    assert_eq!(canon(Ko, "요한복음 3장 16절"), ["JHN.3.16"]);
    assert_eq!(canon(Ko, "요한복음 3장 16-18절"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(Ko, "요한복음 3장 16절-18절"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(Ko, "요한복음 3장 16절-4장 2절"), ["JHN.3.16-JHN.4.2"]);
    assert_eq!(canon(Ko, "요한복음 3:16~18"), ["JHN.3.16-JHN.3.18"]);
    assert_eq!(canon(Ko, "요한복음 15:1-11"), ["JHN.15.1-JHN.15.11"]);
    assert_eq!(canon(Ko, "요한복음 3장"), ["JHN.3"]);
    assert_eq!(canon(Ko, "요한복음 3-4장"), ["JHN.3-JHN.4"]);
    assert_eq!(canon(Ko, "요한복음 3"), ["JHN.3"]);
    assert_eq!(canon(Ko, "시편 23편"), ["PSA.23"]);
    assert_eq!(canon(Ko, "고린도전서 13:4-7"), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(Ko, "고린도후서 5장 17절"), ["2CO.5.17"]);
    assert_eq!(canon(Ko, "요한일서 4:8"), ["1JN.4.8"]);
    assert_eq!(canon(Ko, "요한1서 4:8"), ["1JN.4.8"]);
    assert_eq!(canon(Ko, "창세기 1:1"), ["GEN.1.1"]);
    assert_eq!(canon(Ko, "요한계시록 21장 4절"), ["REV.21.4"]);
    assert_eq!(canon(Ko, "예레미야 애가 3:22-23"), ["LAM.3.22-LAM.3.23"]);
}

#[test]
fn korean_abbreviations() {
    assert_eq!(canon(Ko, "롬 8:28"), ["ROM.8.28"]);
    assert_eq!(canon(Ko, "롬8:28"), ["ROM.8.28"], "no space");
    assert_eq!(canon(Ko, "롬 8장"), ["ROM.8"]);
    assert_eq!(canon(Ko, "고전 13:4-7"), ["1CO.13.4-1CO.13.7"]);
    assert_eq!(canon(Ko, "고후 5장 17절"), ["2CO.5.17"]);
    assert_eq!(canon(Ko, "요일 4:8"), ["1JN.4.8"]);
    assert_eq!(canon(Ko, "삼상 3:10"), ["1SA.3.10"]);
    assert_eq!(canon(Ko, "창 1:1"), ["GEN.1.1"]);
    // the one-syllable abbreviations that are also words need a chapter and a verse
    assert_eq!(canon(Ko, "요 3:16"), ["JHN.3.16"]);
    assert_eq!(canon(Ko, "요 3장 16절"), ["JHN.3.16"]);
    assert_eq!(canon(Ko, "시 23:1"), ["PSA.23.1"]);
    assert_eq!(canon(Ko, "마 5:3-12"), ["MAT.5.3-MAT.5.12"]);
    assert_eq!(canon(Ko, "계 21:4"), ["REV.21.4"]);
    // 요일 (1 John) and 요 (John) are different books
    assert_eq!(canon(Ko, "요 1:1 그리고 요일 1:1"), ["JHN.1.1", "1JN.1.1"]);
}

#[test]
fn korean_one_chapter_books() {
    assert_eq!(canon(Ko, "빌레몬서 6절"), ["PHM.1.6"]);
    assert_eq!(canon(Ko, "유다서 3절"), ["JUD.1.3"]);
    assert_eq!(canon(Ko, "유다서 1장"), ["JUD.1"]);
    assert_eq!(canon(Ko, "유다서 1장 3절"), ["JUD.1.3"]);
    assert_eq!(canon(Ko, "빌레몬서 4-7절"), ["PHM.1.4-PHM.1.7"]);
    // 절 (verse) means nothing for a book with chapters
    none(Ko, &["요한복음 3절"]);
}

#[test]
fn korean_in_prose_and_headings() {
    // particles after a reference are part of the sentence, not the reference
    let text = "요한복음 3장에서 예수님은 말씀하셨다.";
    let found = ReferenceParser::for_language(Ko).detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].text, "요한복음 3장");
    assert_eq!(
        utf16_slice(text, found[0].start, found[0].end),
        "요한복음 3장"
    );
    assert_eq!(canon(Ko, "롬 8:28은 약속이다."), ["ROM.8.28"]);
    assert_eq!(canon(Ko, "이 말씀(요 15:5)을 기억하자."), ["JHN.15.5"]);
    assert_eq!(
        canon(Ko, "요한복음 15장 1-11절 — 참포도나무"),
        ["JHN.15.1-JHN.15.11"]
    );
    assert_eq!(
        canon(Ko, "요한복음 연구 › 요한복음 15장 1-11절"),
        ["JHN.15.1-JHN.15.11"]
    );
    assert_eq!(
        canon(Ko, "참조: 창 1:1; 시 23:1; 롬 8:28"),
        ["GEN.1.1", "PSA.23.1", "ROM.8.28"]
    );
}

#[test]
fn korean_has_no_capital_letter_rule_but_does_not_guess() {
    none(
        Ko,
        &[
            "요 3개를 샀다.",
            "시 3편 이후에는",
            "약 3:30에 도착한다.",
            "잠 3시간을 잤다.",
            "나 3:16에 간다.",
            "전 3:30까지 오세요.",
            "요한복음 3권을 읽었다.",
            "요한복음 3000쪽",
            "예요한복음 3:16",
            "요한 3:16",
            "에 3:16",
            "단 3:30",
            "수 3:30",
            "롬 99:1",
            "요 3:0",
        ],
    );
    // a name that is also a word needs more than a bare number
    none(Ko, &["아가 3명이 울었다."]);
    assert_eq!(canon(Ko, "아가 2:4"), ["SNG.2.4"]);
    assert_eq!(canon(Ko, "아가 2장"), ["SNG.2"]);
}

#[test]
fn korean_offsets_are_utf16_units() {
    let text = "그리고 요한복음 3:16을 읽자";
    let found = ReferenceParser::for_language(Ko).detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(
        utf16_slice(text, found[0].start, found[0].end),
        "요한복음 3:16"
    );
    assert_eq!((found[0].start, found[0].end), (4, 13));
}

// --- isolation and fallback ----------------------------------------------------------

#[test]
fn each_parser_reads_only_its_own_language() {
    none(
        Ko,
        &[
            "John 3:16",
            "Johannes 3,16",
            "Jean 3,16",
            "Juan 3:16",
            "João 3:16",
        ],
    );
    none(
        De,
        &[
            "요한복음 3:16",
            "Jean 3,16",
            "Juan 3:16",
            "João 3:16",
            "Jn 3:16",
        ],
    );
    none(
        Fr,
        &["요한복음 3:16", "Johannes 3,16", "Juan 3:16", "João 3:16"],
    );
    none(
        Es,
        &["요한복음 3:16", "Johannes 3,16", "Jean 3:16", "João 3:16"],
    );
    none(
        Pt,
        &["요한복음 3:16", "Johannes 3,16", "Jean 3:16", "Juan 3:16"],
    );
    none(
        En,
        &[
            "요한복음 3:16",
            "Johannes 3,16",
            "Jean 3,16",
            "Juan 3:16",
            "João 3:16",
        ],
    );
}

#[test]
fn the_same_text_means_different_things_in_different_languages() {
    // "Joh 3,16": German John 3:16; English reads the chapter only
    assert_eq!(canon(De, "Joh 3,16"), ["JHN.3.16"]);
    assert_eq!(canon(En, "Joh 3,16"), ["JHN.3"]);
    // "Jon 3": Jona (de), Jonas (fr), Jonás (es), Jonah (en); "Jo 3" is João only in Portuguese
    assert_eq!(canon(Pt, "Jo 3,16"), ["JHN.3.16"]);
    assert_eq!(canon(Es, "Jo 3,16"), Vec::<String>::new());
}

#[test]
fn an_unknown_or_missing_language_is_read_as_english_and_never_merged() {
    for label in [None, Some(""), Some("Italiano"), Some("xx")] {
        let resolved = ReferenceLanguage::resolve(label);
        assert!(resolved.fallback, "{label:?}");
        let parser = ReferenceParser::for_language(resolved.language);
        let found: Vec<_> = parser
            .detect("John 3:16, Johannes 3,16 and 요한복음 3:16")
            .into_iter()
            .map(|d| d.reference.canonical)
            .collect();
        assert_eq!(found, ["JHN.3.16"], "{label:?}: only English is read");
    }
}

#[test]
fn parsers_are_built_once_and_shared() {
    for language in ReferenceLanguage::ALL {
        let a = ReferenceParser::for_language(language) as *const ReferenceParser;
        let b = ReferenceParser::for_language(language) as *const ReferenceParser;
        assert_eq!(a, b, "{language:?}");
        assert_eq!(ReferenceParser::for_language(language).language(), language);
    }
    assert!(std::ptr::eq(
        ReferenceParser::english(),
        ReferenceParser::for_language(En)
    ));
}

#[test]
fn a_whole_chapter_of_prose_stays_quick() {
    // Detection is run over every paragraph of a source at import: it must not rebuild anything per call.
    let text = "Wie Paulus in Röm 8,28 schreibt, wirkt alles zum Guten, und Joh 3,16 ist bekannt. "
        .repeat(40);
    let started = std::time::Instant::now();
    let mut total = 0;
    for _ in 0..200 {
        total += ReferenceParser::for_language(De).detect(&text).len();
    }
    assert_eq!(total, 200 * 80);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(20),
        "{:?}",
        started.elapsed()
    );
}
