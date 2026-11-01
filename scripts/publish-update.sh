#!/usr/bin/env bash
# Fork: publish a built Windows release to Jun-Code's update feed (mysg /var/www/jun-code, served at
# https://hub.yuanhk.top/jun-code/). Run after `pnpm exec electron-builder --win --publish never`:
#
#   scripts/publish-update.sh "说明一" "说明二" ...
#
# Each argument is one line of the release notes the update dialog shows. latest.yml goes up last,
# so a client never sees a version whose installer isn't there yet; the newest 3 installers (and
# their blockmaps, which differential downloads read) are kept.
set -euo pipefail
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8

here=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p "require('$here/package.json').version")
exe="Jun-Code-Setup-${version}-x64.exe"
rel="$here/release"
[ -f "$rel/$exe" ] && [ -f "$rel/$exe.blockmap" ] && [ -f "$rel/latest.yml" ] ||
  { echo "missing $exe / blockmap / latest.yml in release/ — build $version first" >&2; exit 1; }
grep -q "^version: ${version}\s*$" "$rel/latest.yml" ||
  { echo "release/latest.yml is not for $version" >&2; exit 1; }

# latest.yml plus the notes, as a YAML block (electron-updater hands it over as info.releaseNotes).
feed=$(mktemp)
python - "$rel/latest.yml" "$feed" "$@" <<'EOF'
import sys
src, dst, notes = sys.argv[1], sys.argv[2], sys.argv[3:]
lines = [l for l in open(src, encoding="utf-8").read().splitlines() if not l.startswith("releaseNotes")]
if notes:
    lines.append("releaseNotes: |")
    lines += ["  - " + n.strip() for n in notes]
open(dst, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
EOF

# JUN_SSH_OPTS: extra ssh/scp options, e.g. -o ProxyJump=myhk when mysg is unreachable directly.
read -r -a sshopts <<< "${JUN_SSH_OPTS:-}"
ssh "${sshopts[@]}" mysg "mkdir -p /var/www/jun-code"
scp -q "${sshopts[@]}" "$rel/$exe" "mysg:/var/www/jun-code/$exe.tmp"
scp -q "${sshopts[@]}" "$rel/$exe.blockmap" "mysg:/var/www/jun-code/$exe.blockmap"
scp -q "${sshopts[@]}" "$feed" "mysg:/var/www/jun-code/latest.yml.tmp"
rm -f "$feed"
ssh "${sshopts[@]}" mysg "set -e; cd /var/www/jun-code; mv '$exe.tmp' '$exe'; chmod 644 '$exe' '$exe.blockmap' latest.yml.tmp; mv latest.yml.tmp latest.yml
  ls -t Jun-Code-Setup-*.exe | tail -n +4 | while read -r f; do rm -f \"\$f\" \"\$f.blockmap\"; done; ls -l"
echo "published Jun-Code $version"
