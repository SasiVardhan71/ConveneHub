// ─────────────────────────────────────────────────────────────
//  ConveneHub – frontend (MongoDB-backed)
//  All data operations go through the Express/Mongoose API.
//  UI templates, CSS classes, and visual behaviour are unchanged.
// ─────────────────────────────────────────────────────────────

const API = "http://localhost:5000";

// ── Session state (only non-DB values live here) ─────────────
let state = {
  currentUser: null,   // full user object from server
  view: "dashboard",
  // local mirrors – refreshed from server on every navigation
  events:    [],
  tickets:   [],
  referrals: [],
  users:     [],       // populated for admin / checkin views
};

let authMode = "login";

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

// ── Tiny session persistence (only user + view) ──────────────
function saveSession() {
  sessionStorage.setItem("ch_user", JSON.stringify(state.currentUser));
  sessionStorage.setItem("ch_view", state.view);
}

function loadSession() {
  try {
    const u = sessionStorage.getItem("ch_user");
    if (u) state.currentUser = JSON.parse(u);
    state.view = sessionStorage.getItem("ch_view") || "dashboard";
  } catch { /* ignore */ }
}

// ── API helpers ───────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  return res.json();
}

const GET  = (path)        => api("GET",  path);
const POST = (path, body)  => api("POST", path, body);

// ── Data refresh helpers ──────────────────────────────────────
async function refreshEvents() {
  state.events = await GET("/events");
}

async function refreshTickets() {
  if (!state.currentUser) { state.tickets = []; return; }
  state.tickets = await GET(`/tickets/${state.currentUser._id}`);
}

async function refreshReferrals() {
  if (!state.currentUser) { state.referrals = []; return; }
  state.referrals = await GET(`/referrals/${state.currentUser._id}`);
}

async function refreshAllTickets() {
  // Used by organiser/admin check-in view — single admin endpoint call
  const data = await GET("/admin/tickets");
  state.tickets = Array.isArray(data) ? data : [];
}

async function refreshUsers() {
  const data = await GET("/admin/users");
  state.users = Array.isArray(data) ? data : [];
}

// ── Utility ───────────────────────────────────────────────────
function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function currentUser() {
  return state.currentUser;
}

function roleLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initials(name) {
  return String(name || "User")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function posterDataUri(title, campus, colorA = "#216869", colorB = "#f2b705") {
  const safeTitle  = String(title  || "ConveneHub").replace(/[<>&"]/g, "");
  const safeCampus = String(campus || "Campus Event").replace(/[<>&"]/g, "");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${colorA}" offset="0"/>
          <stop stop-color="${colorB}" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="960" height="540" fill="url(#bg)"/>
      <circle cx="780" cy="90" r="150" fill="#ffffff" opacity=".16"/>
      <circle cx="140" cy="460" r="190" fill="#ffffff" opacity=".14"/>
      <path d="M76 108h808v324H76z" fill="none" stroke="#fff" stroke-width="8" opacity=".42"/>
      <path d="M128 372c170-82 284 72 432-12 96-55 166-88 286-46" fill="none" stroke="#fff" stroke-width="18" opacity=".36"/>
      <text x="96" y="122" fill="#fff" font-family="Arial, sans-serif" font-size="28" font-weight="700">${safeCampus}</text>
      <text x="96" y="270" fill="#fff" font-family="Arial, sans-serif" font-size="68" font-weight="800">${safeTitle}</text>
      <text x="96" y="330" fill="#fff" font-family="Arial, sans-serif" font-size="30" font-weight="700">ConveneHub Event Pass</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Normalise MongoDB _id → id so templates work with both old and new data shapes
function norm(obj) {
  if (!obj) return obj;
  return { ...obj, id: obj._id || obj.id };
}

function eventById(id) {
  return state.events.find((e) => e._id === id || e.id === id);
}

function tierById(event, tierId) {
  return event?.tiers?.find((t) => (t._id || t.id) === tierId);
}

function userById(id) {
  return state.users.find((u) => u._id === id || u.id === id);
}

function visibleEvents() {
  const user = currentUser();
  if (!user) return [];
  if (user.role === "admin" || user.role === "attendee" || user.role === "promoter") return state.events;
  return state.events.filter((e) => e.organizerId === (user._id || user.id));
}

function eventTickets(eventId) {
  return state.tickets.filter((t) => t.eventId === eventId);
}

function eventRevenue(eventId) {
  return eventTickets(eventId).reduce((total, ticket) => {
    const event = eventById(ticket.eventId);
    return total + Number(tierById(event, ticket.tierId)?.price || 0);
  }, 0);
}

function promoterCommission(referral) {
  const event = eventById(referral.eventId);
  const soldTickets = state.tickets.filter((t) => t.referralCode === referral.code);
  const revenue = soldTickets.reduce((sum, t) => sum + Number(tierById(event, t.tierId)?.price || 0), 0);
  return {
    count: soldTickets.length,
    revenue,
    commission: Math.round((revenue * referral.commissionPercent) / 100),
  };
}

// ── Navigation ────────────────────────────────────────────────
async function setView(view) {
  state.view = view;
  saveSession();
  await loadViewData(view);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadViewData(view) {
  const user = currentUser();
  if (!user) return;

  // Always refresh events (they underpin everything)
  await refreshEvents();

  if (view === "tickets") {
    await refreshTickets();
  } else if (view === "promoters") {
    await refreshReferrals();
    // Need all tickets to compute commission counts
    await refreshAllTicketsForPromoter();
  } else if (view === "checkin" || view === "admin") {
    await refreshUsers();
    await refreshAllTickets();
  } else if (view === "dashboard") {
    await refreshTickets();
    await refreshReferrals();
    if (user.role === "admin" || user.role === "organizer") {
      await refreshUsers();
      await refreshAllTickets();
    }
  }
}

async function refreshAllTicketsForPromoter() {
  // Promoter needs all tickets to compute how many used their referral code.
  // Reuse refreshUsers + refreshAllTickets path.
  await refreshUsers();
  await refreshAllTickets();
}

// ── Toast ─────────────────────────────────────────────────────
function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const app = document.querySelector("#app");
  const user = currentUser();

  if (!user) {
    app.innerHTML = authTemplate();
    bindAuth();
    return;
  }

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">CH</div>
          <div>
            <h1>ConveneHub</h1>
            <p>Campus event operations</p>
          </div>
        </div>
        <div class="topbar-right">
          <nav class="nav">
            ${navButton("dashboard", "Dashboard")}
            ${navButton("events", "Events")}
            ${user.role === "attendee"                              ? navButton("tickets",   "Tickets")   : ""}
            ${user.role === "promoter"                             ? navButton("promoters", "Promoter")  : ""}
            ${user.role === "organizer" || user.role === "admin"   ? navButton("checkin",   "Check-in")  : ""}
            ${user.role === "admin"                                ? navButton("admin",     "Admin")     : ""}
          </nav>
          <div class="account-chip">
            <span class="avatar">${initials(user.name)}</span>
            <span><b>${user.name}</b><small>${roleLabel(user.role)} · ${user.campus}</small></span>
          </div>
          <button class="ghost logout-button" data-action="logout">Logout</button>
        </div>
      </header>
      <main class="main">${viewTemplate(user)}</main>
    </div>
  `;
  bindApp();
  requestAnimationFrame(() => window.scrollTo({ top: 0 }));
}

function navButton(view, label) {
  return `<button class="tab ${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

// ── Auth templates ────────────────────────────────────────────
function authTemplate() {
  return `
    <main class="auth-page">
      <section class="auth-copy">
        <div class="brand">
          <div class="brand-mark">CH</div>
          <div>
            <h1>ConveneHub</h1>
            <p>Event command center</p>
          </div>
        </div>
        <h2>Run campus events with the confidence of a real operations team.</h2>
        <p>Create events, sell tickets, manage referrals, and move check-ins through a clean workspace built for fast college demos.</p>
      </section>
      <section class="auth-card">
        <span class="eyebrow dark">${authMode === "login" ? "Welcome back" : "New workspace"}</span>
        <h3>${authMode === "login" ? "Sign in" : "Create account"}</h3>
        <form class="form" id="authForm">
          ${authMode === "register" ? field("name", "Name", "text", "Your name") : ""}
          ${field("email", "Email", "email", "Enter your email")}
          ${field("password", "Password", "password", "Enter password")}
          ${authMode === "register" ? `
            <div class="grid two">
              ${selectField("role", "Role", ["attendee", "organizer", "promoter", "admin"])}
              ${field("campus", "Campus", "text", "North Campus")}
            </div>` : ""}
          <button class="primary" type="submit">${authMode === "login" ? "Sign in" : "Create account"}</button>
          <button class="ghost" type="button" data-action="toggleAuth">
            ${authMode === "login" ? "Need an account?" : "Already have an account?"}
          </button>
        </form>
      </section>
    </main>
  `;
}

// ── Field helpers (unchanged) ─────────────────────────────────
function field(name, label, type = "text", placeholder = "", value = "", required = true) {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <input id="${name}" name="${name}" type="${type}" placeholder="${placeholder}" value="${value}" ${required ? "required" : ""} />
    </div>
  `;
}

function selectField(name, label, options, value = "") {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <select id="${name}" name="${name}">
        ${options.map((o) => `<option value="${o}" ${o === value ? "selected" : ""}>${roleLabel(o)}</option>`).join("")}
      </select>
    </div>
  `;
}

// ── View router ───────────────────────────────────────────────
function viewTemplate(user) {
  if (state.view === "events")    return eventsTemplate(user);
  if (state.view === "tickets")   return ticketsTemplate(user);
  if (state.view === "promoters") return promotersTemplate(user);
  if (state.view === "checkin")   return checkinTemplate();
  if (state.view === "admin")     return adminTemplate();
  return dashboardTemplate(user);
}

// ── Dashboard ─────────────────────────────────────────────────
function dashboardTemplate(user) {
  const events   = visibleEvents();
  const tickets  = user.role === "attendee"
    ? state.tickets.filter((t) => t.userId === (user._id || user.id))
    : state.tickets;
  const revenue  = events.reduce((sum, e) => sum + eventRevenue(e._id || e.id), 0);
  const checked  = tickets.filter((t) => t.checkedIn).length;
  const referrals = state.referrals.filter(
    (r) => user.role !== "promoter" || r.userId === (user._id || user.id)
  );
  const promoterSales = referrals.reduce((sum, r) => sum + promoterCommission(r).count, 0);
  const nextEvent = events.slice().sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  return `
    <section class="page-hero">
      <div>
        <span class="eyebrow">${roleLabel(user.role)} workspace</span>
        <h2>Welcome back, ${user.name.split(" ")[0]}</h2>
        <p>Your live snapshot for bookings, attendance, revenue, and promoter activity across campus events.</p>
      </div>
      <div class="hero-mini">
        <span>Next event</span>
        <strong>${nextEvent ? nextEvent.title : "No event scheduled"}</strong>
        <small>${nextEvent ? `${nextEvent.date} · ${nextEvent.venue}` : "Create an event to begin"}</small>
      </div>
    </section>
    <section class="grid four">
      <div class="metric"><span class="metric-icon">EV</span><strong>${events.length}</strong><span>Events</span></div>
      <div class="metric"><span class="metric-icon blue">TK</span><strong>${tickets.length}</strong><span>Tickets</span></div>
      <div class="metric"><span class="metric-icon gold">₹</span><strong>${money(revenue)}</strong><span>Revenue</span></div>
      <div class="metric"><span class="metric-icon coral">IN</span><strong>${checked}</strong><span>Checked in</span></div>
    </section>
    <section class="grid two">
      <div class="panel">
        <div class="section-title">
          <div><h2>Event Performance</h2><p>Revenue generated by each event.</p></div>
        </div>
        <div class="chart">
          ${events.map((ev) => {
            const eid = ev._id || ev.id;
            const max = Math.max(...events.map((e) => eventRevenue(e._id || e.id)), 1);
            const height = Math.max(8, Math.round((eventRevenue(eid) / max) * 150));
            return `<div class="bar"><span style="height:${height}px"></span><b>${money(eventRevenue(eid))}</b><small>${ev.title}</small></div>`;
          }).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="section-title">
          <div><h2>Quick Summary</h2><p>Key signals from the current event workspace.</p></div>
        </div>
        <div class="list">
          <div class="card"><b>Attendance rate</b><div class="progress"><span style="width:${tickets.length ? (checked / tickets.length) * 100 : 0}%"></span></div><span class="muted">${checked} of ${tickets.length} tickets checked in</span></div>
          <div class="card"><b>Promoter sales</b><span>${promoterSales} tickets sold using referral codes.</span></div>
          <div class="card"><b>Workspace data</b><span>Data is stored in MongoDB and persists across sessions.</span></div>
        </div>
      </div>
    </section>
  `;
}

// ── Events ────────────────────────────────────────────────────
function eventsTemplate(user) {
  return `
    <section class="page-hero compact">
      <div>
        <span class="eyebrow">Event operations</span>
        <h2>Publish beautiful events and track every seat</h2>
        <p>Poster-led listings, ticket tiers, campus details, referral sales, and attendance status in one place.</p>
      </div>
    </section>
    <section class="workspace-grid ${user.role === "organizer" || user.role === "admin" ? "with-form" : ""}">
      ${user.role === "organizer" || user.role === "admin" ? `
        <div class="panel create-panel">
          <div class="section-title">
            <div><h2>Create Event</h2><p>Define the campus, venue, seats, poster, and ticket tiers.</p></div>
          </div>
          <form class="form" id="eventForm">
            ${field("title",     "Title",            "text",   "Tech fest")}
            ${field("date",      "Date",             "date",   "")}
            ${field("venue",     "Venue",            "text",   "Auditorium")}
            ${field("campus",    "Campus",           "text",   user.campus)}
            ${field("capacity",  "Capacity",         "number", "200")}
            ${field("posterUrl", "Poster Image URL", "url",    "Optional image link", "", false)}
            <div class="field">
              <label for="description">Description</label>
              <textarea id="description" name="description" required></textarea>
            </div>
            ${field("tiers", "Ticket Tiers", "text", "General:299:100, VIP:599:30")}
            <button class="primary" type="submit">Create Event</button>
          </form>
        </div>` : ""}
      <div class="panel events-panel">
        <div class="section-title">
          <div><h2>Events</h2><p>Book, monitor, or assign referral links.</p></div>
        </div>
        <div class="event-list">${visibleEvents().map(eventCard).join("") || `<div class="empty">No events yet.</div>`}</div>
      </div>
    </section>
  `;
}

function eventCard(ev) {
  const user    = currentUser();
  const eid     = ev._id || ev.id;
  const sold    = eventTickets(eid).length;
  const checked = eventTickets(eid).filter((t) => t.checkedIn).length;
  const revenue = eventRevenue(eid);
  const poster  = ev.posterUrl || posterDataUri(ev.title, ev.campus);

  return `
    <article class="card event-card">
      <div class="poster-wrap">
        <img class="event-poster" src="${poster}" alt="${ev.title} poster" />
        <span class="poster-badge">${ev.date}</span>
      </div>
      <div class="card-head">
        <div>
          <h3>${ev.title}</h3>
          <p class="muted">${ev.description}</p>
        </div>
        <span class="pill green">${ev.campus}</span>
      </div>
      <div class="pill-row">
        <span class="pill">${ev.venue}</span>
        <span class="pill gold">${sold}/${ev.capacity} booked</span>
        <span class="pill coral">${money(revenue)}</span>
      </div>
      <div class="progress"><span style="width:${Math.min(100, (sold / ev.capacity) * 100)}%"></span></div>
      <div class="pill-row">
        ${(ev.tiers || []).map((t) => `<span class="pill">${t.name}: ${money(t.price)} · ${t.quantity} seats</span>`).join("")}
      </div>
      ${user.role === "attendee"
        ? bookingForm(ev)
        : user.role === "promoter"
          ? referralForm(ev)
          : `<span class="muted">${checked} attendees checked in.</span>`}
    </article>
  `;
}

function bookingForm(ev) {
  const eid = ev._id || ev.id;
  return `
    <form class="form" data-action="bookTicket" data-event-id="${eid}">
      <div class="grid two">
        <div class="field">
          <label>Ticket Type</label>
          <select name="tierId">
            ${(ev.tiers || []).map((t) => `<option value="${t._id || t.id}">${t.name} - ${money(t.price)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Referral Code</label>
          <input name="referralCode" placeholder="Optional" />
        </div>
      </div>
      <button class="primary" type="submit">Book Ticket</button>
    </form>
  `;
}

function referralForm(ev) {
  const eid  = ev._id || ev.id;
  const user = currentUser();
  const uid  = user._id || user.id;
  const mine = state.referrals.find((r) => r.eventId === eid && r.userId === uid);

  if (mine) {
    const perf = promoterCommission(mine);
    return `
      <div class="card">
        <b>Referral code: ${mine.code}</b>
        <span class="muted">Share this code during booking.</span>
        <span>${perf.count} sales · ${money(perf.commission)} commission</span>
      </div>
    `;
  }

  return `
    <form class="form" data-action="createReferral" data-event-id="${eid}">
      <div class="grid two">
        ${field("code", "Referral Code", "text", `${user.name.split(" ")[0].toUpperCase()}10`)}
        ${field("commissionPercent", "Commission %", "number", "10")}
      </div>
      <button class="primary" type="submit">Create Referral</button>
    </form>
  `;
}

// ── Tickets (attendee) ────────────────────────────────────────
function ticketsTemplate(user) {
  const uid     = user._id || user.id;
  const tickets = state.tickets.filter((t) => t.userId === uid);

  return `
    <section class="panel">
      <div class="section-title">
        <div><h2>My Tickets</h2><p>Each ticket has a QR-style code and check-in status.</p></div>
      </div>
      <div class="list">
        ${tickets.map((ticket) => {
          const ev   = eventById(ticket.eventId);
          const tier = tierById(ev, ticket.tierId);
          const tid  = ticket._id || ticket.id;
          return `
            <div class="ticket">
              <div class="qr" title="${tid}"></div>
              <div>
                <h3>${ev?.title || "Unknown event"}</h3>
                <p class="muted">${tier?.name || "?"} · ${money(tier?.price)} · ${ev?.date} · ${ev?.venue}</p>
                <b>${tid}</b>
              </div>
              <span class="pill ${ticket.checkedIn ? "green" : "gold"}">${ticket.checkedIn ? "Checked in" : "Not checked in"}</span>
            </div>
          `;
        }).join("") || `<div class="empty">No tickets booked yet.</div>`}
      </div>
    </section>
  `;
}

// ── Promoter ──────────────────────────────────────────────────
function promotersTemplate(user) {
  const uid      = user._id || user.id;
  const referrals = state.referrals.filter((r) => r.userId === uid);

  return `
    <section class="panel">
      <div class="section-title">
        <div><h2>Promoter Dashboard</h2><p>Track referral sales and commission.</p></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Event</th><th>Code</th><th>Commission</th><th>Sales</th><th>Revenue</th><th>Earnings</th></tr></thead>
          <tbody>
            ${referrals.map((r) => {
              const perf = promoterCommission(r);
              return `<tr>
                <td>${eventById(r.eventId)?.title || "Deleted event"}</td>
                <td>${r.code}</td>
                <td>${r.commissionPercent}%</td>
                <td>${perf.count}</td>
                <td>${money(perf.revenue)}</td>
                <td>${money(perf.commission)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// ── Check-in ──────────────────────────────────────────────────
function checkinTemplate() {
  const rows = state.tickets.map((ticket) => {
    const ev  = eventById(ticket.eventId);
    const u   = userById(ticket.userId);
    const tid = ticket._id || ticket.id;
    return `<tr>
      <td>${tid}</td>
      <td>${u?.name || ticket.userId}</td>
      <td>${ev?.title || "?"}</td>
      <td>${ticket.checkedIn ? "Checked in" : "Pending"}</td>
      <td><button class="primary" data-action="checkin" data-ticket-id="${tid}">Check in</button></td>
    </tr>`;
  });

  return `
    <section class="panel">
      <div class="section-title">
        <div><h2>QR Check-in</h2><p>Enter a ticket code or use the table action.</p></div>
      </div>
      <form class="form" id="checkinForm">
        <div class="grid two">
          ${field("ticketId", "Ticket Code", "text", "Paste ticket ID")}
          <button class="primary" type="submit">Verify Ticket</button>
        </div>
      </form>
      <br />
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ticket</th><th>Attendee</th><th>Event</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

// ── Admin ─────────────────────────────────────────────────────
function adminTemplate() {
  const campuses = [...new Set(
    state.events.map((e) => e.campus).concat(state.users.map((u) => u.campus))
  )];

  return `
    <section class="grid two">
      <div class="panel">
        <div class="section-title">
          <div><h2>Tenants / Campuses</h2><p>Simple multi-campus overview.</p></div>
        </div>
        <div class="list">
          ${campuses.map((campus) => {
            const campusEvents = state.events.filter((e) => e.campus === campus);
            return `<div class="card"><b>${campus}</b><span>${campusEvents.length} events · ${campusEvents.reduce((sum, e) => sum + eventTickets(e._id || e.id).length, 0)} tickets</span></div>`;
          }).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="section-title">
          <div><h2>Project Tools</h2><p>Use this during demo to reload data from the server.</p></div>
        </div>
        <button class="danger" data-action="resetData">Reload Data from DB</button>
      </div>
    </section>
  `;
}

// ── Bind auth form ────────────────────────────────────────────
function bindAuth() {
  document.querySelector('[data-action="toggleAuth"]').addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    render();
  });

  document.querySelector("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));

    if (authMode === "login") {
      const res = await POST("/login", { email: data.email, password: data.password });
      if (res.error) return toast(res.error);
      state.currentUser = res;
      state.view = "dashboard";
      saveSession();
      await loadViewData("dashboard");
      render();
      return;
    }

    // Register
    const res = await POST("/register", {
      name: data.name, email: data.email, password: data.password,
      role: data.role, campus: data.campus,
    });
    if (res.error) return toast(res.error);
    state.currentUser = res;
    state.view = "dashboard";
    saveSession();
    await loadViewData("dashboard");
    render();
  });
}

// ── Bind app interactions ─────────────────────────────────────
function bindApp() {
  document.querySelectorAll("[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => setView(btn.dataset.view))
  );

  document.querySelector('[data-action="logout"]').addEventListener("click", () => {
    state.currentUser = null;
    state.events = []; state.tickets = []; state.referrals = []; state.users = [];
    sessionStorage.clear();
    render();
  });

  const eventForm = document.querySelector("#eventForm");
  if (eventForm) eventForm.addEventListener("submit", createEvent);

  document.querySelectorAll('[data-action="bookTicket"]').forEach((form) =>
    form.addEventListener("submit", bookTicket)
  );
  document.querySelectorAll('[data-action="createReferral"]').forEach((form) =>
    form.addEventListener("submit", createReferral)
  );

  const checkinForm = document.querySelector("#checkinForm");
  if (checkinForm) checkinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    checkIn(new FormData(e.target).get("ticketId"));
  });

  document.querySelectorAll('[data-action="checkin"]').forEach((btn) =>
    btn.addEventListener("click", () => checkIn(btn.dataset.ticketId))
  );

  const resetBtn = document.querySelector('[data-action="resetData"]');
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    await loadViewData(state.view);
    render();
    toast("Data reloaded from database.");
  });
}

// ── Action handlers ───────────────────────────────────────────
async function createEvent(e) {
  e.preventDefault();
  const data  = Object.fromEntries(new FormData(e.target));
  const user  = currentUser();

  const tiers = data.tiers.split(",").map((part) => {
    const [name, price, quantity] = part.split(":").map((s) => s.trim());
    return { name, price: Number(price), quantity: Number(quantity) };
  }).filter((t) => t.name && t.price && t.quantity);

  if (!tiers.length) return toast("Add at least one valid tier.");

  const res = await POST("/events", {
    title:       data.title,
    description: data.description,
    date:        data.date,
    venue:       data.venue,
    campus:      data.campus,
    posterUrl:   data.posterUrl || posterDataUri(data.title, data.campus),
    organizerId: user._id || user.id,
    capacity:    Number(data.capacity),
    tiers,
  });

  if (res.error) return toast(res.error);
  await refreshEvents();
  render();
  toast("Event created.");
}

async function bookTicket(e) {
  e.preventDefault();
  const data     = Object.fromEntries(new FormData(e.target));
  const user     = currentUser();
  const eventId  = e.target.dataset.eventId;

  const res = await POST("/tickets", {
    userId:       user._id || user.id,
    eventId,
    tierId:       data.tierId,
    referralCode: data.referralCode.trim().toUpperCase(),
  });

  if (res.error) return toast(res.error);
  await refreshTickets();
  render();
  toast("Ticket booked. Open My Tickets to see the QR code.");
}

async function createReferral(e) {
  e.preventDefault();
  const data    = Object.fromEntries(new FormData(e.target));
  const user    = currentUser();
  const eventId = e.target.dataset.eventId;

  const res = await POST("/referrals", {
    userId:            user._id || user.id,
    eventId,
    code:              data.code.trim().toUpperCase(),
    commissionPercent: Number(data.commissionPercent),
  });

  if (res.error) return toast(res.error);
  await refreshReferrals();
  render();
  toast("Referral code created.");
}

async function checkIn(ticketId) {
  if (!ticketId) return toast("Enter a ticket code.");

  const res = await POST("/checkin", { ticketId: ticketId.trim() });
  if (res.error) return toast(res.error);

  // Update local mirror so the table refreshes without a full reload
  const local = state.tickets.find((t) => (t._id || t.id) === ticketId.trim());
  if (local) local.checkedIn = true;

  render();
  toast("Attendee checked in successfully.");
}

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  loadSession();
  if (state.currentUser) {
    await loadViewData(state.view);
  }
  render();
})();
