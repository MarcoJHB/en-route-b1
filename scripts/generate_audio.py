#!/usr/bin/env python3
"""Generate natural French audio for every sentence in the course.

Uses Microsoft Edge neural voices through the free `edge-tts` package.
Run it from the repo root on your own computer, then commit content/audio/:

    pip install edge-tts
    python scripts/generate_audio.py            # only new sentences
    python scripts/generate_audio.py --force    # regenerate everything

The app falls back to the device's French voice for anything not generated.
"""
import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("Install the voice package first:  pip install edge-tts")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
AUDIO = CONTENT / "audio"
VOICES = {"f": "fr-FR-DeniseNeural", "m": "fr-FR-HenriNeural"}
CONCURRENCY = 6


def key(text: str) -> str:
    """Must match audioKey() in js/speech.js."""
    return re.sub(r"\s+", " ", text.replace("’", "'").replace("‘", "'")).strip()


def sentences(text: str):
    """Must match the sentence split used by the reading player in js/app.js."""
    flat = text.replace("\n", " ")
    return [s.strip() for s in re.findall(r"[^.!?]+[.!?»]*", flat) if s.strip()]


def collect():
    """Returns {text: set(voices)}."""
    want: dict[str, set] = {}

    def add(t, v="f"):
        if t and t.strip():
            want.setdefault(t.strip(), set()).add(v)

    course = json.loads((CONTENT / "course.json").read_text("utf-8"))
    for month in course["months"]:
        for w in month["weeks"]:
            if not w.get("unit"):
                continue
            u = json.loads((CONTENT / "units" / f"{w['unit']}.json").read_text("utf-8"))
            for v in u["vocab"]:
                add(v["fr"]); add(v.get("ex"))
            for g in u["grammar"]:
                for fr, _ in g.get("examples", []):
                    add(fr)
            for lesson in u["lessons"]:
                for s in lesson["steps"]:
                    if s["t"] in ("listen", "order"):
                        add(s["fr"])
                    if s["t"] == "dialogue":
                        for i, (_, fr, _) in enumerate(s["lines"]):
                            add(fr, "m" if i % 2 else "f")
                    if s["t"] == "cloze":
                        add(s.get("full") or s["q"].replace("___", s["a"][0]))
            for d in u["drills"]:
                if d["t"] == "order":
                    add(d["fr"])
                if d["t"] == "cloze":
                    add(d.get("full") or d["q"].replace("___", d["a"][0]))
                if d["t"] == "type":
                    add(d["a"][0])
            for d in u["dictation"]:
                add(d["fr"])
            for s in u["speaking"]:
                add(s.get("fr")); add(s.get("q")); add(s.get("sample"))
            for r in (u["reading"], u["civicsReading"]):
                for s in sentences(r["text"]):
                    add(s)
            add(u["writing"]["model"])
    add("Je voudrais une baguette, s’il vous plaît.")
    return want


async def synth(text, voice, path, sem):
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, VOICES[voice], rate="-5%").save(str(path))
                return True
            except Exception as e:  # network hiccups
                if attempt == 2:
                    print(f"  ! failed: {text[:50]}… ({e})")
                    return False
                await asyncio.sleep(2)


async def main(force: bool):
    AUDIO.mkdir(parents=True, exist_ok=True)
    index_path = AUDIO / "index.json"
    index = json.loads(index_path.read_text("utf-8")) if index_path.exists() and not force else {}
    want = collect()
    sem = asyncio.Semaphore(CONCURRENCY)
    jobs = []
    for text, voices in want.items():
        k = key(text)
        h = hashlib.sha1(k.encode("utf-8")).hexdigest()[:12]
        entry = index.get(k, {})
        for v in voices:
            name = f"{h}-{v}.mp3"
            if force or not (AUDIO / name).exists():
                jobs.append((text, v, AUDIO / name, k, name))
            else:
                entry[v] = name
        index[k] = entry
    print(f"{len(want)} sentences, {len(jobs)} files to generate…")
    done = 0
    async def run(job):
        nonlocal done
        text, v, path, k, name = job
        if await synth(text, v, path, sem):
            index[k][v] = name
        done += 1
        if done % 25 == 0 or done == len(jobs):
            print(f"  {done}/{len(jobs)}")
    await asyncio.gather(*(run(j) for j in jobs))
    index = {k: v for k, v in index.items() if v}
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=0), "utf-8")
    print(f"Done. {len(index)} sentences have audio. Commit content/audio/ and push.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--force", action="store_true", help="regenerate all audio")
    asyncio.run(main(p.parse_args().force))
