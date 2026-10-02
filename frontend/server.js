// Dependency-free static file server with SPA fallback.
// Replaces `serve` (which crashes on Railway due to a path-to-regexp hoisting
// conflict) so the runtime has zero npm dependencies to break.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "build");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body) res.end(body);
  else res.end();
}

function sendFile(res, filePath, status) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  // Hashed build assets are immutable; HTML must always revalidate.
  const cache =
    ext === ".html"
      ? "no-cache"
      : filePath.includes(path.sep + "static" + path.sep)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": cache });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    return send(res, 400, {}, "Bad Request");
  }
  if (urlPath.includes("\0")) return send(res, 400, {}, "Bad Request");

  const resolved = path.resolve(ROOT, "." + path.posix.normalize(urlPath));
  // Path-traversal guard: resolved path must stay within ROOT.
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return send(res, 403, {}, "Forbidden");
  }

  fs.stat(resolved, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(res, resolved, 200);
    if (!err && stat.isDirectory()) {
      const indexFile = path.join(resolved, "index.html");
      if (fs.existsSync(indexFile)) return sendFile(res, indexFile, 200);
    }
    // SPA fallback: any unknown route serves index.html (client-side routing).
    const index = path.join(ROOT, "index.html");
    if (fs.existsSync(index)) return sendFile(res, index, 200);
    return send(res, 404, { "Content-Type": "text/plain" }, "Not Found");
  });
});

server.listen(PORT, () => {
  console.log(`Frontend static server listening on 0.0.0.0:${PORT}`);
});
