/** Private dashboard shell. Numbers arrive from /api/admin/stats after the allowlist check. */
export function adminDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex" />
  <title>UhOh Dominoes</title>
  <style>
    :root { color-scheme: dark; --red: #E31E26; --gold: #D5A336; --paper: #EFEFEF; --bg: #141414; --card: #1c1c1c; --muted: #b7b1a6; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--paper); font: 16px/1.4 system-ui, sans-serif; }
    main { width: min(720px, 100%); margin: 0 auto; padding: 16px 14px 32px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; min-width: 0; }
    section, .grid, .bars, .stat { min-width: 0; max-width: 100%; }
    .when { overflow-wrap: anywhere; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h1 { margin: 0; color: var(--gold); font-size: 1.8rem; letter-spacing: 0.04em; }
    h2 { margin: 0 0 8px; color: var(--gold); font-size: 1.15rem; }
    button { min-height: 44px; border: 0; border-radius: 999px; padding: 0 16px; background: var(--red); color: white; font-weight: 700; }
    .when { margin: 0; color: var(--muted); font-size: 0.85rem; }
    section { background: var(--card); border: 1px solid rgba(213, 163, 54, 0.35); border-radius: 16px; padding: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .stat { background: #111; border-radius: 12px; padding: 8px 10px; min-height: 64px; }
    .stat b { display: block; font-size: 1.35rem; }
    .stat span { color: var(--muted); font-size: 0.78rem; }
    .bars { display: flex; align-items: end; gap: 3px; height: 96px; overflow-x: auto; padding-top: 16px; }
    .bars i { flex: 0 0 12px; background: var(--red); border-radius: 4px 4px 0 0; min-height: 2px; position: relative; }
    .bars i em { position: absolute; top: -14px; left: 0; font-style: normal; font-size: 0.6rem; color: var(--muted); }
    .cap { display: inline-block; min-width: 72px; text-align: center; border-radius: 999px; padding: 6px 10px; font-weight: 700; }
    .cap.green { background: #1f7a3a; }
    .cap.yellow { background: var(--gold); color: #1a1204; }
    .cap.red { background: var(--red); }
    ul { margin: 8px 0 0; padding-left: 18px; }
    .err { color: var(--red); }
    @media (max-width: 380px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>UhOh</h1>
      <button type="button" id="refresh">Refresh</button>
    </header>
    <p class="when" id="when">Loading…</p>
    <p class="err" id="err" hidden></p>
    <div id="out"></div>
  </main>
  <script>
    const out = document.getElementById("out");
    const when = document.getElementById("when");
    const err = document.getElementById("err");
    function stat(label, value) {
      const el = document.createElement("div");
      el.className = "stat";
      const b = document.createElement("b");
      b.textContent = value == null ? "—" : String(value);
      const s = document.createElement("span");
      s.textContent = label;
      el.append(b, s);
      return el;
    }
    function grid(pairs) {
      const el = document.createElement("div");
      el.className = "grid";
      for (const [label, value] of pairs) el.append(stat(label, value));
      return el;
    }
    function bars(rows) {
      const el = document.createElement("div");
      el.className = "bars";
      const max = Math.max(1, ...rows.map((row) => row.n));
      for (const row of rows) {
        const i = document.createElement("i");
        i.style.height = Math.max(2, Math.round((row.n / max) * 80)) + "px";
        i.title = row.day + ": " + row.n;
        if (row.n) {
          const em = document.createElement("em");
          em.textContent = String(row.n);
          i.append(em);
        }
        el.append(i);
      }
      return el;
    }
    function section(title, ...nodes) {
      const el = document.createElement("section");
      const h = document.createElement("h2");
      h.textContent = title;
      el.append(h, ...nodes);
      return el;
    }
    function list(items) {
      const ul = document.createElement("ul");
      for (const item of items) {
        const li = document.createElement("li");
        li.textContent = item;
        ul.append(li);
      }
      return ul;
    }
    function pct(rate) { return rate == null ? "—" : Math.round(rate * 100) + "%"; }
    function money(cents) { return "$" + (cents / 100).toFixed(2); }
    function mb(bytes) { return bytes == null ? "—" : (bytes / (1024 * 1024)).toFixed(1) + " MB"; }
    function draw(data) {
      const p = data.players, g = data.gameplay, e = data.economy, s = data.safety, h = data.health;
      const cap = document.createElement("p");
      const pill = document.createElement("span");
      pill.className = "cap " + h.capacity;
      pill.textContent = h.capacity + " · " + h.playingTables + " busy tables";
      cap.append(pill);
      out.replaceChildren(
        section("Players", grid([
          ["Accounts", p.accounts], ["Guests", p.guests], ["Signed in", p.signedIn],
          ["Google", p.google], ["Email", p.email], ["Apple", p.apple],
          ["Active today", p.activeToday], ["Active 7 days", p.activeWeek],
          ["Came back", pct(p.returningRate)], ["Online now", p.onlineNow],
        ]), bars(p.newPerDay), list(p.recent.length ? p.recent : ["No signed-in players yet."])),
        section("Gameplay", grid([
          ["Tables open", g.tablesOpen], ["Tables playing", g.tablesPlaying],
          ["Humans seated", g.humanSeats], ["Computers seated", g.botSeats],
          ["Quick rooms", g.quickRooms], ["Friend rooms", g.friendRooms],
          ["Series finished", g.seriesFinished], ["Series abandoned", g.seriesAbandoned],
          ["Games won", g.gamesWon], ["Finished rate", pct(g.completionRate)],
          ["Avg humans", g.averageHumans], ["Avg match min", g.averageMatchSeconds == null ? null : Math.round(g.averageMatchSeconds / 60)],
          ["Text-a-friend taps", g.shareTaps],
        ]), bars(g.handsPerDay)),
        section("Retention", grid([
          ["Day 1 cohort", data.retention.day1 && data.retention.day1.cohort],
          ["Day 1 back", pct(data.retention.day1 && data.retention.day1.rate)],
          ["Day 7 cohort", data.retention.day7 && data.retention.day7.cohort],
          ["Day 7 back", pct(data.retention.day7 && data.retention.day7.rate)],
        ])),
        section("Store", grid([
          ["Shop", e.shopMode], ["Bones earned", e.bonesEarned], ["Bones held", e.bonesHeld], ["Gold Bones held", e.goldHeld],
        ]), list(e.purchases.length ? e.purchases.map((row) => row.pack + " · " + row.count + " · " + money(row.cents) + " (" + e.shopMode + ")") : ["No purchases yet."]), list(e.characters.length ? e.characters.map((row) => row.name + " · " + row.count) : ["No one has a saved look yet."])),
        section("Safety", grid([
          ["Reports", s.reports], ["Blocks", s.blocks], ["Age gate stopped", s.ageBlocked], ["Accounts deleted", s.accountsDeleted],
        ])),
        section("Server", cap, grid([
          ["Up minutes", Math.round(h.uptimeSeconds / 60)], ["Memory MB", h.memoryMb],
          ["CPU % of one core", h.cpuPercent], ["Sockets", h.sockets],
          ["Errors today", h.errorsToday], ["Errors this boot", h.errorsSinceBoot],
          ["Backups", h.backupCount], ["Database", mb(h.databaseBytes)],
          ["Disk used", mb(h.diskBytes)], ["Disk size", mb(h.diskTotalBytes)],
        ]), list([h.commit ? "Commit " + h.commit.slice(0, 7) : "Commit not recorded", h.lastBackupAt ? "Last snapshot " + h.lastBackupAt : "No snapshot yet"])),
        section("Not measured", list(data.omitted)),
      );
    }
    async function load() {
      err.hidden = true;
      when.textContent = "Loading…";
      const response = await fetch("/api/admin/stats", { headers: { accept: "application/json" } });
      if (!response.ok) {
        err.hidden = false;
        err.textContent = response.status === 401 ? "Sign in, then open this page again." : "Not found.";
        when.textContent = "";
        return;
      }
      const data = await response.json();
      when.textContent = "Updated " + new Date(data.generatedAt).toLocaleString() + ". Numbers refresh about once a minute.";
      draw(data);
    }
    document.getElementById("refresh").addEventListener("click", () => { void load(); });
    void load();
  </script>
</body>
</html>`;
}

export function adminSignInHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>UhOh Dominoes</title>
  <style>
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #141414; color: #EFEFEF; font: 18px/1.4 system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); }
    a { color: #D5A336; }
    h1 { color: #E31E26; font-size: 1.6rem; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in</h1>
    <p>Sign in on the home page with the email on your account, then open this page again.</p>
    <p><a href="/">Go to the home page</a></p>
  </main>
</body>
</html>`;
}
