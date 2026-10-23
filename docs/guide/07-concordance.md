# 🔎 7. Concordance

[← Bible references in your books](06-bible-references.md) · [Contents](README.md) · Next: [Settings, updates and backups →](08-settings-updates-backups.md)

---

A **concordance** shows **every place a word appears** in a Bible: how often,
in which books and in which verses. It is the classic tool for word studies.

## Finding every occurrence of a word

1. Click **Concordance** at the top of the Scripture pane.
2. Type a word, for example `remain`.
3. Keep **Word** selected (or choose **Phrase** for several words in a row)
   and click **Find**.

<p align="center">
  <img src="images/concordance.png" alt="The concordance for 'remain': 92 occurrences in 85 verses, listed by book with each verse shown and the word in bold" width="420">
</p>

You see:

- **how many times** the word occurs, and in how many verses;
- the results **grouped by book**, in Bible order;
- each verse in full, with the word in **bold**.

Click a verse to open it in the Bible.

> [!NOTE]
> The concordance finds words **exactly as this Bible writes them**. In the
> World English Bible, Jesus says "remain in me", so searching for `abide`
> finds nothing there, while `remain` finds 92 places. Switch translation at
> the top of the pane to search another Bible.

## From a word study

In a **Word study**, the button **Find occurrences** opens the concordance for
the study's word, in the Bible chosen for that study. When that Bible is
annotated, the study's information also has a **Lexical number** and a
**Find this lemma** button, which looks up exactly that number (or the word,
if no number is given). For a Bible without annotations it says that lemma
search is not available there.

## Greek and Hebrew Bibles

If you add a Greek or Hebrew Bible, the concordance makes searching easier:

| Bible | You can type… |
|---|---|
| **Greek** | without accents and breathings: `λογος` finds λόγος |
| **Hebrew** | without vowel points: `דבר` finds the word however it is pointed |
| **English, German and other languages** | the word as it is spelled. Capital letters don't matter, accents do (`Röm` and `Rom` are different). |

> [!NOTE]
> **Word** and **Phrase** look for words **as written**. To find every form of
> a word together (for example *λόγος* and *λόγῳ*), use **Lemma** with a Bible
> whose edition marks each word with its dictionary form (below).

## Searching by lemma (annotated Bibles)

Some Bible editions — usually Hebrew and Greek ones for study — mark every
word with its **lemma** (dictionary form), a **lexical number** (such as
Strong's *H1254*) and a **grammar code**. When you add such a Bible, the
review screen says so ("Word annotations: …"). Abiding Word then offers a
third choice in the concordance, **Lemma**. It appears only for Bibles that
have these annotations.

1. Choose **Lemma**, type a lemma (accents and vowel points don't matter) or
   a lexical number, and click **Find**.
2. If the same dictionary form stands for **different words** (they have
   different lexical numbers), you are shown each one with how often it
   occurs and how it is written. Choose one.
3. You see how often it occurs, in how many verses, every **written form**,
   and the verses by book with each occurrence marked.
4. Open **Grammar** to see the grammar codes of these occurrences, with
   counts. Tick one or more to see only those words; **Show all forms** undoes
   it.

<p align="center">
  <img src="../images/original-language-v0.21/v021-lemma-grammar-en-light-1280.png" alt="Lemma search: one entry's four occurrences, its written forms, grammar codes described in words, and the verses with each occurrence highlighted" width="760">
</p>

> [!IMPORTANT]
> Everything here comes from **the Bible's own annotations**. Abiding Word
> looks nothing up elsewhere and invents nothing. Grammar codes are described
> in words ("verb · qal · perfect · 3rd person…") only when the **edition
> itself says** which scheme it uses, or when **you chose** that scheme when
> adding the Bible (Abiding Word checks that the codes fit it). Otherwise they
> are shown **as written**, because a wrong description would be worse than
> none. Abiding Word can describe three documented schemes: the Open
> Scriptures Hebrew Bible's Hebrew and Aramaic codes, Robinson's Greek parsing
> codes, and MorphGNT's.

## Searching by lexical number (Strong's-only Bibles)

Some Bibles give each word only a **lexical number**, such as Strong's
*G3056* or *H430*, and no dictionary form. These include several of the
Bibles that come with Abiding Word. Such a Bible gets a number search only if
you ask for it — when adding the Bible (tick **Add a search by lexical
number**), or later in **Settings → Bible texts → Details → Word
information**. It takes some space (the review screen says about how much).

Then the third choice in the concordance is called **Lexical number**. Type
a number in any usual spelling — *G3056*, *g3056* and *3056* find the same
number, as do *H430* and *H0430*, or *1254a* and *1254 a* — and click
**Find**. If one number belongs to several entries (the Open Scriptures
Hebrew Bible writes prefixes such as *c/430*), you can also choose **All
words with lexical number …**.

<p align="center">
  <img src="../images/original-language-v0.22/v022-number-search-en-light-1280.png" alt="Lexical number search: g3056 typed, the heading Lexical number G3056, three occurrences in three verses with their written forms, each occurrence highlighted" width="760">
</p>

> [!NOTE]
> A lexical number points to an entry in a numbered lexicon. It is **not a
> definition**, and two words with the same number are not proven to mean the
> same thing. Two Bibles may also number the same word differently, so
> numbers are always searched within one Bible.

## Hebrew and Greek editions you can add

Abiding Word includes no Hebrew or Greek edition with word information, and
downloads nothing by itself. **Add a Bible → Hebrew and Greek editions for
original-language research** lists free editions with links to their
publishers' pages:

| Edition | Written word | Dictionary form | Grammar | Lexical number | How to add |
|---|---|---|---|---|---|
| Open Scriptures Hebrew Bible (Hebrew OT) | ✓ | — | ✓ described | ✓ | the `.xml` files of its `wlc` folder, with `VerseMap.xml` |
| Westminster Leningrad Codex, eBible.org (Hebrew OT) | ✓ | — | few words | ✓ | the USFM `.zip`, with OSHB's `VerseMap.xml` |
| MorphGNT: SBL Greek NT | ✓ | ✓ | ✓ described | — | the `.txt` files (one per book) |
| Robinson–Pierpont Byzantine NT, eBible.org | ✓ | — | ✓ (Robinson; your choice) | ✓ | the USFM `.zip` |
| SBL Greek NT, eBible.org | ✓ | — | — | ✓ | the USFM `.zip` |

<p align="center">
  <img src="../images/original-language-v0.22/v022-import-grammar-choice-en-light-1280.png" alt="The review of a new Bible: under Original-language research, the written word, dictionary form, grammar and lexical number counts, and an unticked choice to describe the grammar codes as Robinson's Greek parsing codes" width="760">
</p>

Hebrew Bibles number some verses differently (Joel has four chapters, many
Psalm titles are verse 1). Choose the edition's **verse map** together with
its files and the verses are renumbered to the usual English numbering; the
review screen tells you how many. Without it, Abiding Word explains what to
add instead of guessing. Check each edition's licence on its page before
sharing anything made from it.

## Word details in the Bible

In an annotated Bible, select one or more words. Next to **Add note** and
**Highlight** you'll see **Word details** (only when the words you selected
are annotated). It shows, for each word, its lemma and lexical number, its
grammar, and how often that entry occurs in this Bible. From there:

- **Find this lemma** opens the concordance on it;
- **Study this word** puts it into the Word Study that is open (if that study
  already studies another word, you are asked first).

<p align="center">
  <img src="../images/original-language-v0.21/v021-word-details-en-light-1280.png" alt="Word details for a selected Hebrew word: its lemma, lexical number, grammar in words with the code, how often it occurs, and the buttons Find this lemma and Study this word" width="760">
</p>

---

[← Bible references in your books](06-bible-references.md) · [Contents](README.md) · Next: [Settings, updates and backups →](08-settings-updates-backups.md)
