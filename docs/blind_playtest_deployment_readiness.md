# The Quiet Vale Blind Playtest Deployment Readiness

This note prepares the prototype for online blind playtesting without publishing it yet.

## Recommended Route

Use GitHub Pages first.

- Default test URL after Pages is enabled: `https://sk47y9jwhh-maker.github.io/The_Quiet_Vale/`
- Preferred custom domain later: `www.thequietvale.com`
- DNS record later: `www` as a `CNAME` pointing to `sk47y9jwhh-maker.github.io`

Do not add a repository `CNAME` file until the custom domain is ready to go live.

## Before Publishing

- Run `npm run pages:check` locally and only publish if the checks pass.
- Confirm the repository visibility you are comfortable with.
- Confirm that all production-facing documents, card text, tile text, and rules data are safe to expose to blind playtesters.
- Decide whether the public playtest should use the full current card/tile text or a reduced playtest copy.
- Keep `robots.txt` and the page `noindex` meta tag in place for blind testing. These reduce search-engine discovery but are not security.
- Add the custom domain only after IP protection work is complete.

## GitHub Pages Setup

1. Push the current branch to GitHub.
2. In the repository, open Settings > Pages.
3. Set the source to deploy from the branch and root folder.
4. Wait for GitHub to publish the default Pages URL.
5. Test on the Android table browser before giving the URL to players.
6. When ready for the domain, set the Pages custom domain to `www.thequietvale.com`.
7. In the DNS provider, add `www` as a `CNAME` to `sk47y9jwhh-maker.github.io`.
8. After DNS settles, enable Enforce HTTPS.

## Blind Playtest Device Checklist

- Open the site in Chrome on the Android table.
- Use landscape orientation.
- Use browser full-screen/kiosk mode if available.
- Start a fresh game before players sit down.
- Confirm right-click/long-press menus work on the table hardware.
- Confirm scrolling is comfortable in the Stewards Board area.
- Keep one facilitator device available as a backup.

## Known Limits

- This is not online multiplayer.
- Game state is local to the browser/device.
- The prototype autosaves the current table locally in the browser; Reset Game starts a clean table and replaces the save.
- Clearing browser data, changing devices, or opening a different browser will not carry the local table across.
- `robots.txt` and `noindex` do not prevent someone with the link from opening the prototype.
