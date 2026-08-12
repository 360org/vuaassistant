// Folds the dist-demo Vite output into a single self-contained HTML file
// (dist-demo/vuaassistant-demo.html) suitable for hosting as a static demo.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist-demo");
const html = readFileSync(join(DIST, "index.html"), "utf8");

const scriptSrc = html.match(/<script[^>]*src="\/?([^"]+)"[^>]*>/)?.[1];
const cssHref = html.match(/<link rel="stylesheet"[^>]*href="\/?([^"]+)"/)?.[1];
if (!scriptSrc || !cssHref) {
  throw new Error("could not find bundle references in dist-demo/index.html");
}

// `</script>` inside the bundle would terminate the inline tag; in JS these
// only occur inside string literals, where the escaped form is equivalent.
const js = readFileSync(join(DIST, scriptSrc), "utf8").replaceAll(
  "</script>",
  "<\\/script>",
);
const css = readFileSync(join(DIST, cssHref), "utf8");

const single = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VuaAssistant — Demo</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>
`;

const out = join(DIST, "vuaassistant-demo.html");
writeFileSync(out, single);
console.log(`wrote ${out} (${(single.length / 1024).toFixed(0)} KB)`);
