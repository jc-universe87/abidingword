//! Bible texts shipped with Abiding Word.
//!
//! Only texts whose licence has been verified from the publisher's own
//! statement are listed here; see resources/scripture/<id>/SOURCE.md.
//! Bundled texts are not installed automatically: the user adds them
//! through the same verification screen as any other import.

pub struct BundledBible {
    pub id: &'static str,
    /// File name under the app's `scripture/` resource folder.
    pub resource: &'static str,
    pub name: &'static str,
    pub short_name: &'static str,
    pub language: &'static str,
    pub language_code: &'static str,
    pub publisher: &'static str,
    pub license_type: &'static str,
    pub copyright_notice: &'static str,
}

/// Listed in the order they are offered (the interface language's Bibles come
/// first on screen; see AddBibleView). Each has resources/scripture/<id>/SOURCE.md.
pub static BUNDLED: &[BundledBible] = &[
    BundledBible {
        id: "engbsb",
        resource: "engbsb_usfm.zip",
        name: "Berean Standard Bible",
        short_name: "BSB",
        language: "English",
        language_code: "en",
        publisher: "eBible.org",
        license_type: "Public Domain",
        copyright_notice: "The Berean Standard Bible is in the Public Domain. Imported from eBible.org's USFM edition (engbsb); footnotes and cross-references are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "engwebp",
        resource: "engwebp_usfm.zip",
        name: "World English Bible",
        short_name: "WEB",
        language: "English",
        language_code: "en",
        publisher: "eBible.org",
        license_type: "Public Domain",
        copyright_notice: "The World English Bible is in the Public Domain. \
        \u{201c}World English Bible\u{201d} is a trademark of eBible.org. \
        Imported from eBible.org's USFM edition (engwebp); footnotes, \
        cross-references and Strong's numbers are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "deu1912",
        resource: "deu1912_usfm.zip",
        name: "Lutherbibel 1912",
        short_name: "LUT1912",
        language: "Deutsch",
        language_code: "de",
        publisher: "eBible.org",
        license_type: "Public Domain",
        copyright_notice: "Die Lutherbibel 1912 ist gemeinfrei (Public Domain). Imported from eBible.org's USFM edition (deu1912); footnotes and cross-references are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "deu1951",
        resource: "deu1951_usfm.zip",
        name: "Schlachter-Bibel 1951",
        short_name: "SCH1951",
        language: "Deutsch",
        language_code: "de",
        publisher: "eBible.org",
        license_type: "CC BY 4.0",
        copyright_notice: "Die Schlachter-Bibel 1951, copyright © 1951 Genfer Bibelgesellschaft. Lizenz: Creative Commons Namensnennung 4.0 (CC BY 4.0). Imported from eBible.org's USFM edition (deu1951); footnotes and cross-references are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "deuelo",
        resource: "deuelo_usfm.zip",
        name: "Elberfelder 1905 (unrevidiert)",
        short_name: "ELB1905",
        language: "Deutsch",
        language_code: "de",
        publisher: "eBible.org",
        license_type: "Public Domain",
        copyright_notice: "Die unrevidierte Elberfelder Bibel 1905 ist gemeinfrei (Public Domain). Imported from eBible.org's USFM edition (deuelo); footnotes and cross-references are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "fraLSG",
        resource: "fraLSG_usfm.zip",
        name: "Louis Segond 1910",
        short_name: "LSG",
        language: "Français",
        language_code: "fr",
        publisher: "eBible.org",
        license_type: "Public Domain",
        copyright_notice: "Cette Bible est dans le domaine public. This Bible is in the Public Domain. Imported from eBible.org's USFM edition (fraLSG); footnotes and cross-references are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "spaRV1909",
        resource: "spaRV1909_usfm.zip",
        name: "Santa Biblia — Reina Valera 1909",
        short_name: "RV1909",
        language: "Español",
        language_code: "es",
        publisher: "eBible.org",
        license_type: "Public Domain",
        copyright_notice: "Reina Valera 1909: dominio público (Public Domain). Imported from eBible.org's USFM edition (spaRV1909); footnotes and cross-references are omitted, the wording is unchanged.",
    },
    BundledBible {
        id: "porbr2018",
        resource: "porbr2018_usfm.zip",
        name: "Bíblia Livre",
        short_name: "BLIVRE",
        language: "Português",
        language_code: "pt",
        publisher: "eBible.org",
        license_type: "CC BY 4.0",
        copyright_notice: "Bíblia Livre (BLIVRE), Copyright © Diego Santos, Mario Sérgio, e Marco Teles, http://sites.google.com/site/biblialivre/ - fevereiro de 2018. Licença Creative Commons Atribuição 4.0 Brasil (http://creativecommons.org/licenses/by/4.0/br/). Imported from eBible.org's USFM edition (porbr2018); footnotes and cross-references are omitted, the wording is unchanged.",
    },
];

pub fn by_id(id: &str) -> Option<&'static BundledBible> {
    BUNDLED.iter().find(|b| b.id == id)
}
