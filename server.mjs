import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST ?? "127.0.0.1";
const startPort = Number(process.env.PORT ?? 5173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function safePathname(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(root, `.${requested}`);
  const relativePath = path.relative(root, resolved);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolved;
}

async function readStaticFile(filePath) {
  const details = await stat(filePath);

  if (details.isDirectory()) {
    return readStaticFile(path.join(filePath, "index.html"));
  }

  const body = await readFile(filePath);
  const contentType = mimeTypes[path.extname(filePath)] ?? "application/octet-stream";
  return { body, contentType };
}

const server = createServer(async (request, response) => {
  try {
    const filePath = safePathname(request.url ?? "/");

    if (!filePath) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const { body, contentType } = await readStaticFile(filePath);
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch (error) {
    const statusCode = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(statusCode === 404 ? "Not found" : "Server error");
  }
});

function listen(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < startPort + 20) {
      listen(port + 1);
      return;
    }

    throw error;
  });

  server.listen(port, host, () => {
    console.log(`The Quiet Vale prototype is running at http://${host}:${port}/`);
  });
}

listen(startPort);
