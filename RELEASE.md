# Releasing Fathet Kheer POS (auto-update)

Installed tills update themselves from the public GitHub releases repo
**https://github.com/SamirFetait/cashier-releases** using `electron-updater`. Each release is one
NSIS installer; the source stays in the `cashier` repo and only the built installer and its update
metadata go to `cashier-releases`.

## One-time setup

1. **Create the releases repo** `SamirFetait/cashier-releases` on GitHub and make it **public**.
   Public means tills download updates without any token.

2. **Create a GitHub token** with write access to that repo:
   - Fine-grained token → Repository access: only `cashier-releases` → Permissions:
     **Contents: Read and write**.
   - (A classic token with the `repo` scope also works.)

3. **Save the token** in `.env.release` at the repo root (git-ignored), as one line:

   ```
   GH_TOKEN=github_pat_xxx
   ```

   `build.bat` reads it on every run and prefers it over a machine-wide `GH_TOKEN`, which may belong
   to another GitHub account and fail with `403 Resource not accessible by personal access token`.
   Never commit the token.

## Releasing a new version

1. **Bump the version** from `frontend\`:

   ```bat
   npm version patch --no-git-tag-version
   ```

   This updates `package.json` and `package-lock.json` together (use `minor`/`major` when
   appropriate). The installer name, exe details, `latest.yml`, the splash and the title bar all
   take the version from `package.json`. Tills only update to a *higher* version, so it must go up
   every release.

2. **Check the API address** in `frontend\.env` (`VITE_API_BASE_URL`). It is built into the release,
   and every till that updates will use it.

3. **Build and publish** from the repo root:

   ```bat
   build.bat publish
   ```

   This builds the app and runs `electron-builder --publish always`, which uploads to a **draft**
   release in `cashier-releases`:
   - the installer (`… Setup <version>.exe`)
   - `latest.yml` — the update manifest the tills read
   - the installer's `.blockmap` — enables differential (delta) downloads

   > `build.bat` with no argument makes a local installer in `frontend\dist\` without uploading.

4. **Publish the draft** on GitHub: open the release in `cashier-releases`, check that all three
   files are attached, and click **Publish release**. Tills ignore drafts and pre-releases.

## How tills update

At launch (installed builds only), before the app opens, the splash checks `cashier-releases` for
a newer published version. If there is one, the splash shows the download's progress and blocks the
app, then the installer runs and relaunches the new version — no till keeps selling on an outdated
build. Downloads are deltas via the `.blockmap`: only the parts of the installer that changed. If
the check fails or takes over 15 s, or the download makes no progress for 90 s, the app opens on the
current version and tries again later.

A till left open checks again every 4 hours and downloads in the background, then shows an
**Update ready — Restart now** notice. Dismissing it installs the update the next time the app
closes, so a restart never interrupts a sale.

Updates install per user with no admin prompt, and the install path stays the same across versions.
Updater activity is logged to `%APPDATA%\cashier-desktop\logs\main.log`.

## Notes

- **Unsigned is fine.** The app isn't code-signed; electron-updater verifies each download against
  the sha512 in `latest.yml`. Windows SmartScreen may warn on the very first manual install.
- **Keep all three files** on every release. Deleting `latest.yml` or the `.blockmap` breaks
  updates or forces a full re-download.
- **The first install is manual.** Builds made before auto-update have no updater: install the
  first release by hand on each till; every release after that arrives by itself.
- **Dev runs never update.** `npm run dev` skips the check (there is no `app-update.yml`).
