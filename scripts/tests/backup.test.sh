#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TEST_DIR=$(mktemp -d /tmp/crisis-backup-test.XXXXXX)
trap 'rm -rf -- "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin" "$TEST_DIR/uploads"
printf 'image fixture\n' > "$TEST_DIR/uploads/fixture.txt"
touch "$TEST_DIR/test.env"
cat > "$TEST_DIR/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  compose)
    service="${!#}"
    if [[ "$service" == api ]]; then
      [[ "${FAKE_MISSING_API:-}" == true ]] || echo api-fixture
    else echo postgres-fixture; fi
    ;;
  exec)
    if [[ "$2" == postgres-fixture ]]; then
      [[ "${FAKE_FAIL_DB:-}" != true ]] || { echo 'Database dump failed' >&2; exit 12; }
      echo 'SELECT 1;'
    else
      [[ "${FAKE_FAIL_UPLOADS:-}" != true ]] || { echo 'Upload archive failed' >&2; exit 13; }
      [[ "${*:3}" == 'tar -czf - -C /repo/uploads .' ]] || { echo 'Wrong uploads path' >&2; exit 14; }
      tar -czf - -C "$UPLOADS_FIXTURE" .
    fi
    ;;
  *) exit 15 ;;
esac
EOF
chmod +x "$TEST_DIR/bin/docker"
export PATH="$TEST_DIR/bin:$PATH" APP_DIR="$ROOT" ENV_FILE="$TEST_DIR/test.env"
export UPLOADS_FIXTURE="$TEST_DIR/uploads"
export BACKUP_DIR="$TEST_DIR/success"
bash "$ROOT/scripts/backup.sh" > "$TEST_DIR/success.log" 2>&1
grep -q 'backup.completed' "$TEST_DIR/success.log"
stamp=$(cat "$BACKUP_DIR"/complete_*.manifest)
gzip -t "$BACKUP_DIR/crisis_${stamp}.sql.gz"
tar -xzf "$BACKUP_DIR/uploads_${stamp}.tar.gz" -C "$TEST_DIR"
cmp "$TEST_DIR/fixture.txt" "$TEST_DIR/uploads/fixture.txt"
for failure in DB UPLOADS; do
  export BACKUP_DIR="$TEST_DIR/failure-$failure"
  if env "FAKE_FAIL_${failure}=true" bash "$ROOT/scripts/backup.sh" > "$TEST_DIR/$failure.log" 2>&1; then
    echo "Backup swallowed $failure failure" >&2; exit 1
  fi
  grep -q 'backup.failed' "$TEST_DIR/$failure.log"
  [[ -z $(find "$BACKUP_DIR" -name 'complete_*.manifest' -print) ]]
done
export BACKUP_DIR="$TEST_DIR/missing"
if FAKE_MISSING_API=true bash "$ROOT/scripts/backup.sh" > "$TEST_DIR/missing.log" 2>&1; then
  echo 'Backup accepted a missing container' >&2; exit 1
fi
grep -q 'API container not running' "$TEST_DIR/missing.log"
echo 'Backup failure and archive tests passed'
