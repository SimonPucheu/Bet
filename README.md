# Oddsroom

A community prediction-market website. Members create yes/no or multiple-choice markets, place virtual-credit picks, and settle outcomes after the market closes.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on port 3001, and market and account data is shared through the server's SQLite database at `data/oddsroom.sqlite`. People on the same network can use the Vite network URL printed in the terminal while the server is running.

Account creation is invite-only. On a fresh database, the server prints a one-time bootstrap invite code for the first member. Signed-in members can create and copy additional one-use invite links from the **Invite** button.

For a production build, run `npm run build` followed by `npm start`. The Express server serves the built site on port 3001. Set `PORT` to change the server port, or `DB_PATH` to choose a different SQLite file.

## Credit rules

- New accounts receive 1,000 virtual credits.
- Each account requires its own unused invitation code.
- A member, including the market creator, may place one whole-number stake per market, up to their available balance.
- Each outcome shows live decimal odds derived from the number of picks: `(total picks + number of outcomes) / (picks on outcome + 1)`. The one-pick prior keeps odds defined when a market is empty.
- Odds are captured when a pick is placed, so later picks cannot change its payout. The stake is deducted immediately; a winning pick returns `stake × locked odds` in whole credits, rounded down. Losing stakes are not returned.
- Anyone signed in can select the result after the market expiration. The first successful resolution settles the market and pays winners.
- Credits have no cash value and cannot be deposited or withdrawn.

This is a single-server prototype, not a hardened public-money betting service. Public deployment should add rate limiting and an outcome-dispute process, and should use HTTPS with production cookies enabled.

## Checks

```sh
npm test
npm run build
npm audit
```