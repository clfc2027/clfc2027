# Deploying the CLFC Workers

The `main` branch is the source of truth. Each Worker is connected to this repo in
the Cloudflare dashboard and deploys itself when a commit lands on `main`.
Do not edit Worker code in the dashboard: changes made there are overwritten by the
next deploy from the repo and are not recorded anywhere.

## Worker → folder map

| Worker name           | Repo root directory        | Build watch paths                                  |
|-----------------------|----------------------------|----------------------------------------------------|
| clfc2027              | `/` (repo root)            | `public/**`, `wrangler.toml`                       |
| admin                 | `workers/admin`            | `workers/admin/**`, `shared/**`                    |
| coaches-board         | `workers/coaches-board`    | `workers/coaches-board/**`, `shared/**`            |
| fgk                   | `workers/fgk`              | `workers/fgk/**`, `shared/**`                      |
| players-player        | `workers/players-player`   | `workers/players-player/**`, `shared/**`           |
| game-day              | `workers/game-day`         | `workers/game-day/**`                              |

Settings for every Worker:
- Build command: none
- Deploy command: `npx wrangler deploy`

Watch paths matter: a change under `shared/` must redeploy every Worker that imports
`shared/auth.js`, and a change in one Worker's folder should not redeploy the others.

## Shared code

`shared/auth.js` holds the admin passcode check (`passcodeState`). Workers import it
with a relative path, for example `import { passcodeState } from "../../shared/auth.js";`.
Do not copy it into a Worker. Wrangler bundles the import at deploy time.

## Secrets and bindings

Secrets and bindings are set in the dashboard, not in the repo (see the comments
in each `wrangler.toml` / `wrangler.jsonc`). Never commit a secret or passcode.

## Commit messages

Describe what changed and why, for example "fgk: fail closed when ADMIN_PASSCODE
is missing". Generic messages such as "Update worker.js" hide what a deploy contains.
