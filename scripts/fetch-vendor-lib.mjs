#!/usr/bin/env node

/**
 * Fetches the pre-built ig-frontend-lib from GitHub releases.
 *
 * Version source (in priority order):
 *   1. IG_FRONTEND_LIB_VERSION env var
 *   2. package.json → igDesktop.frontendLibVersion
 *
 * Skips download if vendor/ig-desktop/dist-lib/ig-frontend.js already exists
 * (pass --force to override).
 *
 * Uses GITHUB_TOKEN env var for authenticated requests when available.
 */

import { execSync } from "node:child_process";
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(__dirname, "..");
const VENDOR_DIR = join(PLUGIN_DIR, "vendor", "ig-desktop");
const DIST_LIB_DIR = join(VENDOR_DIR, "dist-lib");
const MARKER_FILE = join(DIST_LIB_DIR, "ig-frontend.js");
const REPO = "inspektor-gadget/ig-desktop";

const force = process.argv.includes("--force");

// --- Resolve version ---

const pkg = JSON.parse(readFileSync(join(PLUGIN_DIR, "package.json"), "utf8"));
const version =
  process.env.IG_FRONTEND_LIB_VERSION ||
  pkg.igDesktop?.frontendLibVersion;

if (!version) {
  console.error(
    "ERROR: No ig-frontend-lib version found. Set IG_FRONTEND_LIB_VERSION or igDesktop.frontendLibVersion in package.json."
  );
  process.exit(1);
}

// --- Skip if already present ---

if (!force && existsSync(MARKER_FILE)) {
  console.log(
    `ig-frontend-lib already present at ${DIST_LIB_DIR} (use --force to re-download)`
  );
  process.exit(0);
}

console.log(`Fetching ig-frontend-lib ${version} from ${REPO}...`);

// --- Download tarball ---

const url = `https://github.com/${REPO}/releases/download/${version}/ig-frontend-lib.tar.gz`;
const headers = {};
if (process.env.GITHUB_TOKEN) {
  headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
}
// GitHub releases redirect to S3 — we need to follow redirects (fetch does this by default)
headers["Accept"] = "application/octet-stream";

const tarballPath = join(PLUGIN_DIR, ".ig-frontend-lib.tar.gz");

const resp = await fetch(url, { headers, redirect: "follow" });
if (!resp.ok) {
  console.error(
    `ERROR: Failed to download ig-frontend-lib.tar.gz (HTTP ${resp.status})`
  );
  console.error(`URL: ${url}`);
  if (resp.status === 404) {
    console.error(
      `Release ${version} may not exist or may not have the ig-frontend-lib.tar.gz asset.`
    );
  }
  process.exit(1);
}

await pipeline(resp.body, createWriteStream(tarballPath));
console.log("Downloaded tarball.");

// --- Extract ---

// Clean existing dist-lib
execSync(`rm -rf "${DIST_LIB_DIR}" "${join(VENDOR_DIR, "metadata.json")}"`, {
  stdio: "inherit",
});

console.log(`Extracting to ${VENDOR_DIR}...`);
mkdirSync(VENDOR_DIR, { recursive: true });
execSync(`tar -xzf "${tarballPath}" -C "${VENDOR_DIR}"`, { stdio: "inherit" });

// Clean up tarball
execSync(`rm -f "${tarballPath}"`);

// --- Rewrite react wrapper imports ---

console.log("Rewriting react wrapper imports...");
const reactSrc = join(VENDOR_DIR, "react", "src");

for (const filename of ["index.ts", "IGProvider.tsx"]) {
  const filepath = join(reactSrc, filename);
  if (existsSync(filepath)) {
    let content = readFileSync(filepath, "utf8");
    content = content.replace(
      /from '@inspektor-gadget\/frontend'/g,
      "from '../../dist-lib/ig-frontend.js'"
    );
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filepath, content);
  }
}

const svelteWrapperPath = join(reactSrc, "SvelteWrapper.tsx");
if (existsSync(svelteWrapperPath)) {
  let content = readFileSync(svelteWrapperPath, "utf8");
  content = content.replace(
    /@inspektor-gadget\/frontend\//g,
    "@inspektor-gadget/ig-desktop/frontend/"
  );
  const { writeFileSync } = await import("node:fs");
  writeFileSync(svelteWrapperPath, content);
}

// --- Check Svelte version ---

const metadataPath = join(VENDOR_DIR, "metadata.json");
if (existsSync(metadataPath)) {
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const libSvelteVersion = metadata.svelteVersion;
    const pluginSvelteVersion = pkg.dependencies?.svelte;

    console.log("");
    console.log(`Svelte version in library:  ${libSvelteVersion || "unknown"}`);
    console.log(`Svelte version in plugin:   ${pluginSvelteVersion || "unknown"}`);

    if (
      libSvelteVersion &&
      pluginSvelteVersion &&
      libSvelteVersion !== pluginSvelteVersion
    ) {
      console.warn(
        "WARNING: Svelte versions differ! Update plugins/ig-desktop/package.json to match."
      );
      console.warn(
        "The plugin's svelte dependency MUST exactly match the version used to compile ig-frontend.js."
      );
    }
  } catch {
    // metadata.json may not have svelteVersion — that's fine
  }
}

// --- Sync dist-lib to node_modules ---
// npm copies vendor/ig-desktop/ at install time, but dist-lib doesn't exist yet.
// Sync it so that imports through node_modules (e.g. CSS) resolve correctly.
// Skip if node_modules/@inspektor-gadget/ig-desktop is a symlink to vendor/ig-desktop
// (e.g. npm linked via file: dependency) — the files are already in the right place.
const nmPkg = join(PLUGIN_DIR, "node_modules", "@inspektor-gadget", "ig-desktop");
const isSymlink = existsSync(nmPkg) && lstatSync(nmPkg).isSymbolicLink();
if (existsSync(nmPkg) && !isSymlink) {
  const nmDistLib = join(nmPkg, "dist-lib");
  execSync(`rm -rf "${nmDistLib}"`, { stdio: "inherit" });
  execSync(`cp -r "${DIST_LIB_DIR}" "${nmDistLib}"`, { stdio: "inherit" });
}

console.log("");
console.log(`Done! ig-frontend-lib ${version} extracted to ${DIST_LIB_DIR}`);
