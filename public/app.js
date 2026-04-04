(function () {
  "use strict";

  const STORAGE_KEY = "multiLoginPortal_v1";
  /** Survives refresh in the same tab; cleared on Log out (not tab close). */
  const SESSION_AUTH_KEY = "multiLoginPortal_session_v1";

  function getApiBase() {
    if (typeof window === "undefined" || !window.PORTAL_API_BASE) return "";
    return String(window.PORTAL_API_BASE).replace(/\/$/, "");
  }

  function apiUrl(path) {
    const p = path.startsWith("/") ? path : "/" + path;
    const b = getApiBase();
    return b ? b + p : p;
  }

  const ROLE_KEYS = ["field", "survey", "dashboard", "supervisor"];

  const ROLE_LABELS = {
    field: "Work report (field)",
    survey: "Employee survey",
    dashboard: "Dashboard",
    supervisor: "Supervisor",
    admin: "Administration",
  };

  const ROLE_PICKER_ORDER = ["field", "survey", "dashboard", "supervisor", "admin"];

  function portalRoleKey(portalId) {
    const s = portalId == null ? "" : String(portalId).trim();
    return "cp_" + s;
  }

  function parsePortalIdFromRole(role) {
    if (typeof role !== "string") return null;
    const r = role.trim();
    if (!r.toLowerCase().startsWith("cp_")) return null;
    const id = r.slice(3).trim();
    return id || null;
  }

  function portalNewId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : "cp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
  }

  function entryId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : "e-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
  }

  function normalizeRoleCredentialList(raw, fallbackList) {
    if (Array.isArray(raw) && raw.length > 0) {
      const mapped = raw
        .map((c) => ({
          username: c && c.username != null ? String(c.username).trim() : "",
          password: c && c.password != null ? String(c.password) : "",
        }))
        .filter((c) => c.username);
      if (mapped.length > 0) return mapped;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.username) {
      return [
        {
          username: String(raw.username).trim(),
          password: raw.password != null ? String(raw.password) : "",
        },
      ];
    }
    return fallbackList.map((x) => ({ ...x }));
  }

  const defaultState = () => ({
    credentials: {
      field: [
        { username: "worker", password: "worker123" },
        { username: "xyz", password: "xyz123" },
      ],
      survey: [{ username: "survey", password: "survey123" }],
      dashboard: [{ username: "manager", password: "manager123" }],
      supervisor: [{ username: "supervisor", password: "supervisor123" }],
      admin: { username: "admin", password: "admin123" },
    },
    fieldEntries: [],
    surveyEntries: [],
    customPortals: [],
    customPortalEntries: {},
    workAssignments: [],
  });

  function normalizeCustomField(f) {
    const id =
      f && f.id
        ? String(f.id)
        : portalNewId();
    const labelRaw =
      f && f.label != null
        ? String(f.label).trim()
        : f && f.question != null
          ? String(f.question).trim()
          : f && f.text != null
            ? String(f.text).trim()
            : f && f.title != null
              ? String(f.title).trim()
              : f && f.name != null
                ? String(f.name).trim()
                : "";
    const label = labelRaw;
    const t = f && f.type;
    const type = ["text", "textarea", "number", "select", "buttons", "image"].includes(t) ? t : "text";
    const required = !!(f && f.required);
    let options = [];
    if (type === "select" || type === "buttons") {
      if (Array.isArray(f.options)) {
        options = f.options.map((o) => String(o).trim()).filter(Boolean);
      } else if (f && f.options != null && typeof f.options === "string") {
        options = f.options.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (type === "buttons") {
      options = options.slice(0, 3);
    }
    return { id, label, type, required, options };
  }

  function normalizeCustomPortal(p) {
    if (!p || typeof p !== "object") return null;
    const rawId = p.id != null ? String(p.id).trim() : "";
    const id = rawId || portalNewId();
    const title =
      p.title != null && String(p.title).trim() ? String(p.title).trim() : "Untitled portal";
    let rawFields = [];
    if (Array.isArray(p.fields)) {
      rawFields = p.fields;
    } else if (p.fields && typeof p.fields === "object") {
      rawFields = Object.values(p.fields);
    }
    const fields = rawFields.map(normalizeCustomField).filter((f) => f.label);
    const creds = normalizeRoleCredentialList(p.credentials, []);
    const followUpReminderEnabled = !!(p && p.followUpReminderEnabled);
    let followUpReminderDays = parseInt(p && p.followUpReminderDays, 10);
    if (!Number.isFinite(followUpReminderDays) || followUpReminderDays < 1) followUpReminderDays = 7;
    if (followUpReminderDays > 366) followUpReminderDays = 366;
    return {
      id,
      title,
      fields,
      credentials: creds.filter((c) => c.username),
      followUpReminderEnabled,
      followUpReminderDays,
    };
  }

  function normalizeWorkAssignment(raw) {
    if (!raw || typeof raw !== "object") return null;
    const targetUsername = raw.targetUsername != null ? String(raw.targetUsername).trim() : "";
    const instructions = raw.instructions != null ? String(raw.instructions).trim() : "";
    if (!targetUsername || !instructions) return null;
    let scope = raw.scope != null ? String(raw.scope).trim() : "all";
    if (["process", "reminders", "calendar"].includes(scope)) scope = "all";
    const core = new Set(["all", "field", "survey", "dashboard", "supervisor"]);
    if (!core.has(scope) && !(typeof scope === "string" && scope.startsWith("cp_"))) scope = "all";
    const at = raw.assignedAt ? new Date(raw.assignedAt).getTime() : NaN;
    const assignedAt = !Number.isNaN(at) ? new Date(at).toISOString() : new Date().toISOString();
    const ackT = raw.acknowledgedAt ? new Date(raw.acknowledgedAt).getTime() : NaN;
    const acknowledgedAt = !Number.isNaN(ackT) ? new Date(ackT).toISOString() : null;
    const doneT = raw.completedAt ? new Date(raw.completedAt).getTime() : NaN;
    const completedAt = !Number.isNaN(doneT) ? new Date(doneT).toISOString() : null;
    let deadline = null;
    if (raw.deadline != null && String(raw.deadline).trim()) {
      const dlT = new Date(raw.deadline).getTime();
      if (!Number.isNaN(dlT)) deadline = new Date(dlT).toISOString();
    }
    return {
      id: raw.id ? String(raw.id) : entryId(),
      targetUsername,
      instructions,
      scope,
      assignedAt,
      assignedBy: raw.assignedBy != null ? String(raw.assignedBy).trim() : "",
      acknowledgedAt,
      completedAt,
      deadline,
    };
  }

  /** @param {string} preset empty | 2h | 4h | today | 1d | 1w */
  function workAssignmentDeadlineFromPreset(preset) {
    const key = preset != null ? String(preset).trim() : "";
    if (!key) return null;
    const now = new Date();
    const msHour = 60 * 60 * 1000;
    const msDay = 24 * msHour;
    if (key === "2h") return new Date(now.getTime() + 2 * msHour).toISOString();
    if (key === "4h") return new Date(now.getTime() + 4 * msHour).toISOString();
    if (key === "1d") return new Date(now.getTime() + msDay).toISOString();
    if (key === "1w") return new Date(now.getTime() + 7 * msDay).toISOString();
    if (key === "today") {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      if (end.getTime() <= now.getTime()) return new Date(now.getTime() + msDay).toISOString();
      return end.toISOString();
    }
    return null;
  }

  function formatWorkAssignmentDeadline(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function workAssignmentDeadlineOverdue(a) {
    if (!a || !a.deadline) return false;
    if (workAssignmentIsDone(a)) return false;
    const t = new Date(a.deadline).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() > t;
  }

  function formatDurationUntilDeadline(ms) {
    const n = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(n / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (day >= 1) {
      const h = hr % 24;
      if (h >= 1) return `${day}d ${h}h`;
      return day === 1 ? "1 day" : `${day} days`;
    }
    if (hr >= 1) {
      const m = min % 60;
      if (m >= 1) return `${hr}h ${m}m`;
      return hr === 1 ? "1 hour" : `${hr} hours`;
    }
    if (min >= 1) return min === 1 ? "1 min" : `${min} mins`;
    return "Less than 1 min";
  }

  /** Remaining until deadline, or overdue duration; empty if no deadline or task is done. */
  function workAssignmentTimeRemainingLabel(iso, isDone) {
    if (!iso || isDone) return "";
    const end = new Date(iso).getTime();
    if (Number.isNaN(end)) return "";
    const now = Date.now();
    if (now >= end) return `Overdue by ${formatDurationUntilDeadline(now - end)}`;
    return `${formatDurationUntilDeadline(end - now)} left`;
  }

  let assigneeDeadlineTickId = null;
  function tickAssigneeDeadlineRemainingNodes() {
    document.querySelectorAll(".assigned-work-deadline-remaining[data-deadline-iso]").forEach((el) => {
      const iso = el.getAttribute("data-deadline-iso");
      if (!iso) return;
      el.textContent = workAssignmentTimeRemainingLabel(iso, false);
    });
  }

  function ensureAssigneeDeadlineRemainingsTick() {
    tickAssigneeDeadlineRemainingNodes();
    if (assigneeDeadlineTickId != null) return;
    assigneeDeadlineTickId = setInterval(tickAssigneeDeadlineRemainingNodes, 30000);
  }

  function workAssignmentIsDone(a) {
    if (!a) return false;
    return !!(a.completedAt || a.acknowledgedAt);
  }

  function normalizeParsedState(parsed) {
    try {
      if (!parsed || typeof parsed !== "object") return defaultState();
      const base = defaultState();
      const pc = parsed.credentials || {};
      const adminRaw = pc.admin;
      const adminCred =
        adminRaw && typeof adminRaw === "object" && adminRaw.username
          ? {
              username: String(adminRaw.username).trim(),
              password: adminRaw.password != null ? String(adminRaw.password) : "",
            }
          : base.credentials.admin;
      const rawPortals = Array.isArray(parsed.customPortals) ? parsed.customPortals : [];
      const customPortals = rawPortals.map(normalizeCustomPortal).filter(Boolean);
      const rawEntries =
        parsed.customPortalEntries && typeof parsed.customPortalEntries === "object"
          ? parsed.customPortalEntries
          : {};
      const customPortalEntries = { ...base.customPortalEntries };
      Object.keys(rawEntries).forEach((k) => {
        if (Array.isArray(rawEntries[k])) customPortalEntries[k] = rawEntries[k];
      });
      const rawWa = Array.isArray(parsed.workAssignments) ? parsed.workAssignments : [];
      const workAssignments = rawWa.map(normalizeWorkAssignment).filter(Boolean);
      const next = {
        ...base,
        ...parsed,
        credentials: {
          field: normalizeRoleCredentialList(pc.field, base.credentials.field),
          survey: normalizeRoleCredentialList(pc.survey, base.credentials.survey),
          dashboard: normalizeRoleCredentialList(pc.dashboard, base.credentials.dashboard),
          supervisor: normalizeRoleCredentialList(pc.supervisor, base.credentials.supervisor),
          admin: adminCred,
        },
        workAssignments,
        customPortals,
        customPortalEntries,
      };
      delete next.customPortalFollowUpNotified;
      delete next.emailSettings;
      delete next.processEntries;
      delete next.reminders;
      delete next.calendarTasks;
      delete next.credentials.process;
      delete next.credentials.reminders;
      delete next.credentials.calendar;
      return next;
    } catch {
      return defaultState();
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeParsedState(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  let serverRevision = 0;
  let apiSyncEnabled = true;
  let serverSyncReady = false;
  let serverPushTimer = null;
  let lastServerPullHadDocument = false;

  function persistStateLocal(st) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (e) {
      console.warn("localStorage save failed", e);
    }
  }

  function scheduleServerPush() {
    if (!apiSyncEnabled || !serverSyncReady) return;
    if (serverPushTimer != null) clearTimeout(serverPushTimer);
    serverPushTimer = setTimeout(() => {
      serverPushTimer = null;
      flushServerPushNow();
    }, 600);
  }

  function saveState(st) {
    persistStateLocal(st);
    if (serverSyncReady) scheduleServerPush();
  }

  async function flushServerPushNow() {
    if (!apiSyncEnabled) return;
    try {
      const res = await fetch(apiUrl("/api/state"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ revision: serverRevision, state }),
      });
      if (res.status === 409) {
        window.location.reload();
        return;
      }
      if (!res.ok) return;
      const j = await res.json();
      if (j && j.revision != null) serverRevision = Number(j.revision) || serverRevision;
    } catch (e) {
      console.warn("Server sync push failed", e);
    }
  }

  async function pullServerOnBoot() {
    try {
      const res = await fetch(apiUrl("/api/state"), { headers: { Accept: "application/json" } });
      if (!res.ok) {
        apiSyncEnabled = false;
        return;
      }
      const j = await res.json();
      serverRevision = Number(j.revision) || 0;
      lastServerPullHadDocument = j.state != null && typeof j.state === "object";
      if (lastServerPullHadDocument) {
        state = normalizeParsedState(j.state);
        persistStateLocal(state);
      }
    } catch (e) {
      console.warn("Central sync unavailable (offline or static hosting):", e);
      apiSyncEnabled = false;
    }
  }

  async function pollServerForNewerRevision() {
    if (!apiSyncEnabled || !serverSyncReady || document.visibilityState !== "visible") return;
    try {
      const res = await fetch(apiUrl("/api/state"), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const j = await res.json();
      const rev = Number(j.revision) || 0;
      if (rev <= serverRevision) return;
      serverRevision = rev;
      if (j.state != null && typeof j.state === "object") {
        state = normalizeParsedState(j.state);
        persistStateLocal(state);
        snapshotStateStorageRaw();
        if (sessionRole) enterPortal(sessionRole);
      }
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Parse display timestamps from Intl (e.g. "Saturday, 21 March 2026 at 3:45:30 pm") where Date(str) fails.
   */
  function parseTimestampString(str) {
    if (str == null) return null;
    const s = typeof str === "string" ? str.trim() : String(str).trim();
    if (!s) return null;
    let t = new Date(s);
    if (!Number.isNaN(t.getTime())) return t;
    const commaAt = s.replace(/\s+at\s+/i, ", ");
    t = new Date(commaAt);
    if (!Number.isNaN(t.getTime())) return t;
    const p1 = Date.parse(s);
    if (!Number.isNaN(p1)) return new Date(p1);
    const p2 = Date.parse(commaAt);
    if (!Number.isNaN(p2)) return new Date(p2);
    const isoLike = s.match(
      /(\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?)/i
    );
    if (isoLike) {
      const norm = isoLike[1].replace(" ", "T");
      t = new Date(norm.length <= 10 ? norm + "T12:00:00" : norm);
      if (!Number.isNaN(t.getTime())) return t;
    }
    return null;
  }

  function localCalendarYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addCalendarDaysFromDate(date, days) {
    const d = new Date(date.getTime());
    const n = Number(days);
    const add = Number.isFinite(n) ? Math.floor(n) : 0;
    d.setDate(d.getDate() + add);
    return d;
  }

  /** dd/mm/yyyy → { ymd: "YYYY-MM-DD" } or null if invalid */
  function parseDdMmYyyyToYmd(str) {
    if (str == null) return null;
    const s = String(str).trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return { ymd: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  /** "YYYY-MM-DD" → dd/mm/yyyy for display */
  function formatYmdToDdMmYyyy(ymd) {
    if (!ymd || typeof ymd !== "string") return "";
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  let state = loadState();

  function runAllDataMigrations() {
    (function migrateDashboardEntryTimes() {
      let dirty = false;
      ["fieldEntries", "surveyEntries"].forEach((key) => {
        const arr = state[key];
        if (!Array.isArray(arr)) return;
        arr.forEach((entry) => {
          if (entry.submittedAt) return;
          const t = parseTimestampString(entry.timestamp);
          if (t && !Number.isNaN(t.getTime())) {
            entry.submittedAt = t.toISOString();
            dirty = true;
          }
        });
      });
      if (dirty) saveState(state);
    })();

    (function migrateCustomPortalSubmittedAt() {
      let dirty = false;
      const ce = state.customPortalEntries;
      if (!ce || typeof ce !== "object") return;
      Object.keys(ce).forEach((pid) => {
        const list = ce[pid];
        if (!Array.isArray(list)) return;
        list.forEach((entry) => {
          if (entry.submittedAt) return;
          const t = parseTimestampString(entry.timestamp);
          if (t && !Number.isNaN(t.getTime())) {
            entry.submittedAt = t.toISOString();
            dirty = true;
          }
        });
      });
      if (dirty) saveState(state);
    })();

    (function migrateEntryIdsAndReminderCreatedAt() {
      let dirty = false;
      (state.fieldEntries || []).forEach((e) => {
        if (!e.id) {
          e.id = entryId();
          dirty = true;
        }
      });
      (state.surveyEntries || []).forEach((e) => {
        if (!e.id) {
          e.id = entryId();
          dirty = true;
        }
      });
      const ce = state.customPortalEntries;
      if (ce && typeof ce === "object") {
        Object.keys(ce).forEach((pid) => {
          (ce[pid] || []).forEach((e) => {
            if (!e.id) {
              e.id = entryId();
              dirty = true;
            }
          });
        });
      }
      if (dirty) saveState(state);
    })();

    (function ensureCoreRoleCredentialsPresent() {
      const base = defaultState().credentials;
      let dirty = false;
      for (const role of ROLE_KEYS) {
        const raw = state.credentials[role];
        const hasValid = normalizeRoleCredentialList(raw, []).length > 0;
        if (!hasValid) {
          const filled = normalizeRoleCredentialList(raw, base[role]);
          if (filled.length > 0) {
            state.credentials[role] = filled.map((x) => ({ username: x.username, password: x.password }));
            dirty = true;
          }
        }
      }
      if (dirty) saveState(state);
    })();

    (function mergeLegacyXyzIntoFieldPortal() {
      let dirty = false;
      const cred = state.credentials || {};
      if (cred.xyz != null) {
        const fieldArr = normalizeRoleCredentialList(cred.field, defaultState().credentials.field);
        const xyzArr = normalizeRoleCredentialList(cred.xyz, []);
        const seen = new Set(fieldArr.map((c) => (c.username || "").trim().toLowerCase()).filter(Boolean));
        xyzArr.forEach((c) => {
          const k = (c.username || "").trim().toLowerCase();
          if (k && !seen.has(k)) {
            fieldArr.push({ username: c.username.trim(), password: c.password });
            seen.add(k);
          }
        });
        state.credentials.field = fieldArr;
        delete state.credentials.xyz;
        dirty = true;
      }
      if (Array.isArray(state.xyzEntries) && state.xyzEntries.length > 0) {
        if (!Array.isArray(state.fieldEntries)) state.fieldEntries = [];
        state.fieldEntries = state.fieldEntries.concat(state.xyzEntries);
        delete state.xyzEntries;
        dirty = true;
      }
      (state.workAssignments || []).forEach((a) => {
        if (a && a.scope === "xyz") {
          a.scope = "field";
          dirty = true;
        }
      });
      if (dirty) saveState(state);
    })();
  }

  let sessionRole = null;
  /** Login username for the current session (used to record who submitted each entry). */
  let sessionUsername = null;
  let tsInterval = null;
  let fieldPhotoObjectUrl = null;
  let fieldCameraDataUrl = null;
  let cameraStream = null;
  let customPortalCameraStream = null;
  let customPortalCameraTargetFieldId = null;
  let customPortalImageDataUrlByField = {};
  let customPortalImageObjectUrlByField = {};
  let fieldEditEntryId = null;
  let surveyEditEntryId = null;
  let customPortalEditPortalId = null;
  let customPortalEditEntryId = null;
  let adminCredActiveRole = "field";
  /** Which custom portal tab is selected in admin (`null` when creating a new portal). */
  let adminCustomActivePortalId = null;
  /** Roles this sign-in may open; used for “Switch portal” when length > 1 */
  let sessionPortalOptions = null;
  let rolePickerMode = "login";

  function isDashboardManagerRole() {
    return sessionRole === "dashboard" || sessionRole === "supervisor";
  }
  let dashboardFilter = "all";
  let dashboardChartList = [];
  let dashboardAppliedDateFrom = "";
  let dashboardAppliedDateTo = "";
  /** Manager “All assignments” table: "active" | "completed" */
  let managerAssignmentsFilter = "active";

  let lastStateStorageRaw = null;
  let externalStateSyncStarted = false;

  function snapshotStateStorageRaw() {
    try {
      lastStateStorageRaw = localStorage.getItem(STORAGE_KEY) || null;
    } catch (e) {
      lastStateStorageRaw = null;
    }
  }

  function externalStateRefreshAssignedWorkOnly() {
    if (!sessionRole || !sessionUsername) return;
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY) || null;
    } catch (e) {
      return;
    }
    if (raw === lastStateStorageRaw) return;
    lastStateStorageRaw = raw;
    state = loadState();

    // Re-render only the “Assigned work” mounts so we don't disrupt in-progress edits.
    refreshAllAssigneeWorkMounts();
    if (isDashboardManagerRole()) {
      // Manager / supervisor view also includes the assignments table.
      renderManagerAssignmentsTable();
    }
  }

  function initExternalStateSync() {
    if (externalStateSyncStarted) return;
    externalStateSyncStarted = true;
    snapshotStateStorageRaw();

    // Cross-tab updates (manager saves → assignee re-renders).
    window.addEventListener("storage", (ev) => {
      if (ev && ev.key === STORAGE_KEY) externalStateRefreshAssignedWorkOnly();
    });

    // Fallback poll (in case storage events are missed).
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      externalStateRefreshAssignedWorkOnly();
      pollServerForNewerRevision();
    }, 20000);
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Click `target` can be a Text node; only Elements have `closest`. */
  function closestFromEvent(ev, selector) {
    if (!ev || ev.target == null) return null;
    const t = ev.target;
    const el = t.nodeType === 1 ? t : t.parentElement;
    return el && typeof el.closest === "function" ? el.closest(selector) : null;
  }

  /** For `Node.contains` / containment checks when `ev.target` may be a Text node. */
  function elementFromEventTarget(ev) {
    if (!ev || ev.target == null) return null;
    const t = ev.target;
    return t.nodeType === 1 ? t : t.parentElement;
  }

  function togglePasswordVisibility(button, input) {
    if (!button || !input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", show ? "true" : "false");
  }

  const views = {
    login: $("#view-login"),
    rolePicker: $("#view-role-picker"),
    field: $("#view-field"),
    survey: $("#view-survey"),
    customPortal: $("#view-custom-portal"),
    dashboard: $("#view-dashboard"),
    admin: $("#view-admin"),
  };

  function getCustomPortalsList() {
    return Array.isArray(state.customPortals) ? state.customPortals : [];
  }

  /** Resolves a portal whether `id` was stored as string or number (JSON) or with stray whitespace. */
  function findCustomPortalById(portalId) {
    if (portalId == null) return null;
    const want = String(portalId).trim();
    if (!want) return null;
    return getCustomPortalsList().find((x) => String(x.id).trim() === want) || null;
  }

  function getRolePickerOrder() {
    const mids = getCustomPortalsList().map((p) => portalRoleKey(p.id));
    return ["field", "survey", "dashboard", "supervisor", ...mids, "admin"];
  }

  function getRoleLabel(role) {
    const pid = parsePortalIdFromRole(role);
    if (pid) {
      const p = findCustomPortalById(pid);
      return p ? p.title : "Custom portal";
    }
    return ROLE_LABELS[role] || role;
  }

  function findCustomPortalImageWrap(form, fieldId) {
    if (!form) return null;
    return Array.from(form.querySelectorAll(".custom-portal-image-wrap")).find(
      (w) => w.getAttribute("data-field-id") === fieldId
    );
  }

  function revokeCustomPortalImageObjectUrl(fieldId) {
    const u = customPortalImageObjectUrlByField[fieldId];
    if (u) {
      URL.revokeObjectURL(u);
      delete customPortalImageObjectUrlByField[fieldId];
    }
  }

  function stopCustomPortalCamera() {
    if (customPortalCameraStream) {
      customPortalCameraStream.getTracks().forEach((t) => t.stop());
      customPortalCameraStream = null;
    }
    const video = $("#custom-portal-camera-video");
    if (video) video.srcObject = null;
    customPortalCameraTargetFieldId = null;
    const panel = $("#custom-portal-camera-panel");
    if (panel) panel.hidden = true;
    const errEl = $("#custom-portal-camera-error");
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
  }

  function resetCustomPortalImageState() {
    Object.keys(customPortalImageObjectUrlByField).forEach((fid) => {
      const u = customPortalImageObjectUrlByField[fid];
      if (u) URL.revokeObjectURL(u);
    });
    customPortalImageObjectUrlByField = {};
    customPortalImageDataUrlByField = {};
    stopCustomPortalCamera();
  }

  function syncCustomPortalImagePreview(fieldId, src) {
    const form = $("#custom-portal-form");
    if (!form) return;
    const wrap = findCustomPortalImageWrap(form, fieldId);
    if (!wrap) return;
    const img = wrap.querySelector(".custom-portal-image-preview");
    if (!img) return;
    if (src) {
      img.src = src;
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
    }
  }

  async function openCustomPortalCameraField(fieldId) {
    const panel = $("#custom-portal-camera-panel");
    const errEl = $("#custom-portal-camera-error");
    if (!panel || !errEl) return;
    errEl.hidden = true;
    errEl.textContent = "";
    stopCustomPortalCamera();
    revokeCustomPortalImageObjectUrl(fieldId);
    delete customPortalImageDataUrlByField[fieldId];
    const form = $("#custom-portal-form");
    const wrap = findCustomPortalImageWrap(form, fieldId);
    if (wrap) {
      const fIn = wrap.querySelector(".custom-portal-image-file");
      if (fIn) fIn.value = "";
      syncCustomPortalImagePreview(fieldId, null);
    }
    customPortalCameraTargetFieldId = fieldId;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errEl.textContent =
        "Camera is not available in this browser. Use “Choose from gallery” or open this page over HTTPS or localhost.";
      panel.hidden = false;
      errEl.hidden = false;
      return;
    }
    try {
      try {
        customPortalCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        customPortalCameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      const video = $("#custom-portal-camera-video");
      if (video) {
        video.srcObject = customPortalCameraStream;
        panel.hidden = false;
        await video.play().catch(() => {});
      }
    } catch {
      if (customPortalCameraStream) {
        customPortalCameraStream.getTracks().forEach((t) => t.stop());
        customPortalCameraStream = null;
      }
      errEl.textContent =
        "Could not open the camera. Allow permission when prompted, or use gallery upload.";
      errEl.hidden = false;
      panel.hidden = false;
    }
  }

  function captureCustomPortalCameraField() {
    const fieldId = customPortalCameraTargetFieldId;
    const video = $("#custom-portal-camera-video");
    if (!fieldId || !video || !customPortalCameraStream || !video.videoWidth) {
      alert("Wait for the camera preview to appear, then capture.");
      return;
    }
    const canvas = $("#custom-portal-camera-canvas");
    if (!canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    customPortalImageDataUrlByField[fieldId] = dataUrl;
    revokeCustomPortalImageObjectUrl(fieldId);
    const wrap = findCustomPortalImageWrap($("#custom-portal-form"), fieldId);
    if (wrap) {
      const fIn = wrap.querySelector(".custom-portal-image-file");
      if (fIn) fIn.value = "";
    }
    syncCustomPortalImagePreview(fieldId, dataUrl);
    stopCustomPortalCamera();
    const panel = $("#custom-portal-camera-panel");
    if (panel) panel.hidden = true;
  }

  async function handleCustomPortalImageFileChosen(fieldId, file) {
    stopCustomPortalCamera();
    revokeCustomPortalImageObjectUrl(fieldId);
    delete customPortalImageDataUrlByField[fieldId];
    if (!file) {
      syncCustomPortalImagePreview(fieldId, null);
      return;
    }
    const url = URL.createObjectURL(file);
    customPortalImageObjectUrlByField[fieldId] = url;
    try {
      const dataUrl = await readPhotoAsDataUrl(file);
      customPortalImageDataUrlByField[fieldId] = dataUrl;
      syncCustomPortalImagePreview(fieldId, url);
    } catch {
      revokeCustomPortalImageObjectUrl(fieldId);
      delete customPortalImageDataUrlByField[fieldId];
      syncCustomPortalImagePreview(fieldId, null);
      alert("Could not read the image. Try a smaller file.");
    }
  }

  function mountCustomPortalForm(portal) {
    const root = $("#custom-portal-fields");
    const form = $("#custom-portal-form");
    if (!root || !form) return;
    resetCustomPortalImageState();
    root.innerHTML = "";
    form.dataset.portalId = portal.id;
    portal.fields.forEach((f) => {
      if (f.type === "image") {
        const wrap = document.createElement("div");
        wrap.className = "field custom-portal-image-wrap";
        wrap.dataset.fieldId = f.id;
        const lab = document.createElement("span");
        lab.className = "field-label";
        lab.textContent = f.label + (f.required ? " *" : "");
        wrap.appendChild(lab);
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.style.margin = "0 0 0.5rem";
        hint.textContent = "Use the camera or choose an image from your gallery.";
        wrap.appendChild(hint);
        const row = document.createElement("div");
        row.className = "photo-source-row";
        const camBtn = document.createElement("button");
        camBtn.type = "button";
        camBtn.className = "btn primary custom-portal-camera-open";
        camBtn.dataset.fieldId = f.id;
        camBtn.textContent = "Take photo with camera";
        const fileLabel = document.createElement("label");
        fileLabel.className = "btn file-pick-label";
        fileLabel.textContent = "Choose from gallery";
        const fileIn = document.createElement("input");
        fileIn.type = "file";
        fileIn.accept = "image/*";
        fileIn.className = "visually-hidden-file custom-portal-image-file";
        fileIn.dataset.fieldId = f.id;
        fileLabel.appendChild(fileIn);
        row.appendChild(camBtn);
        row.appendChild(fileLabel);
        wrap.appendChild(row);
        const img = document.createElement("img");
        img.className = "photo-preview custom-portal-image-preview";
        img.alt = "Photo preview";
        img.hidden = true;
        wrap.appendChild(img);
        root.appendChild(wrap);
        return;
      }
      if (f.type === "buttons") {
        const opts = (f.options || []).slice(0, 3);
        const wrapB = document.createElement("div");
        wrapB.className = "field custom-portal-buttons-field";
        const gid = `cp-rg-${portal.id}-${f.id}`.replace(/\s+/g, "");
        const glab = document.createElement("span");
        glab.id = gid;
        glab.className = "field-label";
        glab.textContent = f.label + (f.required ? " *" : "");
        const group = document.createElement("div");
        group.className = "custom-portal-button-group";
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-labelledby", gid);
        const radioName = `cp_${portal.id}_${f.id}`;
        opts.forEach((opt, i) => {
          const lab = document.createElement("label");
          lab.className = "custom-portal-choice-btn";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = radioName;
          radio.value = opt;
          radio.className = "custom-portal-input";
          radio.dataset.fieldId = f.id;
          if (f.required && i === 0) radio.required = true;
          const cap = document.createElement("span");
          cap.className = "custom-portal-choice-cap";
          cap.textContent = opt;
          lab.appendChild(radio);
          lab.appendChild(cap);
          group.appendChild(lab);
        });
        wrapB.appendChild(glab);
        wrapB.appendChild(group);
        root.appendChild(wrapB);
      } else {
        const wrap = document.createElement("label");
        wrap.className = "field";
        const lab = document.createElement("span");
        lab.className = "field-label";
        lab.textContent = f.label + (f.required ? " *" : "");
        wrap.appendChild(lab);
        let input;
        if (f.type === "textarea") {
          input = document.createElement("textarea");
          input.rows = 4;
        } else if (f.type === "number") {
          input = document.createElement("input");
          input.type = "number";
          input.step = "any";
        } else if (f.type === "select") {
          input = document.createElement("select");
          const opt0 = document.createElement("option");
          opt0.value = "";
          opt0.textContent = "Select…";
          input.appendChild(opt0);
          (f.options || []).forEach((opt) => {
            const o = document.createElement("option");
            o.value = opt;
            o.textContent = opt;
            input.appendChild(o);
          });
        } else {
          input = document.createElement("input");
          input.type = "text";
        }
        input.className = "custom-portal-input";
        input.dataset.fieldId = f.id;
        if (f.required) input.required = true;
        wrap.appendChild(input);
        root.appendChild(wrap);
      }
    });
    syncCustomPortalRemindersButton();
    renderAssigneeWorkMount("custom-portal-assigned-work", portalRoleKey(portal.id));
  }

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => {
      if (!el) return;
      el.hidden = key !== name;
    });
    const app = $(".app");
    if (name === "dashboard" || name === "admin") {
      app.classList.add("layout-wide");
    } else {
      app.classList.remove("layout-wide");
    }
  }

  function viewKeyForRole(role) {
    if (typeof role === "string" && role.startsWith("cp_")) return "customPortal";
    const m = {
      field: "field",
      survey: "survey",
      dashboard: "dashboard",
      supervisor: "dashboard",
      admin: "admin",
    };
    return m[role] || "login";
  }

  function updateSwitchPortalButtons() {
    const on = !!(sessionPortalOptions && sessionPortalOptions.length > 1 && sessionRole);
    $$("[data-switch-portal]").forEach((b) => {
      b.hidden = !on;
    });
  }

  function setFieldPortalSubView(mode) {
    const formP = $("#field-panel-form");
    const histP = $("#field-panel-history");
    const assignP = $("#field-panel-assigned");
    const btnV = $("#field-btn-view-history");
    const btnA = $("#field-btn-assigned-work");
    const btnB = $("#field-btn-back-form");
    const isForm = mode === "form";
    const isHist = mode === "history";
    const isAssign = mode === "assigned";
    if (formP) formP.hidden = !isForm;
    if (histP) histP.hidden = !isHist;
    if (assignP) assignP.hidden = !isAssign;
    if (btnV) btnV.hidden = !isForm;
    if (btnA) btnA.hidden = !isForm;
    if (btnB) btnB.hidden = isForm;
    if (isHist) renderFieldHistory();
    if (isAssign) renderAssigneeWorkMount("field-assigned-work", "field");
  }

  function setSurveyPortalSubView(mode) {
    const formP = $("#survey-panel-form");
    const histP = $("#survey-panel-history");
    const assignP = $("#survey-panel-assigned");
    const btnV = $("#survey-btn-view-history");
    const btnA = $("#survey-btn-assigned-work");
    const btnB = $("#survey-btn-back-form");
    const isForm = mode === "form";
    const isHist = mode === "history";
    const isAssign = mode === "assigned";
    if (formP) formP.hidden = !isForm;
    if (histP) histP.hidden = !isHist;
    if (assignP) assignP.hidden = !isAssign;
    if (btnV) btnV.hidden = !isForm;
    if (btnA) btnA.hidden = !isForm;
    if (btnB) btnB.hidden = isForm;
    if (isHist) renderSurveyHistory();
    if (isAssign) renderAssigneeWorkMount("survey-assigned-work", "survey");
  }

  function isCustomPortalNextEntryDue(portal) {
    if (!portal || !portal.followUpReminderEnabled) return false;
    const latest = getLatestCustomEntry(portal.id);
    if (!latest || !latest.submittedAt) return false;
    const anchorMs = new Date(latest.submittedAt).getTime();
    if (Number.isNaN(anchorMs)) return false;
    const due = addCalendarDaysFromDate(new Date(anchorMs), portal.followUpReminderDays || 7);
    return Date.now() >= due.getTime();
  }

  function syncCustomPortalRemindersButton() {
    const btn = $("#custom-portal-btn-reminders");
    const form = $("#custom-portal-form");
    if (!btn || !form) return;
    const portalId = form.dataset.portalId;
    const portal = portalId && findCustomPortalById(portalId);
    btn.classList.toggle("is-reminder-due", !!(portal && isCustomPortalNextEntryDue(portal)));
  }

  function setCustomPortalSubView(mode) {
    const formP = $("#custom-portal-panel-form");
    const histP = $("#custom-portal-panel-history");
    const remP = $("#custom-portal-panel-reminders");
    const assignP = $("#custom-portal-panel-assigned");
    const form = $("#custom-portal-form");
    const portalId = form && form.dataset.portalId;
    const portal = portalId && findCustomPortalById(portalId);
    const btnV = $("#custom-portal-btn-view-history");
    const btnR = $("#custom-portal-btn-reminders");
    const btnA = $("#custom-portal-btn-assigned-work");
    const btnB = $("#custom-portal-btn-back-form");
    const isForm = mode === "form";
    const isHist = mode === "history";
    const isRem = mode === "reminders";
    const isAssign = mode === "assigned";
    if (formP) formP.hidden = !isForm;
    if (histP) histP.hidden = !isHist;
    if (remP) remP.hidden = !isRem;
    if (assignP) assignP.hidden = !isAssign;
    if (btnV) btnV.hidden = !isForm;
    if (btnR) btnR.hidden = !isForm || !(portal && portal.followUpReminderEnabled);
    if (btnA) btnA.hidden = !isForm;
    if (btnB) btnB.hidden = isForm;
    if (isHist) {
      const p = portal;
      if (p) renderCustomPortalHistory(p);
    }
    if (isRem) {
      renderCustomPortalRemindersPanel();
    }
    if (isAssign && portal) {
      renderAssigneeWorkMount("custom-portal-assigned-work", portalRoleKey(portal.id));
    }
    syncCustomPortalRemindersButton();
  }

  function setDashboardManagerSection(section) {
    const s = section === "assign" ? "assign" : "analytics";
    const assignSec = $("#dashboard-section-assign");
    const analyticsSec = $("#dashboard-section-analytics");
    const tabAssign = $("#dashboard-tab-assign");
    const tabAnalytics = $("#dashboard-tab-analytics");
    const isAssign = s === "assign";
    if (assignSec) assignSec.hidden = !isAssign;
    if (analyticsSec) analyticsSec.hidden = isAssign;
    if (tabAssign) {
      tabAssign.classList.toggle("is-active", isAssign);
      tabAssign.setAttribute("aria-selected", isAssign ? "true" : "false");
    }
    if (tabAnalytics) {
      tabAnalytics.classList.toggle("is-active", !isAssign);
      tabAnalytics.setAttribute("aria-selected", !isAssign ? "true" : "false");
    }
    if (isAssign) {
      renderManagerAssignWorkUI();
      renderAssigneeWorkMount("dashboard-assigned-work", sessionRole, true);
    }
  }

  function enterPortal(role) {
    stopCamera();
    stopCustomPortalCamera();
    clearFieldCameraCapture();
    if (role === "field") {
      showView("field");
      clearFieldEditMode();
      setFieldPortalSubView("form");
      startTsTick("#field-timestamp");
    } else if (role === "survey") {
      showView("survey");
      clearSurveyEditMode();
      setSurveyPortalSubView("form");
      startTsTick("#survey-timestamp");
    } else if (role === "dashboard" || role === "supervisor") {
      stopTsTick();
      dashboardFilter = "all";
      setDashboardTabsUI("all");
      const df = $("#dash-date-from");
      const dt = $("#dash-date-to");
      const pf = $("#dash-date-from-picker");
      const pt = $("#dash-date-to-picker");
      if (df) df.value = dashboardAppliedDateFrom ? formatYmdToDdMmYyyy(dashboardAppliedDateFrom) : "";
      if (dt) dt.value = dashboardAppliedDateTo ? formatYmdToDdMmYyyy(dashboardAppliedDateTo) : "";
      if (pf) pf.value = dashboardAppliedDateFrom || "";
      if (pt) pt.value = dashboardAppliedDateTo || "";
      const drb = $("#dashboard-role-badge");
      if (drb) drb.textContent = role === "supervisor" ? "Supervisor" : "Manager";
      showView("dashboard");
      renderDashboard();
      setDashboardManagerSection("analytics");
      renderManagerAssignWorkUI();
      renderAssigneeWorkMount("dashboard-assigned-work", role, true);
    } else {
      const cpId = parsePortalIdFromRole(role);
      if (cpId) {
        stopTsTick();
        const portal = findCustomPortalById(cpId);
        if (!portal || !portal.fields || portal.fields.length === 0) {
          alert("This portal is not available. Ask an administrator.");
          logout();
          return;
        }
        showView("customPortal");
        const ht = $("#custom-portal-title");
        if (ht) ht.textContent = portal.title;
        mountCustomPortalForm(portal);
        customPortalEditEntryId = null;
        customPortalEditPortalId = null;
        const cce = $("#custom-portal-cancel-edit");
        if (cce) cce.hidden = true;
        const csb = $("#custom-portal-submit-btn");
        if (csb) csb.textContent = "Submit";
        setCustomPortalSubView("form");
        const fm = $("#custom-portal-form");
        if (fm) fm.hidden = false;
        startTsTick("#custom-portal-timestamp");
      } else if (role === "admin") {
        stopTsTick();
        showView("admin");
        renderAdminCredentials();
        setAdminCredTab("field");
        renderAdminCustomPortalsList();
        setAdminSection("credentials");
        const am = $("#admin-msg");
        am.hidden = true;
        am.textContent = "";
      }
    }
    if (role === "admin") {
      /* no assigned-work mounts */
    } else if (role === "dashboard" || role === "supervisor") {
      /* assign work UI + mount handled in dashboard branch */
    } else if (typeof role === "string" && role.startsWith("cp_")) {
      renderAssigneeWorkMount("custom-portal-assigned-work", role);
    } else if (role === "field" || role === "survey") {
      renderAssigneeWorkMount(`${role}-assigned-work`, role);
    }
    updateSwitchPortalButtons();
    if (sessionUsername && sessionRole) persistSessionAuth();
  }

  /**
   * Login match: username compared case-insensitively; password trimmed on both sides
   * (avoids copy/paste issues). Returns canonical username from the credential row.
   */
  function matchingRolesForLogin(username, password) {
    const u = String(username ?? "").trim();
    const p = String(password ?? "").trim();
    const matches = [];
    let sessionUser = null;
    const noteHit = (roleKey, canonUser) => {
      matches.push(roleKey);
      if (sessionUser == null && canonUser) sessionUser = canonUser;
    };
    const rowMatches = (c) => {
      const cu = String(c.username ?? "").trim();
      if (!cu || cu.toLowerCase() !== u.toLowerCase()) return false;
      const cp = String(c.password ?? "").trim();
      return cp === p;
    };
    for (const role of ROLE_KEYS) {
      for (const c of getCredentialList(role)) {
        if (rowMatches(c)) {
          noteHit(role, String(c.username ?? "").trim());
          break;
        }
      }
    }
    for (const portal of getCustomPortalsList()) {
      for (const c of portal.credentials || []) {
        if (rowMatches(c)) {
          noteHit(portalRoleKey(portal.id), String(c.username ?? "").trim());
          break;
        }
      }
    }
    if (matches.length > 0) return { matches, sessionUser };
    const adm = state.credentials.admin;
    if (adm && rowMatches({ username: adm.username, password: adm.password })) {
      return { matches: ["admin"], sessionUser: String(adm.username ?? "").trim() };
    }
    return { matches: [], sessionUser: null };
  }

  function showRolePicker(matches, opts = {}) {
    rolePickerMode = opts.fromSwitch ? "switch" : "login";
    const heading = $("#role-picker-heading");
    const intro = $("#role-picker-intro");
    const backBtn = $("#role-picker-back");
    if (rolePickerMode === "switch") {
      if (heading) heading.textContent = "Switch portal";
      if (intro) {
        intro.textContent =
          "Choose another portal your account can open. Cancel returns you here without signing out.";
      }
      if (backBtn) backBtn.textContent = "Cancel";
    } else {
      if (heading) heading.textContent = "Choose portal";
      if (intro) {
        intro.textContent =
          "This username and password are set up for more than one area. Select where you want to go.";
      }
      if (backBtn) backBtn.textContent = "Back to sign in";
    }
    const container = $("#role-picker-buttons");
    if (!container) return;
    container.innerHTML = "";
    const matchSet = new Set(matches);
    const order = getRolePickerOrder();
    const seen = new Set();
    const ordered = [];
    for (const r of order) {
      if (matchSet.has(r) && !seen.has(r)) {
        ordered.push(r);
        seen.add(r);
      }
    }
    for (const r of matches) {
      if (r && !seen.has(r)) {
        ordered.push(r);
        seen.add(r);
      }
    }
    ordered.forEach((role) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn primary role-picker-btn";
      btn.dataset.role = role;
      btn.textContent = getRoleLabel(role);
      container.appendChild(btn);
    });
    container.querySelectorAll(".role-picker-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-role");
        if (rolePickerMode === "switch" && role === sessionRole) {
          showView(viewKeyForRole(role));
          return;
        }
        sessionRole = role;
        enterPortal(role);
      });
    });
    showView("rolePicker");
  }

  function stopTsTick() {
    if (tsInterval) {
      clearInterval(tsInterval);
      tsInterval = null;
    }
  }

  function formatNow() {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "medium",
    }).format(new Date());
  }

  function startTsTick(targetId) {
    stopTsTick();
    const el = $(targetId);
    if (!el) return;
    const tick = () => {
      el.textContent = formatNow();
    };
    tick();
    tsInterval = setInterval(tick, 1000);
  }

  function getCredentialList(role) {
    const raw = state.credentials[role];
    return normalizeRoleCredentialList(raw, defaultState().credentials[role]);
  }

  function clearSessionAuth() {
    try {
      sessionStorage.removeItem(SESSION_AUTH_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function persistSessionAuth() {
    if (!sessionUsername || !sessionRole) return;
    try {
      sessionStorage.setItem(
        SESSION_AUTH_KEY,
        JSON.stringify({ username: sessionUsername, role: sessionRole })
      );
    } catch (e) {
      /* private mode / quota */
    }
  }

  function rolesForUsername(username) {
    const u = (username && String(username).trim()) || "";
    const matches = [];
    if (!u) return matches;
    const uLow = u.toLowerCase();
    for (const role of ROLE_KEYS) {
      if (
        getCredentialList(role).some(
          (c) => c && String(c.username || "").trim().toLowerCase() === uLow
        )
      ) {
        matches.push(role);
      }
    }
    for (const portal of getCustomPortalsList()) {
      if (
        (portal.credentials || []).some(
          (c) => c && String(c.username || "").trim().toLowerCase() === uLow
        )
      ) {
        matches.push(portalRoleKey(portal.id));
      }
    }
    const adm = state.credentials && state.credentials.admin;
    if (adm && String(adm.username).trim().toLowerCase() === uLow) matches.push("admin");
    return matches;
  }

  function usernameHasAccessToRole(username, role) {
    const u = (username && String(username).trim()) || "";
    if (!u || !role) return false;
    return rolesForUsername(u).includes(role);
  }

  function tryRestoreSessionAuth() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(SESSION_AUTH_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) return false;
    let o;
    try {
      o = JSON.parse(raw);
    } catch (e) {
      clearSessionAuth();
      return false;
    }
    const username = o && o.username != null ? String(o.username).trim() : "";
    const role = o && o.role != null ? String(o.role).trim() : "";
    if (!username || !role) {
      clearSessionAuth();
      return false;
    }
    if (!usernameHasAccessToRole(username, role)) {
      clearSessionAuth();
      return false;
    }
    sessionUsername = username;
    sessionRole = role;
    sessionPortalOptions = rolesForUsername(username);
    if (!sessionPortalOptions.includes(role)) {
      clearSessionAuth();
      sessionUsername = null;
      sessionRole = null;
      sessionPortalOptions = null;
      return false;
    }
    enterPortal(role);
    return true;
  }

  function setError(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function revokeFieldPhotoUrl() {
    if (fieldPhotoObjectUrl) {
      URL.revokeObjectURL(fieldPhotoObjectUrl);
      fieldPhotoObjectUrl = null;
    }
  }

  function releaseCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    const video = $("#field-camera-video");
    if (video) video.srcObject = null;
  }

  function closeCameraPanel() {
    const panel = $("#field-camera-panel");
    if (panel) panel.hidden = true;
    const errEl = $("#field-camera-error");
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
  }

  function stopCamera() {
    releaseCamera();
    closeCameraPanel();
  }

  function clearFieldCameraCapture() {
    fieldCameraDataUrl = null;
  }

  function showPhotoPreviewFromSrc(src) {
    const img = $("#field-photo-preview");
    if (!img) return;
    img.src = src;
    img.hidden = false;
  }

  function logout() {
    clearSessionAuth();
    sessionRole = null;
    sessionUsername = null;
    sessionPortalOptions = null;
    stopTsTick();
    stopCamera();
    stopCustomPortalCamera();
    resetCustomPortalImageState();
    clearFieldCameraCapture();
    destroyDashboardCharts();
    dashboardAppliedDateFrom = "";
    dashboardAppliedDateTo = "";
    setDashboardManagerSection("analytics");
    const df = $("#dash-date-from");
    const dt = $("#dash-date-to");
    const pf = $("#dash-date-from-picker");
    const pt = $("#dash-date-to-picker");
    if (df) df.value = "";
    if (dt) dt.value = "";
    if (pf) pf.value = "";
    if (pt) pt.value = "";
    updateSwitchPortalButtons();
    showView("login");
    $("#login-username").value = "";
    const lp = $("#login-password");
    const lt = $("#login-toggle-pass");
    lp.value = "";
    lp.type = "password";
    if (lt) {
      lt.textContent = "Show";
      lt.setAttribute("aria-pressed", "false");
    }
    setError("#login-error", "");
    fieldEditEntryId = null;
    surveyEditEntryId = null;
    customPortalEditEntryId = null;
    customPortalEditPortalId = null;
  }

  function readPhotoAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read photo"));
      reader.readAsDataURL(file);
    });
  }

  function startOfDayYmd(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const parts = ymd.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  }

  function getEntrySubmittedTime(entry) {
    if (entry.submittedAt) {
      const t = new Date(entry.submittedAt);
      if (!Number.isNaN(t.getTime())) return t;
    }
    if (entry.timestamp) {
      return parseTimestampString(entry.timestamp);
    }
    return null;
  }

  function dateRangeIsActive(fromStr, toStr) {
    return !!(fromStr || toStr);
  }

  /**
   * When a range is applied, compare local calendar dates (YYYY-MM-DD internally, from dd/mm/yyyy inputs).
   */
  function instantInDateRange(t, fromStr, toStr) {
    if (!dateRangeIsActive(fromStr, toStr)) return true;
    if (!t || Number.isNaN(t.getTime())) return false;
    const ymd = localCalendarYmd(t);
    if (fromStr && ymd < fromStr) return false;
    if (toStr && ymd > toStr) return false;
    return true;
  }

  function filterFieldByDateRange(list, fromStr, toStr) {
    if (!fromStr && !toStr) return list.slice();
    return list.filter((e) => instantInDateRange(getEntrySubmittedTime(e), fromStr, toStr));
  }

  function filterSurveyByDateRange(list, fromStr, toStr) {
    if (!fromStr && !toStr) return list.slice();
    return list.filter((e) => instantInDateRange(getEntrySubmittedTime(e), fromStr, toStr));
  }

  function getDashboardFilteredDatasets() {
    const fromStr = dashboardAppliedDateFrom;
    const toStr = dashboardAppliedDateTo;
    const custom = {};
    getCustomPortalsList().forEach((p) => {
      const list = (state.customPortalEntries && state.customPortalEntries[p.id]) || [];
      custom[p.id] = filterCustomPortalEntriesByDate(list, fromStr, toStr);
    });
    return {
      field: filterFieldByDateRange(state.fieldEntries || [], fromStr, toStr),
      survey: filterSurveyByDateRange(state.surveyEntries || [], fromStr, toStr),
      custom,
    };
  }

  function formatAssignmentScopeLabel(scope) {
    if (!scope || scope === "all") return "All portals";
    if (typeof scope === "string" && scope.toLowerCase().startsWith("cp_")) {
      const pid = parsePortalIdFromRole(scope);
      const p = pid && findCustomPortalById(pid);
      return p ? `${p.title} (custom)` : "Custom portal";
    }
    return ROLE_LABELS[scope] || scope;
  }

  function assignmentVisibleOnPortal(a, username, portalScope) {
    const u = (username || "").trim().toLowerCase();
    const t = (a.targetUsername || "").trim().toLowerCase();
    if (!u || t !== u) return false;
    const s = a.scope || "all";
    if (s === "all") return true;
    return s === portalScope;
  }

  function countAssigneeWorkForPortal(portalScope) {
    const u = sessionUsername && String(sessionUsername).trim();
    if (!u) return 0;
    return (state.workAssignments || []).filter(
      (a) => assignmentVisibleOnPortal(a, u, portalScope) && !workAssignmentIsDone(a)
    ).length;
  }

  function setNavBadge(badgeEl, count) {
    if (!badgeEl) return;
    if (count < 1) {
      badgeEl.hidden = true;
      badgeEl.textContent = "";
      badgeEl.setAttribute("aria-hidden", "true");
      return;
    }
    badgeEl.hidden = false;
    badgeEl.textContent = count > 99 ? "99+" : String(count);
    badgeEl.setAttribute("aria-hidden", "false");
  }

  function syncAssignedWorkBadges() {
    const u = sessionUsername && String(sessionUsername).trim();
    const pairs = [
      ["field-assigned-work-badge", "field"],
      ["survey-assigned-work-badge", "survey"],
    ];
    pairs.forEach(([bid, scope]) => {
      const el = document.getElementById(bid);
      if (!el) return;
      if (!u) {
        el.hidden = true;
        el.textContent = "";
        el.setAttribute("aria-hidden", "true");
        return;
      }
      setNavBadge(el, countAssigneeWorkForPortal(scope));
    });
    const dashBadge = document.getElementById("dashboard-assigned-work-badge");
    if (dashBadge) {
      if (!u) {
        dashBadge.hidden = true;
        dashBadge.textContent = "";
        dashBadge.setAttribute("aria-hidden", "true");
      } else {
        const dashScope =
          sessionRole === "dashboard" || sessionRole === "supervisor" ? sessionRole : "dashboard";
        setNavBadge(dashBadge, countAssigneeWorkForPortal(dashScope));
      }
    }
    const cBad = $("#custom-portal-assigned-work-badge");
    const form = $("#custom-portal-form");
    const pid = form && form.dataset.portalId;
    if (cBad) {
      if (!u || !pid) {
        cBad.hidden = true;
        cBad.textContent = "";
        cBad.setAttribute("aria-hidden", "true");
      } else {
        setNavBadge(cBad, countAssigneeWorkForPortal(portalRoleKey(pid)));
      }
    }
  }

  function collectAssignableUserRows() {
    const rows = [];
    const seen = new Set();
    const adm = (state.credentials.admin && state.credentials.admin.username) || "";
    const admLow = adm.trim().toLowerCase();
    for (const role of ROLE_KEYS) {
      for (const c of getCredentialList(role)) {
        const u = (c.username || "").trim();
        if (!u) continue;
        const low = u.toLowerCase();
        if (admLow && low === admLow) continue;
        if (seen.has(low)) continue;
        seen.add(low);
        rows.push({ username: u, hint: ROLE_LABELS[role] || role });
      }
    }
    for (const p of getCustomPortalsList()) {
      for (const c of p.credentials || []) {
        const u = (c.username || "").trim();
        if (!u) continue;
        const low = u.toLowerCase();
        if (admLow && low === admLow) continue;
        if (seen.has(low)) continue;
        seen.add(low);
        rows.push({ username: u, hint: p.title || "Custom portal" });
      }
    }
    rows.sort((a, b) => a.username.localeCompare(b.username));
    return rows;
  }

  function syncManagerAssignWorkFormSelects() {
    const tu = $("#assign-work-target-user");
    const sc = $("#assign-work-scope");
    if (!tu || !sc) return;
    const prevU = tu.value;
    const prevS = sc.value;
    tu.innerHTML = "";
    const rows = collectAssignableUserRows();
    if (rows.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No non-admin logins yet";
      tu.appendChild(o);
    } else {
      rows.forEach((row) => {
        const o = document.createElement("option");
        o.value = row.username;
        o.textContent = `${row.username} — ${row.hint}`;
        tu.appendChild(o);
      });
    }
    if (prevU && Array.from(tu.options).some((opt) => opt.value === prevU)) tu.value = prevU;

    sc.innerHTML = "";
    const addOpt = (value, label) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      sc.appendChild(o);
    };
    addOpt("all", "All portals");
    addOpt("field", "Work report (field)");
    addOpt("survey", "Employee survey");
    addOpt("dashboard", "Dashboard");
    addOpt("supervisor", "Supervisor");
    getCustomPortalsList().forEach((p) => {
      addOpt(portalRoleKey(p.id), `${p.title} (custom portal)`);
    });
    if (prevS && Array.from(sc.options).some((opt) => opt.value === prevS)) sc.value = prevS;
  }

  function updateManagerAssignmentsFilterButtons() {
    const root = $("#assign-work-manager-filter");
    if (!root) return;
    root.querySelectorAll("[data-assign-manager-filter]").forEach((btn) => {
      const mode = btn.getAttribute("data-assign-manager-filter");
      const on = mode === managerAssignmentsFilter;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function managerAssignmentSearchHaystack(a) {
    const parts = [];
    if (a.targetUsername) parts.push(String(a.targetUsername));
    if (a.instructions) parts.push(String(a.instructions));
    if (a.assignedBy) parts.push(String(a.assignedBy));
    parts.push(formatAssignmentScopeLabel(a.scope));
    if (a.id) parts.push(String(a.id));
    const when = new Date(a.assignedAt);
    if (!Number.isNaN(when.getTime())) {
      parts.push(
        when.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
        when.toLocaleDateString(),
        when.toISOString()
      );
    }
    if (a.deadline) {
      parts.push(formatWorkAssignmentDeadline(a.deadline), String(a.deadline));
    } else {
      parts.push("no deadline");
    }
    parts.push(workAssignmentIsDone(a) ? "yes completed done" : "no active");
    const ack = a.acknowledgedAt && new Date(a.acknowledgedAt);
    const done = a.completedAt && new Date(a.completedAt);
    if (ack && !Number.isNaN(ack.getTime())) {
      parts.push(ack.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }));
    }
    if (done && !Number.isNaN(done.getTime())) {
      parts.push(done.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }));
    }
    return parts.join(" ").toLowerCase();
  }

  function managerAssignmentMatchesSearch(a, rawQuery) {
    const q = String(rawQuery || "").trim().toLowerCase();
    if (!q) return true;
    const hay = managerAssignmentSearchHaystack(a);
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    return tokens.every((t) => hay.includes(t));
  }

  function renderManagerAssignmentsTable() {
    const wrap = $("#dash-assignments-list");
    if (!wrap) return;
    const searchEl = $("#assign-work-manager-search");
    const searchQ = searchEl && searchEl.value != null ? searchEl.value : "";
    const all = (state.workAssignments || [])
      .slice()
      .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));
    const list = all.filter((a) =>
      managerAssignmentsFilter === "completed" ? workAssignmentIsDone(a) : !workAssignmentIsDone(a)
    );
    const filtered = list.filter((a) => managerAssignmentMatchesSearch(a, searchQ));
    wrap.innerHTML = "";
    updateManagerAssignmentsFilterButtons();
    if (all.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.textContent = "No assignments yet.";
      wrap.appendChild(p);
      return;
    }
    if (list.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.textContent =
        managerAssignmentsFilter === "completed"
          ? "No completed assignments yet."
          : "No active assignments.";
      wrap.appendChild(p);
      return;
    }
    if (filtered.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.textContent = "No assignments match your search.";
      wrap.appendChild(p);
      return;
    }
    const tw = document.createElement("div");
    tw.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "assigned-work-table";
    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>When</th><th>User</th><th>Portal</th><th>By</th><th>Task</th><th>Deadline</th><th>Done</th><th></th></tr>";
    table.appendChild(thead);
    const tb = document.createElement("tbody");
    filtered.forEach((a) => {
      const tr = document.createElement("tr");
      const when = new Date(a.assignedAt);
      const whenStr = Number.isNaN(when.getTime())
        ? "—"
        : when.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
      const td0 = document.createElement("td");
      const sm0 = document.createElement("small");
      sm0.textContent = whenStr;
      td0.appendChild(sm0);
      const td1 = document.createElement("td");
      td1.textContent = a.targetUsername;
      const td2 = document.createElement("td");
      td2.textContent = formatAssignmentScopeLabel(a.scope);
      const td3 = document.createElement("td");
      const sm3 = document.createElement("small");
      sm3.textContent = a.assignedBy || "—";
      td3.appendChild(sm3);
      const td4 = document.createElement("td");
      td4.className = "assigned-work-table-task";
      td4.textContent = a.instructions;
      const tdDl = document.createElement("td");
      const smDl = document.createElement("small");
      if (a.deadline) {
        smDl.textContent = formatWorkAssignmentDeadline(a.deadline);
        if (workAssignmentDeadlineOverdue(a)) {
          tdDl.className = "assigned-work-deadline-overdue-cell";
          smDl.className = "assigned-work-deadline-overdue-text";
        }
      } else {
        smDl.textContent = "—";
      }
      tdDl.appendChild(smDl);
      const tdDone = document.createElement("td");
      tdDone.textContent = workAssignmentIsDone(a) ? "Yes" : "No";
      const td5 = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost assign-work-remove";
      btn.dataset.assignDel = a.id;
      btn.textContent = "Remove";
      td5.appendChild(btn);
      tr.appendChild(td0);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tr.appendChild(tdDl);
      tr.appendChild(tdDone);
      tr.appendChild(td5);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tw.appendChild(table);
    wrap.appendChild(tw);
  }

  function renderManagerAssignWorkUI() {
    const card = $("#dash-manager-assign-work");
    if (!card) return;
    const isMgr = isDashboardManagerRole();
    card.hidden = !isMgr;
    if (!isMgr) return;
    syncManagerAssignWorkFormSelects();
    renderManagerAssignmentsTable();
  }

  function renderAssigneeWorkMount(mountId, portalScope, embedded) {
    const el = document.getElementById(mountId);
    if (!el) return;
    const u = sessionUsername && String(sessionUsername).trim();
    if (!u) {
      el.innerHTML = "";
      syncAssignedWorkBadges();
      return;
    }
    const list = (state.workAssignments || [])
      .filter((a) => assignmentVisibleOnPortal(a, u, portalScope))
      .sort((a, b) => {
        const da = workAssignmentIsDone(a) ? 1 : 0;
        const db = workAssignmentIsDone(b) ? 1 : 0;
        if (da !== db) return da - db;
        return new Date(b.assignedAt) - new Date(a.assignedAt);
      });
    el.innerHTML = "";
    const wrap = !embedded;
    let container = el;
    if (wrap) {
      const card = document.createElement("div");
      card.className = "card assigned-work-assignee-card";
      const h = document.createElement("h2");
      h.textContent = "Assigned work";
      card.appendChild(h);
      const sub = document.createElement("p");
      sub.className = "muted";
      sub.style.marginTop = "0";
      sub.textContent = `Tasks from a manager or supervisor for your login (${u}) in this portal.`;
      card.appendChild(sub);
      el.appendChild(card);
      container = card;
    }
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.style.marginBottom = "0";
      empty.textContent = "Nothing assigned here right now.";
      container.appendChild(empty);
      syncAssignedWorkBadges();
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "assigned-work-assignee-list";
    list.forEach((a) => {
      const li = document.createElement("li");
      li.className = "assigned-work-assignee-item";
      const meta = document.createElement("div");
      meta.className = "assigned-work-assignee-meta";
      const when = new Date(a.assignedAt);
      const whenStr = Number.isNaN(when.getTime())
        ? ""
        : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      meta.appendChild(document.createTextNode(whenStr));
      if (a.scope && a.scope !== "all") {
        const scopeSp = document.createElement("span");
        scopeSp.className = "assigned-work-scope-pill";
        scopeSp.textContent = formatAssignmentScopeLabel(a.scope);
        meta.appendChild(scopeSp);
      }
      if (a.deadline) {
        const dlSp = document.createElement("span");
        const overdue = workAssignmentDeadlineOverdue(a);
        dlSp.className = overdue
          ? "assigned-work-deadline-pill is-overdue"
          : "assigned-work-deadline-pill";
        const ds = formatWorkAssignmentDeadline(a.deadline);
        dlSp.textContent = overdue ? `Overdue: ${ds}` : `Due: ${ds}`;
        meta.appendChild(dlSp);
      }
      if (a.deadline && !workAssignmentIsDone(a)) {
        const rem = document.createElement("span");
        rem.className = "assigned-work-deadline-remaining";
        rem.setAttribute("data-deadline-iso", a.deadline);
        rem.textContent = workAssignmentTimeRemainingLabel(a.deadline, false);
        meta.appendChild(rem);
      }
      const body = document.createElement("div");
      body.className = "assigned-work-assignee-body";
      body.textContent = a.instructions;
      li.appendChild(meta);
      li.appendChild(body);
      const actions = document.createElement("div");
      actions.className = "assigned-work-assignee-actions";
      if (workAssignmentIsDone(a)) {
        const sp = document.createElement("span");
        sp.className = "assigned-work-completed";
        const doneWhen = a.completedAt || a.acknowledgedAt;
        const d = doneWhen ? new Date(doneWhen) : null;
        const ds =
          d && !Number.isNaN(d.getTime())
            ? d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
            : "";
        sp.textContent = ds ? `Completed · ${ds}` : "Completed";
        actions.appendChild(sp);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost assign-work-complete-btn";
        btn.dataset.assignComplete = a.id;
        btn.textContent = "Mark completed";
        actions.appendChild(btn);
      }
      li.appendChild(actions);
      ul.appendChild(li);
    });
    container.appendChild(ul);
    syncAssignedWorkBadges();
    ensureAssigneeDeadlineRemainingsTick();
  }

  function refreshAllAssigneeWorkMounts() {
    renderAssigneeWorkMount("field-assigned-work", "field");
    renderAssigneeWorkMount("survey-assigned-work", "survey");
    const dashScope =
      sessionRole === "dashboard" || sessionRole === "supervisor" ? sessionRole : "dashboard";
    renderAssigneeWorkMount("dashboard-assigned-work", dashScope, true);
    const form = $("#custom-portal-form");
    const pid = form && form.dataset.portalId;
    if (pid) {
      renderAssigneeWorkMount("custom-portal-assigned-work", portalRoleKey(pid));
    } else {
      const c = $("#custom-portal-assigned-work");
      if (c) c.innerHTML = "";
    }
  }

  function updateDashboardDateHint(fromStr, toStr) {
    const el = $("#dash-date-active-hint");
    if (!el) return;
    if (!fromStr && !toStr) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    const fmt = (ymd) => formatYmdToDdMmYyyy(ymd) || ymd;
    let msg = "Filtered: ";
    if (fromStr && toStr) msg += `${fmt(fromStr)} – ${fmt(toStr)} (dd/mm/yyyy)`;
    else if (fromStr) msg += `from ${fmt(fromStr)} (dd/mm/yyyy)`;
    else msg += `through ${fmt(toStr)} (dd/mm/yyyy)`;
    el.textContent = msg;
    el.hidden = false;
  }

  function setDashboardSectionVisibility(filter) {
    const dash = $("#view-dashboard");
    if (!dash) return;
    dash.querySelectorAll("[data-dash-for]").forEach((el) => {
      const raw = el.getAttribute("data-dash-for") || "";
      const modes = raw.split(",").map((s) => s.trim()).filter(Boolean);
      let visible;
      if (modes.length === 1 && modes[0] === "all") {
        visible = filter === "all";
      } else {
        visible = filter === "all" || modes.includes(filter);
      }
      el.hidden = !visible;
    });
  }

  function setDashboardTabsUI(filter) {
    const tabs = $("#dashboard-portal-tabs");
    if (!tabs) return;
    tabs.querySelectorAll("[data-dash-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-dash-tab") === filter;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function destroyDashboardCharts() {
    dashboardChartList.forEach((c) => {
      try {
        c.destroy();
      } catch {
        /* ignore */
      }
    });
    dashboardChartList = [];
  }

  function chartCommonText() {
    return {
      legend: { labels: { color: "#6b5d52", font: { size: 12 } } },
      tooltip: {
        backgroundColor: "#ffffff",
        titleColor: "#3d2e22",
        bodyColor: "#3d2e22",
        borderColor: "#d4c4b0",
        borderWidth: 1,
      },
    };
  }

  function syncDashboardCustomTabs() {
    const tabs = $("#dashboard-portal-tabs");
    if (!tabs) return;
    tabs.querySelectorAll("[data-dash-tab^='cp_']").forEach((b) => b.remove());
    getCustomPortalsList().forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-btn";
      btn.setAttribute("role", "tab");
      btn.setAttribute("data-dash-tab", portalRoleKey(p.id));
      btn.setAttribute("aria-selected", "false");
      const t = p.title;
      btn.textContent = t.length > 26 ? t.slice(0, 24) + "…" : t;
      btn.title = t;
      tabs.appendChild(btn);
    });
  }

  function syncDashboardCustomStats(filteredCustom) {
    const grid = $("#dash-stats-grid");
    if (!grid) return;
    grid.querySelectorAll("[data-dash-stat-custom]").forEach((el) => el.remove());
    getCustomPortalsList().forEach((p) => {
      const n = (filteredCustom[p.id] || []).length;
      const div = document.createElement("div");
      div.className = "stat";
      div.setAttribute("data-dash-for", portalRoleKey(p.id));
      div.setAttribute("data-dash-stat-custom", "1");
      const val = document.createElement("div");
      val.className = "stat-value";
      val.textContent = String(n);
      const lab = document.createElement("div");
      lab.className = "stat-label";
      const short = p.title.length > 32 ? p.title.slice(0, 30) + "…" : p.title;
      lab.textContent = short + " (custom)";
      div.appendChild(val);
      div.appendChild(lab);
      grid.appendChild(div);
    });
  }

  function syncDashboardCustomPanels(filteredCustom) {
    const wrap = $("#dash-custom-panels");
    if (!wrap) return;
    wrap.innerHTML = "";
    getCustomPortalsList().forEach((p) => {
      const entries = filteredCustom[p.id] || [];
      const card = document.createElement("div");
      card.className = "card dash-table-card dash-custom-panel";
      card.style.marginBottom = "1.25rem";
      card.setAttribute("data-dash-for", portalRoleKey(p.id));
      const h = document.createElement("h2");
      h.textContent = p.title;
      const sub = document.createElement("p");
      sub.className = "muted";
      sub.textContent = "Latest custom portal responses (up to 25).";
      card.appendChild(h);
      card.appendChild(sub);
      const tableWrap = document.createElement("div");
      tableWrap.className = "table-wrap";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      const thLogin = document.createElement("th");
      thLogin.textContent = "Login ID";
      trh.appendChild(thLogin);
      p.fields.forEach((f) => {
        const th = document.createElement("th");
        th.textContent = f.label;
        trh.appendChild(th);
      });
      const thT = document.createElement("th");
      thT.textContent = "Timestamp";
      trh.appendChild(thT);
      thead.appendChild(trh);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      const rows = entries.slice().reverse().slice(0, 25);
      if (rows.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = Math.max(1, p.fields.length) + 2;
        td.className = "muted";
        td.textContent = "No submissions yet.";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        rows.forEach((row) => {
          const tr = document.createElement("tr");
          const tdLogin = document.createElement("td");
          const smLogin = document.createElement("small");
          smLogin.textContent = formatDashboardLoginId(row);
          tdLogin.appendChild(smLogin);
          tr.appendChild(tdLogin);
          p.fields.forEach((f) => {
            const td = document.createElement("td");
            const v = row.answers && row.answers[f.id] != null ? row.answers[f.id] : "";
            if (
              f.type === "image" &&
              typeof v === "string" &&
              v.startsWith("data:image")
            ) {
              const im = document.createElement("img");
              im.className = "thumb";
              im.alt = "";
              im.src = v;
              td.appendChild(im);
            } else if (typeof v === "number") {
              td.textContent = String(v);
            } else {
              td.textContent = String(v);
            }
            tr.appendChild(td);
          });
          const tdTs = document.createElement("td");
          const sm = document.createElement("small");
          sm.textContent = row.timestamp || "—";
          tdTs.appendChild(sm);
          tr.appendChild(tdTs);
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      card.appendChild(tableWrap);
      wrap.appendChild(card);
    });
  }

  function renderDashboardCharts(field, survey, customByPortal) {
    destroyDashboardCharts();
    const ChartCtor = typeof Chart !== "undefined" ? Chart : null;
    if (!ChartCtor) return;

    const filter = dashboardFilter;
    const colors = ["#8b5e34", "#a67c52", "#c4a574", "#6b8f71", "#7d6b5c", "#b8956a"];

    const scaleOpts = {
      ticks: { color: "#6b5d52" },
      grid: { color: "rgba(61, 46, 34, 0.12)" },
    };

    if (filter === "all") {
      const el = document.getElementById("chart-portal-volume");
      if (el) {
        const portals = getCustomPortalsList();
        const labels = ["Work report", "Survey"];
        const data = [field.length, survey.length];
        const bg = [colors[0], colors[1]];
        let ci = 2;
        portals.forEach((p) => {
          const short = p.title.length > 18 ? p.title.slice(0, 16) + "…" : p.title;
          labels.push(short);
          data.push((customByPortal[p.id] || []).length);
          bg.push(colors[ci % colors.length]);
          ci += 1;
        });
        dashboardChartList.push(
          new ChartCtor(el, {
            type: "bar",
            data: {
              labels,
              datasets: [
                {
                  label: "Records",
                  data,
                  backgroundColor: bg,
                  borderWidth: 0,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                ...chartCommonText(),
                legend: { display: false },
              },
              scales: {
                x: scaleOpts,
                y: { ...scaleOpts, beginAtZero: true },
              },
            },
          })
        );
      }
    }

    if (filter === "all" || filter === "field") {
      const yes = field.filter((e) => e.workDone === "yes").length;
      const no = field.filter((e) => e.workDone === "no").length;
      const el = document.getElementById("chart-work-done");
      if (el) {
        dashboardChartList.push(
          new ChartCtor(el, {
            type: "doughnut",
            data: {
              labels: ["Work done: yes", "Work done: no"],
              datasets: [
                {
                  data: [yes, no],
                  backgroundColor: [colors[1], colors[4]],
                  borderColor: "#ffffff",
                  borderWidth: 2,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { ...chartCommonText(), legend: { position: "bottom" } },
            },
          })
        );
      }
    }

    if (filter === "all" || filter === "survey") {
      const sexLabels = {
        female: "Female",
        male: "Male",
        non_binary: "Non-binary",
        prefer_not: "Prefer not to say",
        other: "Other",
      };
      const counts = {};
      survey.forEach((e) => {
        const k = e.sex || "unknown";
        counts[k] = (counts[k] || 0) + 1;
      });
      const keys = Object.keys(counts);
      const el = document.getElementById("chart-survey-sex");
      if (el && keys.length > 0) {
        dashboardChartList.push(
          new ChartCtor(el, {
            type: "bar",
            data: {
              labels: keys.map((k) => sexLabels[k] || k),
              datasets: [
                {
                  label: "Responses",
                  data: keys.map((k) => counts[k]),
                  backgroundColor: keys.map((_, i) => colors[i % colors.length]),
                  borderWidth: 0,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { ...chartCommonText(), legend: { display: false } },
              scales: {
                x: scaleOpts,
                y: { ...scaleOpts, beginAtZero: true },
              },
            },
          })
        );
      } else if (el) {
        dashboardChartList.push(
          new ChartCtor(el, {
            type: "bar",
            data: { labels: ["No data yet"], datasets: [{ data: [0], backgroundColor: colors[4] }] },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { ...chartCommonText(), legend: { display: false } },
              scales: { x: scaleOpts, y: { ...scaleOpts, beginAtZero: true } },
            },
          })
        );
      }
    }
  }

  function renderDashboard() {
    const { field, survey, custom } = getDashboardFilteredDatasets();
    syncDashboardCustomTabs();
    const cpFilterId = parsePortalIdFromRole(dashboardFilter);
    if (cpFilterId && !findCustomPortalById(cpFilterId)) {
      dashboardFilter = "all";
    }
    syncDashboardCustomStats(custom);
    syncDashboardCustomPanels(custom);

    const statField = $("#stat-field-count");
    if (statField) statField.textContent = String(field.length);
    const statSurvey = $("#stat-survey-count");
    if (statSurvey) statSurvey.textContent = String(survey.length);
    const workYes = field.filter((e) => e.workDone === "yes").length;
    const statWorkYes = $("#stat-work-yes");
    if (statWorkYes) statWorkYes.textContent = String(workYes);

    updateDashboardDateHint(dashboardAppliedDateFrom, dashboardAppliedDateTo);

    const fieldBody = $("#dash-field-body");
    if (fieldBody) {
      fieldBody.innerHTML = "";
      field
        .slice()
        .reverse()
        .slice(0, 25)
        .forEach((e) => {
          const tr = document.createElement("tr");
          const thumb = e.photoDataUrl
            ? `<img class="thumb" src="${e.photoDataUrl}" alt="" />`
            : "—";
          tr.innerHTML = `
            <td><small>${escapeHtml(formatDashboardLoginId(e))}</small></td>
            <td>${escapeHtml(e.name)}</td>
            <td>${escapeHtml(e.phone)}</td>
            <td>${escapeHtml(e.workDone)}</td>
            <td>${thumb}</td>
            <td><small>${escapeHtml(e.timestamp)}</small></td>
          `;
          fieldBody.appendChild(tr);
        });
    }

    const surveyBody = $("#dash-survey-body");
    if (surveyBody) {
      surveyBody.innerHTML = "";
      survey
        .slice()
        .reverse()
        .slice(0, 25)
        .forEach((e) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><small>${escapeHtml(formatDashboardLoginId(e))}</small></td>
            <td>${escapeHtml(String(e.employees))}</td>
            <td>${escapeHtml(String(e.age))}</td>
            <td>${escapeHtml(e.sex)}</td>
            <td><small>${escapeHtml(e.timestamp)}</small></td>
          `;
          surveyBody.appendChild(tr);
        });
    }

    setDashboardTabsUI(dashboardFilter);
    setDashboardSectionVisibility(dashboardFilter);
    renderDashboardCharts(field, survey, custom);
    if (isDashboardManagerRole()) {
      renderAssigneeWorkMount("dashboard-assigned-work", sessionRole, true);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function getLatestFieldEntry() {
    const list = state.fieldEntries || [];
    if (!list.length) return null;
    return list[list.length - 1];
  }

  function getLatestSurveyEntry() {
    const list = state.surveyEntries || [];
    if (!list.length) return null;
    return list[list.length - 1];
  }

  function getLatestCustomEntry(portalId) {
    const list = (state.customPortalEntries && state.customPortalEntries[portalId]) || [];
    if (!list.length) return null;
    return list[list.length - 1];
  }

  function entrySubmittedBy() {
    return (sessionUsername && String(sessionUsername).trim()) || "";
  }

  /** Dashboard cell: login username used to sign in for this submission. */
  function formatDashboardLoginId(entry) {
    const v = entry && entry.submittedBy != null ? String(entry.submittedBy).trim() : "";
    return v || "—";
  }

  function clearFieldEditMode() {
    fieldEditEntryId = null;
    const form = $("#field-form");
    if (form) form.reset();
    stopCamera();
    clearFieldCameraCapture();
    revokeFieldPhotoUrl();
    const prev = $("#field-photo-preview");
    if (prev) {
      prev.hidden = true;
      prev.removeAttribute("src");
    }
    const c = $("#field-cancel-edit");
    if (c) c.hidden = true;
    const sb = $("#field-submit-btn");
    if (sb) sb.textContent = "Submit report";
    renderFieldHistory();
  }

  function beginFieldEditEntry(e) {
    const latest = getLatestFieldEntry();
    if (!e || !latest || e.id !== latest.id) return;
    setFieldPortalSubView("form");
    fieldEditEntryId = e.id;
    $("#field-name").value = e.name || "";
    $("#field-phone").value = e.phone || "";
    $$('input[name="work_done"]').forEach((r) => {
      r.checked = r.value === e.workDone;
    });
    stopCamera();
    revokeFieldPhotoUrl();
    clearFieldCameraCapture();
    const fp = $("#field-photo");
    if (fp) fp.value = "";
    fieldCameraDataUrl = e.photoDataUrl || null;
    const prevImg = $("#field-photo-preview");
    if (e.photoDataUrl) {
      showPhotoPreviewFromSrc(e.photoDataUrl);
    } else if (prevImg) {
      prevImg.hidden = true;
      prevImg.removeAttribute("src");
    }
    const c = $("#field-cancel-edit");
    if (c) c.hidden = false;
    const sb = $("#field-submit-btn");
    if (sb) sb.textContent = "Save changes";
    renderFieldHistory();
  }

  function renderFieldHistory() {
    const wrap = $("#field-history-list");
    if (!wrap) return;
    const list = (state.fieldEntries || []).slice().reverse();
    wrap.innerHTML = "";
    if (list.length === 0) {
      wrap.innerHTML = '<p class="muted" style="margin:0">No reports yet.</p>';
      return;
    }
    const latest = getLatestFieldEntry();
    list.forEach((e) => {
      const isLatest = latest && e.id === latest.id;
      const row = document.createElement("div");
      row.className = "portal-history-row" + (isLatest ? " is-latest" : "");
      const body = document.createElement("div");
      body.className = "portal-history-body";
      if (e.photoDataUrl && String(e.photoDataUrl).startsWith("data:image")) {
        const im = document.createElement("img");
        im.className = "portal-history-thumb";
        im.alt = "";
        im.src = e.photoDataUrl;
        body.appendChild(im);
      }
      const text = document.createElement("div");
      text.className = "portal-history-text";
      const l1 = document.createElement("div");
      l1.innerHTML = `<strong>${escapeHtml(e.name || "—")}</strong> · ${escapeHtml(e.phone || "—")} · work: ${escapeHtml(e.workDone || "—")}`;
      const l2 = document.createElement("div");
      l2.className = "muted small";
      l2.textContent = e.timestamp || "—";
      text.appendChild(l1);
      text.appendChild(l2);
      body.appendChild(text);
      row.appendChild(body);
      if (isLatest) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost portal-history-edit";
        btn.dataset.fieldEntryId = e.id;
        btn.textContent = "Edit";
        row.appendChild(btn);
      } else {
        const sp = document.createElement("span");
        sp.className = "portal-history-readonly muted";
        sp.textContent = "Read only";
        row.appendChild(sp);
      }
      wrap.appendChild(row);
    });
  }

  function clearSurveyEditMode() {
    surveyEditEntryId = null;
    const form = $("#survey-form");
    if (form) form.reset();
    const c = $("#survey-cancel-edit");
    if (c) c.hidden = true;
    const sb = $("#survey-submit-btn");
    if (sb) sb.textContent = "Submit";
    renderSurveyHistory();
  }

  function beginSurveyEditEntry(e) {
    const latest = getLatestSurveyEntry();
    if (!e || !latest || e.id !== latest.id) return;
    setSurveyPortalSubView("form");
    surveyEditEntryId = e.id;
    $("#survey-employees").value = String(e.employees ?? "");
    $("#survey-age").value = String(e.age ?? "");
    $("#survey-sex").value = e.sex || "";
    const c = $("#survey-cancel-edit");
    if (c) c.hidden = false;
    const sb = $("#survey-submit-btn");
    if (sb) sb.textContent = "Save changes";
    renderSurveyHistory();
  }

  function renderSurveyHistory() {
    const wrap = $("#survey-history-list");
    if (!wrap) return;
    const list = (state.surveyEntries || []).slice().reverse();
    wrap.innerHTML = "";
    if (list.length === 0) {
      wrap.innerHTML = '<p class="muted" style="margin:0">No responses yet.</p>';
      return;
    }
    const latest = getLatestSurveyEntry();
    list.forEach((e) => {
      const isLatest = latest && e.id === latest.id;
      const row = document.createElement("div");
      row.className = "portal-history-row" + (isLatest ? " is-latest" : "");
      const body = document.createElement("div");
      body.className = "portal-history-body";
      const text = document.createElement("div");
      text.className = "portal-history-text";
      const l1 = document.createElement("div");
      l1.innerHTML = `Employees: <strong>${escapeHtml(String(e.employees))}</strong> · Age: ${escapeHtml(String(e.age))} · Sex: ${escapeHtml(e.sex || "—")}`;
      const l2 = document.createElement("div");
      l2.className = "muted small";
      l2.textContent = e.timestamp || "—";
      text.appendChild(l1);
      text.appendChild(l2);
      body.appendChild(text);
      row.appendChild(body);
      if (isLatest) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost portal-history-edit";
        btn.dataset.surveyEntryId = e.id;
        btn.textContent = "Edit";
        row.appendChild(btn);
      } else {
        const sp = document.createElement("span");
        sp.className = "portal-history-readonly muted";
        sp.textContent = "Read only";
        row.appendChild(sp);
      }
      wrap.appendChild(row);
    });
  }

  function clearCustomPortalEditMode(portal) {
    customPortalEditEntryId = null;
    customPortalEditPortalId = null;
    if (portal) {
      mountCustomPortalForm(portal);
      renderCustomPortalHistory(portal);
    }
    const c = $("#custom-portal-cancel-edit");
    if (c) c.hidden = true;
    const sb = $("#custom-portal-submit-btn");
    if (sb) sb.textContent = "Submit";
    setCustomPortalSubView("form");
  }

  function populateCustomPortalFromEntry(portal, entry) {
    const latest = getLatestCustomEntry(portal.id);
    if (!entry || !latest || entry.id !== latest.id) return;
    setCustomPortalSubView("form");
    customPortalEditPortalId = portal.id;
    customPortalEditEntryId = entry.id;
    resetCustomPortalImageState();
    const form = $("#custom-portal-form");
    if (!form) return;
    const answers = entry.answers || {};
    portal.fields.forEach((f) => {
      if (f.type === "image") {
        const v = answers[f.id];
        if (v && String(v).startsWith("data:image")) {
          customPortalImageDataUrlByField[f.id] = v;
          syncCustomPortalImagePreview(f.id, v);
        }
      } else if (f.type === "buttons") {
        const val = answers[f.id] != null ? String(answers[f.id]) : "";
        form
          .querySelectorAll(`input[type="radio"].custom-portal-input[data-field-id="${f.id}"]`)
          .forEach((r) => {
            r.checked = r.value === val;
          });
      } else {
        const inp = Array.from(form.querySelectorAll(".custom-portal-input[data-field-id]")).find(
          (el) => el.getAttribute("data-field-id") === f.id && el.matches("input, textarea, select")
        );
        if (inp) {
          inp.value = answers[f.id] != null ? String(answers[f.id]) : "";
        }
      }
    });
    const c = $("#custom-portal-cancel-edit");
    if (c) c.hidden = false;
    const sb = $("#custom-portal-submit-btn");
    if (sb) sb.textContent = "Save changes";
    renderCustomPortalHistory(portal);
  }

  function renderCustomPortalHistory(portal) {
    const wrap = $("#custom-portal-history-list");
    if (!wrap || !portal) return;
    const list = ((state.customPortalEntries && state.customPortalEntries[portal.id]) || []).slice().reverse();
    wrap.innerHTML = "";
    if (list.length === 0) {
      wrap.innerHTML = '<p class="muted" style="margin:0">No responses yet.</p>';
      return;
    }
    const latest = getLatestCustomEntry(portal.id);
    list.forEach((entry) => {
      const isLatest = latest && entry.id === latest.id;
      const row = document.createElement("div");
      row.className = "portal-history-row" + (isLatest ? " is-latest" : "");
      const body = document.createElement("div");
      body.className = "portal-history-body";
      const textWrap = document.createElement("div");
      textWrap.className = "portal-history-text portal-history-custom";
      const line = document.createElement("div");
      line.className = "portal-history-custom-fields";
      let any = false;
      portal.fields.forEach((f) => {
        const v = entry.answers && entry.answers[f.id];
        if (f.type === "image" && v && String(v).startsWith("data:image")) {
          any = true;
          const sp = document.createElement("span");
          sp.className = "portal-history-inline-img";
          const im = document.createElement("img");
          im.className = "portal-history-thumb";
          im.alt = "";
          im.src = v;
          sp.appendChild(im);
          line.appendChild(sp);
        } else if (v != null && v !== "") {
          any = true;
          const s = typeof v === "number" ? String(v) : String(v);
          const short = s.length > 80 ? s.slice(0, 78) + "…" : s;
          const span = document.createElement("span");
          span.innerHTML = `<strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(short)}`;
          line.appendChild(span);
        }
      });
      if (!any) {
        const em = document.createElement("span");
        em.className = "muted";
        em.textContent = "—";
        line.appendChild(em);
      }
      textWrap.appendChild(line);
      const ts = document.createElement("div");
      ts.className = "muted small";
      ts.textContent = entry.timestamp || "—";
      textWrap.appendChild(ts);
      body.appendChild(textWrap);
      row.appendChild(body);
      if (isLatest) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost portal-history-edit";
        btn.dataset.customEntryId = entry.id;
        btn.textContent = "Edit";
        row.appendChild(btn);
      } else {
        const sp = document.createElement("span");
        sp.className = "portal-history-readonly muted";
        sp.textContent = "Read only";
        row.appendChild(sp);
      }
      wrap.appendChild(row);
    });
  }

  function renderCustomPortalRemindersPanel() {
    const body = $("#custom-portal-reminders-body");
    const form = $("#custom-portal-form");
    if (!body || !form) return;
    const portalId = form.dataset.portalId;
    const portal = portalId && findCustomPortalById(portalId);
    if (!portal || !portal.followUpReminderEnabled) {
      body.innerHTML =
        '<p class="muted" style="margin:0">Reminders are not enabled for this portal. An administrator can turn them on under Admin → Custom portals.</p>';
      return;
    }
    const days = portal.followUpReminderDays || 7;
    const parts = [];
    parts.push(
      `<p class="muted">These notices stay in this portal only (nothing is emailed). After each submission, if you have not submitted a newer entry, a reminder appears here once <strong>${escapeHtml(String(days))}</strong> full calendar day(s) have passed. Submitting again resets the countdown.</p>`
    );
    const latest = getLatestCustomEntry(portal.id);
    if (!latest) {
      parts.push("<p>Submit the form once — after that, the schedule starts from your first response.</p>");
      body.innerHTML = parts.join("");
      return;
    }
    const anchor = new Date(latest.submittedAt);
    if (Number.isNaN(anchor.getTime())) {
      parts.push('<p class="muted">Could not read the last submission time.</p>');
      body.innerHTML = parts.join("");
      return;
    }
    const due = addCalendarDaysFromDate(anchor, days);
    const overdue = Date.now() >= due.getTime();
    parts.push(
      `<p><strong>Last submission</strong><br>${escapeHtml(latest.timestamp || formatReminderWhen(anchor))}</p>`
    );
    parts.push(
      `<p><strong>Reminder shows from (approx.)</strong><br>${escapeHtml(formatReminderWhen(due))}</p>`
    );
    if (overdue) {
      parts.push(
        '<div class="error-banner" style="margin-top:0.75rem" role="status"><strong>Reminder:</strong> It is time for your next entry in this portal. Submit the form when you can — that clears this reminder for a new cycle.</div>'
      );
    } else {
      parts.push(
        '<p class="muted" style="margin-top:0.65rem">No active reminder yet. Check back after the date above if you still have not submitted again.</p>'
      );
    }
    body.innerHTML = parts.join("");
  }

  function formatReminderWhen(d) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  }

  function buildCredRow(role, username, password) {
    const wrap = document.createElement("div");
    wrap.className = "admin-cred-row";
    wrap.setAttribute("data-role", role);

    const fields = document.createElement("div");
    fields.className = "admin-cred-fields form";

    const l1 = document.createElement("div");
    l1.className = "field";
    const sl1 = document.createElement("span");
    sl1.className = "field-label";
    sl1.textContent = "Username";
    const userWrap = document.createElement("div");
    userWrap.className = "password-with-toggle";
    const uIn = document.createElement("input");
    uIn.type = "text";
    uIn.className = "admin-cred-user";
    uIn.autocomplete = "off";
    uIn.value = username;
    userWrap.appendChild(uIn);
    l1.appendChild(sl1);
    l1.appendChild(userWrap);

    const l2 = document.createElement("div");
    l2.className = "field";
    const sl2 = document.createElement("span");
    sl2.className = "field-label";
    sl2.textContent = "Password";
    const passWrap = document.createElement("div");
    passWrap.className = "password-with-toggle";
    const pIn = document.createElement("input");
    pIn.type = "password";
    pIn.className = "admin-cred-pass";
    pIn.autocomplete = "new-password";
    pIn.value = password;
    const pToggle = document.createElement("button");
    pToggle.type = "button";
    pToggle.className = "btn ghost btn-toggle-pass";
    pToggle.setAttribute("aria-pressed", "false");
    pToggle.textContent = "Show";
    passWrap.appendChild(pIn);
    passWrap.appendChild(pToggle);
    l2.appendChild(sl2);
    l2.appendChild(passWrap);

    fields.appendChild(l1);
    fields.appendChild(l2);
    wrap.appendChild(fields);
    return wrap;
  }

  function appendRemoveButton(row) {
    if (row.querySelector(".admin-cred-remove")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost admin-cred-remove";
    btn.textContent = "Remove";
    row.appendChild(btn);
  }

  function refreshRemoveButtonsVisibility(container) {
    const rows = container.querySelectorAll(".admin-cred-row");
    rows.forEach((row) => {
      const btn = row.querySelector(".admin-cred-remove");
      if (rows.length <= 1) {
        if (btn) btn.remove();
      } else if (!btn) {
        appendRemoveButton(row);
      }
    });
  }

  function renderAdminCredentials() {
    ROLE_KEYS.forEach((role) => {
      const container = document.getElementById(`admin-accounts-${role}`);
      if (!container) return;
      container.innerHTML = "";
      const list = getCredentialList(role);
      if (list.length === 0) {
        container.appendChild(buildCredRow(role, "", ""));
      } else {
        list.forEach((c) => {
          container.appendChild(buildCredRow(role, c.username, c.password));
        });
      }
      refreshRemoveButtonsVisibility(container);
    });
  }

  function setAdminCredTab(role) {
    if (!ROLE_KEYS.includes(role)) return;
    adminCredActiveRole = role;
    $$(".admin-cred-panel").forEach((el) => {
      const r = el.getAttribute("data-admin-cred-panel");
      el.hidden = r !== role;
    });
    const tabsRoot = $("#admin-cred-tabs");
    if (tabsRoot) {
      tabsRoot.querySelectorAll("[data-admin-cred-tab]").forEach((btn) => {
        const on = btn.getAttribute("data-admin-cred-tab") === role;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    const saveBtn = $("#admin-save-cred-tab");
    if (saveBtn) {
      const label = ROLE_LABELS[role] || role;
      saveBtn.textContent = `Save logins — ${label}`;
    }
  }

  function setAdminSection(section) {
    if (section !== "credentials" && section !== "custom") return;
    const credEl = $("#admin-section-credentials");
    const custEl = $("#admin-section-custom");
    if (credEl) credEl.hidden = section !== "credentials";
    if (custEl) custEl.hidden = section !== "custom";
    const tabsRoot = $("#admin-section-tabs");
    if (tabsRoot) {
      tabsRoot.querySelectorAll("[data-admin-section]").forEach((btn) => {
        const on = btn.getAttribute("data-admin-section") === section;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    if (section === "custom") {
      renderAdminCustomPortalsList();
      updateAdminCustomTabHighlight();
    }
  }

  function validateCredentialsForRole(role, list) {
    if (!list || list.length < 1) {
      return `Add at least one login for “${ROLE_LABELS[role] || role}”.`;
    }
    for (const c of list) {
      if (!c.username) return "Every login needs a username (remove empty rows or fill them in).";
      if (!c.password) return `Password is required for user “${c.username}”.`;
    }
    const seen = new Set();
    for (const c of list) {
      const key = c.username.toLowerCase();
      if (seen.has(key)) {
        return `Duplicate username “${c.username}” in this section (${role}).`;
      }
      seen.add(key);
    }
    const adm = (state.credentials.admin && state.credentials.admin.username) || "";
    const admLower = adm.trim().toLowerCase();
    if (admLower) {
      for (const c of list) {
        if (c.username.toLowerCase() === admLower) {
          return `Username “${c.username}” is already used for the admin account.`;
        }
      }
    }
    return null;
  }

  function collectRoleCredentialsFromForm(role) {
    const container = document.getElementById(`admin-accounts-${role}`);
    if (!container) return [];
    const out = [];
    container.querySelectorAll(".admin-cred-row").forEach((row) => {
      const u = row.querySelector(".admin-cred-user")?.value.trim() || "";
      const p = row.querySelector(".admin-cred-pass")?.value ?? "";
      if (!u && !p) return;
      out.push({ username: u, password: p });
    });
    return out;
  }

  function validateCollectedCredentials(byRole) {
    for (const role of ROLE_KEYS) {
      const list = byRole[role];
      if (!list || list.length < 1) {
        return `Add at least one login for “${role}”.`;
      }
      for (const c of list) {
        if (!c.username) return "Every login needs a username (remove empty rows or fill them in).";
        if (!c.password) return `Password is required for user “${c.username}”.`;
      }
    }
    for (const role of ROLE_KEYS) {
      const seen = new Set();
      for (const c of byRole[role]) {
        const key = c.username.toLowerCase();
        if (seen.has(key)) {
          return `Duplicate username “${c.username}” in the same section (${role}).`;
        }
        seen.add(key);
      }
    }
    const adm = (state.credentials.admin && state.credentials.admin.username) || "";
    const admLower = adm.trim().toLowerCase();
    if (admLower) {
      for (const role of ROLE_KEYS) {
        for (const c of byRole[role]) {
          if (c.username.toLowerCase() === admLower) {
            return `Username “${c.username}” is already used for the admin account.`;
          }
        }
      }
      for (const portal of getCustomPortalsList()) {
        for (const c of portal.credentials || []) {
          if (c.username && c.username.toLowerCase() === admLower) {
            return `Username “${c.username}” is used on a custom portal and matches the admin username.`;
          }
        }
      }
    }
    return null;
  }

  function setAdminCustomMsg(text, kind) {
    const el = $("#admin-custom-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.className = kind === "error" ? "error-banner" : "success-banner";
  }

  function collectCustomEditorCreds() {
    const container = $("#admin-custom-creds");
    if (!container) return [];
    const out = [];
    container.querySelectorAll(".admin-cred-row").forEach((row) => {
      const u = row.querySelector(".admin-cred-user")?.value.trim() || "";
      const p = row.querySelector(".admin-cred-pass")?.value ?? "";
      if (!u && !p) return;
      out.push({ username: u, password: p });
    });
    return out;
  }

  function adminAppendQuestionRow(f) {
    const qroot = $("#admin-custom-questions");
    if (!qroot) return;
    const row = document.createElement("div");
    row.className = "admin-custom-q-row";
    const idIn = document.createElement("input");
    idIn.type = "hidden";
    idIn.className = "admin-q-id";
    idIn.value = f && f.id ? f.id : "";
    const grid = document.createElement("div");
    grid.className = "admin-custom-q-grid";
    const labelField = document.createElement("label");
    labelField.className = "field";
    const ll = document.createElement("span");
    ll.className = "field-label";
    ll.textContent = "Question label";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "admin-q-label";
    labelInput.placeholder = "e.g. Department";
    labelInput.value = f && f.label ? f.label : "";
    labelInput.autocomplete = "off";
    labelField.appendChild(ll);
    labelField.appendChild(labelInput);
    const typeField = document.createElement("label");
    typeField.className = "field";
    const tl = document.createElement("span");
    tl.className = "field-label";
    tl.textContent = "Type";
    const typeSel = document.createElement("select");
    typeSel.className = "admin-q-type";
    [
      ["text", "Short text"],
      ["textarea", "Long text"],
      ["number", "Number"],
      ["select", "Dropdown"],
      ["buttons", "Buttons (1–3 choices)"],
      ["image", "Photo / image"],
    ].forEach(([v, lab]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lab;
      typeSel.appendChild(o);
    });
    typeSel.value = f && f.type ? f.type : "text";
    typeField.appendChild(tl);
    typeField.appendChild(typeSel);
    const optField = document.createElement("label");
    optField.className = "field admin-q-options-wrap";
    const ol = document.createElement("span");
    ol.className = "field-label";
    ol.textContent = "Dropdown options (comma-separated)";
    const optInput = document.createElement("input");
    optInput.type = "text";
    optInput.className = "admin-q-options";
    optInput.placeholder = "Yes, No, Maybe";
    optInput.value =
      f && (f.type === "select" || f.type === "buttons") && Array.isArray(f.options)
        ? f.options.join(", ")
        : "";
    optField.appendChild(ol);
    optField.appendChild(optInput);
    const reqRow = document.createElement("label");
    reqRow.className = "check-row admin-q-required-wrap";
    const reqCb = document.createElement("input");
    reqCb.type = "checkbox";
    reqCb.className = "admin-q-required";
    reqCb.checked = !!(f && f.required);
    const reqSp = document.createElement("span");
    reqSp.textContent = "Required";
    reqRow.appendChild(reqCb);
    reqRow.appendChild(reqSp);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn ghost admin-custom-q-remove";
    rm.textContent = "Remove";
    grid.appendChild(labelField);
    grid.appendChild(typeField);
    grid.appendChild(optField);
    grid.appendChild(reqRow);
    grid.appendChild(rm);
    row.appendChild(idIn);
    row.appendChild(grid);
    qroot.appendChild(row);
    function syncOptVisibility() {
      const t = typeSel.value;
      const showOpts = t === "select" || t === "buttons";
      optField.style.display = showOpts ? "" : "none";
      if (t === "buttons") {
        ol.textContent = "Button choices (1–3, comma-separated)";
        optInput.placeholder = "e.g. Yes, No, Maybe";
      } else {
        ol.textContent = "Dropdown options (comma-separated)";
        optInput.placeholder = "Yes, No, Maybe";
      }
    }
    typeSel.addEventListener("change", syncOptVisibility);
    syncOptVisibility();
  }

  function readQuestionsFromEditor() {
    const qroot = $("#admin-custom-questions");
    if (!qroot) return [];
    const fields = [];
    qroot.querySelectorAll(".admin-custom-q-row").forEach((row) => {
      let id = row.querySelector(".admin-q-id")?.value.trim() || "";
      if (!id) id = portalNewId();
      const label = row.querySelector(".admin-q-label")?.value.trim() || "";
      const type = row.querySelector(".admin-q-type")?.value || "text";
      const required = !!row.querySelector(".admin-q-required")?.checked;
      const optRaw = row.querySelector(".admin-q-options")?.value || "";
      const options =
        type === "select" || type === "buttons"
          ? optRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
      if (!label) return;
      if (type === "select" && options.length === 0) {
        throw new Error(`Dropdown “${label}” needs at least one option (comma-separated).`);
      }
      if (type === "buttons") {
        if (options.length === 0) {
          throw new Error(`Buttons “${label}” needs at least one choice (comma-separated, max 3).`);
        }
        if (options.length > 3) {
          throw new Error(
            `Buttons “${label}” allows at most 3 choices (fewer than 4). You entered ${options.length}. Use Dropdown for more options.`
          );
        }
      }
      fields.push(normalizeCustomField({ id, label, type, required, options }));
    });
    return fields;
  }

  function validateCustomPortalCredentials(creds) {
    if (!creds || creds.length < 1) return "Add at least one login for this portal.";
    for (const c of creds) {
      if (!c.username) return "Every login needs a username.";
      if (!c.password) return `Password is required for user “${c.username}”.`;
    }
    const seen = new Set();
    for (const c of creds) {
      const k = c.username.toLowerCase();
      if (seen.has(k)) return `Duplicate username “${c.username}” in this portal.`;
      seen.add(k);
    }
    const admLower = (state.credentials.admin && state.credentials.admin.username.trim().toLowerCase()) || "";
    if (admLower) {
      for (const c of creds) {
        if (c.username.toLowerCase() === admLower) {
          return "This portal cannot use the same username as the admin account.";
        }
      }
    }
    return null;
  }

  function adminCustomTabButtonLabel(title) {
    const t = (title || "").trim();
    if (!t) return "Untitled";
    return t.length > 24 ? t.slice(0, 22) + "\u2026" : t;
  }

  function updateAdminCustomTabHighlight() {
    const tabsRoot = $("#admin-custom-tabs");
    if (!tabsRoot) return;
    tabsRoot.querySelectorAll("[data-admin-custom-tab]").forEach((btn) => {
      const id = btn.getAttribute("data-admin-custom-tab");
      const on = !!(adminCustomActivePortalId && id === adminCustomActivePortalId);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setAdminCustomTab(portalId) {
    const p = findCustomPortalById(portalId);
    if (p) openAdminCustomEditor(p);
  }

  function openAdminCustomEditor(portal) {
    const editor = $("#admin-custom-editor");
    const hid = $("#admin-custom-edit-id");
    const titleIn = $("#admin-custom-title");
    const qh = $("#admin-custom-editor-heading");
    const delBtn = $("#admin-custom-delete");
    if (!editor || !hid || !titleIn || !qh) return;
    adminCustomActivePortalId = portal ? portal.id : null;
    if (delBtn) delBtn.hidden = !portal;
    editor.hidden = false;
    hid.value = portal ? portal.id : "";
    titleIn.value = portal ? portal.title : "";
    qh.textContent = portal ? "Edit portal" : "New portal";
    const qroot = $("#admin-custom-questions");
    if (qroot) qroot.innerHTML = "";
    if (portal && portal.fields && portal.fields.length) {
      portal.fields.forEach((field) => adminAppendQuestionRow(field));
    } else {
      adminAppendQuestionRow(null);
    }
    const credC = $("#admin-custom-creds");
    if (credC) {
      credC.innerHTML = "";
      const creds =
        portal && portal.credentials && portal.credentials.length
          ? portal.credentials
          : [{ username: "", password: "" }];
      creds.forEach((c) => credC.appendChild(buildCredRow("custom", c.username, c.password)));
      refreshRemoveButtonsVisibility(credC);
    }
    const remEn = $("#admin-custom-reminder-enabled");
    const remDays = $("#admin-custom-reminder-days");
    if (remEn) remEn.checked = !!(portal && portal.followUpReminderEnabled);
    if (remDays) remDays.value = String(portal && portal.followUpReminderDays ? portal.followUpReminderDays : 7);
    setAdminCustomMsg("", null);
    updateAdminCustomTabHighlight();
    editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeAdminCustomEditor() {
    const editor = $("#admin-custom-editor");
    if (editor) editor.hidden = true;
    adminCustomActivePortalId = null;
    const delBtn = $("#admin-custom-delete");
    if (delBtn) delBtn.hidden = true;
    updateAdminCustomTabHighlight();
  }

  function renderAdminCustomPortalsList() {
    const tabsRoot = $("#admin-custom-tabs");
    const emptyHint = $("#admin-custom-empty-hint");
    if (!tabsRoot) return;
    const portals = getCustomPortalsList();
    tabsRoot.innerHTML = "";
    if (emptyHint) {
      emptyHint.hidden = portals.length > 0;
    }
    if (portals.length === 0) {
      tabsRoot.hidden = true;
      updateAdminCustomTabHighlight();
      return;
    }
    tabsRoot.hidden = false;
    portals.forEach((portal) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-btn admin-custom-tab";
      btn.setAttribute("role", "tab");
      btn.setAttribute("data-admin-custom-tab", portal.id);
      btn.setAttribute("aria-selected", "false");
      btn.textContent = adminCustomTabButtonLabel(portal.title);
      btn.title = portal.title;
      tabsRoot.appendChild(btn);
    });
    updateAdminCustomTabHighlight();
  }

  const loginFormEl = $("#login-form");
  if (loginFormEl) {
    loginFormEl.addEventListener("submit", (ev) => {
      ev.preventDefault();
      setError("#login-error", "");
      const uIn = $("#login-username");
      const pIn = $("#login-password");
      if (!uIn || !pIn) return;
      const username = uIn.value;
      const password = pIn.value;
      const { matches, sessionUser } = matchingRolesForLogin(username, password);
      if (matches.length === 0) {
        setError("#login-error", "Invalid username or password.");
        return;
      }
      sessionUsername = sessionUser || String(username ?? "").trim();
      if (matches.length === 1) {
        sessionPortalOptions = matches.slice();
        sessionRole = matches[0];
        enterPortal(matches[0]);
        return;
      }
      sessionPortalOptions = matches.slice();
      showRolePicker(matches);
    });
  }

  const rolePickerBack = $("#role-picker-back");
  if (rolePickerBack) {
    rolePickerBack.addEventListener("click", () => {
      if (rolePickerMode === "switch" && sessionRole) {
        showView(viewKeyForRole(sessionRole));
      } else {
        sessionPortalOptions = null;
        sessionUsername = null;
        clearSessionAuth();
        showView("login");
        setError("#login-error", "");
      }
    });
  }

  const appRoot = $(".app");
  if (!appRoot) {
    console.error("multi-login-portal: missing .app root; buttons will not work.");
  }
  if (appRoot) appRoot.addEventListener("click", (ev) => {
    const passBtn = closestFromEvent(ev, ".btn-toggle-pass");
    if (passBtn) {
      let input = null;
      if (passBtn.id === "login-toggle-pass") {
        input = document.getElementById("login-password");
      } else {
        const wrap = passBtn.closest(".password-with-toggle");
        input =
          wrap &&
          (wrap.querySelector(".admin-cred-pass") ||
            wrap.querySelector('input[type="password"]'));
      }
      if (input) {
        togglePasswordVisibility(passBtn, input);
        return;
      }
    }

    const secBtn = closestFromEvent(ev, "[data-admin-section]");
    const secTabsRoot = $("#admin-section-tabs");
    if (secBtn && secTabsRoot && secTabsRoot.contains(secBtn)) {
      setAdminSection(secBtn.getAttribute("data-admin-section"));
      return;
    }

    const credTabBtn = closestFromEvent(ev, "[data-admin-cred-tab]");
    const credTabsRoot = $("#admin-cred-tabs");
    if (credTabBtn && credTabsRoot && credTabsRoot.contains(credTabBtn)) {
      const r = credTabBtn.getAttribute("data-admin-cred-tab");
      if (ROLE_KEYS.includes(r)) setAdminCredTab(r);
      return;
    }

    const custTabBtn = closestFromEvent(ev, "[data-admin-custom-tab]");
    const custTabsRoot = $("#admin-custom-tabs");
    if (custTabBtn && custTabsRoot && custTabsRoot.contains(custTabBtn)) {
      const pid = custTabBtn.getAttribute("data-admin-custom-tab");
      if (pid) setAdminCustomTab(pid);
      return;
    }

    const dashTabBtn = closestFromEvent(ev, "[data-dash-tab]");
    const dashTabsRoot = $("#dashboard-portal-tabs");
    if (dashTabBtn && dashTabsRoot && dashTabsRoot.contains(dashTabBtn)) {
      const f = dashTabBtn.getAttribute("data-dash-tab");
      if (["all", "field", "survey"].includes(f) || (f && f.startsWith("cp_"))) {
        dashboardFilter = f;
        setDashboardTabsUI(f);
        setDashboardSectionVisibility(f);
        const ds = getDashboardFilteredDatasets();
        renderDashboardCharts(ds.field, ds.survey, ds.custom);
      }
      return;
    }

    const dashSecBtn = closestFromEvent(ev, "[data-dash-section]");
    const dashMgrTabs = $("#dashboard-manager-section-tabs");
    if (dashSecBtn && dashMgrTabs && dashMgrTabs.contains(dashSecBtn)) {
      const sec = dashSecBtn.getAttribute("data-dash-section");
      if (sec === "assign" || sec === "analytics") setDashboardManagerSection(sec);
      return;
    }

    const sw = closestFromEvent(ev, "[data-switch-portal]");
    if (sw && sessionPortalOptions && sessionPortalOptions.length >= 2) {
      showRolePicker(sessionPortalOptions.slice(), { fromSwitch: true });
      return;
    }

    const mgrFilter = closestFromEvent(ev, "[data-assign-manager-filter]");
    if (mgrFilter && isDashboardManagerRole()) {
      const mode = mgrFilter.getAttribute("data-assign-manager-filter");
      if (mode === "active" || mode === "completed") {
        managerAssignmentsFilter = mode;
        renderManagerAssignmentsTable();
      }
      return;
    }
    const delAssign = closestFromEvent(ev, "[data-assign-del]");
    if (delAssign && isDashboardManagerRole()) {
      const id = delAssign.getAttribute("data-assign-del");
      if (id) {
        state.workAssignments = (state.workAssignments || []).filter((x) => x.id !== id);
        saveState(state);
        renderManagerAssignmentsTable();
        refreshAllAssigneeWorkMounts();
      }
      return;
    }
    const completeAssign = closestFromEvent(ev, ".assign-work-complete-btn");
    if (completeAssign && sessionUsername) {
      const id = completeAssign.getAttribute("data-assign-complete");
      const a = id && (state.workAssignments || []).find((x) => x.id === id);
      if (
        a &&
        (a.targetUsername || "").trim().toLowerCase() === sessionUsername.trim().toLowerCase() &&
        !workAssignmentIsDone(a)
      ) {
        a.completedAt = new Date().toISOString();
        saveState(state);
        renderManagerAssignmentsTable();
        refreshAllAssigneeWorkMounts();
      }
      return;
    }
    const form = $("#custom-portal-form");
    const formHit = elementFromEventTarget(ev);
    if (form && formHit && form.contains(formHit)) {
      const camOpen = closestFromEvent(ev, ".custom-portal-camera-open");
      if (camOpen) {
        ev.preventDefault();
        const fieldId = camOpen.getAttribute("data-field-id");
        if (fieldId) openCustomPortalCameraField(fieldId);
        return;
      }
      if (closestFromEvent(ev, "#custom-portal-camera-capture")) {
        captureCustomPortalCameraField();
        return;
      }
      if (closestFromEvent(ev, "#custom-portal-camera-cancel")) {
        stopCustomPortalCamera();
        return;
      }
    }
  });

  if (appRoot) appRoot.addEventListener("change", (ev) => {
    const t = elementFromEventTarget(ev);
    const form = $("#custom-portal-form");
    if (!form || !t || !form.contains(t) || !t.matches(".custom-portal-image-file")) return;
    const fieldId = t.getAttribute("data-field-id");
    const file = t.files && t.files[0];
    if (fieldId) handleCustomPortalImageFileChosen(fieldId, file || null);
  });

  $$("[data-logout]").forEach((btn) => btn.addEventListener("click", logout));

  const assignWorkSubmit = $("#assign-work-submit");
  if (assignWorkSubmit) {
    assignWorkSubmit.addEventListener("click", () => {
      if (!isDashboardManagerRole()) return;
      const tu = $("#assign-work-target-user");
      const sc = $("#assign-work-scope");
      const ta = $("#assign-work-instructions");
      const dlIn = $("#assign-work-deadline");
      const username = ((tu && tu.value) || "").trim();
      const scope = ((sc && sc.value) || "all").trim() || "all";
      const instructions = ((ta && ta.value) || "").trim();
      const preset = (dlIn && dlIn.value && String(dlIn.value).trim()) || "";
      const deadline = workAssignmentDeadlineFromPreset(preset);
      if (!username) {
        alert("Choose a user to assign work to.");
        return;
      }
      if (!instructions) {
        alert("Describe what they should do.");
        return;
      }
      if (!Array.isArray(state.workAssignments)) state.workAssignments = [];
      state.workAssignments.push({
        id: entryId(),
        targetUsername: username,
        instructions,
        scope,
        assignedAt: new Date().toISOString(),
        assignedBy: entrySubmittedBy(),
        acknowledgedAt: null,
        completedAt: null,
        deadline,
      });
      saveState(state);
      if (ta) ta.value = "";
      if (dlIn) dlIn.value = "";
      renderManagerAssignmentsTable();
      refreshAllAssigneeWorkMounts();
    });
  }

  const assignWorkSearch = $("#assign-work-manager-search");
  if (assignWorkSearch) {
    assignWorkSearch.addEventListener("input", () => {
      if (isDashboardManagerRole()) renderManagerAssignmentsTable();
    });
  }

  const fieldBtnHist = $("#field-btn-view-history");
  if (fieldBtnHist) fieldBtnHist.addEventListener("click", () => setFieldPortalSubView("history"));
  const fieldBtnBack = $("#field-btn-back-form");
  if (fieldBtnBack) fieldBtnBack.addEventListener("click", () => setFieldPortalSubView("form"));
  const fieldBtnAssigned = $("#field-btn-assigned-work");
  if (fieldBtnAssigned) fieldBtnAssigned.addEventListener("click", () => setFieldPortalSubView("assigned"));

  const viewField = $("#view-field");
  if (viewField) {
    viewField.addEventListener("click", (ev) => {
      if (closestFromEvent(ev, "#field-cancel-edit")) {
        clearFieldEditMode();
        return;
      }
      const ed = closestFromEvent(ev, ".portal-history-edit");
      if (ed && $("#field-history-list") && $("#field-history-list").contains(ed)) {
        const id = ed.getAttribute("data-field-entry-id");
        const e = (state.fieldEntries || []).find((x) => x.id === id);
        if (e) beginFieldEditEntry(e);
      }
    });
  }

  const surveyBtnHist = $("#survey-btn-view-history");
  if (surveyBtnHist) surveyBtnHist.addEventListener("click", () => setSurveyPortalSubView("history"));
  const surveyBtnBack = $("#survey-btn-back-form");
  if (surveyBtnBack) surveyBtnBack.addEventListener("click", () => setSurveyPortalSubView("form"));
  const surveyBtnAssigned = $("#survey-btn-assigned-work");
  if (surveyBtnAssigned) surveyBtnAssigned.addEventListener("click", () => setSurveyPortalSubView("assigned"));

  const cpBtnHist = $("#custom-portal-btn-view-history");
  if (cpBtnHist) cpBtnHist.addEventListener("click", () => setCustomPortalSubView("history"));
  const cpBtnRem = $("#custom-portal-btn-reminders");
  if (cpBtnRem) cpBtnRem.addEventListener("click", () => setCustomPortalSubView("reminders"));
  const cpBtnBack = $("#custom-portal-btn-back-form");
  if (cpBtnBack) cpBtnBack.addEventListener("click", () => setCustomPortalSubView("form"));
  const cpBtnAssigned = $("#custom-portal-btn-assigned-work");
  if (cpBtnAssigned) cpBtnAssigned.addEventListener("click", () => setCustomPortalSubView("assigned"));

  const viewSurvey = $("#view-survey");
  if (viewSurvey) {
    viewSurvey.addEventListener("click", (ev) => {
      if (closestFromEvent(ev, "#survey-cancel-edit")) {
        clearSurveyEditMode();
        return;
      }
      const ed = closestFromEvent(ev, ".portal-history-edit");
      if (ed && $("#survey-history-list") && $("#survey-history-list").contains(ed)) {
        const id = ed.getAttribute("data-survey-entry-id");
        const e = (state.surveyEntries || []).find((x) => x.id === id);
        if (e) beginSurveyEditEntry(e);
      }
    });
  }

  const viewCustomPortal = $("#view-custom-portal");
  if (viewCustomPortal) {
    viewCustomPortal.addEventListener("click", (ev) => {
      if (closestFromEvent(ev, "#custom-portal-cancel-edit")) {
        const pid = $("#custom-portal-form") && $("#custom-portal-form").dataset.portalId;
        const p = pid && findCustomPortalById(pid);
        if (p) clearCustomPortalEditMode(p);
        return;
      }
      const ed = closestFromEvent(ev, ".portal-history-edit");
      if (ed && $("#custom-portal-history-list") && $("#custom-portal-history-list").contains(ed)) {
        const id = ed.getAttribute("data-custom-entry-id");
        const pid = $("#custom-portal-form") && $("#custom-portal-form").dataset.portalId;
        const p = pid && findCustomPortalById(pid);
        const entry =
          id && p && (state.customPortalEntries[p.id] || []).find((x) => x.id === id);
        if (p && entry) populateCustomPortalFromEntry(p, entry);
      }
    });
  }

  const fieldPhotoInput = $("#field-photo");
  if (fieldPhotoInput) {
    fieldPhotoInput.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      const img = $("#field-photo-preview");
      if (!img) return;
      stopCamera();
      clearFieldCameraCapture();
      revokeFieldPhotoUrl();
      if (!file) {
        img.hidden = true;
        img.removeAttribute("src");
        return;
      }
      fieldPhotoObjectUrl = URL.createObjectURL(file);
      img.src = fieldPhotoObjectUrl;
      img.hidden = false;
    });
  }

  const fieldCameraOpenBtn = $("#field-camera-open");
  if (fieldCameraOpenBtn) {
    fieldCameraOpenBtn.addEventListener("click", async () => {
    const panel = $("#field-camera-panel");
    const errEl = $("#field-camera-error");
    if (!panel || !errEl) return;
    errEl.hidden = true;
    errEl.textContent = "";
    stopCamera();
    clearFieldCameraCapture();
    revokeFieldPhotoUrl();
    if (fieldPhotoInput) fieldPhotoInput.value = "";
    const fpp = $("#field-photo-preview");
    if (fpp) {
      fpp.hidden = true;
      fpp.removeAttribute("src");
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errEl.textContent =
        "Camera is not available in this browser. Use “Choose from gallery” or open this page over HTTPS or localhost.";
      panel.hidden = false;
      errEl.hidden = false;
      return;
    }

    try {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      const video = $("#field-camera-video");
      if (video) {
        video.srcObject = cameraStream;
        panel.hidden = false;
        await video.play().catch(() => {});
      }
    } catch (e) {
      releaseCamera();
      errEl.textContent =
        "Could not open the camera. Allow permission when prompted, or use gallery upload.";
      errEl.hidden = false;
      panel.hidden = false;
    }
    });
  }

  const fieldCameraCaptureBtn = $("#field-camera-capture");
  if (fieldCameraCaptureBtn) {
    fieldCameraCaptureBtn.addEventListener("click", () => {
    const video = $("#field-camera-video");
    if (!cameraStream || !video || !video.videoWidth) {
      alert("Wait for the camera preview to appear, then capture.");
      return;
    }
    const canvas = $("#field-camera-canvas");
    if (!canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    fieldCameraDataUrl = canvas.toDataURL("image/jpeg", 0.88);
    releaseCamera();
    closeCameraPanel();
    showPhotoPreviewFromSrc(fieldCameraDataUrl);
    });
  }

  const fieldCameraCancelBtn = $("#field-camera-cancel");
  if (fieldCameraCancelBtn) {
    fieldCameraCancelBtn.addEventListener("click", () => {
      stopCamera();
    });
  }

  const fieldFormEl = $("#field-form");
  if (fieldFormEl) fieldFormEl.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (sessionRole !== "field") return;
    const name = $("#field-name").value.trim();
    const phone = $("#field-phone").value.trim();
    const workDone = $('input[name="work_done"]:checked')?.value || "";
    const file = fieldPhotoInput && fieldPhotoInput.files && fieldPhotoInput.files[0];

    if (!name || !phone || !workDone) {
      alert("Please fill name, phone, and work done.");
      return;
    }
    if (!fieldCameraDataUrl && !file) {
      alert("Please take a photo with the camera or choose one from the gallery.");
      return;
    }

    let photoDataUrl;
    if (fieldCameraDataUrl) {
      photoDataUrl = fieldCameraDataUrl;
    } else {
      try {
        photoDataUrl = await readPhotoAsDataUrl(file);
      } catch {
        alert("Could not read the photo. Try a smaller image.");
        return;
      }
    }

    const timestamp = formatNow();
    const submittedAt = new Date().toISOString();
    if (!Array.isArray(state.fieldEntries)) state.fieldEntries = [];
    const latest = getLatestFieldEntry();
    const editingLatest =
      fieldEditEntryId && latest && fieldEditEntryId === latest.id;
    const by = entrySubmittedBy();
    if (editingLatest) {
      Object.assign(latest, {
        name,
        phone,
        workDone,
        photoDataUrl,
        timestamp,
        submittedAt,
        submittedBy: by,
      });
    } else {
      state.fieldEntries.push({
        id: entryId(),
        name,
        phone,
        workDone,
        photoDataUrl,
        timestamp,
        submittedAt,
        submittedBy: by,
      });
    }
    saveState(state);

    alert(editingLatest ? "Changes saved." : "Entry saved with timestamp:\n" + timestamp);
    clearFieldEditMode();
    renderDashboard();
  });

  const surveyFormEl = $("#survey-form");
  if (surveyFormEl) surveyFormEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const employees = $("#survey-employees").value;
    const age = $("#survey-age").value;
    const sex = $("#survey-sex").value;
    if (!employees || !age || !sex) {
      alert("Please complete all fields.");
      return;
    }
    const timestamp = formatNow();
    const submittedAt = new Date().toISOString();
    const latest = getLatestSurveyEntry();
    const editingLatest = surveyEditEntryId && latest && surveyEditEntryId === latest.id;
    const by = entrySubmittedBy();
    if (editingLatest) {
      Object.assign(latest, {
        employees: Number(employees),
        age: Number(age),
        sex,
        timestamp,
        submittedAt,
        submittedBy: by,
      });
    } else {
      state.surveyEntries.push({
        id: entryId(),
        employees: Number(employees),
        age: Number(age),
        sex,
        timestamp,
        submittedAt,
        submittedBy: by,
      });
    }
    saveState(state);
    alert(editingLatest ? "Changes saved." : "Survey saved with timestamp:\n" + timestamp);
    clearSurveyEditMode();
    renderDashboard();
  });

  if (appRoot) appRoot.addEventListener("submit", async (ev) => {
    const form = ev.target;
    if (!form || form.id !== "custom-portal-form") return;
    ev.preventDefault();
    const portalId = form.dataset.portalId;
    const portal = findCustomPortalById(portalId);
    if (!portal) return;
    const answers = {};
    for (const f of portal.fields) {
      if (f.type === "image") {
        let dataUrl = customPortalImageDataUrlByField[f.id];
        if (!dataUrl) {
          const wrap = findCustomPortalImageWrap(form, f.id);
          const fileIn = wrap && wrap.querySelector(".custom-portal-image-file");
          const file = fileIn && fileIn.files && fileIn.files[0];
          if (file) {
            try {
              dataUrl = await readPhotoAsDataUrl(file);
            } catch {
              alert(`Could not read the image for “${f.label}”. Try a smaller file.`);
              return;
            }
          }
        }
        if (f.required && !dataUrl) {
          alert(`Please take or upload a photo for “${f.label}”.`);
          return;
        }
        answers[f.id] = dataUrl || "";
        continue;
      }
      if (f.type === "buttons") {
        const picked = form.querySelector(
          `input[type="radio"].custom-portal-input[data-field-id="${f.id}"]:checked`
        );
        const val = picked ? picked.value : "";
        if (f.required && !val) {
          alert(`Please choose an option for “${f.label}”.`);
          return;
        }
        answers[f.id] = val;
        continue;
      }
      const inp = Array.from(form.querySelectorAll(".custom-portal-input[data-field-id]")).find(
        (el) =>
          el.getAttribute("data-field-id") === f.id && el.matches("input:not([type=radio]), textarea, select")
      );
      if (!inp) continue;
      let val;
      if (f.type === "select") {
        val = inp.value || "";
        if (f.required && !val) {
          alert(`Please select an option for “${f.label}”.`);
          return;
        }
      } else if (f.type === "number") {
        if (inp.value === "") {
          val = "";
          if (f.required) {
            alert(`Please enter a number for “${f.label}”.`);
            return;
          }
        } else {
          const n = Number(inp.value);
          if (Number.isNaN(n)) {
            alert(`Please enter a valid number for “${f.label}”.`);
            return;
          }
          val = n;
        }
      } else if (f.type === "textarea") {
        const raw = inp.value;
        if (f.required && !raw.trim()) {
          alert(`Please fill in “${f.label}”.`);
          return;
        }
        val = raw;
      } else {
        val = inp.value.trim();
        if (f.required && !val) {
          alert(`Please fill in “${f.label}”.`);
          return;
        }
      }
      answers[f.id] = val;
    }
    const timestamp = formatNow();
    const submittedAt = new Date().toISOString();
    if (!state.customPortalEntries) state.customPortalEntries = {};
    if (!state.customPortalEntries[portalId]) state.customPortalEntries[portalId] = [];
    const list = state.customPortalEntries[portalId];
    const latest = getLatestCustomEntry(portalId);
    const editingLatest =
      customPortalEditEntryId &&
      customPortalEditPortalId === portalId &&
      latest &&
      customPortalEditEntryId === latest.id;
    const by = entrySubmittedBy();
    if (editingLatest) {
      Object.assign(latest, { answers, timestamp, submittedAt, submittedBy: by });
    } else {
      list.push({
        id: entryId(),
        portalId,
        answers,
        timestamp,
        submittedAt,
        submittedBy: by,
      });
    }
    customPortalEditEntryId = null;
    customPortalEditPortalId = null;
    saveState(state);
    alert(editingLatest ? "Changes saved." : "Response saved with timestamp:\n" + timestamp);
    stopCustomPortalCamera();
    resetCustomPortalImageState();
    form.reset();
    form.querySelectorAll(".custom-portal-image-preview").forEach((im) => {
      im.hidden = true;
      im.removeAttribute("src");
    });
    const cce = $("#custom-portal-cancel-edit");
    if (cce) cce.hidden = true;
    const csb = $("#custom-portal-submit-btn");
    if (csb) csb.textContent = "Submit";
    mountCustomPortalForm(portal);
    renderCustomPortalHistory(portal);
    setCustomPortalSubView("form");
    renderDashboard();
  });

  const adminCredForm = $("#admin-credentials-form");
  if (adminCredForm) adminCredForm.addEventListener("click", (ev) => {
    const addBtn = closestFromEvent(ev, ".admin-add-cred");
    if (addBtn && adminCredForm.contains(addBtn)) {
      const role = addBtn.getAttribute("data-add-cred");
      if (!role || !ROLE_KEYS.includes(role)) return;
      const container = document.getElementById(`admin-accounts-${role}`);
      if (!container) return;
      container.appendChild(buildCredRow(role, "", ""));
      refreshRemoveButtonsVisibility(container);
      return;
    }
    const rmBtn = closestFromEvent(ev, ".admin-cred-remove");
    if (rmBtn && adminCredForm.contains(rmBtn)) {
      const row = rmBtn.closest(".admin-cred-row");
      const container = row && row.parentElement;
      if (!row || !container || !container.classList.contains("admin-accounts")) return;
      row.remove();
      if (!container.querySelector(".admin-cred-row")) {
        const role = container.getAttribute("data-role") || ROLE_KEYS[0];
        container.appendChild(buildCredRow(role, "", ""));
      }
      refreshRemoveButtonsVisibility(container);
    }
  });

  const adminSaveCredTab = $("#admin-save-cred-tab");
  if (adminSaveCredTab) {
    adminSaveCredTab.addEventListener("click", () => {
      const role = adminCredActiveRole;
      const list = collectRoleCredentialsFromForm(role);
      const errMsg = validateCredentialsForRole(role, list);
      if (errMsg) {
        const err = $("#admin-msg");
        if (err) {
          err.className = "error-banner";
          err.textContent = errMsg;
          err.hidden = false;
        }
        return;
      }
      state.credentials[role] = list.map((c) => ({
        username: c.username,
        password: c.password,
      }));
      saveState(state);
      renderAdminCredentials();
      setAdminCredTab(role);
      const msg = $("#admin-msg");
      if (msg) {
        msg.className = "success-banner";
        msg.textContent = `Saved logins for “${ROLE_LABELS[role] || role}”.`;
        msg.hidden = false;
      }
    });
  }

  const adminCustomNew = $("#admin-custom-new");
  if (adminCustomNew) {
    adminCustomNew.addEventListener("click", () => openAdminCustomEditor(null));
  }
  const adminCustomCancel = $("#admin-custom-cancel");
  if (adminCustomCancel) {
    adminCustomCancel.addEventListener("click", () => closeAdminCustomEditor());
  }
  const adminCustomAddQ = $("#admin-custom-add-question");
  if (adminCustomAddQ) {
    adminCustomAddQ.addEventListener("click", () => adminAppendQuestionRow(null));
  }
  const adminCustomAddCred = $("#admin-custom-add-cred");
  if (adminCustomAddCred) {
    adminCustomAddCred.addEventListener("click", () => {
      const credC = $("#admin-custom-creds");
      if (!credC) return;
      credC.appendChild(buildCredRow("custom", "", ""));
      refreshRemoveButtonsVisibility(credC);
    });
  }
  const adminCustomSave = $("#admin-custom-save");
  if (adminCustomSave) {
    adminCustomSave.addEventListener("click", () => {
      const title = ($("#admin-custom-title") && $("#admin-custom-title").value.trim()) || "";
      if (!title) {
        setAdminCustomMsg("Enter a portal title.", "error");
        return;
      }
      let fields;
      try {
        fields = readQuestionsFromEditor();
      } catch (err) {
        setAdminCustomMsg(err.message || "Check your questions.", "error");
        return;
      }
      if (fields.length < 1) {
        setAdminCustomMsg("Add at least one question with a label.", "error");
        return;
      }
      const creds = collectCustomEditorCreds();
      const credErr = validateCustomPortalCredentials(creds);
      if (credErr) {
        setAdminCustomMsg(credErr, "error");
        return;
      }
      const editId = ($("#admin-custom-edit-id") && $("#admin-custom-edit-id").value.trim()) || "";
      const remEn = $("#admin-custom-reminder-enabled");
      const remDaysIn = $("#admin-custom-reminder-days");
      let followUpReminderDays = parseInt(remDaysIn && remDaysIn.value, 10);
      if (!Number.isFinite(followUpReminderDays) || followUpReminderDays < 1) followUpReminderDays = 7;
      if (followUpReminderDays > 366) followUpReminderDays = 366;
      const newPortal = {
        id: editId || portalNewId(),
        title,
        fields,
        credentials: creds.map((c) => ({ username: c.username, password: c.password })),
        followUpReminderEnabled: !!(remEn && remEn.checked),
        followUpReminderDays,
      };
      const list = getCustomPortalsList().slice();
      const idx = list.findIndex((p) => p.id === newPortal.id);
      if (idx >= 0) list[idx] = newPortal;
      else list.push(newPortal);
      state.customPortals = list;
      if (!state.customPortalEntries) state.customPortalEntries = {};
      if (!state.customPortalEntries[newPortal.id]) state.customPortalEntries[newPortal.id] = [];
      saveState(state);
      renderAdminCustomPortalsList();
      const saved = findCustomPortalById(newPortal.id);
      if (saved) openAdminCustomEditor(saved);
      setAdminCustomMsg("Portal saved.", "ok");
      renderDashboard();
    });
  }
  const adminCustomDelete = $("#admin-custom-delete");
  if (adminCustomDelete) {
    adminCustomDelete.addEventListener("click", () => {
      const id = ($("#admin-custom-edit-id") && $("#admin-custom-edit-id").value.trim()) || "";
      if (!id) return;
      if (
        !confirm(
          "Delete this portal and all of its saved responses? This cannot be undone."
        )
      ) {
        return;
      }
      state.customPortals = getCustomPortalsList().filter((x) => x.id !== id);
      if (state.customPortalEntries && state.customPortalEntries[id]) {
        delete state.customPortalEntries[id];
      }
      saveState(state);
      renderAdminCustomPortalsList();
      const rest = getCustomPortalsList();
      if (rest.length > 0) {
        setAdminCustomTab(rest[0].id);
      } else {
        closeAdminCustomEditor();
      }
      setAdminCustomMsg("Portal deleted.", "ok");
      renderDashboard();
    });
  }
  const viewAdmin = $("#view-admin");
  if (viewAdmin) {
    viewAdmin.addEventListener("click", (ev) => {
      const credRm = closestFromEvent(ev, ".admin-cred-remove");
      const credBox = $("#admin-custom-creds");
      if (credRm && credBox && credBox.contains(credRm)) {
        const row = credRm.closest(".admin-cred-row");
        const container = row && row.parentElement;
        if (row && container) {
          row.remove();
          if (!container.querySelector(".admin-cred-row")) {
            container.appendChild(buildCredRow("custom", "", ""));
          }
          refreshRemoveButtonsVisibility(container);
        }
        return;
      }
      const qRm = closestFromEvent(ev, ".admin-custom-q-remove");
      if (qRm) {
        const row = qRm.closest(".admin-custom-q-row");
        const qroot = $("#admin-custom-questions");
        if (row && qroot && qroot.contains(row)) {
          row.remove();
          if (!qroot.querySelector(".admin-custom-q-row")) {
            adminAppendQuestionRow(null);
          }
        }
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (sessionRole && document.visibilityState === "visible") {
      if (typeof sessionRole === "string" && sessionRole.startsWith("cp_")) {
        syncCustomPortalRemindersButton();
        const remP = $("#custom-portal-panel-reminders");
        if (remP && !remP.hidden) renderCustomPortalRemindersPanel();
      }
    }
  });

  const dashApply = $("#dash-date-apply");
  const dashClear = $("#dash-date-clear");
  if (dashApply) {
    dashApply.addEventListener("click", () => {
      const fromEl = $("#dash-date-from");
      const toEl = $("#dash-date-to");
      const fromRaw = (fromEl && fromEl.value.trim()) || "";
      const toRaw = (toEl && toEl.value.trim()) || "";
      let fromYmd = "";
      let toYmd = "";
      if (fromRaw) {
        const p = parseDdMmYyyyToYmd(fromRaw);
        if (!p) {
          alert('Invalid “From” date. Use dd/mm/yyyy (e.g. 21/03/2026 for 21 March 2026).');
          return;
        }
        fromYmd = p.ymd;
      }
      if (toRaw) {
        const p = parseDdMmYyyyToYmd(toRaw);
        if (!p) {
          alert('Invalid “To” date. Use dd/mm/yyyy (e.g. 31/03/2026 for 31 March 2026).');
          return;
        }
        toYmd = p.ymd;
      }
      if (fromYmd && toYmd && fromYmd > toYmd) {
        alert("“From” date must be on or before “To” date (dd/mm/yyyy).");
        return;
      }
      dashboardAppliedDateFrom = fromYmd;
      dashboardAppliedDateTo = toYmd;
      if (fromEl && fromYmd) fromEl.value = formatYmdToDdMmYyyy(fromYmd);
      if (toEl && toYmd) toEl.value = formatYmdToDdMmYyyy(toYmd);
      const pf = $("#dash-date-from-picker");
      const pt = $("#dash-date-to-picker");
      if (pf) pf.value = fromYmd || "";
      if (pt) pt.value = toYmd || "";
      renderDashboard();
    });
  }
  if (dashClear) {
    dashClear.addEventListener("click", () => {
      const fromEl = $("#dash-date-from");
      const toEl = $("#dash-date-to");
      const pf = $("#dash-date-from-picker");
      const pt = $("#dash-date-to-picker");
      if (fromEl) fromEl.value = "";
      if (toEl) toEl.value = "";
      if (pf) pf.value = "";
      if (pt) pt.value = "";
      dashboardAppliedDateFrom = "";
      dashboardAppliedDateTo = "";
      renderDashboard();
    });
  }

  (function wireDashboardDatePickers() {
    const pairs = [
      { picker: "dash-date-from-picker", text: "dash-date-from" },
      { picker: "dash-date-to-picker", text: "dash-date-to" },
    ];
    pairs.forEach(({ picker, text }) => {
      const pe = document.getElementById(picker);
      const te = document.getElementById(text);
      if (!pe || !te) return;
      function syncPickerFromText() {
        const raw = te.value.trim();
        if (!raw) {
          pe.value = "";
          return;
        }
        const p = parseDdMmYyyyToYmd(raw);
        pe.value = p && p.ymd ? p.ymd : "";
      }
      pe.addEventListener("pointerdown", syncPickerFromText);
      pe.addEventListener("focus", syncPickerFromText);
      pe.addEventListener("change", () => {
        if (!pe.value) return;
        te.value = formatYmdToDdMmYyyy(pe.value);
      });
    });
  })();

  (async function boot() {
    await pullServerOnBoot();
    runAllDataMigrations();
    if (apiSyncEnabled && !lastServerPullHadDocument) {
      await flushServerPushNow();
    }
    serverSyncReady = true;
    scheduleServerPush();
    if (!tryRestoreSessionAuth()) {
      showView("login");
    }
    initExternalStateSync();
    updateSwitchPortalButtons();
  })();
})();
