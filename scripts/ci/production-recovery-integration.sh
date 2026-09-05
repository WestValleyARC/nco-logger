#!/bin/sh
set -eu

# A destructive recovery exercise, deliberately isolated in its own Compose
# project, named volumes, network, database, and temporary host directory.
project="nco-remediation-${GITHUB_RUN_ID:-local}-$$"
restore_db="nco_remediation_restore_$$"
test_root="$(mktemp -d /tmp/nco-remediation-recovery.XXXXXX)"
env_file="$test_root/integration.env"
backup_dir="$test_root/backups"
mkdir -m 0777 "$backup_dir"

cleanup() {
    status=$?
    if [ "$status" -ne 0 ]; then
        docker compose -p "$project" --env-file "$env_file" logs --no-color app >&2 || true
    fi
    docker compose -p "$project" --env-file "$env_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
    case "$test_root" in
        /tmp/nco-remediation-recovery.*) rm -rf -- "$test_root" ;;
        *) echo "Refusing to remove unexpected path: $test_root" >&2 ;;
    esac
    return "$status"
}
trap cleanup EXIT INT TERM

root_password="$(openssl rand -hex 32)"
app_password="$(openssl rand -hex 32)"
cookie_secret="$(openssl rand -hex 48)"
magic_secret="$(openssl rand -hex 48)"
replica_key="$(openssl rand -base64 72 | tr -d '\n')"

umask 077
{
    printf '%s\n' \
        'NODE_ENV=production' \
        'PORT=3000' \
        'BASE_URL=https://logger.integration.test' \
        'LEGAL_CONTENT_APPROVED=true' \
        'TRUST_PROXY=loopback' \
        'MONGO_ROOT_USERNAME=integration_root' \
        "MONGO_ROOT_PASSWORD=$root_password" \
        'MONGO_APP_USERNAME=integration_app' \
        "MONGO_APP_PASSWORD=$app_password" \
        "MONGO_REPLICA_KEY=$replica_key" \
        "COOKIE_SESSION_KEY=$cookie_secret" \
        "MAGIC_LINK_SECRET=$magic_secret" \
        "MONGODB_DEVELOPMENT_URI=mongodb://integration_app:$app_password@mongo:27017/$restore_db?authSource=hamlive&replicaSet=rs0&directConnection=true" \
        "NCO_BACKUP_DIR=$backup_dir" \
        'NCO_BACKUP_UID=1000' \
        'NCO_BACKUP_GID=1000' \
        "NCO_ENV_FILE=$env_file" \
        "NCO_APP_IMAGE=${NCO_APP_IMAGE:-westvalleyarc/nco-logger:dev}" \
        "NCO_BACKUP_IMAGE=${NCO_BACKUP_IMAGE:-westvalleyarc/nco-logger-backup:dev}" \
        "FRONTEND_NETWORK_NAME=${project}_frontend" \
        'FRONTEND_NETWORK_EXTERNAL=false' \
        'APP_BIND_IP=127.0.0.1' \
        'APP_HOST_PORT=0'
} > "$env_file"

docker compose -p "$project" --env-file "$env_file" up -d --wait mongo app
app_container="$(docker compose -p "$project" --env-file "$env_file" ps -q app)"
docker compose -p "$project" --env-file "$env_file" stop --timeout 15 app
test "$(docker inspect --format '{{.State.ExitCode}}' "$app_container")" -eq 0

docker compose -p "$project" --env-file "$env_file" exec -T -e "RESTORE_DB=$restore_db" mongo sh -eu -c '
    mongosh --quiet \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --eval '\''
        const appUser = process.env.MONGO_APP_USERNAME;
        const restoreDb = process.env.RESTORE_DB;
        db.getSiblingDB("hamlive").updateUser(appUser, { roles: [
          { role: "readWrite", db: "hamlive" },
          { role: "readWrite", db: restoreDb }
        ] });
        const source = db.getSiblingDB("hamlive").integration_restore_test;
        source.createIndex({ key: 1 }, { name: "integration_key_unique", unique: true });
        source.insertMany([{ key: 1, value: "alpha" }, { key: 2, value: "beta" }]);
      '\''
'

docker compose -p "$project" --env-file "$env_file" --profile operations run --rm \
    --entrypoint sh backup -c 'printf %s integration-upload > /uploads/integration-upload.txt'
docker compose -p "$project" --env-file "$env_file" --profile operations run --rm \
    backup backup --production --require-uploads

set -- "$backup_dir"/*.archive.gz
test "$#" -eq 1
archive_name="$(basename "$1")"

docker compose -p "$project" --env-file "$env_file" --profile operations run --rm \
    --entrypoint sh backup -c 'rm -f /uploads/integration-upload.txt; test -z "$(find /uploads -mindepth 1 -print -quit)"'
docker compose -p "$project" --env-file "$env_file" --profile operations run --rm \
    backup restore --archive "/backups/$archive_name" --archive-dbname hamlive \
    --env development --drop --yes --restore-uploads
docker compose -p "$project" --env-file "$env_file" --profile operations run --rm \
    backup verify --source-env production --target-env development
docker compose -p "$project" --env-file "$env_file" --profile operations run --rm \
    --entrypoint sh backup -c 'test "$(cat /uploads/integration-upload.txt)" = integration-upload'

docker compose -p "$project" --env-file "$env_file" exec -T -e "RESTORE_DB=$restore_db" mongo sh -eu -c '
    mongosh --quiet \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --eval '\''
        const restoreDb = process.env.RESTORE_DB;
        const restored = db.getSiblingDB(restoreDb);
        const collections = restored.getCollectionNames();
        const documents = collections.reduce((sum, name) => sum + restored.getCollection(name).countDocuments({}), 0);
        print(JSON.stringify({ database: restoreDb, collections: collections.length, documents }));
        if (restored.integration_restore_test.countDocuments({}) !== 2) quit(4);
        restored.dropDatabase();
      '\''
'

echo "Authenticated Compose startup, graceful SIGTERM, database parity, and upload restore: OK"
