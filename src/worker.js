import dbText from "../db.json";
const db = JSON.parse(dbText);

function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors(), ...headers }
  });
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
  const keySet = new Set(collections);
  const schemas = {};
  const paths = {};

  const singular = (name) => {
    if (name.endsWith("ies")) return name.slice(0, -3) + "y";
    if (name.endsWith("s")) return name.slice(0, -1);
    return name;
  };
  const toSchemaName = (col) => {
    const s = singular(col);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const guessResource = (field) => {
    const base = field.replace(/Ids?$/, "");
    const sPlural = (base + "s").toLowerCase();
    const esPlural = (base + "es").toLowerCase();
    if (keySet.has(sPlural)) return sPlural;
    if (keySet.has(esPlural)) return esPlural;
    return sPlural;
  };

  for (const col of collections) {
    const sample = (state[col] && state[col][0]) || {};
    const properties = {};
    const toOne = [];
    const toMany = [];

    for (const [k, v] of Object.entries(sample)) {
      if (Array.isArray(v)) {
        const first = v[0];
        if (typeof first === "number") properties[k] = { type: "array", items: { type: Number.isInteger(first) ? "integer" : "number" } };
        else if (typeof first === "boolean") properties[k] = { type: "array", items: { type: "boolean" } };
        else if (typeof first === "object") properties[k] = { type: "array", items: { type: "object" } };
        else properties[k] = { type: "array", items: { type: "string" } };
        if (/Ids$/.test(k)) {
          const resource = guessResource(k);
          toMany.push(resource);
          properties[k].description = `Array of foreign keys to ${resource} (use ?_embed=${resource} on detail route)`;
        }
      } else if (v && typeof v === "object") {
        properties[k] = { type: "object" };
      } else {
        properties[k] = toOpenApiType(v);
        if (/Id$/.test(k)) {
          const resource = guessResource(k);
          toOne.push(resource);
          properties[k].description = `Foreign key to ${resource} (use ?_expand=${singular(resource)} on detail route)`;
        }
      }
    }

    const schemaName = toSchemaName(col);
    schemas[schemaName] = { type: "object", properties };

    // List path
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
            content: { "application/json": { schema: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } } } }
          }
        }
      }
    };

    // Detail path
    const allowedExpand = toOne.map((r) => singular(r));
    const allowedEmbed = toMany;
    const expandSchema = allowedExpand.length ? { type: "string", enum: allowedExpand } : { type: "string" };
    const embedSchema = allowedEmbed.length ? { type: "string", enum: allowedEmbed } : { type: "string" };
    paths[`/${col}/{id}`] = {
      get: {
        summary: `Get ${schemaName} by id`,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "_expand", in: "query", schema: expandSchema, description: "Expand to-one relations" },
          { name: "_embed", in: "query", schema: embedSchema, description: "Embed to-many relations" }
        ],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } },
          404: { description: "Not Found" }
        }
      }
    };
  }

  return { openapi: "3.0.3", info: { title: "Mock Sports Coaching API", version: "1.0.0" }, servers: [{ url: origin }], paths, components: { schemas } };
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "*"
  };
}

function text(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...cors(), ...headers } });
}

function buildDocs(state) {
  const docs = {
    title: "Mock Sports Coaching API (Cloudflare Worker)",
    version: "1.0",
    generatedAt: new Date().toISOString(),
    baseUrl: "",
    resources: [],
    tips: [
      "Use ?q=term for full-text search across fields",
      "Use ?_page=1&_limit=10 for pagination",
      "Use ?field=value to filter by equality",
      "Use ?_expand=resource (detail only) to include to-one relations",
      "Use ?_embed=collection (detail only) to include related items"
    ]
  };

  const keys = Object.keys(state).filter((k) => Array.isArray(state[k]));
  const keySet = new Set(keys);

  const guessResource = (field) => {
    const base = field.replace(/Ids?$/, "");
    const sPlural = (base + "s").toLowerCase();
    const esPlural = (base + "es").toLowerCase();
    if (keySet.has(sPlural)) return sPlural;
    if (keySet.has(esPlural)) return esPlural;
    return sPlural;
  };

  for (const col of keys) {
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
        filter: `/${col}?field=value`
      },
      sample
    });
  }

  return docs;
}

function isObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}

function includesText(haystack, needle) {
  const n = String(needle).toLowerCase();
  const scan = (v) => {
    if (v == null) return false;
    if (Array.isArray(v)) return v.some(scan);
    if (isObject(v)) return Object.values(v).some(scan);
    return String(v).toLowerCase().includes(n);
  };
  return scan(haystack);
}

function paginate(arr, page, limit) {
  if (!page || !limit) return arr;
  const p = Math.max(1, Number(page));
  const l = Math.max(1, Number(limit));
  const start = (p - 1) * l;
  return arr.slice(start, start + l);
}

function parseQuery(url) {
  const params = Object.fromEntries(url.searchParams.entries());
  const reserved = new Set(["q", "_page", "_limit", "_expand", "_embed"]);
  const filters = Object.fromEntries(Object.entries(params).filter(([k]) => !reserved.has(k)));
  const expand = url.searchParams.getAll("_expand");
  const embed = url.searchParams.getAll("_embed");
  return { params, filters, expand, embed };
}

function toNumberIfNumeric(v) {
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? n : v;
}

function singular(resource) {
  if (resource.endsWith("ies")) return resource.slice(0, -3) + "y";
  if (resource.endsWith("s")) return resource.slice(0, -1);
  return resource;
}

function resolveToOne(item, expand, state) {
  const result = {};
  for (const e of expand) {
    const idField = `${singular(e)}Id`;
    const target = state[e] || state[`${e}s`] || state[`${e}es`];
    if (!target || !Array.isArray(target)) continue;
    const idVal = item[idField];
    if (idVal == null) continue;
    result[e] = target.find((x) => x.id === idVal) || null;
  }
  return result;
}

function resolveToMany(parentResource, parentId, embed, state) {
  const result = {};
  const fk = `${singular(parentResource)}Id`;
  for (const col of embed) {
    const target = state[col];
    if (!target || !Array.isArray(target)) continue;
    result[col] = target.filter((x) => x[fk] === parentId);
  }
  return result;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return json({
        name: "Mock Sports Coaching API",
        docs: new URL("/docs", url).toString(),
        collections: Object.keys(db).filter((k) => Array.isArray(db[k]))
      });
    }

    if (url.pathname === "/openapi.json") {
      const spec = buildOpenApi(db, url.origin);
      return json(spec);
    }

    if (url.pathname === "/docs") {
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
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...cors() } });
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) {
      const resource = parts[0];
      const collection = db[resource];
      if (Array.isArray(collection)) {
        // List or detail
        if (parts.length === 1) {
          // List with filters, search, pagination
          const { params, filters } = parseQuery(url);
          const q = params.q;
          const page = params._page;
          const limit = params._limit;

          let items = collection.slice();
          // field filters
          for (const [k, v] of Object.entries(filters)) {
            const vv = toNumberIfNumeric(v);
            items = items.filter((it) => it[k] === vv);
          }
          // full-text search
          if (q) {
            items = items.filter((it) => includesText(it, q));
          }

          const total = items.length;
          items = paginate(items, page, limit);
          const headers = { "x-total-count": String(total) };
          return json(items, { headers });
        } else if (parts.length === 2) {
          // Detail with optional expand/embed
          const idStr = parts[1];
          const id = toNumberIfNumeric(idStr);
          const item = collection.find((x) => x.id === id);
          if (!item) return json({ error: "Not found" }, { status: 404 });

          const { expand, embed } = parseQuery(url);
          const toOne = resolveToOne(item, expand, db);
          const toMany = resolveToMany(resource, item.id, embed, db);

          return json({ ...item, ...toOne, ...toMany });
        }
      }
    }

    return text("Not Found", { status: 404 });
  }
};
