// Paths arrive as separate argv entries. Never interpolate app paths into shell.
const MAC_INSTALL_SCRIPT = `#!/bin/sh
set -eu
parent_pid="$1"
target="$2"
staged="$3"
backup="$4"
log="$5"
open_tool="$6"
exec >>"$log" 2>&1
count=0
while kill -0 "$parent_pid" 2>/dev/null; do
  count=$((count + 1))
  if [ "$count" -ge 120 ]; then
    echo "Update cancelled: application did not quit"
    exit 1
  fi
  sleep 1
done
if [ ! -d "$target" ] || [ ! -d "$staged" ] || [ -e "$backup" ]; then
  echo "Update cancelled: application paths changed"
  exit 1
fi
if ! /bin/mv "$target" "$backup"; then
  echo "Update failed: cannot preserve current app"
  "$open_tool" "$target" || true
  exit 1
fi
if ! /bin/mv "$staged" "$target"; then
  echo "Update failed: restoring previous app"
  /bin/mv "$backup" "$target"
  "$open_tool" "$target" || true
  exit 1
fi
if ! "$open_tool" "$target"; then
  echo "Relaunch failed: restoring previous app"
  /bin/mv "$target" "$staged"
  /bin/mv "$backup" "$target"
  "$open_tool" "$target" || true
  exit 1
fi
/usr/bin/touch "$(/usr/bin/dirname "$backup")/launch-succeeded"
echo "Update installed and launch requested; previous app retained at $backup"
`;

module.exports = { MAC_INSTALL_SCRIPT };
