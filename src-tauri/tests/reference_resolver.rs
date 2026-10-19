//! The one reader of typed Bible references (`scripture::resolve`, v0.18.2):
//! every language, every script, one canonical answer, and no guess when the
//! input genuinely means two passages. Scripture navigation, Bible Study
//! passage fields, Teaching and Presenter View all read typed passages through
//! this engine (`scripture_reference_parse`).

use std::time::{Duration, Instant};

use abiding_word_lib::error::AppError;
use abiding_word_lib::scripture::data_packs;
use abiding_word_lib::scripture::language::ReferenceLanguage::{self, De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::packs::{self, Script};
use abiding_word_lib::scripture::parser::{Reading, ReferenceParser};
use abiding_word_lib::scripture::recognise::Recogniser;
use abiding_word_lib::scripture::resolve::{language_of_tag, preferred, resolve, Context};

/// With only an interface language (no Bible in context).
fn canonical(input: &str, language: Option<ReferenceLanguage>) -> String {
    match resolve(input, Context::new(None, language)) {
        Ok(reference) => reference.canonical(),
        Err(error) => panic!("{input:?} ({language:?}): {error:?}"),
    }
}

/// The error code and its values for an input that is not one passage.
fn refusal(input: &str, language: Option<ReferenceLanguage>) -> (String, Vec<(String, String)>) {
    refusal_in(input, Context::new(None, language))
}

/// With the Bible's language and the interface language.
fn read_in(
    input: &str,
    bible: Option<ReferenceLanguage>,
    interface: Option<ReferenceLanguage>,
) -> String {
    match resolve(input, Context::new(bible, interface)) {
        Ok(reference) => reference.canonical(),
        Err(error) => panic!("{input:?} (Bible {bible:?}, interface {interface:?}): {error:?}"),
    }
}

fn refusal_in(input: &str, context: Context) -> (String, Vec<(String, String)>) {
    match resolve(input, context) {
        Ok(reference) => panic!(
            "{input:?} should not resolve, got {}",
            reference.canonical()
        ),
        Err(AppError::InvalidReference(message)) => (
            message.code.unwrap_or_default().to_string(),
            message
                .params
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
        ),
        Err(other) => panic!("{input:?}: unexpected {other:?}"),
    }
}

fn language(code: &str) -> ReferenceLanguage {
    ReferenceLanguage::from_label(code).unwrap_or_else(|| panic!("no language {code}"))
}

const EVERY_PREFERENCE: [Option<ReferenceLanguage>; 7] = [
    None,
    Some(En),
    Some(De),
    Some(Ko),
    Some(Fr),
    Some(Es),
    Some(Pt),
];

#[test]
fn john_15_5_in_every_reviewed_language_whatever_the_interface_language() {
    for input in [
        "Johannes 15,5",
        "Joh 15,5",
        "John 15:5",
        "Jean 15,5",
        "Juan 15:5",
        "João 15:5",
        "요한복음 15장 5절",
    ] {
        for preference in EVERY_PREFERENCE {
            assert_eq!(
                canonical(input, preference),
                "JHN.15.5",
                "{input:?} {preference:?}"
            );
        }
    }
}

#[test]
fn every_major_script_reads_to_the_same_canonical_passage() {
    // (input, the language whose pack names the book) — real names from the
    // published data, not made up for the test.
    let cases = [
        ("Иоанна 15:5", "ru"),
        ("От Иоанна 15:5", "ru"),
        ("Івана 15:5", "uk"),
        ("Јован 15:5", "sr"),
        ("Йоан 15:5", "bg"),
        ("Κατα Ιωαννην 15:5", "el"),
        ("Κατά Ιωάννην 15,5", "el"),
        ("约翰福音 15:5", "zh"),
        ("約翰福音15章5節", "zh"),
        ("约翰福音 第15章5节", "zh"),
        ("ヨハネによる福音書 15:5", "ja"),
        ("ヨハネによる福音書15章5節", "ja"),
        ("إنجيل يوحنا 15:5", "ar"),
        ("يوحنا ١٥:٥", "ar"),
        ("یوحنا ۱۵:۵", "fa"),
        ("יוחנן 15:5", "he"),
        ("यूहन्ना 15:5", "hi"),
        ("यूहन्ना १५:५", "hi"),
        ("যোহন ১৫:৫", "bn"),
        ("ਯੂਹਾਂਨਾ 15:5", "pa"),
        ("યોહાન 15:5", "gu"),
        ("ଯୋହନ 15:5", "or"),
        ("யோவான் 15:5", "ta"),
        ("యోహాను 15:5", "te"),
        ("ಯೋಹಾನನ ಸುವಾರ್ತೆ 15:5", "kn"),
        ("യോഹന്നാൻ 15:5", "ml"),
        ("යොහන් 15:5", "si"),
        ("ยอห์น 15:5", "th"),
        ("ยอห์น ๑๕:๕", "th"),
        ("យ៉ូហាន ១៥:៥", "km"),
        ("ရှင်ယောဟန်ခရစ်ဝင် ၁၅:၅", "my"),
        ("ዮሐንስ 15:5", "am"),
        ("Giovanni 15,5", "it"),
        ("Jana 15:5", "pl"),
        ("Yohanes 15:5", "id"),
        ("Yuhanna 15:5", "tr"),
        ("Gioan 15:5", "vi"),
    ];
    for (input, code) in cases {
        let pack = language(code);
        assert!(
            matches!(
                ReferenceParser::for_language(pack).read(input),
                Reading::Found(ref r) if r.canonical() == "JHN.15.5"
            ),
            "{input:?} is read by its own pack ({code})"
        );
        for preference in [None, Some(En), Some(Ko), Some(pack)] {
            assert_eq!(
                canonical(input, preference),
                "JHN.15.5",
                "{input:?} {preference:?}"
            );
        }
    }
}

#[test]
fn full_names_abbreviations_ranges_numbered_books_and_separators() {
    let cases = [
        ("1 Kor 13,4-7", "1CO.13.4-1CO.13.7"),
        ("1Kor 13:4", "1CO.13.4"),
        ("1. Korinther 13", "1CO.13"),
        ("1 Corinthians 13:4-7", "1CO.13.4-1CO.13.7"),
        ("I Corinthiens 13,4", "1CO.13.4"),
        ("1-е Коринфянам 13:4", "1CO.13.4"),
        ("Иоанна 3:16-18", "JHN.3.16-JHN.3.18"),
        ("哥林多前书 13:4-7", "1CO.13.4-1CO.13.7"),
        ("Rom 8:1-17", "ROM.8.1-ROM.8.17"),
        ("Römer 8,28", "ROM.8.28"),
        ("Juan 3.16", "JHN.3.16"),
        ("John 3:16–4:2", "JHN.3.16-JHN.4.2"),
        ("Giovanni 14-16", "JHN.14-JHN.16"),
        ("Ps 119:105", "PSA.119.105"),
        ("Psalm 23", "PSA.23"),
        ("Jud 5", "JUD.1.5"),
        ("Mt 5:3-12", "MAT.5.3-MAT.5.12"),
        ("Ewangelia według św. Jana 3,16", "JHN.3.16"),
        ("《约翰福音》3:16", "JHN.3.16"),
        ("約翰福音 ３：１６", "JHN.3.16"),
        ("John 3:16.", "JHN.3.16"),
    ];
    for (input, expected) in cases {
        for preference in [None, Some(En), Some(De)] {
            assert_eq!(
                canonical(input, preference),
                expected,
                "{input:?} {preference:?}"
            );
        }
    }
}

#[test]
fn chapter_only_and_book_only_input() {
    for (input, expected) in [
        ("John 15", "JHN.15"),
        ("Johannes 15", "JHN.15"),
        ("요한복음 15장", "JHN.15"),
        ("约翰福音 15章", "JHN.15"),
        ("Иоанна 15", "JHN.15"),
        ("John", "JHN.1"),
        ("Johannes", "JHN.1"),
        ("요한복음", "JHN.1"),
        ("Giovanni", "JHN.1"),
    ] {
        assert_eq!(canonical(input, None), expected, "{input:?}");
    }
}

#[test]
fn a_genuinely_ambiguous_input_is_never_guessed() {
    // "фил" is Philippians in one Cyrillic pack and Philemon in another; no
    // interface language and no reviewed pack reads it.
    for preference in EVERY_PREFERENCE {
        let (code, params) = refusal("фил 1:1", preference);
        assert_eq!(code, "reference.ambiguous", "{preference:?}");
        let books = &params.iter().find(|(k, _)| k == "books").unwrap().1;
        assert!(books.contains("PHP") && books.contains("PHM"), "{books}");
        let canonicals = &params.iter().find(|(k, _)| k == "canonicals").unwrap().1;
        assert!(canonicals.contains("PHP.1.1"), "{canonicals}");
    }
    for bible in [Some(En), Some(De), Some(Pt)] {
        assert_eq!(
            refusal_in("фил 1:1", Context::new(bible, Some(Ko))).0,
            "reference.ambiguous"
        );
    }
    // 雅 is James and the Song of Songs in Chinese and Japanese.
    assert_eq!(refusal("雅 1:1", None).0, "reference.ambiguous");
}

/// The final priority for typed references: the Bible's language, the
/// interface language, the common reading, otherwise ask. English has no
/// place of its own. "Jn" is John in English, French and Spanish and Jonah in
/// Portuguese; German and Korean do not read it.
#[test]
fn a_bible_language_then_the_interface_then_the_common_reading_then_ask() {
    // A. The Bible's language beats the interface language…
    assert_eq!(read_in("Jn 3:5", Some(Pt), Some(En)), "JON.3.5");
    // B. …in either direction.
    assert_eq!(read_in("Jn 3:5", Some(En), Some(Pt)), "JHN.3.5");
    assert_eq!(read_in("Jn 3:5", Some(Fr), Some(Pt)), "JHN.3.5");
    // C. No Bible language: the interface decides.
    assert_eq!(read_in("Jn 3:5", None, Some(Pt)), "JON.3.5");
    assert_eq!(read_in("Jn 3:5", None, Some(Es)), "JHN.3.5");
    // D. The Bible's language does not read the input: the interface decides.
    assert_eq!(read_in("Jn 3:5", Some(De), Some(Pt)), "JON.3.5");
    assert_eq!(read_in("Jn 3:5", Some(Ko), Some(En)), "JHN.3.5");
    // A generated Bible language decides too (Italian "Gv" is John only, but
    // Italian "Es" is Exodus where English reads Esther).
    let italian = ReferenceLanguage::from_label("it");
    assert_eq!(read_in("Es 3:5", italian, Some(En)), "EXO.3.5");
    assert_eq!(read_in("Es 3:5", None, Some(En)), "EST.3.5");
    // …but not against two or more reviewed languages: the Italian data lists
    // "Gn" for Jonah, while English, French, Spanish and Portuguese read Genesis.
    assert_eq!(read_in("Gn 3:5", italian, Some(En)), "GEN.3.5");
    assert_eq!(read_in("Gn 3:5", italian, Some(De)), "GEN.3.5");
    // The safety rules hold for the Bible's own language too.
    let romanian = ReferenceLanguage::from_label("ro");
    assert_eq!(
        refusal_in("Jud 3:5", Context::new(romanian, Some(En))).0,
        "reference.oneChapter"
    );
    // E. Neither decides: the common reading — here three of the four
    // reviewed languages that read "Jn" (German, Korean read nothing).
    for (bible, interface) in [
        (None, None),
        (None, Some(De)),
        (Some(De), Some(Ko)),
        (Some(Ko), None),
    ] {
        assert_eq!(
            read_in("Jn 3:16", bible, interface),
            "JHN.3.16",
            "{bible:?} {interface:?}"
        );
        assert_eq!(
            read_in("Jn 3:5", bible, interface),
            "JHN.3.5",
            "{bible:?} {interface:?}"
        );
    }
    // Many languages agreeing on one passage is accepted without asking.
    for (bible, interface) in [(None, None), (Some(Ko), Some(De)), (Some(Pt), Some(Fr))] {
        assert_eq!(read_in("Joh 15,5", bible, interface), "JHN.15.5");
        assert_eq!(read_in("Jn 15:5", bible, interface), "JHN.15.5"); // Jonah has four chapters
    }
    // F. A genuine tie with nothing to decide it asks — English does not win
    // because it is English. "Hb": Habakkuk in English, Hebrews in Portuguese.
    for (bible, interface) in [(None, None), (None, Some(De)), (Some(Ko), Some(De))] {
        let (code, params) = refusal_in("Hb 3:5", Context::new(bible, interface));
        assert_eq!(code, "reference.ambiguous", "{bible:?} {interface:?}");
        let books = &params.iter().find(|(k, _)| k == "books").unwrap().1;
        assert!(books.contains("HAB") && books.contains("HEB"), "{books}");
    }
    assert_eq!(read_in("Hb 3:5", None, Some(En)), "HAB.3.5");
    assert_eq!(read_in("Hb 3:5", Some(Pt), Some(En)), "HEB.3.5");
    // "Mc": Micah in English, Mark in French, Spanish and Portuguese.
    assert_eq!(read_in("Mc 3:5", None, Some(De)), "MRK.3.5");
    assert_eq!(read_in("Mc 3:5", None, Some(En)), "MIC.3.5");
    assert_eq!(read_in("Mc 3:5", Some(En), Some(Fr)), "MIC.3.5");
}

#[test]
fn a_generated_pack_never_answers_what_a_reviewed_language_means_otherwise() {
    // Review findings: these resolved silently to the wrong book.
    for preference in EVERY_PREFERENCE {
        // Samuel, Sirach, Maccabees — not Psalms (Malayalam/Krio "Sam"),
        // Proverbs (Kurdish "Şîr", folded) or Chronicles (Shona "Mak").
        for input in ["Sam 3:5", "Sir 3:5", "1 Mak 3:5", "2 Mak 3:5", "So 3:5"] {
            assert_eq!(
                refusal(input, preference).0,
                "reference.notRecognised",
                "{input:?} {preference:?}"
            );
        }
        // Jude has one chapter: that is the answer, not Romanian Judges 3:5.
        assert_eq!(
            refusal("Jud 3:5", preference).0,
            "reference.oneChapter",
            "{preference:?}"
        );
    }
    // The languages themselves still read their own names.
    assert_eq!(canonical("1 Sam 3:5", None), "1SA.3.5");
    assert_eq!(canonical("Şîr 3:5", None), "PRO.3.5");
    assert_eq!(canonical("Jud 5", None), "JUD.1.5");
}

#[test]
fn hostile_or_very_long_input_is_refused_quickly() {
    let long = "John ".repeat(2_000) + "3:16";
    let started = Instant::now();
    assert_eq!(refusal(&long, None).0, "reference.notRecognised");
    assert!(
        started.elapsed() < Duration::from_millis(200),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn a_name_that_means_two_books_in_its_own_language_asks_which() {
    // Generated packs list the spellings their data gives to two books; the
    // parser never reads them as either.
    let mut checked = 0;
    for (index, pack) in data_packs::packs().iter().enumerate() {
        for (alias, books) in pack.ambiguous.iter().take(2) {
            let parser = ReferenceParser::for_language(ReferenceLanguage::Data(index as u8));
            match parser.read(&format!("{alias} 1:1")) {
                Reading::Ambiguous(found) => {
                    assert_eq!(found.len(), books.len(), "{} {alias}", pack.iso3);
                    checked += 1;
                }
                // a spelling that also reads with a longer, unambiguous alias is fine
                Reading::Found(_) => {}
                other => panic!("{} {alias}: {other:?}", pack.iso3),
            }
        }
    }
    assert!(checked > 0, "the data lists ambiguous spellings");
}

#[test]
fn invalid_and_unrecognised_input_says_why() {
    assert_eq!(refusal("", None).0, "reference.empty");
    assert_eq!(refusal("   ", Some(De)).0, "reference.empty");
    assert_eq!(refusal("John 51", None).0, "reference.chapterCount");
    assert_eq!(
        refusal("Johannes 51,1", Some(De)).0,
        "reference.chapterCount"
    );
    assert_eq!(refusal("Иоанна 22:1", None).0, "reference.chapterCount");
    assert_eq!(refusal("Hello 3:16", None).0, "reference.notRecognised");
    assert_eq!(refusal("3:16", None).0, "reference.notRecognised");
    assert_eq!(refusal("John 3 16", None).0, "reference.notRecognised");
    assert_eq!(refusal("Paris 3:16", Some(Fr)).0, "reference.notRecognised");
}

#[test]
fn cross_language_collisions_follow_the_documented_policy() {
    // One reading across every language that reads it: no preference needed.
    for (input, expected) in [
        ("Jo 3:16", "JHN.3.16"), // Portuguese João; no other pack's "Jo"
        ("Job 3:1", "JOB.3.1"),  // Job in English, German and many others
        ("Mal 4,3", "MAL.4.3"),
        ("Am 5:24", "AMO.5.24"),
        ("Ap 3:20", "REV.3.20"),
        ("Ri 6:1", "JDG.6.1"),
    ] {
        for preference in EVERY_PREFERENCE {
            assert_eq!(
                canonical(input, preference),
                expected,
                "{input:?} {preference:?}"
            );
        }
    }
}

#[test]
fn the_interface_language_code_becomes_a_preference_not_a_gate() {
    assert_eq!(preferred(Some("de")), Some(De));
    assert_eq!(preferred(Some("ko-KR")), Some(Ko));
    assert_eq!(preferred(Some("pt-BR")), Some(Pt));
    assert_eq!(preferred(None), None);
    assert_eq!(preferred(Some("")), None);
    // A Korean interface still reads a German reference.
    assert_eq!(
        canonical("Johannes 15,5", preferred(Some("ko"))),
        "JHN.15.5"
    );
}

#[test]
fn a_bibles_language_comes_from_its_stored_tag_only() {
    assert_eq!(language_of_tag(Some("pt")), Some(Pt));
    assert_eq!(language_of_tag(Some("pt-BR")), Some(Pt));
    assert_eq!(language_of_tag(Some("de_CH")), Some(De));
    assert_eq!(language_of_tag(Some("deu")), Some(De));
    assert_eq!(language_of_tag(Some("ger")), Some(De));
    assert_eq!(language_of_tag(Some("PT")), Some(Pt));
    for (tag, code) in [
        ("cmn", "zh"),
        ("chi", "zh"),
        ("dut", "nl"),
        ("fas", "fa"),
        ("per", "fa"),
        ("ara", "ar"),
        ("rum", "ro"),
        ("cze", "cs"),
        ("gre", "el"),
        ("msa", "ms"),
    ] {
        assert_eq!(
            language_of_tag(Some(tag)),
            ReferenceLanguage::from_label(code),
            "{tag}"
        );
        assert!(language_of_tag(Some(tag)).is_some(), "{tag}");
    }
    assert_eq!(
        language_of_tag(Some("zh")),
        ReferenceLanguage::from_label("zh")
    );
    assert!(matches!(
        language_of_tag(Some("ja")),
        Some(ReferenceLanguage::Data(_))
    ));
    // Names, empty tags and unknown languages are no signal.
    for tag in [
        None,
        Some(""),
        Some("  "),
        Some("Português"),
        Some("Deutsch"),
        Some("Lutherbibel"),
        Some("xx"),
        Some("la"),
    ] {
        assert_eq!(language_of_tag(tag), None, "{tag:?}");
    }
}

#[test]
fn every_generated_pack_reads_each_of_its_books() {
    // For every one of the 94 generated packs, the longest name of each book it
    // names, typed with "1:1", comes back as that book.
    for (index, pack) in data_packs::packs().iter().enumerate() {
        let parser = ReferenceParser::for_language(ReferenceLanguage::Data(index as u8));
        let mut codes: Vec<&str> = pack.books.iter().map(|(b, _, _)| b.code).collect();
        codes.dedup();
        for code in codes {
            let name = pack
                .books
                .iter()
                .filter(|(b, _, _)| b.code == code)
                .map(|(_, alias, _)| *alias)
                .max_by_key(|alias| alias.chars().count())
                .unwrap();
            match parser.read(&format!("{name} 1:1")) {
                Reading::Found(reference) => {
                    assert_eq!(reference.book.code, code, "{}: {name:?}", pack.iso3)
                }
                other => panic!("{}: {name:?} → {other:?}", pack.iso3),
            }
        }
    }
}

#[test]
fn the_hundred_languages_cover_the_scripts() {
    assert_eq!(ReferenceLanguage::all().count(), 100);
    let mut scripts: Vec<Script> = packs::all()
        .iter()
        .flat_map(|p| p.scripts.iter().copied())
        .collect();
    scripts.sort_by_key(|s| format!("{s:?}"));
    scripts.dedup();
    for script in [
        Script::Latin,
        Script::Cyrillic,
        Script::Greek,
        Script::Hangul,
        Script::Han,
        Script::Katakana,
        Script::Arabic,
        Script::Hebrew,
        Script::Devanagari,
        Script::Bengali,
        Script::Thai,
        Script::Tamil,
        Script::Ethiopic,
        Script::Khmer,
        Script::Myanmar,
    ] {
        assert!(scripts.contains(&script), "{script:?}");
    }
}

#[test]
fn script_detection_and_native_digits() {
    assert_eq!(Script::of('ж'), Some(Script::Cyrillic));
    assert_eq!(Script::of('Ω'), Some(Script::Greek));
    assert_eq!(Script::of('한'), Some(Script::Hangul));
    assert_eq!(Script::of('約'), Some(Script::Han));
    assert_eq!(Script::of('ヨ'), Some(Script::Katakana));
    assert_eq!(Script::of('ي'), Some(Script::Arabic));
    assert_eq!(Script::of('י'), Some(Script::Hebrew));
    assert_eq!(Script::of('ह'), Some(Script::Devanagari));
    assert_eq!(Script::of('য'), Some(Script::Bengali));
    assert_eq!(Script::of('ย'), Some(Script::Thai));
    assert_eq!(Script::of('3'), None);
    use abiding_word_lib::scripture::parser::ascii_digit;
    for (native, ascii) in [
        ('٣', '3'),
        ('۳', '3'),
        ('३', '3'),
        ('৩', '3'),
        ('๓', '3'),
        ('３', '3'),
        ('၃', '3'),
        ('៣', '3'),
    ] {
        assert_eq!(ascii_digit(native), Some(ascii), "{native}");
    }
    // Digits of other kinds (superscripts, circled, Roman numerals) are not chapters.
    for other in ['³', '③', 'Ⅲ', '፫'] {
        assert_eq!(ascii_digit(other), None, "{other}");
    }
    assert_eq!(refusal("John ³:¹⁶", None).0, "reference.notRecognised");
    // Decimal digits of scripts without a pack (Mathematical, Mongolian, NKo,
    // Vai) are not read as numbers — never as chapter 0 (review finding).
    for input in ["John 𝟑:𝟏𝟔", "John ᠓:᠑᠖", "John ߃:߁߆", "John ꘣:꘡꘦"] {
        assert_eq!(refusal(input, None).0, "reference.notRecognised", "{input}");
    }
    assert_eq!(Script::of('ｱ'), Some(Script::Katakana));
    assert_eq!(Script::of('々'), Some(Script::Han));
    assert_eq!(Script::of('𠀀'), Some(Script::Han));
}

#[test]
fn running_text_is_not_widened_by_the_generated_packs() {
    // An English or German source still reads only the six reviewed packs:
    // Italian, Polish or Russian book names in its prose are not references.
    let text = "Il Giovanni 3,16 e Jana 3:16 e Иоанна 3:16 — but John 3:16 is.";
    for source in [En, De] {
        let found: Vec<String> = Recogniser::for_source(source)
            .detect(text)
            .into_iter()
            .map(|d| d.reference.canonical)
            .collect();
        assert_eq!(found, ["JHN.3.16"], "{source:?}");
    }
    // A source in a generated language reads its own pack, under its rules.
    let italian = Recogniser::for_source(language("it"));
    let found: Vec<String> = italian
        .detect("Come dice Giovanni 3:16, e anche giovanni 3:16 in minuscolo; Giovanni 3,16 non è letto.")
        .into_iter()
        .map(|d| d.reference.canonical)
        .collect();
    assert_eq!(found, ["JHN.3.16"], "capital required in running text");
    // Decimals, times and amounts in the prose of generated-pack languages
    // are not references: only ":" (or a unit) separates chapter and verse in
    // their running text (review findings).
    for (code, text) in [
        ("zh", "该镇居民3.5万人，的士3.5公里，歌3.5 路3.5 太3,5"),
        ("ja", "住民3.5万人。出3.2億円"),
        (
            "nl",
            "Op 12.30 uur eten we. Op 3.16 uur. Op 9.15 vertrekt de trein. Wij zijn Op 3,5 km",
        ),
        ("it", "Es 3.5 per cento, Is 2.5 km, Mt 1,5 km"),
        ("pl", "Rz 2,5 tys."),
        ("ru", "Ам 2,5 км"),
    ] {
        let found = Recogniser::for_source(language(code)).detect(text);
        assert!(found.is_empty(), "{code}: {found:?}");
    }
    // …while a real reference in those sources is found.
    let found =
        Recogniser::for_source(language("zh")).detect("请读约翰福音3:16和约翰福音15章5节。");
    let canon: Vec<String> = found.into_iter().map(|d| d.reference.canonical).collect();
    assert_eq!(canon, ["JHN.3.16", "JHN.15.5"]);
    let found = Recogniser::for_source(language("nl")).detect("Lees Johannes 3:16 vandaag.");
    assert_eq!(found.len(), 1);
    // Ignorable marks after a reference are not taken into it.
    let found = Recogniser::for_source(En).detect("See John 3:16\u{200B}\u{200B} now");
    assert_eq!(found[0].text, "John 3:16");
    // Native digits in running text; offsets are those of the original (UTF-16).
    let arabic = Recogniser::for_source(language("ar"));
    let text = "كما قال يوحنا ١٥:٥ اليوم";
    let found = arabic.detect(text);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].reference.canonical, "JHN.15.5");
    assert_eq!(found[0].text, "يوحنا ١٥:٥");
}

#[test]
fn reading_typed_input_in_every_language_is_fast() {
    // Build every pack's parser once (as the first typed reference does).
    let started = Instant::now();
    let _ = resolve("John 3:16", Context::default());
    for language in ReferenceLanguage::all() {
        let _ = ReferenceParser::for_language(language).read("x 1:1");
    }
    let build = started.elapsed();
    let inputs = [
        "Johannes 15,5",
        "约翰福音 15:5",
        "Иоанна 15:5",
        "يوحنا ١٥:٥",
        "Jn 3:5",
        "Hello 3:16",
    ];
    let rounds = 200;
    let started = Instant::now();
    for _ in 0..rounds {
        for input in inputs {
            let _ = resolve(input, Context::new(Some(Pt), Some(De)));
        }
    }
    let each = started.elapsed() / (rounds * inputs.len() as u32);
    eprintln!("all 100 parsers built in {build:?}; one typed reference resolved in {each:?}");
    assert!(build < Duration::from_secs(20), "{build:?}");
    assert!(each < Duration::from_millis(20), "{each:?}");
}

/// v0.18.3: verses are checked against the canon, and a reading that names a
/// verse the canon does not have never competes with a real passage.
#[test]
fn verses_are_validated_and_impossible_readings_do_not_compete() {
    use abiding_word_lib::scripture::resolve::resolve_with;
    // Jn 3:5: both readings exist, so the context decides as before.
    assert_eq!(read_in("Jn 3:5", Some(Pt), Some(En)), "JON.3.5");
    assert_eq!(read_in("Jn 3:5", Some(En), Some(Pt)), "JHN.3.5");
    // Jn 3:16: Jonah 3 has 10 verses, so only John remains — even with a
    // Portuguese Bible or interface.
    assert_eq!(read_in("Jn 3:16", Some(Pt), Some(Pt)), "JHN.3.16");
    assert_eq!(read_in("Jn 3:16", None, Some(Pt)), "JHN.3.16");
    assert_eq!(read_in("Jn 3:11", Some(Pt), None), "JHN.3.11");
    assert_eq!(read_in("Jn 3:10", Some(Pt), None), "JON.3.10");
    // Named outright, an impossible verse says how many there are.
    let (code, params) = refusal("Jonah 3:16", None);
    assert_eq!(code, "reference.verseCount");
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    assert_eq!(get("bookCode").as_deref(), Some("JON"));
    assert_eq!(get("chapter").as_deref(), Some("3"));
    assert_eq!(get("count").as_deref(), Some("10"));
    assert_eq!(refusal("Jonas 3:16", Some(Pt)).0, "reference.verseCount");
    // Psalm 119 boundary.
    assert_eq!(canonical("Psalm 119:176", None), "PSA.119.176");
    assert_eq!(refusal("Psalm 119:177", None).0, "reference.verseCount");
    assert_eq!(canonical("Ps 117:2", None), "PSA.117.2");
    assert_eq!(refusal("Ps 117:3", None).0, "reference.verseCount");
    // One-chapter books: verse forms and the chapter error.
    assert_eq!(canonical("Jude 25", None), "JUD.1.25");
    assert_eq!(canonical("Jude 1:25", None), "JUD.1.25");
    assert_eq!(refusal("Jude 26", None).0, "reference.verseCountBook");
    assert_eq!(refusal("Jud 3:5", None).0, "reference.oneChapter");
    assert_eq!(canonical("3 John 15", None), "3JN.1.15"); // 14 in the KJV, 15 in modern English Bibles
    assert_eq!(refusal("3 John 16", None).0, "reference.verseCountBook");
    // Ranges: the end is checked too, across chapters as well.
    assert_eq!(canonical("John 3:16-36", None), "JHN.3.16-JHN.3.36");
    assert_eq!(refusal("John 3:16-37", None).0, "reference.verseCount");
    assert_eq!(canonical("John 3:36-4:54", None), "JHN.3.36-JHN.4.54");
    assert_eq!(refusal("John 3:36-4:55", None).0, "reference.verseCount");
    assert_eq!(refusal("John 3:37-4:2", None).0, "reference.verseCount");
    assert_eq!(refusal("John 3:16-3:2", None).0, "reference.endBeforeStart");
    // Whole chapters and chapter ranges are untouched.
    assert_eq!(canonical("John 3", None), "JHN.3");
    assert_eq!(canonical("John 3-4", None), "JHN.3-JHN.4");
    // Native digits and other languages go through the same check.
    assert_eq!(refusal("يوحنا ٣:٣٧", None).0, "reference.verseCount");
    assert_eq!(canonical("يوحنا ٣:٣٦", None), "JHN.3.36");
    assert_eq!(refusal("요한복음 3장 37절", None).0, "reference.verseCount");
    assert_eq!(refusal("Johannes 3,37", Some(De)).0, "reference.verseCount");
    // Canon validation, not translation content: a verse beyond the canon
    // that the Bible being read has (Louis Segond's Exodus 7:29) is accepted;
    // one it lacks is never refused because of that.
    let segond_has =
        |book: &'static abiding_word_lib::scripture::canon::Book, chapter: u16, verse: u16| {
            book.code == "EXO" && chapter == 7 && verse <= 29
        };
    let french = Context::new(Some(Fr), Some(Fr));
    assert_eq!(
        resolve_with("Ex 7:29", french, &segond_has)
            .unwrap()
            .canonical(),
        "EXO.7.29"
    );
    assert_eq!(refusal_in("Ex 7:29", french).0, "reference.verseCount");
    assert!(resolve_with("Ex 7:30", french, &segond_has).is_err());
    assert_eq!(
        resolve_with("Jn 3:16", french, &|_, _, _| false)
            .unwrap()
            .canonical(),
        "JHN.3.16"
    );
}
