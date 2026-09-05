#!/usr/bin/env bash
# Compare a source database with a safely restored temporary target.
# Usage: ./validate_restore.sh <SOURCE_MONGO_URI_WITH_DB> <TARGET_MONGO_URI_WITH_DB>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <SOURCE_MONGO_URI_WITH_DB> <TARGET_MONGO_URI_WITH_DB>" >&2
  exit 2
fi

source_uri=$1
target_uri=$2
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT

snapshot_js='const names=db.getCollectionInfos({type:"collection"}).map(c=>c.name).sort(); if(!names.length){quit(12)}; const result={}; for(const name of names){result[name]={count:db.getCollection(name).countDocuments({}),indexes:db.getCollection(name).getIndexes().map(i=>i.name).sort()}}; print(JSON.stringify(result))'

if ! mongosh "$source_uri" --quiet --eval "$snapshot_js" > "$work_dir/source.json"; then
  echo 'Source database inspection failed or contained zero collections.' >&2
  exit 3
fi
if ! mongosh "$target_uri" --quiet --eval "$snapshot_js" > "$work_dir/target.json"; then
  echo 'Target database inspection failed or contained zero collections.' >&2
  exit 4
fi

node - "$work_dir/source.json" "$work_dir/target.json" <<'NODE'
const fs = require('node:fs');
const [sourceFile, targetFile] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
let failures = 0;
for (const name of Object.keys(source).sort()) {
  if (!target[name]) {
    console.error(`MISSING collection: ${name}`);
    failures += 1;
    continue;
  }
  const countOk = source[name].count === target[name].count;
  const indexesOk = JSON.stringify(source[name].indexes) === JSON.stringify(target[name].indexes);
  console.log(`${name}: count ${target[name].count} (${countOk ? 'OK' : `expected ${source[name].count}`}), indexes ${indexesOk ? 'OK' : 'DIFF'}`);
  if (!countOk || !indexesOk) failures += 1;
}
for (const name of Object.keys(target)) {
  if (!source[name]) {
    console.error(`UNEXPECTED collection: ${name}`);
    failures += 1;
  }
}
if (failures) {
  console.error(`Restore validation failed: ${failures} collection difference(s).`);
  process.exit(5);
}
console.log(`Restore validation passed for ${Object.keys(source).length} collections.`);
NODE
