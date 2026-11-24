#!/usr/bin/env bash
# Operator-run release apply / rollback on the test infrastructure only.
# Never used by the application itself and never run against the production VPS.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy-release.sh --apply <release-dir> <db-snapshot>
  deploy-release.sh --rollback <image-digest> <db-snapshot>

Both commands operate on pinned OCI image digests (sha256:...), never on a
mutable tag. <db-snapshot> is a manifest produced by deploy/alpha/sqlite-backup.mjs.
EOF
  exit 2
}

mode="${1:-}"
case "$mode" in
  --apply) shift; release_dir="${1:?release dir}"; snapshot="${2:?db snapshot}";;
  --rollback) shift; digest="${1:?image digest}"; snapshot="${2:?db snapshot}";;
  *) usage;;
esac

if [[ ! "$snapshot" == *.json || ! -f "$snapshot" ]]; then
  echo "REFUSED: database snapshot manifest not found: $snapshot" >&2
  exit 3
fi

if [[ "$mode" == "--apply" ]]; then
  build_file="$release_dir/build.json"
  [[ -f "$build_file" ]] || { echo "REFUSED: build.json missing (run build-image.mjs)" >&2; exit 3; }
  digest="$(node -e 'const b=require(process.argv[1]); if(b.status!=="ok"||!b.image?.digest)process.exit(4); process.stdout.write(b.image.digest)' "$build_file")"
  # Fail-closed preflight: refuse when free disk is below the declared requirement.
  required="$(node -e 'process.stdout.write(String(require(process.argv[1]).requirements.disk_bytes))' "$build_file")"
  free="$(df -P "$release_dir" | awk 'NR==2{print $4*1024}')"
  if (( free < required )); then
    echo "REFUSED LOW_DISK: need ${required} bytes, have ${free} bytes. No unpack, no migration, no start." >&2
    echo "ROLLBACK: no previous build was replaced; current working build is still live." >&2
    exit 5
  fi
  echo "APPLY stage=preflight image=$digest required_disk=$required free=$free"
  echo "APPLY stage=backup snapshot=$snapshot"
  echo "APPLY stage=image image=$digest"
  echo "APPLY stage=migrate (additive-only; older image stays schema-compatible)"
  echo "APPLY stage=start api+web; run scripts/rehearse-release.mjs health gates"
  echo "APPLY READY: select $digest explicitly; do not use :latest"
else
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "REFUSED: invalid image digest" >&2; exit 3; }
  echo "ROLLBACK stage=stop (new version)"
  echo "ROLLBACK stage=select-image image=$digest"
  echo "ROLLBACK stage=restore-db snapshot=$snapshot (only if schema incompatible)"
  echo "ROLLBACK stage=start api+web; re-run health and migration checks"
  echo "ROLLBACK READY: previous working build $digest"
fi
