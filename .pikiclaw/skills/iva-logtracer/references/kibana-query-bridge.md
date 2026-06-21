# kibana-query bridge (IVA)

Use this when a task needs **`kibana-query`** (generic Lucene/KQL search, export, indices) but should **not** duplicate Kibana credentials or index defaults under `~/.config/kibana-query/`.

## Source of truth

- **Credentials, `KIBANA_URL`, `KIBANA_INDEX`, timeouts**: **`~/.config/iva-logtracer/.env.{lab,production,stage}`** (same files as `iva-logtracer` CLI).
- **Per-component index patterns** (when overriding `--index`): **`references/id-correlation.md`**.

## Required invocation shape

Always pass **`--env-file`** explicitly so `kibana-query` loads the **iva-logtracer** env file:

```bash
# lab
kibana-query search 'level:ERROR' \
  --env-file "${HOME}/.config/iva-logtracer/.env.lab" \
  --last 1h

# production
kibana-query search 'level:ERROR' \
  --env-file "${HOME}/.config/iva-logtracer/.env.production" \
  --last 1h
```

When **`--env-file`** is set, `kibana-query` loads **only** that file (the `--env` name does not select a different path).

Connectivity check:

```bash
kibana-query doctor --env-file "${HOME}/.config/iva-logtracer/.env.lab"
kibana-query test --env-file "${HOME}/.config/iva-logtracer/.env.lab"
```

## When to narrow `--index`

Default `KIBANA_INDEX` in iva-logtracer config may be runtime-scoped. Use these
runtime component patterns explicitly when the user names old IVAR versus
IVAR-NG:

```text
production IVAR / IVAR-NG: *:*-logs-air_ivar-*
non-production assistant-runtime: *:*-logs-air_assistant_runtime-*
```

For **cache-warmer**, **memory-controller**, or other components, add:

```bash
kibana-query search 'message:*Deleted*assistants*' \
  --env-file "${HOME}/.config/iva-logtracer/.env.lab" \
  --index '*:*-logs-<component>-*' \
  --last 1h
```

Pick `<component>` from Discover or from **`id-correlation.md`** where applicable.

## What not to do

- Do **not** maintain a second copy of `KIBANA_*` in **`~/.config/kibana-query/.env.lab`** for IVA lab work (drift, timeouts, and index mismatch caused the earlier failures).
- Do **not** use **`~/.config/kibana-query`** as the configuration source when **`iva-logtracer`** is already initialized; route through this bridge instead.
