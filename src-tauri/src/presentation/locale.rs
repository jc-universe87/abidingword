//! Words the exports need in the person's language. The interface sends
//! them with each export (it holds the translations); English is used for
//! anything left out.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::document::RefInfo;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportLocale {
    /// The language of the text (e.g. "de-DE"), for PowerPoint's proofing.
    pub language: String,
    /// Book names by code (JHN → "Johannes").
    pub book_names: BTreeMap<String, String>,
    /// "Psalm" for a single psalm.
    pub psalm: String,
    pub verse_separator: String,
    pub labels: ExportLabels,
}

impl Default for ExportLocale {
    fn default() -> Self {
        Self {
            language: "en-US".to_string(),
            book_names: BTreeMap::new(),
            psalm: "Psalm".to_string(),
            verse_separator: ":".to_string(),
            labels: ExportLabels::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportLabels {
    pub slide: String,
    pub speaker_notes: String,
    pub introduction: String,
    pub conclusion: String,
    pub explanation: String,
    pub application: String,
    pub illustration: String,
    pub standing: String,
    pub citations: String,
    pub generated_image: String,
    pub image_unavailable: String,
    pub scripture_unavailable: String,
    pub pause: String,
    pub next: String,
    /// The standings of kept material, by code.
    pub standings: BTreeMap<String, String>,
}

impl Default for ExportLabels {
    fn default() -> Self {
        let standings = [
            ("verified", "Verified"),
            ("unverified", "Not verified"),
            ("hypothetical", "Invented illustration"),
            ("found", "Found image"),
            ("generated", "Generated image"),
            ("suggestion", "Suggestion"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        Self {
            slide: "Slide".to_string(),
            speaker_notes: "Speaker notes".to_string(),
            introduction: "Introduction".to_string(),
            conclusion: "Conclusion".to_string(),
            explanation: "Explanation".to_string(),
            application: "Application".to_string(),
            illustration: "Illustration".to_string(),
            standing: "Standing".to_string(),
            citations: "Sources".to_string(),
            generated_image: "Generated image".to_string(),
            image_unavailable: "Image not available offline".to_string(),
            scripture_unavailable: "Scripture text not available".to_string(),
            pause: "Pause".to_string(),
            next: "Next".to_string(),
            standings,
        }
    }
}

impl ExportLocale {
    /// The name a manuscript field is shown under.
    pub fn field<'a>(&'a self, field: &'a str) -> &'a str {
        let l = &self.labels;
        match field {
            "introduction" => &l.introduction,
            "conclusion" => &l.conclusion,
            "explanation" => &l.explanation,
            "application" => &l.application,
            "illustration" => &l.illustration,
            "standing" => &l.standing,
            other => other,
        }
    }

    /// A manuscript part's text as shown (a standing code becomes its name).
    pub fn part_text<'a>(&'a self, field: &str, text: &'a str) -> &'a str {
        if field == "standing" {
            return self
                .labels
                .standings
                .get(text)
                .map(String::as_str)
                .unwrap_or(text);
        }
        text
    }

    /// A passage as the reader sees it, with the same rules as the
    /// interface: "John 15:1–11", "John 15:1–16:4", "Romans 8", "Jude 3".
    pub fn reference(&self, r: &RefInfo) -> String {
        let one_chapter = matches!(r.book.as_str(), "OBA" | "PHM" | "2JN" | "3JN" | "JUD");
        let name = if r.book == "PSA" && r.start_chapter == r.end_chapter {
            self.psalm.clone()
        } else {
            self.book_names
                .get(&r.book)
                .cloned()
                .or_else(|| crate::scripture::canon::by_code(&r.book).map(|b| b.name.to_string()))
                .unwrap_or_else(|| r.book.clone())
        };
        let sep = &self.verse_separator;
        let point = |chapter: u16, verse: Option<u16>| match verse {
            None => chapter.to_string(),
            Some(v) if one_chapter => v.to_string(),
            Some(v) => format!("{chapter}{sep}{v}"),
        };
        let (sc, sv, ec, ev) = (r.start_chapter, r.start_verse, r.end_chapter, r.end_verse);
        if one_chapter && sv.is_none() && ev.is_none() {
            return name;
        }
        if sc == ec && sv == ev {
            return format!("{name} {}", point(sc, sv));
        }
        let end = match (sv, ev) {
            (Some(_), Some(e)) if sc == ec => e.to_string(),
            _ => point(ec, ev),
        };
        format!("{name} {}–{end}", point(sc, sv))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(book: &str, sc: u16, sv: Option<u16>, ec: u16, ev: Option<u16>) -> RefInfo {
        RefInfo {
            canonical: String::new(),
            book: book.to_string(),
            start_chapter: sc,
            start_verse: sv,
            end_chapter: ec,
            end_verse: ev,
        }
    }

    #[test]
    fn references_read_like_the_interface() {
        let en = ExportLocale::default();
        assert_eq!(
            en.reference(&r("JHN", 15, Some(1), 15, Some(11))),
            "John 15:1–11"
        );
        assert_eq!(
            en.reference(&r("JHN", 15, Some(1), 16, Some(4))),
            "John 15:1–16:4"
        );
        assert_eq!(en.reference(&r("ROM", 8, None, 8, None)), "Romans 8");
        assert_eq!(en.reference(&r("JUD", 1, Some(3), 1, Some(3))), "Jude 3");
        assert_eq!(en.reference(&r("PSA", 23, None, 23, None)), "Psalm 23");
        let mut de = ExportLocale::default();
        de.book_names.insert("JHN".into(), "Johannes".into());
        de.verse_separator = ",".into();
        assert_eq!(
            de.reference(&r("JHN", 3, Some(16), 3, Some(16))),
            "Johannes 3,16"
        );
    }
}
