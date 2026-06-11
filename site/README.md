# JDF Landing Page

Single-file static site for [JDF](https://github.com/uurtech/jdf).

## Structure

```
site/
├── index.html      # Single-page landing
├── style.css       # Styling (light/dark mode auto)
├── favicon.svg     # Inline JDF logo
├── CNAME           # Custom domain (jdf.uurtech.com)
└── .nojekyll       # GitHub Pages disable Jekyll
```

No build step. No framework. No JavaScript dependency. Just HTML + CSS + a tiny inline `<script>` for the copy-to-clipboard button.

## Local preview

```bash
cd site
python3 -m http.server 4000
# open http://localhost:4000
```

Or any static server (`npx serve`, `caddy file-server`, etc.).

## Deploy via GitHub Pages

The `.github/workflows/pages.yml` workflow auto-deploys this folder on every push to `master`. Pages is served from:

- Repo: `uurtech/jdf`
- Source: `site/` (deployed from GitHub Actions, not from a branch)
- Custom domain: `jdf.uurtech.com` (via the `CNAME` file)

After the first deploy, configure DNS at `uurtech.com`:

```
CNAME  jdf  uurtech.github.io.
```

GitHub Pages will issue a TLS certificate automatically once DNS resolves.

## Author

[Ugur Kazdal](https://uurtech.com) · [@uurtech](https://github.com/uurtech)
