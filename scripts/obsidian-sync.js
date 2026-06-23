#!/usr/bin/env node
/**
 * Meridian — Obsidian auto-sync
 * Runs on Claude Code Stop hook.
 * Appends a timestamped ping to wiki/hot.md so Obsidian stays live.
 */
const fs = require("fs");
const path = require("path");

const HOT = path.join(process.env.HOME, "Desktop/Vault/wiki/hot.md");
const HISTORY = path.join(process.env.HOME, "Desktop/Vault/Meridian/07 - Build History.md");

if (!fs.existsSync(HOT)) process.exit(0);

const now = new Date().toISOString();
const stamp = `\n<!-- last-sync: ${now} -->`;

// Append/update last-sync comment at bottom of hot.md
let content = fs.readFileSync(HOT, "utf8");
content = content.replace(/\n<!-- last-sync:.*-->$/m, "");
content = content.trimEnd() + stamp + "\n";
fs.writeFileSync(HOT, content);
