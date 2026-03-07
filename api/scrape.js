export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL fehlt" });

  let html;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    html = await response.text();
  } catch {
    return res.status(500).json({ error: "Seite konnte nicht geladen werden" });
  }

  try {
    const data = extractData(url, html);
    return res.status(200).json(data);
  } catch {
    return res.status(500).json({ error: "Daten konnten nicht extrahiert werden" });
  }
}

function extractData(url, html) {
  const result = {};

  // ── JSON-LD ────────────────────────────────────────────────────────────────
  const ldMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const json = JSON.parse(m[1].trim());
      const objs = Array.isArray(json) ? json : [json];
      for (const obj of objs) {
        const t = obj["@type"] || "";
        if (/RealEstate|Apartment|House|Residence|Product|ItemPage|Offer/i.test(t)) {
          mergeJsonLd(result, obj);
        }
        if (obj["@graph"]) {
          for (const g of obj["@graph"]) mergeJsonLd(result, g);
        }
      }
    } catch {}
  }

  // ── Plattform-spezifisch ───────────────────────────────────────────────────
  if (url.includes("kleinanzeigen.de") || url.includes("ebay-kleinanzeigen.de")) {
    extractKleinanzeigen(result, html);
  } else if (url.includes("immobilienscout24.de")) {
    extractImmoScout(result, html);
  } else if (url.includes("immowelt.de")) {
    extractImmowelt(result, html);
  }

  // ── Meta-Tags als Fallback ─────────────────────────────────────────────────
  if (!result.name) {
    const og = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    if (og) result.name = clean(og[1]);
    else {
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (title) result.name = clean(title[1]);
    }
  }

  return result;
}

function mergeJsonLd(result, obj) {
  if (!result.name && obj.name) result.name = clean(obj.name);
  const price = obj.offers?.price || obj.price || obj.offers?.lowPrice;
  if (!result.coldRent && price) result.coldRent = toNumber(price);
  const addr = obj.address;
  if (addr) {
    if (!result.address && addr.streetAddress) result.address = clean(addr.streetAddress);
    if (!result.city && addr.addressLocality) result.city = clean(addr.addressLocality);
    if (!result.zip && addr.postalCode) result.zip = clean(addr.postalCode);
  }
  if (!result.sqm) {
    const sqm = obj.floorSize?.value || obj.floorSize;
    if (sqm) result.sqm = toNumber(sqm);
  }
  if (!result.rooms) {
    const rooms = obj.numberOfRooms || obj.numberOfBedrooms;
    if (rooms) result.rooms = toNumber(rooms);
  }
}

function extractKleinanzeigen(result, html) {
  if (!result.coldRent) {
    const p = html.match(/class="[^"]*price[^"]*"[^>]*>[\s\S]*?([\d.,]+)\s*€/i)
      || html.match(/"price"\s*:\s*"?([\d.,]+)"?/i);
    if (p) result.coldRent = toNumber(p[1]);
  }
  const attrs = [...html.matchAll(/<li[^>]*class="[^"]*addetailsitem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const a of attrs) {
    const text = stripTags(a[1]);
    if (!result.sqm && /wohnfläche|m²|qm/i.test(text)) {
      const n = text.match(/([\d.,]+)/);
      if (n) result.sqm = toNumber(n[1]);
    }
    if (!result.rooms && /zimmer/i.test(text)) {
      const n = text.match(/([\d.,]+)/);
      if (n) result.rooms = toNumber(n[1]);
    }
    if (!result.floor && /etage|stockwerk/i.test(text)) {
      const n = text.match(/([\d]+)/);
      if (n) result.floor = parseInt(n[1]);
    }
  }
  if (!result.city) {
    const loc = html.match(/<span[^>]*class="[^"]*breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/span>/gi);
    if (loc && loc.length > 1) result.city = clean(stripTags(loc[loc.length - 1]));
  }
}

function extractImmoScout(result, html) {
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*(?:window|<\/script>)/);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const expose = findDeep(state, "realEstate") || findDeep(state, "expose");
      if (expose) {
        if (!result.name && expose.title) result.name = clean(expose.title);
        if (!result.sqm && expose.livingSpace) result.sqm = toNumber(expose.livingSpace);
        if (!result.rooms && expose.numberOfRooms) result.rooms = toNumber(expose.numberOfRooms);
        if (!result.coldRent && expose.price?.value) result.coldRent = toNumber(expose.price.value);
        if (!result.nk && expose.serviceCharge) result.nk = toNumber(expose.serviceCharge);
        if (!result.deposit && expose.deposit) result.deposit = toNumber(expose.deposit);
        if (!result.floor && expose.floor) result.floor = parseInt(expose.floor);
        const addr = expose.address;
        if (addr) {
          if (!result.address && addr.street) result.address = clean(`${addr.street} ${addr.houseNumber || ""}`.trim());
          if (!result.city && addr.city) result.city = clean(addr.city);
          if (!result.zip && addr.postcode) result.zip = clean(addr.postcode);
        }
      }
    } catch {}
  }
  if (!result.coldRent) {
    const p = html.match(/Kaltmiete[\s\S]{0,300}?([\d.]+(?:,\d+)?)\s*€/i);
    if (p) result.coldRent = toNumber(p[1]);
  }
  if (!result.nk) {
    const p = html.match(/Nebenkosten[\s\S]{0,300}?([\d.]+(?:,\d+)?)\s*€/i);
    if (p) result.nk = toNumber(p[1]);
  }
  if (!result.sqm) {
    const p = html.match(/([\d]+(?:,\d+)?)\s*m²/i);
    if (p) result.sqm = toNumber(p[1]);
  }
  if (!result.rooms) {
    const p = html.match(/([\d.,]+)\s*Zimmer/i);
    if (p) result.rooms = toNumber(p[1]);
  }
}

function extractImmowelt(result, html) {
  const dataMatch = html.match(/window\.__REDUX_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (dataMatch) {
    try {
      const state = JSON.parse(dataMatch[1]);
      const expose = findDeep(state, "expose") || findDeep(state, "realEstate");
      if (expose) {
        if (!result.name && expose.title) result.name = clean(expose.title);
        if (!result.sqm && expose.area) result.sqm = toNumber(expose.area);
        if (!result.rooms && expose.rooms) result.rooms = toNumber(expose.rooms);
        if (!result.coldRent && expose.price?.value) result.coldRent = toNumber(expose.price.value);
        if (!result.nk && expose.additionalCosts) result.nk = toNumber(expose.additionalCosts);
        if (!result.deposit && expose.deposit) result.deposit = toNumber(expose.deposit);
        const addr = expose.address || expose.location;
        if (addr) {
          if (!result.address && addr.street) result.address = clean(`${addr.street} ${addr.houseNumber || ""}`.trim());
          if (!result.city && (addr.city || addr.locality)) result.city = clean(addr.city || addr.locality);
          if (!result.zip && (addr.zipCode || addr.postalCode)) result.zip = clean(addr.zipCode || addr.postalCode);
        }
      }
    } catch {}
  }
  if (!result.coldRent) {
    const p = html.match(/Kaltmiete[\s\S]{0,300}?([\d.]+(?:,\d+)?)\s*€/i);
    if (p) result.coldRent = toNumber(p[1]);
  }
  if (!result.sqm) {
    const p = html.match(/([\d]+(?:,\d+)?)\s*m²/i);
    if (p) result.sqm = toNumber(p[1]);
  }
  if (!result.rooms) {
    const p = html.match(/([\d.,]+)\s*Zimmer/i);
    if (p) result.rooms = toNumber(p[1]);
  }
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────
function clean(s) { return String(s).replace(/\s+/g, " ").trim(); }
function stripTags(s) { return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function toNumber(s) {
  const n = parseFloat(String(s).replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return isNaN(n) ? undefined : n;
}
function findDeep(obj, key, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== "object") return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findDeep(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}
