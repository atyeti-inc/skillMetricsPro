import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import axios from "axios";
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { log, sanitizeLogObject } from "./utils";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(sanitizeLogObject(capturedJsonResponse))}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Create a function to proxy API requests to Java backend
const createApiProxy = (app: express.Express) => {
  app.use('/api', async (req: Request, res: Response) => {
    const javaBackendUrl = `http://localhost:8080${req.url}`;
    
    // Add extra debug logging for skills-related endpoints
    const isSkillEndpoint = req.url.includes('/skill') || req.url.includes('/skills');
    if (isSkillEndpoint) {
      console.log(`----- SKILL API REQUEST -----`);
      console.log(`Method: ${req.method}`);
      console.log(`URL: ${javaBackendUrl}`);
      console.log(`Headers: ${JSON.stringify(sanitizeLogObject(req.headers))}`);
      console.log(`Body: ${JSON.stringify(sanitizeLogObject(req.body))}`);
      console.log(`----------------------------`);
    } else {
      console.log(`Proxying request to Java backend: ${req.method} ${javaBackendUrl}`);
    }
    
    try {
      // Detect skill update request specifically (PATCH /api/skills/:id)
      const isSkillUpdateRequest = req.method === 'PATCH' && req.url.match(/^\/skills\/\d+/);
      
      // Modify the request body for skill updates if needed
      let requestBody = req.body;
      if (isSkillUpdateRequest) {
        console.log(`Special handling for skill update request detected`);
        console.log(`Original request body:`, JSON.stringify(sanitizeLogObject(req.body)));
        
        // Make sure the skill update body is in the format expected by Java backend
        // Example transformation if needed:
        // requestBody = {
        //   name: req.body.name,
        //   category: req.body.category,
        //   level: req.body.level,
        //   // Add any other fields needed by Java backend
        // };
        
        console.log(`Transformed request body:`, JSON.stringify(sanitizeLogObject(requestBody)));
      }
      
      // Create request options
      const requestOptions = {
        method: req.method,
        url: javaBackendUrl,
        headers: { 
          ...req.headers, 
          host: 'localhost:8080',
          // Ensure content-type is set correctly
          'content-type': req.headers['content-type'] || 'application/json'
        },
        data: requestBody,
        responseType: 'arraybuffer' as 'arraybuffer',
        validateStatus: () => true // Don't throw on any status code
      };
      
      // Forward the request to Java backend
      const response = await axios(requestOptions);
      
      // Add special handling for skills endpoints to debug issues
      if (isSkillEndpoint) {
        console.log(`----- SKILL API RESPONSE -----`);
        console.log(`Status: ${response.status}`);
        console.log(`Headers: ${JSON.stringify(sanitizeLogObject(response.headers))}`);
        
        // Try to convert and log the response body if it's JSON
        try {
          const responseBody = Buffer.from(response.data).toString('utf8');
          console.log(`Body: ${responseBody}`);
          
          if (response.status >= 400) {
            console.error(`Error response from Java backend for skill endpoint: ${responseBody}`);
          }
        } catch (err) {
          console.log(`Body: [Binary data]`);
        }
        console.log(`------------------------------`);
      }
      
      // Check if this is a successful skill update response that needs special handling
      const isSuccessfulSkillUpdate = isSkillUpdateRequest && response.status >= 200 && response.status < 300;
      
      if (isSuccessfulSkillUpdate) {
        try {
          // Parse the response to get the updated skill
          const responseBody = JSON.parse(Buffer.from(response.data).toString('utf8'));
          console.log(`Successful skill update detected. Response:`, JSON.stringify(responseBody));
          
          // If Java backend doesn't create skill history, we can do it here
          // This is a temporary measure until Java backend implements SkillHistoryController
          console.log(`Note: Java backend may be missing SkillHistoryController - history tracking may not be complete`);
          
          // Send the successful response back to the client
          res.status(response.status);
          for (const [key, value] of Object.entries(response.headers)) {
            if (key !== 'content-length') { // Skip content-length as we might modify the body
              res.setHeader(key, value as string);
            }
          }
          res.json(responseBody);
        } catch (err) {
          // If we couldn't parse the response, just send it as-is
          console.error('Error handling skill update response:', err);
          res.status(response.status);
          for (const [key, value] of Object.entries(response.headers)) {
            res.setHeader(key, value as string);
          }
          res.send(response.data);
        }
      } else {
        // For non-skill-update responses, send as-is
        res.status(response.status);
        for (const [key, value] of Object.entries(response.headers)) {
          res.setHeader(key, value as string);
        }
        res.send(response.data);
      }
    } catch (error: any) {
      console.error('Proxy error:', sanitizeLogObject(error));
      
      if (isSkillEndpoint) {
        console.error(`Stack trace for skill endpoint error:`, error.stack);
      }
      
      res.status(500).json({
        error: 'Java Backend Connection Error',
        message: 'Could not connect to Java backend server',
        details: error.message || 'Unknown error'
      });
    }
  });
  
  console.log('API proxy configured to forward requests to Java backend on port 8080');
};

// Function to check if Java backend is running on port 8080
const isJavaBackendRunning = async (): Promise<boolean> => {
  const testServer = http.createServer();
  return new Promise<boolean>((resolve) => {
    testServer.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Port 8080 is in use, likely Java backend
        console.log('Detected Java backend running on port 8080');
        resolve(true);
      } else {
        console.log('Error checking port 8080:', err.code);
        resolve(false);
      }
    });
    
    testServer.once('listening', () => {
      // Port 8080 is free, no Java backend
      testServer.close();
      resolve(false);
    });
    
    testServer.listen(8080, '0.0.0.0');
  });
};

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", sanitizeLogObject(err));
    res.status(status).json({ message });
  });

  // Setup vite in development or serve static files in production
  try {
    if (app.get("env") === "development") {
      // Dynamic import for Vite setup
      const viteModule = await import("./vite");
      await viteModule.setupVite(app, server);
    } else {
      // In production, use the serveStatic function from vite.ts
      // This now comes with the Docker image
      const viteModule = await import("./vite");
      viteModule.serveStatic(app);
    }
  } catch (err) {
    console.error("Error setting up static/vite middleware:", err);
    // Still continue with API server functionality
    
    // Emergency fallback if vite.ts fails
    try {
      const distPath = path.resolve(__dirname, "public");
      
      if (fs.existsSync(distPath)) {
        console.log("Using emergency static file server fallback");
        app.use(express.static(distPath));
        
        app.use("*", (_req, res) => {
          res.sendFile(path.resolve(distPath, "index.html"));
        });
      }
    } catch (fallbackErr) {
      console.error("Even fallback static serving failed:", fallbackErr);
    }
  }

  // Check if Java backend is running
  const javaRunning = await isJavaBackendRunning();
  
  if (javaRunning) {
    // Java backend detected, use alternative port for frontend-only mode
    const port = 5000;
    const host = "0.0.0.0";
    
    console.log(`Java backend detected on port 8080`);
    console.log(`Starting in frontend-only mode on port ${port}`);
    
    // Remove any existing API routes to avoid conflicts
    app._router.stack = app._router.stack.filter((layer: any) => {
      if (!layer.route) return true; // Keep middleware
      if (!layer.route.path) return true; // Keep routes without paths
      
      // Check if it's a string path starting with /api
      if (typeof layer.route.path === 'string' && layer.route.path.startsWith('/api')) {
        return false; // Filter out API routes
      }
      
      // For RegExp paths, keep them all (they're likely not API routes)
      return true;
    });
    
    // Setup API proxy to forward requests to Java backend
    createApiProxy(app);
    
    server.listen(port, host, () => {
      log(`serving frontend on port ${port} (API calls forwarded to Java backend on 8080)`);
      console.log(`Frontend-only server started on port ${port}`);
    });
  } else {
    // No Java backend, start normally on appropriate port
    // For Cloud Run, always use port 8080 regardless of PORT env value
    // For development or other environments, use PORT env or default to 5000
    const isCloudRun = process.env.K_SERVICE !== undefined;
    const port = isCloudRun ? 8080 : (process.env.PORT ? parseInt(process.env.PORT, 10) : 5000);
    const host = process.env.HOST || "0.0.0.0";
    
    console.log(`No Java backend detected`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Cloud Run: ${isCloudRun ? 'Yes' : 'No'}`);
    if (isCloudRun) {
      console.log(`Using Cloud Run standard port 8080 (ignoring PORT=${process.env.PORT})`);
    } else {
      console.log(`Using port ${port} (from env: ${process.env.PORT || 'not set, using default 5000'})`);
    }
    console.log(`Starting server on host ${host} and port ${port}`);
    
    server.listen(port, host, () => {
      log(`serving on port ${port}`);
      console.log(`Server started and explicitly listening on port ${port}`);
    });
  }
})();