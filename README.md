# Songster

A browser-based music quiz game powered by Spotify. Pick any playlist, listen to a random track, and guess the song — year, artist, title, or whatever your group agrees on. Play solo or compete in teams with a coin-staking system.

## Features

- **Any Spotify playlist** — browse your own library, search public playlists, or paste a Spotify URL
- **Instant playback** — streams directly via the Spotify Web Playback SDK, no extra app needed
- **Guess & Reveal** — make your guess, then reveal artist, title, and release year
- **Team play with coins** — stake coins on each answer; nail it and multiply your stake, miss it and lose them
- **No backend** — runs entirely in the browser as a static page; no server, no database

## Getting started

Songster uses the [Spotify Web API](https://developer.spotify.com/documentation/web-api) and requires a Spotify Premium account for playback.

### 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Add the following redirect URI to your app's settings:
   ```
   https://thorsten-klein.github.io/universal-callback/index.html
   ```
4. Copy your **Client ID**

### 2. Run the app

Open `index.html` directly in a browser (works via `file://`, GitHub Pages, or any static host). Enter your Client ID on the login screen and connect your Spotify account.

No build step, no dependencies to install.

## Project structure

```
index.html        # Single-page app shell and all SVG/HTML templates
src/
  util.js         # Shared constants and DOM helpers
  auth.js         # Spotify PKCE OAuth flow
  spotify.js      # Web Playback SDK integration
  playlists.js    # Playlist browsing, search, and history
  quiz.js         # Quiz screen and game controls
  game.js         # Team/coin game logic
  app.js          # App bootstrap and screen routing
  styles.css      # All styles
```

## Tech

Plain HTML, CSS, and vanilla JavaScript — no framework, no bundler.

Authentication uses the [PKCE flow](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) via a universal callback page, so the same Client ID and redirect URI work regardless of where the app is hosted.

## License

MIT — see [LICENSE](LICENSE)
