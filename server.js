"use strict";

const path = require("path");
const fs = require("fs");
const jsonServer = require("json-server");

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "db.json");

const server = jsonServer.create();
const router = jsonServer.router(DB_FILE);
const middlewares = jsonServer.defaults();

server.use(middlewares);
server.use(jsonServer.bodyParser);

function buildDocs(state) {
  const docs = {
    title: "Mock Sports Coaching API",
    version: "1.0",
    generatedAt: new Date().toISOString(),
    baseUrl: "",
    resources: [],
    tips: []
  };

  const collections = Object.keys(state).filter((k) => Array.isArray(state[k]));
  const dbKeysSet = new Set(collections);

  const guessResource = (field) => {
    const base = field.replace(/Ids?$/, "");
    const sPlural = (base + "s").toLowerCase();
    const esPlural = (base + "es").toLowerCase();
    if (dbKeysSet.has(sPlural)) return sPlural;
    if (dbKeysSet.has(esPlural)) return esPlural;
    return sPlural;
  };

  for (const col of collections) {
    const arr = state[col] || [];
    const sample = arr[0] || null;
    const fields = sample ? Object.keys(sample) : [];
    const relationships = [];

    if (sample) {
      for (const f of fields) {
        if (/Id$/.test(f) && typeof sample[f] !== "object") {
          relationships.push({ field: f, type: "to-one", resource: guessResource(f) });
        }
        if (/Ids$/.test(f) && Array.isArray(sample[f])) {
          relationships.push({ field: f, type: "to-many", resource: guessResource(f) });
        }
      }
    }

    docs.resources.push({
      name: col,
      count: arr.length,
      idField: "id",
      fields,
      relationships,
      routes: {
        list: `/${col}`,
        detail: `/${col}/:id`,
        search: `/${col}?q=term`,
        filter: `/${col}?field=value`,
        expand: relationships.filter((r) => r.type === "to-one").map((r) => `/${col}?_expand=${r.resource.slice(0, -1)}`),
        embed: relationships.filter((r) => r.type === "to-many").map((r) => `/${col}?_embed=${r.resource}`)
      },
      sample
    });
  }

  docs.tips = [
    "Use ?_expand=resource to expand to-one relations (e.g., /sessions?_expand=team&_expand=coach)",
    "Use ?_embed=collection to embed to-many relations (e.g., /coaches/1?_embed=teams)",
    "Use ?q=term for full-text search across fields",
    "Use ?_page=1&_limit=10 for pagination"
  ];

  return docs;
}

function toOpenApiType(value) {
  const t = typeof value;
  if (value === null) return { type: "string", nullable: true };
  if (Array.isArray(value)) return { type: "array", items: { type: "string" } };
  if (t === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (t === "boolean") return { type: "boolean" };
  if (t === "object") return { type: "object" };
  return { type: "string" };
}

function buildOpenApi(state, origin) {
  const collections = Object.keys(state).filter((k) => Array.isArray(state[k]));
  const schemas = {};

  for (const col of collections) {
    const sample = (state[col] && state[col][0]) || {};
    const properties = {};
    for (const [k, v] of Object.entries(sample)) {
      if (Array.isArray(v)) {
        const first = v[0];
        if (typeof first === "number") properties[k] = { type: "array", items: { type: Number.isInteger(first) ? "integer" : "number" } };
        else if (typeof first === "boolean") properties[k] = { type: "array", items: { type: "boolean" } };
        else if (typeof first === "object") properties[k] = { type: "array", items: { type: "object" } };
        else properties[k] = { type: "array", items: { type: "string" } };
      } else if (v && typeof v === "object") {
        properties[k] = { type: "object" };
      } else {
        properties[k] = toOpenApiType(v);
      }
    }
    schemas[`${col.slice(0, 1).toUpperCase()}${col.slice(1, -1)}`] = {
      type: "object",
      properties
    };
  }

  const paths = {};
  for (const col of collections) {
    const schemaName = `${col.slice(0, 1).toUpperCase()}${col.slice(1, -1)}`;
    // List
    paths[`/${col}`] = {
      get: {
        summary: `List ${col}`,
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Full-text search" },
          { name: "_page", in: "query", schema: { type: "integer", minimum: 1 }, description: "Page number" },
          { name: "_limit", in: "query", schema: { type: "integer", minimum: 1 }, description: "Items per page" }
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } }
              }
            }
          }
        }
      }
    };
    // Detail
    paths[`/${col}/{id}`] = {
      get: {
        summary: `Get ${schemaName} by id`,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "_expand", in: "query", schema: { type: "string" }, description: "Expand to-one relations (repeatable)" },
          { name: "_embed", in: "query", schema: { type: "string" }, description: "Embed to-many relations (repeatable)" }
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${schemaName}` }
              }
            }
          },
          404: { description: "Not Found" }
        }
      }
    };
  }

  return {
    openapi: "3.0.3",
    info: { title: "Mock Sports Coaching API", version: "1.0.0" },
    servers: [{ url: origin }],
    paths,
    components: { schemas }
  };
}

server.get("/openapi.json", (req, res) => {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    state = router.db.getState();
  }
  const origin = `${req.protocol}://${req.get("host")}`;
  const spec = buildOpenApi(state, origin);
  res.json(spec);
});

server.get("/docs", (req, res) => {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
    </script>
  </body>
</html>`;
  res.set("Content-Type", "text/html; charset=utf-8").send(html);
});

server.use(router);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Mock API with docs running on http://localhost:${PORT}`);
    console.log(`Docs: http://localhost:${PORT}/docs`);
  });
}

module.exports = { server };
