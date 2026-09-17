# Studio Grid — 2D Isometric Room Designer (MERN Prototype)

This is a working prototype of the backend + frontend described in your
proposal, built on the required stack:

- **M**ongoDB (Mongoose)
- **E**xpress.js
- **R**eact (Vite)
- **N**ode.js

It implements every endpoint from your API outline, the JSON document shape
from your data model section, JWT auth, Joi validation, projection on the
dashboard query, and the `userId` index — plus a real React canvas so you
can actually place and rotate furniture on a grid and save it.

```
mern-room-designer/
├── backend/     Node.js + Express + MongoDB API
└── frontend/    React (Vite) app that consumes the API
```

---

## 1. Prerequisites

Install these once, in order:

1. **Node.js 18+** — https://nodejs.org (installing Node also installs `npm`).
   Check it worked: `node -v` and `npm -v`.
2. **MongoDB** — pick one:
   - **Local install**: https://www.mongodb.com/docs/manual/administration/install-community/
     Once installed, make sure the `mongod` service is running.
   - **MongoDB Atlas (free cloud cluster, no local install)**: https://www.mongodb.com/cloud/atlas/register
     Create a free cluster, add a database user, allow your IP, and copy the
     connection string (looks like `mongodb+srv://user:pass@cluster.mongodb.net/room-designer`).

You do **not** need to install Express, React, or Mongoose globally — those
are installed per-project in step 2 via `npm install`.

---

## 2. Backend setup

Open a terminal in `backend/`:

```bash
cd backend
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Open `.env` and fill in two things:

```
MONGO_URI=mongodb://127.0.0.1:27017/room-designer
JWT_SECRET=any_long_random_string_you_make_up
```

- If you're using **Atlas**, paste your Atlas connection string as `MONGO_URI` instead.
- `JWT_SECRET` just needs to be a long, unpredictable string — it's used to sign login tokens.

Seed the furniture catalog (bed, chair, desk, shelving, lamps, plant — this
matches the `GET /api/catalog/items` endpoint from your proposal):

```bash
npm run seed
```

You should see `Seeded 8 catalog items.`

Start the API:

```bash
npm run dev
```

You should see:

```
MongoDB connected -> ...
Room Designer API listening on port 5000
```

Leave this terminal running. Verify it's alive by opening
`http://localhost:5000/api/health` in a browser — you should see `{"status":"ok"}`.

---

## 3. Frontend setup

Open a **second** terminal in `frontend/` (keep the backend running in the first one):

```bash
cd frontend
npm install
npm run dev
```

Vite will print a local URL, typically:

```
Local:   http://localhost:5173/
```

Open that URL in your browser.

---

## 4. Using the prototype

1. **Register** an account on the sign-up screen.
2. You'll land on the **Dashboard** — click **+ New room**.
3. On the canvas screen:
   - Click a catalog item on the left to "arm" it, then click an empty grid
     cell to place it.
   - Click a placed item to select it — you can **rotate it 90°**, **change
     its color**, or **remove** it from the inspector panel on the right.
   - Adjust room **width/length** in the inspector.
   - Click **Save canvas** — this calls `POST /api/rooms` (or `PUT /api/rooms/:id`
     if you're editing an existing one).
4. Go back to the Dashboard — your room now appears in the list, fetched via
   the projected `GET /api/rooms` query (name + dimensions + dates only,
   not the full item array).
5. Click the room again to reopen it via `GET /api/rooms/:id`, which loads
   the full document including `placedItems`.

---

## 5. How this maps back to your proposal

| Proposal section | Where it lives |
|---|---|
| `POST /api/auth/register`, login | `backend/src/routes/authRoutes.js`, `authController.js` — bcrypt-hashed password, JWT issued on success |
| `GET /api/catalog/items` | `catalogRoutes.js` / `catalogController.js` |
| `GET /api/rooms`, `POST /api/rooms`, `PUT /api/rooms/:id` | `roomRoutes.js` / `roomController.js` |
| MVC structure | `models/`, `controllers/`, `routes/` folders |
| Nested JSON document / embedding | `models/Room.js` — `placedItems` is an embedded array, matching your sample document |
| JWT auth + ownership check | `middleware/auth.js` (verifies token) + `roomController.js` (checks `room.userId === req.user.id` on every read/update/delete) |
| Joi input validation | `middleware/validators.js` — validates registration, login, and room payloads (including that `gridX`/`gridY` are real numbers) |
| Projection for dashboard speed | `roomController.getRooms` — `.select('roomName dimensions createdAt updatedAt')` |
| `userId` index | `models/Room.js` — `RoomSchema.index({ userId: 1 })` |

A few things worth knowing about this prototype vs. a production build:

- The frontend's "isometric" look is a CSS transform on a 2D grid (a common,
  lightweight trick) rather than a WebGL/canvas renderer — good enough to
  demonstrate the interaction model, easy to swap out later.
- There's no `DELETE` button wired up in the UI yet, even though the
  endpoint exists in the backend — worth adding to the Dashboard next.
- For a class demo this runs fine locally; for anything public-facing you'd
  want rate limiting on `/api/auth`, HTTPS, and to move `JWT_SECRET` into a
  real secrets manager.

---

## 6. Troubleshooting

- **`Failed to connect to MongoDB`** — MongoDB isn't running (local) or your
  Atlas connection string/IP allowlist is wrong.
- **Frontend loads but API calls fail** — make sure the backend terminal is
  still running on port 5000; Vite's dev proxy (`vite.config.js`) forwards
  `/api/*` to `http://localhost:5000`.
- **`Validation failed` on save** — an item's `gridX`/`gridY` falls outside
  the room's current width/length; shrink the placement or grow the room.
