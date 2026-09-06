# systemd units

Copies of what runs on boomyao-iron, kept here so the deployment can be
rebuilt without logging in to read it back. They are **not** applied
automatically. Vissor uses a dedicated Codex CLI 0.153.4 runtime for
`gpt-6-astra`; the previous CLI 0.146.0 cannot run this model. Provision
the runtime on boomyao-iron before installing the units:

```bash
mkdir -p /home/boomyao/.local/share/vissor/codex-0.153.4
cd /home/boomyao/.local/share/vissor/codex-0.153.4
/home/boomyao/.bun/bin/bun add --exact @openai/codex@0.153.4
cat > run-codex <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec /home/boomyao/.bun/bin/bun /home/boomyao/.local/share/vissor/codex-0.153.4/node_modules/@openai/codex/bin/codex.js "$@"
EOF
chmod +x run-codex
./run-codex --version
```

Then return to the repository and install the units:

```
cp scripts/systemd/*.service scripts/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now vissor.service vissor-health.timer
loginctl enable-linger "$USER"   # so user units survive logout
```

Paths are absolute and machine-specific — edit them for a different host.

`vissor.service` runs the server only; the web bundle is built by
`scripts/deploy.sh`, which must run the build **before** the restart.

`vissor-health.timer` probes `/api/health` every two minutes and restarts
the service once if it is wedged, then stops retrying and keeps warning so
it cannot flap. Set `VISSOR_ALERT_WEBHOOK` in `vissor-health.service` to
also POST alerts somewhere; unset, it only writes to the journal:

```
journalctl --user -t vissor-health --since today
```
