import { useState, useEffect, useCallback, useRef } from "react";
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

// ─── Photo IndexedDB helpers ──────────────────────────────────────────────────
function photoDbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("prop-photos", 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("p");
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej();
  });
}
async function photoDbGet(id) {
  try {
    const db = await photoDbOpen();
    return await new Promise(res => {
      const r = db.transaction("p", "readonly").objectStore("p").get(id);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
async function photoDbSet(id, val) {
  try {
    const db = await photoDbOpen();
    await new Promise(res => {
      const tx = db.transaction("p", "readwrite");
      tx.objectStore("p").put(val, id);
      tx.oncomplete = res; tx.onerror = res;
    });
  } catch {}
}
async function photoDbDel(id) {
  try {
    const db = await photoDbOpen();
    await new Promise(res => {
      const tx = db.transaction("p", "readwrite");
      tx.objectStore("p").delete(id);
      tx.oncomplete = res; tx.onerror = res;
    });
  } catch {}
}

// ─── Export / Import ──────────────────────────────────────────────────────────
function exportPropertyJson(p) {
  const blob = new Blob([JSON.stringify({ ...p, photos: [] }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${p.meta.name || "einheit"}-${p.id}.json` });
  a.click(); URL.revokeObjectURL(a.href);
}

function exportPropertyCsv(p) {
  const sc = calcScenario(p, p.airbnb?.realisticNights ?? 18);
  const setup = (p.setup?.furnitureCost || 0) + (p.setup?.renovationCost || 0) + (p.setup?.otherSetup || 0);
  const rows = [
    ["Feld", "Wert"],
    ["Name", p.meta?.name || ""], ["Adresse", p.meta?.address || ""], ["PLZ", p.meta?.zip || ""], ["Stadt", p.meta?.city || ""],
    ["Typ", p.meta?.type || ""], ["Fläche (m²)", p.meta?.sqm || ""], ["Zimmer", p.meta?.rooms || ""],
    ["Kaltmiete (€)", p.costs?.coldRent || 0], ["Nebenkosten (€)", p.costs?.nk || 0], ["Kaution (€)", p.costs?.deposit || 0],
    ["Setup-Kosten (€)", setup], ["Nächte realistisch", p.airbnb?.realisticNights || 0], ["Nachpreis (€)", p.airbnb?.nightlyRate || 0],
    ["Einnahmen realist. (€)", sc.revenue], ["Gesamtkosten realist. (€)", sc.totalCosts], ["Gewinn realist. (€)", sc.profit], ["ROI realist. (%)", (sc.roi ?? 0).toFixed(1)],
  ];
  const csv = "\uFEFF" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })), download: `${p.meta?.name || "einheit"}-${p.id}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

// ─── Lageanalyse ──────────────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function analyzeLocation(lat, lng, city) {
  const badges = [];

  try {
    const query = `[out:json][timeout:20];(
node["aeroway"="aerodrome"](around:30000,${lat},${lng});
way["aeroway"="aerodrome"](around:30000,${lat},${lng});
node["railway"="station"](around:3000,${lat},${lng});
node["railway"="halt"](around:3000,${lat},${lng});
node["station"="subway"](around:1000,${lat},${lng});
node["highway"="motorway_junction"](around:5000,${lat},${lng});
);out center;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
    const data = await res.json();
    const nodes = data.elements || [];

    const nearest = (list, getLatLng) => list.reduce((min, n) => {
      const [a, b] = getLatLng(n);
      const d = haversine(lat, lng, a, b);
      return d < min.d ? { d, name: n.tags?.name || "" } : min;
    }, { d: Infinity, name: "" });

    const airports = nodes.filter(n => n.tags?.aeroway === "aerodrome");
    if (airports.length > 0) {
      const nr = nearest(airports, n => n.type === "way" ? [n.center.lat, n.center.lon] : [n.lat, n.lon]);
      if (nr.d < 8)  badges.push({ icon: "✈️", label: "Flughafen direkt",  sub: `${nr.name} · ${nr.d.toFixed(1)} km`,            color: "#2563eb" });
      else if (nr.d < 20) badges.push({ icon: "✈️", label: "Flughafennähe", sub: `${nr.name} · ${nr.d.toFixed(1)} km`,            color: "#2563eb" });
    }

    const stations = nodes.filter(n => n.tags?.railway === "station" || n.tags?.railway === "halt");
    if (stations.length > 0) {
      const nr = nearest(stations, n => [n.lat, n.lon]);
      if (nr.d < 0.6) badges.push({ icon: "🚆", label: "Bahnhof fußläufig",  sub: `${nr.name} · ${Math.round(nr.d*1000)} m`,     color: "#7c3aed" });
      else if (nr.d < 2) badges.push({ icon: "🚆", label: "Bahnhof erreichbar", sub: `${nr.name} · ${nr.d.toFixed(1)} km`,        color: "#7c3aed" });
    }

    const subway = nodes.filter(n => n.tags?.station === "subway");
    if (subway.length > 0) {
      const nr = nearest(subway, n => [n.lat, n.lon]);
      if (nr.d < 0.5) badges.push({ icon: "🚇", label: "U-Bahn fußläufig", sub: `${nr.name} · ${Math.round(nr.d*1000)} m`,       color: "#059669" });
    }

    const motorway = nodes.filter(n => n.tags?.highway === "motorway_junction");
    if (motorway.length > 0) {
      const nr = nearest(motorway, n => [n.lat, n.lon]);
      if (nr.d < 5) badges.push({ icon: "🛣️", label: "Autobahnanbindung", sub: `Auffahrt · ${nr.d.toFixed(1)} km`,                color: "#ea580c" });
    }
  } catch {}

  try {
    if (city) {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city + ", Deutschland")}&limit=1`, { headers: { "Accept-Language": "de" } });
      const data = await res.json();
      if (data.length > 0) {
        const d = haversine(lat, lng, parseFloat(data[0].lat), parseFloat(data[0].lon));
        if (d < 3)      badges.push({ icon: "🏙️", label: "Innenstadtlage",  sub: `${d.toFixed(1)} km zum Zentrum`,               color: "#16a34a" });
        else if (d < 8) badges.push({ icon: "🏙️", label: "Innenstadtnähe", sub: `${d.toFixed(1)} km zum Zentrum`,                color: "#16a34a" });
        else            badges.push({ icon: "📍",  label: "Stadtrandlage",  sub: `${d.toFixed(1)} km zum Zentrum`,                color: "#64748b" });
      }
    }
  } catch {}

  return badges;
}

// ─── Default Project Phases ───────────────────────────────────────────────────
const DEFAULT_PHASES = () => [
  {
    id: uid(), phase: 1, title: "Due Diligence", icon: "🔍",
    description: "Prüfung vor der Entscheidung — rechtlich, wirtschaftlich, technisch",
    color: "#2563eb",
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
    color: "#7c3aed",
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
    color: "#ea580c",
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
    color: "#16a34a",
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
    color: "#d97706",
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
  photos: [],
  tracker: { entries: [] },
  log: { entries: [] },
  konzept: { betreiberName: "", betreiberEmail: "", betreiberTelefon: "", betreiberAdresse: "" },
  status: "watchlist",
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

// ─── Konzept HTML Export ──────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ─── Mietvertrag HTML Export ──────────────────────────────────────────────────
function mietvertragHtml(p, v) {
  const m = p.meta || {};
  const c = p.costs || {};
  const k = p.konzept || {};
  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const mietbeginn = v.mietbeginn
    ? new Date(v.mietbeginn + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })
    : "_______________";
  const gesamtmiete = (c.coldRent || 0) + (c.nk || 0);
  const adresse = [m.address, m.zip && m.city ? m.zip + " " + m.city : m.city].filter(Boolean).join(", ") || "—";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Mietvertrag – ${esc(m.name || "Objekt")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;color:#1f2937;background:#fff;font-size:13px;line-height:1.7}
  .page{max-width:800px;margin:0 auto;padding:48px 40px}
  h1{font-family:'Playfair Display',serif;font-size:28px;color:#111827;margin-bottom:4px}
  h2{font-size:13px;font-weight:700;color:#111827;margin:28px 0 10px;padding-bottom:5px;border-bottom:2px solid #111827;text-transform:uppercase;letter-spacing:0.5px}
  .subtitle{color:#6b7280;font-size:13px;margin-bottom:24px}
  .cover{border-bottom:2px solid #111827;padding-bottom:20px;margin-bottom:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 32px;margin-bottom:12px}
  .kv{padding:5px 0;border-bottom:1px solid #f3f4f6}
  .kv .label{font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:2px}
  .kv .value{font-size:13px;color:#111827;font-weight:500}
  p{margin-bottom:8px;color:#374151}
  .highlight{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 20px;margin:12px 0}
  .sig-block{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}
  .sig-line{border-bottom:1px solid #374151;height:40px;margin-bottom:6px}
  .note{font-size:11px;color:#9ca3af;font-style:italic}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{padding:24px}}
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="subtitle">Mietvertrag (Untermietvertrag) · Erstellt am ${date}</div>
    <h1>${esc(m.name || "Mietobjekt")}</h1>
    <div class="subtitle" style="margin-bottom:0">${esc(adresse)}</div>
  </div>

  <h2>§ 1 Vertragsparteien</h2>
  <div class="grid2">
    <div>
      <div style="font-weight:700;margin-bottom:6px;font-size:13px">Vermieter</div>
      <div class="kv"><div class="label">Name</div><div class="value">${esc(v.vermieterName || "_______________")}</div></div>
      <div class="kv"><div class="label">Adresse</div><div class="value">${esc(v.vermieterAdresse || "_______________")}</div></div>
    </div>
    <div>
      <div style="font-weight:700;margin-bottom:6px;font-size:13px">Mieter</div>
      <div class="kv"><div class="label">Name / Firma</div><div class="value">${esc(k.betreiberName || "_______________")}</div></div>
      <div class="kv"><div class="label">Adresse</div><div class="value">${esc(k.betreiberAdresse || "_______________")}</div></div>
      ${k.betreiberEmail ? `<div class="kv"><div class="label">E-Mail</div><div class="value">${esc(k.betreiberEmail)}</div></div>` : ""}
      ${k.betreiberTelefon ? `<div class="kv"><div class="label">Telefon</div><div class="value">${esc(k.betreiberTelefon)}</div></div>` : ""}
    </div>
  </div>

  <h2>§ 2 Mietobjekt</h2>
  <div class="grid2">
    <div class="kv"><div class="label">Adresse</div><div class="value">${esc(adresse)}</div></div>
    <div class="kv"><div class="label">Wohnfläche</div><div class="value">${esc(m.sqm || "—")} m²</div></div>
    <div class="kv"><div class="label">Zimmer</div><div class="value">${esc(m.rooms || "—")}</div></div>
    <div class="kv"><div class="label">Etage</div><div class="value">${m.floor != null ? esc(m.floor) + ". OG" : "—"}</div></div>
  </div>
  <p style="margin-top:8px">Das Mietobjekt wird möbliert übergeben. Die Einrichtungsgegenstände sind im Übergabeprotokoll festgehalten.</p>

  <h2>§ 3 Mietbeginn und Mietdauer</h2>
  <div class="grid2">
    <div class="kv"><div class="label">Mietbeginn</div><div class="value">${mietbeginn}</div></div>
    <div class="kv"><div class="label">Mietdauer</div><div class="value">${c.leaseDuration ? esc(c.leaseDuration) + " Monate" : "Unbefristet"}</div></div>
  </div>
  <p style="margin-top:8px">${c.leaseDuration ? `Das Mietverhältnis ist auf ${esc(c.leaseDuration)} Monate befristet und endet ohne Kündigung automatisch.` : "Das Mietverhältnis läuft auf unbestimmte Zeit und kann von beiden Parteien mit einer Frist von 3 Monaten zum Monatsende schriftlich gekündigt werden."}</p>

  <h2>§ 4 Mietzins und Nebenkosten</h2>
  <div class="highlight">
    <div class="grid2">
      <div class="kv"><div class="label">Kaltmiete / Monat</div><div class="value" style="font-size:15px;font-weight:700">${esc(eur(c.coldRent))}</div></div>
      <div class="kv"><div class="label">Nebenkosten / Monat</div><div class="value" style="font-size:15px;font-weight:700">${esc(eur(c.nk))}</div></div>
      <div class="kv"><div class="label">Gesamtmiete / Monat</div><div class="value" style="font-size:17px;font-weight:800;color:#15803d">${esc(eur(gesamtmiete))}</div></div>
      <div class="kv"><div class="label">Kaution</div><div class="value" style="font-size:15px;font-weight:700">${esc(eur(c.deposit))}</div></div>
    </div>
  </div>
  <p>Die Miete ist monatlich im Voraus, spätestens am 3. Werktag eines Monats, zu überweisen. Die Nebenkosten werden als Pauschale erhoben.</p>

  <h2>§ 5 Kaution</h2>
  <p>Der Mieter leistet vor Mietbeginn eine Kaution von <strong>${esc(eur(c.deposit))}</strong>. Sie wird nach Beendigung des Mietverhältnisses und Klärung aller Ansprüche zurückgezahlt.</p>

  <h2>§ 6 Nutzungszweck</h2>
  <p>Das Mietobjekt wird vom Mieter zur <strong>gewerblichen Kurzzeitvermietung (u. a. über Airbnb)</strong> genutzt. Der Vermieter erteilt hiermit ausdrücklich seine Zustimmung. Der Mieter verpflichtet sich, alle erforderlichen Genehmigungen, Registrierungen und steuerlichen Anmeldungen eigenverantwortlich einzuholen und nachzuweisen.</p>

  <h2>§ 7 Instandhaltung und Schönheitsreparaturen</h2>
  <p>Der Mieter übernimmt die laufende Pflege und Instandhaltung des Mietobjekts sowie der Einrichtung auf eigene Kosten. Schäden über normale Abnutzung hinaus sind vom Mieter zu beheben. Bei Auszug ist das Objekt ordnungsgemäß zurückzugeben.</p>

  <h2>§ 8 Hausordnung und Gästepflichten</h2>
  <p>Der Mieter verpflichtet sich, die Hausordnung einzuhalten und Gästen zugänglich zu machen. Ruhestörungen und Veranstaltungen über den normalen Beherbergungsbetrieb hinaus sind untersagt. Der Mieter haftet für Schäden durch seine Gäste.</p>

  <h2>§ 9 Versicherungen</h2>
  <p>Der Mieter ist verpflichtet, eine geeignete Haftpflichtversicherung für die Kurzzeitvermietung abzuschließen und auf Verlangen nachzuweisen.</p>

  <h2>§ 10 Kündigung</h2>
  <p>${c.leaseDuration ? `Das Mietverhältnis ist befristet und endet automatisch. Eine ordentliche Kündigung ist ausgeschlossen.` : "Kündigungsfrist: 3 Monate zum Monatsende, schriftlich."} Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.</p>

  ${v.besonderes ? `<h2>§ 11 Besondere Vereinbarungen</h2><p style="white-space:pre-wrap">${esc(v.besonderes)}</p>` : ""}

  <h2>${v.besonderes ? "§ 12" : "§ 11"} Schlussbestimmungen</h2>
  <p>Änderungen bedürfen der Schriftform. Unwirksame Bestimmungen lassen den Vertrag im Übrigen unberührt. Gerichtsstand ist der Ort des Mietobjekts.</p>

  <div class="sig-block">
    <div>
      <div class="sig-line"></div>
      <div style="font-weight:600">${esc(v.vermieterName || "Vermieter")}</div>
      <div class="note">Ort, Datum / Unterschrift Vermieter</div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div style="font-weight:600">${esc(k.betreiberName || "Mieter")}</div>
      <div class="note">Ort, Datum / Unterschrift Mieter</div>
    </div>
  </div>

</div>
</body>
</html>`;
}

function konzeptHtml(p) {
  const k = p.konzept || {};
  const m = p.meta || {};
  const c = p.costs || {};
  const s = p.setup || {};
  const sc = calcScenario(p, p.airbnb?.realisticNights ?? 18);

  const totalSetup = (s.furnitureCost || 0) + (s.renovationCost || 0) + (s.otherSetup || 0);

  const typeLabel = { studio: "Studio / Einzimmer", apartment: "Apartment", loft: "Loft", room: "Zimmer", office: "Büro / Gewerbefläche" };
  const condLabel = { "sehr gut": "Sehr gut", "gut": "Gut", "renovierungsbedürftig": "Renovierungsbedürftig", "saniert": "Saniert" };

  const stepsSubset = [
    { id: "u1", label: "Vermieter-Genehmigung" },
    { id: "u4", label: "Brandschutz" },
    { id: "u5", label: "Gewerbeanmeldung" },
    { id: "u6", label: "Steuerliche Registrierung" },
    { id: "u7", label: "Registrierungsnummer (Stadt)" },
    { id: "u9", label: "Meldeschein-Pflicht" },
  ];
  const stepsHtml = stepsSubset.map(st => {
    const status = (p.umnutzung?.steps?.[st.id]?.status) || "offen";
    const statusColor = status === "erledigt" ? "#15803d" : status === "aktiv" ? "#a16207" : "#9ca3af";
    const statusText  = status === "erledigt" ? "Erledigt" : status === "aktiv" ? "In Bearbeitung" : "Geplant";
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${esc(st.label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${statusColor};font-weight:600;">${statusText}</td>
    </tr>`;
  }).join("");

  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Konzept – ${esc(m.name || "Objekt")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;color:#1f2937;background:#fff;font-size:14px;line-height:1.6}
  .page{max-width:780px;margin:0 auto;padding:48px 40px}
  h1{font-family:'Playfair Display',serif;font-size:32px;color:#111827;margin-bottom:6px}
  h2{font-family:'Playfair Display',serif;font-size:20px;color:#111827;margin:32px 0 12px}
  .subtitle{color:#9ca3af;font-size:15px;margin-bottom:6px}
  .cover{border-bottom:3px solid #111827;padding-bottom:28px;margin-bottom:12px}
  .cover-meta{font-size:13px;color:#9ca3af;margin-top:4px}
  .section{background:#f9fafb;border-radius:10px;padding:20px 24px;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}
  .kv{padding:6px 0;border-bottom:1px solid #e5e7eb}
  .kv:last-child{border-bottom:none}
  .kv .label{font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:2px}
  .kv .value{font-size:14px;font-weight:600;color:#111827}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{background:#f3f4f6;text-align:left;padding:8px 12px;font-size:12px;font-weight:700;color:#9ca3af;letter-spacing:1px;text-transform:uppercase}
  .highlight{background:#f8fafc;border-radius:10px;padding:18px 24px;margin-bottom:16px;border:1px solid #bbf7d0}
  .highlight .value{font-size:28px;font-weight:800;color:#15803d}
  .note{font-size:12px;color:#6b7280;margin-top:8px;font-style:italic}
  .signature{margin-top:48px;padding-top:24px;border-top:1px solid #e5e7eb}
  .sig-line{border-bottom:1px solid #374151;width:280px;height:48px;margin-bottom:6px}
  p{margin-bottom:8px}
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{padding:24px}
    h2{margin:20px 0 10px}
  }
</style>
</head>
<body>
<div class="page">

  <!-- Cover -->
  <div class="cover">
    <div class="subtitle">Konzept zur Kurzzeitvermietung via Airbnb</div>
    <h1>${esc(m.name || "Objekt")}</h1>
    <div class="cover-meta">${esc([m.address, m.zip && m.city ? m.zip + " " + m.city : m.city].filter(Boolean).join(", ") || "Adresse nicht angegeben")}</div>
    <div class="cover-meta" style="margin-top:8px">Erstellt am ${date}</div>
  </div>

  <!-- Betreiber -->
  ${k.betreiberName ? `<h2>Betreiber</h2>
  <div class="section">
    <div class="grid">
      <div class="kv"><div class="label">Name</div><div class="value">${esc(k.betreiberName)}</div></div>
      ${k.betreiberAdresse ? `<div class="kv"><div class="label">Adresse</div><div class="value">${esc(k.betreiberAdresse)}</div></div>` : ""}
      ${k.betreiberEmail ? `<div class="kv"><div class="label">E-Mail</div><div class="value">${esc(k.betreiberEmail)}</div></div>` : ""}
      ${k.betreiberTelefon ? `<div class="kv"><div class="label">Telefon</div><div class="value">${esc(k.betreiberTelefon)}</div></div>` : ""}
    </div>
  </div>` : ""}

  <!-- Das Objekt -->
  <h2>Das Objekt</h2>
  <div class="section">
    <div class="grid">
      <div class="kv"><div class="label">Typ</div><div class="value">${esc(typeLabel[m.type] || m.type || "—")}</div></div>
      <div class="kv"><div class="label">Wohnfläche</div><div class="value">${esc(m.sqm || "—")} m²</div></div>
      <div class="kv"><div class="label">Zimmer</div><div class="value">${esc(m.rooms || "—")}</div></div>
      <div class="kv"><div class="label">Stockwerk</div><div class="value">${esc(m.floor != null ? m.floor + ". OG" : "—")}</div></div>
      <div class="kv"><div class="label">Baujahr</div><div class="value">${esc(m.builtYear || "—")}</div></div>
      <div class="kv"><div class="label">Zustand</div><div class="value">${esc(condLabel[m.condition] || m.condition || "—")}</div></div>
    </div>
  </div>

  <!-- Ihr Nutzen als Eigentümer -->
  <h2>Ihr Nutzen als Eigentümer</h2>
  <div class="section">
    <div class="grid">
      <div class="kv"><div class="label">Kaltmiete / Monat</div><div class="value">${esc(eur(c.coldRent))}</div></div>
      <div class="kv"><div class="label">Nebenkosten / Monat</div><div class="value">${esc(eur(c.nk))}</div></div>
      <div class="kv"><div class="label">Kaution</div><div class="value">${esc(eur(c.deposit))}</div></div>
      <div class="kv"><div class="label">Gewünschte Mietdauer</div><div class="value">${esc(c.leaseDuration || "—")} Monate</div></div>
    </div>
    <p style="margin-top:14px;color:#374151">Als Mieter sorge ich für einen stabilen, pünktlichen Mieteingang, übernehme sämtliche Instandhaltung der Einrichtung auf eigene Kosten und hinterlasse die Wohnung bei Auszug im vertragsgemäßen Zustand.</p>
  </div>

  <!-- Betreiber-Investment -->
  <h2>Betreiber-Investment</h2>
  <div class="section">
    <div class="grid">
      <div class="kv"><div class="label">Einrichtung</div><div class="value">${esc(eur(s.furnitureCost))}</div></div>
      <div class="kv"><div class="label">Renovierung</div><div class="value">${esc(eur(s.renovationCost))}</div></div>
      ${s.otherSetup ? `<div class="kv"><div class="label">Sonstiges</div><div class="value">${esc(eur(s.otherSetup))}</div></div>` : ""}
      <div class="kv"><div class="label">Gesamtinvestition</div><div class="value" style="color:#2563eb">${esc(eur(totalSetup))}</div></div>
    </div>
    <p style="margin-top:14px;color:#374151">Dieses Eigeninvestment zeigt mein Commitment — ich trage das volle wirtschaftliche Risiko und habe ein starkes Interesse an einer langfristigen, pfleglichen Nutzung der Immobilie.</p>
  </div>

  <!-- Rechtliche Absicherung -->
  <h2>Rechtliche Absicherung</h2>
  <div class="section">
    <p style="color:#374151;margin-bottom:10px">Folgende rechtliche Schritte werden vor Betriebsaufnahme vollständig abgeschlossen:</p>
    <table>
      <thead><tr><th>Schritt</th><th>Status</th></tr></thead>
      <tbody>${stepsHtml}</tbody>
    </table>
  </div>

  <!-- Wirtschaftlichkeit -->
  <h2>Wirtschaftlichkeit</h2>
  <div class="highlight">
    <div style="font-size:12px;font-weight:700;color:#15803d;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px">Realistisches Szenario — ${esc(p.airbnb?.realisticNights ?? 18)} Nächte / Monat</div>
    <div class="value">${esc(eur(sc.profit))} <span style="font-size:16px;font-weight:500;color:#374151">Monatsgewinn</span></div>
    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div><div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px">Auslastung</div><div style="font-weight:700;font-size:16px">${esc(pct(sc.occupancy))}</div></div>
      <div><div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px">Einnahmen</div><div style="font-weight:700;font-size:16px">${esc(eur(sc.revenue))}</div></div>
      <div><div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px">Gesamtkosten</div><div style="font-weight:700;font-size:16px">${esc(eur(sc.totalCosts))}</div></div>
    </div>
  </div>

  <!-- Betriebskonzept -->
  <h2>Betriebskonzept</h2>
  <div class="section">
    <p><strong>Reinigung:</strong> Professioneller Reinigungsservice nach jedem Gast — die Wohnung wird stets in einwandfreiem Zustand übergeben.</p>
    <p><strong>Zugangssystem:</strong> Digitales Smart Lock (kontaktloser Check-in) — kein Schlüsseltausch, maximale Sicherheit.</p>
    <p><strong>Gästevetting:</strong> Ausschließlich verifizierte Airbnb-Gäste mit Bewertungen; Partyverbote und Hausregeln sind klar kommuniziert.</p>
    <p><strong>Versicherung:</strong> Airbnb AirCover für Hosts sowie ergänzende Haftpflichtversicherung für Kurzzeitvermietung.</p>
    <p><strong>Ansprechbarkeit:</strong> 24/7 erreichbar für Gäste und Eigentümer; schnelle Reaktion bei Schäden oder Problemen.</p>
    <p class="note">Fotos der Wohnung werden separat beigefügt.</p>
  </div>

  <!-- Unterschrift -->
  <div class="signature">
    <div style="margin-bottom:28px;color:#9ca3af;font-size:13px">Ort, Datum: ___________________________</div>
    <div class="sig-line"></div>
    <div style="font-size:13px;color:#374151;font-weight:600">${esc(k.betreiberName || "Unterschrift Betreiber")}</div>
  </div>

</div>
</body>
</html>`;
}

function openKonzept(p) {
  const win = window.open("", "_blank");
  if (!win) { alert("Pop-up-Blocker aktiv — bitte kurz deaktivieren und erneut versuchen."); return; }
  win.document.write(konzeptHtml(p));
  win.document.close();
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
const inputStyle = { width: "100%", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", color: "#0f172a", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Mono', monospace", outline: "none" };

function Field({ label, children, half }) {
  return (
    <div style={{ marginBottom: 14, width: half ? "calc(50% - 6px)" : "100%", boxSizing: "border-box" }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, marginBottom: 5, textTransform: "uppercase" }}>{label}</label>
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
    <div style={{ marginBottom: 22, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}
function Row({ label, value, bold, minus, green, indent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
      <span style={{ fontSize: 12, color: bold ? "#1e293b" : "#64748b", fontWeight: bold ? 700 : 400, paddingLeft: indent ? 14 : 0, fontFamily: "'DM Mono', monospace" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: green ? "#16a34a" : minus ? "#dc2626" : "#1e293b", fontFamily: "'DM Mono', monospace" }}>
        {minus ? "−" : green ? "+" : ""} {eur(Math.abs(value ?? 0))}
      </span>
    </div>
  );
}
function KPI({ label, value, sub, color = "#0f172a", size = 22 }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 12, padding: "14px 16px", border: "1px solid #f1f5f9" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 800, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── Milestone Components ─────────────────────────────────────────────────────
const STATUS_CONFIG = {
  offen:    { label: "Offen",          color: "#94a3b8", bg: "#f1f5f9",   dot: "○" },
  aktiv:    { label: "In Bearbeitung", color: "#d97706", bg: "#fff7ed",   dot: "◑" },
  erledigt: { label: "Erledigt",       color: "#16a34a", bg: "#f1f5f9",   dot: "●" },
};
const STATUS_CYCLE = { offen: "aktiv", aktiv: "erledigt", erledigt: "offen" };

function MilestoneCard({ milestone, phaseColor, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const sc = STATUS_CONFIG[milestone.status];
  const doneChecks = milestone.checklist.filter(c => c.done).length;
  const totalChecks = milestone.checklist.length;
  const overdue = isOverdue(milestone.dueDate, milestone.status);

  return (
    <div style={{ background: "#f8fafc", borderRadius: 12, marginBottom: 10, border: `1px solid ${milestone.status === "erledigt" ? phaseColor + "44" : "#f1f5f9"}`, overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <button onClick={e => { e.stopPropagation(); onUpdate({ ...milestone, status: STATUS_CYCLE[milestone.status] }); }}
          style={{ background: sc.bg, border: `1px solid ${sc.color}`, borderRadius: 6, padding: "3px 8px", color: sc.color, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", flexShrink: 0 }}>
          {sc.dot} {sc.label}
        </button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: milestone.status === "erledigt" ? "#9ca3af" : "#1e293b", textDecoration: milestone.status === "erledigt" ? "line-through" : "none" }}>
          {milestone.title}
        </span>
        {totalChecks > 0 && <span style={{ fontSize: 11, color: doneChecks === totalChecks ? "#16a34a" : "#64748b", flexShrink: 0 }}>{doneChecks}/{totalChecks}</span>}
        {milestone.dueDate && <span style={{ fontSize: 11, color: overdue ? "#dc2626" : "#94a3b8", flexShrink: 0 }}>{overdue ? "⚠️ " : "📅 "}{fmtDate(milestone.dueDate)}</span>}
        <span style={{ color: "#e2e8f0", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Progress bar */}
      {totalChecks > 0 && (
        <div style={{ height: 2, background: "#f1f5f9" }}>
          <div style={{ height: "100%", width: `${(doneChecks / totalChecks) * 100}%`, background: phaseColor, transition: "width 0.3s" }} />
        </div>
      )}

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: 14, borderTop: "1px solid #f1f5f9" }}>
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
                style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${c.done ? phaseColor : "#e2e8f0"}`, background: c.done ? phaseColor + "33" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {c.done && <span style={{ color: phaseColor, fontSize: 12, lineHeight: 1 }}>✓</span>}
              </div>
              <input type="text" value={c.text}
                onChange={e => onUpdate({ ...milestone, checklist: milestone.checklist.map(x => x.id === c.id ? { ...x, text: e.target.value } : x) })}
                style={{ flex: 1, background: "transparent", border: "none", color: c.done ? "#9ca3af" : "#94a3b8", fontSize: 12, fontFamily: "'DM Mono', monospace", outline: "none", textDecoration: c.done ? "line-through" : "none" }} />
              <span onClick={() => onUpdate({ ...milestone, checklist: milestone.checklist.filter(x => x.id !== c.id) })}
                style={{ color: "#e2e8f0", cursor: "pointer", fontSize: 14 }}>✕</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => onUpdate({ ...milestone, checklist: [...milestone.checklist, { id: uid(), text: "Neuer Punkt", done: false }] })}
              style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 12px", color: "#475569", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
              + Punkt hinzufügen
            </button>
            <button onClick={onDelete}
              style={{ background: "transparent", border: "1px solid #dc262633", borderRadius: 6, padding: "5px 12px", color: "#dc2626", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace", marginLeft: "auto" }}>
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
    <div style={{ background: "#ffffff", borderRadius: 16, marginBottom: 16, border: `1px solid ${phase.color}22`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", cursor: "pointer", background: `${phase.color}08` }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 22 }}>{phase.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: phase.color, fontWeight: 700, letterSpacing: 1.5 }}>PHASE {phase.phase}</span>
            {active > 0 && <span style={{ fontSize: 10, background: "#fff7ed", color: "#d97706", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>● {active} AKTIV</span>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{phase.title}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{phase.description}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: phase.color, fontFamily: "'DM Mono', monospace" }}>{done}/{total}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>erledigt</div>
        </div>
        <span style={{ color: "#e2e8f0", fontSize: 11, marginLeft: 6 }}>{open ? "▲" : "▼"}</span>
      </div>
      <div style={{ height: 4, background: "#f1f5f9" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: phase.color, transition: "width 0.4s" }} />
      </div>
      {open && (
        <div style={{ padding: "16px 20px" }}>
          {phase.milestones.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", color: "#e2e8f0", fontSize: 12 }}>Keine Meilensteine in dieser Phase.</div>}
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
      <div style={{ background: "#ffffff", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid #f1f5f9" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 4 }}>GESAMTFORTSCHRITT</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 36, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{globalProgress}<span style={{ fontSize: 18, color: "#64748b" }}>%</span></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Gesamt", value: totalM, color: "#94a3b8" },
              { label: "Erledigt", value: doneM, color: "#16a34a" },
              { label: "Aktiv", value: activeM, color: "#d97706" },
              { label: "Überfällig", value: overdueM, color: overdueM > 0 ? "#dc2626" : "#e2e8f0" },
            ].map((s, i) => (
              <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 14px", textAlign: "center", minWidth: 60 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'DM Mono', monospace" }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ height: "100%", width: `${globalProgress}%`, background: "linear-gradient(90deg, #2563eb, #16a34a)", borderRadius: 4, transition: "width 0.5s ease" }} />
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
            <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "7px 14px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #f1f5f9" }}>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1 }}>ZEITRAUM</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: daysBetween >= 0 ? "#16a34a" : "#dc2626", fontFamily: "'DM Mono', monospace" }}>{Math.abs(daysBetween)} Tage</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Next action banner */}
      {nextAction && (
        <div style={{ background: "#dbeafe", borderRadius: 14, padding: "14px 18px", marginBottom: 20, border: "1px solid #2563eb", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 26 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#2563eb", fontWeight: 700, letterSpacing: 1.5, marginBottom: 2 }}>NÄCHSTE AKTION · {nextPhase?.icon} {nextPhase?.title?.toUpperCase()}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{nextAction.title}</div>
            {nextAction.notes && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{nextAction.notes}</div>}
          </div>
          {nextAction.dueDate && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: isOverdue(nextAction.dueDate, nextAction.status) ? "#dc2626" : "#64748b" }}>
                {isOverdue(nextAction.dueDate, nextAction.status) ? "⚠️ Überfällig" : "Fällig am"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", fontFamily: "'DM Mono', monospace" }}>{fmtDate(nextAction.dueDate)}</div>
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
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: phPct === 1 ? ph.color : phPct > 0 ? ph.color + "33" : "#f1f5f9", border: `2px solid ${ph.color}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", fontSize: 18, transition: "all 0.3s" }}>
                  {phPct === 1 ? "✓" : ph.icon}
                </div>
                <div style={{ fontSize: 10, color: phPct > 0 ? ph.color : "#94a3b8", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ph.title}</div>
                <div style={{ fontSize: 10, color: "#e2e8f0" }}>{phDone}/{phTotal}</div>
              </div>
              {i < phases.length - 1 && (
                <div style={{ height: 2, width: 24, background: "#f1f5f9", flexShrink: 0, position: "relative", top: -14 }}>
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
// ─── Photo Gallery ────────────────────────────────────────────────────────────
function PhotoGallery({ p, set }) {
  const photos = p.photos || [];
  const [urls, setUrls] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    if (photos.length === 0) return;
    Promise.all(photos.map(ph => photoDbGet(ph.id).then(url => [ph.id, url])))
      .then(entries => setUrls(Object.fromEntries(entries.filter(([, v]) => v))));
  }, [photos]);

  const handleFiles = async (files) => {
    const added = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await new Promise(res => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.readAsDataURL(file);
      });
      const id = uid();
      await photoDbSet(id, dataUrl);
      setUrls(prev => ({ ...prev, [id]: dataUrl }));
      added.push({ id, name: file.name, createdAt: new Date().toISOString() });
    }
    if (added.length > 0)
      set(prev => ({ ...prev, photos: [...(prev.photos || []), ...added] }));
  };

  const handleDelete = async (id) => {
    await photoDbDel(id);
    setUrls(prev => { const n = { ...prev }; delete n[id]; return n; });
    set(prev => ({ ...prev, photos: (prev.photos || []).filter(ph => ph.id !== id) }));
    if (lightbox === id) setLightbox(null);
  };

  return (
    <div>
      <SectionTitle icon="📷" title="Fotos" sub="Bilder der Einheit hochladen und verwalten" />

      {/* Upload zone */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        style={{ border: "2px dashed #e2e8f0", borderRadius: 12, padding: "28px 16px", textAlign: "center", cursor: "pointer", marginBottom: 20, background: "#ffffff", transition: "border-color 0.2s" }}
        onMouseEnter={e => e.currentTarget.style.borderColor = "#94a3b8"}
        onMouseLeave={e => e.currentTarget.style.borderColor = "#e2e8f0"}
      >
        <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: "none" }}
          onChange={e => handleFiles(e.target.files)} />
        <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>Fotos auswählen oder hier ablegen</div>
        <div style={{ fontSize: 11, color: "#e2e8f0", marginTop: 4 }}>JPG, PNG, WEBP · beliebig viele</div>
      </div>

      {/* Grid */}
      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {photos.map(ph => (
            <div key={ph.id} onClick={() => setLightbox(ph.id)}
              style={{ position: "relative", aspectRatio: "4/3", borderRadius: 10, overflow: "hidden", background: "#f1f5f9", cursor: "pointer" }}>
              {urls[ph.id]
                ? <img src={urls[ph.id]} alt={ph.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontSize: 20 }}>⏳</div>
              }
              <button onClick={e => { e.stopPropagation(); handleDelete(ph.id); }}
                style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.65)", border: "none", borderRadius: 6, color: "#dc2626", fontSize: 11, cursor: "pointer", padding: "2px 7px", lineHeight: 1.6 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && urls[lightbox] && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={urls[lightbox]} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} />
          <button onClick={() => setLightbox(null)}
            style={{ position: "absolute", top: 20, right: 24, background: "transparent", border: "none", color: "white", fontSize: 30, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
      )}
    </div>
  );
}

function TabStammdaten({ p, set }) {
  const u = (s, k) => v => set(prev => ({ ...prev, [s]: { ...prev[s], [k]: v } }));
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [lageAnalyse, setLageAnalyse] = useState(null);
  const [lageLoading, setLageLoading] = useState(false);

  const handleAnalyze = async () => {
    setLageLoading(true);
    const badges = await analyzeLocation(p.meta.lat, p.meta.lng, p.meta.city);
    setLageAnalyse(badges);
    setLageLoading(false);
  };

  const handleGeocode = async () => {
    setGeocoding(true); setGeoError(false);
    const coords = await geocodeAddress(p.meta.address, p.meta.zip, p.meta.city);
    setGeocoding(false);
    if (coords) set(prev => ({ ...prev, meta: { ...prev.meta, ...coords } }));
    else setGeoError(true);
  };

  const hasCoords = p.meta.lat && p.meta.lng;
  const canGeocode = p.meta.address && p.meta.city;

  const isAktiv = p.status === "aktiv";
  const toggleStatus = () => set(prev => ({ ...prev, status: prev.status === "aktiv" ? "watchlist" : "aktiv" }));

  return (
    <div>
      {/* Status toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: isAktiv ? "#f1f5f9" : "#ffffff", borderRadius: 12, border: `1px solid ${isAktiv ? "#16a34a44" : "#e2e8f0"}`, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: isAktiv ? "#16a34a" : "#475569" }}>
            {isAktiv ? "✓ Im Betrieb" : "○ Watchlist"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {isAktiv ? "Zählt zu Portfolio-Summen (Kosten, Gewinn, ROI)" : "Wird in Portfolio-Summen nicht berücksichtigt"}
          </div>
        </div>
        <button onClick={toggleStatus}
          style={{ background: isAktiv ? "#16a34a22" : "#f1f5f9", border: `1px solid ${isAktiv ? "#16a34a" : "#94a3b8"}`, borderRadius: 20, padding: "7px 20px", color: isAktiv ? "#16a34a" : "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
          {isAktiv ? "→ Watchlist" : "→ Ins Portfolio"}
        </button>
      </div>

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
          style={{ background: canGeocode ? "#2563eb" : "#f1f5f9", border: "none", borderRadius: 8, padding: "9px 18px", color: canGeocode ? "white" : "#94a3b8", fontSize: 13, cursor: canGeocode ? "pointer" : "default", fontFamily: "'DM Mono', monospace" }}>
          {geocoding ? "Suche…" : hasCoords ? "📍 Standort aktualisieren" : "📍 Standort ermitteln"}
        </button>
        {hasCoords && <span style={{ fontSize: 11, color: "#16a34a" }}>✓ Koordinaten gespeichert</span>}
        {geoError && <span style={{ fontSize: 11, color: "#dc2626" }}>Adresse nicht gefunden – bitte prüfen</span>}
        {!canGeocode && <span style={{ fontSize: 11, color: "#94a3b8" }}>Straße und Stadt eingeben</span>}
      </div>

      {hasCoords && (
        <>
          <div style={{ height: 280, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <MapContainer center={[p.meta.lat, p.meta.lng]} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={true}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <Marker position={[p.meta.lat, p.meta.lng]}>
                <Popup>{p.meta.name || p.meta.address}<br />{p.meta.zip} {p.meta.city}</Popup>
              </Marker>
            </MapContainer>
          </div>

          {/* Lageanalyse */}
          <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #f1f5f9", padding: 18, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: lageAnalyse ? 14 : 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 1.2, textTransform: "uppercase" }}>Lageanalyse</div>
              <button onClick={handleAnalyze} disabled={lageLoading}
                style={{ background: lageLoading ? "#f1f5f9" : "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 14px", color: lageLoading ? "#94a3b8" : "#475569", fontSize: 12, cursor: lageLoading ? "default" : "pointer", fontFamily: "'DM Mono', monospace" }}>
                {lageLoading ? "Analysiere…" : lageAnalyse ? "↻ Neu analysieren" : "Analysieren"}
              </button>
            </div>
            {lageAnalyse && (
              lageAnalyse.length === 0
                ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Keine besonderen Lagevorteile im Umkreis gefunden.</div>
                : <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {lageAnalyse.map((b, i) => (
                      <div key={i} style={{ background: "#f8fafc", border: `1px solid ${b.color}33`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{b.icon}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: b.color }}>{b.label}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{b.sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 28 }}>
        <PhotoGallery p={p} set={set} />
      </div>
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
        <div style={{ background: "#f1f5f9", borderRadius: 10, padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Noch keine Einheit mit Standort.<br />Adresse in den Stammdaten eingeben und „Standort ermitteln" klicken.
        </div>
      ) : (
        <div style={{ height: 480, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0" }}>
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
          <div key={p.id} style={{ background: "#f1f5f9", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#475569", border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>{p.meta.name || "Einheit"}</div>
            <div>{p.meta.address}, {p.meta.city}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabMietvertrag({ properties }) {
  const [selectedId, setSelectedId] = useState(properties[0]?.id || "");
  const [vermieterName, setVermieterName] = useState("");
  const [vermieterAdresse, setVermieterAdresse] = useState("");
  const [mietbeginn, setMietbeginn] = useState(todayStr());
  const [besonderes, setBesonderes] = useState("");

  const p = properties.find(x => x.id === selectedId);

  const handleOpen = () => {
    if (!p) return;
    const win = window.open("", "_blank");
    if (!win) { alert("Pop-up-Blocker aktiv — bitte kurz deaktivieren."); return; }
    win.document.write(mietvertragHtml(p, { vermieterName, vermieterAdresse, mietbeginn, besonderes }));
    win.document.close();
  };

  const panelStyle = { background: "#ffffff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9", marginBottom: 20 };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 };

  return (
    <div>
      <SectionTitle icon="📝" title="Mietvertrag" sub="Untermietvertrag generieren und als PDF speichern" />

      {properties.length === 0 ? (
        <div style={{ background: "#f1f5f9", borderRadius: 10, padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Noch keine Objekte gespeichert. Erstelle zuerst eine Einheit.
        </div>
      ) : (
        <>
          {/* Objekt-Auswahl */}
          <div style={panelStyle}>
            <div style={labelStyle}>Einheit auswählen</div>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              style={{ ...{ width: "100%", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", color: "#0f172a", fontSize: 14, fontFamily: "'DM Mono', monospace", outline: "none" } }}>
              {properties.map(x => (
                <option key={x.id} value={x.id}>{x.meta.name || "Unbenannt"} – {x.meta.city || "—"}</option>
              ))}
            </select>
            {p && (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { label: "Adresse", value: [p.meta.address, p.meta.city].filter(Boolean).join(", ") || "—" },
                  { label: "Fläche", value: p.meta.sqm ? p.meta.sqm + " m²" : "—" },
                  { label: "Kaltmiete", value: eur(p.costs.coldRent) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", border: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vermieter-Daten */}
          <div style={panelStyle}>
            <div style={labelStyle}>Vermieter</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Input label="Name / Firma" value={vermieterName} onChange={setVermieterName} type="text" half />
              <Input label="Adresse (Straße, PLZ Ort)" value={vermieterAdresse} onChange={setVermieterAdresse} type="text" half />
            </div>
          </div>

          {/* Mieter-Daten (aus Konzept) */}
          <div style={panelStyle}>
            <div style={labelStyle}>Mieter (aus Konzept-Tab)</div>
            {p && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Name / Firma", value: p.konzept?.betreiberName || "—" },
                  { label: "Adresse", value: p.konzept?.betreiberAdresse || "—" },
                  { label: "E-Mail", value: p.konzept?.betreiberEmail || "—" },
                  { label: "Telefon", value: p.konzept?.betreiberTelefon || "—" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, color: value === "—" ? "#94a3b8" : "#0f172a", fontWeight: 500 }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
            {p && !p.konzept?.betreiberName && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#d97706", background: "#fff7ed", borderRadius: 8, padding: "8px 12px" }}>
                ⚠ Mieter-Daten fehlen — bitte im Konzept-Tab der Einheit eintragen.
              </div>
            )}
          </div>

          {/* Vertragsdetails */}
          <div style={panelStyle}>
            <div style={labelStyle}>Vertragsdetails</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Input label="Mietbeginn" value={mietbeginn} onChange={setMietbeginn} type="date" half />
              {p && (
                <div style={{ width: "calc(50% - 6px)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 5 }}>Mietdauer</div>
                  <div style={{ background: "#f1f5f9", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#0f172a" }}>
                    {p.costs.leaseDuration ? p.costs.leaseDuration + " Monate (aus Kosten-Tab)" : "Unbefristet"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Besondere Vereinbarungen */}
          <div style={panelStyle}>
            <div style={labelStyle}>Besondere Vereinbarungen (optional)</div>
            <textarea
              value={besonderes}
              onChange={e => setBesonderes(e.target.value)}
              placeholder="z. B. Sonderregelungen, individuelle Absprachen..."
              rows={4}
              style={{ width: "100%", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", color: "#0f172a", fontSize: 14, fontFamily: "'DM Mono', monospace", outline: "none", resize: "vertical", boxSizing: "border-box" }}
            />
          </div>

          {/* Export */}
          <button onClick={handleOpen}
            style={{ width: "100%", background: "#16a34a", border: "none", borderRadius: 12, padding: "16px 24px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
            📝 Mietvertrag öffnen → Als PDF speichern
          </button>
          <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
            Dokument öffnet sich in neuem Tab → Drucken (Cmd+P) → "Als PDF speichern"
          </div>
        </>
      )}
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
          <div style={{ background: "#f8fafc", borderRadius: 12, padding: 16, marginTop: 12, border: "1px solid #f1f5f9" }}>
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
            <div style={{ background: "#f8fafc", borderRadius: 12, padding: 16, marginTop: 8, border: "1px solid #f1f5f9" }}>
              <Row label="Ø Einnahme LZ (mtl.)" value={lt.monthlyRent} green />
              <Row label="Fixkosten" value={lt.fixedCosts} minus />
              <Row label="Monatl. Gewinn LZ" value={lt.profit} bold green={lt.profit >= 0} minus={lt.profit < 0} />
            </div>
          )}
          <div style={{ background: "#f8fafc", borderRadius: 12, padding: 14, marginTop: 14, border: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 11, color: "#d97706", fontWeight: 700, marginBottom: 8 }}>⚡ Airbnb (realistisch)</div>
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
    { key: "pess", label: "Pessimistisch", nights: p.airbnb.pessimisticNights, color: "#dc2626", dot: "🔴" },
    { key: "real", label: "Realistisch",   nights: p.airbnb.realisticNights,   color: "#d97706", dot: "🟡" },
    { key: "opt",  label: "Optimistisch",  nights: p.airbnb.optimisticNights,  color: "#16a34a", dot: "🟢" },
  ];
  const results = scenarios.map(s => ({ ...s, ...calcScenario(p, s.nights) }));
  const lt = calcLongterm(p);
  return (
    <div>
      <SectionTitle icon="📊" title="Auswertung & Rentabilität" sub="Vollständige Kalkulation aller Szenarien" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {results.map(r => (
          <div key={r.key} style={{ background: "#f8fafc", borderRadius: 14, padding: 18, border: `1px solid ${r.color}33` }}>
            <div style={{ fontSize: 11, color: r.color, fontWeight: 700, letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>{r.dot} {r.label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <KPI label="Nächte/Monat" value={r.nights} sub={`${pct(r.occupancy)} Auslastung`} color="#1e293b" size={18} />
              <KPI label="Monatl. Gewinn" value={eur(r.profit)} sub={r.profit >= 0 ? "✅ positiv" : "⚠️ negativ"} color={r.profit >= 0 ? "#16a34a" : "#dc2626"} size={18} />
              <KPI label="ROI (Fixkosten)" value={pct(r.roi)} sub="monatlich" color={r.roi >= 0 ? r.color : "#dc2626"} size={18} />
              <KPI label="Break-even" value={`${r.beNights} N.`} sub="Nächte/Monat" color="#1e293b" size={18} />
            </div>
            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
              <Row label={`Umsatz (${r.nights} Nächte)`} value={r.revenue} green />
              <Row label={`Airbnb-Gebühr`} value={r.airbnbCut} minus indent />
              <Row label="Reinigung" value={r.cleaningCosts} minus indent />
              <Row label="Fixkosten gesamt" value={r.fixedCosts} minus />
              <div style={{ borderTop: `1px solid ${r.color}55`, marginTop: 6, paddingTop: 6 }}>
                <Row label="GEWINN/MONAT" value={r.profit} bold green={r.profit >= 0} minus={r.profit < 0} />
                <Row label="GEWINN/JAHR" value={r.profit * 12} bold green={r.profit * 12 >= 0} minus={r.profit * 12 < 0} />
              </div>
            </div>
            {r.paybackMonths && <div style={{ marginTop: 10, background: "#f1f5f9", borderRadius: 8, padding: 10, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1 }}>AMORTISATION</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: r.color, fontFamily: "'DM Mono', monospace" }}>{r.paybackMonths} Monate</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>Startkapital: {eur(r.startupCost)}</div>
            </div>}
          </div>
        ))}
      </div>
      {p.longterm.expectedRent > 0 && (
        <div style={{ background: "#f8fafc", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 14, textTransform: "uppercase" }}>🔄 Airbnb vs. Langzeitmiete</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {results.map(r => {
              const diff = r.profit - lt.profit;
              return (
                <div key={r.key} style={{ textAlign: "center", background: "#f1f5f9", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: r.color, fontWeight: 700, marginBottom: 4 }}>{r.dot} {r.label}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>vs. LZ {eur(lt.profit)}/Monat</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: diff >= 0 ? "#16a34a" : "#dc2626", fontFamily: "'DM Mono', monospace" }}>{diff >= 0 ? "+" : ""}{eur(diff)}/Mo.</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>{eur(diff * 12)}/Jahr</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ background: "#f8fafc", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>📅 Jahresübersicht (realistisch)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {(() => { const r = results[1]; return [
            { label: "Jahresumsatz", value: eur(r.revenue * 12), color: "#16a34a" },
            { label: "Jahreskosten", value: eur(r.totalCosts * 12), color: "#dc2626" },
            { label: "Jahresgewinn", value: eur(r.profit * 12), color: r.profit >= 0 ? "#16a34a" : "#dc2626" },
            { label: "Gebuchte Nächte/J.", value: `${r.nights * 12}`, color: "#d97706" },
          ].map((k, i) => <KPI key={i} {...k} />); })()}
        </div>
      </div>
      <div style={{ padding: 12, background: "#f1f5f9", borderRadius: 10 }}>
        <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>⚠️ <strong style={{ color: "#475569" }}>Hinweis:</strong> Unverbindliche Kalkulation. Steuerliche Aspekte (USt., ESt.) nicht berücksichtigt. Rechtliche Anforderungen vor Ort prüfen.</p>
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
    id: "u1", phase: "Vorbereitung", color: "#2563eb",
    title: "Mietvertrag & Vermieter-Genehmigung",
    description: "Ohne schriftliche Genehmigung des Vermieters ist alles andere hinfällig. Prüfe zuerst, ob dein Gewerbemietvertrag eine Untervermietung zu Beherbergungszwecken erlaubt – viele schließen das explizit aus.",
    warning: "Ohne Genehmigung riskierst du fristlose Kündigung – selbst wenn Airbnb und Behörden zustimmen.",
    checklist: ["Mietvertrag auf Untervermietungs- und Nutzungsklauseln geprüft", "Schriftliches Nutzungskonzept an Vermieter übermittelt", "Schriftliche Genehmigung vom Vermieter erhalten"],
    cityNote: () => null,
  },
  {
    id: "u2", phase: "Baurecht", color: "#d97706",
    title: "Bebauungsplan & Voranfrage Bauamt",
    description: "Der Bebauungsplan legt fest, welche Nutzungsarten in einem Gebiet zulässig sind. Beherbergung ist nicht überall erlaubt. Eine formlose Voranfrage beim Bauamt klärt die Machbarkeit, bevor du einen kostenpflichtigen Antrag stellst.",
    warning: "Ohne Baugenehmigung ist der Betrieb illegal – auch wenn Vermieter und Airbnb zustimmen.",
    checklist: ["Bebauungsplan eingesehen (Bauamt oder Stadtplan online)", "Nutzungsart geprüft: Mischgebiet / Kerngebiet / Sondergebiet", "Formlose Voranfrage beim Bauamt gestellt", "Positives Feedback vom Bauamt erhalten"],
    cityNote: (c) => c?.hinweis,
  },
  {
    id: "u3", phase: "Baurecht", color: "#d97706",
    title: "Baugenehmigung – Nutzungsänderung",
    description: "Die Umnutzung von Büro zu Beherbergung ist in Deutschland baugenehmigungspflichtig. Du brauchst Grundrisszeichnungen, ein Nutzungskonzept und Brandschutznachweise. Ein Architekt oder Bausachverständiger ist hier meist notwendig.",
    warning: "Bearbeitungszeit: 2–6 Monate, in Großstädten auch länger. Diesen Zeitpuffer fest einplanen.",
    checklist: ["Architekt oder Bausachverständigen beauftragt", "Bauantrag vollständig eingereicht", "Baugenehmigung für Nutzungsänderung erhalten"],
    cityNote: () => null,
  },
  {
    id: "u4", phase: "Brandschutz", color: "#dc2626",
    title: "Brandschutz & Beherbergungsstättenverordnung",
    description: "Für gewerbliche Beherbergung gelten besondere Brandschutzvorschriften nach der Beherbergungsstättenverordnung des jeweiligen Bundeslandes. Ab bestimmten Größen sind Notbeleuchtung, Fluchtwegbeschilderung und ein Brandschutzkonzept Pflicht.",
    warning: "Verstöße können zur sofortigen Betriebsschließung und persönlicher Haftung führen.",
    checklist: ["Beherbergungsstättenverordnung des Bundeslandes geprüft", "Rauchmelderpflicht erfüllt (jedes Zimmer + Flure)", "Fluchtwegbeschilderung angebracht", "Notbeleuchtung installiert (falls erforderlich)", "Feuerlöscher vorhanden", "Brandschutzgutachten eingeholt (ab >12 Betten oder >2 Etagen)"],
    cityNote: () => null,
  },
  {
    id: "u5", phase: "Gewerbe & Steuern", color: "#7c3aed",
    title: "Gewerbeanmeldung",
    description: "Das kurzfristige Vermieten an Gäste gegen Entgelt gilt als Gewerbebetrieb und muss beim Gewerbeamt (Ordnungsamt) deiner Stadt angemeldet werden. Die Anmeldung kostet meist 20–65 € und dauert wenige Tage.",
    warning: "Ohne Gewerbeanmeldung bist du ordnungswidrig tätig.",
    checklist: ["Gewerbe beim Gewerbeamt / Ordnungsamt angemeldet", "Gewerbeschein erhalten", "Finanzamt automatisch informiert (erfolgt i.d.R. durch Gewerbeamt)"],
    cityNote: () => null,
  },
  {
    id: "u6", phase: "Gewerbe & Steuern", color: "#7c3aed",
    title: "Steuerliche Registrierung",
    description: "Als Beherbergungsbetrieb bist du umsatzsteuerpflichtig: 7 % auf Übernachtungsleistungen. Einnahmen müssen in der Einkommensteuererklärung angegeben werden. Ab ca. 24.500 € Gewinn fällt Gewerbesteuer an.",
    warning: "Viele unterschätzen die Steuerpflicht. Steuerberater frühzeitig einschalten.",
    checklist: ["Fragebogen zur steuerlichen Erfassung beim Finanzamt ausgefüllt", "Umsatzsteuer-ID beantragt", "Steuerberater konsultiert", "Buchhaltungssystem eingerichtet"],
    cityNote: (c) => c?.cityTax && c.cityTax !== "–" ? `City Tax / Übernachtungssteuer: ${c.cityTax} auf den Übernachtungspreis – zusätzlich abzuführen.` : null,
  },
  {
    id: "u7", phase: "Plattform", color: "#059669",
    title: "Städtische Registrierungsnummer",
    description: "Immer mehr deutsche Städte verlangen eine offizielle Registrierungsnummer für Kurzzeitvermietungen. Airbnb ist verpflichtet, diese im Inserat anzuzeigen – ohne Nummer wird das Listing in betroffenen Städten deaktiviert.",
    warning: "Ohne Registrierungsnummer kann Airbnb dein Inserat jederzeit sperren.",
    checklist: ["Geprüft ob Registrierungspflicht in deiner Stadt besteht", "Antrag auf Registrierungsnummer gestellt", "Registrierungsnummer erhalten"],
    cityNote: (c) => c ? (c.registrierung === true ? `Registrierungspflicht: JA — Behörde: ${c.behoerde}` : c.registrierung === false ? "Aktuell keine stadtweite Registrierungspflicht – lokale Regelungen trotzdem prüfen." : `Behörde: ${c.behoerde} – Status lokal prüfen.`) : null,
  },
  {
    id: "u8", phase: "Launch", color: "#16a34a",
    title: "Airbnb-Listing erstellen",
    description: "Erst wenn alle Genehmigungen vorliegen, erstellst du das Listing. Professionelle Fotos und eine klare Beschreibung sind entscheidend für den Start. Beginne mit wettbewerbsfähigen Preisen und erhöhe sie nach ersten Bewertungen.",
    warning: "Kein Listing ohne vollständige Genehmigungen – Airbnb prüft in manchen Städten aktiv.",
    checklist: ["Professionelle Fotos gemacht", "Listing-Text verfasst (Deutsch + Englisch)", "Registrierungsnummer eingetragen (falls erforderlich)", "Preisstrategie und Mindestaufenthalt definiert", "Erste Buchung freigeschaltet"],
    cityNote: () => null,
  },
  {
    id: "u9", phase: "Betrieb", color: "#475569",
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

  const statusColor = { offen: "#94a3b8", aktiv: "#d97706", erledigt: "#16a34a" };
  const statusLabel = { offen: "Offen", aktiv: "In Bearbeitung", erledigt: "Erledigt" };

  return (
    <div>
      <SectionTitle icon="🏛️" title="Umnutzungs-Guideline" sub="Büro → Beherbergung · Schritt-für-Schritt-Leitfaden für Deutschland" />

      <Select label="Deine Stadt" value={u.city} onChange={(v) => setU({ ...u, city: v })}
        options={[{ value: "", label: "Stadt wählen…" }, ...Object.entries(CITY_INFOS).map(([k, v]) => ({ value: k, label: v.name }))]} />

      <div style={{ background: "#f1f5f9", borderRadius: 10, padding: "14px 18px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase" }}>Gesamtfortschritt</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>{progress} %</span>
        </div>
        <div style={{ height: 6, background: "#f8fafc", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #16a34a, #22d3ee)", borderRadius: 3, transition: "width 0.4s ease" }} />
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
          <div key={step.id} style={{ background: "#f1f5f9", borderRadius: 10, marginBottom: 10, border: `1px solid ${isOpen ? step.color + "44" : "#e2e8f0"}`, overflow: "hidden", transition: "border 0.2s" }}>
            <div onClick={() => setExpanded(isOpen ? null : step.id)}
              style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: allDone ? "#15803d22" : "#f8fafc", border: `2px solid ${allDone ? "#16a34a" : step.color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: allDone ? "#16a34a" : step.color }}>
                {allDone ? "✓" : idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: step.color, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2 }}>{step.phase}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{step.title}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: statusColor[st.status], fontWeight: 700 }}>{statusLabel[st.status]}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{doneCl}/{step.checklist.length}</span>
                <span style={{ color: "#94a3b8", fontSize: 10 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: "0 18px 18px", borderTop: "1px solid #f8fafc" }}>
                <p style={{ color: "#475569", fontSize: 13, lineHeight: 1.7, margin: "14px 0 12px" }}>{step.description}</p>

                {step.warning && (
                  <div style={{ background: "#fee2e2", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#fca5a5" }}>
                    ⚠️ {step.warning}
                  </div>
                )}

                {cityNote && (
                  <div style={{ background: "#eff6ff", border: `1px solid ${step.color}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#93c5fd" }}>
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
                        style={{ marginTop: 3, accentColor: "#16a34a", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: st.checklist[i] ? "#94a3b8" : "#94a3b8", textDecoration: st.checklist[i] ? "line-through" : "none", lineHeight: 1.5 }}>{item}</span>
                    </label>
                  ))}
                </div>

                <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Notizen</label>
                <textarea value={st.notes} rows={2}
                  onChange={e => setStep(step.id, { ...st, notes: e.target.value })}
                  placeholder="Eigene Notizen zu diesem Schritt…"
                  style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", color: "#0f172a", fontSize: 13, boxSizing: "border-box", fontFamily: "'DM Mono', monospace", outline: "none", resize: "vertical", lineHeight: 1.5 }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const LOG_CATEGORIES = [
  { id: "allgemein",  label: "Allgemein",   color: "#64748b" },
  { id: "vermieter",  label: "Vermieter",   color: "#2563eb" },
  { id: "behoerde",   label: "Behörde",     color: "#d97706" },
  { id: "handwerker", label: "Handwerker",  color: "#ea580c" },
  { id: "buchung",    label: "Buchung",     color: "#16a34a" },
  { id: "sonstiges",  label: "Sonstiges",   color: "#7c3aed" },
];

function TabKonzept({ p, set }) {
  const k = p.konzept || {};
  const setK = (key) => (val) => set(prev => ({ ...prev, konzept: { ...(prev.konzept || {}), [key]: val } }));
  const sc = calcScenario(p, p.airbnb?.realisticNights ?? 18);
  const totalSetup = (p.setup?.furnitureCost || 0) + (p.setup?.renovationCost || 0) + (p.setup?.otherSetup || 0);

  return (
    <div>
      <SectionTitle icon="📄" title="Konzept für Eigentümer" sub="Professionelles Pitch-Dokument zum Ausdrucken oder als PDF speichern" />

      {/* Betreiber-Kontaktdaten */}
      <div style={{ background: "#ffffff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>Ihre Kontaktdaten (Betreiber)</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Input label="Name / Firma" value={k.betreiberName || ""} onChange={setK("betreiberName")} type="text" half />
          <Input label="E-Mail" value={k.betreiberEmail || ""} onChange={setK("betreiberEmail")} type="text" half />
          <Input label="Telefon" value={k.betreiberTelefon || ""} onChange={setK("betreiberTelefon")} type="text" half />
          <Input label="Adresse (Straße, PLZ Ort)" value={k.betreiberAdresse || ""} onChange={setK("betreiberAdresse")} type="text" half />
        </div>
      </div>

      {/* Preview summary */}
      <div style={{ background: "#ffffff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9", marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>Vorschau — Dokumentinhalt</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {[
            { label: "Objekt", value: p.meta?.name || "—" },
            { label: "Adresse", value: [p.meta?.address, p.meta?.city].filter(Boolean).join(", ") || "—" },
            { label: "Kaltmiete / Monat", value: eur(p.costs?.coldRent) },
            { label: "Kaution", value: eur(p.costs?.deposit) },
            { label: "Betreiber-Investment", value: eur(totalSetup) },
            { label: "Realist. Gewinn / Monat", value: eur(sc.profit) },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Export button */}
      <button
        onClick={() => openKonzept(p)}
        style={{ width: "100%", background: "linear-gradient(135deg, #2563eb, #2563eb)", border: "none", borderRadius: 12, padding: "16px 24px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>
        📄 Konzept öffnen → Als PDF speichern
      </button>
      <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
        Dokument öffnet sich in neuem Tab → Drucken (Cmd+P) → "Als PDF speichern"
      </div>
    </div>
  );
}

function TabLog({ p, set }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("allgemein");
  const [date, setDate] = useState(todayStr());

  const entries = [...(p.log?.entries || [])].sort((a, b) => b.date.localeCompare(a.date));

  const addEntry = () => {
    if (!text.trim()) return;
    const entry = { id: uid(), date, category, text: text.trim() };
    set(prev => ({ ...prev, log: { ...prev.log, entries: [...(prev.log?.entries || []), entry] } }));
    setText("");
    setDate(todayStr());
  };

  const deleteEntry = (id) =>
    set(prev => ({ ...prev, log: { ...prev.log, entries: (prev.log?.entries || []).filter(e => e.id !== id) } }));

  const getCat = (id) => LOG_CATEGORIES.find(c => c.id === id) || LOG_CATEGORIES[0];

  return (
    <div>
      <SectionTitle icon="📝" title="Notizen-Log" sub="Chronologisches Protokoll — Vermieter, Behörden, Handwerker, Buchungen" />

      {/* Input */}
      <div style={{ background: "#ffffff", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <Field label="Datum" half>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ ...inputStyle, fontSize: 13, padding: "8px 12px" }} />
          </Field>
          <Field label="Kategorie" half>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              {LOG_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notiz">
          <textarea value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addEntry(); }}
            placeholder="Was ist passiert? Wer wurde kontaktiert? Was wurde besprochen…"
            rows={3}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={addEntry} disabled={!text.trim()}
            style={{ background: text.trim() ? "#2563eb" : "#f1f5f9", border: "none", borderRadius: 8, padding: "8px 20px", color: text.trim() ? "white" : "#94a3b8", fontSize: 12, cursor: text.trim() ? "pointer" : "default", fontFamily: "'DM Mono', monospace" }}>
            Eintrag speichern
          </button>
          <span style={{ fontSize: 11, color: "#e2e8f0" }}>oder ⌘ + Enter</span>
        </div>
      </div>

      {/* Log entries */}
      {entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#e2e8f0", fontSize: 13 }}>Noch keine Einträge.<br />Protokolliere Gespräche, Entscheidungen und Ereignisse.</div>
      ) : (
        <div style={{ position: "relative" }}>
          {/* Timeline line */}
          <div style={{ position: "absolute", left: 15, top: 0, bottom: 0, width: 2, background: "#f1f5f9" }} />
          {entries.map((e, i) => {
            const cat = getCat(e.category);
            return (
              <div key={e.id} style={{ display: "flex", gap: 16, marginBottom: 16, position: "relative" }}>
                {/* Dot */}
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: cat.color + "22", border: `2px solid ${cat.color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color }} />
                </div>
                {/* Card */}
                <div style={{ flex: 1, background: "#ffffff", borderRadius: 12, padding: "12px 16px", border: "1px solid #f1f5f9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color + "22", borderRadius: 4, padding: "2px 7px", letterSpacing: 1 }}>{cat.label.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'DM Mono', monospace" }}>{fmtDate(e.date)}</span>
                    </div>
                    <span onClick={() => deleteEntry(e.id)} style={{ color: "#e2e8f0", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{e.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const EXPENSE_CATEGORIES = [
  "Kaltmiete", "Nebenkosten", "Internet", "Reinigung", "Supplies & Verbrauch",
  "Versicherung", "Reparatur / Instandhaltung", "Property Management", "Sonstiges",
];

// ─── Tracker Tab ──────────────────────────────────────────────────────────────
function TabTracker({ p, set }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [addType, setAddType] = useState(null);
  const [form, setForm] = useState({ category: EXPENSE_CATEGORIES[0], amount: 0, note: "" });

  const allEntries = p.tracker?.entries || [];
  const entries = allEntries.filter(e => e.month === month);
  const revenues = entries.filter(e => e.type === "revenue");
  const expenses = entries.filter(e => e.type === "expense");
  const totalRevenue = revenues.reduce((s, e) => s + e.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const actualProfit = totalRevenue - totalExpenses;
  const hasData = entries.length > 0;

  const planned = calcScenario(p, p.airbnb.realisticNights);

  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const addEntry = () => {
    if (!form.amount) return;
    const entry = {
      id: uid(), month, type: addType,
      category: addType === "revenue" ? "Airbnb-Einnahme" : form.category,
      amount: +form.amount, note: form.note,
    };
    set(prev => ({ ...prev, tracker: { ...prev.tracker, entries: [...(prev.tracker?.entries || []), entry] } }));
    setForm({ category: EXPENSE_CATEGORIES[0], amount: 0, note: "" });
    setAddType(null);
  };

  const deleteEntry = (id) =>
    set(prev => ({ ...prev, tracker: { ...prev.tracker, entries: (prev.tracker?.entries || []).filter(e => e.id !== id) } }));

  const fmtMonth = (m) => new Date(m + "-15").toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  const histMonths = [...new Set(allEntries.map(e => e.month))].sort().reverse().filter(m => m !== month);

  return (
    <div>
      <SectionTitle icon="💰" title="Ausgaben-Tracker" sub="Ist-Daten erfassen · Geplant vs. Tatsächlich" />

      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, background: "#ffffff", borderRadius: 12, padding: "12px 18px", border: "1px solid #f1f5f9" }}>
        <button onClick={() => shiftMonth(-1)} style={{ background: "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 14px", color: "#475569", cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 16 }}>‹</button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{fmtMonth(month)}</div>
        <button onClick={() => shiftMonth(1)} style={{ background: "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 14px", color: "#475569", cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 16 }}>›</button>
      </div>

      {/* Geplant vs Ist */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#f8fafc", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>📋 Geplant (realistisch)</div>
          <Row label="Einnahmen" value={planned.revenue} green />
          <Row label="Variable Kosten" value={planned.varCosts} minus />
          <Row label="Fixkosten" value={planned.fixedCosts} minus />
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 6, marginTop: 2 }}>
            <Row label="Gewinn" value={planned.profit} bold green={planned.profit >= 0} minus={planned.profit < 0} />
          </div>
        </div>
        <div style={{ background: "#f8fafc", borderRadius: 14, padding: 18, border: `1px solid ${hasData ? (actualProfit >= 0 ? "#16a34a33" : "#dc262633") : "#f1f5f9"}` }}>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12, textTransform: "uppercase" }}>
            {hasData ? "✅ Ist (erfasst)" : "⏳ Ist (keine Daten)"}
          </div>
          {hasData ? (
            <>
              <Row label="Einnahmen" value={totalRevenue} green />
              <Row label="Ausgaben" value={totalExpenses} minus />
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 6, marginTop: 2 }}>
                <Row label="Gewinn" value={actualProfit} bold green={actualProfit >= 0} minus={actualProfit < 0} />
              </div>
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#f1f5f9", borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>Abweichung vom Plan</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: actualProfit >= planned.profit ? "#16a34a" : "#dc2626", fontFamily: "'DM Mono', monospace" }}>
                  {actualProfit >= planned.profit ? "+" : ""}{eur(actualProfit - planned.profit)}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "20px 0", color: "#e2e8f0", fontSize: 12 }}>Buchungen und Ausgaben eintragen um Ist-Daten zu sehen.</div>
          )}
        </div>
      </div>

      {/* Revenues */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", letterSpacing: 1.5, textTransform: "uppercase" }}>📥 Einnahmen</div>
          <button onClick={() => { setAddType("revenue"); setForm({ category: "", amount: 0, note: "" }); }}
            style={{ background: "#f1f5f9", border: "1px solid #16a34a33", borderRadius: 6, padding: "4px 12px", color: "#16a34a", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
            + Einnahme
          </button>
        </div>
        {revenues.length === 0 && <div style={{ fontSize: 12, color: "#e2e8f0", padding: "8px 0" }}>Keine Einnahmen erfasst.</div>}
        {revenues.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#ffffff", borderRadius: 8, marginBottom: 6, border: "1px solid #f1f5f9" }}>
            <div style={{ flex: 1, fontSize: 12, color: "#1e293b" }}>{e.note || e.category}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a", fontFamily: "'DM Mono', monospace" }}>+{eur(e.amount)}</div>
            <span onClick={() => deleteEntry(e.id)} style={{ color: "#e2e8f0", cursor: "pointer", fontSize: 14 }}>✕</span>
          </div>
        ))}
        {revenues.length > 1 && <div style={{ textAlign: "right", fontSize: 12, color: "#16a34a", fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>Gesamt: +{eur(totalRevenue)}</div>}
      </div>

      {/* Expenses */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", letterSpacing: 1.5, textTransform: "uppercase" }}>📤 Ausgaben</div>
          <button onClick={() => { setAddType("expense"); setForm({ category: EXPENSE_CATEGORIES[0], amount: 0, note: "" }); }}
            style={{ background: "#fee2e2", border: "1px solid #dc262633", borderRadius: 6, padding: "4px 12px", color: "#dc2626", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
            + Ausgabe
          </button>
        </div>
        {expenses.length === 0 && <div style={{ fontSize: 12, color: "#e2e8f0", padding: "8px 0" }}>Keine Ausgaben erfasst.</div>}
        {expenses.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#ffffff", borderRadius: 8, marginBottom: 6, border: "1px solid #f1f5f9" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "#1e293b" }}>{e.category}</div>
              {e.note && <div style={{ fontSize: 11, color: "#64748b" }}>{e.note}</div>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#dc2626", fontFamily: "'DM Mono', monospace" }}>−{eur(e.amount)}</div>
            <span onClick={() => deleteEntry(e.id)} style={{ color: "#e2e8f0", cursor: "pointer", fontSize: 14 }}>✕</span>
          </div>
        ))}
        {expenses.length > 1 && <div style={{ textAlign: "right", fontSize: 12, color: "#dc2626", fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>Gesamt: −{eur(totalExpenses)}</div>}
      </div>

      {/* Add form */}
      {addType && (
        <div style={{ background: "#ffffff", borderRadius: 14, padding: 18, border: `1px solid ${addType === "revenue" ? "#16a34a44" : "#dc262644"}`, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: addType === "revenue" ? "#16a34a" : "#dc2626", letterSpacing: 1.5, marginBottom: 14, textTransform: "uppercase" }}>
            {addType === "revenue" ? "Einnahme erfassen" : "Ausgabe erfassen"}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {addType === "expense" && (
              <Field label="Kategorie" half>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  style={{ ...inputStyle, cursor: "pointer" }}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <Input label="Betrag (€)" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} half={addType === "expense"} prefix="€" />
            <Input label={addType === "revenue" ? "Notiz (z.B. Buchung, Gäste)" : "Notiz (optional)"} value={form.note} onChange={v => setForm(f => ({ ...f, note: v }))} type="text" />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button onClick={addEntry}
              style={{ background: addType === "revenue" ? "#f1f5f9" : "#fee2e2", border: `1px solid ${addType === "revenue" ? "#16a34a" : "#dc2626"}`, borderRadius: 8, padding: "8px 20px", color: addType === "revenue" ? "#16a34a" : "#dc2626", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
              Speichern
            </button>
            <button onClick={() => setAddType(null)}
              style={{ background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 16px", color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {histMonths.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, marginBottom: 10, textTransform: "uppercase" }}>📅 Verlauf</div>
          {histMonths.slice(0, 6).map(m => {
            const me = allEntries.filter(e => e.month === m);
            const mr = me.filter(e => e.type === "revenue").reduce((s, e) => s + e.amount, 0);
            const mx = me.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
            const mp = mr - mx;
            return (
              <div key={m} onClick={() => setMonth(m)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#ffffff", borderRadius: 8, border: "1px solid #f1f5f9", cursor: "pointer", marginBottom: 6 }}>
                <div style={{ fontSize: 12, color: "#475569" }}>{fmtMonth(m)}</div>
                <div style={{ display: "flex", gap: 16, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                  <span style={{ color: "#16a34a" }}>+{eur(mr)}</span>
                  <span style={{ color: "#dc2626" }}>−{eur(mx)}</span>
                  <span style={{ color: mp >= 0 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{mp >= 0 ? "+" : ""}{eur(mp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Portfolio Tab ────────────────────────────────────────────────────────────
function TabPortfolio({ properties }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const fmtMonth = (m) => new Date(m + "-15").toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  if (properties.length === 0) {
    return (
      <div>
        <SectionTitle icon="🏦" title="Portfolio-Dashboard" sub="Alle Objekte auf einen Blick" />
        <div style={{ background: "#f1f5f9", borderRadius: 10, padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Noch keine Objekte gespeichert.<br />Erstelle ein Objekt und speichere es.
        </div>
      </div>
    );
  }

  const toData = (p) => {
    const real  = calcScenario(p, p.airbnb.realisticNights);
    const pess  = calcScenario(p, p.airbnb.pessimisticNights);
    const opt   = calcScenario(p, p.airbnb.optimisticNights);
    const entries = (p.tracker?.entries || []).filter(e => e.month === currentMonth);
    const actualRev = entries.filter(e => e.type === "revenue").reduce((s, e) => s + e.amount, 0);
    const actualExp = entries.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
    const hasActual = entries.length > 0;
    const pb = (() => {
      if (!p.project?.phases) return null;
      const all = p.project.phases.flatMap(ph => ph.milestones);
      return all.length > 0 ? Math.round((all.filter(m => m.status === "erledigt").length / all.length) * 100) : 0;
    })();
    const startup = p.costs.deposit + p.setup.furnitureCost + p.setup.renovationCost + p.setup.otherSetup;
    return { p, real, pess, opt, actualRev, actualExp, hasActual, pb, startup };
  };

  const aktiv     = properties.filter(p => p.status === "aktiv").map(toData);
  const watchlist = properties.filter(p => (p.status || "watchlist") === "watchlist").map(toData);

  const totalPlannedProfit  = aktiv.reduce((s, d) => s + d.real.profit, 0);
  const totalCapital        = aktiv.reduce((s, d) => s + d.startup, 0);
  const avgROI              = aktiv.length > 0 ? aktiv.reduce((s, d) => s + d.real.roi, 0) / aktiv.length : 0;
  const propsWithActual     = aktiv.filter(d => d.hasActual);
  const totalActualRev      = propsWithActual.reduce((s, d) => s + d.actualRev, 0);
  const totalActualExp      = propsWithActual.reduce((s, d) => s + d.actualExp, 0);
  const totalActualProfit   = totalActualRev - totalActualExp;

  const PropertyCard = ({ p, real, pess, opt, actualRev, actualExp, hasActual, pb, startup }) => {
    const actualProfit = actualRev - actualExp;
    return (
      <div style={{ background: "#ffffff", borderRadius: 16, padding: 20, border: `1px solid ${p.status === "aktiv" ? "#f1f5f9" : "#f1f5f9"}`, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 3 }}>{p.meta.name || "Unbenannt"}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>{p.meta.city || "—"} · {p.meta.sqm} m² · {p.meta.rooms} Zi.</div>
      </div>
      {/* 3 scenarios */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        {[
          { label: "🔴 Pess.", value: pess.profit, nights: pess.nights },
          { label: "🟡 Real.", value: real.profit, nights: real.nights },
          { label: "🟢 Opt.",  value: opt.profit,  nights: opt.nights  },
        ].map((s, i) => (
          <div key={i} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: s.value >= 0 ? "#16a34a" : "#dc2626", fontFamily: "'DM Mono', monospace" }}>{eur(s.value)}</div>
            <div style={{ fontSize: 9, color: "#94a3b8" }}>{s.nights} N.</div>
          </div>
        ))}
      </div>
      {/* Actual this month */}
      {hasActual ? (
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 14px", border: `1px solid ${actualProfit >= 0 ? "#16a34a33" : "#dc262633"}` }}>
          <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>Ist · {new Date(currentMonth + "-15").toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
            <span style={{ color: "#16a34a" }}>+{eur(actualRev)}</span>
            <span style={{ color: "#dc2626" }}>−{eur(actualExp)}</span>
            <span style={{ color: actualProfit >= 0 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{actualProfit >= 0 ? "+" : ""}{eur(actualProfit)}</span>
          </div>
          <div style={{ fontSize: 10, color: actualProfit >= real.profit ? "#16a34a" : "#dc2626", marginTop: 4 }}>
            {actualProfit >= real.profit ? "▲ " : "▼ "}{eur(Math.abs(actualProfit - real.profit))} vs. Plan
          </div>
        </div>
      ) : p.status === "aktiv" ? (
        <div style={{ fontSize: 11, color: "#e2e8f0", textAlign: "center" }}>Noch keine Ist-Daten für diesen Monat</div>
      ) : null}
      {/* KPI row */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "#64748b" }}>Break-even</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#d97706", fontFamily: "'DM Mono', monospace" }}>{real.beNights} N./Mo.</div>
        </div>
        <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "#64748b" }}>Kapital</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", fontFamily: "'DM Mono', monospace" }}>{eur(startup)}</div>
        </div>
        {real.paybackMonths && (
          <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>Amortis.</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", fontFamily: "'DM Mono', monospace" }}>{real.paybackMonths} Mo.</div>
          </div>
        )}
      </div>
      {/* Project progress */}
      {pb !== null && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>Projektfortschritt</div>
            <div style={{ fontSize: 9, color: pb === 100 ? "#16a34a" : "#64748b", fontWeight: 700 }}>{pb}%</div>
          </div>
          <div style={{ height: 4, background: "#f1f5f9", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pb}%`, background: pb === 100 ? "#16a34a" : "#2563eb", borderRadius: 2, transition: "width 0.3s" }} />
          </div>
        </div>
      )}
    </div>
    );
  };

  return (
    <div>
      <SectionTitle icon="🏦" title="Portfolio-Dashboard" sub={`${aktiv.length} im Betrieb · ${watchlist.length} auf Watchlist`} />

      {/* Top KPIs — nur aktiv */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <KPI label="Im Betrieb" value={aktiv.length} sub={`${watchlist.length} auf Watchlist`} color="#16a34a" />
        <KPI label="Gewinn/Mo. gesamt" value={eur(totalPlannedProfit)} sub="realistisch, nur aktiv" color={totalPlannedProfit >= 0 ? "#16a34a" : "#dc2626"} />
        <KPI label="Kapitaleinsatz" value={eur(totalCapital)} sub="nur aktive Einheiten" color="#d97706" />
        <KPI label="Ø ROI" value={aktiv.length > 0 ? pct(avgROI) : "—"} sub="realistisch, nur aktiv" color={avgROI >= 0 ? "#16a34a" : "#dc2626"} />
      </div>

      {/* This month actual summary */}
      {propsWithActual.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 14, padding: 18, marginBottom: 24, border: "1px solid #2563eb" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", letterSpacing: 1.5, marginBottom: 14, textTransform: "uppercase" }}>
            📅 {new Date(currentMonth + "-15").toLocaleDateString("de-DE", { month: "long", year: "numeric" })} — Ist-Ergebnis ({propsWithActual.length}/{aktiv.length} aktive Einheiten mit Daten)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <KPI label="Ist-Einnahmen" value={eur(totalActualRev)} color="#16a34a" />
            <KPI label="Ist-Ausgaben" value={eur(totalActualExp)} color="#dc2626" />
            <KPI label="Ist-Gewinn" value={eur(totalActualProfit)} color={totalActualProfit >= 0 ? "#16a34a" : "#dc2626"} sub={`Plan: ${eur(totalPlannedProfit)}`} />
          </div>
        </div>
      )}

      {/* Aktive Einheiten */}
      {aktiv.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a" }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", letterSpacing: 1.5, textTransform: "uppercase" }}>Im Betrieb ({aktiv.length})</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {aktiv.map(d => <PropertyCard key={d.p.id} {...d} />)}
          </div>
        </div>
      )}

      {/* Watchlist */}
      {watchlist.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#64748b" }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, textTransform: "uppercase" }}>Watchlist ({watchlist.length}) — nicht in Summen enthalten</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {watchlist.map(d => <PropertyCard key={d.p.id} {...d} />)}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: "stammdaten", label: "Objekt",      icon: "🏢" },
  { id: "kosten",     label: "Kosten",      icon: "💶" },
  { id: "einnahmen",  label: "Einnahmen",   icon: "📈" },
  { id: "auswertung", label: "Auswertung",  icon: "📊" },
  { id: "tracker",    label: "Tracker",     icon: "💰" },
  { id: "log",        label: "Notizen",     icon: "📝" },
  { id: "projekt",    label: "Projektplan", icon: "🗓️" },
  { id: "umnutzung",  label: "Umnutzung",   icon: "🏛️" },
  { id: "konzept",    label: "Konzept",     icon: "📄" },
];

const GLOBAL_VIEWS = [
  { id: "portfolio",   label: "Portfolio",   icon: "🏦" },
  { id: "karte",       label: "Karte",       icon: "🗺️" },
  { id: "mietvertrag", label: "Mietvertrag", icon: "📝" },
];

export default function App() {
  const [properties, setProperties] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [current, setCurrent] = useState(newProperty());
  const [tab, setTab] = useState("stammdaten");
  const [globalView, setGlobalView] = useState(null);
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

  const handleNew = () => { setCurrent(newProperty()); setActiveId(null); setTab("stammdaten"); setGlobalView(null); };
  const handleSelect = (p) => { setCurrent(p); setActiveId(p.id); setTab("stammdaten"); setGlobalView(null); };
  const handleDelete = async (id) => {
    const updated = properties.filter(p => p.id !== id);
    setProperties(updated); await persist(updated);
    if (activeId === id) handleNew();
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.meta || !data.costs) { alert("Ungültige Datei – kein gültiges Einheiten-JSON."); return; }
      const imported = { ...data, id: uid() };
      const updated = [...properties, imported];
      setProperties(updated); await persist(updated);
      handleSelect(imported);
    } catch { alert("Fehler beim Lesen der Datei."); }
    e.target.value = "";
  };

  const projProgress = (p) => {
    if (!p.project?.phases) return null;
    const all = p.project.phases.flatMap(ph => ph.milestones);
    return all.length > 0 ? Math.round((all.filter(m => m.status === "erledigt").length / all.length) * 100) : 0;
  };

  if (!loaded) return <div style={{ background: "#f8fafc", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontFamily: "'DM Mono', monospace" }}>Lade…</div>;

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", background: "#f8fafc", minHeight: "100vh", display: "flex" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />

      {/* Sidebar */}
      <div style={{ width: 224, background: "#f8fafc", borderRight: "1px solid #f1f5f9", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", letterSpacing: 2, marginBottom: 4 }}>PROPERTY</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#0f172a", fontWeight: 800 }}>Analyzer</div>
        </div>

        {/* Global views */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
          {GLOBAL_VIEWS.map(v => (
            <button key={v.id} onClick={() => setGlobalView(v.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: globalView === v.id ? "#f1f5f9" : "transparent", border: `1px solid ${globalView === v.id ? "#e2e8f0" : "transparent"}`, borderRadius: 8, padding: "8px 10px", color: globalView === v.id ? "#0f172a" : "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", marginBottom: 4, transition: "all 0.15s", textAlign: "left" }}>
              <span>{v.icon}</span> {v.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 12, flex: 1, overflowY: "auto" }}>
          {properties.length === 0 && <div style={{ fontSize: 11, color: "#e2e8f0", padding: "8px 0" }}>Noch keine Objekte.</div>}
          {[
            { key: "aktiv",     label: "Im Betrieb", dot: "#16a34a" },
            { key: "watchlist", label: "Watchlist",  dot: "#64748b" },
          ].map(group => {
            const grouped = properties.filter(p => (p.status || "watchlist") === group.key);
            if (grouped.length === 0) return null;
            return (
              <div key={group.key} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#e2e8f0", fontWeight: 700, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: group.dot }} />
                  {group.label}
                </div>
                {grouped.map(p => {
                  const pb = projProgress(p);
                  const isSelected = activeId === p.id && !globalView;
                  return (
                    <div key={p.id} onClick={() => handleSelect(p)}
                      style={{ borderRadius: 8, padding: "10px", marginBottom: 5, cursor: "pointer", background: isSelected ? "#dbeafe" : "transparent", border: `1px solid ${isSelected ? "#2563eb" : "transparent"}`, transition: "all 0.15s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#1e293b", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.meta.name || "Unbenannt"}</span>
                        {pb !== null && <span style={{ fontSize: 10, color: pb === 100 ? "#16a34a" : "#64748b", flexShrink: 0, marginLeft: 4 }}>{pb}%</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{p.meta.city || "—"} · {p.meta.sqm} m²</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{eur(p.costs.coldRent)}/Monat KM</div>
                      {pb !== null && pb > 0 && (
                        <div style={{ height: 2, background: "#f1f5f9", borderRadius: 1, marginTop: 5 }}>
                          <div style={{ height: "100%", width: `${pb}%`, background: pb === 100 ? "#16a34a" : "#2563eb", borderRadius: 1 }} />
                        </div>
                      )}
                      <div onClick={e => { e.stopPropagation(); if (window.confirm(`"${p.meta?.name || "Objekt"}" wirklich löschen?`)) handleDelete(p.id); }} style={{ fontSize: 9, color: "#dc2626", marginTop: 5, cursor: "pointer", opacity: 0.5 }}>✕ löschen</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={handleNew} style={{ width: "100%", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 0", color: "#1e293b", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
            + Neues Objekt
          </button>
          <label style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 0", color: "#475569", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", textAlign: "center", display: "block", boxSizing: "border-box" }}>
            ↑ JSON importieren
            <input type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {globalView ? (
          /* Global view header */
          <div style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9", padding: "12px 24px", display: "flex", alignItems: "center" }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: "#0f172a" }}>
              {GLOBAL_VIEWS.find(v => v.id === globalView)?.icon} {GLOBAL_VIEWS.find(v => v.id === globalView)?.label}
            </span>
          </div>
        ) : (
          /* Property header + tabs */
          <>
            <div style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: "#0f172a" }}>{current.meta.name || "Neues Objekt"}</span>
                {current.meta.city && <span style={{ fontSize: 11, color: "#64748b" }}>{current.meta.zip} {current.meta.city} · {current.meta.sqm} m²</span>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => exportPropertyJson(current)} title="Als JSON exportieren"
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#475569", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
                  ↓ JSON
                </button>
                <button onClick={() => exportPropertyCsv(current)} title="Als CSV exportieren"
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#475569", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>
                  ↓ CSV
                </button>
                <button onClick={handleSave} style={{ background: saved ? "#15803d" : "#2563eb", border: "none", borderRadius: 8, padding: "8px 20px", color: "white", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", transition: "background 0.3s" }}>
                  {saved ? "✓ Gespeichert" : "💾 Speichern"}
                </button>
              </div>
            </div>
            <div style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9", display: "flex", padding: "0 24px" }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ background: "none", border: "none", padding: "12px 16px", color: tab === t.id ? "#16a34a" : "#64748b", borderBottom: tab === t.id ? "2px solid #16a34a" : "2px solid transparent", cursor: "pointer", fontSize: 13, fontFamily: "'DM Mono', monospace", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>
          {globalView === "portfolio"   && <TabPortfolio properties={properties} />}
          {globalView === "karte"       && <TabKarte properties={properties} />}
          {globalView === "mietvertrag" && <TabMietvertrag properties={properties} />}
          {!globalView && tab === "stammdaten" && <TabStammdaten p={current} set={setCurrent} />}
          {!globalView && tab === "kosten"     && <TabKosten p={current} set={setCurrent} />}
          {!globalView && tab === "einnahmen"  && <TabEinnahmen p={current} set={setCurrent} />}
          {!globalView && tab === "auswertung" && <TabAuswertung p={current} />}
          {!globalView && tab === "tracker"    && <TabTracker p={current} set={setCurrent} />}
          {!globalView && tab === "log"        && <TabLog p={current} set={setCurrent} />}
          {!globalView && tab === "projekt"    && <TabProjekt p={current} set={setCurrent} />}
          {!globalView && tab === "umnutzung"  && <TabUmnutzung p={current} set={setCurrent} />}
          {!globalView && tab === "konzept"    && <TabKonzept p={current} set={setCurrent} />}
        </div>
      </div>
    </div>
  );
}
