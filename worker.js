import { handleAsNodeRequest } from "cloudflare:node";

let bootPromise;

function isPublicAsset(path) {
  if (
    path === "/admin" ||
    path === "/admin.html" ||
    path === "/api" ||
    path.startsWith("/api/") ||
    path.startsWith("/uploads/") ||
    path.startsWith("/paiement/") ||
    path.startsWith("/abonnement/") ||
    path.startsWith("/pourboire/") ||
    path.startsWith("/_internal/")
  ) {
    return false;
  }

  return path === "/" ||
    path.endsWith(".html") ||
    path.startsWith("/css/") ||
    path.startsWith("/js/") ||
    path.startsWith("/img/") ||
    path.startsWith("/vendor/bootstrap/") ||
    /^\/[^/]+\.(?:ico|svg|png|jpg|jpeg|webp|json|txt|xml|webmanifest)$/i.test(path);
}

async function boot(env) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }

  const bindingsModule = await import("./src/services/cloudflareBindings.js");
  const bindings = bindingsModule.default || bindingsModule;

  bindings.setBindings({
    assets: env.ASSETS,
    photos: env.voyageo_photos
  });

  const configModule = await import("./src/config.js");
  const config = configModule.default || configModule;

  if (!config.sessionSecret) {
    throw new Error("SESSION_SECRET doit être configuré dans les secrets Cloudflare.");
  }

  const dbModule = await import("./src/db/index.js");
  const db = dbModule.default || dbModule;

  await db.init(env.HYPERDRIVE);

  const missing = db.missingFunctions();
  if (missing.length) {
    throw new Error(`Fonctions DB manquantes : ${missing.join(", ")}`);
  }

  const authModule = await import("./src/services/authService.js");
  const authService = authModule.default || authModule;
  await db.withRequest(() => authService.ensureAdmin());

  const appModule = await import("./src/app.js");
  const app = appModule.default || appModule;

  app.createApp().listen(3000);
  // Express est enregistré sur le port 3000.
  return db;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/_internal/")) {
      return new Response("Not Found", { status: 404 });
    }

    if (isPublicAsset(path)) {
      if (path === "/") {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = "/index.html";
        return env.ASSETS.fetch(new Request(indexUrl, request));
      }

      return env.ASSETS.fetch(request);
    }

    const imageMatch = /^\/uploads\/([a-f0-9]{16}\.(?:jpg|png|webp))$/.exec(path);

    if (imageMatch && (request.method === "GET" || request.method === "HEAD")) {
      const object = await env.voyageo_photos.get(imageMatch[1]);

      if (!object) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = new Headers();
      headers.set(
        "Content-Type",
        object.httpMetadata?.contentType || "application/octet-stream"
      );
      headers.set("Cache-Control", "public, max-age=604800");
      headers.set("X-Content-Type-Options", "nosniff");

      return new Response(
        request.method === "HEAD" ? null : object.body,
        { headers }
      );
    }

    if (!bootPromise) {
      bootPromise = boot(env).catch((error) => {
        bootPromise = null;
        throw error;
      });
    }

    const db = await bootPromise;
    return db.withRequest(() => handleAsNodeRequest(3000, request));
  }
};
