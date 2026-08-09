# Project status site

GitHub Pages serves this directory. Update `status.js` whenever a feature ships or a roadmap milestone changes; the page layout normally does not need editing.

The deployment workflow publishes `docs/` after a push to `main`. In the GitHub repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once.

Preview locally from the repository root:

```sh
python3 -m http.server 8765
```

Then open `http://127.0.0.1:8765/docs/`.
