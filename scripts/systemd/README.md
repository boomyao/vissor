# systemd units

Copies of what runs on boomyao-iron, kept here so the deployment can be
rebuilt without logging in to read it back. They are **not** applied
automatically — install with:

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
