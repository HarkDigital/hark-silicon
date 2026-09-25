#!/usr/bin/env bash
# Create a new Hark concept site from this starter.
#
#   scripts/new-site.sh <Name> [slug]
#   e.g. scripts/new-site.sh Greenhouse            → ../Hark Greenhouse, slug hark-greenhouse
#
# Copies the starter (without node_modules/.git/dist), renames the concept
# (SITE in src/content.ts, package.json, index.html title + OG URLs, README),
# installs dependencies and makes the first local commit. It does NOT create
# the GitHub repo or Pages site — the printed commands do that.
set -euo pipefail
NAME="${1:?usage: scripts/new-site.sh <Name> [slug]}"
SLUG="${2:-hark-$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$(dirname "$HERE")/Hark $NAME"
if [ -e "$DEST" ]; then echo "✗ $DEST already exists"; exit 1; fi

echo "→ $DEST  (slug: $SLUG)"
mkdir -p "$DEST"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude shots "$HERE/" "$DEST/"
cd "$DEST"

# rename the concept
sed -i '' "s/name: 'Starter'/name: '$NAME'/; s/slug: 'hark-starter'/slug: '$SLUG'/" src/content.ts
sed -i '' "s/\"name\": \"hark-starter\"/\"name\": \"$SLUG\"/" package.json
sed -i '' "s#hark-starter#$SLUG#g; s#Hark Digital · Starter#Hark Digital · $NAME#g; s#Starter concept#$NAME concept#g" index.html
cat > README.md <<README
# Hark $NAME — concept site

A Hark Digital concept direction, built from \`Hark Concept Starter\`
(see \`../HARK-CONCEPT-PLAYBOOK.md\`).

**Live:** https://harkdigital.github.io/$SLUG/

\`\`\`bash
npm install
npm run dev
npm run build
\`\`\`
README

npm install --silent
git init -q && git branch -M main && git add -A
git commit -qm "Scaffold Hark $NAME from the concept starter"

cat <<NEXT
✓ Created $DEST

Next (from that folder):
  1. Theme it: src/world/World.ts, src/core/post.ts (final pass + cut), src/styles/base.css,
     fonts in src/main.ts, MICROCOPY in src/content.ts, chapters, src/ui/*.
     Add "$NAME" to CONCEPTS in src/content.ts of the starter and future sites once it ships.
  2. Dev servers (pick an unused port pair):
       npx vite --port 5680 --strictPort &
       npx vite --config vite.shots.config.ts --port 5690 --strictPort &
  3. Publish:
       gh repo create HarkDigital/$SLUG --public --source . --remote origin --push
       gh api -X POST repos/HarkDigital/$SLUG/pages -f build_type=workflow
     → https://harkdigital.github.io/$SLUG/
NEXT
