# JDF Landing Page

Single-file static site for [JDF](https://github.com/uurtech/jdf), served from the `docs/` folder via GitHub Pages.

## Structure

```
docs/
├── index.html      # Single-page landing
├── style.css       # Styling (light/dark mode auto)
├── favicon.svg     # Inline JDF logo
├── _headers        # Caching / security headers (used by Cloudflare-style hosts)
└── .nojekyll       # Disable Jekyll on GitHub Pages
```

No build step, no framework, no JS dependency beyond a tiny inline `<script>` for the copy-to-clipboard button.

## Local preview

```bash
cd docs
python3 -m http.server 4000
# open http://localhost:4000
```

Any static file server works (`npx serve`, `caddy file-server`, etc.).

## Deploy

GitHub Pages serves directly from this folder.

**One-time setup**:
1. Repo → **Settings → Pages**
2. **Build and deployment → Source**: `Deploy from a branch`
3. **Branch**: `master`, **Folder**: `/docs`
4. Save

Every push to `master` that touches files under `docs/` is published automatically. The site lives at:

- `https://uurtech.github.io/jdf/`
- Or, if you set a custom domain in Pages settings (e.g. `jdf.uurtech.com`), at that domain after DNS propagates.

For a custom domain, add a `CNAME` file with the host (single line) into this folder, and at the DNS provider:

```
CNAME  jdf  uurtech.github.io.
```

GitHub issues a Let's Encrypt cert automatically once DNS resolves.

## Author

[Ugur Kazdal](https://uurtech.com) · [@uurtech](https://github.com/uurtech)
