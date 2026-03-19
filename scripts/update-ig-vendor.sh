#!/usr/bin/env bash
#
# Updates the vendored @inspektor-gadget/ig-desktop package.
#
# Usage:
#   ./scripts/update-ig-vendor.sh                        # local copy (default: ../../../ig-desktop)
#   ./scripts/update-ig-vendor.sh /path/to/ig-desktop    # local copy from explicit path
#   ./scripts/update-ig-vendor.sh --release v0.3.3       # download from GitHub release
#   ./scripts/update-ig-vendor.sh --release latest        # download latest release

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PLUGIN_DIR/vendor/ig-desktop"
REPO="inspektor-gadget/ig-desktop"

# --- Shared helpers ---

rewrite_react_imports() {
  echo "Rewriting react wrapper imports..."
  local react_src="$VENDOR_DIR/react/src"

  # Runtime imports: '@inspektor-gadget/frontend' → '../../dist-lib/ig-frontend.js'
  for f in "$react_src"/index.ts "$react_src"/IGProvider.tsx; do
    if [[ -f "$f" ]]; then
      sed -i "s|from '@inspektor-gadget/frontend'|from '../../dist-lib/ig-frontend.js'|g" "$f"
    fi
  done

  # JSDoc comment: '@inspektor-gadget/frontend/' → '@inspektor-gadget/ig-desktop/frontend/'
  if [[ -f "$react_src/SvelteWrapper.tsx" ]]; then
    sed -i "s|@inspektor-gadget/frontend/|@inspektor-gadget/ig-desktop/frontend/|g" "$react_src/SvelteWrapper.tsx"
  fi
}

check_svelte_version() {
  local svelte_version="$1"
  local plugin_svelte
  plugin_svelte=$(node -e "console.log(require('$PLUGIN_DIR/package.json').dependencies?.svelte || 'unknown')" 2>/dev/null || echo "unknown")

  echo ""
  echo "Svelte version in source:  $svelte_version"
  echo "Svelte version in plugin:  $plugin_svelte"
  if [[ "$svelte_version" != "unknown" && "$plugin_svelte" != "unknown" && "$svelte_version" != "$plugin_svelte" ]]; then
    echo "WARNING: Svelte versions differ! Update plugins/ig-desktop/package.json to match."
    echo "The plugin's svelte dependency MUST exactly match the version used to compile ig-frontend.js."
  fi
}

clean_vendor() {
  echo "Cleaning vendor directory..."
  rm -rf "$VENDOR_DIR/dist-lib" "$VENDOR_DIR/react/src" "$VENDOR_DIR/metadata.json"
  mkdir -p "$VENDOR_DIR/react/src"
}

# --- Release mode ---

update_from_release() {
  local tag="$1"

  # Require gh CLI
  if ! command -v gh &>/dev/null; then
    echo "ERROR: 'gh' CLI is required for --release mode."
    echo "Install: https://cli.github.com/"
    exit 1
  fi

  # Resolve 'latest' to actual tag
  if [[ "$tag" == "latest" ]]; then
    echo "Resolving latest release..."
    tag=$(gh release view --repo "$REPO" --json tagName --jq '.tagName')
    echo "Latest release: $tag"
  fi

  echo "Downloading ig-frontend-lib.tar.gz from $REPO@$tag..."
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  gh release download "$tag" --repo "$REPO" --pattern "ig-frontend-lib.tar.gz" --dir "$tmpdir"

  if [[ ! -f "$tmpdir/ig-frontend-lib.tar.gz" ]]; then
    echo "ERROR: ig-frontend-lib.tar.gz not found in release $tag"
    echo "The release may not have the frontend library artifact attached."
    exit 1
  fi

  clean_vendor

  echo "Extracting tarball into $VENDOR_DIR..."
  tar -xzf "$tmpdir/ig-frontend-lib.tar.gz" -C "$VENDOR_DIR"

  rewrite_react_imports

  # Read Svelte version from metadata.json
  local svelte_version="unknown"
  if [[ -f "$VENDOR_DIR/metadata.json" ]]; then
    svelte_version=$(node -e "console.log(require('$VENDOR_DIR/metadata.json').svelteVersion)" 2>/dev/null || echo "unknown")
  fi
  check_svelte_version "$svelte_version"

  echo ""
  echo "Running npm install..."
  cd "$PLUGIN_DIR"
  npm install

  echo ""
  echo "Done! Vendored from release $tag. Run 'npm run build' to verify."
}

# --- Local copy mode ---

update_from_local() {
  local ig_repo="$1"
  local ig_frontend="$ig_repo/frontend"

  # Validate source
  if [[ ! -f "$ig_frontend/dist-lib/ig-frontend.js" ]]; then
    echo "ERROR: $ig_frontend/dist-lib/ig-frontend.js not found."
    echo "Run 'npm run build:lib' in $ig_frontend first."
    exit 1
  fi

  echo "Source: $ig_frontend"
  echo "Target: $VENDOR_DIR"
  echo ""

  clean_vendor

  # Copy dist-lib (pre-built library + assets + Monaco chunks)
  echo "Copying dist-lib/..."
  cp -r "$ig_frontend/dist-lib" "$VENDOR_DIR/dist-lib"

  # Copy react wrapper source files
  echo "Copying react wrapper sources..."
  for f in index.ts SvelteWrapper.tsx IGProvider.tsx; do
    if [[ -f "$ig_frontend/react/src/$f" ]]; then
      cp "$ig_frontend/react/src/$f" "$VENDOR_DIR/react/src/$f"
    else
      echo "WARNING: $ig_frontend/react/src/$f not found, skipping"
    fi
  done

  # Ensure package.json exists
  if [[ ! -f "$VENDOR_DIR/package.json" ]]; then
    echo "Creating vendor package.json..."
    cat > "$VENDOR_DIR/package.json" <<'PKGJSON'
{
  "name": "@inspektor-gadget/ig-desktop",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "exports": {
    "./frontend": "./dist-lib/ig-frontend.js",
    "./frontend/react": "./react/src/index.ts",
    "./frontend/dist-lib/*": "./dist-lib/*"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "svelte": "^5.0.0"
  }
}
PKGJSON
  fi

  rewrite_react_imports

  # Check Svelte version from source package.json
  local svelte_version
  svelte_version=$(node -e "console.log(require('$ig_frontend/package.json').devDependencies?.svelte || require('$ig_frontend/package.json').dependencies?.svelte || 'unknown')" 2>/dev/null || echo "unknown")
  check_svelte_version "$svelte_version"

  echo ""
  echo "Running npm install..."
  cd "$PLUGIN_DIR"
  npm install

  echo ""
  echo "Done! Run 'npm run build' to verify."
}

# --- Main ---

if [[ "${1:-}" == "--release" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "ERROR: --release requires a tag argument (e.g. --release v0.3.3 or --release latest)"
    exit 1
  fi
  update_from_release "$2"
else
  update_from_local "${1:-../../../ig-desktop}"
fi
