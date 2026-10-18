//! What language-aware detection costs: building each language's parser once,
//! then reading running text. Prints its measurements (run with `--nocapture`
//! and `--test-threads=1` for clean numbers); the limits are deliberately loose
//! so a slow machine does not fail them.

use std::time::{Duration, Instant};

use abiding_word_lib::scripture::language::ReferenceLanguage::{self, De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::parser::ReferenceParser;

fn sample(language: ReferenceLanguage) -> &'static str {
    match language {
        En => "As John 3:16 and Rom 8:28 say, God so loved the world, and 1 Cor 13:4-7 describes love.",
        De => "Wie Joh 3,16 und Röm 8,28 sagen, hat Gott die Welt so geliebt, und 1. Kor 13,4–7 beschreibt die Liebe.",
        Ko => "요한복음 3장 16절과 롬 8:28이 말하듯 하나님이 세상을 사랑하셨고 고전 13:4-7이 사랑을 설명한다.",
        Fr => "Comme Jn 3,16 et Rm 8,28 le disent, Dieu a tant aimé le monde, et 1 Co 13,4-7 décrit l’amour.",
        Es => "Como dicen Jn 3:16 y Ro 8:28, Dios amó tanto al mundo, y 1 Co 13:4-7 describe el amor.",
        Pt => "Como dizem Jo 3:16 e Rm 8:28, Deus amou tanto o mundo, e 1 Co 13:4-7 descreve o amor.",
        ReferenceLanguage::Data(_) => "",
    }
}

#[test]
fn building_and_using_each_parser() {
    let mut worst_build = Duration::ZERO;
    for language in ReferenceLanguage::REVIEWED {
        let started = Instant::now();
        let parser = ReferenceParser::for_language(language);
        let build = started.elapsed();
        worst_build = worst_build.max(build);

        let text = sample(language);
        let paragraphs = 5_000;
        let started = Instant::now();
        let mut found = 0;
        for _ in 0..paragraphs {
            found += parser.detect(text).len();
        }
        let per_paragraph = started.elapsed() / paragraphs as u32;
        eprintln!(
            "{}: parser built in {:?}; {} paragraphs read in {:?} each ({} references)",
            language.code(),
            build,
            paragraphs,
            per_paragraph,
            found
        );
        assert_eq!(found, paragraphs * 3, "{language:?}");
        assert!(
            per_paragraph < Duration::from_millis(5),
            "{language:?}: {per_paragraph:?}"
        );
    }
    assert!(worst_build < Duration::from_secs(30), "{worst_build:?}");
}

#[test]
fn a_generated_pack_reads_a_source_in_its_own_language() {
    // A generated pack's running-text pattern is compiled only when a source in
    // its language is read; the slowest of the 94 must still be quick.
    let mut worst = (Duration::ZERO, "");
    let text = "Lorem ipsum 3:16 dolor sit amet, 1 2 3. ".repeat(20);
    for language in ReferenceLanguage::all() {
        if !matches!(language, ReferenceLanguage::Data(_)) {
            continue;
        }
        let started = Instant::now();
        let parser = ReferenceParser::for_language(language);
        let _ = parser.detect(&text);
        let elapsed = started.elapsed();
        if elapsed > worst.0 {
            worst = (elapsed, language.code());
        }
    }
    eprintln!(
        "slowest generated pack built and read in {:?} ({})",
        worst.0, worst.1
    );
    assert!(worst.0 < Duration::from_secs(10), "{worst:?}");
}
