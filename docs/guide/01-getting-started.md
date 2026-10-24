# 🚀 1. Getting started

[← Contents](README.md) · Next: [Reading the Bible →](02-reading-the-bible.md)

---

## Install Abiding Word

Abiding Word is currently available as a **test version for Windows**.

1. Open the [download page](https://github.com/jc-universe87/abidingword-updates/releases)
   and choose the newest test version at the top.
2. Download the file whose name ends in **`_x64-setup.exe`**, for example
   `Abiding-Word_0.5.0-dev.26_x64-setup.exe`.
3. Open the downloaded file and follow the installer.

> [!IMPORTANT]
> Windows may show a blue box saying *"Windows protected your PC"*. This
> appears because the test version is new and not yet widely known to
> Windows. Click **More info**, then **Run anyway**.

After that you never need to download it again. Abiding Word tells you when a
newer test version is ready (see [Updates](08-settings-updates-backups.md#updates)).

<details>
<summary><strong>Linux and macOS</strong></summary>

Test builds for Linux exist for testers. macOS has not been tested yet.
Windows is the main system for now.

</details>

## The first time you open it

When you start Abiding Word for the first time, it looks like this:

<p align="center">
  <img src="images/first-start.png" alt="The empty workspace on first start, with an 'Add a Bible…' button on the left" width="900">
</p>

The left side says **"No Bible has been added yet."** That is the first
thing to fix.

## Add a Bible

1. Click **Add a Bible…** on the left.
2. Under *Included with Abiding Word*, open the **Choose a Bible** list and
   pick one. The list is grouped by language, and Bibles in the language you
   use Abiding Word in come first.
3. Click **Add…**.

<p align="center">
  <img src="images/add-bible.png" alt="The 'Add a Bible' screen with the 'Choose a Bible' list showing the Berean Standard Bible, an Add button, and an option to choose your own Bible files" width="760">
</p>

4. A small window asks you to confirm, showing the Bible's language and
   licence. Click **Continue** (or **Cancel** if you picked the wrong one).

<p align="center">
  <img src="images/add-bible-confirm.png" alt="The confirmation window: 'Add Berean Standard Bible?' with its language, licence, Cancel and Continue" width="760">
</p>

5. Abiding Word checks every book, chapter and verse and shows what it found.
   Click **Add this Bible** to finish.

These Bibles come with Abiding Word. All of them are free for everyone to use:

| Bible | Language | Licence |
|---|---|---|
| **Berean Standard Bible** (BSB) | English | Public domain |
| **World English Bible** (WEB) | English | Public domain |
| **Lutherbibel 1912** | Deutsch | Public domain |
| **Schlachter-Bibel 1951** | Deutsch | Creative Commons (free, with credit to the Genfer Bibelgesellschaft) |
| **Elberfelder 1905** (unrevised) | Deutsch | Public domain |
| **성경전서 개역한글판** (KRV, 1961) | 한국어 | Copyright expired; free to use (Korean Bible Society) |
| **Louis Segond 1910** | Français | Public domain |
| **Reina-Valera 1909** | Español | Public domain |
| **Bíblia Livre** | Português | Creative Commons (free, with credit to its translators) |

You can add as many as you like and switch between them at any time.

> [!TIP]
> **Have another Bible?** If you have a Bible file of your own (in the common
> "USFM" format, often a `.zip` download — or, for Hebrew and Greek study, the
> Open Scriptures Hebrew Bible's files or MorphGNT's), click **Choose Bible
> files…**.
> Abiding Word checks every book, chapter and verse, explains anything unusual
> in plain words, and only then adds it. Your original file is never changed.
>
> Choose the Bible's **Language** there too. If the files say which language
> they are in (some downloads include a small information file), it is filled
> in for you; otherwise pick it from the list, or choose *Another language…*
> and type its name. Abiding Word never guesses it from the file's name. The
> language helps it read abbreviations you type, such as *Jn 3:5*, the way
> this Bible means them; you can change it later in Settings.
>
> If the Bible's edition marks its words with **dictionary forms, lexical
> numbers or grammar** (common in Hebrew and Greek study editions), the review
> shows it under **Original-language research**: what each word has, how many
> could not be read, and the two choices that are yours — a search by lexical
> number when that is all the edition gives, and describing grammar codes with
> a scheme they fit when the edition does not name it. Both are unticked until
> you tick them. They are then used for
> [lemma and number search](07-concordance.md#searching-by-lemma-annotated-bibles).
> If the markup cannot be read reliably, nothing of it is added, and the text
> of the Bible is never affected. A Bible added earlier can gain its word
> information later, without being added again: **Settings → Bible texts →
> Details → Word information**.

### A Bible in a PDF, EPUB or Word document

**Choose Bible files…** also takes a Bible you have as an ordinary document:
**PDF**, **EPUB**, **Word** (`.docx`), **Markdown** (`.md`) or **text**
(`.txt`). A Bible in several files (one per book, for example) can be chosen
all at once, as long as they are all of the same kind; they are read in the
order of their names (`2-Exodus` before `10-Joshua`).

Before anything is added, Abiding Word reads the document and tells you what
it found, in plain words:

- what kind of document it is and how many pages or chapters it has, and
  whether its text can be read (a PDF of **scanned pages** has none);
- how many **books, chapters and verses** it could recognise, and where it
  was unsure — a heading that names no book, a chapter with a verse missing,
  two places where the same verse could begin;
- what it **left out** because it belongs to no verse (an introduction,
  footnotes, page numbers and headers repeated on every page).

Then you choose how to add it:

- **By book, chapter and verse** — offered only when the verses were
  recognised without problems. The Bible is then read like any other: go to
  a passage, search, use the concordance, compare. Each verse remembers where
  in the document it came from.
- **As a document to read** — always possible. You read it as it is (the PDF
  page by page, the EPUB or Word document with its formatting), search its
  text and keep your place, but it has no verse navigation. You can ask it to
  **Look for verses…** later, without adding it again.

If a heading names no book (for example *The Book of Praises*), pick the book
from the list next to it and the document is read again with your choice.
Abiding Word never takes a book from a file's name or a table of contents,
and it never moves or makes up verse text: anything it is unsure of is shown
to you, not guessed.

Name, short name, language and licence can be changed before you add it.
**Cancel** adds nothing. Your file is copied into Abiding Word's own folder
and never changed; nothing leaves your computer. Scanned pages are not turned
into text (there is no OCR): such a Bible can be read page by page only.

## A tour of the screen

Once a Bible is added, the screen has three side-by-side areas, called
**panes**:

<p align="center">
  <img src="images/workspace.png" alt="The three panes: Scripture on the left, Study in the middle, Sources on the right" width="900">
</p>

| Pane | Where | What it is for |
|---|---|---|
| **Scripture** | left | Reading the Bible, your highlights and notes, and the concordance |
| **Study** | middle | Your studies: what you write, observe and conclude |
| **Sources** | right | Your own books and notes that talk about the passage you are reading |

Along the top is the **app bar**:

| In the app bar | What it does |
|---|---|
| **Search** box (with *Scripture / Studies / Library* menu) | Searches the Bible, your studies or your library |
| The two **pane buttons** | Show or hide the Scripture pane and the Sources pane |
| The **gear** ⚙️ | Opens Settings |

> [!TIP]
> **Make room the way you like.**
> - Drag the edge between two panes to make one wider.
> - Use the small **‹ ›** arrows in a pane's header to move that pane left or right.
> - Changed your mind? *Settings → Workspace layout → Reset layout* puts
>   everything back. Your studies are not affected.

## Your first study in one minute

1. In the middle pane, type a passage under **What would you like to study?**,
   for example `John 15:1-11`.
2. Keep **Passage study** selected and click **Create study**.
3. The Bible on the left opens at your passage, and your new study is ready to
   write in.

Read more in [Studies](04-studies.md).

## Where your work is kept

Everything is saved **automatically** as you type, on your own computer, in
one folder:

```
C:\Users\<your name>\AppData\Roaming\Abiding Word
```

You can see the exact folder in **Settings**. To keep a copy safe, see
[Backups](08-settings-updates-backups.md#backups).

---

[← Contents](README.md) · Next: [Reading the Bible →](02-reading-the-bible.md)
