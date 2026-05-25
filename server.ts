import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini API client safely
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// CAD Redefine Sketch Endpoint using Gemini
app.post("/api/redefine-sketch", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY || !ai) {
      return res.status(500).json({
        error: "Gemini API key is not configured in environment variables."
      });
    }

    const { prompt, currentSketch } = req.body;

    const systemInstruction = `You are a precise 2D CAD Geometric Engine Assistant.
Your task is to redefine, modify, or add geometric entities to a 2D CAD sketch based on a user's instruction (which can be in English or Turkish).
You must output an updated 2D CAD sketch with correct coordinates and types.

Definitions:
- All coordinates and dimensions are in millimeters (mm).
- The sketch consists of:
  1. "finalPoints": Array of Points representing the main closed or open profile chain.
     Each point has form: { x: number, y: number, circleData?: { center: { x: number, y: number }, radius: number } }
     If a point has "circleData", it designates a full circle centered at "center" with the given "radius".
  2. "paths": Array of Point Arrays, representing secondary shapes, holes, axes, or paths.
  3. "isClosed": Boolean, whether the main profile chain is closed.

Rules & Math Guidelines:
1. Preserve unchanged parts of the sketch unless the prompt requests to change, move, or replace them.
2. Calculate coordinates precisely using geometric math.
   - For example, if asked to add a circle of radius 15 at the center, add a point to 'paths' with circleData center at (0,0) and radius 15.
   - If asked to add a square/rectangle, append the vertices to 'paths'. For a 40x40 square centered at origin, vertices are: (-20,-20), (20,-20), (20,20), (-20,20). Make sure to close the path by appending the first vertex as the last element of the list to make it a closed loop.
   - If asked to add a HEXAGON (altıgen) of side length S (e.g. "kenar uzunluğu 15 olan altıgen" / "iki kenar uzunluğu 15 olan altıgen" - meaning a regular hexagon with side length of 15 mm), the outer radius (R) from center to each vertex is equal to the side length, R = S = 15.
     The vertices centered at origin (0,0) are calculated as: (R * cos(A), R * sin(A)) for angles A = 0, 60, 120, 180, 240, 300 degrees.
     In radians:
     - p0: (15, 0)
     - p1: (7.5, 12.99)
     - p2: (-7.5, 12.99)
     - p3: (-15, 0)
     - p4: (-7.5, -12.99)
     - p5: (7.5, -12.99)
     - p6: (15, 0) (to close the path!)
     Append this list of points to the 'paths' array.
   - Support Turkish CAD command terminology:
     - "altıgen ekle" -> Add a regular hexagon.
     - "kenar uzunluğu 15 olan" / "kenarı 15 olan" / "iki kenar uzunluğu 15 olan" -> regular hexagon with side length of 15mm.
     - "orjin" / "merkez" -> Center it at (0,0).
     - "daire/çember ekle" -> Add circle points.
     - "köşeleri yuvarla" -> apply fillet (recalculate vertex coordinates).
3. Keep coordinates realistic and cleanly centered or aligned to references. Do not hallucinate unnecessary points or noise.
`;

    const userPrompt = `
Current Sketch State:
${JSON.stringify(currentSketch, null, 2)}

User Instruction:
"${prompt}"

Please respond with the updated 2D CAD sketch keeping precise parametric relationships and clean coordinates.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["isClosed", "finalPoints", "paths"],
          properties: {
            isClosed: {
              type: Type.BOOLEAN,
              description: "Whether the main profile is a closed loop."
            },
            finalPoints: {
              type: Type.ARRAY,
              description: "The primary drawing chain points.",
              items: {
                type: Type.OBJECT,
                required: ["x", "y"],
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  circleData: {
                    type: Type.OBJECT,
                    required: ["center", "radius"],
                    properties: {
                      center: {
                        type: Type.OBJECT,
                        required: ["x", "y"],
                        properties: {
                          x: { type: Type.NUMBER },
                          y: { type: Type.NUMBER }
                        }
                      },
                      radius: { type: Type.NUMBER }
                    }
                  }
                }
              }
            },
            paths: {
              type: Type.ARRAY,
              description: "A list of separate drawing paths/shapes.",
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["x", "y"],
                  properties: {
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    circleData: {
                      type: Type.OBJECT,
                      required: ["center", "radius"],
                      properties: {
                        center: {
                          type: Type.OBJECT,
                          required: ["x", "y"],
                          properties: {
                            x: { type: Type.NUMBER },
                            y: { type: Type.NUMBER }
                          }
                        },
                        radius: { type: Type.NUMBER }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const text = response.text || "{}";
    const updatedSketch = JSON.parse(text);
    return res.json({ success: true, sketch: updatedSketch });
  } catch (error: any) {
    console.error("Gemini sketch error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to process AI refine request" });
  }
});

// Serve Vite dev server in development, static files in production
async function startServer() {
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
