# En route B1

A personal French course from solid A1 to B1 in a year, built like Babbel but with more ways to make vocabulary and grammar stick. It also prepares you for the civic exam (examen civique) required for the carte de résident.

**Live app:** https://marcojhb.github.io/en-route-b1/ (installable on phone and laptop, works offline)

## What a day looks like (45–60 min)

| Block | What it does |
|---|---|
| **Review** | Spaced-repetition queue: French→English, English→French (typed, accent-aware) and grammar gap-fills from every lesson you've done |
| **Lesson** | New words in small groups, a grammar note, then dialogues, listening, gap-fills, sentence building and translation. Mistakes come back before the end. |
| **Practice** | Rotates by weekday: grammar drills, dictation, speaking (mic + speech recognition), graded reading with tap-to-translate, and writing with a model answer |
| **Civics** | 5 questions a day from a practice bank, readings woven into each unit, and timed 40-question mock exams |

## Course plan

48 weekly units across 12 months (see `content/course.json`). Units 1–4 (month 1) are written. The rest of the roadmap is listed in the app and gets filled in unit by unit.

## Sync between phone and laptop

Progress is saved in your browser and, optionally, in a **private Gist** on your GitHub account. In the app, open Settings, then *Sync between devices*, and paste a fine-grained token that has **only** the *Gists: read and write* permission. Do the same on each device. The token stays in that browser's storage and is never committed to this repo.

## Natural voices

The app uses recorded neural voices when they exist and falls back to the device's French voice otherwise. To generate the recordings (free, about 600 short files):

```bash
pip install edge-tts
python scripts/generate_audio.py
git add content/audio && git commit -m "Add audio" && git push
```

Run it again whenever new units are added. Only new sentences get generated.

## Structure

```
index.html, css/, js/          app (no build step, plain ES modules)
content/course.json            48-week roadmap
content/units/uNN.json         one unit: vocab, grammar, lessons, drills, dictation, speaking, reading, civics, writing
content/civics.json            civic exam practice bank
content/audio/                 generated MP3s + index.json
scripts/generate_audio.py      audio generator
sw.js, manifest.webmanifest    offline + install
```

## Adding a unit

Copy an existing `content/units/uNN.json`, change the content, and set `"unit": "uNN"` on that week in `course.json`. Lesson step types: `choice`, `listen`, `type`, `cloze`, `order`, `dialogue`, `note`. Cloze and type drills become review cards automatically when their lesson (`"l"`) is completed.

The civics bank is a study aid written for this app, not the official question list. Check [formation-civique.interieur.gouv.fr](https://formation-civique.interieur.gouv.fr/) and your préfecture for current requirements.
