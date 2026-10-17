# ⚙️ 8. Settings, updates and backups

[← Concordance](07-concordance.md) · [Contents](README.md) · Next: [Questions and word list →](09-questions-and-word-list.md)

---

Click the **gear** ⚙️ at the top right to open **Settings**. **Back to
workspace** stays at the top while you scroll (or press **Escape**).

<p align="center">
  <img src="images/settings.png" alt="Settings: a short list of sections, each one line with where it stands, and a jump list at the top" width="900">
</p>

Settings is a short list. Each section is **one line**: its name and where
things stand (for example *Updates · Up to date* or *AI Assistant · Off*). Click
a line, or press **Enter** or **Space** on it, to open or close that section;
the others stay as they are. The row of names at the top jumps straight to a
section and opens it. Abiding Word remembers which sections you left open.

The sections, in order: **Updates**, **Appearance**, **Bible texts**,
**Templates**, **Language**, **AI Assistant**, **About this installation**
and **Coming in later versions**.

> [!TIP]
> Explanations wait behind a small **?** beside a setting, so Settings stays
> short. Point at it, click or tap it, or press **Enter** on it to read the
> explanation; press **Escape** or click elsewhere to close it. What you must
> know right away (a missing key, a failed check, an update) is always shown
> directly.

**Adding a Bible** and **editing a template** open over Settings: Settings
stays behind, exactly as you left it. Close them with **Cancel**/**Back** or
**Escape**.

## Updates

<p align="center">
  <img src="images/updates.png" alt="Updates opened: installed version, Development / test channel, one 'Check for updates' button and a short note" width="660">
</p>

Opened, it shows only the **installed version**, the **update channel**, one
**Check for updates** button and a one-line note.

Normally Updates is a single line: *Up to date*, or your version. It opens by
itself only when there is something to do: an update is available, it is
being installed, or something went wrong.

Every now and then, Abiding Word quietly checks whether a newer test version
exists. If there is one, a slim notice appears under the app bar:

> *An update is available: version …* **Update now** · **Later**

- **Update now** downloads it. The installer closes Abiding Word, installs
  the new version and starts it again.
- **Later** hides the notice for that version.
- **Settings → Updates → Check for updates** looks straight away.

> [!NOTE]
> Abiding Word **never needs the internet** to work. Without a connection,
> there is simply no update notice. Updates don't touch your studies or
> library.

## Appearance

<p align="center">
  <img src="images/appearance.png" alt="Appearance: Theme Light, Dark or Match my computer; six background swatches (Parchment, Cream, Sage, Stone, Mist, Neutral); Reset layout" width="560">
</p>

- **Theme:** *Light*, *Dark*, or *Match my computer* (follows your Windows
  setting).
- **Background:** six calm, low-glare backgrounds for long reading and
  writing (*Parchment*, *Cream*, *Sage*, *Stone*, *Mist*, *Neutral*). Text
  stays easy to read on each. They apply to the light theme, and the choice
  is remembered on this computer.

<p align="center">
  <img src="images/workspace-dark.png" alt="The workspace in the dark theme" width="900">
</p>

**Workspace layout → Reset layout** puts the three panes back in their usual
order and size. Your studies and library are not touched.

## Bible texts

<p align="center">
  <img src="images/bible-texts.png" alt="Bible texts opened: the World English Bible with Details and Remove buttons, and 'Add a Bible…'" width="660">
</p>

- **Add a Bible…** adds one of the free Bibles included with Abiding Word
  (English, German, Korean, French, Spanish, Portuguese) or a Bible file you own (see
  [Getting started](01-getting-started.md#add-a-bible)).
- **Details** shows a Bible's publisher, licence and contents.
- **Remove…** removes a Bible. Your notes and highlights are kept with their
  verses.

## Templates

A template is a reusable **starting structure**. Settings shows two kinds:

- **Bible Study** templates: the parts a new study starts with (a passage
  study: *Text, Observations, Context, Meaning, Theology, Application*). The
  built-in ones can't be changed, but you can **duplicate and customise** one:
  rename parts, add hints, change the order, remove parts, and tick
  **Add later** for a part you want offered under *Add a part* rather than
  made at once.
- **Bible Teaching** formats: what each kind of teaching gives you to work in
  (main points for a sermon, questions for a group study, steps for a lesson)
  and the steps a lesson starts with.

Changing a template never changes a study already made from it.

## Language

Choose the language of menus and buttons: **English, Deutsch, 한국어,
Français, Español or Português**. The change is immediate. Your studies,
notes and Bibles stay exactly as they are.

<p align="center">
  <img src="images/german-ui.png" alt="Abiding Word with German menus and buttons" width="900">
</p>

## AI Assistant

The AI Assistant (artificial intelligence) helps when you
[prepare to teach](10-teaching.md). It is **off** until you tick **Use the AI
Assistant**; until then this section only says *Turn on the AI Assistant to
choose a service and check the connection.*

<p align="center">
  <img src="images/settings-assistant.png" alt="AI Assistant opened: Use the AI Assistant, Service, Key with 'How do I get a key?' opened as numbered steps, Model with a link to the current models, Check the connection, Advanced, and the optional extras" width="560">
</p>

Once it is on, set it up from top to bottom:

1. **Service.** Choose one.
   - *On the internet:* Anthropic (Claude), DeepSeek, Google Gemini,
     OpenAI (ChatGPT), Perplexity, Qwen (Alibaba Cloud) or xAI (Grok). Your
     text is sent to that company when you ask, and you need a **key** from
     it.
   - *On this computer:* **Ollama** or **LM Studio**. Free programs that run
     an AI model on your own computer: no key, no account, and your text never
     leaves the computer. **How do I set up …?** explains it and opens the
     program's website.
   - *Other compatible service:* for anything else that works the same way.
     Enter the address its instructions give.
2. **Key** (services on the internet). Never heard of one? Open **How do I
   get a key?** It walks you through it: open the company's page (a button
   opens their official page), sign in or create an account, create a key
   (it may be called an *API key*), copy it, come back, paste it into **Key**,
   press **Keep key**, then **Check the connection**. Most services charge a
   little for what you use and may ask for payment details or prepaid credit
   first; that is arranged on their website. The key is kept in your
   computer's own password store (on Windows: the *Credential Manager*), never
   in your studies, and is not shown again.
3. **Model.** A suggested model is filled in (*Suggested model. You can
   change it.*). Model names change often: the **↗** button beside the field
   opens the company's own, current list of models. For Ollama and LM Studio
   it opens their list of models to download. For another compatible service
   there is no such list.
4. **Check the connection.** If it cannot be used yet, the reason is written
   beside it, for example *first paste your key and choose Keep key*. When it
   works: *Connected. The assistant answered and is ready.*

**Advanced** holds the service's address. You need it only for a different
server, or for Ollama or LM Studio running on another computer.

**Optional extras**

- **Look up real stories.** The AI Assistant can suggest ideas, but it may
  remember real events incorrectly. A search service finds web pages about a
  story; Abiding Word shows them with their links so you can read them. A
  search service only *finds* pages: it does not decide what is true.
  - **Recommended:** **Brave Search** (simple general web search),
    **Tavily** (search designed for AI assistants) and **Exa** (finds
    relevant sources and passages). Each needs an account and a key; **How do
    I set up …?** gives the steps and opens the service's own page. Most offer
    a small free allowance each month and charge for more.
  - **Other (advanced):** **SearXNG** (a search program some people run on
    their own server; you need its address) and **SerpApi** (Google results,
    a paid service).
  - **Check search** asks the service one test question and says whether it
    answered. Each service keeps its own key, so switching keeps the others.
- **Images.**
  - **Find freely licensed images** on Wikimedia Commons (only search words
    are sent). This always works, whatever service you use.
  - **Allow making images** asks an AI image service to draw a picture,
    always marked as made by the assistant. Not every AI service can: the
    line below says whether yours *can*, *cannot*, or whether Abiding Word
    *cannot tell* (another compatible service: you can try). With
    **Make images with → OpenAI** you can keep writing with another service
    (for example Claude) and make images with OpenAI, using an OpenAI key
    kept for images; until that key is kept, Settings says so. Image
    descriptions then go to OpenAI over the internet, even when you write
    with Ollama or LM Studio.
- **How should the AI approach theological questions?** (optional). Open
  the **?** for what it is for: not your life story, only a short theological
  or church perspective if it helps (e.g. *Reformed evangelical*). The
  examples fill it in with one click. The AI uses it on disputed theological
  questions and still mentions other serious interpretations; left blank, no
  tradition is assumed.

Click **Save** for the extras. (Turning the assistant on or off, choosing a
service, keeping a key and checking the connection save by themselves.)

## About this installation

This shows the version and the **folder where your work is kept**. You need
it for backups.

## Backups

Your studies, notes, library and Bibles all live in **one folder**:

```
C:\Users\<your name>\AppData\Roaming\Abiding Word
```

**To make a backup:**

1. **Close Abiding Word.**
2. Copy the whole **Abiding Word** folder to a USB stick, an external drive
   or a cloud folder of your choice.

**To restore it**, close Abiding Word and copy the folder back to the same
place.

> [!TIP]
> Abiding Word also protects you automatically. Before an update changes how
> your data is stored, it saves a copy in the folder's **backups** subfolder.
> If anything goes wrong, nothing is changed and you are told in plain words.

> [!TIP]
> To find the folder quickly, press **Windows key + R**, type `%APPDATA%`,
> press **Enter** and open **Abiding Word**.

---

[← Concordance](07-concordance.md) · [Contents](README.md) · Next: [Questions and word list →](09-questions-and-word-list.md)
