#!/bin/sh
# Install on the host; configuration contains paths only, never credentials.
set -eu
umask 077
. /opt/cosmora/runtime/maintenance-paths.env
exec 9>/run/lock/kosmora-maintenance.lock
flock -n 9 || exit 0
mkdir -p "$STAGE" "$BACKUPS"
chmod 700 "$STAGE" "$BACKUPS"

run() {
  "$DEPLOYCTL" run --rm -T --interactive=false --no-deps \
    -v /opt/cosmora/private:/run/cosmora-current:ro \
    -v "$STAGE":/run/cosmora-stage \
    -v "$BACKUPS":/run/cosmora-backups \
    -v "$MAINTENANCE_MODULE":/app/deploy/alpha/maintenance.mjs:ro \
    api node /app/deploy/alpha/maintenance.mjs "$@"
}
publish() {
  install -m 600 "$1" "$2.maintenance-new"
  mv -f "$2.maintenance-new" "$2"
}
archive() {
  # Keep verified DB backups; pending bearer copies are no longer needed.
  install -m 600 "$STAGE/state.json" /opt/cosmora/runtime/maintenance-last.json
  rm -f "$STAGE/session.old.env" "$STAGE/session.new.env" \
    "$STAGE/registry.old.json" "$STAGE/registry.new.json" "$STAGE/state.json"
}
rollback() {
  trap - EXIT HUP INT TERM
  if [ -f "$STAGE/state.json" ]; then
    phase=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["phase"])' "$STAGE/state.json")
    if [ "$phase" = prepared ]; then
      publish "$STAGE/registry.old.json" "$REGISTRY"
      publish "$STAGE/session.old.env" "$SESSION"
      # Restore the serving env before revoking the candidate session.
      "$DEPLOYCTL" up -d --no-deps --force-recreate --wait --wait-timeout 90 api edge &&
        run rollback && archive
    elif [ "$phase" = committing ]; then
      # The old bearer may already be revoked; finish commit, never restore it.
      run commit && archive
    else
      archive
    fi
  fi
}

# A killed/interrupted previous run is rolled back before creating another candidate.
if [ -f "$STAGE/state.json" ]; then rollback; fi
trap 'rollback; exit 1' EXIT HUP INT TERM
run status > "$STAGE/status.json"
due=$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print(int(s["session_due"] or s["registry_due"]))' "$STAGE/status.json")
if [ "$due" = 1 ]; then
  run prepare > /dev/null
  registry_due=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["registry_due"]))' "$STAGE/state.json")
  session_due=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["session_due"]))' "$STAGE/state.json")
  if [ "$registry_due" = 1 ]; then
    publish "$STAGE/registry.new.json" "$REGISTRY"
    "$DEPLOYCTL" up -d --no-deps --force-recreate --wait --wait-timeout 90 api
  fi
  if [ "$session_due" = 1 ]; then
    publish "$STAGE/session.new.env" "$SESSION"
    "$DEPLOYCTL" up -d --no-deps --force-recreate --wait --wait-timeout 90 edge
  fi
  "$VERIFY_ACCESS"
  run commit > /dev/null
  archive
  touch "$BACKUPS/.last-verified"
elif [ ! -f "$BACKUPS/.last-verified" ] ||
  [ "$(find "$BACKUPS/.last-verified" -mmin +1440 -print)" ]; then
  run backup > /dev/null
  touch "$BACKUPS/.last-verified"
fi
trap - EXIT HUP INT TERM
printf '%s\n' 'Kosmora maintenance PASS; no generation requests.'
