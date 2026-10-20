const fs = require('fs/promises');
const path = require('path');

// Select the backend before Electron starts. Changing ozone-platform in the
// main process is too late on recent Electron versions.
module.exports = async context => {
  if (context.electronPlatformName !== 'linux') return;
  const executable = path.join(context.appOutDir, 'yesplaymusic');
  await fs.rename(executable, `${executable}.bin`);
  await fs.writeFile(
    executable,
    `#!/usr/bin/env bash
set -e
app_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
explicit_backend=0
for arg in "$@"; do
  case "$arg" in
    --ozone-platform|--ozone-platform=*) explicit_backend=1 ;;
  esac
done
if [[ "$explicit_backend" == 0 ]]; then
  backend=""
  case "$XDG_SESSION_TYPE" in
    wayland) backend=wayland ;;
    x11) backend=x11 ;;
    *)
      if [[ -n "$WAYLAND_DISPLAY" ]]; then
        backend=wayland
      elif [[ -n "$DISPLAY" ]]; then
        backend=x11
      fi
      ;;
  esac
  if [[ -n "$backend" ]]; then
    set -- "--ozone-platform=$backend" "$@"
  fi
fi
exec "$app_dir/yesplaymusic.bin" "$@"
`,
    { mode: 0o755 }
  );
};
