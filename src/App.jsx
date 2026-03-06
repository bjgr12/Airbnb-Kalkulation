import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

async function geocodeAddress(address, zip, city) {
  const q = `${address}, ${zip} ${city}, Deutschland`;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`, {
      headers: { "Accept-Language": "de" },
    });
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 1) { map.setView(coords[0], 14); }
    else if (coords.length > 1) { map.fitBounds(coords, { padding: [40, 40] }); }
  }, [coords, map]);
  return null;
}

const eur = (n) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n ?? 0);
const pct = (n) => `${(n ?? 0).toFixed(1)} %`;
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const isOverdue = (d, status) => d && status !== "erledigt" && new Date(d + "T12:00:00") < new Date();

// ─── Default Project Phases ───────────────────────────────────────────────────
const DEFAULT_PHASES = () => [
  {
    id: uid(), phase: 1, title: "Due Diligence", icon: "🔍",
    description: "Prüfung vor der Entscheidung — rechtlich, wirtschaftlich, technisch",
    color: "#60a5fa",
    milestones: [
      { id: uid(), title: "Besichtigung durchgeführt", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Zustand der Wohnung dokumentiert (Fotos)", done: false },
        { id: uid(), text: "Mängel notiert und bewertet", done: false },
        { id: uid(), text: "Deckenhöhe, Grundriss, Lage geprüft", done: false },
        { id: uid(), text: "Internetzugang und Mobilfunkempfang geprüft", done: false },
      ]},
      { id: uid(), title: "Rechtliche Prüfung abgeschlossen", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Zweckentfremdungsverbot in dieser Stadt geprüft", done: false },
        { id: uid(), text: "Mietvertrag auf Untervermietungsklausel analysiert", done: false },
        { id: uid(), text: "Hausordnung und WEG-Beschlüsse eingeholt", done: false },
        { id: uid(), text: "Registrierungspflicht für Airbnb recherchiert", done: false },
      ]},
      { id: uid(), title: "Wirtschaftlichkeit bestätigt", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Break-even-Analyse erstellt", done: false },
        { id: uid(), text: "Mitbewerber auf Airbnb in der Gegend analysiert", done: false },
        { id: uid(), text: "Saisonalität und Auslastungsdaten recherchiert", done: false },
        { id: uid(), text: "Startkapital gesichert", done: false },
      ]},
    ],
  },
  {
    id: uid(), phase: 2, title: "Vertragsabschluss", icon: "📝",
    description: "Mietvertrag, Genehmigungen und behördliche Anmeldungen",
    color: "#a78bfa",
    milestones: [
      { id: uid(), title: "Vermieter-Genehmigung eingeholt", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Gespräch mit Vermieter geführt", done: false },
        { id: uid(), text: "Schriftliche Erlaubnis zur Untervermietung erhalten", done: false },
        { id: uid(), text: "Nutzungsänderung im Vertrag verankert", done: false },
      ]},
      { id: uid(), title: "Mietvertrag unterzeichnet", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Vertragslaufzeit und Kündigungsfristen geprüft", done: false },
        { id: uid(), text: "Kaution überwiesen und quittiert", done: false },
        { id: uid(), text: "Übergabeprotokoll mit Fotos erstellt", done: false },
        { id: uid(), text: "Schlüssel erhalten", done: false },
      ]},
      { id: uid(), title: "Gewerbliche Anmeldung", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Gewerbe angemeldet (falls erforderlich)", done: false },
        { id: uid(), text: "Steuerberater konsultiert (USt., ESt.)", done: false },
        { id: uid(), text: "Haftpflichtversicherung für Kurzzeitvermietung abgeschlossen", done: false },
        { id: uid(), text: "Airbnb Host-Konto vollständig eingerichtet", done: false },
      ]},
    ],
  },
  {
    id: uid(), phase: 3, title: "Setup & Einrichtung", icon: "🛋️",
    description: "Wohnung ausstatten, renovieren und buchungsbereit machen",
    color: "#fb923c",
    milestones: [
      { id: uid(), title: "Renovierung abgeschlossen", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Wände gestrichen / aufgefrischt", done: false },
        { id: uid(), text: "Böden gesäubert / ggf. erneuert", done: false },
        { id: uid(), text: "Beleuchtung optimiert (warm, gemütlich)", done: false },
        { id: uid(), text: "Schäden aus Übergabeprotokoll behoben", done: false },
      ]},
      { id: uid(), title: "Möblierung & Ausstattung vollständig", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Bett & Matratze (gute Qualität)", done: false },
        { id: uid(), text: "Bettwäsche (mind. 2 Sets)", done: false },
        { id: uid(), text: "Handtücher (mind. 2 Sets pro Gast)", done: false },
        { id: uid(), text: "Schreibtisch / Arbeitsmöglichkeit", done: false },
        { id: uid(), text: "Küche ausgestattet (Besteck, Teller, Töpfe)", done: false },
        { id: uid(), text: "Kaffeemaschine / Wasserkocher / Toaster", done: false },
        { id: uid(), text: "Smart-TV / Streaming eingerichtet", done: false },
        { id: uid(), text: "WLAN-Router installiert und getestet (>50 Mbit/s)", done: false },
      ]},
      { id: uid(), title: "Sicherheit & Zugang", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Rauchmelder installiert und getestet", done: false },
        { id: uid(), text: "CO₂-Melder installiert", done: false },
        { id: uid(), text: "Smart-Lock / Schlüsselbox montiert", done: false },
        { id: uid(), text: "Notfallnummern für Gäste vorbereitet", done: false },
        { id: uid(), text: "Haushandbuch (Gästeordner) erstellt", done: false },
        { id: uid(), text: "Erste-Hilfe-Kasten vorhanden", done: false },
      ]},
    ],
  },
  {
    id: uid(), phase: 4, title: "Launch", icon: "🚀",
    description: "Listing veröffentlichen, erste Buchungen gewinnen",
    color: "#4ade80",
    milestones: [
      { id: uid(), title: "Professionelles Listing erstellt", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Professionelle Fotos gemacht (mind. 15 Bilder)", done: false },
        { id: uid(), text: "Titel mit relevanten Keywords optimiert", done: false },
        { id: uid(), text: "Beschreibung vollständig und ansprechend", done: false },
        { id: uid(), text: "Alle Ausstattungsmerkmale eingetragen", done: false },
        { id: uid(), text: "Hausregeln klar definiert", done: false },
        { id: uid(), text: "Eröffnungsrabatt aktiviert (für erste Bewertungen)", done: false },
      ]},
      { id: uid(), title: "Erste Buchung & Bewertung", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Listing auf Airbnb / Booking.com live", done: false },
        { id: uid(), text: "Erste Anfrage innerhalb 1h beantwortet", done: false },
        { id: uid(), text: "Erste Buchung bestätigt", done: false },
        { id: uid(), text: "Check-in reibungslos verlaufen", done: false },
        { id: uid(), text: "Erste 5-Sterne-Bewertung erhalten", done: false },
      ]},
    ],
  },
  {
    id: uid(), phase: 5, title: "Betrieb & Optimierung", icon: "📈",
    description: "Laufender Betrieb, Performance steigern, skalieren",
    color: "#f59e0b",
    milestones: [
      { id: uid(), title: "Break-even erreicht", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Monatliche Buchhaltung eingerichtet", done: false },
        { id: uid(), text: "Auslastungsziel konsistent erreicht", done: false },
        { id: uid(), text: "Startkapital amortisiert", done: false },
      ]},
      { id: uid(), title: "Prozesse automatisiert", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Automatische Nachrichten eingerichtet (Check-in, Danke)", done: false },
        { id: uid(), text: "Zuverlässige Reinigungskraft organisiert", done: false },
        { id: uid(), text: "Dynamic Pricing Tool aktiviert (z. B. Pricelabs)", done: false },
        { id: uid(), text: "Superhost-Status erreicht", done: false },
      ]},
      { id: uid(), title: "Skalierung evaluiert", status: "offen", dueDate: "", notes: "", checklist: [
        { id: uid(), text: "Learnings aus Betrieb dokumentiert", done: false },
        { id: uid(), text: "Nächstes Objekt identifiziert", done: false },
        { id: uid(), text: "Portfolio-Strategie definiert", done: false },
      ]},
    ],
  },
];

// ─── Default Property ─────────────────────────────────────────────────────────
const newProperty = () => ({
  id: uid(),
  meta: { name: "", address: "", city: "", zip: "", type: "studio", sqm: 25, rooms: 1, floor: 0, builtYear: 2000, condition: "gut", notes: "", lat: null, lng: null },
  costs: { coldRent: 0, nk: 0, deposit: 0, leaseDuration: 12 },
  setup: { furnitureCost: 3000, renovationCost: 0, otherSetup: 0, amortMonths: 24 },
  operations: { internet: 30, supplies: 40, insurance: 45, management: 0, misc: 0 },
  airbnb: { nightlyRate: 70, platformFee: 3, cleaningFee: 40, avgStay: 2.5, pessimisticNights: 10, realisticNights: 18, optimisticNights: 24 },
  longterm: { expectedRent: 0, vacancyMonths: 1 },
  project: { phases: DEFAULT_PHASES(), projectStart: todayStr(), targetLaunch: "" },
  umnutzung: { city: "", steps: {} },
});

// ─── Calculations ─────────────────────────────────────────────────────────────
function calcScenario(p, nights) {
  const turnovers = Math.ceil(nights / p.airbnb.avgStay);
  const revenue = nights * p.airbnb.nightlyRate;
  const airbnbCut = revenue * (p.airbnb.platformFee / 100);
  const cleaningCosts = turnovers * p.airbnb.cleaningFee;
  const managementCost = revenue * (p.operations.management / 100);
  const setupMonthly = (p.setup.furnitureCost + p.setup.renovationCost + p.setup.otherSetup) / (p.setup.amortMonths || 1);
  const fixedCosts = p.costs.coldRent + p.costs.nk + p.operations.internet + p.operations.supplies + p.operations.insurance + p.operations.misc + setupMonthly;
  const varCosts = airbnbCut + cleaningCosts + managementCost;
  const totalCosts = fixedCosts + varCosts;
  const profit = revenue - totalCosts;
  const occupancy = (nights / 30) * 100;
  const roi = fixedCosts > 0 ? (profit / fixedCosts) * 100 : 0;
  const startupCost = p.costs.deposit + p.setup.furnitureCost + p.setup.renovationCost + p.setup.otherSetup;
  const paybackMonths = profit > 0 ? Math.ceil(startupCost / profit) : null;
  const beNights = Math.ceil(fixedCosts / Math.max(0.01, p.airbnb.nightlyRate * (1 - p.airbnb.platformFee / 100) - p.airbnb.cleaningFee / p.airbnb.avgStay));
  return { revenue, airbnbCut, cleaningCosts, managementCost, fixedCosts, varCosts, totalCosts, profit, occupancy, roi, startupCost, paybackMonths, beNights, nights, turnovers, setupMonthly };
}
function calcLongterm(p) {
  const annualRent = p.longterm.expectedRent * (12 - p.longterm.vacancyMonths);
  const monthlyRent = annualRent / 12;
  const fixedCosts = p.costs.coldRent + p.costs.nk;
  const profit = monthlyRent - fixedCosts;
  return { monthlyRent, fixedCosts, profit };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
const inputStyle = { width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Mono', monospace", outline: "none" };

function Field({ label, children, half }) {
  return (
    <div style={{ marginBottom: 14, width: half ? "calc(50% - 6px)" : "100%", boxSizing: "border-box" }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: 1.5, marginBottom: 5, textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}
function Input({ label, value, onChange, type = "number", half, min, step = 1, prefix }) {
  return (
    <Field label={label} half={half}>
      <div style={{ position: "relative" }}>
        {prefix && <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: 14 }}>{prefix}</span>}
        <input type={type} value={value} min={min} step={step}
          onChange={e => onChange(type === "number" ? (isNaN(+e.target.value) ? 0 : +e.target.value) : e.target.value)}
          style={{ ...inputStyle, paddingLeft: prefix ? 24 : 12 }} />
      </div>
    </Field>
  );
}
function Select({ label, value, onChange, options, half }) {
  return (
    <Field label={label} half={half}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}
function SectionTitle({ icon, title, sub }) {
  return (
    <div style={{ marginBottom: 22, paddingBottom: 14, borderBottom: "1px solid #1e293b" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}
function Row({ label, value, bold, minus, green, indent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ fontSize: 12, color: bold ? "#e2e8f0" : "#64748b", fontWeight: bold ? 700 : 400, paddingLeft: indent ? 14 : 0, fontFamily: "'DM Mono', monospace" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: green ? "#4ade80" : minus ? "#f87171" : "#e2e8f0", fontFamily: "'DM Mono', monospace" }}>
        {minus ? "−" : green ? "+" : ""} {eur(Math.abs(value ?? 0))}
      </span>
    </div>
  );
}
function KPI({ label, value, sub, color = "#f1f5f9", size = 22 }) {
  return (
    <div style={{ background: "#0f172a", borderRadius: 12, padding: "14px 16px", border: "1px solid #1e293b" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 800, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── Milestone Components ─────────────────────────────────────────────────────
const STATUS_CONFIG = {
  offen:    { label: "Offen",          color: "#475569", bg: "#1e293b",   dot: "○" },
  aktiv:    { label: "In Bearbeitung", color: "#fbbf24", bg: "#451a03",   dot: "◑" },
  erledigt: { label: "Erledigt",       color: "#4ade80", bg: "#052e16",   dot: "●" },
};
const STATUS_CYCLE = { offen: "aktiv", aktiv: "erledigt", erledigt: "offen" };

function MilestoneCard({ milestone, phaseColor, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const sc = STATUS_CONFIG[milestone.status];
  const doneChecks = milestone.checklist.filter(c => c.done).length;
  const totalChecks = milestone.checklist.length;
  const overdue = isOverdue(milestone.dueDate, milestone.status);

  return (
    <div style={{ background: "#0f172a", borderRadius: 12, marginBottom: 10, border: `1px solid ${milestone.status === "erledigt" ? phaseColor + "44" : "#1e293b"}`, overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <button onClick={e => { e.stopPropagation(); onUpdate({ ...milestone, status: STATUS_CYCLE[milestone.status] }); }}
          style={{ background: sc.bg, border: `1px solid ${sc.color}`, borderRadius: 6, padding: "3px 8px", color: sc.color, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", flexShrink: 0 }}>
          {sc.dot} {sc.label}
        </button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: milestone.status === "erledigt" ? "#4b5563" : "#e2e8f0", textDecoration: milestone.status === "erledigt" ? "line-through" : "none" }}>
          {milestone.title}
        </span>
        {totalChecks > 0 && <span style={{ fontSize: 11, color: doneChecks === totalChecks ? "#4ade80" : "#64748b", flexShrink: 0 }}>{doneChecks}/{totalChecks}</span>}
        {milestone.dueDate && <span style={{ fontSize: 11, color: overdue ? "#f87171" : "#475569", flexShrink: 0 }}>{overdue ? "⚠️ " : "📅 "}{fmtDate(milestone.dueDate)}</span>}
        <span style={{ color: "#334155", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Progress bar */}
      {totalChecks > 0 && (
        <div style={{ height: 2, background: "#1e293b" }}>
          <div style={{ height: "100%", width: `${(doneChecks / totalChecks) * 100}%`, background: phaseColor, transition: "width 0.3s" }} />
        </div>
      )}

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: 14, borderTop: "1px solid #1e293b" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, display: "block", marginBottom: 4 }}>FÄLLIGKEITSDATUM</label>
              <input type="date" value={milestone.dueDate}
                onChange={e => onUpdate({ ...milestone, dueDate: e.target.value })}
                style={{ ...inputStyle, fontSize: 12, padding: "7px 10px" }} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, display: "block", marginBottom: 4 }}>NOTIZEN</label>
              <input type="text" value={milestone.notes} placeholder="Kommentar hinzufügen…"
                onChange={e => onUpdate({ ...milestone, notes: e.target.value })}
                style={{ ...inputStyle, fontSize: 12, padding: "7px 10px" }} />
            </div>
          </div>

          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 8, textTransform: "uppercase" }}>Checkliste</div>
          {milestone.checklist.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <div onClick={() => onUpdate({ ...milestone, checklist: milestone.checklist.map(x => x.id === c.id ? { ...x, done: !x.done } : x) })}
                style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${c.done ? phaseColor : "#334155"}`, background: c.done ? phaseColor + "33" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {c.done && <span style={{ color: phaseColor, fontSize: 12, lineHeight: 1 }}>✓</span>}
              </div>
              <input type="text" value={c.text}
                onChange={e => onUpdate({ ...milestone, checklist: milestone.checklist.map(x => x.id === c.id ? { ...x, text: e.target.value } : x) })}
                style={{ flex: 1, background: "transparent", border: "none", color: c.done ? "#4b5563" : "#cbd5e1", fontSize: 12, fontFamily: "'DM Mono', monospace", outline: "none", textDecoration: c.done ? "line-through" : "none" }} />
              <span onClick={() => onUpdate({ ...milestone, checklist: milestone.checklist.filter(x => x.id !== c.id) })}
                style={{ color: "#334155", cursor: "pointer", fontSize: 14 }}>✕</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => onUpdate({ ...milestone, checklist: [...milestone.checklist, { id: uid(), text: "Neuer Punkt", done: false }] })}
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "5px 12px", color: "#94a3b8", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
              + Punkt hinzufügen
            </button>
            <button onClick={onDelete}
              style={{ background: "transparent", border: "1px solid #ef444433", borderRadius: 6, padding: "5px 12px", color: "#ef4444", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", marginLeft: "auto" }}>
              Löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseCard({ phase, onUpdatePhase }) {
  const [open, setOpen] = useState(true);
  const done = phase.milestones.filter(m => m.status === "erledigt").length;
  const active = phase.milestones.filter(m => m.status === "aktiv").length;
  const total = phase.milestones.length;
  const progress = total > 0 ? (done / total) * 100 : 0;

  const updateM = (mid, upd) => onUpdatePhase({ ...phase, milestones: phase.milestones.map(m => m.id === mid ? upd : m) });
  const deleteM = (mid) => onUpdatePhase({ ...phase, milestones: phase.milestones.filter(m => m.id !== mid) });
  const addM = () => onUpdatePhase({ ...phase, milestones: [...phase.milestones, { id: uid(), title: "Neuer Meilenstein", status: "offen", dueDate: "", notes: "", checklist: [] }] });

  return (
    <div style={{ background: "#0a1628", borderRadius: 16, marginBottom: 16, border: `1px solid ${phase.color}22`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", cursor: "pointer", background: `${phase.color}08` }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 22 }}>{phase.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: phase.color, fontWeight: 700, letterSpacing: 1.5 }}>PHASE {phase.phase}</span>
            {active > 0 && <span style={{ fontSize: 10, background: "#451a03", color: "#fbbf24", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>● {active} AKTIV</span>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>{phase.title}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{phase.description}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: phase.color, fontFamily: "'DM Mono', monospace" }}>{done}/{total}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>erledigt</div>
        </div>
        <span style={{ color: "#334155", fontSize: 11, marginLeft: 6 }}>{open ? "▲" : "▼"}</span>
      </div>
      <div style={{ height: 4, background: "#1e293b" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: phase.color, transition: "width 0.4s" }} />
      </div>
      {open && (
        <div style={{ padding: "16px 20px" }}>
          {phase.milestones.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", color: "#334155", fontSize: 12 }}>Keine Meilensteine in dieser Phase.</div>}
          {phase.milestones.map(m => (
            <MilestoneCard key={m.id} milestone={m} phaseColor={phase.color}
              onUpdate={upd => updateM(m.id, upd)} onDelete={() => deleteM(m.id)} />
          ))}
          <button onClick={addM} style={{ width: "100%", background: "transparent", border: `1px dashed ${phase.color}44`, borderRadius: 8, padding: "9px 0", color: phase.color, fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", marginTop: 4, opacity: 0.8 }}>
            + Meilenstein hinzufügen
          </button>
        </div>
      )}
    </div>
  );
}

function TabProjekt({ p, set }) {
  const phases = p.project?.phases || [];
  const allM = phases.flatMap(ph => ph.milestones);
  const totalM = allM.length;
  const doneM = allM.filter(m => m.status === "erledigt").length;
  const activeM = allM.filter(m => m.status === "aktiv").length;
  const overdueM = allM.filter(m => isOverdue(m.dueDate, m.status)).length;
  const globalProgress = totalM > 0 ? Math.round((doneM / totalM) * 100) : 0;
  const nextAction = allM.find(m => m.status === "aktiv") || allM.find(m => m.status === "offen");
  const nextPhase = phases.find(ph => ph.milestones.some(m => m.id === nextAction?.id));

  const updatePhase = (pid, upd) => set(prev => ({ ...prev, project: { ...prev.project, phases: prev.project.phases.map(ph => ph.id === pid ? upd : ph) } }));
  const setProjectField = (key) => (val) => set(prev => ({ ...prev, project: { ...prev.project, [key]: val } }));

  const daysBetween = p.project?.targetLaunch && p.project?.projectStart
    ? Math.ceil((new Date(p.project.targetLaunch + "T12:00:00") - new Date(p.project.projectStart + "T12:00:00")) / 86400000)
    : null;

  return (
    <div>
      <SectionTitle icon="🗓️" title="Projektplan & Meilensteine" sub="Von der Besichtigung bis zum laufenden Betrieb — alle Schritte im Überblick" />

      {/* Global progress card */}
      <div style={{ background: "#0a1628", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 4 }}>GESAMTFORTSCHRITT</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 36, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 }}>{globalProgress}<span style={{ fontSize: 18, color: "#64748b" }}>%</span></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Gesamt", value: totalM, color: "#475569" },
              { label: "Erledigt", value: doneM, color: "#4ade80" },
              { label: "Aktiv", value: activeM, color: "#fbbf24" },
              { label: "Überfällig", value: overdueM, color: overdueM > 0 ? "#f87171" : "#334155" },
            ].map((s, i) => (
              <div key={i} style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", textAlign: "center", minWidth: 60 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'DM Mono', monospace" }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ height: "100%", width: `${globalProgress}%`, background: "linear-gradient(90deg, #3b82f6, #4ade80)", borderRadius: 4, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, display: "block", marginBottom: 4 }}>PROJEKTSTART</label>
            <input type="date" value={p.project?.projectStart || todayStr()} onChange={e => setProjectField("projectStart")(e.target.value)} style={{ ...inputStyle, fontSize: 12, padding: "7px 10px" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, display: "block", marginBottom: 4 }}>ZIEL-LAUNCH</label>
            <input type="date" value={p.project?.targetLaunch || ""} onChange={e => setProjectField("targetLaunch")(e.target.value)} style={{ ...inputStyle, fontSize: 12, padding: "7px 10px" }} />
          </div>
          {daysBetween !== null && (
            <div style={{ flex: 1, background: "#0f172a", borderRadius: 8, padding: "7px 14px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #1e293b" }}>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1 }}>ZEITRAUM</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: daysBetween >= 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Mono', monospace" }}>{Math.abs(daysBetween)} Tage</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Next action banner */}
      {nextAction && (
        <div style={{ background: "#0a2040", borderRadius: 14, padding: "14px 18px", marginBottom: 20, border: "1px solid #1d4ed8", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 26 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, letterSpacing: 1.5, marginBottom: 2 }}>NÄCHSTE AKTION · {nextPhase?.icon} {nextPhase?.title?.toUpperCase()}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{nextAction.title}</div>
            {nextAction.notes && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{nextAction.notes}</div>}
          </div>
          {nextAction.dueDate && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: isOverdue(nextAction.dueDate, nextAction.status) ? "#f87171" : "#64748b" }}>
                {isOverdue(nextAction.dueDate, nextAction.status) ? "⚠️ Überfällig" : "Fällig am"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "'DM Mono', monospace" }}>{fmtDate(nextAction.dueDate)}</div>
            </div>
          )}
        </div>
      )}

      {/* Phase timeline strip */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, marginBottom: 28, padding: "0 4px" }}>
        {phases.map((ph, i) => {
          const phDone = ph.milestones.filter(m => m.status === "erledigt").length;
          const phTotal = ph.milestones.length;
          const phPct = phTotal > 0 ? phDone / phTotal : 0;
          return (
            <div key={ph.id} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: phPct === 1 ? ph.color : phPct > 0 ? ph.color + "33" : "#1e293b", border: `2px solid ${ph.color}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", fontSize: 18, transition: "all 0.3s" }}>
                  {phPct === 1 ? "✓" : ph.icon}
                </div>
                <div style={{ fontSize: 10, color: phPct > 0 ? ph.color : "#475569", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ph.title}</div>
                <div style={{ fontSize: 10, color: "#334155" }}>{phDone}/{phTotal}</div>
              </div>
              {i < phases.length - 1 && (
                <div style={{ height: 2, width: 24, background: "#1e293b", flexShrink: 0, position: "relative", top: -14 }}>
                  <div style={{ height: "100%", width: `${phPct * 100}%`, background: ph.color, transition: "width 0.4s" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Phase cards */}
      {phases.map(ph => (
        <PhaseCard key={ph.id} phase={ph} onUpdatePhase={upd => updatePhase(ph.id, upd)} />
      ))}
    </div>
  );
}

// ─── Other Tabs ───────────────────────────────────────────────────────────────
function TabStammdaten({ p, set }) {
  const u = (s, k) => v => set(prev => ({ ...prev, [s]: { ...prev[s], [k]: v } }));
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState(false);

  const handleGeocode = async () => {
    setGeocoding(true); setGeoError(false);
    const coords = await geocodeAddress(p.meta.address, p.meta.zip, p.meta.city);
    setGeocoding(false);
    if (coords) set(prev => ({ ...prev, meta: { ...prev.meta, ...coords } }));
    else setGeoError(true);
  };

  const hasCoords = p.meta.lat && p.meta.lng;
  const canGeocode = p.meta.address && p.meta.city;

  return (
    <div>
      <SectionTitle icon="🏢" title="Objektdaten" sub="Basisdaten zur Immobilie" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Input label="Objektname / Bezeichnung" value={p.meta.name} onChange={u("meta","name")} type="text" />
        <Input label="Straße & Hausnummer" value={p.meta.address} onChange={u("meta","address")} type="text" half />
        <Input label="Postleitzahl" value={p.meta.zip} onChange={u("meta","zip")} type="text" half />
        <Input label="Stadt" value={p.meta.city} onChange={u("meta","city")} type="text" half />
        <Select label="Objekttyp" value={p.meta.type} onChange={u("meta","type")} half options={[
          {value:"studio",label:"Studio / Einzimmer"},{value:"1zi",label:"1-Zimmer-Wohnung"},
          {value:"2zi",label:"2-Zimmer-Wohnung"},{value:"3zi",label:"3+ Zimmer"},{value:"buero",label:"Büro / Gewerbefläche"},
        ]} />
        <Input label="Wohnfläche (m²)" value={p.meta.sqm} onChange={u("meta","sqm")} half min={1} />
        <Input label="Zimmeranzahl" value={p.meta.rooms} onChange={u("meta","rooms")} half step={0.5} />
        <Input label="Stockwerk" value={p.meta.floor} onChange={u("meta","floor")} half />
        <Input label="Baujahr" value={p.meta.builtYear} onChange={u("meta","builtYear")} half />
        <Select label="Zustand" value={p.meta.condition} onChange={u("meta","condition")} options={[
          {value:"neuwertig",label:"Neuwertig / Saniert"},{value:"gut",label:"Gut"},
          {value:"mittel",label:"Mittel / Renovierungsbedarf"},{value:"schlecht",label:"Sanierungsbedürftig"},
        ]} />
        <Field label="Notizen / Besonderheiten">
          <textarea value={p.meta.notes} onChange={e => u("meta","notes")(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
        </Field>
      </div>

      <SectionTitle icon="📍" title="Standort" sub="Adresse auf Karte verorten" />
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={handleGeocode} disabled={!canGeocode || geocoding}
          style={{ background: canGeocode ? "#1d4ed8" : "#1e293b", border: "none", borderRadius: 8, padding: "9px 18px", color: canGeocode ? "white" : "#475569", fontSize: 13, cursor: canGeocode ? "pointer" : "default", fontFamily: "'DM Mono', monospace" }}>
          {geocoding ? "Suche…" : hasCoords ? "📍 Standort aktualisieren" : "📍 Standort ermitteln"}
        </button>
        {hasCoords && <span style={{ fontSize: 11, color: "#4ade80" }}>✓ Koordinaten gespeichert</span>}
        {geoError && <span style={{ fontSize: 11, color: "#ef4444" }}>Adresse nicht gefunden – bitte prüfen</span>}
        {!canGeocode && <span style={{ fontSize: 11, color: "#475569" }}>Straße und Stadt eingeben</span>}
      </div>

      {hasCoords && (
        <div style={{ height: 280, borderRadius: 10, overflow: "hidden", border: "1px solid #334155" }}>
          <MapContainer center={[p.meta.lat, p.meta.lng]} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={true}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
            <Marker position={[p.meta.lat, p.meta.lng]}>
              <Popup>{p.meta.name || p.meta.address}<br />{p.meta.zip} {p.meta.city}</Popup>
            </Marker>
          </MapContainer>
        </div>
      )}
    </div>
  );
}

function TabKarte({ properties }) {
  const located = properties.filter(p => p.meta.lat && p.meta.lng);
  const coords  = located.map(p => [p.meta.lat, p.meta.lng]);
  const center  = located.length > 0 ? [located[0].meta.lat, located[0].meta.lng] : [51.1657, 10.4515];

  return (
    <div>
      <SectionTitle icon="🗺️" title="Übersichtskarte" sub="Alle Einheiten mit Standort" />
      {located.length === 0 ? (
        <div style={{ background: "#1e293b", borderRadius: 10, padding: 32, textAlign: "center", color: "#475569", fontSize: 13 }}>
          Noch keine Einheit mit Standort.<br />Adresse in den Stammdaten eingeben und „Standort ermitteln" klicken.
        </div>
      ) : (
        <div style={{ height: 480, borderRadius: 10, overflow: "hidden", border: "1px solid #334155" }}>
          <MapContainer center={center} zoom={6} style={{ height: "100%", width: "100%" }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
            <FitBounds coords={coords} />
            {located.map(p => (
              <Marker key={p.id} position={[p.meta.lat, p.meta.lng]}>
                <Popup>
                  <strong>{p.meta.name || "Einheit"}</strong><br />
                  {p.meta.address}<br />
                  {p.meta.zip} {p.meta.city}<br />
                  {p.meta.sqm} m² · {p.meta.rooms} Zi.
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}
      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
        {located.map(p => (
          <div key={p.id} style={{ background: "#1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#94a3b8", border: "1px solid #334155" }}>
            <div style={{ fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>{p.meta.name || "Einheit"}</div>
            <div>{p.meta.address}, {p.meta.city}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabKosten({ p, set }) {
  const u = (s, k) => v => set(prev => ({ ...prev, [s]: { ...prev[s], [k]: v } }));
  const totalSetup = p.setup.furnitureCost + p.setup.renovationCost + p.setup.otherSetup;
  const setupMonthly = totalSetup / (p.setup.amortMonths || 1);
  return (
    <div>
      <SectionTitle icon="💶" title="Miet- & Betriebskosten" sub="Alle laufenden und einmaligen Ausgaben" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>Mietkosten</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Input label="Kaltmiete (€/Monat)" value={p.costs.coldRent} onChange={u("costs","coldRent")} half prefix="€" />
            <Input label="Nebenkosten (€/Monat)" value={p.costs.nk} onChange={u("costs","nk")} half prefix="€" />
            <Input label="Kaution (€)" value={p.costs.deposit} onChange={u("costs","deposit")} half prefix="€" />
            <Input label="Mindestmietdauer (Monate)" value={p.costs.leaseDuration} onChange={u("costs","leaseDuration")} half />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 12, marginTop: 20, textTransform: "uppercase" }}>Betriebskosten (mtl.)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Input label="Internet" value={p.operations.internet} onChange={u("operations","internet")} half prefix="€" />
            <Input label="Supplies & Verbrauch" value={p.operations.supplies} onChange={u("operations","supplies")} half prefix="€" />
            <Input label="Versicherung / Haftpflicht" value={p.operations.insurance} onChange={u("operations","insurance")} half prefix="€" />
            <Input label="Property Mgmt. (%)" value={p.operations.management} onChange={u("operations","management")} half step={0.5} />
            <Input label="Sonstiges (mtl.)" value={p.operations.misc} onChange={u("operations","misc")} half prefix="€" />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>Einrichtung & Setup (einmalig)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Input label="Möbel & Ausstattung (€)" value={p.setup.furnitureCost} onChange={u("setup","furnitureCost")} prefix="€" />
            <Input label="Renovierungskosten (€)" value={p.setup.renovationCost} onChange={u("setup","renovationCost")} prefix="€" />
            <Input label="Sonstige Setupkosten (€)" value={p.setup.otherSetup} onChange={u("setup","otherSetup")} prefix="€" />
            <Input label="Amortisationszeitraum (Monate)" value={p.setup.amortMonths} onChange={u("setup","amortMonths")} />
          </div>
          <div style={{ background: "#0f172a", borderRadius: 12, padding: 16, marginTop: 12, border: "1px solid #1e293b" }}>
            <Row label="Gesamt Einrichtung" value={totalSetup} />
            <Row label="Amortisation mtl." value={setupMonthly} />
            <Row label="Kaution" value={p.costs.deposit} />
            <Row label="Gesamter Kapitaleinsatz" value={totalSetup + p.costs.deposit} bold />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabEinnahmen({ p, set }) {
  const u = (s, k) => v => set(prev => ({ ...prev, [s]: { ...prev[s], [k]: v } }));
  const lt = calcLongterm(p);
  const r = calcScenario(p, p.airbnb.realisticNights);
  return (
    <div>
      <SectionTitle icon="📈" title="Einnahmenmodell" sub="Airbnb-Parameter & Vergleich Langzeitmiete" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>Airbnb-Parameter</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Input label="Ø Nächtigungspreis (€)" value={p.airbnb.nightlyRate} onChange={u("airbnb","nightlyRate")} half prefix="€" />
            <Input label="Plattformgebühr (%)" value={p.airbnb.platformFee} onChange={u("airbnb","platformFee")} half step={0.5} />
            <Input label="Reinigung pro Übergabe (€)" value={p.airbnb.cleaningFee} onChange={u("airbnb","cleaningFee")} half prefix="€" />
            <Input label="Ø Aufenthaltsdauer (Nächte)" value={p.airbnb.avgStay} onChange={u("airbnb","avgStay")} half step={0.5} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 12, marginTop: 20, textTransform: "uppercase" }}>Szenarien (Nächte/Monat)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Input label="🔴 Pessimistisch" value={p.airbnb.pessimisticNights} onChange={u("airbnb","pessimisticNights")} min={0} />
            <Input label="🟡 Realistisch" value={p.airbnb.realisticNights} onChange={u("airbnb","realisticNights")} min={0} />
            <Input label="🟢 Optimistisch" value={p.airbnb.optimisticNights} onChange={u("airbnb","optimisticNights")} min={0} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>Langzeitmiete (Vergleich)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Input label="Erzielbare Kaltmiete LZ (€/Monat)" value={p.longterm.expectedRent} onChange={u("longterm","expectedRent")} prefix="€" />
            <Input label="Leerstand pro Jahr (Monate)" value={p.longterm.vacancyMonths} onChange={u("longterm","vacancyMonths")} step={0.5} />
          </div>
          {p.longterm.expectedRent > 0 && (
            <div style={{ background: "#0f172a", borderRadius: 12, padding: 16, marginTop: 8, border: "1px solid #1e293b" }}>
              <Row label="Ø Einnahme LZ (mtl.)" value={lt.monthlyRent} green />
              <Row label="Fixkosten" value={lt.fixedCosts} minus />
              <Row label="Monatl. Gewinn LZ" value={lt.profit} bold green={lt.profit >= 0} minus={lt.profit < 0} />
            </div>
          )}
          <div style={{ background: "#0f172a", borderRadius: 12, padding: 14, marginTop: 14, border: "1px solid #1e293b" }}>
            <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>⚡ Airbnb (realistisch)</div>
            <Row label="Einnahmen" value={r.revenue} green />
            <Row label="Gesamtkosten" value={r.totalCosts} minus />
            <Row label="Monatl. Gewinn" value={r.profit} bold green={r.profit >= 0} minus={r.profit < 0} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabAuswertung({ p }) {
  const scenarios = [
    { key: "pess", label: "Pessimistisch", nights: p.airbnb.pessimisticNights, color: "#f87171", dot: "🔴" },
    { key: "real", label: "Realistisch",   nights: p.airbnb.realisticNights,   color: "#fbbf24", dot: "🟡" },
    { key: "opt",  label: "Optimistisch",  nights: p.airbnb.optimisticNights,  color: "#4ade80", dot: "🟢" },
  ];
  const results = scenarios.map(s => ({ ...s, ...calcScenario(p, s.nights) }));
  const lt = calcLongterm(p);
  return (
    <div>
      <SectionTitle icon="📊" title="Auswertung & Rentabilität" sub="Vollständige Kalkulation aller Szenarien" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {results.map(r => (
          <div key={r.key} style={{ background: "#0f172a", borderRadius: 14, padding: 18, border: `1px solid ${r.color}33` }}>
            <div style={{ fontSize: 11, color: r.color, fontWeight: 700, letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>{r.dot} {r.label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <KPI label="Nächte/Monat" value={r.nights} sub={`${pct(r.occupancy)} Auslastung`} color="#e2e8f0" size={18} />
              <KPI label="Monatl. Gewinn" value={eur(r.profit)} sub={r.profit >= 0 ? "✅ positiv" : "⚠️ negativ"} color={r.profit >= 0 ? "#4ade80" : "#f87171"} size={18} />
              <KPI label="ROI (Fixkosten)" value={pct(r.roi)} sub="monatlich" color={r.roi >= 0 ? r.color : "#f87171"} size={18} />
              <KPI label="Break-even" value={`${r.beNights} N.`} sub="Nächte/Monat" color="#e2e8f0" size={18} />
            </div>
            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 10 }}>
              <Row label={`Umsatz (${r.nights} Nächte)`} value={r.revenue} green />
              <Row label={`Airbnb-Gebühr`} value={r.airbnbCut} minus indent />
              <Row label="Reinigung" value={r.cleaningCosts} minus indent />
              <Row label="Fixkosten gesamt" value={r.fixedCosts} minus />
              <div style={{ borderTop: `1px solid ${r.color}55`, marginTop: 6, paddingTop: 6 }}>
                <Row label="GEWINN/MONAT" value={r.profit} bold green={r.profit >= 0} minus={r.profit < 0} />
                <Row label="GEWINN/JAHR" value={r.profit * 12} bold green={r.profit * 12 >= 0} minus={r.profit * 12 < 0} />
              </div>
            </div>
            {r.paybackMonths && <div style={{ marginTop: 10, background: "#1e293b", borderRadius: 8, padding: 10, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1 }}>AMORTISATION</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: r.color, fontFamily: "'DM Mono', monospace" }}>{r.paybackMonths} Monate</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>Startkapital: {eur(r.startupCost)}</div>
            </div>}
          </div>
        ))}
      </div>
      {p.longterm.expectedRent > 0 && (
        <div style={{ background: "#0f172a", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #1e293b" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 14, textTransform: "uppercase" }}>🔄 Airbnb vs. Langzeitmiete</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {results.map(r => {
              const diff = r.profit - lt.profit;
              return (
                <div key={r.key} style={{ textAlign: "center", background: "#1e293b", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: r.color, fontWeight: 700, marginBottom: 4 }}>{r.dot} {r.label}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>vs. LZ {eur(lt.profit)}/Monat</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: diff >= 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Mono', monospace" }}>{diff >= 0 ? "+" : ""}{eur(diff)}/Mo.</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>{eur(diff * 12)}/Jahr</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ background: "#0f172a", borderRadius: 14, padding: 18, border: "1px solid #1e293b", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>📅 Jahresübersicht (realistisch)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {(() => { const r = results[1]; return [
            { label: "Jahresumsatz", value: eur(r.revenue * 12), color: "#4ade80" },
            { label: "Jahreskosten", value: eur(r.totalCosts * 12), color: "#f87171" },
            { label: "Jahresgewinn", value: eur(r.profit * 12), color: r.profit >= 0 ? "#4ade80" : "#f87171" },
            { label: "Gebuchte Nächte/J.", value: `${r.nights * 12}`, color: "#fbbf24" },
          ].map((k, i) => <KPI key={i} {...k} />); })()}
        </div>
      </div>
      <div style={{ padding: 12, background: "#1e293b", borderRadius: 10 }}>
        <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>⚠️ <strong style={{ color: "#94a3b8" }}>Hinweis:</strong> Unverbindliche Kalkulation. Steuerliche Aspekte (USt., ESt.) nicht berücksichtigt. Rechtliche Anforderungen vor Ort prüfen.</p>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
// ─── Umnutzungs-Guideline ─────────────────────────────────────────────────────
const CITY_INFOS = {
  berlin:      { name: "Berlin",       registrierung: true,  behoerde: "Bezirksamt (online)",           cityTax: "5 %", hinweis: "Sehr strikte Kontrolle. Ohne Registrierungsnummer wird das Airbnb-Inserat deaktiviert. Voranfrage beim Bezirksamt und Bauamt frühzeitig stellen." },
  muenchen:    { name: "München",      registrierung: true,  behoerde: "Kreisverwaltungsreferat (KVR)", cityTax: "–",   hinweis: "Sehr angespannter Markt. Baugenehmigung für Nutzungsänderung dauert oft 3–6 Monate." },
  hamburg:     { name: "Hamburg",      registrierung: true,  behoerde: "Bezirksamt",                    cityTax: "–",   hinweis: "Registrierungspflicht seit 2023. Wohnraumschutzgesetz gilt primär für Wohnraum – Büroflächen separat prüfen." },
  frankfurt:   { name: "Frankfurt",    registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Bebauungsplan genau prüfen – nicht in jedem Gewerbegebiet ist Beherbergung zulässig." },
  koeln:       { name: "Köln",         registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Vergleichsweise pragmatisches Bauamt. Voranfrage lohnt sich." },
  stuttgart:   { name: "Stuttgart",    registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Bebauungsplan genau prüfen – Mischgebiete oft genehmigungsfähig." },
  duesseldorf: { name: "Düsseldorf",   registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Bauamt i.d.R. pragmatisch bei Mischnutzung." },
  nuernberg:   { name: "Nürnberg",     registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Weniger streng als Großstädte – Baugenehmigung trotzdem erforderlich." },
  leipzig:     { name: "Leipzig",      registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Wachsende Tourismusstadt, Nutzungsänderung oft genehmigungsfähig." },
  dresden:     { name: "Dresden",      registrierung: false, behoerde: "–",                             cityTax: "–",   hinweis: "Tourismuszonen prüfen. Bauamt vorab kontaktieren." },
  sonstiges:   { name: "Andere Stadt", registrierung: null,  behoerde: "Lokales Bauamt / Ordnungsamt",  cityTax: "Prüfen", hinweis: "Bei kleineren Städten oft pragmatischere Behörden. Lokale Satzungen zum Zweckentfremdungsverbot prüfen." },
};

const UMNUTZUNG_STEPS = [
  {
    id: "u1", phase: "Vorbereitung", color: "#60a5fa",
    title: "Mietvertrag & Vermieter-Genehmigung",
    description: "Ohne schriftliche Genehmigung des Vermieters ist alles andere hinfällig. Prüfe zuerst, ob dein Gewerbemietvertrag eine Untervermietung zu Beherbergungszwecken erlaubt – viele schließen das explizit aus.",
    warning: "Ohne Genehmigung riskierst du fristlose Kündigung – selbst wenn Airbnb und Behörden zustimmen.",
    checklist: ["Mietvertrag auf Untervermietungs- und Nutzungsklauseln geprüft", "Schriftliches Nutzungskonzept an Vermieter übermittelt", "Schriftliche Genehmigung vom Vermieter erhalten"],
    cityNote: () => null,
  },
  {
    id: "u2", phase: "Baurecht", color: "#f59e0b",
    title: "Bebauungsplan & Voranfrage Bauamt",
    description: "Der Bebauungsplan legt fest, welche Nutzungsarten in einem Gebiet zulässig sind. Beherbergung ist nicht überall erlaubt. Eine formlose Voranfrage beim Bauamt klärt die Machbarkeit, bevor du einen kostenpflichtigen Antrag stellst.",
    warning: "Ohne Baugenehmigung ist der Betrieb illegal – auch wenn Vermieter und Airbnb zustimmen.",
    checklist: ["Bebauungsplan eingesehen (Bauamt oder Stadtplan online)", "Nutzungsart geprüft: Mischgebiet / Kerngebiet / Sondergebiet", "Formlose Voranfrage beim Bauamt gestellt", "Positives Feedback vom Bauamt erhalten"],
    cityNote: (c) => c?.hinweis,
  },
  {
    id: "u3", phase: "Baurecht", color: "#f59e0b",
    title: "Baugenehmigung – Nutzungsänderung",
    description: "Die Umnutzung von Büro zu Beherbergung ist in Deutschland baugenehmigungspflichtig. Du brauchst Grundrisszeichnungen, ein Nutzungskonzept und Brandschutznachweise. Ein Architekt oder Bausachverständiger ist hier meist notwendig.",
    warning: "Bearbeitungszeit: 2–6 Monate, in Großstädten auch länger. Diesen Zeitpuffer fest einplanen.",
    checklist: ["Architekt oder Bausachverständigen beauftragt", "Bauantrag vollständig eingereicht", "Baugenehmigung für Nutzungsänderung erhalten"],
    cityNote: () => null,
  },
  {
    id: "u4", phase: "Brandschutz", color: "#ef4444",
    title: "Brandschutz & Beherbergungsstättenverordnung",
    description: "Für gewerbliche Beherbergung gelten besondere Brandschutzvorschriften nach der Beherbergungsstättenverordnung des jeweiligen Bundeslandes. Ab bestimmten Größen sind Notbeleuchtung, Fluchtwegbeschilderung und ein Brandschutzkonzept Pflicht.",
    warning: "Verstöße können zur sofortigen Betriebsschließung und persönlicher Haftung führen.",
    checklist: ["Beherbergungsstättenverordnung des Bundeslandes geprüft", "Rauchmelderpflicht erfüllt (jedes Zimmer + Flure)", "Fluchtwegbeschilderung angebracht", "Notbeleuchtung installiert (falls erforderlich)", "Feuerlöscher vorhanden", "Brandschutzgutachten eingeholt (ab >12 Betten oder >2 Etagen)"],
    cityNote: () => null,
  },
  {
    id: "u5", phase: "Gewerbe & Steuern", color: "#a78bfa",
    title: "Gewerbeanmeldung",
    description: "Das kurzfristige Vermieten an Gäste gegen Entgelt gilt als Gewerbebetrieb und muss beim Gewerbeamt (Ordnungsamt) deiner Stadt angemeldet werden. Die Anmeldung kostet meist 20–65 € und dauert wenige Tage.",
    warning: "Ohne Gewerbeanmeldung bist du ordnungswidrig tätig.",
    checklist: ["Gewerbe beim Gewerbeamt / Ordnungsamt angemeldet", "Gewerbeschein erhalten", "Finanzamt automatisch informiert (erfolgt i.d.R. durch Gewerbeamt)"],
    cityNote: () => null,
  },
  {
    id: "u6", phase: "Gewerbe & Steuern", color: "#a78bfa",
    title: "Steuerliche Registrierung",
    description: "Als Beherbergungsbetrieb bist du umsatzsteuerpflichtig: 7 % auf Übernachtungsleistungen. Einnahmen müssen in der Einkommensteuererklärung angegeben werden. Ab ca. 24.500 € Gewinn fällt Gewerbesteuer an.",
    warning: "Viele unterschätzen die Steuerpflicht. Steuerberater frühzeitig einschalten.",
    checklist: ["Fragebogen zur steuerlichen Erfassung beim Finanzamt ausgefüllt", "Umsatzsteuer-ID beantragt", "Steuerberater konsultiert", "Buchhaltungssystem eingerichtet"],
    cityNote: (c) => c?.cityTax && c.cityTax !== "–" ? `City Tax / Übernachtungssteuer: ${c.cityTax} auf den Übernachtungspreis – zusätzlich abzuführen.` : null,
  },
  {
    id: "u7", phase: "Plattform", color: "#34d399",
    title: "Städtische Registrierungsnummer",
    description: "Immer mehr deutsche Städte verlangen eine offizielle Registrierungsnummer für Kurzzeitvermietungen. Airbnb ist verpflichtet, diese im Inserat anzuzeigen – ohne Nummer wird das Listing in betroffenen Städten deaktiviert.",
    warning: "Ohne Registrierungsnummer kann Airbnb dein Inserat jederzeit sperren.",
    checklist: ["Geprüft ob Registrierungspflicht in deiner Stadt besteht", "Antrag auf Registrierungsnummer gestellt", "Registrierungsnummer erhalten"],
    cityNote: (c) => c ? (c.registrierung === true ? `Registrierungspflicht: JA — Behörde: ${c.behoerde}` : c.registrierung === false ? "Aktuell keine stadtweite Registrierungspflicht – lokale Regelungen trotzdem prüfen." : `Behörde: ${c.behoerde} – Status lokal prüfen.`) : null,
  },
  {
    id: "u8", phase: "Launch", color: "#4ade80",
    title: "Airbnb-Listing erstellen",
    description: "Erst wenn alle Genehmigungen vorliegen, erstellst du das Listing. Professionelle Fotos und eine klare Beschreibung sind entscheidend für den Start. Beginne mit wettbewerbsfähigen Preisen und erhöhe sie nach ersten Bewertungen.",
    warning: "Kein Listing ohne vollständige Genehmigungen – Airbnb prüft in manchen Städten aktiv.",
    checklist: ["Professionelle Fotos gemacht", "Listing-Text verfasst (Deutsch + Englisch)", "Registrierungsnummer eingetragen (falls erforderlich)", "Preisstrategie und Mindestaufenthalt definiert", "Erste Buchung freigeschaltet"],
    cityNote: () => null,
  },
  {
    id: "u9", phase: "Betrieb", color: "#94a3b8",
    title: "Meldeschein-Pflicht",
    description: "Als gewerblicher Beherbergungsbetrieb bist du nach dem Bundesmeldegesetz verpflichtet, Gäste zu erfassen. Bei Aufenthalten unter 3 Monaten genügt ein vereinfachter Meldeschein, den Gäste beim Check-in unterschreiben.",
    warning: "Fehlende Meldescheine können bei Kontrollen zu Bußgeldern führen.",
    checklist: ["Meldeschein-Vorlage beschafft (Gemeinde oder standardisierter Download)", "Check-in-Prozess für Gäste definiert", "Archivierungsprozess für Meldescheine eingerichtet"],
    cityNote: () => null,
  },
];

function TabUmnutzung({ p, set }) {
  const [expanded, setExpanded] = useState(null);
  const u = p.umnutzung || { city: "", steps: {} };
  const setU = (next) => set({ ...p, umnutzung: next });
  const city = CITY_INFOS[u.city] || null;

  const getStep = (id, len) => u.steps[id] || { status: "offen", notes: "", checklist: Array(len).fill(false) };
  const setStep = (id, val) => setU({ ...u, steps: { ...u.steps, [id]: val } });

  const totalItems = UMNUTZUNG_STEPS.reduce((s, st) => s + st.checklist.length, 0);
  const doneItems  = UMNUTZUNG_STEPS.reduce((s, st) => s + getStep(st.id, st.checklist.length).checklist.filter(Boolean).length, 0);
  const progress   = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  const statusColor = { offen: "#475569", aktiv: "#f59e0b", erledigt: "#4ade80" };
  const statusLabel = { offen: "Offen", aktiv: "In Bearbeitung", erledigt: "Erledigt" };

  return (
    <div>
      <SectionTitle icon="🏛️" title="Umnutzungs-Guideline" sub="Büro → Beherbergung · Schritt-für-Schritt-Leitfaden für Deutschland" />

      <Select label="Deine Stadt" value={u.city} onChange={(v) => setU({ ...u, city: v })}
        options={[{ value: "", label: "Stadt wählen…" }, ...Object.entries(CITY_INFOS).map(([k, v]) => ({ value: k, label: v.name }))]} />

      <div style={{ background: "#1e293b", borderRadius: 10, padding: "14px 18px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1.5, textTransform: "uppercase" }}>Gesamtfortschritt</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#4ade80" }}>{progress} %</span>
        </div>
        <div style={{ height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #4ade80, #22d3ee)", borderRadius: 3, transition: "width 0.4s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{doneItems} von {totalItems} Punkten abgehakt</div>
      </div>

      {UMNUTZUNG_STEPS.map((step, idx) => {
        const st = getStep(step.id, step.checklist.length);
        const isOpen = expanded === step.id;
        const doneCl = st.checklist.filter(Boolean).length;
        const allDone = doneCl === step.checklist.length;
        const cityNote = step.cityNote(city);

        return (
          <div key={step.id} style={{ background: "#1e293b", borderRadius: 10, marginBottom: 10, border: `1px solid ${isOpen ? step.color + "44" : "#334155"}`, overflow: "hidden", transition: "border 0.2s" }}>
            <div onClick={() => setExpanded(isOpen ? null : step.id)}
              style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: allDone ? "#16a34a22" : "#0f172a", border: `2px solid ${allDone ? "#4ade80" : step.color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: allDone ? "#4ade80" : step.color }}>
                {allDone ? "✓" : idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: step.color, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2 }}>{step.phase}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{step.title}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: statusColor[st.status], fontWeight: 700 }}>{statusLabel[st.status]}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{doneCl}/{step.checklist.length}</span>
                <span style={{ color: "#475569", fontSize: 10 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: "0 18px 18px", borderTop: "1px solid #0f172a" }}>
                <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.7, margin: "14px 0 12px" }}>{step.description}</p>

                {step.warning && (
                  <div style={{ background: "#1c0505", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#fca5a5" }}>
                    ⚠️ {step.warning}
                  </div>
                )}

                {cityNote && (
                  <div style={{ background: "#0c1a2e", border: `1px solid ${step.color}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#93c5fd" }}>
                    🏙️ {cityNote}
                  </div>
                )}

                <div style={{ marginBottom: 14 }}>
                  {step.checklist.map((item, i) => (
                    <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={st.checklist[i] || false}
                        onChange={e => {
                          const cl = [...st.checklist];
                          cl[i] = e.target.checked;
                          setStep(step.id, { ...st, checklist: cl, status: cl.every(Boolean) ? "erledigt" : cl.some(Boolean) ? "aktiv" : "offen" });
                        }}
                        style={{ marginTop: 3, accentColor: "#4ade80", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: st.checklist[i] ? "#475569" : "#cbd5e1", textDecoration: st.checklist[i] ? "line-through" : "none", lineHeight: 1.5 }}>{item}</span>
                    </label>
                  ))}
                </div>

                <label style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Notizen</label>
                <textarea value={st.notes} rows={2}
                  onChange={e => setStep(step.id, { ...st, notes: e.target.value })}
                  placeholder="Eigene Notizen zu diesem Schritt…"
                  style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, boxSizing: "border-box", fontFamily: "'DM Mono', monospace", outline: "none", resize: "vertical", lineHeight: 1.5 }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const TABS = [
  { id: "stammdaten", label: "Objekt",      icon: "🏢" },
  { id: "kosten",     label: "Kosten",      icon: "💶" },
  { id: "einnahmen",  label: "Einnahmen",   icon: "📈" },
  { id: "auswertung", label: "Auswertung",  icon: "📊" },
  { id: "projekt",    label: "Projektplan", icon: "🗓️" },
  { id: "umnutzung",  label: "Umnutzung",   icon: "🏛️" },
  { id: "karte",      label: "Karte",        icon: "🗺️" },
];

export default function App() {
  const [properties, setProperties] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [current, setCurrent] = useState(newProperty());
  const [tab, setTab] = useState("stammdaten");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem("prop-analyzer-v3");
        if (raw) {
          const data = JSON.parse(raw);
          setProperties(data);
          if (data.length > 0) { setActiveId(data[0].id); setCurrent(data[0]); }
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (list) => {
    try { localStorage.setItem("prop-analyzer-v3", JSON.stringify(list)); } catch {}
  }, []);

  const handleSave = async () => {
    const exists = properties.find(p => p.id === current.id);
    const updated = exists ? properties.map(p => p.id === current.id ? current : p) : [...properties, current];
    setProperties(updated); setActiveId(current.id);
    await persist(updated);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const handleNew = () => { setCurrent(newProperty()); setActiveId(null); setTab("stammdaten"); };
  const handleSelect = (p) => { setCurrent(p); setActiveId(p.id); setTab("stammdaten"); };
  const handleDelete = async (id) => {
    const updated = properties.filter(p => p.id !== id);
    setProperties(updated); await persist(updated);
    if (activeId === id) handleNew();
  };

  const projProgress = (p) => {
    if (!p.project?.phases) return null;
    const all = p.project.phases.flatMap(ph => ph.milestones);
    return all.length > 0 ? Math.round((all.filter(m => m.status === "erledigt").length / all.length) * 100) : 0;
  };

  if (!loaded) return <div style={{ background: "#0f172a", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontFamily: "'DM Mono', monospace" }}>Lade…</div>;

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", background: "#0f172a", minHeight: "100vh", display: "flex" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />

      {/* Sidebar */}
      <div style={{ width: 224, background: "#020617", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", letterSpacing: 2, marginBottom: 4 }}>PROPERTY</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#f1f5f9", fontWeight: 800 }}>Analyzer</div>
        </div>
        <div style={{ padding: 12, flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: 1.5, marginBottom: 8, textTransform: "uppercase" }}>Objekte</div>
          {properties.length === 0 && <div style={{ fontSize: 11, color: "#334155", padding: "8px 0" }}>Noch keine Objekte.</div>}
          {properties.map(p => {
            const pb = projProgress(p);
            return (
              <div key={p.id} onClick={() => handleSelect(p)}
                style={{ borderRadius: 8, padding: "10px", marginBottom: 6, cursor: "pointer", background: activeId === p.id ? "#1e3a5f" : "transparent", border: `1px solid ${activeId === p.id ? "#3b82f6" : "transparent"}`, transition: "all 0.15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.meta.name || "Unbenannt"}</span>
                  {pb !== null && <span style={{ fontSize: 10, color: pb === 100 ? "#4ade80" : "#64748b", flexShrink: 0, marginLeft: 4 }}>{pb}%</span>}
                </div>
                <div style={{ fontSize: 10, color: "#64748b" }}>{p.meta.city || "—"} · {p.meta.sqm} m²</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>{eur(p.costs.coldRent)}/Monat KM</div>
                {pb !== null && pb > 0 && (
                  <div style={{ height: 2, background: "#1e293b", borderRadius: 1, marginTop: 5 }}>
                    <div style={{ height: "100%", width: `${pb}%`, background: pb === 100 ? "#4ade80" : "#3b82f6", borderRadius: 1 }} />
                  </div>
                )}
                <div onClick={e => { e.stopPropagation(); handleDelete(p.id); }} style={{ fontSize: 9, color: "#ef4444", marginTop: 5, cursor: "pointer", opacity: 0.5 }}>✕ löschen</div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid #1e293b" }}>
          <button onClick={handleNew} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 0", color: "#e2e8f0", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
            + Neues Objekt
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: "#020617", borderBottom: "1px solid #1e293b", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: "#f1f5f9" }}>{current.meta.name || "Neues Objekt"}</span>
            {current.meta.city && <span style={{ fontSize: 11, color: "#64748b" }}>{current.meta.zip} {current.meta.city} · {current.meta.sqm} m²</span>}
          </div>
          <button onClick={handleSave} style={{ background: saved ? "#16a34a" : "#1d4ed8", border: "none", borderRadius: 8, padding: "8px 20px", color: "white", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", transition: "background 0.3s" }}>
            {saved ? "✓ Gespeichert" : "💾 Speichern"}
          </button>
        </div>
        <div style={{ background: "#020617", borderBottom: "1px solid #1e293b", display: "flex", padding: "0 24px" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: "none", border: "none", padding: "12px 16px", color: tab === t.id ? "#4ade80" : "#64748b", borderBottom: tab === t.id ? "2px solid #4ade80" : "2px solid transparent", cursor: "pointer", fontSize: 13, fontFamily: "'DM Mono', monospace", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>
          {tab === "stammdaten" && <TabStammdaten p={current} set={setCurrent} />}
          {tab === "kosten"     && <TabKosten p={current} set={setCurrent} />}
          {tab === "einnahmen"  && <TabEinnahmen p={current} set={setCurrent} />}
          {tab === "auswertung" && <TabAuswertung p={current} />}
          {tab === "projekt"    && <TabProjekt p={current} set={setCurrent} />}
          {tab === "umnutzung" && <TabUmnutzung p={current} set={setCurrent} />}
          {tab === "karte"     && <TabKarte properties={properties} />}
        </div>
      </div>
    </div>
  );
}
