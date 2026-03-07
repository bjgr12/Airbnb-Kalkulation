# CLAUDE.md – Property Analyzer (Airbnb Arbitrage Tool)

## 🌍 Sprache
- Alle Antworten, Erklärungen und Code-Kommentare **auf Deutsch**
- UI-Texte in der App ebenfalls **auf Deutsch** (bestehende Konvention beibehalten)
- Variablen- und Funktionsnamen auf Englisch

---

## 🧠 Arbeitsweise: Erst planen, dann coden

Bevor du mit der Implementierung beginnst:
1. **Analysiere** die Aufgabe und stelle Rückfragen, wenn etwas unklar ist
2. **Erstelle einen Plan** mit konkreten Schritten (Komponenten, State-Änderungen, neue Felder)
3. **Warte auf Bestätigung** bevor du anfängst zu coden
4. Bei größeren Features: Plan als Checkliste ausgeben und freigeben lassen

---

## 🔨 Implementierung: Kleine Schritte

- **Eine logische Einheit auf einmal** — keine riesigen Änderungen
- Nach jeder Änderung kurz zusammenfassen was sich geändert hat
- Niemals mehrere unabhängige Features in einem Schritt ändern
- Bestehende Konventionen und Muster **immer beibehalten**

---

## ⚙️ Tech Stack

| Was               | Wie                                         |
|-------------------|---------------------------------------------|
| Framework         | **React 18 + Vite**                         |
| Sprache           | **JavaScript** (kein TypeScript)            |
| Styling           | **Inline Styles** (kein Tailwind, kein CSS) |
| Karte             | **Leaflet + react-leaflet**                 |
| Geocoding         | Nominatim (OpenStreetMap)                   |
| Persistenz        | **localStorage** (prop-analyzer-v3)         |
| Fotos             | **IndexedDB** (prop-photos DB)              |
| Fonts             | DM Mono (Code/Zahlen), Playfair Display (Titel) |

**Wichtig:** Keine neuen Dependencies ohne Absprache hinzufügen.

---

## 🎨 Design-System (Dark Theme)

Die App hat ein konsistentes dunkles Farbschema — **immer einhalten**:

```js
// Hintergründe (dunkel → hell)
"#020617"  // Sidebar, Header
"#0f172a"  // Haupt-Hintergrund
"#0a1628"  // Karten/Panels
"#1e293b"  // Trennlinien, Input-Hintergrund
"#334155"  // Borders, deaktivierte Elemente

// Text
"#f1f5f9"  // Primärer Text
"#e2e8f0"  // Sekundärer Text
"#94a3b8"  // Labels
"#64748b"  // Subtexte, deaktiviert
"#475569"  // Sehr dezent

// Signalfarben
"#4ade80"  // Grün: positiv, Gewinn, erledigt
"#f87171"  // Rot: negativ, Verlust, Warnung
"#fbbf24"  // Gelb: aktiv, in Bearbeitung
"#60a5fa"  // Blau: Info, Links, Phase 1
"#a78bfa"  // Lila: Phase 2, Steuern
"#fb923c"  // Orange: Phase 3, Setup
"#34d399"  // Mint: Plattform, Launch
```

---

## 📁 App-Struktur

Aktuell ist alles in **einer Datei** (`App.jsx`). Beim Hinzufügen neuer Features:
- Neue Tab-Komponenten als `TabXyz({ p, set })` implementieren
- Neue globale Views als `TabXyz({ properties })` implementieren
- Hilfsfunktionen oben in der Datei gruppieren
- Shared UI-Komponenten (`Field`, `Input`, `Select`, `KPI`, `Row`, etc.) wiederverwenden

### Bestehende Tabs (pro Objekt)
| ID           | Komponente       | Inhalt                                  |
|--------------|------------------|-----------------------------------------|
| stammdaten   | TabStammdaten    | Objektdaten, Karte, Fotos               |
| kosten       | TabKosten        | Miet-, Betriebs-, Setupkosten           |
| einnahmen    | TabEinnahmen     | Airbnb-Parameter, 3 Szenarien, LZ-Vergleich |
| auswertung   | TabAuswertung    | P&L, ROI, Break-even, Amortisation      |
| tracker      | TabTracker       | Monatlicher Ist-Tracker                 |
| log          | TabLog           | Notizen-Protokoll mit Kategorien        |
| projekt      | TabProjekt       | 5-Phasen-Projektplan mit Meilensteinen  |
| umnutzung    | TabUmnutzung     | Büro → Airbnb Guideline (9 Schritte, DE) |
| konzept      | TabKonzept       | PDF-Export für Eigentümer-Pitch         |

### Globale Views
| ID        | Inhalt                                            |
|-----------|---------------------------------------------------|
| portfolio | Portfolio-Dashboard (alle Objekte, KPIs, Ist-Daten) |
| karte     | Leaflet-Karte aller geokodierten Objekte          |

---

## 🏠 Datenmodell (Property)

```js
{
  id,
  meta:       { name, address, city, zip, type, sqm, rooms, floor, builtYear, condition, notes, lat, lng },
  costs:      { coldRent, nk, deposit, leaseDuration },
  setup:      { furnitureCost, renovationCost, otherSetup, amortMonths },
  operations: { internet, supplies, insurance, management, misc },
  airbnb:     { nightlyRate, platformFee, cleaningFee, avgStay, pessimisticNights, realisticNights, optimisticNights },
  longterm:   { expectedRent, vacancyMonths },
  project:    { phases: [...DEFAULT_PHASES()], projectStart, targetLaunch },
  umnutzung:  { city, steps: {} },
  photos:     [],
  tracker:    { entries: [] },
  log:        { entries: [] },
  konzept:    { betreiberName, betreiberEmail, betreiberTelefon, betreiberAdresse },
  status:     "watchlist" | "aktiv",
}
```

**Neue Felder** immer mit sinnvollen Defaults in `newProperty()` ergänzen.

---

## 🧮 Kernberechnungen

```js
calcScenario(p, nights)  // Vollständige Monatsberechnung für n Nächte
calcLongterm(p)          // Langzeitmiete-Vergleich
```

Berechnungslogik **nicht in Komponenten** — immer in separaten Funktionen oben in der Datei.

---

## 📋 Code-Konventionen

```js
// State-Update Pattern
set(prev => ({ ...prev, [section]: { ...prev[section], [key]: val } }))

// Shorthand-Updater in Tabs
const u = (s, k) => v => set(prev => ({ ...prev, [s]: { ...prev[s], [k]: v } }))

// IDs
uid()        // zufällige 7-stellige ID
todayStr()   // "YYYY-MM-DD"

// Formatierung
eur(n)       // "1.234 €" (de-DE, 0 Dezimalstellen)
pct(n)       // "12.3 %"

// localStorage-Key: "prop-analyzer-v3" — NICHT ändern
```

---

## 🇩🇪 Fachdomäne: Airbnb Arbitrage (Deutschland)

Das Tool deckt den **gesamten Lifecycle** eines Airbnb-Arbitrage-Projekts ab:

- Objekt ist **gemietet** (nicht gekauft) und an Gäste **untervermietet**
- Fokus auf **deutschen Markt**: Zweckentfremdungsverbot, Registrierungspflichten, Gewerbesteuer
- Schwerpunkt auf **Büro/Gewerbe → Beherbergung** (Nutzungsänderung)
- Break-even, ROI und Amortisation sind entscheidende KPIs
- Alle Geldbeträge in **EUR**, alle Datumstexte in **Deutsch** (de-DE Locale)
- Unterstützte Städte in `CITY_INFOS`: Berlin, München, Hamburg, Frankfurt, Köln, Stuttgart, Düsseldorf, Nürnberg, Leipzig, Dresden

---

## 🚫 Was Claude NICHT tun soll

- `localStorage`-Key `"prop-analyzer-v3"` **nicht ändern** (bricht bestehende Nutzerdaten)
- Kein TypeScript einführen
- Kein Tailwind, kein externes CSS-Framework
- Keine Dateistruktur aufsplitten ohne explizite Anfrage
- Keine neuen npm-Packages ohne Begründung und Absprache
- Nicht einfach drauflos coden — immer kurzen Plan vorher ausgeben
