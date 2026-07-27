# Envy marketing site

The public-facing site that lives at **envy.melodic.dev**, built on
[Melodic PHP](https://github.com/MelodicDevelopment/melodic-php). Visual identity
mirrors the desktop app's design tokens — same Fira fonts, same emerald "green
with envy" palette, same dark-card icon aesthetic.

MIT-licensed like the rest of the repo — see the top-level `LICENSE` file.

## Run locally

```bash
cd web
composer install
php -S localhost:8080 -t public public/index.php
```

Visit http://localhost:8080.

`composer install` writes `vendor/` (gitignored). The `melodicdev/framework`
package is pulled from Packagist.

## Run with Docker (dogfood it in Envy)

Build and run the site as a container so Envy can serve it locally over HTTPS:

```bash
# from web/
docker compose up --build -d
# → Envy lists "envy-web" at https://web.envy (hostname = Compose service name)
```

Or plain Docker (the dev image is `Dockerfile.dev` — the name keeps Railway's
auto-detection on Nixpacks; see the file header):

```bash
docker build -f Dockerfile.dev -t envy-web .
docker run --rm -p 8930:8080 --name envy-web envy-web
```

The container runs PHP's built-in server (same as Railway). OrbStack and native
Linux route the exposed port directly; the published `-p 8930:8080` also makes it
work on Docker Desktop, where container IPs aren't host-routable. The host port is
8930 (to dodge the common 8080 collision) — change the left side to any free port
if you like; Envy proxies to the container's internal 8080 (pinned via the
`envy.port` label in `docker-compose.yml`) regardless.

## File layout

```
config/                Base + per-env JSON config (config.dev.json gitignored)
public/                Web root — point Apache / Caddy / Railway here
  index.php            Single entry point
  .htaccess            Apache pretty-URL rewrites
  assets/              CSS, JS, images, favicons (served directly)
src/
  Controllers/         Home, Docs, Privacy, Terms (MvcController subclasses)
  Providers/           AppServiceProvider (wires the ViewEngine)
views/
  layouts/main.phtml   Shared header/footer + meta + theme-toggle script
  home/index.phtml     Landing page (hero, why, features, compare, open-source, FAQ, CTA)
  docs/index.phtml     Documentation (install, daemon, URLs, domains, certs, updates)
  privacy|terms/index.phtml
  partials/            Shared SVG glyphs (the Envy eye)
storage/               Logs + cache (gitignored)
railway.toml           Railway deploy config
nixpacks.toml          Build steps (PHP 8.2 + Composer)
```

## Configuration

All product-specific values live in `config/config.json`:

- `app.name`, `app.tagline`, `app.domain`
- `links.downloads.*` — GitHub Releases artifact URLs. Bumped automatically by
  `.github/workflows/update-website.yml` when a release is published.
- `links.github` — the repository URL (header/footer/CTA links).
- `links.support_email`

`config/config.pd.json` overrides for production (currently just `app.debug: false`,
selected by `APP_ENV=pd`).

## Deploy (Railway)

1. Create a new Railway project, connect it to the `MelodicDevelopment/envy`
   GitHub repo.
2. In the service settings, set **Root Directory** to `web/` so the build
   doesn't try to build the Electron app.
3. Railway picks up `railway.toml` + `nixpacks.toml` automatically. The
   default start command is `php -S 0.0.0.0:$PORT -t public public/index.php`.
4. Add a custom domain in Railway → DNS → CNAME pointing at the Railway
   endpoint. Railway provisions Let's Encrypt automatically.

## Customizing the brand

Site styling lives entirely in `public/assets/css/styles.css`. The token block
at the top mirrors the desktop app's `src/ui/public/tokens.css`. If you change
the brand color in one place, change it in the other so they stay in sync.

The brand glyph is `views/partials/_brand-glyph.svg` for the header (32×32
viewport) and `_hero-glyph.svg` for the hero (64×64). Both render the Envy eye.
The binary favicons (`public/favicon.ico`, `assets/img/og.png`,
`assets/img/icon-180.png`) still need to be regenerated from `assets/img/icon.svg`
with Envy branding.

## Privacy

The site ships zero analytics, zero trackers, zero cookies. If we ever
add analytics, we'll wire in a privacy-respecting option (e.g. Cloudflare
Web Analytics or self-hosted Umami) — not Google Analytics.
