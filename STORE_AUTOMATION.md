# Automated store updates

The **Store release** GitHub Actions workflow submits stable `vX.Y.Z` tags from
`main`. Ordinary pushes and prerelease tags do not publish. Firefox uses the
existing `hack-engine@abduljawada.github.io` listing; Chrome stays disabled until
explicitly enabled. Installing this workflow does not publish the current candidate.

## One-time Firefox setup

1. Commit this automation together with the completed testing infrastructure it
   uses (`.github/workflows/tests.yml`, the regression runner, and game tests), and
   merge to `main`. Preserve and finish existing work before creating a release.
2. From the Mozilla account that owns Hack Engine, generate credentials at
   <https://addons.mozilla.org/developers/addon/api/key/>.
3. In GitHub **Settings → Secrets and variables → Actions → Secrets**, add
   `AMO_JWT_ISSUER` (the API key) and `AMO_JWT_SECRET` (the API secret).
   Do not put their values in source files, release notes, or workflow inputs.
4. Ensure Actions is enabled and repository policy permits the workflow's
   `contents: read` and publishing jobs' `deployments: write` permissions.
   Deployments are used solely as a durable attempt journal; an attempt record is
   not evidence of store publication.

After adding the secrets, run **Actions → Verify store setup → Run workflow** from `main`. This authenticates against the existing stores without a release tag, upload, or publication. A `not_submitted` result for the current development version is expected.

There is no new Firefox listing to create. Credentials must belong to an author
of the existing listing. The author-only status endpoint is checked before upload
so pending and rejected versions are not mistaken for missing versions.

## Release a version

Complete the manual qualification gates in `IMPLEMENTATION_1_0.md` and
`STORE_PUBLISHING_CHECKLIST.md` first. Resolve the candidate's release notes in
`CHANGELOG.md`, including outdated “not published” wording, and align
`manifest.json`, `package.json`, and both root versions in `package-lock.json`.
The workflow submits that version's changelog section as Firefox release notes.

From a clean committed `main`, replace `vX.Y.Z` below with the intended new version:

```sh
git status --short
git tag -a vX.Y.Z -m 'Release vX.Y.Z'
git push --atomic origin main refs/tags/vX.Y.Z
git rev-parse 'refs/tags/vX.Y.Z^{commit}'
git ls-remote origin 'refs/tags/vX.Y.Z^{}'
```

Verify the two commit hashes match before reporting the tag as released. Never
force-push or replace a release tag. If the atomic push fails, resolve the failure
and push both the branch and this specific tag; do not leave the tag local-only.
Creating the stable tag is the intentional store-submission trigger. Use a **new**
version/tag containing these automation files, not an older candidate tag.

The workflow checks tag identity, ancestry on `origin/main`, matching versions,
permanent add-on identity, and release notes. It builds both packages and the
Mozilla source archive, validates checksums and Firefox lint, runs unit tests,
browser regressions, browser/frame integration, and strict controlled-game
qualification for exactly eight configurations: Asteroids (JavaScript), Breakout
(WebAssembly), Xeno Tactic 2 (AVM1), and Bloons Tower Defense 3 (AVM2), each in
Firefox and Google Chrome for Testing. Original game copies and Ruffle are pinned
and validated before use; they are served only on loopback and excluded from
release packages and source archives. Missing assets, uncertain observations,
unproven target workflows, and genuine failures block both submission jobs.

The separate **Live-site compatibility (advisory)** workflow exercises the same
four public websites. It retains a failing result for blocked or failed cases;
it does not qualify a release or substitute a cached game for a blocked website.
The core gate checks extension capabilities against controlled original games,
while compatibility checks current website integration. A core pass is not a claim
that every public site is currently accessible. This separation was explicitly
approved to prevent third-party access challenges from substituting for extension
regression results. Neither workflow bypasses challenges or certificate checks.

Only the required **Extension and real-game tests / test** core check should be
configured as the game qualification branch-protection requirement; compatibility
is separately reviewed and remains visible. Chrome store publishing stays disabled
regardless of which browser runs the tests.

Submission jobs consume the exact validated build artifacts and recheck commit
identity and archive checksums. Mozilla's official `web-ext` then packages the
validated Firefox directory, attaches the source archive and notes, and submits
on the listed channel without waiting for store approval. Its ZIP container may
differ from the build ZIP; the validated directory supplies its content.

## Status, failures, and retries

In **Actions → Store release → Run workflow**, select the workflow from `main`,
enter the existing release tag, choose a store, and choose:

- **status** (default): read authenticated store status; no build, upload, publish,
  or attempt record. Chrome is skipped while disabled.
- **submit**: rerun all release checks, then check each selected store before
  attempting submission. Existing published or pending versions are not uploaded
  again. Rejected, disabled, conflicting, or ambiguous states require attention.

Every store write is preceded by a persistent GitHub deployment record keyed by
store and commit. This protects interrupted workflows, including Chrome drafts
that its status API cannot expose. A previous attempt blocks a new upload even
when the store reports the version missing. Do not delete these records.

If an attempt failed before reaching the store, inspect the developer dashboard
and verify that **no uploaded draft or submitted version remains**. Only then
select **reconciled** on a manual `submit` run. This permits another attempt record;
it does not override store status checks. Never select it merely because a run
failed. If a Firefox version exists without its source archive, repair that source
attachment in the AMO dashboard instead of reuploading the version. If Chrome has
an uploaded draft, finish or discard it in its dashboard before reconsidering a
retry. An asynchronous Chrome upload is reported as `upload_processing`; it does
not automatically publish an unidentified draft.

Results appear in the workflow summary and JSON artifacts:

| Result | Meaning |
| --- | --- |
| `not_submitted` | No matching version found; a read-only status check made no changes. |
| `submitted` | Firefox submission completed but a follow-up read could not confirm review status. |
| `awaiting_review` | The store confirms the version is pending review. |
| `published` | The store API confirms publication. |
| `upload_processing` | Chrome is processing an upload; check its dashboard before further action. |
| `needs_attention` / `failed` | Inspect the dashboard/error and reconcile before retrying. |

Review timeouts or network failures never cause automatic repeat uploads. Run
`status` later to confirm publication, then verify the public listing and install
the signed store version for the release smoke test. Workflow success alone does
not mean the extension is public.

Artifacts are retained for 90 days: validated packages, SHA-256 files, source
archive, commit/tag/version metadata, test evidence, and store results. Download
and archive them before expiry if long-term retention is needed. The workflow does
not publish unsigned Firefox ZIPs as installable GitHub release assets.

## Enable Chrome later

Complete the initial Chrome Web Store publication manually, including listing,
privacy declarations, verification, and visibility. Then enable the Chrome Web
Store API in a Google Cloud project and authorize an OAuth client for the owning
publisher with `https://www.googleapis.com/auth/chromewebstore` access.
Use a refresh token suitable for ongoing automation; OAuth consent projects left
in external Testing can issue short-lived refresh tokens.

Add these GitHub Actions **secrets**:

- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

Add these GitHub Actions **variables**:

- `CHROME_PUBLISHER_ID`
- `CHROME_EXTENSION_ID` (the existing published item)
- `CHROME_PUBLISH_ENABLED`: set to exactly `true` only when ready.

Run a manual Chrome `status` check first. Subsequent stable tags submit Chrome
updates through API V2 with normal review and automatic publication after approval.
Firefox and Chrome submit independently after shared validation; a Chrome failure
does not roll back a successful Firefox submission. Leaving the switch unset or
`false` requires no Chrome credentials and has no effect on Firefox.

## Local validation without store writes

```sh
node --test --test-isolation=none test/release-preflight.test.mjs test/release-workflow.test.mjs test/store-attempt.test.mjs test/store-firefox.test.mjs test/store-chrome.test.mjs
npm run build:source
npm run check
npm run lint:firefox
```

The automation tests mock all store/journal requests and cover version and Git
identity mismatches, failed validation gating, missing credentials, pending and
duplicate submissions, uncertain outcomes, API failures, and disabled Chrome.
The local commands above do not qualify the candidate's browser/game behavior;
those full checks remain mandatory in the actual publishing workflow.

Official references:

- [Mozilla web-ext signing](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign)
- [AMO version API and authenticated filters](https://mozilla.github.io/addons-server/topics/api/addons.html#versions-list)
- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)
- [GitHub deployment records](https://docs.github.com/en/rest/deployments/deployments#create-a-deployment)
