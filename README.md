# Golf Stats ⛳

A phone web app for logging golf stats hole by hole while you play. It's built around the **scoring zone** idea from Will Robins' *The Scoring Method*.

There's no account and no server. It works offline on the course, and your data stays on your phone.

## What it tracks (per hole)

| Area | What you enter | What it works out |
|---|---|---|
| Score | Strokes, putts | To par, score mix, par 3/4/5 averages |
| Tee shot | Fairway / Left / Right / Short | Fairways hit %, miss pattern |
| **Scoring zone** | In the zone (100 m by default) in regulation? Yes/No · shots from inside the zone to hole out | **SZIR %**, **Down in 3 %**, average shots in the zone, SZIR by par type, par-or-better rate with and without SZIR |
| Green | Where you missed (if you did), up & down made/missed, greenside bunker save | GIR % (worked out from score − putts), up & down %, sand save % |
| Putting | First-putt distance (optional) | Putts per 18, putts per GIR, 1-putts, 3-putts, make/3-putt rate by distance |
| Penalties | OB, water/hazard, other | Penalties per 18 |

**Regulation for the scoring zone** is par − 2 shots: 1 on a par 3, 2 on a par 4, 3 on a par 5. **Down in 3** means holing out in 3 shots or fewer once you're inside the zone. Do both and you make par or better.

The **Stats** tab compares your numbers with typical amateurs at a target handicap you choose. It shows your 3 biggest "focus areas" with a practice tip for each, plus a round-by-round trend chart.

## Put it on your phone (GitHub Pages, free)

1. Merge this branch into `main` on GitHub.
2. In the repo, open **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then pick `main` and `/ (root)`, and press **Save**.
3. After a minute your app is live at `https://<your-username>.github.io/golf-app/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share → **Add to Home Screen**
   - **Android (Chrome):** ⋮ → **Install app** / **Add to Home screen**

It then opens full-screen like a normal app and works with no signal.

## Your data

Rounds are saved in your phone's browser storage. Use **More → Export backup** now and then, and always before clearing browser data or changing phones. **Import backup** restores them. **Export CSV** gives you every hole in a spreadsheet.

## Files

- `index.html`, `styles.css`, `app.js`: the app (plain HTML/CSS/JS, no build step)
- `manifest.webmanifest`, `sw.js`, `icons/`: what makes it installable and offline-capable

Run locally with `python3 -m http.server` and open http://localhost:8000.
