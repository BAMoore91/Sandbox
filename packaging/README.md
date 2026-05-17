# Packaging

Native installers for each supported OS. Implemented in **Phase 5**.

| OS | Format | Tool |
|---|---|---|
| Linux (Debian/Ubuntu) | `.deb` | `fpm` |
| Linux (Fedora/RHEL) | `.rpm` | `fpm` |
| Windows | `.msi` | WiX Toolset v4 |

The build pipeline:

1. `pnpm build` produces `apps/server/dist/` and `apps/web/dist/`.
2. `pnpm fetch-vendor` downloads go2rtc + ffmpeg builds for the target OS.
3. `pkg`/`nexe` bundles Node 20 + the server into a single binary.
4. Per-OS scripts in this directory package everything into an installer.

Service install:

- **Linux**: systemd unit at `/etc/systemd/system/softbiscuit.service`,
  data at `/var/lib/softbiscuit`, run as `softbiscuit` user.
- **Windows**: Windows Service via `node-windows`, data at
  `%PROGRAMDATA%\SoftBiscuit`, runs as `LocalSystem`.
