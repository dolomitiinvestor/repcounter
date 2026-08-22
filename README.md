# Reps

A training log that lives on your phone. Log reps and weight per set, one day at a time, and see what you did last time before you load the bar.

No accounts, no backend, no dependencies. Three static files and a service worker.

---

## Put it online in 5 minutes

**1. Create the repo**

```bash
git init
git add .
git commit -m "Reps"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/reps.git
git push -u origin main
```

**2. Turn on GitHub Pages**

Repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main`, folder: `/ (root)` → **Save**.

A minute later it's live at `https://YOUR-USERNAME.github.io/reps/`.

Every path in this project is relative, so it works from a subpath like `/reps/` or from a custom domain without edits.

**3. Add it to your iPhone home screen**

Open that URL in **Safari** (not Chrome — only Safari can install to the home screen on iOS), tap **Share** → **Add to Home Screen** → **Add**.

It launches full screen with no browser chrome, and works with no signal once you've opened it once.

---

## Working on it locally

The service worker needs a real HTTP origin — opening `index.html` from the filesystem won't register it.

```bash
python3 -m http.server 8080
# then http://localhost:8080
```

To test on your phone while developing, use your machine's LAN IP (`http://192.168.x.x:8080`). Storage works; the service worker won't, since it requires HTTPS or localhost.

**After you change any file, bump the cache version in `sw.js`:**

```js
const CACHE = "reps-v3";   // was v2
```

Skip this and installed phones keep serving the old copy indefinitely.

---

## Files

| File | What's in it |
|---|---|
| `index.html` | Markup shell: header, tab bar, mount points |
| `app.js` | All logic — storage, date math, PRs, rendering |
| `styles.css` | All styling, design tokens at the top in `:root` |
| `sw.js` | Offline cache |
| `manifest.webmanifest` | Home-screen name, icons, standalone display |
| `icons/` | 192, 512, maskable, and the iOS 180px touch icon |

---

## Your data

Everything is in `localStorage` on the device, under one key: `reps:v1`. It never leaves the phone.

That means it's tied to that browser on that phone. It survives closing the app and restarting the phone. It does **not** survive clearing Safari website data, and it doesn't sync to other devices.

**Data** tab → **Export backup** writes a JSON file you can save to Files, iCloud Drive, or commit to this repo. **Import backup** reads it back. Do this before you switch phones.

The shape is plain and easy to script against:

```json
{
  "units": "lb",
  "lastType": "push",
  "dayTypes": {
    "2026-08-19": "push"
  },
  "days": {
    "2026-08-19": [
      {
        "id": "k3f9a2b",
        "name": "Bench press",
        "type": "push",
        "sets": [
          { "reps": 8, "weight": 135 },
          { "reps": 8, "weight": 135 },
          { "reps": 6, "weight": 145 }
        ]
      }
    ]
  }
}
```

---

## Using it

- **Log** — `‹ ›` steps between days. Each day is one **session**, tagged with a workout type (Push, Pull, Legs, Mix/Other, Cardio) via the chips at the top of the Log page — pick it once and every exercise you add that day belongs to it. **Add exercise** → type a name (it autocompletes from everything you've logged) — or tap one of the quick-add chips, which only show exercises you've previously logged under that session's type → set reps and weight with the ± buttons → **Log set**. Repeat for each set, then save. Each logged exercise shows its volume and estimated 1RM for that session right on the card.
- **Recall** — naming an exercise prefills the numbers from last time and shows that session below the field. Each set you log gets a delta against it: `+5 lb`, `+2 reps`, `same`.
- **History** — every exercise you've ever done, with heaviest set, best-ever estimated 1RM, a top-set trend line, and every past session by date — each with its own estimated 1RM. Filter the list by workout type with the chips at the top.
- **Data** — lb/kg, backups, and a full wipe.

Estimated 1RM uses Epley: `weight × (1 + reps ÷ 30)`, computed off the heaviest set in a session.

---

## Things you might want to change

- **Weight increment on the ± buttons** — `app.js`, in `paintPanel()`: `var step = db.units==="lb" ? 5 : 2.5;`
- **Colors and type** — `styles.css`, the `:root` block. The palette is IWF plate colors: blue is 20 kg, red is 25 kg, yellow is 15 kg.
- **Default reps/weight for a brand-new exercise** — `app.js`, in `openPanel()`.

---

MIT. Do what you like with it.
