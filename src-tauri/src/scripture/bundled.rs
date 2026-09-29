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

pub static BUNDLED: &[BundledBible] = &[BundledBible {
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
}];

pub fn by_id(id: &str) -> Option<&'static BundledBible> {
    BUNDLED.iter().find(|b| b.id == id)
}
