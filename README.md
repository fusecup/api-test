# Mock Sports Coaching API

A realistic mock API for a mobile coaching app. Use it locally with json-server and deploy to Cloudflare Workers. The dataset models coaches, teams, athletes, training sessions, workouts, metrics, measurements, devices, injuries, events, and messaging.

## Quick start

- Local API (json-server)
  - Install deps (updates lockfile):
    - `pnpm install`
  - Start:
    - `pnpm api`
  - Base URL: `http://localhost:3000`

- Cloudflare Worker (dev + deploy)
  - Dev:
    - `pnpm cf:dev` → `http://127.0.0.1:8787`
  - Deploy:
    - `pnpm cf:deploy` → publishes to Workers
  - Docs (Worker only):
    - Swagger UI: `/docs`
    - OpenAPI JSON: `/openapi.json`

Note: json-server is Node-only and doesn’t run on Workers. The Worker implements read-only endpoints and the same query patterns (search, filters, pagination, expand/embed on detail).

## Data model overview and relations

Top-level collections (arrays) in `db.json`:
- `users`
  - Fields: `id`, `name`, `role` (coach|athlete), `email`, `username`, `avatar`, optional `coachId` or `athleteId`.
  - Relations: `users.coachId → coaches.id`, `users.athleteId → athletes.id`.

- `coaches`
  - Fields: `id`, `name`, `email`, `specialty`, `bio`, `teamIds[]`.
  - Relations: `coaches.teamIds[] → teams.id`.

- `teams`
  - Fields: `id`, `name`, `sport`, `level`, `coachId`, `season`, colors.
  - Relations: `teams.coachId → coaches.id`.

- `athletes`
  - Fields: `id`, `name`, `email`, `teamId`, bio and physio fields.
  - Relations: `athletes.teamId → teams.id`.

- `exercises`
  - Standalone exercise catalog.

- `workouts`
  - Fields: `id`, `name`, `focus`, `level`, `duration_min`, `notes`, `exercises[]`.
  - Each item in `workouts.exercises[]` contains `exerciseId` referencing `exercises.id` plus prescription (sets, reps, intensity, rest).
  - Relations: implicit `workouts.exercises[].exerciseId → exercises.id`.

- `sessions`
  - Fields: `id`, `date`, `teamId`, `coachId`, `workoutId`, `location`, `status`, `athleteIds[]`, `weather`, `summary`.
  - Relations: `sessions.teamId → teams.id`, `sessions.coachId → coaches.id`, `sessions.workoutId → workouts.id`, `sessions.athleteIds[] → athletes.id`.

- `metrics`
  - Catalog of measurable quantities (e.g., `bodyweight_kg`, `rpe`, `max_speed_ms`, `time_100m_s`, `jump_height_cm`).

- `measurements`
  - Fields: `id`, `athleteId`, `metricId`, `sessionId?`, `value`, `timestamp`, `source`.
  - Relations: `measurements.athleteId → athletes.id`, `measurements.metricId → metrics.id`, `measurements.sessionId → sessions.id`.

- `devices`
  - Fields: `id`, `athleteId`, `type`, `model`, `serial`, `pairedAt`.
  - Relations: `devices.athleteId → athletes.id`.

- `deviceReadings`
  - Fields: `id`, `deviceId`, `athleteId`, `type`, `sessionId?`, `timestamp`, `data{}`.
  - Relations: `deviceReadings.deviceId → devices.id`, `deviceReadings.athleteId → athletes.id`, `deviceReadings.sessionId → sessions.id`.

- `injuries`
  - Fields: `id`, `athleteId`, `type`, `severity`, `onset`, `status`, `notes`.
  - Relations: `injuries.athleteId → athletes.id`.

- `rehabPlans`
  - Fields: `id`, `injuryId`, `title`, `phases[]`, `checkpoints[]`.
  - Relations: `rehabPlans.injuryId → injuries.id`, checkpoints may reference `metricId → metrics.id`.

- `events`
  - Fields: `id`, `type`, `title`, `teamId`, `sessionId?`, `location`, `start`, `end`.
  - Relations: `events.teamId → teams.id`, `events.sessionId → sessions.id`.

- `messages`
  - Fields: `id`, `threadId`, `senderUserId`, `receiverUserId`, `body`, `sentAt`.
  - Relations: `messages.senderUserId → users.id`, `messages.receiverUserId → users.id`.

- `notifications`
  - Fields: `id`, `userId`, `type`, `title`, `body`, `read`, `createdAt`.
  - Relations: `notifications.userId → users.id`.

- `goals`
  - Fields: `id`, `athleteId`, `title`, `targetMetricId`, `targetValue`, `dueDate`, `status`, `progress`.
  - Relations: `goals.athleteId → athletes.id`, `goals.targetMetricId → metrics.id`.

- `achievements`
  - Fields: `id`, `athleteId`, `title`, `description`, `achievedAt`.
  - Relations: `achievements.athleteId → athletes.id`.

- `appConfig`
  - App-level configuration. No relations.

## API patterns

- Lists
  - `GET /<resource>`
  - Search: `?q=term`
  - Field filters: `?<field>=<value>`
  - Pagination: `?_page=1&_limit=10`

- Detail
  - `GET /<resource>/<id>`
  - Expand to-one: `?_expand=<singular-related>` (e.g., `/sessions/1?_expand=team&_expand=coach&_expand=workout`)
  - Embed to-many: `?_embed=<collection>` (e.g., `/coaches/1?_embed=teams`)

- Common examples
  - Sessions with relations: `/sessions/1?_expand=team&_expand=coach&_expand=workout`
  - Session metrics embedded: `/sessions/1?_embed=measurements&_embed=deviceReadings`
  - Measurements for athlete + metric: `/measurements?athleteId=1&metricId=5`
  - Coach and their teams: `/coaches/1?_embed=teams`

Note: json-server supports `_expand`/`_embed`; the Worker implements compatible behavior on detail routes and supports list filters, search, and pagination.

## Mobile app architecture guidance

Focus: simple, robust data layer; relationship-aware fetching; caching and pagination.

- Data layer
  - Create a typed API client (e.g., using `fetch` or Axios) exposing:
    - `list(resource, { q, page, limit, filters })`
    - `detail(resource, id, { expand, embed })`
  - Normalize data by resource and `id` for local caching.
  - Consider React Query/RTK Query for caching, retries, and background refresh.

- Types and mapping
  - Define TypeScript interfaces per resource (e.g., `Athlete`, `Session`, `Measurement`).
  - Map `*_Id` to relations in your models. For example:
    - `Session.teamId → Team`
    - `Session.athleteIds[] → Athlete[]`
    - `Measurement.metricId → Metric`

- Fetch strategies
  - Lists: `GET /sessions?_page=1&_limit=20` with optional `q` and field filters.
  - Details with relations: `GET /sessions/{id}?_expand=team&_expand=coach&_expand=workout&_embed=measurements&_embed=deviceReadings`.
  - For dashboards, prefetch key collections in parallel (e.g., `athletes`, `metrics`) to resolve references quickly.

- UI composition
  - Screens
    - Sessions List → Detail
    - Athlete Profile (latest measurements, injuries, goals)
    - Coach/Team overview
  - Components
    - Measurement list with filter by `metricId`
    - Workout viewer uses `workouts.exercises[].exerciseId` to render exercise metadata

- Pagination & search
  - Keep pagination cursors locally (`page`, `limit`); append or replace based on UX.
  - Debounce search (`q`) to reduce requests.

- Offline/cache
  - Cache by resource and `id`; hydrate from cache before fetching.
  - Background refetch on focus or interval.

- Errors & telemetry
  - Standardize error handling and empty states.
  - Surface `x-total-count` from list responses for pagers.

- Environment targets
  - Local: `http://localhost:3000`
  - Cloudflare dev: `http://127.0.0.1:8787`
  - Production Worker URL: `https://<your-worker>.workers.dev`

## Example client code (TypeScript, fetch)

```ts
type Query = Record<string, string | number | boolean | string[]>;

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';

function qs(params: Query = {}): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => search.append(k, String(x)));
    else if (v !== undefined) search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export async function list<T>(resource: string, params?: Query): Promise<T[]> {
  const res = await fetch(`${BASE}/${resource}${qs(params)}`);
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json();
}

export async function detail<T>(resource: string, id: number | string, params?: Query): Promise<T> {
  const res = await fetch(`${BASE}/${resource}/${id}${qs(params)}`);
  if (!res.ok) throw new Error(`Detail failed: ${res.status}`);
  return res.json();
}

// Example: get session with relations
// detail('sessions', 1, { _expand: ['team', 'coach', 'workout'], _embed: ['measurements', 'deviceReadings'] })
```

## Contributing / modifying data

- Edit `db.json`. The Worker reads it at build time; json-server watches it live.
- If you add new collections or fields, relations are inferred if you follow the `*Id` / `*Ids` naming convention.

## Deploy notes

- Commit the lockfile for CI builds:
  - `pnpm install`
  - `git add pnpm-lock.yaml`
  - `git commit -m "chore: lockfile" && git push`
- Deploy Worker:
  - `pnpm cf:deploy`

## License

For internal prototyping and demo purposes.
