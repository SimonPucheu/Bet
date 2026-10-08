# NiggaBet

A community prediction-market website. Members create yes/no or multiple-choice markets, place virtual-credit picks, and settle outcomes after the market closes.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on port 3001, and market and account data is shared through the server's SQLite database at `data/oddsroom.sqlite`. People on the same network can use the Vite network URL printed in the terminal while the server is running.

Account creation is invite-only. On a fresh database, the server prints a bootstrap invite code, valid for 30 days, for the first member. Signed-in members can create reusable invite links valid for 1, 7, or 30 days from the **Invite** button. Existing invites receive a 30-day grace period when upgrading.

For a production build, run `npm run build` followed by `npm start`. The Express server serves the built site on port 3001. Set `PORT` to change the server port, or `DB_PATH` to choose a different SQLite file.

## Install the app

The site is an installable web app. Deploy it over HTTPS, open it in a supported browser, then use the browser's **Install app** or **Add to Home Screen** action. The app shell can open offline after its first successful load; account and market actions still require a connection to the server.

## Browser notifications

Signed-in users can opt in to browser push from **Alerts** and choose whether to receive notifications for new polls or polls they participated in being resolved. Preferences are off by default. Push requires HTTPS (except on localhost) and VAPID keys; without server configuration, the rest of the app works but push cannot be enabled.

Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in the Node service environment (for example, a `mailto:` address for the site administrator). Keep the private key secret and out of source control. Restart the server after setting these values.

## Credit rules

- New accounts receive 1,000 virtual credits.
- Each account requires an unexpired invitation code; a code can be reused until it expires.
- A member, including the market creator, may place one whole-number stake per market, up to their available balance.
- The market creator can edit the question, description, category, and expiration while the market is unresolved; answer choices stay fixed.
- The market creator can cancel an unresolved market; every caller is refunded their original stake and the cancelled poll and picks remain visible.
- Each outcome shows live decimal odds derived from the number of picks: `(total picks + number of outcomes) / (picks on outcome + 1)`. The one-pick prior keeps odds defined when a market is empty.
- Odds are captured when a pick is placed, so later picks cannot change its payout. The stake is deducted immediately; a winning pick returns `stake × locked odds` in whole credits, rounded down. Losing stakes are not returned.
- Anyone signed in can select the result at any time, including before market expiration. The first successful resolution settles the market and pays winners.
- Credits have no cash value and cannot be deposited or withdrawn.

This is a single-server prototype, not a hardened public-money betting service. Public deployment should add rate limiting and an outcome-dispute process, and should use HTTPS with production cookies enabled.

## Checks

```sh
npm test
npm run build
npm audit
```