import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/geocode", async (req, res) => {
    const { query, language } = req.body;
    try {
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      // Fast Geocoding via Open-Meteo
      const meteoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=20&language=${language || 'ru'}`);
      if (!meteoRes.ok) throw new Error('Open-Meteo API error');
      const meteoData = await meteoRes.json();
      
      const rawResults = Array.isArray(meteoData?.results) ? meteoData.results : [];
      const seen = new Set();
      const deduped = [];
      
      const getTypeFromFeatureCode = (code: string) => {
        if (!code) return "Город";
        if (code.startsWith("PPLC") || code.startsWith("PPLA")) return language === 'ru' ? "Город" : "City";
        if (code === "PPLX" || code === "PPL") return language === 'ru' ? "Поселок" : "Town";
        return language === 'ru' ? "Деревня" : "Village";
      };
      
      for (const item of rawResults) {
        if (!item) continue;
        
        // Filter out POIs and non-populated places using feature_code (Open-Meteo uses GeoNames codes)
        // PPL* codes are populated places. Exclude others if any sneak in.
        if (item.feature_code && !item.feature_code.startsWith('PPL')) continue;
        
        const key = `${item.name}-${item.admin1 || ''}-${item.country || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push({
            name: item.name,
            type: getTypeFromFeatureCode(item.feature_code),
            region: item.admin1 || item.admin2 || '',
            country: item.country,
            country_code: item.country_code,
            timezone: item.timezone,
            lat: item.latitude,
            lng: item.longitude,
            population: item.population || 0
          });
        }
      }
      
      // Sort primarily by population
      deduped.sort((a, b) => b.population - a.population);
      
      // Return top 10 results max
      res.json({ query, results: deduped.slice(0, 10) });
    } catch (error: any) {
      console.error("Geocoding failed:", error);
      res.status(500).json({ error: "Geocoding failed", results: [] });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
