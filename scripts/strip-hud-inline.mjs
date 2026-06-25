import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, "tactical_hud.html");
let html = fs.readFileSync(file, "utf8");
html = html.replace(
  /<script type="application\/json" id="hud-legacy-placeholder">[\s\S]*?<\/script type="application\/json">/,
  "",
);
fs.writeFileSync(file, html);
console.log("stripped legacy script");
