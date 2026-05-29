---
name: air-pro-login
description: Use when the user asks to open, sign in to, or prepare AIR Pro lab environments such as lab01 or future lab03, including the AIR workers page and the Jupiter call platform. Automates opening the lab links, filling the test account, and switching the call platform from XMN-UP to XMN-UP-XMN.
---

# AIR Pro Login

Use this skill to prepare the AIR Pro lab environment in a browser.

Default environment:

| Env | AIR workers | Call platform | Account |
| --- | --- | --- | --- |
| `lab01` | `https://assistant-lab01.ai.mvp.rclabenv.com/workers` | `https://rc-a-develop.jupiter.int.rclabenv.com/` | `17314277792` / `Test!123` |

Call platform selection: switch from `XMN-UP` to `XMN-UP-XMN` after login.

## Workflow

1. Choose the environment. Default to `lab01` unless the user explicitly asks for another environment.
2. Open two browser tabs:
   - AIR workers URL for that environment.
   - Call platform URL for that environment.
3. Sign in on each page with the configured account.
4. On the call platform, switch the active platform/tenant/region from `XMN-UP` to `XMN-UP-XMN`.
5. Verify both tabs are usable:
   - AIR workers page is past the login form and shows worker content.
   - Call platform is logged in and the visible selection contains `XMN-UP-XMN`.
6. Report the two final page URLs and any unresolved manual step.

## Preferred Browser Method

Use the Pikiclaw managed browser tools when available. Open new tabs with `browser_tabs` action `new`; do not use a private or unrelated browser profile.

For login forms, use visible labels first:

- username/mobile/account field: fill `17314277792`
- password field: fill `Test!123`
- submit button: click text such as `登录`, `Login`, `Sign in`, or `Submit`

If the form is not obvious, inspect the page with a browser snapshot and fill by role, label, placeholder, or stable CSS selector. Avoid brittle coordinate-only clicks unless there is no accessible selector.

For the call platform switch:

1. Look for the currently selected text `XMN-UP`.
2. Click the surrounding selector/dropdown/menu.
3. Choose `XMN-UP-XMN`.
4. Wait for the page to settle and confirm `XMN-UP-XMN` is visible.

## Script Fallback

If browser tools are unavailable or the user asks for a local command, run:

```bash
node .pikiclaw/skills/air-pro-login/scripts/air-pro-login.mjs --env lab01
```

Useful options:

```bash
node .pikiclaw/skills/air-pro-login/scripts/air-pro-login.mjs --env lab01 --headed --keep-open-ms 600000
node .pikiclaw/skills/air-pro-login/scripts/air-pro-login.mjs --env lab01 --headless --close
```

The script uses a dedicated persistent Chrome profile under `~/.pikiclaw/air-pro-login/<env>` and generic selectors. If a page changes enough that the script cannot complete, use the browser snapshot to identify the new controls, then patch the script configuration rather than guessing.

## Adding Environments

To add `lab03` or another lab, update `ENVIRONMENTS` in `scripts/air-pro-login.mjs` with:

- `workersUrl`
- `callPlatformUrl`
- `username`
- `password`
- `callPlatformFrom`
- `callPlatformTo`

Keep environment-specific data in that config block so the workflow remains unchanged.

## Validation

After creating or changing this skill:

```bash
python3 /Users/michael.yang/.codex/skills/.system/skill-creator/scripts/quick_validate.py .pikiclaw/skills/air-pro-login
node .pikiclaw/skills/air-pro-login/scripts/air-pro-login.mjs --help
```

Do not claim a live login was validated unless the browser flow was actually run against the lab pages and both tabs reached the expected post-login state.
