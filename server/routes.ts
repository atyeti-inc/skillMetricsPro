import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { pool } from "./db";
import * as schema from "@shared/schema";
import { scheduleWeeklyReport, sendImmediateWeeklyReport } from "./email";
import {
  insertSkillSchema,
  insertSkillHistorySchema,
  insertSkillHistoryV2Schema,
  insertProfileHistorySchema,
  insertEndorsementSchema,
  insertEndorsementV2Schema,
  insertNotificationSchema,
  insertPendingSkillUpdateSchema,
  insertPendingSkillUpdateV2Schema,
  Skill,
  insertSkillTargetSchema,
  insertSkillTemplateSchema,
  insertSkillCategorySchema,
  insertSkillApproverSchema,
  SkillCategory,
  SkillApprover,
  insertReportSettingsSchema,
  ReportSettings,
  insertUserSkillSchema,
  UserSkill,
  insertProjectSkillSchema,
  insertProjectSkillV2Schema,
  ProjectSkill,
  ProjectSkillV2
} from "@shared/schema";

// Direct database check for admin status
async function checkIsUserAdminDirectly(userId: number): Promise<boolean> {
  try {
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return false;
    
    const dbValue = result.rows[0]?.is_admin;
    // PostgreSQL returns boolean values in different formats
    return dbValue === true || dbValue === 't' || dbValue === 'true';
  } catch (error) {
    console.error("Error checking admin status directly:", error);
    return false;
  }
}

// Helper function to check if a user is an admin from the user object
function isUserAdmin(user: any): boolean {
  if (!user) return false;
  
  // Convert any user object to have consistent properties
  const userObj = user as {
    id?: number;
    is_admin?: boolean | string;
    isAdmin?: boolean | string;
  };
  
  // Check both camelCase and snake_case properties
  const adminValue = 
    userObj.isAdmin !== undefined ? userObj.isAdmin : 
    userObj.is_admin !== undefined ? userObj.is_admin : 
    false;
  
  // Handle different formats PostgreSQL might return
  if (adminValue === true) return true;
  if (typeof adminValue === 'string') {
    const lowerValue = adminValue.toLowerCase();
    return lowerValue === 't' || lowerValue === 'true';
  }
  
  return false;
}

// Helper function to check if a user is a project lead for a specific project
async function isUserProjectLead(userId: number, projectId: number): Promise<boolean> {
  if (!userId || !projectId) return false;
  
  try {
    const project = await storage.getProject(projectId);
    if (!project) return false;
    
    // Check if user is either the lead or delivery lead for this project
    return project.leadId === userId || project.deliveryLeadId === userId;
  } catch (error) {
    console.error(`Error checking if user ${userId} is a project lead for project ${projectId}:`, error);
    return false;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Import project-related schemas for validation
  const { 
    insertClientSchema, 
    insertProjectSchema, 
    insertProjectResourceSchema,
    insertProjectSkillSchema,
    insertProjectSkillV2Schema,
    insertProjectResourceHistorySchema
  } = schema;
  // Set up authentication routes
  setupAuth(app);
  
  // Initialize weekly report scheduler
  scheduleWeeklyReport();
  
  // Health check endpoints for testing and deployment verification
  app.get(["/health", "/status", "/api/health"], async (req, res) => {
    try {
      // Test database connection
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      // Get database connection type
      const dbUrl = process.env.DATABASE_URL || '';
      const isCloudSql = process.env.CLOUD_SQL_URL && process.env.CLOUD_SQL_URL.includes('/cloudsql/');
      const connectionType = isCloudSql ? 'cloud_sql' : 
                            dbUrl.includes('neon.tech') ? 'neon' : 
                            'standard_postgres';
      
      res.status(200).json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        database: "connected",
        connection_type: connectionType,
        environment: process.env.NODE_ENV || 'development',
        use_cloud_sql: process.env.USE_CLOUD_SQL === 'true',
        version: process.env.npm_package_version || '1.0.0',
        server_time: new Date().toISOString()
      });
    } catch (error) {
      console.error("Health check error:", error);
      res.status(500).json({ 
        status: "error", 
        timestamp: new Date().toISOString(),
        database: "disconnected",
        environment: process.env.NODE_ENV || 'development',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Root endpoint that will serve the frontend
  app.get("/", (req, res, next) => {
    // Let Vite handle serving the frontend
    next();
  });
  
  // Status endpoint for deployment verification (moved from root)
  app.get("/server-status", (req, res) => {
    res.send(`
      <html>
        <head>
          <title>SkillMetrics API Server Status</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.6; }
            .container { max-width: 800px; margin: 0 auto; }
            h1 { color: #333; }
            .card { border: 1px solid #ddd; border-radius: 4px; padding: 20px; margin-bottom: 20px; }
            .success { color: green; }
            .error { color: red; }
            code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>SkillMetrics API Server Status</h1>
            <div class="card">
              <h2>Server Status</h2>
              <p class="success">✅ Server is running</p>
              <p>Environment: ${process.env.NODE_ENV || 'development'}</p>
              <p>Server Time: ${new Date().toISOString()}</p>
            </div>
            <div class="card">
              <h2>API Status</h2>
              <p>Check health endpoints: <a href="/health">/health</a> or <a href="/status">/status</a></p>
            </div>
          </div>
        </body>
      </html>
    `);
  });

  // Middleware to ensure user is authenticated
  const ensureAuth = (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ 
        message: "Authentication required", 
        details: "You must be logged in to access this resource",
        errorCode: "AUTH_REQUIRED"
      });
    }
    next();
  };
  
  // Middleware to ensure user is admin
  const ensureAdmin = async (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      console.log("Admin check failed - user not authenticated");
      return res.status(403).json({ 
        message: "Authentication required", 
        details: "You must be logged in to access this resource",
        errorCode: "AUTH_REQUIRED"
      });
    }
    
    // First try the user object from the session
    const sessionAdminCheck = isUserAdmin(req.user);
    
    // If that fails, do a direct database check (more reliable)
    if (!sessionAdminCheck) {
      const userId = req.user!.id;
      const directAdminCheck = await checkIsUserAdminDirectly(userId);
      
      console.log("Admin check details:");
      console.log("- User ID:", req.user?.id, "isAdmin:", req.user?.isAdmin);
      console.log("- Session check result:", sessionAdminCheck);
      console.log("- Direct DB check result:", directAdminCheck);
      console.log("- isAdmin value:", req.user?.isAdmin, "type:", typeof req.user?.isAdmin);
      console.log("- is_admin value:", req.user?.is_admin, "type:", typeof req.user?.is_admin);
      
      if (!directAdminCheck) {
        console.log("Admin check failed for user:", req.user?.email || req.user?.username);
        return res.status(403).json({ 
          message: "Admin privileges required", 
          details: "This action requires administrator privileges",
          errorCode: "ADMIN_REQUIRED"
        });
      }
    }
    
    console.log("Admin check passed for user:", req.user?.email || req.user?.username);
    next();
  };
  
  // Middleware to ensure user is either admin or project lead for a specific project
  const ensureAdminOrProjectLead = async (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      console.log("Admin/Project Lead check failed - user not authenticated");
      return res.status(403).json({ 
        message: "Authentication required", 
        details: "You must be logged in to access this resource",
        errorCode: "AUTH_REQUIRED"
      });
    }
    
    // Check if the user is an admin first (fastest path)
    const userId = req.user!.id;
    const isAdmin = isUserAdmin(req.user) || await checkIsUserAdminDirectly(userId);
    
    if (isAdmin) {
      // Admin users can access all projects
      console.log(`Access granted - User ${userId} is an administrator`);
      return next();
    }
    
    // If not admin, get the project ID based on the URL pattern
    let projectId: number | null = null;
    
    if (req.params.id) {
      const pathId = parseInt(req.params.id);
      
      // URL pattern: /api/projects/:id
      if (req.path.match(/^\/api\/projects\/\d+$/)) {
        projectId = pathId;
      } 
      // URL pattern: /api/projects/:id/resources or /api/projects/:id/skills
      else if (req.path.match(/^\/api\/projects\/\d+\/(resources|skills)$/)) {
        projectId = pathId;
      }
      // URL pattern: /api/projects/resources/:id
      else if (req.path.match(/^\/api\/projects\/resources\/\d+$/)) {
        try {
          const resource = await storage.getProjectResource(pathId);
          if (resource) {
            projectId = resource.projectId;
          }
        } catch (error) {
          console.error(`Error getting project resource ${pathId}:`, error);
        }
      }
      // URL pattern: /api/projects/skills/:id
      else if (req.path.match(/^\/api\/projects\/skills\/\d+$/)) {
        try {
          // Get all project skills
          const projectSkills = await storage.getAllProjectSkills();
          // Find the one with the matching ID
          const skill = projectSkills.find(s => s.id === pathId);
          if (skill) {
            projectId = skill.projectId;
          }
        } catch (error) {
          console.error(`Error getting project skill ${pathId}:`, error);
        }
      }
    }
    
    if (!projectId) {
      console.log("Could not determine project ID from request path:", req.path);
      return res.status(400).json({ 
        message: "Invalid request", 
        details: "Could not determine which project this request applies to",
        errorCode: "INVALID_PROJECT_REQUEST"
      });
    }
    
    // Check if the user is a project lead for this project
    const isProjectLead = await isUserProjectLead(userId, projectId);
    
    if (!isProjectLead) {
      console.log(`Access denied - User ${userId} is neither admin nor project lead for project ${projectId}`);
      return res.status(403).json({ 
        message: "Access denied", 
        details: "You must be an administrator or project lead to access this resource",
        errorCode: "PROJECT_LEAD_REQUIRED"
      });
    }
    
    // User is a project lead for this project
    console.log(`Access granted - User ${userId} is a project lead for project ${projectId}`);
    next();
  };
  
  // Middleware to ensure user is a super admin (admin@atyeti.com)
  const ensureSuperAdmin = async (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      console.log("Super admin check failed - user not authenticated");
      return res.status(403).json({ 
        message: "Authentication required", 
        details: "You must be logged in to access this resource",
        errorCode: "AUTH_REQUIRED"
      });
    }
    
    // Check if user is admin first
    const isAdmin = isUserAdmin(req.user) || await checkIsUserAdminDirectly(req.user!.id);
    
    if (!isAdmin) {
      console.log("Super admin check failed - user is not an admin:", req.user?.email || req.user?.username);
      return res.status(403).json({ 
        message: "Admin privileges required", 
        details: "This action requires administrator privileges",
        errorCode: "ADMIN_REQUIRED"
      });
    }
    
    // Check if user is the super admin (admin@atyeti.com)
    const isSuperAdmin = req.user!.email === "admin@atyeti.com";
    
    if (!isSuperAdmin) {
      console.log("Super admin check failed - user is not the super admin:", req.user?.email);
      return res.status(403).json({ 
        message: "Super admin privileges required", 
        details: "This action can only be performed by the super administrator (admin@atyeti.com)",
        errorCode: "SUPER_ADMIN_REQUIRED"
      });
    }
    
    console.log("Super admin check passed for user:", req.user?.email);
    next();
  };
  
  // Middleware to ensure user is either an admin or an approver
  const ensureApprover = async (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      console.log("Approver check failed - user not authenticated");
      return res.status(403).json({ 
        message: "Authentication required", 
        details: "You must be logged in to access this resource",
        errorCode: "AUTH_REQUIRED"
      });
    }
    
    const userId = req.user!.id;
    
    // First, check if user is an admin (admins can do anything approvers can)
    const isAdmin = isUserAdmin(req.user) || await checkIsUserAdminDirectly(userId);
    
    if (isAdmin) {
      console.log("Approver check passed (admin) for user:", req.user?.email || req.user?.username);
      return next();
    }
    
    // If not admin, check if user is an approver
    const isApprover = await storage.isUserApprover(userId);
    
    if (!isApprover) {
      console.log("Approver check failed for user:", req.user?.email || req.user?.username);
      return res.status(403).json({ 
        message: "Approver privileges required", 
        details: "This action requires approver privileges",
        errorCode: "APPROVER_REQUIRED"
      });
    }
    
    console.log("Approver check passed for user:", req.user?.email || req.user?.username);
    next();
  };

  // Check if current user is an approver
  app.get("/api/user/is-approver", ensureAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const userEmail = req.user?.email || 'unknown';
      
      console.log(`[APPROVER CHECK] Checking if user ${userId} (${userEmail}) is an approver...`);
      
      // First check if the user is an admin
      const isAdmin = isUserAdmin(req.user) || await checkIsUserAdminDirectly(userId);
      
      if (isAdmin) {
        // Admins have all approver permissions
        console.log(`[APPROVER CHECK] User ${userId} is an admin, returning true for is-approver check`);
        return res.json(true);
      }
      
      // If not admin, check if user is an approver
      // Add debug query to check the approver table directly
      const approverDebugQuery = `SELECT COUNT(*) FROM skill_approvers WHERE user_id = $1`;
      const debugResult = await pool.query(approverDebugQuery, [userId]);
      const approverCount = parseInt(debugResult.rows[0].count);
      
      console.log(`[APPROVER CHECK] User ${userId} has ${approverCount} approver assignments in the database`);
      
      // Now call the storage function
      const isApprover = await storage.isUserApprover(userId);
      
      console.log(`[APPROVER CHECK] Final result for user ${userId} (${userEmail}): ${isApprover}`);
      
      // Return the result as a boolean
      res.json(isApprover);
    } catch (error) {
      console.error("[APPROVER CHECK] Error checking approver status:", error);
      res.status(500).json({ 
        message: "Error checking approver status", 
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Check if current user is a project lead for a specific project
  app.get("/api/user/is-project-lead/:projectId", ensureAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }
      
      const userId = req.user!.id;
      const userEmail = req.user?.email || 'unknown';
      
      console.log(`[PROJECT LEAD CHECK] Checking if user ${userId} (${userEmail}) is a project lead for project ${projectId}...`);
      
      // Check if user is a super admin first (they can do everything)
      const isSuperAdmin = req.user!.email === "admin@atyeti.com";
      
      // Check if user is a regular admin (to distinguish in frontend)
      const isAdmin = isUserAdmin(req.user) || await checkIsUserAdminDirectly(userId);
      
      // Check if user is a project lead for this project
      const isLead = await isUserProjectLead(userId, projectId);
      
      // A user has edit permissions if they are either a super admin or a project lead
      const canEdit = isSuperAdmin || isLead;
      
      console.log(`[PROJECT LEAD CHECK] Result for user ${userId} (${userEmail}): isSuperAdmin=${isSuperAdmin}, isAdmin=${isAdmin}, isProjectLead=${isLead}, canEdit=${canEdit}`);
      
      return res.json({ 
        isProjectLead: isLead,
        isAdmin: isAdmin,
        isSuperAdmin: isSuperAdmin,
        canEdit: canEdit
      });
    } catch (error) {
      console.error(`[PROJECT LEAD CHECK] Error checking project lead status:`, error);
      res.status(500).json({ 
        message: "Failed to check project lead status", 
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // User profile routes
  app.get("/api/user/profile", ensureAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: "Error fetching profile", error });
    }
  });
  
  // Get a specific user's profile by ID (for viewing other users)
  app.get("/api/users/:userId", ensureAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: "Error fetching user profile", error });
    }
  });
  
  // Get a specific user's skills by userId
  app.get("/api/users/:userId/skills", ensureAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get skills from user_skills table (no more fallback to legacy table)
      const userSkills = await storage.getUserSkillsV2(userId);
      
      // This returns skills in a compatible format for API consistency
      console.log(`Returning ${userSkills.length} skills for user ${userId} from user_skills table`);
      res.json(userSkills);
    } catch (error) {
      console.error("Error in /api/users/:userId/skills endpoint:", error);
      res.status(500).json({ message: "Error fetching user skills", error });
    }
  });
  
  // Get a specific user's skill history by userId
  app.get("/api/users/:userId/skills/history", ensureAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Only use the new function for combined schema queries
      const combinedHistory = await storage.getUserSkillHistoryFromAllSources(userId);
      console.log(`Returning ${combinedHistory.length} skill history entries for user ${userId} from all sources`);
      return res.json(combinedHistory);
      
      /* Legacy code commented out - no longer needed as we now use combined query
      const skillHistory = await storage.getUserSkillHistory(userId);
      console.log(`Returning ${skillHistory.length} skill history entries for user ${userId}`);
      res.json(skillHistory);
      */
    } catch (error) {
      console.error(`Error in /api/users/${req.params.userId}/skills/history endpoint:`, error);
      res.status(500).json({ message: "Error fetching user skill history", error });
    }
  });

  app.patch("/api/user/profile", ensureAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Create profile history for each changed field
      const updateData: Partial<typeof user> = {};
      
      // Directly check database for current admin status
      const userCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
      // Convert PostgreSQL boolean representation to JS boolean
      const dbValue = userCheck.rows[0]?.is_admin;
      const isAdmin = dbValue === true || dbValue === 't' || dbValue === 'true';
      
      console.log("Admin status from database (raw):", dbValue);
      console.log("Admin status from database (type):", typeof dbValue);
      console.log("Admin status converted to boolean:", isAdmin);
      console.log("User object fetched for ID:", user.id);
      console.log("User object is_admin property:", user.is_admin);
      
      // Track changes for history
      for (const [key, value] of Object.entries(req.body)) {
        if (key in user && key !== 'id' && key !== 'password' && key !== 'is_admin' && user[key as keyof typeof user] !== value) {
          const oldValue = user[key as keyof typeof user]?.toString() || '';
          const newValue = value?.toString() || '';
          
          // Add to update data
          if (typeof value !== 'undefined' && value !== null) {
            (updateData as any)[key] = value;
          }
          
          // Create history entry
          await storage.createProfileHistory({
            userId,
            changedField: key,
            previousValue: oldValue,
            newValue
          });
        }
      }
      
      if (Object.keys(updateData).length > 0) {
        // Always preserve the admin flag by including it specifically as isAdmin
        // This will be properly converted to is_admin in storage.ts
        (updateData as any).isAdmin = isAdmin;
        
        console.log("Update data with preserved admin flag:", updateData);
        
        const updatedUser = await storage.updateUser(userId, updateData);
        res.json(updatedUser);
      } else {
        res.json(user);
      }
    } catch (error) {
      res.status(500).json({ message: "Error updating profile", error });
    }
  });

  app.get("/api/user/profile/history", ensureAuth, async (req, res) => {
    try {
      const history = await storage.getUserProfileHistory(req.user!.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Error fetching profile history", error });
    }
  });
  
  // The approver check endpoint is now defined above

  // Skills routes
  app.get("/api/skills", ensureAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      // Using the new adapter function that converts user_skills to the old format
      // This allows us to use the new database schema with the old API endpoints
      const skills = await storage.getUserSkillsV2(userId);
      
      console.log(`Returning ${skills.length} skills for user ${userId} in legacy format`);
      res.json(skills);
    } catch (error) {
      console.error("Error in /api/skills endpoint:", error);
      res.status(500).json({ message: "Error fetching skills", error });
    }
  });
  
  // User Skills routes (new schema with skill templates)
  app.get("/api/user-skills", ensureAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const skills = await storage.getUserSkillsByUser(userId);
      res.json(skills);
    } catch (error) {
      res.status(500).json({ message: "Error fetching user skills", error });
    }
  });
  
  // Get a specific user skill by ID
  app.get("/api/user-skills/:id", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      if (isNaN(skillId)) {
        return res.status(400).json({ message: "Invalid skill ID" });
      }
      
      const skill = await storage.getUserSkillById(skillId);
      if (!skill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Check if the user is authorized to view this skill
      const userId = req.user!.id;
      if (skill.userId !== userId && !isUserAdmin(req.user)) {
        return res.status(403).json({ message: "You do not have permission to view this skill" });
      }
      
      res.json(skill);
    } catch (error) {
      res.status(500).json({ message: "Error fetching skill", error });
    }
  });
  
  // Create a new user skill
  app.post("/api/user-skills", ensureAuth, async (req, res) => {
    try {
      // Parse and validate the request body
      const userSkillData = insertUserSkillSchema.parse({
        ...req.body,
        userId: req.user!.id // Override the userId with the current user's ID
      });
      
      // Create the skill
      const skill = await storage.createUserSkill(userSkillData);
      
      // Create initial skill history
      await storage.createSkillHistory({
        skillId: skill.id,
        userId: req.user!.id,
        previousLevel: null, // New skill
        newLevel: skill.level,
        changeNote: "Initial skill creation"
      });
      
      res.status(201).json(skill);
    } catch (error) {
      console.error("Error creating user skill:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid skill data", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating skill", error });
    }
  });
  
  // Update a user skill
  app.patch("/api/user-skills/:id", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      if (isNaN(skillId)) {
        return res.status(400).json({ message: "Invalid skill ID" });
      }
      
      // Check if the skill exists
      const existingSkill = await storage.getUserSkillById(skillId);
      if (!existingSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Check if the user is authorized to update this skill
      const userId = req.user!.id;
      if (existingSkill.userId !== userId && !isUserAdmin(req.user)) {
        return res.status(403).json({ message: "You do not have permission to update this skill" });
      }
      
      // Create a copy of the request body without changeNote for skill update
      const { changeNote, ...skillUpdateData } = req.body;
      
      // If level is changed, record history
      if (skillUpdateData.level && skillUpdateData.level !== existingSkill.level) {
        await storage.createSkillHistory({
          skillId,
          userId: req.user!.id,
          previousLevel: existingSkill.level,
          newLevel: skillUpdateData.level,
          changeNote: changeNote || `Updated from ${existingSkill.level} to ${skillUpdateData.level}`
        });
      }
      
      // Update the skill
      const updatedSkill = await storage.updateUserSkill(skillId, skillUpdateData);
      
      res.json(updatedSkill);
    } catch (error) {
      console.error("Error updating user skill:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid skill data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating skill", error });
    }
  });
  
  // Delete a user skill
  app.delete("/api/user-skills/:id", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      if (isNaN(skillId)) {
        return res.status(400).json({ message: "Invalid skill ID" });
      }
      
      // Check if the skill exists
      const existingSkill = await storage.getUserSkillById(skillId);
      if (!existingSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Check if the user is authorized to delete this skill
      const userId = req.user!.id;
      if (existingSkill.userId !== userId && !isUserAdmin(req.user)) {
        return res.status(403).json({ message: "You do not have permission to delete this skill" });
      }
      
      // Delete the skill
      await storage.deleteUserSkill(skillId);
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user skill:", error);
      res.status(500).json({ message: "Error deleting skill", error });
    }
  });
  
  // Get all user skills (admin only)
  app.get("/api/admin/user-skills", ensureAdmin, async (req, res) => {
    try {
      const skills = await storage.getAllUserSkills();
      res.json(skills);
    } catch (error) {
      res.status(500).json({ message: "Error fetching all user skills", error });
    }
  });

  app.post("/api/skills", ensureAuth, async (req, res) => {
    try {
      const parsedData = insertSkillSchema.safeParse({
        ...req.body,
        userId: req.user!.id
      });
      
      if (!parsedData.success) {
        return res.status(400).json({ 
          message: "Invalid skill data", 
          errors: parsedData.error.format() 
        });
      }
      
      const skill = await storage.createSkill(parsedData.data);
      
      // Create initial skill history
      await storage.createSkillHistory({
        skillId: skill.id,
        userId: req.user!.id,
        previousLevel: null, // New skill
        newLevel: skill.level,
        changeNote: "Initial skill creation"
      });
      
      res.status(201).json(skill);
    } catch (error) {
      res.status(500).json({ message: "Error creating skill", error });
    }
  });

  app.get("/api/skills/:id", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      
      // Get the skill from the user_skills table only (no more fallback)
      const userSkill = await storage.getUserSkillById(skillId);
      
      if (!userSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Convert to legacy format for API consistency
      const legacySkill = storage.userSkillToLegacySkill(userSkill);
      
      // Ensure user owns the skill or is admin
      if (legacySkill.userId !== req.user!.id && !isUserAdmin(req.user)) {
        return res.status(403).json({ 
          message: "Access denied", 
          details: "You can only access skills that you own or as an administrator", 
          errorCode: "NOT_SKILL_OWNER" 
        });
      }
      
      console.log(`Returning user skill ${skillId} in legacy format`);
      res.json(legacySkill);
    } catch (error) {
      console.error("Error in /api/skills/:id endpoint:", error);
      res.status(500).json({ message: "Error fetching skill", error });
    }
  });

  app.patch("/api/skills/:id", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      
      // Get user skill by ID (no more fallback to legacy)
      const userSkill = await storage.getUserSkillById(skillId);
      
      if (!userSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Ensure user owns the skill or is admin
      if (userSkill.userId !== req.user!.id && !isUserAdmin(req.user)) {
        return res.status(403).json({ 
          message: "Access denied", 
          details: "You can only update skills that you own or as an administrator", 
          errorCode: "NOT_SKILL_OWNER" 
        });
      }
      
      // Create a copy of the request body without changeNote for skill update
      const { changeNote, ...skillUpdateData } = req.body;
      
      // If level is changed, record history
      if (skillUpdateData.level && skillUpdateData.level !== userSkill.level) {
        await storage.createSkillHistoryV2({
          userSkillId: skillId,
          userId: req.user!.id,
          previousLevel: userSkill.level,
          newLevel: skillUpdateData.level,
          changeNote: changeNote || `Updated from ${userSkill.level} to ${skillUpdateData.level}`
        });
      }
      
      // Update the user skill
      const updatedUserSkill = await storage.updateUserSkill(skillId, skillUpdateData);
      
      // Convert to legacy format for API consistency
      const legacySkill = storage.userSkillToLegacySkill(updatedUserSkill);
      
      console.log(`Updated user skill ${skillId} and returning in legacy format`);
      res.json(legacySkill);
    } catch (error) {
      console.error("Error in /api/skills/:id PATCH endpoint:", error);
      res.status(500).json({ message: "Error updating skill", error });
    }
  });

  app.delete("/api/skills/:id", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      
      // Get user skill by ID (no more fallback to legacy)
      const userSkill = await storage.getUserSkillById(skillId);
      
      if (!userSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Ensure user owns the skill or is admin
      if (userSkill.userId !== req.user!.id && !isUserAdmin(req.user)) {
        return res.status(403).json({ 
          message: "Access denied", 
          details: "You can only delete skills that you own or as an administrator", 
          errorCode: "NOT_SKILL_OWNER" 
        });
      }
      
      console.log(`Deleting user skill ${skillId}`);
      await storage.deleteUserSkill(skillId);
      res.status(204).send();
    } catch (error) {
      console.error("Error in /api/skills/:id DELETE endpoint:", error);
      res.status(500).json({ message: "Error deleting skill", error });
    }
  });

  app.get("/api/skills/:id/history", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      
      // Get user skill by ID (no more fallback to legacy)
      const userSkill = await storage.getUserSkillById(skillId);
      
      if (!userSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Ensure user owns the skill or is admin
      if (userSkill.userId !== req.user!.id && !isUserAdmin(req.user)) {
        return res.status(403).json({ 
          message: "Access denied", 
          details: "You can only view skill history for skills that you own or as an administrator", 
          errorCode: "NOT_SKILL_OWNER" 
        });
      }
      
      // Get history from the skill_histories table
      const history = await storage.getSkillHistory(skillId);
      console.log(`Found ${history.length} history entries for user skill ${skillId}`);
      res.json(history);
    } catch (error) {
      console.error("Error in /api/skills/:id/history endpoint:", error);
      res.status(500).json({ message: "Error fetching skill history", error });
    }
  });

  app.get("/api/user/skills/history", ensureAuth, async (req, res) => {
    try {
      // Only use the new function for combined schema queries
      const combinedHistory = await storage.getUserSkillHistoryFromAllSources(req.user!.id);
      console.log(`Returning ${combinedHistory.length} skill history entries for user ${req.user!.id} from all sources`);
      return res.json(combinedHistory);
      
      /* Legacy code commented out - no longer needed as we now use combined query
      const history = await storage.getUserSkillHistory(req.user!.id);
      console.log(`Returning ${history.length} skill history entries for user ${req.user!.id}`);
      res.json(history);
      */
    } catch (error) {
      console.error("Error in /api/user/skills/history endpoint:", error);
      res.status(500).json({ message: "Error fetching skill history", error });
    }
  });
  
  // Global organization-wide skill history (for all users to view global activity)
  app.get("/api/org/skills/history", ensureAuth, async (req, res) => {
    try {
      // Only use the new function for combined schema queries
      const combinedHistory = await storage.getAllSkillHistoriesFromAllSources();
      console.log(`Returning ${combinedHistory.length} global skill history entries from all sources`);
      return res.json(combinedHistory);
      
      /* Legacy code commented out - no longer needed as we now use combined query
      const history = await storage.getAllSkillHistories();
      console.log(`Returning ${history.length} global skill history entries from legacy source`);
      res.json(history);
      */
    } catch (error) {
      console.error("Error in /api/org/skills/history endpoint:", error);
      res.status(500).json({ message: "Error fetching global skill history", error });
    }
  });

  // All users directory (accessible to all authenticated users)
  app.get("/api/users", ensureAuth, async (req, res) => {
    try {
      let users;
      
      // Check for client or project filters
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      
      if (clientId) {
        // Filter users by client
        users = await storage.getUsersByClientId(clientId);
      } else if (projectId) {
        // Filter users by project
        users = await storage.getUsersByProjectId(projectId);
      } else {
        // Get all users
        users = await storage.getAllUsers();
      }
      
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Error fetching users", error });
    }
  });
  
  // Get all skills (for organization dashboard)
  app.get("/api/all-skills", async (req, res) => {
    try {
      // Only use the user_skills table
      const userSkills = await storage.getAllUserSkills();
      
      // Convert to legacy format for backward compatibility
      const legacySkills = userSkills.map(us => storage.userSkillToLegacySkill(us));
      
      console.log(`Returning ${legacySkills.length} skills from user_skills table for dashboard`);
      return res.json(legacySkills);
      
      /* Legacy code commented out - no longer needed as we now use new schema only
      const skills = await storage.getAllSkills();
      console.log(`Returning ${skills.length} skills from legacy skills table for dashboard`);
      res.json(skills);
      */
    } catch (error) {
      console.error("Error in /api/all-skills endpoint:", error);
      res.status(500).json({ message: "Error fetching all skills", error });
    }
  });
  
  // Get all skill templates for project skill assignment
  app.get("/api/skill-templates", ensureAuth, async (req, res) => {
    try {
      const templates = await storage.getAllSkillTemplates();
      console.log(`Returning ${templates.length} skill templates for project skill assignment`);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching skill templates:", error);
      res.status(500).json({ message: "Error fetching skill templates", error });
    }
  });
  
  // Get skill template by ID
  app.get("/api/skill-templates/:id", ensureAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid skill template ID" });
      }
      
      const template = await storage.getSkillTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Skill template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error(`Error fetching skill template with ID ${req.params.id}:`, error);
      res.status(500).json({ message: "Error fetching skill template", error });
    }
  });
  
  // Get all skills (for activity feed)
  app.get("/api/skills/all", ensureAuth, async (req, res) => {
    try {
      // Only use the user_skills table
      const userSkills = await storage.getAllUserSkills();
      
      // Convert to legacy format for backward compatibility
      const legacySkills = userSkills.map(us => storage.userSkillToLegacySkill(us));
      
      console.log(`Returning ${legacySkills.length} skills from user_skills table for activity feed`);
      return res.json(legacySkills);
      
      /* Legacy code commented out - no longer needed as we now use new schema only
      const skills = await storage.getAllSkills();
      console.log(`Returning ${skills.length} skills from legacy skills table for activity feed`);
      res.json(skills);
      */
    } catch (error) {
      console.error("Error in /api/skills/all endpoint:", error);
      res.status(500).json({ message: "Error fetching all skills", error });
    }
  });

  // Admin routes
  
  // Get report scheduler status
  app.get("/api/admin/reports/weekly-resource-report/status", ensureAdmin, async (req, res) => {
    try {
      // Calculate the next scheduled run
      const now = new Date();
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + ((7 - now.getDay() + 1) % 7 || 7)); // Get next Monday
      nextMonday.setHours(9, 0, 0, 0); // Set to 9:00 AM
      
      // If the calculated time is in the past, add 7 days
      if (nextMonday <= now) {
        nextMonday.setDate(nextMonday.getDate() + 7);
      }
      
      res.status(200).json({
        isScheduled: true,
        nextReportTime: nextMonday.toISOString(),
        salesEmailRecipient: process.env.SALES_TEAM_EMAIL || "sales@skillsplatform.com",
        mailjetConfigured: !!(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY)
      });
    } catch (error) {
      console.error("Error getting report scheduler status:", error);
      res.status(500).json({ 
        message: "Error checking report scheduler status",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Send an immediate weekly resource report (for testing)
  app.post("/api/admin/reports/weekly-resource-report/send", ensureAdmin, async (req, res) => {
    try {
      const { reportSettingId } = req.body;
      
      console.log("Manually triggering weekly resource report...",
        reportSettingId ? `using report setting ID: ${reportSettingId}` : "using default settings");
      
      const success = await sendImmediateWeeklyReport(reportSettingId ? parseInt(reportSettingId) : undefined);
      
      if (success) {
        res.status(200).json({ 
          message: "Weekly resource report sent successfully",
          timestamp: new Date().toISOString(),
          reportSettingId: reportSettingId || null
        });
      } else {
        res.status(500).json({ 
          message: "Error sending weekly resource report",
          error: "See server logs for details" 
        });
      }
    } catch (error) {
      console.error("Error in weekly report endpoint:", error);
      res.status(500).json({ 
        message: "Error sending weekly resource report", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });
  
  // Alternate endpoint for sending reports (for backward compatibility)
  app.post("/api/admin/send-report-now", ensureAdmin, async (req, res) => {
    try {
      // This endpoint doesn't expect a body - use default settings
      console.log("Manually triggering weekly resource report through simplified endpoint...");
      
      const success = await sendImmediateWeeklyReport();
      
      if (success) {
        res.status(200).json({ 
          message: "Weekly resource report sent successfully",
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({ 
          message: "Error sending weekly resource report",
          error: "See server logs for details" 
        });
      }
    } catch (error) {
      console.error("Error in simplified weekly report endpoint:", error);
      res.status(500).json({ 
        message: "Error sending weekly resource report", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });
  
  // Report endpoint that accepts a specific reportSettingId in the URL
  app.post("/api/admin/send-report-now/:id", ensureAdmin, async (req, res) => {
    try {
      const reportSettingId = parseInt(req.params.id);
      
      if (isNaN(reportSettingId)) {
        return res.status(400).json({ message: "Invalid report setting ID" });
      }
      
      console.log("Manually triggering weekly resource report for setting ID:", reportSettingId);
      
      const success = await sendImmediateWeeklyReport(reportSettingId);
      
      if (success) {
        res.status(200).json({ 
          message: "Weekly resource report sent successfully",
          timestamp: new Date().toISOString(),
          reportSettingId
        });
      } else {
        res.status(500).json({ 
          message: "Error sending weekly resource report",
          error: "See server logs for details" 
        });
      }
    } catch (error) {
      console.error("Error in report-by-id endpoint:", error);
      res.status(500).json({ 
        message: "Error sending weekly resource report", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });
  
  // Test endpoint for resource skills report
  app.get("/api/admin/test-skills-report", ensureAdmin, async (req, res) => {
    try {
      console.log("Testing weekly report with resource skills data...");
      
      // Use the first report setting (ID=1) or take ID from query parameter
      const reportSettingId = req.query.id ? parseInt(req.query.id as string) : 1;
      
      if (req.query.id && isNaN(reportSettingId)) {
        return res.status(400).json({ message: "Invalid report setting ID in query parameter" });
      }
      
      const success = await sendImmediateWeeklyReport(reportSettingId);
      
      if (success) {
        res.status(200).json({ 
          message: "Weekly resource report sent successfully",
          timestamp: new Date().toISOString(),
          reportSettingId
        });
      } else {
        res.status(500).json({ 
          message: "Error sending weekly resource report",
          error: "See server logs for details" 
        });
      }
    } catch (error) {
      console.error("Error in report-by-id endpoint:", error);
      res.status(500).json({ 
        message: "Error sending weekly resource report", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Report Settings API Endpoints
  
  // Get all report settings
  app.get("/api/admin/report-settings", ensureAdmin, async (req, res) => {
    try {
      const settings = await storage.getReportSettings();
      res.status(200).json(settings);
    } catch (error) {
      console.error("Error getting report settings:", error);
      res.status(500).json({ 
        message: "Failed to get report settings",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Get report setting by ID
  app.get("/api/admin/report-settings/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const setting = await storage.getReportSettingById(id);
      
      if (!setting) {
        return res.status(404).json({ message: "Report setting not found" });
      }
      
      res.status(200).json(setting);
    } catch (error) {
      console.error("Error getting report setting:", error);
      res.status(500).json({ 
        message: "Failed to get report setting",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Get report settings by client ID
  app.get("/api/admin/report-settings/client/:clientId", ensureAdmin, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const settings = await storage.getReportSettingsByClient(clientId);
      res.status(200).json(settings);
    } catch (error) {
      console.error("Error getting client report settings:", error);
      res.status(500).json({ 
        message: "Failed to get client report settings",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Create new report setting
  app.post("/api/admin/report-settings", ensureAdmin, async (req, res) => {
    try {
      // Validate request body
      const validatedData = insertReportSettingsSchema.parse(req.body);
      
      const newSetting = await storage.createReportSetting(validatedData);
      res.status(201).json(newSetting);
    } catch (error) {
      console.error("Error creating report setting:", error);
      
      if (error.name === "ZodError") {
        return res.status(400).json({ 
          message: "Invalid report setting data",
          errors: error.errors
        });
      }
      
      res.status(500).json({ 
        message: "Failed to create report setting",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Update report setting
  app.patch("/api/admin/report-settings/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Partial validation of request body
      const validatedData = insertReportSettingsSchema.partial().parse(req.body);
      
      const updatedSetting = await storage.updateReportSetting(id, validatedData);
      res.status(200).json(updatedSetting);
    } catch (error) {
      console.error("Error updating report setting:", error);
      
      if (error.name === "ZodError") {
        return res.status(400).json({ 
          message: "Invalid report setting data",
          errors: error.errors
        });
      }
      
      res.status(500).json({ 
        message: "Failed to update report setting",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Delete report setting
  app.delete("/api/admin/report-settings/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteReportSetting(id);
      
      if (!success) {
        return res.status(404).json({ message: "Report setting not found" });
      }
      
      res.status(200).json({ 
        message: "Report setting deleted successfully",
        deleted: true
      });
    } catch (error) {
      console.error("Error deleting report setting:", error);
      res.status(500).json({ 
        message: "Failed to delete report setting",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.get("/api/admin/users", ensureAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Error fetching users", error });
    }
  });
  
  // Get a list of admin users
  app.get("/api/admin/admins", ensureAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const adminUsers = users.filter(user => user.is_admin === true);
      res.json(adminUsers);
    } catch (error) {
      res.status(500).json({ message: "Error fetching admin users", error });
    }
  });

  // Delete user by email
  app.delete("/api/admin/users/delete-by-email", ensureAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email address is required" });
      }
      
      // Find the user by email
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        return res.status(404).json({ message: `User with email ${email} not found` });
      }
      
      // Use the dedicated storage method to delete the user and all related records
      await storage.deleteUser(user.id);
      
      res.status(200).json({ message: `User ${email} deleted successfully`, userId: user.id });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Error deleting user", error });
    }
  });
  
  // Toggle admin status for a user - Only accessible by the super admin
  app.patch("/api/admin/users/:id/toggle-admin", ensureAdmin, async (req, res) => {
    try {
      // Check if the current user is the super admin (admin@atyeti.com)
      const isSuperAdmin = req.user!.email === "admin@atyeti.com";
      
      if (!isSuperAdmin) {
        return res.status(403).json({ 
          message: "Super admin privileges required", 
          details: "Only the super administrator (admin@atyeti.com) can modify admin privileges for other users",
          errorCode: "SUPER_ADMIN_REQUIRED" 
        });
      }
      
      const userId = parseInt(req.params.id);
      const { isAdmin } = req.body;
      
      if (typeof isAdmin !== 'boolean') {
        return res.status(400).json({ 
          message: "isAdmin field must be a boolean value" 
        });
      }
      
      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Don't allow changing admin status of the super admin
      if (user.email === "admin@atyeti.com") {
        return res.status(403).json({ 
          message: "Operation not allowed", 
          details: "The super administrator account privileges cannot be modified",
          errorCode: "UNCHANGEABLE_SUPER_ADMIN" 
        });
      }
      
      // Update user with new admin status
      // Only use isAdmin - the storage layer will convert it to is_admin
      const updateData = {
        isAdmin: isAdmin
      };
      
      console.log(`Updating admin status for user ${userId} to ${isAdmin}`);
      
      const updatedUser = await storage.updateUser(userId, updateData);
      
      res.json({
        ...updatedUser,
        message: `Admin status for ${user.email} ${isAdmin ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error) {
      console.error("Error updating admin status:", error);
      res.status(500).json({ message: "Error updating admin status", error });
    }
  });

  app.get("/api/admin/skills", ensureApprover, async (req, res) => {
    try {
      // Get both old and new skills for a complete view
      try {
        // Prioritize user_skills data from the new schema 
        const userSkills = await storage.getAllUserSkills();
        
        // Convert to legacy format
        const legacySkills = userSkills.map(us => storage.userSkillToLegacySkill(us));
        
        console.log(`Returning ${legacySkills.length} skills to admin in legacy format (from user_skills)`);
        return res.json(legacySkills);
      } catch (err) {
        console.error("Error getting all user skills for admin:", err);
        // Fall back to legacy skills if there's an error
      }
      
      // Fall back to getting skills from the old table
      const skills = await storage.getAllSkills();
      console.log(`Falling back: Returning ${skills.length} skills to admin from legacy skills table`);
      res.json(skills);
    } catch (error) {
      console.error("Error in /api/admin/skills endpoint:", error);
      res.status(500).json({ message: "Error fetching skills", error });
    }
  });
  
  // Skill template management (for admin)
  app.get("/api/admin/skill-templates", ensureAdmin, async (req, res) => {
    try {
      console.log("Admin user requesting skill templates:", req.user?.email);

      // Direct SQL query to check template data before going through the storage layer
      const directResult = await pool.query(`
        SELECT id, name, category, category_id, subcategory_id 
        FROM skill_templates 
        WHERE id > 76
        ORDER BY id
        LIMIT 10
      `);
      console.log(`Direct SQL query found ${directResult.rows.length} templates with ID > 76`);
      console.log(`First few high ID templates: ${JSON.stringify(directResult.rows.slice(0, 3))}`);
      
      // Oracle DBA specific check
      const oracleResult = await pool.query(`
        SELECT * FROM skill_templates WHERE name = 'Oracle DBA'
      `);
      console.log(`Oracle DBA direct check: ${oracleResult.rows.length > 0 ? 
        `Found with ID ${oracleResult.rows[0].id}` : 'Not found'}`);
      
      // Standard method
      const templates = await storage.getAllSkillTemplates();
      console.log(`Storage layer returned ${templates.length} templates`);
      console.log(`Highest template ID from storage: ${Math.max(...templates.map(t => t.id))}`);
      
      // Check for Oracle DBA in templates
      const oracleTemplate = templates.find(t => t.name === 'Oracle DBA');
      console.log(`Oracle DBA in API response: ${oracleTemplate ? `Yes, ID: ${oracleTemplate.id}` : 'No'}`);
      
      res.json(templates);
    } catch (error) {
      console.error("Error fetching skill templates:", error);
      res.status(500).json({ message: "Error fetching skill templates", error });
    }
  });
  
  // Public endpoint for skill templates - available to everyone
  app.get("/api/skill-templates", async (req, res) => {
    try {
      const templates = await storage.getAllSkillTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Error fetching skill templates", error });
    }
  });
  
  app.post("/api/admin/skill-templates", ensureAdmin, async (req, res) => {
    console.log("\n\n🔍 API TRACE: POST /api/admin/skill-templates called by user:", req.user?.id, req.user?.email);
    console.log("🔍 API TRACE: Request body:", JSON.stringify(req.body, null, 2));
    
    try {
      // Input validation
      if (!req.body) {
        console.error("❌ API TRACE: No request body provided");
        return res.status(400).json({ message: "Request body is required" });
      }
      
      // Log the key fields for debugging
      console.log("🔍 API TRACE: Template name:", req.body.name);
      console.log("🔍 API TRACE: Category name:", req.body.category);
      console.log("🔍 API TRACE: Category ID:", req.body.categoryId);
      console.log("🔍 API TRACE: Subcategory ID:", req.body.subcategoryId);
      
      // Validate user is admin (extra check)
      if (!req.user || !req.user.id) {
        console.error("❌ API TRACE: No authenticated user found");
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const isAdmin = await checkIsUserAdminDirectly(req.user.id);
      if (!isAdmin) {
        console.error(`❌ API TRACE: User ${req.user.id} is not an admin`);
        return res.status(403).json({ message: "Admin access required" });
      }
      
      console.log("✅ API TRACE: Admin access confirmed for user:", req.user.id);
      
      // Log the request data
      console.log("🔍 API TRACE: Creating skill template with request data:", JSON.stringify(req.body, null, 2));
      
      // Enhanced validation with detailed error messages
      if (!req.body.name) {
        console.error("❌ API TRACE: Missing required field: name");
        return res.status(400).json({ message: "Template name is required" });
      }
      
      if (typeof req.body.name !== 'string' || req.body.name.trim().length < 2) {
        console.error(`❌ API TRACE: Invalid template name: "${req.body.name}"`);
        return res.status(400).json({ message: "Template name must be at least 2 characters" });
      }
      
      if (!req.body.category && !req.body.categoryId) {
        console.error("❌ API TRACE: Missing required field: category/categoryId");
        return res.status(400).json({ message: "Category information is required" });
      }
      
      if (req.body.categoryId && typeof req.body.categoryId !== 'number') {
        console.error(`❌ API TRACE: Invalid categoryId type: ${typeof req.body.categoryId}`);
        return res.status(400).json({ message: "Category ID must be a number" });
      }
      
      if (req.body.subcategoryId && typeof req.body.subcategoryId !== 'number') {
        console.error(`❌ API TRACE: Invalid subcategoryId type: ${typeof req.body.subcategoryId}`);
        return res.status(400).json({ message: "Subcategory ID must be a number" });
      }
      
      // If categoryId is provided but category isn't, fetch the category name
      if (req.body.categoryId && !req.body.category) {
        try {
          console.log(`🔍 API TRACE: Fetching category name for categoryId: ${req.body.categoryId}`);
          
          // Fetch category name from the database
          const result = await pool.query(`
            SELECT name FROM skill_categories WHERE id = $1
          `, [req.body.categoryId]);
          
          if (result.rows.length > 0) {
            req.body.category = result.rows[0].name;
            console.log(`✅ API TRACE: Found category name: ${req.body.category}`);
          } else {
            console.error(`❌ API TRACE: No category found with ID: ${req.body.categoryId}`);
            return res.status(400).json({
              message: `Invalid category ID: ${req.body.categoryId}`,
              error: 'category_not_found'
            });
          }
        } catch (error) {
          console.error("❌ API TRACE: Error fetching category name:", error);
          return res.status(500).json({
            message: "Failed to fetch category information",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      try {
        // Validate against schema if available
        const validatedData = insertSkillTemplateSchema.parse(req.body);
        console.log("✅ API TRACE: Request data validated successfully against schema");
      } catch (validationError) {
        console.error("❌ API TRACE: Schema validation error:", validationError);
        return res.status(400).json({ 
          message: "Invalid skill template data", 
          error: validationError 
        });
      }
      
      // Check if this template already exists
      if (req.body.name && req.body.categoryId) {
        try {
          console.log(`🔍 API TRACE: Checking for duplicate template: "${req.body.name}" in category ID ${req.body.categoryId}`);
          
          // Search for existing templates with the same name and category
          const allTemplates = await storage.getAllSkillTemplates();
          const duplicateTemplate = allTemplates.find(t => 
            t.name.toLowerCase() === req.body.name.toLowerCase() && 
            t.categoryId === req.body.categoryId
          );
          
          if (duplicateTemplate) {
            console.error(`❌ API TRACE: Template "${req.body.name}" already exists with ID ${duplicateTemplate.id}`);
            return res.status(409).json({ 
              message: `A template named "${req.body.name}" already exists in this category`,
              error: 'duplicate_template'
            });
          }
          
          console.log("✅ API TRACE: No duplicate template found, continuing with creation");
        } catch (error) {
          console.error("❌ API TRACE: Error checking for duplicate template:", error);
          // Continue with creation attempt even if duplicate check fails
        }
      }
      
      // Create the skill template with enhanced error handling
      try {
        const newTemplate = await storage.createSkillTemplate(req.body);
        console.log("✅ API TRACE: Successfully created skill template:", JSON.stringify(newTemplate, null, 2));
        
        // Return success response
        res.status(201).json(newTemplate);
      } catch (templateError) {
        console.error("❌ API TRACE: Error during template creation:", templateError);
        
        // Handle specific error cases with appropriate status codes
        if (templateError instanceof Error) {
          const errorMsg = templateError.message.toLowerCase();
          
          if (errorMsg.includes("duplicate") || errorMsg.includes("already exists")) {
            return res.status(409).json({ 
              message: "This template already exists in this category",
              error: 'duplicate_template',
              details: templateError.message
            });
          } else if (errorMsg.includes("category not found") || errorMsg.includes("invalid categoryid")) {
            return res.status(400).json({ 
              message: "The specified category does not exist",
              error: 'invalid_category',
              details: templateError.message
            });
          } else if (errorMsg.includes("subcategory") || errorMsg.includes("subcategoryid")) {
            return res.status(400).json({ 
              message: "The specified subcategory does not exist or does not belong to this category",
              error: 'invalid_subcategory',
              details: templateError.message
            });
          }
        }
        
        // Generic error response for all other errors
        return res.status(500).json({
          message: "Failed to create skill template",
          error: templateError instanceof Error ? templateError.message : String(templateError)
        });
      }
    } catch (error) {
      console.error("❌ API TRACE: Unexpected error in main try/catch block:", error);
      
      // Only reach here if there is an error in the validation or pre-processing
      // Template creation errors are caught in the inner try/catch block
      res.status(500).json({ 
        message: "Error processing skill template request", 
        error: error instanceof Error ? error.message : String(error),
        errorType: 'request_processing_error'
      });
    }
  });
  
  app.patch("/api/admin/skill-templates/:id", ensureAdmin, async (req, res) => {
    try {
      console.log("\n\n🔍 API TRACE: PATCH /api/admin/skill-templates/:id called by user:", req.user?.id, req.user?.email);
      console.log("🔍 API TRACE: Request body:", JSON.stringify(req.body, null, 2));
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        console.error("❌ API TRACE: Invalid template ID:", req.params.id);
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      // If categoryId is provided but category isn't, fetch the category name
      if (req.body.categoryId && !req.body.category) {
        try {
          console.log(`🔍 API TRACE: Fetching category name for categoryId: ${req.body.categoryId}`);
          
          // Fetch category name from the database
          const result = await pool.query(`
            SELECT name FROM skill_categories WHERE id = $1
          `, [req.body.categoryId]);
          
          if (result.rows.length > 0) {
            req.body.category = result.rows[0].name;
            console.log(`✅ API TRACE: Found category name: ${req.body.category}`);
          } else {
            console.error(`❌ API TRACE: No category found with ID: ${req.body.categoryId}`);
            return res.status(400).json({
              message: `Invalid category ID: ${req.body.categoryId}`,
              error: 'category_not_found'
            });
          }
        } catch (error) {
          console.error("❌ API TRACE: Error fetching category name:", error);
          return res.status(500).json({
            message: "Failed to fetch category information",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      const updatedTemplate = await storage.updateSkillTemplate(id, req.body);
      console.log("✅ API TRACE: Successfully updated skill template:", JSON.stringify(updatedTemplate, null, 2));
      res.json(updatedTemplate);
    } catch (error) {
      console.error("❌ API TRACE: Error updating skill template:", error);
      res.status(500).json({ 
        message: "Error updating skill template", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });
  
  // Regular admins can only delete templates with no dependencies
  app.delete("/api/admin/skill-templates/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      try {
        // Pass forceCascade=false to prevent cascading deletion
        // This will throw an error if dependencies exist
        await storage.deleteSkillTemplate(id, false);
        res.status(204).send();
      } catch (deleteError) {
        // Check if the error is about dependencies
        if (deleteError instanceof Error && 
            deleteError.message.includes('Cannot delete skill template') && 
            deleteError.message.includes('user skills')) {
          
          return res.status(409).json({ 
            message: "Cannot delete skill template", 
            details: deleteError.message,
            error: "DEPENDENCIES_EXIST"
          });
        } else {
          // Re-throw other errors
          throw deleteError;
        }
      }
    } catch (error) {
      console.error("Error deleting skill template:", error);
      res.status(500).json({ 
        message: "Error deleting skill template", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Super admin can perform cascading delete of templates with all dependencies
  app.delete("/api/super-admin/skill-templates/:id", ensureSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      console.log(`Initiating cascading delete of skill template ID ${id} by super admin ${req.user?.email}`);
      
      // Call the enhanced deleteSkillTemplate function with forceCascade=true
      const result = await storage.deleteSkillTemplate(id, true);
      
      console.log(`Cascading delete of skill template ID ${id} completed successfully`);
      
      res.status(200).json({
        message: "Skill template and all references successfully deleted",
        details: `Deleted template ID ${id} along with ${result.deletedUserSkills} user skills, ${result.deletedProjectSkills} project skills, and all related data`,
        result
      });
    } catch (error) {
      console.error("Error in cascading delete of skill template:", error);
      res.status(500).json({ 
        message: "Error performing cascading deletion of skill template", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Skill target management (for admin)
  app.get("/api/admin/skill-targets", ensureAdmin, async (req, res) => {
    try {
      const targets = await storage.getAllSkillTargets();
      
      // For each target, get the associated skills and users
      const targetsWithDetails = await Promise.all(
        targets.map(async (target) => {
          const skillIds = await storage.getSkillTargetSkills(target.id);
          const userIds = await storage.getSkillTargetUsers(target.id);
          
          return {
            ...target,
            skillIds,
            assignedUsers: userIds
          };
        })
      );
      
      res.json(targetsWithDetails);
    } catch (error) {
      res.status(500).json({ message: "Error fetching skill targets", error });
    }
  });
  
  app.post("/api/admin/skill-targets", ensureAdmin, async (req, res) => {
    try {
      const { skillIds, assignedUsers, ...targetData } = req.body;
      
      // Since name field might be missing, create a default name based on selected skills level
      // Create the target
      const target = await storage.createSkillTarget({
        name: targetData.name || `Target: ${targetData.targetLevel} level`, // Default name if not provided
        description: targetData.description,
        targetLevel: targetData.targetLevel,
        targetDate: targetData.targetDate,
        targetNumber: targetData.targetNumber
      });
      
      // Add skills to the target
      if (Array.isArray(skillIds)) {
        for (const skillId of skillIds) {
          await storage.addSkillToTarget(target.id, skillId);
        }
      }
      
      // Add users to the target
      if (Array.isArray(assignedUsers)) {
        for (const userId of assignedUsers) {
          await storage.addUserToTarget(target.id, userId);
        }
      }
      
      // Return the target with skills and users
      const skillIdsFromDb = await storage.getSkillTargetSkills(target.id);
      const userIdsFromDb = await storage.getSkillTargetUsers(target.id);
      
      res.status(201).json({
        ...target,
        skillIds: skillIdsFromDb,
        assignedUsers: userIdsFromDb
      });
    } catch (error) {
      res.status(500).json({ message: "Error creating skill target", error });
    }
  });
  
  app.patch("/api/admin/skill-targets/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid target ID" });
      }
      
      console.log(`Updating skill target ${id} with request body:`, req.body);
      
      const { skillIds, assignedUsers, ...targetData } = req.body;
      console.log("Extracted targetData:", targetData);
      
      // Update the basic target data
      const updatedTarget = await storage.updateSkillTarget(id, targetData);
      
      // If skillIds are provided, update the target skills
      if (Array.isArray(skillIds)) {
        // Get current skill IDs
        const currentSkillIds = await storage.getSkillTargetSkills(id);
        
        // Remove skills that are no longer in the list
        for (const currentId of currentSkillIds) {
          if (!skillIds.includes(currentId)) {
            await storage.removeSkillFromTarget(id, currentId);
          }
        }
        
        // Add new skills
        for (const skillId of skillIds) {
          if (!currentSkillIds.includes(skillId)) {
            await storage.addSkillToTarget(id, skillId);
          }
        }
      }
      
      // If assignedUsers are provided, update the target users
      if (Array.isArray(assignedUsers)) {
        // Get current user IDs
        const currentUserIds = await storage.getSkillTargetUsers(id);
        
        // Remove users that are no longer in the list
        for (const currentId of currentUserIds) {
          if (!assignedUsers.includes(currentId)) {
            await storage.removeUserFromTarget(id, currentId);
          }
        }
        
        // Add new users
        for (const userId of assignedUsers) {
          if (!currentUserIds.includes(userId)) {
            await storage.addUserToTarget(id, userId);
          }
        }
      }
      
      // Return the updated target with skills and users
      const skillIdsFromDb = await storage.getSkillTargetSkills(id);
      const userIdsFromDb = await storage.getSkillTargetUsers(id);
      
      res.json({
        ...updatedTarget,
        skillIds: skillIdsFromDb,
        assignedUsers: userIdsFromDb
      });
    } catch (error) {
      res.status(500).json({ message: "Error updating skill target", error });
    }
  });
  
  app.delete("/api/admin/skill-targets/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid target ID" });
      }
      
      await storage.deleteSkillTarget(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting skill target", error });
    }
  });
  
  // Endpoint to get skill targets for the current user
  // Get all skill targets - accessible to all users (global skill gap analysis)
  app.get("/api/skill-targets", ensureAuth, async (req, res) => {
    try {
      // Get all skill targets
      const allTargets = await storage.getAllSkillTargets();
      
      // Enhance targets with skill IDs
      const enhancedTargets = await Promise.all(
        allTargets.map(async (target) => {
          const skillIds = await storage.getSkillTargetSkills(target.id);
          return {
            ...target,
            skillIds
          };
        })
      );
      
      res.json(enhancedTargets);
    } catch (error) {
      console.error("Error fetching global skill targets:", error);
      res.status(500).json({ message: "Error fetching global skill targets", error });
    }
  });
  
  // GET global skill gap analysis - for all users (not just admins)
  app.get("/api/skill-gap-analysis", ensureAuth, async (req, res) => {
    try {
      const targets = await storage.getAllSkillTargets();
      const skills = await storage.getAllSkills();
      const users = await storage.getAllUsers();
      
      // Process targets to include skill IDs
      const processedTargets = await Promise.all(
        targets.map(async (target) => {
          const skillIds = await storage.getSkillTargetSkills(target.id);
          return { ...target, skillIds };
        })
      );
      
      // Calculate skill gap analysis similar to admin dashboard
      const gapAnalysis = await Promise.all(processedTargets.map(async (target) => {
        // Get skills that are part of this target
        const targetSkills = skills.filter(s => 
          target.skillIds.includes(s.id)
        );
        
        if (targetSkills.length === 0) return null;
        
        // Calculate current average level across all users
        const levelToValue = (level: string) => {
          switch(level) {
            case "beginner": return 33;
            case "intermediate": return 66;
            case "expert": return 100;
            default: return 0;
          }
        };
        
        const targetLevelValue = levelToValue(target.targetLevel);
        
        // Calculate current level (average of all users who have these skills)
        const levelData = targetSkills.map(skill => levelToValue(skill.level));
        const currentLevelValue = levelData.length > 0 
          ? Math.round(levelData.reduce((a, b) => a + b, 0 as number) / levelData.length) 
          : 0;
          
        // Calculate gap
        const gap = Math.max(0, targetLevelValue - currentLevelValue);
        
        // Count employees needing skill improvement
        const employeesNeedingImprovement = users.filter(user => {
          // Get the user's skills that match skills in the target's skillIds
          const userTargetSkills = skills.filter(s => 
            s.userId === user.id && 
            target.skillIds.includes(s.id)
          );
          
          // If user has no relevant skills, they need improvement
          if (userTargetSkills.length === 0) return true;
          
          // Calculate user's average level for target skills
          const userAvgLevel = userTargetSkills.reduce((sum, skill) => 
            sum + levelToValue(skill.level), 0 as number) / userTargetSkills.length;
            
          // If user's level is below target, they need improvement
          return userAvgLevel < targetLevelValue;
        }).length || 0;
        
        return {
          name: target.name || `Target ${target.id}`,
          id: target.id,
          targetSkillCount: targetSkills.length,
          currentLevel: Math.round(currentLevelValue),
          targetLevel: Math.round(targetLevelValue),
          gap: Math.round(gap),
          employeesNeedingImprovement
        };
      }));
      
      // Filter out null entries
      const filteredAnalysis = gapAnalysis.filter(Boolean);
      
      res.json(filteredAnalysis);
    } catch (error) {
      console.error("Error calculating skill gap analysis:", error);
      res.status(500).json({ message: "Error calculating skill gap analysis", error });
    }
  });

  app.get("/api/user/skill-targets", ensureAuth, async (req, res) => {
    try {
      // Get all skill targets
      const allTargets = await storage.getAllSkillTargets();
      
      // Filter targets that are assigned to the current user
      const userTargets = await Promise.all(
        allTargets.map(async (target) => {
          const userIds = await storage.getSkillTargetUsers(target.id);
          
          // If this target is assigned to the current user
          if (userIds.includes(req.user!.id)) {
            const skillIds = await storage.getSkillTargetSkills(target.id);
            
            // Get the user's current skills
            const userSkills = await storage.getUserSkills(req.user!.id);
            
            // Get the target skills
            const targetSkillsPromises = skillIds.map(skillId => storage.getSkill(skillId));
            const targetSkillsResults = await Promise.all(targetSkillsPromises);
            
            // Filter out undefined results
            const targetSkills = targetSkillsResults.filter(skill => skill !== undefined) as Skill[];
            
            // Find skills that match the target level
            const matchingSkills = userSkills.filter(userSkill => {
              // Check if the user has this skill
              const hasMatchingSkill = targetSkills.some(targetSkill => 
                targetSkill.name === userSkill.name ||
                targetSkill.id === userSkill.id
              );
              
              // For level-based targets, also check if the level matches or exceeds
              if (target.targetLevel && hasMatchingSkill) {
                const levelOrder = { beginner: 1, intermediate: 2, expert: 3 };
                const userLevel = levelOrder[userSkill.level as keyof typeof levelOrder] || 0;
                const targetLevel = levelOrder[target.targetLevel as keyof typeof levelOrder] || 0;
                
                return userLevel >= targetLevel;
              }
              
              return hasMatchingSkill;
            });
            
            // Calculate gap and progress
            const totalTargetSkills = skillIds.length;
            const acquiredSkills = matchingSkills.length;
            const progress = totalTargetSkills > 0 ? Math.round((acquiredSkills / totalTargetSkills) * 100) : 0;
            
            // Create the response object
            return {
              ...target,
              skillIds,
              targetSkills,
              progress,
              acquiredSkills,
              totalTargetSkills,
              skillGap: totalTargetSkills - acquiredSkills,
              dueDate: target.targetDate ? new Date(target.targetDate).toISOString() : null,
              isCompleted: progress === 100
            };
          }
          return null;
        })
      );
      
      // Filter out null values
      const validUserTargets = userTargets.filter(target => target !== null);
      
      res.json(validUserTargets);
    } catch (error) {
      console.error("Error fetching user skill targets:", error);
      res.status(500).json({ message: "Error fetching user skill targets", error });
    }
  });
  
  // Get all skill histories across all users for admin
  app.get("/api/admin/skill-history", ensureApprover, async (req, res) => {
    try {
      const histories = await storage.getAllSkillHistories();
      res.json(histories);
    } catch (error) {
      res.status(500).json({ message: "Error fetching skill histories", error });
    }
  });
  
  // Export all data for admins (for data analysis and reporting)
  app.get("/api/admin/export-data", ensureAdmin, async (req, res) => {
    try {
      // Get all data
      const users = await storage.getAllUsers();
      const skills = await storage.getAllSkills();
      const skillHistories = await storage.getAllSkillHistories();
      
      // Format data for export
      const exportData = {
        exportDate: new Date().toISOString(),
        exportedBy: {
          id: req.user!.id,
          username: req.user!.username,
          email: req.user!.email
        },
        data: {
          users,
          skills,
          skillHistories
        }
      };
      
      res.json(exportData);
    } catch (error) {
      console.error("Error exporting data:", error);
      res.status(500).json({ message: "Error exporting data", error });
    }
  });
  
  // Get certification report
  app.get("/api/admin/certification-report", ensureAdmin, async (req, res) => {
    try {
      console.log("Running certification report for user ID:", req.user?.id);
      
      // Direct database query to get all certified skills with their related data (using user_skills)
      const queryText = `
        SELECT us.*, st.name, u.email, u.username
        FROM user_skills us
        JOIN skill_templates st ON us.skill_template_id = st.id
        JOIN users u ON us.user_id = u.id
        WHERE us.certification IS NOT NULL 
          AND us.certification != 'true' 
          AND us.certification != 'false'
      `;
      console.log("Running SQL query:", queryText);
      
      const result = await pool.query(queryText);
      
      const rawSkills = result.rows;
      console.log("Certification report - Total skills in DB:", rawSkills.length);
      
      if (rawSkills.length > 0) {
        console.log("Certification report - Sample skill from DB:", JSON.stringify(rawSkills[0], null, 2));
      } else {
        console.log("No certified skills found in the database!");
      }
      
      // Group by user
      const userMap = new Map();
      
      // When using raw SQL queries, the result has snake_case field names
      // and TypeScript doesn't know the shape, so we need to use "any" type
      for (const skill of rawSkills as any[]) {
        try {
          const userId = skill.user_id;
          
          if (!userId) {
            console.log(`Skill ${skill.id} has undefined user_id:`, skill);
            continue;
          }
          
          if (!userMap.has(userId)) {
            // Create user object from the joined query data
            const userObj = {
              id: userId,
              email: skill.email,
              username: skill.username
            };
            
            userMap.set(userId, {
              user: userObj,
              certifications: []
            });
          }
          
          if (userMap.has(userId)) {
            // Parse dates from the database fields
            const certificationDate = skill.certification_date ? new Date(skill.certification_date) : null;
            const expirationDate = skill.expiration_date ? new Date(skill.expiration_date) : null;
            
            userMap.get(userId).certifications.push({
              skillId: skill.id,
              name: skill.name,
              category: skill.category,
              level: skill.level,
              certification: skill.certification,
              credlyLink: skill.credly_link,
              acquired: certificationDate,
              acquiredFormatted: certificationDate ? certificationDate.toISOString().split('T')[0] : null,
              expirationDate: expirationDate,
              expirationFormatted: expirationDate ? expirationDate.toISOString().split('T')[0] : null,
              isExpired: expirationDate ? expirationDate < new Date() : false
            });
          }
        } catch (err) {
          console.error(`Error processing skill ${skill.id} for user ${skill.user_id}:`, err);
        }
      }
      
      const report = Array.from(userMap.values());
      console.log("Certification report ready. Report length:", report.length);
      res.json(report);
    } catch (error) {
      console.error("Error generating certification report:", error);
      res.status(500).json({ message: "Error generating certification report", error });
    }
  });
  
  // Get advanced analytics data
  app.get("/api/admin/advanced-analytics", ensureAdmin, async (req, res) => {
    try {
      const skills = await storage.getAllSkills();
      const users = await storage.getAllUsers();
      const histories = await storage.getAllSkillHistories();
      
      // Monthly progress trends - group skill updates by month
      const now = new Date();
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(now.getMonth() - 6);
      
      // Format: YYYY-MM
      const monthlyUpdates = histories.reduce((acc, history) => {
        const date = new Date(history.createdAt);
        if (date >= sixMonthsAgo) {
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          acc[key] = (acc[key] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
      
      // Convert to array sorted by date
      const monthlyData = Object.entries(monthlyUpdates)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month));
      
      // Skill growth by level over time
      const skillsByLevel = histories.reduce((acc, history) => {
        const date = new Date(history.createdAt);
        if (date >= sixMonthsAgo) {
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          
          if (!acc[month]) {
            acc[month] = { beginner: 0, intermediate: 0, expert: 0 };
          }
          
          if (history.newLevel) {
            acc[month][history.newLevel] = (acc[month][history.newLevel] || 0) + 1;
          }
        }
        return acc;
      }, {} as Record<string, Record<string, number>>);
      
      // Convert to array for chart data
      const skillLevelTrends = Object.entries(skillsByLevel).map(([month, levels]) => ({
        month,
        beginner: levels.beginner || 0,
        intermediate: levels.intermediate || 0,
        expert: levels.expert || 0
      })).sort((a, b) => a.month.localeCompare(b.month));
      
      // Top skills by category
      const skillsByCategory = skills.reduce((acc, skill) => {
        const category = skill.category || 'Other';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Convert to array for charts
      const categoryData = Object.entries(skillsByCategory)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
      
      // Department distribution (using categories as proxy for departments)
      const departmentData = categoryData.slice();
      
      // User growth - number of skills per user
      const userSkillsCount = skills.reduce((acc, skill) => {
        acc[skill.userId] = (acc[skill.userId] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      
      // Parse all valid user IDs and filter out invalid ones
      const validSkillUserEntries = Object.entries(userSkillsCount)
        .map(([userIdStr, count]) => {
          const id = parseInt(userIdStr);
          return isNaN(id) ? null : { id, count };
        })
        .filter(entry => entry !== null) as { id: number, count: number }[];
      
      // Process only valid user IDs
      const userSkillData = await Promise.all(
        validSkillUserEntries.map(async ({ id, count }) => {
          const user = await storage.getUser(id);
          // Create a display name from username or email
          let displayName = `User ${id}`;
          if (user) {
            if (user.username) {
              displayName = user.username;
            } else if (user.email) {
              displayName = user.email.split('@')[0];
            }
          }
          return {
            userId: id,
            name: displayName,
            skillCount: count
          };
        })
      );
      
      // Top certified users
      const certificationUsers = await storage.getAllUsers();
      const certSkills = await storage.getAllSkills();
      const certSkillsByUser = certSkills
        .filter(skill => 
          skill.certification &&
          skill.certification !== 'true' &&
          skill.certification !== 'false'
        )
        .reduce((acc, skill) => {
          acc[skill.userId] = (acc[skill.userId] || 0) + 1;
          return acc;
        }, {} as Record<number, number>);
      
      // Parse all valid user IDs and filter out invalid ones
      const validUserEntries = Object.entries(certSkillsByUser)
        .map(([userIdStr, count]) => {
          const id = parseInt(userIdStr);
          return isNaN(id) ? null : { id, count };
        })
        .filter(entry => entry !== null) as { id: number, count: number }[];
      
      // Process only valid user IDs
      const certifiedUsers = await Promise.all(
        validUserEntries.map(async ({ id, count }) => {
          const user = await storage.getUser(id);
          // Create a display name from username or email
          let displayName = `User ${id}`;
          if (user) {
            if (user.username) {
              displayName = user.username;
            } else if (user.email) {
              displayName = user.email.split('@')[0];
            }
          }
          return {
            userId: id,
            name: displayName,
            certCount: count
          };
        })
      );
      
      const topCertifiedUsers = certifiedUsers
        .sort((a, b) => b.certCount - a.certCount)
        .slice(0, 10);
      
      res.json({
        monthlyData,
        skillLevelTrends,
        categoryData,
        departmentData,
        userSkillData,
        certifiedUsers: topCertifiedUsers
      });
    } catch (error) {
      res.status(500).json({ message: "Error generating advanced analytics", error });
    }
  });

  // Endorsement routes (updated to use user_skills)
  app.post("/api/skills/:id/endorse", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      const userSkill = await storage.getUserSkillById(skillId);
      
      if (!userSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      // Get the skill template to access the name
      const skillTemplate = await storage.getSkillTemplate(userSkill.skillTemplateId);
      
      if (!skillTemplate) {
        return res.status(404).json({ message: "Skill template not found" });
      }
      
      // Users can't endorse their own skills
      if (userSkill.userId === req.user!.id) {
        return res.status(400).json({ message: "You cannot endorse your own skills" });
      }
      
      const parsedData = insertEndorsementV2Schema.safeParse({
        userSkillId: skillId,
        endorserId: req.user!.id,
        endorseeId: userSkill.userId,
        comment: req.body.comment
      });
      
      if (!parsedData.success) {
        return res.status(400).json({ 
          message: "Invalid endorsement data", 
          errors: parsedData.error.format() 
        });
      }
      
      const endorsement = await storage.createEndorsementV2(parsedData.data);
      
      // Update the skill's endorsement count
      await storage.updateUserSkill(skillId, { 
        endorsementCount: (userSkill.endorsementCount || 0) + 1 
      });
      
      // Create a notification for the skill owner
      await storage.createNotification({
        userId: userSkill.userId,
        type: "endorsement",
        content: `Your ${skillTemplate.name} skill was endorsed by a colleague`,
        relatedUserSkillId: skillId, // Use userSkillId (skillId) instead of relatedSkillId
        relatedUserId: req.user!.id
      });
      
      res.status(201).json(endorsement);
    } catch (error) {
      res.status(500).json({ message: "Error creating endorsement", error });
    }
  });
  
  app.get("/api/skills/:id/endorsements", ensureAuth, async (req, res) => {
    try {
      const skillId = parseInt(req.params.id);
      const userSkill = await storage.getUserSkillById(skillId);
      
      if (!userSkill) {
        return res.status(404).json({ message: "Skill not found" });
      }
      
      const endorsements = await storage.getSkillEndorsements(skillId);
      res.json(endorsements);
    } catch (error) {
      res.status(500).json({ message: "Error fetching endorsements", error });
    }
  });
  
  app.get("/api/user/endorsements", ensureAuth, async (req, res) => {
    try {
      const endorsements = await storage.getUserEndorsements(req.user!.id);
      res.json(endorsements);
    } catch (error) {
      res.status(500).json({ message: "Error fetching endorsements", error });
    }
  });
  
  app.delete("/api/endorsements/:id", ensureAuth, async (req, res) => {
    try {
      const endorsementId = parseInt(req.params.id);
      // Only admins can delete endorsements
      if (!req.user!.is_admin) {
        return res.status(403).json({ 
          message: "Admin privileges required", 
          details: "Only administrators can delete endorsements",
          errorCode: "ADMIN_REQUIRED" 
        });
      }
      
      await storage.deleteEndorsement(endorsementId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting endorsement", error });
    }
  });
  
  // Notification routes - All users can access their own notifications
  app.get("/api/notifications", ensureAuth, async (req, res) => {
    try {
      const unreadOnly = req.query.unread === "true";
      const notifications = await storage.getUserNotifications(req.user!.id, unreadOnly);
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ message: "Error fetching notifications", error });
    }
  });
  
  app.post("/api/notifications/:id/read", ensureAuth, async (req, res) => {
    try {
      const notificationId = parseInt(req.params.id);
      await storage.markNotificationAsRead(notificationId);
      res.status(200).send();
    } catch (error) {
      res.status(500).json({ message: "Error marking notification as read", error });
    }
  });
  
  app.post("/api/notifications/read-all", ensureAuth, async (req, res) => {
    try {
      await storage.markAllNotificationsAsRead(req.user!.id);
      // Return a JSON response instead of an empty response
      res.status(200).json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
      res.status(500).json({ message: "Error marking notifications as read", error });
    }
  });

  // Pending Skill Updates routes (Approval system)
  app.post("/api/skills/pending", ensureAuth, async (req, res) => {
    try {
      console.log("Received pending skill update request with body:", req.body);
      const userId = req.user!.id;
      const isAdmin = req.user!.isAdmin || req.user!.is_admin;
      
      // First, check if we have a skill_template_id in the request - that takes priority
      if (req.body.skill_template_id || req.body.skillTemplateId) {
        // If we already have a template ID, we can proceed with standard handling
        console.log("Found skill template ID in request, using standard flow");
        const skillTemplateId = req.body.skill_template_id || req.body.skillTemplateId;
        
        // Get the skill template details to include the name
        let templateName = '';
        let templateCategory = '';
        let templateSubcategory = '';
        let categoryId = null;
        let subcategoryId = null;
        
        try {
          const template = await storage.getSkillTemplate(skillTemplateId);
          if (template) {
            templateName = template.name;
            templateCategory = template.category;
            categoryId = template.categoryId;
            subcategoryId = template.subcategoryId;
            
            // Try to get subcategory name if subcategoryId is provided
            if (template.subcategoryId) {
              try {
                const subcategory = await storage.getSkillSubcategoryById(template.subcategoryId);
                if (subcategory) {
                  templateSubcategory = subcategory.name;
                }
              } catch (subcategoryErr) {
                console.error("Error getting subcategory details:", subcategoryErr);
              }
            }
          }
        } catch (err) {
          console.error("Error getting skill template details:", err);
        }
        
        // Create pending skill update using the provided template ID
        const pendingSkillDataV2: any = {
          user_id: userId,
          skill_template_id: skillTemplateId,
          name: templateName || 'Skill from template ' + skillTemplateId, // Set a name to avoid NOT NULL constraint
          category: templateCategory || '', // Include category
          subcategory: templateSubcategory || '', // Include subcategory
          level: req.body.level,
          certification: req.body.certification || null,
          credly_link: req.body.credlyLink || req.body.credly_link || null,
          notes: req.body.notes || null,
          status: "pending",
          submitted_at: new Date(),
          is_update: req.body.is_update || req.body.isUpdate || false,
          // Include category and subcategory IDs if available
          category_id: categoryId || null,
          subcategory_id: subcategoryId || null
        };
        
        console.log("Creating standard V2 pending skill update with data:", pendingSkillDataV2);
        const pendingSkillUpdate = await storage.createPendingSkillUpdateV2(pendingSkillDataV2);
        
        // Notify approvers (all admins for now)
        const admins = await storage.getAllAdmins();
        
        if (admins && admins.length > 0) {
          for (const admin of admins) {
            await storage.createNotification({
              user_id: admin.id,
              type: "achievement",
              content: `User ${req.user!.username} has requested approval for a skill update`,
              related_user_id: req.user!.id,
              related_user_skill_id: pendingSkillUpdate.userSkillId
            });
          }
        }
        
        return res.status(201).json({
          message: "Pending skill update created successfully",
          pendingSkillUpdate
        });
      }
      
      // Check if we have name and category fields - indicating it's a custom skill
      // The subcategory can be provided either as a string or as subcategory_id
      const isCustomSkill = req.body.is_custom_skill === true || 
        (req.body.name && req.body.category && !req.body.skillTemplateId && !req.body.skill_template_id);
      
      console.log(`Custom skill check: name=${req.body.name}, category=${req.body.category}, subcategory=${req.body.subcategory || 'none'}, subcategory_id=${req.body.subcategory_id || req.body.subcategoryId || 'none'}, isCustomSkill=${isCustomSkill}`);
      
      if (isCustomSkill) {
        console.log("Detected custom skill with category and subcategory");
        
        // Process the subcategory information
        // Find or get category ID
        let categoryId = null;
        let subcategoryId = null;
        
        try {
          // Look up category
          const category = await storage.getSkillCategoryByName(req.body.category);
          if (category) {
            categoryId = category.id;
            console.log(`Found existing category "${req.body.category}" with ID ${categoryId}`);
            
            // Use subcategory_id if provided directly
            if (req.body.subcategory_id || req.body.subcategoryId) {
              subcategoryId = req.body.subcategory_id || req.body.subcategoryId;
              console.log(`Using provided subcategory ID: ${subcategoryId}`);
            }
            // Otherwise try to look up by name
            else if (req.body.subcategory) {
              const subcategory = await storage.getSkillSubcategoryByNameAndCategory(
                req.body.subcategory, 
                category.id
              );
            
              if (subcategory) {
                subcategoryId = subcategory.id;
                console.log(`Found existing subcategory "${req.body.subcategory}" with ID ${subcategoryId}`);
              } else {
                console.log(`Subcategory "${req.body.subcategory}" not found, will create during approval`);
              }
            }
          } else {
            console.log(`Category "${req.body.category}" not found, will create during approval`);
          }
        } catch (err) {
          console.error("Error looking up category/subcategory:", err);
        }
        
        // Format notes to preserve subcategory information
        let subcategoryInfo = '';
        if (req.body.subcategory) {
          subcategoryInfo = `Subcategory: ${req.body.subcategory}`;
        } else if (subcategoryId) {
          // Just use the subcategory ID in the notes
          subcategoryInfo = `Subcategory ID: ${subcategoryId}`;
          
          // No need for getSkillSubcategoryById that was causing errors
          // We'll just use the ID directly
        }
        
        let metadataNotes = `${req.body.name}\nCategory: ${req.body.category}\n${subcategoryInfo}`;
        if (req.body.notes) {
          metadataNotes = `${metadataNotes}\n\n${req.body.notes}`;
        }
        
        console.log("Formatted notes with metadata:", metadataNotes);
        
        // Create or find a skill template for this custom skill
        // Try to find an existing template
        let skillTemplateId;
        let skillTemplate;
        
        try {
          skillTemplate = await storage.getSkillTemplateByNameAndCategory(
            req.body.name, 
            categoryId || 0
          );
          
          if (skillTemplate) {
            skillTemplateId = skillTemplate.id;
            console.log(`Found existing skill template for "${req.body.name}" with ID ${skillTemplateId}`);
          } else {
            // Create a new skill template for this custom skill
            console.log(`Creating new skill template for custom skill "${req.body.name}"`);
            
            skillTemplate = await storage.createSkillTemplate({
              name: req.body.name,
              category: req.body.category,
              categoryId: categoryId,
              subcategoryId: subcategoryId,
              description: `Custom skill created by ${req.user!.username}`
            });
            
            skillTemplateId = skillTemplate.id;
            console.log(`Created new skill template with ID ${skillTemplateId}`);
          }
        } catch (err) {
          console.error("Error creating/finding skill template:", err);
          // Use -1 as a sentinel value for special handling later
          skillTemplateId = -1;
        }
        
        // Create pending skill update using V2 format
        const pendingSkillDataV2: any = {
          user_id: req.user!.id,  // Using snake_case to match DB column names
          name: req.body.name || '', // Explicitly include name to avoid null violations
          category: req.body.category || '', // Include category
          subcategory: req.body.subcategory || '', // Include subcategory name
          skill_template_id: skillTemplateId,
          level: req.body.level,
          certification: req.body.certification || null,
          credly_link: req.body.credlyLink || req.body.credly_link || null,
          notes: metadataNotes,
          status: "pending",
          submitted_at: new Date(),
          is_update: false,
          // Include category and subcategory IDs if available
          category_id: categoryId || null,
          subcategory_id: subcategoryId || null
        };
        
        console.log("Creating V2 pending skill update with data:", pendingSkillDataV2);
        
        // Auto-approve for admin users
        if (isAdmin) {
          console.log("Admin user detected, auto-approving custom skill");
          pendingSkillDataV2.status = "approved";
          pendingSkillDataV2.reviewed_at = new Date();
          pendingSkillDataV2.reviewed_by = req.user!.id;
          pendingSkillDataV2.review_notes = "Auto-approved (admin user)";
          
          try {
            // Create the pending skill update first
            console.log("Creating V2 pending skill update with data:", pendingSkillDataV2);
            const pendingSkillUpdate = await storage.createPendingSkillUpdateV2(pendingSkillDataV2);
            
            console.log("Creating user skill directly (admin auto-approval)");
            
            // Create the user skill entry
            const userSkill = await storage.createUserSkill({
              userId: req.user!.id,
              skillTemplateId: skillTemplateId,
              level: req.body.level,
              certification: req.body.certification || '',
              credlyLink: req.body.credlyLink || req.body.credly_link || '',
              notes: metadataNotes
            });
            
            console.log("Created user skill:", userSkill);
            
            // Create a skill history entry
            await storage.createSkillHistory({
              skillId: userSkill.id,
              userId: req.user!.id,
              previousLevel: null,
              newLevel: req.body.level,
              changeNote: "Initial skill creation (custom skill)"
            });
            
            // Convert to legacy format for API response consistency
            const legacyFormatSkill = storage.userSkillToLegacySkill(userSkill);
            
            return res.status(201).json({
              message: "New skill created successfully (admin auto-approval)",
              skill: legacyFormatSkill
            });
          } catch (error) {
            console.error("Error auto-approving custom skill:", error);
            return res.status(500).json({
              message: "Error creating custom skill",
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        
        // For non-admin users, create a pending skill update
        try {
          console.log("Creating V2 pending skill update for non-admin user");
          const pendingSkillUpdate = await storage.createPendingSkillUpdateV2(pendingSkillDataV2);
          
          // Notify approvers (all admins for now)
          const admins = await storage.getAllAdmins();
          
          if (admins && admins.length > 0) {
            for (const admin of admins) {
              await storage.createNotification({
                user_id: admin.id,
                type: "achievement", // Using "achievement" type which is allowed in the schema
                content: `User ${req.user!.username} has requested approval for ${req.body.name} skill`,
                related_user_id: req.user!.id,
                related_user_skill_id: pendingSkillUpdate.userSkillId
              });
            }
          }
          
          return res.status(201).json({
            message: "Pending skill update created successfully",
            pendingSkillUpdate
          });
        } catch (error) {
          console.error("Error creating pending skill update:", error);
          return res.status(500).json({
            message: "Error creating pending skill update",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        // Handle standard skill updates through skill template
        console.log("Standard skill update request (non-custom skill)");
        
        // Check if required fields are present
        if (!req.body.skillTemplateId && !req.body.skill_template_id) {
          return res.status(400).json({
            message: "Missing required field: skillTemplateId or skill_template_id",
            error: "When not submitting a custom skill, you must provide a skill template ID"
          });
        }
        
        // Create pending skill update using the provided template ID
        const skillTemplateId = req.body.skillTemplateId || req.body.skill_template_id;
        
        // Get the skill template to get its name, category, and subcategory
        let templateName = '';
        let templateCategory = '';
        let templateSubcategory = '';
        let categoryId = null;
        let subcategoryId = null;
        
        try {
          const template = await storage.getSkillTemplate(skillTemplateId);
          if (template) {
            templateName = template.name;
            templateCategory = template.category;
            categoryId = template.categoryId;
            subcategoryId = template.subcategoryId;
            
            // Try to get subcategory name if subcategoryId is provided
            if (template.subcategoryId) {
              try {
                const subcategory = await storage.getSkillSubcategoryById(template.subcategoryId);
                if (subcategory) {
                  templateSubcategory = subcategory.name;
                }
              } catch (subcategoryErr) {
                console.error("Error getting subcategory details:", subcategoryErr);
              }
            }
          }
        } catch (err) {
          console.error("Error getting skill template details:", err);
        }
        
        const pendingSkillDataV2: any = {
          user_id: req.user!.id,
          name: templateName || req.body.name || '', // Use template name or fallback to request body
          category: templateCategory || req.body.category || '', // Use template category or fallback
          subcategory: templateSubcategory || req.body.subcategory || '', // Include subcategory
          skill_template_id: skillTemplateId,
          level: req.body.level,
          certification: req.body.certification || null,
          credly_link: req.body.credlyLink || req.body.credly_link || null,
          notes: req.body.notes || null,
          status: "pending",
          submitted_at: new Date(),
          is_update: req.body.is_update || req.body.isUpdate || false,
          // Include category and subcategory IDs if available
          category_id: categoryId || req.body.category_id || null,
          subcategory_id: subcategoryId || req.body.subcategory_id || null
        };
        
        console.log("Creating standard V2 pending skill update with data:", pendingSkillDataV2);
        
        try {
          const pendingSkillUpdate = await storage.createPendingSkillUpdateV2(pendingSkillDataV2);
          
          // Notify approvers (all admins for now)
          const admins = await storage.getAllAdmins();
          
          if (admins && admins.length > 0) {
            for (const admin of admins) {
              await storage.createNotification({
                user_id: admin.id,
                type: "achievement",
                content: `User ${req.user!.username} has requested approval for a skill update`,
                related_user_id: req.user!.id,
                related_user_skill_id: pendingSkillUpdate.userSkillId
              });
            }
          }
          
          return res.status(201).json({
            message: "Pending skill update created successfully",
            pendingSkillUpdate
          });
        } catch (error) {
          console.error("Error creating standard pending skill update:", error);
          return res.status(500).json({
            message: "Error creating pending skill update",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      console.error("Error in skill submission:", error);
      res.status(400).json({ 
        message: "Error processing skill submission", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/user/pending-skills", ensureAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      // Use V2 function for consistency
      const pendingUpdates = await storage.getPendingSkillUpdatesByUserV2(userId);
      res.json(pendingUpdates);
    } catch (error) {
      res.status(500).json({ message: "Error fetching pending skill updates V2", error });
    }
  });

  // GET route for /api/skills/pending (with explicit authentication)
  app.get("/api/skills/pending", ensureApprover, async (req, res) => {
    try {
      console.log("GET /api/skills/pending endpoint called with approver check");
      
      const userId = req.user!.id;
      const userEmail = req.user!.email;
      const isAdmin = req.user!.isAdmin || req.user!.is_admin;
      console.log(`User ID: ${userId}, Email: ${userEmail}, isAdmin: ${isAdmin}`);
      
      // Get all pending skill updates using V2 function
      const pendingUpdates = await storage.getPendingSkillUpdatesV2();
      console.log(`Got ${pendingUpdates.length} total pending updates`);
      
      // If not an admin or super admin, we should filter the results
      // For now we're returning all results since the user has already passed the approver check
      
      res.json(pendingUpdates);
    } catch (error) {
      console.error("Error fetching pending skill updates:", error);
      res.status(500).json({ message: "Error fetching pending skill updates", error });
    }
  });

  // Admin approval routes (accessible by both admins and approvers)
  app.get("/api/admin/pending-skills", ensureApprover, async (req, res) => {
    try {
      // Get all pending skill updates using V2 function
      const pendingUpdates = await storage.getPendingSkillUpdatesV2();
      console.log(`Got ${pendingUpdates.length} total pending updates`);
      
      // Check if user is super admin
      const userId = req.user!.id;
      const isSuperAdmin = req.user!.email === "admin@atyeti.com";
      const isAdmin = req.user!.isAdmin || req.user!.is_admin;
      
      console.log(`User ID: ${userId}, isSuperAdmin: ${isSuperAdmin}, isAdmin: ${isAdmin}`);
      
      // Super admin can see and approve all skills
      let filteredPendingUpdates = pendingUpdates;
      
      // If not super admin, filter based on approver permissions
      if (!isSuperAdmin) {
        console.log(`User is not super admin - checking approver permissions`);
        
        // Get the approver assignments for this user
        const approverAssignments = await storage.getSkillApproversByUser(userId);
        console.log(`User has ${approverAssignments.length} approver assignments:`, 
                   JSON.stringify(approverAssignments));
                   
        // For user testing purposes and clear demonstration of filtering, we'll enforce filtering
        // for all non-super-admin users, even if they have global approval
        if (isSuperAdmin) {
          console.log(`Super admin - showing all skills`);
        } 
        else {
          console.log(`Non-super admin - enforcing skill filtering to demonstrate approval scopes`);
          console.log(`Filtering skills based on specific approver assignments`);
          
          // Filter pending skills based on the user's approval permissions
          const approvalChecks = await Promise.all(
            pendingUpdates.map(async (update) => {
              // Get the skill template information for this update
              let categoryId = null;
              let subcategoryId = null;
              
              // For existing user skills being updated
              if (update.userSkillId) {
                // Get the user skill to find its template
                const userSkill = await storage.getUserSkillById(update.userSkillId);
                if (userSkill) {
                  // Get the skill template to find its category
                  const skillTemplate = await storage.getSkillTemplate(userSkill.skillTemplateId);
                  if (skillTemplate) {
                    categoryId = skillTemplate.categoryId;
                    subcategoryId = skillTemplate.subcategoryId;
                  }
                }
                console.log(`Update for existing user skill with template ID: ${userSkill?.skillTemplateId}, categoryId: ${categoryId}`);
              } else if (update.skillTemplateId) {
                // For new skills, get the template directly
                const skillTemplate = await storage.getSkillTemplate(update.skillTemplateId);
                if (skillTemplate) {
                  categoryId = skillTemplate.categoryId;
                  subcategoryId = skillTemplate.subcategoryId;
                }
                console.log(`Update for new skill with template ID: ${update.skillTemplateId}, categoryId: ${categoryId}`);
              }
              
              // Check if user can approve this skill based on category or template ID
              const canApprove = await Promise.all([
                // Check by category
                categoryId ? storage.canUserApproveSkill(
                  userId, 
                  categoryId,
                  subcategoryId || undefined,
                  update.skillTemplateId || undefined
                ) : false,
                
                // Direct check by skill template ID
                update.skillTemplateId ? storage.canUserApproveSkill(
                  userId,
                  categoryId || 0,
                  undefined,
                  update.skillTemplateId
                ) : false
              ]).then(results => results.some(result => result));
              
              const templateName = update.skillTemplateId 
                ? (await storage.getSkillTemplate(update.skillTemplateId))?.name || 'Unknown'
                : 'Unknown';
                
              console.log(`Skill template ${templateName} (ID: ${update.skillTemplateId || 'new'}), canApprove: ${canApprove}`);
              
              return {
                update,
                canApprove
              };
            })
          );
          
          // Filter to include only updates the user can approve
          filteredPendingUpdates = approvalChecks
            .filter(result => result.canApprove)
            .map(result => result.update);
            
          console.log(`After filtering, user can approve ${filteredPendingUpdates.length} updates`);
        }
      }
      
      // Group by user for easier review
      const pendingByUser: Record<number, Array<any>> = {};
      
      for (const update of filteredPendingUpdates) {
        if (!pendingByUser[update.userId]) {
          pendingByUser[update.userId] = [];
        }
        pendingByUser[update.userId].push(update);
      }
      
      // Get user info for each group
      const result = await Promise.all(
        Object.entries(pendingByUser).map(async ([userIdStr, updates]) => {
          const userId = parseInt(userIdStr);
          const user = await storage.getUser(userId);
          return {
            user: user ? {
              id: user.id,
              username: user.username,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role
            } : { id: userId, username: `User ${userId}`, email: "Unknown" },
            pendingSkills: updates
          };
        })
      );
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching pending skill updates V2:", error);
      res.status(500).json({ message: "Error fetching pending skill updates", error });
    }
  });

  app.post("/api/admin/pending-skills/:id/approve", ensureApprover, async (req, res) => {
    try {
      const updateId = parseInt(req.params.id);
      const reviewerId = req.user!.id;
      const { notes } = req.body;
      
      // Approve the pending skill update using the V2 function
      const approvedSkill = await storage.approvePendingSkillUpdateV2(updateId, reviewerId, notes);
      
      // Get skill name for notification
      let skillName = approvedSkill.name || "your skill";
      
      // Create a notification for the user
      await storage.createNotification({
        user_id: approvedSkill.userId,
        type: "achievement",
        content: `Your skill ${skillName} has been approved`,
        related_user_skill_id: approvedSkill.id
      });
      
      res.json(approvedSkill);
    } catch (error) {
      res.status(500).json({ message: "Error approving skill update", error });
    }
  });

  app.post("/api/admin/pending-skills/:id/reject", ensureApprover, async (req, res) => {
    try {
      const updateId = parseInt(req.params.id);
      const reviewerId = req.user!.id;
      const { notes } = req.body;
      
      // Get the pending update before rejection for notification
      const pendingUpdate = await storage.getPendingSkillUpdateV2(updateId);
      
      if (!pendingUpdate) {
        return res.status(404).json({ message: "Pending skill update not found" });
      }
      
      // Reject the pending skill update using the V2 function
      await storage.rejectPendingSkillUpdateV2(updateId, reviewerId, notes);
      
      // Get skill name for notification
      let skillName = pendingUpdate.name || "your skill";
      
      // Create a notification for the user
      await storage.createNotification({
        user_id: pendingUpdate.userId,
        type: "achievement",
        content: `Your skill ${skillName} has been rejected. Please review the feedback.`,
        related_user_skill_id: pendingUpdate.userSkillId || undefined
      });
      
      res.status(200).json({ message: "Skill update rejected successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error rejecting skill update", error });
    }
  });

  /*
   * Project Management Routes
   */

  // Client routes
  app.get("/api/clients", ensureAuth, async (req, res) => {
    try {
      const clients = await storage.getAllClients();
      res.json(clients);
    } catch (error) {
      res.status(500).json({ message: "Error fetching clients", error });
    }
  });
  
  // Get all project resources
  app.get("/api/project-resources", ensureAuth, async (req, res) => {
    try {
      const resources = await storage.getAllProjectResources();
      res.json(resources);
    } catch (error) {
      res.status(500).json({ message: "Error fetching project resources", error });
    }
  });
  
  // ROUTE REMOVED: Duplicate of comprehensive endpoint below at line ~3990
  
  // This route has been replaced by a more comprehensive public version below
  // See the public implementation around line 2910

  app.get("/api/clients/:id", ensureAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const client = await storage.getClient(clientId);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      res.json(client);
    } catch (error) {
      res.status(500).json({ message: "Error fetching client", error });
    }
  });

  app.post("/api/clients", ensureSuperAdmin, async (req, res) => {
    try {
      const parsedData = insertClientSchema.safeParse(req.body);
      
      if (!parsedData.success) {
        return res.status(400).json({
          message: "Invalid client data",
          errors: parsedData.error.format()
        });
      }
      
      const client = await storage.createClient(parsedData.data);
      res.status(201).json(client);
    } catch (error) {
      res.status(500).json({ message: "Error creating client", error });
    }
  });

  app.patch("/api/clients/:id", ensureSuperAdmin, async (req, res) => {
    try {
      console.log("PATCH /api/clients/:id - Request body:", JSON.stringify(req.body, null, 2));
      const clientId = parseInt(req.params.id);
      console.log("PATCH /api/clients/:id - Client ID:", clientId);
      
      const client = await storage.getClient(clientId);
      
      if (!client) {
        console.log("PATCH /api/clients/:id - Client not found");
        return res.status(404).json({ message: "Client not found" });
      }
      
      console.log("PATCH /api/clients/:id - Current client:", JSON.stringify(client, null, 2));
      
      // Explicitly log the accountManagerId value
      console.log("PATCH /api/clients/:id - accountManagerId in request:", 
        req.body.accountManagerId !== undefined ? req.body.accountManagerId : "undefined");
      
      // IMPORTANT: Only include fields that exist in the clients table
      // Based on database schema: id, name, industry, contact_name, contact_email, contact_phone, website, logo_url, notes, created_at, updated_at, account_manager_id
      const sanitizedData: Record<string, any> = {};
      
      // Explicitly whitelist only the fields that exist in the database schema
      if (req.body.name !== undefined) sanitizedData.name = req.body.name;
      if (req.body.industry !== undefined) sanitizedData.industry = req.body.industry;
      if (req.body.website !== undefined) sanitizedData.website = req.body.website;
      if (req.body.notes !== undefined) sanitizedData.notes = req.body.notes;
      if (req.body.logoUrl !== undefined) sanitizedData.logoUrl = req.body.logoUrl;
      if (req.body.contactName !== undefined) sanitizedData.contactName = req.body.contactName;
      if (req.body.contactEmail !== undefined) sanitizedData.contactEmail = req.body.contactEmail;
      if (req.body.contactPhone !== undefined) sanitizedData.contactPhone = req.body.contactPhone;
      if (req.body.accountManagerId !== undefined) sanitizedData.accountManagerId = req.body.accountManagerId;
      
      // Log to ensure we have the right fields
      console.log("PATCH /api/clients/:id - Sanitized data:", JSON.stringify(sanitizedData, null, 2));
      
      // Extra validation to ensure we don't send non-existent fields
      const allowedFields = ['name', 'industry', 'website', 'notes', 'logoUrl', 'contactName', 'contactEmail', 'contactPhone', 'accountManagerId'];
      
      Object.keys(sanitizedData).forEach(key => {
        if (!allowedFields.includes(key)) {
          console.warn(`PATCH /api/clients/:id - Removing non-allowed field: ${key}`);
          delete sanitizedData[key];
        }
      });
      
      const updatedClient = await storage.updateClient(clientId, sanitizedData);
      console.log("PATCH /api/clients/:id - Updated client:", JSON.stringify(updatedClient, null, 2));
      
      res.json(updatedClient);
    } catch (error) {
      console.error("PATCH /api/clients/:id - Error:", error);
      res.status(500).json({ message: "Error updating client", error });
    }
  });

  app.delete("/api/clients/:id", ensureSuperAdmin, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const client = await storage.getClient(clientId);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      await storage.deleteClient(clientId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting client", error });
    }
  });
  
  // Client Projects endpoint
  app.get("/api/clients/:id/projects", ensureAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.id);
      const client = await storage.getClient(clientId);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      const projects = await storage.getClientProjects(clientId);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Error fetching client projects", error });
    }
  });

  // Project routes
  app.get("/api/projects", ensureAuth, async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Error fetching projects", error });
    }
  });
  
  // Get all project resources for Project Overview
  app.get("/api/project-resources", ensureAuth, async (req, res) => {
    try {
      // Get all resources from all projects using the optimized function
      const allResources = await storage.getAllProjectResources();
      res.json(allResources);
    } catch (error) {
      res.status(500).json({ message: "Error fetching all project resources", error });
    }
  });
  
  // ROUTE REMOVED: Duplicate of comprehensive endpoint below at line ~3990
  
  // This route has been replaced by a more comprehensive public version below
  // See the public implementation around line 2910

  app.get("/api/projects/:id", ensureAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      console.log(`Fetching project details for ID: ${projectId}`);
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        console.log(`Project with ID ${projectId} not found`);
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Log specifically the HR and Finance email fields
      console.log(`PROJECT ${projectId} DATA:`, {
        id: project.id,
        name: project.name,
        hrCoordinatorEmail: project.hrCoordinatorEmail || 'NOT SET IN DB',
        financeTeamEmail: project.financeTeamEmail || 'NOT SET IN DB'
      });
      
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Error fetching project", error });
    }
  });

  app.post("/api/projects", ensureSuperAdmin, async (req, res) => {
    try {
      console.log("Project creation request body:", JSON.stringify(req.body, null, 2));
      
      // Parse data with lenient schema validation
      const parsedData = insertProjectSchema.safeParse(req.body);
      
      if (!parsedData.success) {
        console.error("Project validation failed:", JSON.stringify(parsedData.error.format(), null, 2));
        return res.status(400).json({
          message: "Invalid project data",
          errors: parsedData.error.format()
        });
      }
      
      // Convert date strings to Date objects if needed
      const data = { ...parsedData.data };
      
      // Handle startDate conversion
      if (typeof data.startDate === 'string' && data.startDate) {
        data.startDate = new Date(data.startDate);
      }
      
      // Handle endDate conversion
      if (typeof data.endDate === 'string' && data.endDate) {
        data.endDate = new Date(data.endDate);
      }
      
      console.log("Processed project data:", JSON.stringify(data, null, 2));
      const project = await storage.createProject(data);
      console.log("Created project:", JSON.stringify(project, null, 2));
      res.status(201).json(project);
    } catch (error) {
      console.error("Server error during project creation:", error);
      res.status(500).json({ message: "Error creating project", error });
    }
  });

  app.patch("/api/projects/:id", ensureAdminOrProjectLead, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const updatedProject = await storage.updateProject(projectId, req.body);
      res.json(updatedProject);
    } catch (error) {
      res.status(500).json({ message: "Error updating project", error });
    }
  });

  app.delete("/api/projects/:id", ensureSuperAdmin, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      await storage.deleteProject(projectId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting project", error });
    }
  });

  // Project Resources routes
  app.get("/api/projects/:id/resources", ensureAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const resources = await storage.getProjectResources(projectId);
      res.json(resources);
    } catch (error) {
      res.status(500).json({ message: "Error fetching project resources", error });
    }
  });

  app.post("/api/projects/:id/resources", ensureAdminOrProjectLead, async (req, res) => {
    try {
      console.log("Project resource creation request body:", JSON.stringify(req.body, null, 2));
      
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Add projectId to request body for validation
      const requestData = {
        ...req.body,
        projectId
      };
      
      // Validate the request data
      const parsedData = insertProjectResourceSchema.safeParse(requestData);
      
      if (!parsedData.success) {
        console.error("Resource validation failed:", JSON.stringify(parsedData.error.format(), null, 2));
        return res.status(400).json({
          message: "Invalid resource data",
          errors: parsedData.error.format()
        });
      }
      
      // Convert date strings to Date objects if needed
      const data = { ...parsedData.data };
      
      // Handle startDate conversion
      if (typeof data.startDate === 'string' && data.startDate) {
        data.startDate = new Date(data.startDate);
      }
      
      // Handle endDate conversion
      if (typeof data.endDate === 'string' && data.endDate) {
        data.endDate = new Date(data.endDate);
      }
      
      // Fetch user's email from their profile and set it in the resource data
      try {
        const user = await storage.getUser(data.userId);
        if (user && user.email) {
          data.email = user.email;
          console.log(`Using email from user profile: ${data.email} for user ID: ${data.userId}`);
        } else {
          console.warn(`Could not find email for user ID: ${data.userId}`);
        }
      } catch (error) {
        console.error(`Error fetching user email for ID ${data.userId}:`, error);
      }
      
      console.log("Processed resource data with auto-generated email:", JSON.stringify(data, null, 2));
      const resource = await storage.createProjectResource(data);
      
      // Create resource history entry
      await storage.createProjectResourceHistory({
        projectId,
        userId: data.userId,
        action: "added",
        newRole: data.role,
        newAllocation: data.allocation,
        performedById: req.user!.id,
        note: "Added to project"
      });
      
      console.log("Created resource:", JSON.stringify(resource, null, 2));
      res.status(201).json(resource);
    } catch (error) {
      console.error("Server error during resource creation:", error);
      res.status(500).json({ message: "Error adding resource to project", error });
    }
  });

  app.delete("/api/projects/resources/:id", ensureAdminOrProjectLead, async (req, res) => {
    try {
      const resourceId = parseInt(req.params.id);
      const resource = await storage.getProjectResource(resourceId);
      
      if (!resource) {
        return res.status(404).json({ message: "Resource not found" });
      }
      
      // Create resource history entry before deleting
      await storage.createProjectResourceHistory({
        projectId: resource.projectId,
        userId: resource.userId,
        action: "removed",
        previousRole: resource.role,
        previousAllocation: resource.allocation,
        performedById: req.user!.id,
        note: "Removed from project"
      });
      
      await storage.deleteProjectResource(resourceId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error removing resource from project", error });
    }
  });

  // Project Skills routes
  app.get("/api/projects/:id/skills", ensureAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      console.log(`API request for project skills for project ID: ${projectId}`);
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Use the V2 function to get project skills from the V2 table with improved error handling
      const skills = await storage.getProjectSkillsV2(projectId);
      console.log(`Retrieved ${skills.length} project skills for project ${projectId}`);
      
      if (skills.length > 0) {
        // Examine the first skill to see if it has the expected properties
        const firstSkill = skills[0];
        console.log('Example skill structure:', JSON.stringify(firstSkill));
      }
      
      // Process skills to ensure all required properties are present
      const processedSkills = skills.map(skill => {
        // Make sure we have all required fields, particularly skillName and skillCategory
        return {
          ...skill,
          // Make sure skillName and skillCategory are present (for frontend)
          skillName: skill.skillName || skill.name || "Unknown",
          skillCategory: skill.skillCategory || skill.category || "Uncategorized",
        };
      });
      
      // Add diagnostic information to help debug any missing values
      const skillsWithDebug = processedSkills.map(skill => ({
        ...skill,
        _debug: {
          hasName: !!skill.name,
          hasCategory: !!skill.category,
          hasSkillName: !!skill.skillName,
          hasSkillCategory: !!skill.skillCategory,
          properties: Object.keys(skill),
          skillTemplateId: skill.skillTemplateId,
          requiredLevel: skill.requiredLevel
        }
      }));
      
      console.log(`Returning ${skillsWithDebug.length} project skills with debug info`);
      res.json(skillsWithDebug);
    } catch (error) {
      console.error(`Error fetching project skills for project ${req.params.id}:`, error);
      res.status(500).json({ 
        message: "Error fetching project skills", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/projects/:id/skills", ensureAdminOrProjectLead, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Make sure we have a skillTemplateId (references skill_templates.id)
      if (!req.body.skillTemplateId) {
        return res.status(400).json({ 
          message: "Missing required field: skillTemplateId is required" 
        });
      }
      
      // Use the V2 schema that expects skillTemplateId instead of skillId
      const parsedData = insertProjectSkillV2Schema.safeParse({
        ...req.body,
        projectId
      });
      
      if (!parsedData.success) {
        return res.status(400).json({
          message: "Invalid skill data",
          errors: parsedData.error.format()
        });
      }
      
      // Use the V2 function since we're now using the V2 schema
      const projectSkill = await storage.createProjectSkillV2(parsedData.data);
      res.status(201).json(projectSkill);
    } catch (error) {
      console.error("Error adding skill to project:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Error adding skill to project" 
      });
    }
  });

  app.delete("/api/projects/skills/:id", ensureAdminOrProjectLead, async (req, res) => {
    try {
      const projectSkillId = parseInt(req.params.id);
      if (isNaN(projectSkillId)) {
        return res.status(400).json({ message: "Invalid project skill ID" });
      }
      
      // Use the V2 function to delete project skills from the V2 table
      await storage.deleteProjectSkillV2(projectSkillId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing skill from project:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Error removing skill from project" 
      });
    }
  });

  // Project Resource History routes
  app.get("/api/projects/:id/resource-history", ensureAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const history = await storage.getProjectResourceHistory(projectId);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Error fetching project resource history", error });
    }
  });

  // Get user's project history
  app.get("/api/user/projects/history", ensureAuth, async (req, res) => {
    try {
      const history = await storage.getUserProjectHistory(req.user!.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Error fetching user project history", error });
    }
  });

  // Get projects for a specific user
  app.get("/api/users/:userId/projects", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Get user project resources
      const projectResources = await storage.getUserProjectResources(userId);
      
      // Fetch additional project details if needed
      const enhancedResources = await Promise.all(
        projectResources.map(async (resource) => {
          try {
            const project = await storage.getProject(resource.projectId);
            return {
              ...resource,
              projectName: project?.name || null,
              projectStatus: project?.status || null,
              clientId: project?.clientId || null
            };
          } catch (err) {
            console.error(`Error fetching project ${resource.projectId} details:`, err);
            return resource;
          }
        })
      );

      res.json(enhancedResources);
    } catch (error) {
      console.error("Error fetching user projects:", error);
      res.status(500).json({ message: "Error fetching user projects", error });
    }
  });
  
  // Get project history for a specific user
  app.get("/api/users/:userId/projects/history", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Verify this user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Admin can see any user's history, but regular users should only see their own
      const requestUser = req.user;
      if (!requestUser || (parseInt(String(requestUser.id)) !== userId && !requestUser.is_admin)) {
        return res.status(403).json({ 
          message: "Access denied", 
          details: "You can only view your own project history unless you have administrator privileges",
          errorCode: "UNAUTHORIZED_ACCESS" 
        });
      }

      // Get the user's project history
      const history = await storage.getUserProjectHistory(userId);
      
      // Enhance with project names for better display
      const enhancedHistory = await Promise.all(
        history.map(async (item) => {
          try {
            const project = await storage.getProject(item.projectId);
            return {
              ...item,
              projectName: project?.name || null
            };
          } catch (err) {
            console.error(`Error fetching project ${item.projectId} details:`, err);
            return item;
          }
        })
      );

      res.json(enhancedHistory);
    } catch (error) {
      console.error("Error fetching user project history:", error);
      res.status(500).json({ message: "Error fetching user project history", error });
    }
  });

  // ----- SKILL CATEGORY MANAGEMENT ROUTES -----
  
  // Get all skill categories - making this public for skill management UI
  app.get("/api/skill-categories", async (req, res) => {
    try {
      const categories = await storage.getAllSkillCategories();
      
      // Log to help with debugging
      console.log(`Found ${categories.length} skill categories`);
      
      res.json(categories);
    } catch (error) {
      console.error("Error fetching skill categories:", error);
      res.status(500).json({ message: "Error fetching skill categories", error });
    }
  });
  
  // Get a specific skill category
  app.get("/api/skill-categories/:id", ensureAuth, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      const category = await storage.getSkillCategory(categoryId);
      
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      res.json(category);
    } catch (error) {
      console.error("Error fetching skill category:", error);
      res.status(500).json({ message: "Error fetching skill category", error });
    }
  });
  
  // Create a new skill category (admin only)
  app.post("/api/skill-categories", ensureAdmin, async (req, res) => {
    try {
      // Validate the request
      const categoryData = await insertSkillCategorySchema.parseAsync(req.body);
      
      // Create the category
      const newCategory = await storage.createSkillCategory(categoryData);
      
      res.status(201).json(newCategory);
    } catch (error) {
      console.error("Error creating skill category:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating skill category", error });
    }
  });
  
  // Update a skill category (admin only)
  app.patch("/api/skill-categories/:id", ensureAdmin, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      // Check if category exists
      const existingCategory = await storage.getSkillCategory(categoryId);
      
      if (!existingCategory) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      // Update the category
      const updatedCategory = await storage.updateSkillCategory(categoryId, req.body);
      
      res.json(updatedCategory);
    } catch (error) {
      console.error("Error updating skill category:", error);
      res.status(500).json({ message: "Error updating skill category", error });
    }
  });
  
  // Delete a skill category (admin only)
  app.delete("/api/skill-categories/:id", ensureAdmin, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      // Check if category exists
      const existingCategory = await storage.getSkillCategory(categoryId);
      
      if (!existingCategory) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      // Delete the category
      await storage.deleteSkillCategory(categoryId);
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting skill category:", error);
      res.status(500).json({ message: "Error deleting skill category", error });
    }
  });
  
  // ----- SKILL SUBCATEGORY MANAGEMENT ROUTES -----
  
  // Get all subcategories - making this public for skill management UI
  app.get("/api/skill-subcategories", async (req, res) => {
    try {
      // Optional query param to filter by category ID
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      
      let subcategories;
      if (categoryId) {
        // Get subcategories for a specific category
        subcategories = await storage.getSubcategoriesByCategory(categoryId);
      } else {
        // Get all subcategories
        subcategories = await storage.getAllSkillSubcategories();
      }
      
      // Log to help with debugging
      console.log(`Found ${subcategories.length} skill subcategories${categoryId ? ` for category ${categoryId}` : ''}`);
      
      res.json(subcategories);
    } catch (error) {
      console.error("Error fetching skill subcategories:", error);
      res.status(500).json({ message: "Error fetching skill subcategories", error });
    }
  });
  
  // Get subcategories for a specific category - making this public for skill management UI
  app.get("/api/skill-categories/:id/subcategories", async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      // Check if category exists
      const category = await storage.getSkillCategory(categoryId);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      const subcategories = await storage.getSubcategoriesByCategory(categoryId);
      
      // Log to help with debugging
      console.log(`Found ${subcategories.length} subcategories for category ${categoryId} (${category.name})`);
      
      res.json(subcategories);
    } catch (error) {
      console.error("Error fetching subcategories for category:", error);
      res.status(500).json({ message: "Error fetching subcategories", error });
    }
  });
  
  // Get specific subcategory
  app.get("/api/skill-subcategories/:id", ensureAuth, async (req, res) => {
    try {
      const subcategoryId = parseInt(req.params.id);
      
      if (isNaN(subcategoryId)) {
        return res.status(400).json({ message: "Invalid subcategory ID" });
      }
      
      const subcategory = await storage.getSkillSubcategory(subcategoryId);
      
      if (!subcategory) {
        return res.status(404).json({ message: "Skill subcategory not found" });
      }
      
      res.json(subcategory);
    } catch (error) {
      console.error("Error fetching skill subcategory:", error);
      res.status(500).json({ message: "Error fetching skill subcategory", error });
    }
  });
  
  // Create a subcategory (admin only)
  app.post("/api/skill-subcategories", ensureAdmin, async (req, res) => {
    try {
      // Validate the request body
      const result = insertSkillSubcategorySchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ message: "Invalid request data", errors: result.error.errors });
      }
      
      // Make sure the parent category exists
      const category = await storage.getSkillCategory(result.data.categoryId);
      if (!category) {
        return res.status(404).json({ message: "Parent category not found" });
      }
      
      const subcategory = await storage.createSkillSubcategory(result.data);
      res.status(201).json(subcategory);
    } catch (error) {
      console.error("Error creating skill subcategory:", error);
      res.status(500).json({ message: "Error creating skill subcategory", error });
    }
  });
  
  // Update a subcategory (admin only)
  app.patch("/api/skill-subcategories/:id", ensureAdmin, async (req, res) => {
    try {
      const subcategoryId = parseInt(req.params.id);
      
      if (isNaN(subcategoryId)) {
        return res.status(400).json({ message: "Invalid subcategory ID" });
      }
      
      const existingSubcategory = await storage.getSkillSubcategory(subcategoryId);
      
      if (!existingSubcategory) {
        return res.status(404).json({ message: "Skill subcategory not found" });
      }
      
      const subcategory = await storage.updateSkillSubcategory(subcategoryId, req.body);
      res.json(subcategory);
    } catch (error) {
      console.error("Error updating skill subcategory:", error);
      res.status(500).json({ message: "Error updating skill subcategory", error });
    }
  });
  
  // Delete a subcategory (admin only)
  app.delete("/api/skill-subcategories/:id", ensureAdmin, async (req, res) => {
    try {
      const subcategoryId = parseInt(req.params.id);
      
      if (isNaN(subcategoryId)) {
        return res.status(400).json({ message: "Invalid subcategory ID" });
      }
      
      const existingSubcategory = await storage.getSkillSubcategory(subcategoryId);
      
      if (!existingSubcategory) {
        return res.status(404).json({ message: "Skill subcategory not found" });
      }
      
      await storage.deleteSkillSubcategory(subcategoryId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting skill subcategory:", error);
      res.status(500).json({ message: "Error deleting skill subcategory", error });
    }
  });
  
  // ----- SKILL APPROVER MANAGEMENT ROUTES -----
  
  // Get all skill approvers
  app.get("/api/skill-approvers", ensureAdmin, async (req, res) => {
    try {
      const approvers = await storage.getAllSkillApprovers();
      
      // Enhance with user display names
      const enhancedApprovers = await Promise.all(
        approvers.map(async (approver) => {
          try {
            const user = await storage.getUser(approver.userId);
            return {
              ...approver,
              userDisplayName: user?.displayName || user?.username || user?.email || `User #${approver.userId}`
            };
          } catch (err) {
            console.error(`Error fetching user ${approver.userId} for approver details:`, err);
            return approver;
          }
        })
      );
      
      res.json(enhancedApprovers);
    } catch (error) {
      console.error("Error fetching skill approvers:", error);
      res.status(500).json({ message: "Error fetching skill approvers", error });
    }
  });
  
  // Get approvers for a specific category
  app.get("/api/skill-categories/:id/approvers", ensureAuth, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      // Get approvers for the category, including those who can approve all
      const approvers = await storage.getApproversForCategory(categoryId);
      
      // Enhance with user display names
      const enhancedApprovers = await Promise.all(
        approvers.map(async (approver) => {
          try {
            const user = await storage.getUser(approver.userId);
            return {
              ...approver,
              userDisplayName: user?.displayName || user?.username || user?.email || `User #${approver.userId}`
            };
          } catch (err) {
            console.error(`Error fetching user ${approver.userId} for approver details:`, err);
            return approver;
          }
        })
      );
      
      res.json(enhancedApprovers);
    } catch (error) {
      console.error("Error fetching approvers for category:", error);
      res.status(500).json({ message: "Error fetching approvers for category", error });
    }
  });
  
  // Get approvers for a specific subcategory
  app.get("/api/skill-subcategories/:id/approvers", ensureAuth, async (req, res) => {
    try {
      const subcategoryId = parseInt(req.params.id);
      
      if (isNaN(subcategoryId)) {
        return res.status(400).json({ message: "Invalid subcategory ID" });
      }
      
      // Get approvers for the subcategory, including category-level and global approvers
      const approvers = await storage.getApproversForSubcategory(subcategoryId);
      
      // Enhance with user display names
      const enhancedApprovers = await Promise.all(
        approvers.map(async (approver) => {
          try {
            const user = await storage.getUser(approver.userId);
            return {
              ...approver,
              userDisplayName: user?.displayName || user?.username || user?.email || `User #${approver.userId}`
            };
          } catch (err) {
            console.error(`Error fetching user ${approver.userId} for approver details:`, err);
            return approver;
          }
        })
      );
      
      res.json(enhancedApprovers);
    } catch (error) {
      console.error("Error fetching approvers for subcategory:", error);
      res.status(500).json({ message: "Error fetching approvers for subcategory", error });
    }
  });
  
  // Create a new skill approver (admin only)
  app.post("/api/skill-approvers", ensureAdmin, async (req, res) => {
    try {
      // Validate the request
      const approverData = await insertSkillApproverSchema.parseAsync(req.body);
      
      // Check if the user exists
      const user = await storage.getUser(approverData.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if the category exists (if specified)
      if (approverData.categoryId) {
        const category = await storage.getSkillCategory(approverData.categoryId);
        if (!category) {
          return res.status(404).json({ message: "Category not found" });
        }
      }
      
      // Check if the skill template exists (if specified)
      if (approverData.skillTemplateId) {
        const skillTemplate = await storage.getSkillTemplate(approverData.skillTemplateId);
        if (!skillTemplate) {
          return res.status(404).json({ message: "Skill template not found" });
        }
      }

      // Create the approver
      const newApprover = await storage.createSkillApprover(approverData);
      
      res.status(201).json(newApprover);
    } catch (error) {
      console.error("Error creating skill approver:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid approver data", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating skill approver", error });
    }
  });
  
  // Generate and send a weekly resource report manually (admin only)
  // This is a duplicate route that has been removed to avoid conflicts
  
  // Delete a skill approver (admin only)
  app.delete("/api/skill-approvers/:id", ensureAdmin, async (req, res) => {
    try {
      const approverId = parseInt(req.params.id);
      
      if (isNaN(approverId)) {
        return res.status(400).json({ message: "Invalid approver ID" });
      }
      
      // Check if approver exists
      const existingApprover = await storage.getSkillApprover(approverId);
      
      if (!existingApprover) {
        return res.status(404).json({ message: "Approver not found" });
      }
      
      // Delete the approver
      await storage.deleteSkillApprover(approverId);
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting skill approver:", error);
      res.status(500).json({ message: "Error deleting skill approver", error });
    }
  });
  
  // Check if current user can approve a skill in a specific category
  app.get("/api/can-approve/:categoryId", ensureAuth, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const userId = req.user!.id;
      
      if (isNaN(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      
      const canApprove = await storage.canUserApproveSkill(userId, categoryId);
      
      res.json({ canApprove });
    } catch (error) {
      console.error("Error checking approval permission:", error);
      res.status(500).json({ message: "Error checking approval permission", error });
    }
  });
  
  // Check if current user is an approver (has approval rights for any category/skill)
  app.get("/api/user/is-approver", ensureAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const isApprover = await storage.isUserApprover(userId);
      
      res.json(isApprover);
    } catch (error) {
      console.error("Error checking if user is an approver:", error);
      res.status(500).json({ message: "Error checking approver status", error });
    }
  });
  
  // Check if current user is a project lead for a specific project
  app.get("/api/user/is-project-lead/:projectId", ensureAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }
      
      const userId = req.user!.id;
      const userEmail = req.user?.email || 'unknown';
      
      console.log(`[PROJECT LEAD CHECK] Checking if user ${userId} (${userEmail}) is a project lead for project ${projectId}...`);
      
      // Check if user is a super admin first (they can do everything)
      const isSuperAdmin = req.user!.email === "admin@atyeti.com";
      
      // Check if user is a regular admin (to distinguish in frontend)
      const isAdmin = isUserAdmin(req.user);
      
      // Check if user is a project lead for this project
      const isProjectLead = await isUserProjectLead(userId, projectId);
      
      // A user has edit permissions if they are either a super admin or a project lead
      const canEdit = isSuperAdmin || isProjectLead;
      
      console.log(`[PROJECT LEAD CHECK] Results for user ${userId}: isSuperAdmin=${isSuperAdmin}, isAdmin=${isAdmin}, isProjectLead=${isProjectLead}, canEdit=${canEdit}`);
      
      res.json({ 
        canEdit,
        isSuperAdmin,
        isAdmin,
        isProjectLead
      });
    } catch (error) {
      console.error(`Error checking if user is project lead:`, error);
      res.status(500).json({ message: "Failed to check project lead status", error: error instanceof Error ? error.message : String(error) });
    }
  });
  
  // Check if current user can approve a skill in a specific subcategory
  app.get("/api/can-approve/:categoryId/:subcategoryId", ensureAuth, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const subcategoryId = parseInt(req.params.subcategoryId);
      const userId = req.user!.id;
      
      if (isNaN(categoryId) || isNaN(subcategoryId)) {
        return res.status(400).json({ message: "Invalid category or subcategory ID" });
      }
      
      const canApprove = await storage.canUserApproveSkill(userId, categoryId, subcategoryId);
      
      res.json({ canApprove });
    } catch (error) {
      console.error("Error checking subcategory approval permission:", error);
      res.status(500).json({ message: "Error checking subcategory approval permission", error });
    }
  });
  
  // Check if current user can approve a specific skill template
  app.get("/api/can-approve-skill/:skillTemplateId", ensureAuth, async (req, res) => {
    try {
      const skillTemplateId = parseInt(req.params.skillTemplateId);
      const userId = req.user!.id;
      
      if (isNaN(skillTemplateId)) {
        return res.status(400).json({ message: "Invalid skill template ID" });
      }
      
      // Get the skill template to determine its category
      const skillTemplate = await storage.getSkillTemplate(skillTemplateId);
      if (!skillTemplate) {
        return res.status(404).json({ message: "Skill template not found" });
      }
      
      // Use the category and subcategory from the skill template
      const categoryId = skillTemplate.categoryId || 0;
      const subcategoryId = skillTemplate.subcategoryId;
      
      // Check approval permission, passing the skillTemplateId directly
      const canApprove = await storage.canUserApproveSkill(userId, categoryId, subcategoryId, skillTemplateId);
      
      res.json({ canApprove });
    } catch (error) {
      console.error("Error checking skill template approval permission:", error);
      res.status(500).json({ message: "Error checking skill template approval permission", error });
    }
  });

  // Hierarchical data endpoints for admin dashboard visualizations
  
  // Get all clients for Project Overview
  app.get("/api/clients", ensureAuth, async (req, res) => {
    try {
      const clients = await storage.getAllClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Error fetching clients", error: String(error) });
    }
  });
  
  // Get all projects for Project Overview
  app.get("/api/projects", ensureAuth, async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Error fetching projects", error: String(error) });
    }
  });
  
  // Get all project resources
  app.get("/api/project-resources", ensureAuth, async (req, res) => {
    try {
      const resources = await storage.getAllProjectResources();
      res.json(resources);
    } catch (error) {
      console.error("Error fetching project resources:", error);
      res.status(500).json({ message: "Error fetching project resources", error: String(error) });
    }
  });
  
  // Get all project skills
  app.get("/api/project-skills", ensureAuth, async (req, res) => {
    try {
      const skills = await storage.getAllProjectSkills();
      res.json(skills);
    } catch (error) {
      console.error("Error fetching project skills:", error);
      res.status(500).json({ message: "Error fetching project skills", error: String(error) });
    }
  });
  
  // Removed duplicate route for /api/skill-categories
  // The route is now defined as public above
  
  // Removed duplicate route for /api/skill-subcategories
  // The route is now defined as public above
  
  // Get all skills for Skill Overview
  // Removed duplicate endpoint for /api/all-skills
  // The primary endpoint is defined earlier in this file, 
  // returning user_skills converted to legacy format

  // Admin API endpoints for hierarchical data (project and skill overviews)
  app.get("/api/admin/project-hierarchy", ensureAdmin, async (req, res) => {
    try {
      console.log("Fetching project hierarchy data...");
      
      // Get all clients, projects, resources, and user skills
      const clients = await storage.getAllClients();
      console.log(`Fetched ${clients.length} clients`);
      
      const projects = await storage.getAllProjects();
      console.log(`Fetched ${projects.length} projects`);
      
      const resources = await storage.getAllProjectResources();
      console.log(`Fetched ${resources.length} resources`);
      
      const users = await storage.getAllUsers();
      console.log(`Fetched ${users.length} users`);
      
      // Use getAllUserSkills (new schema) instead of getAllSkills (legacy)
      const userSkills = await storage.getAllUserSkills();
      const skills = userSkills.map(us => storage.userSkillToLegacySkill(us));
      console.log(`Fetched ${skills.length} user skills (converted from user_skills table)`);
      
      // Get project required skills
      console.log("Fetching project skills...");
      // Try to get skills from the V2 table first, then fall back to legacy table if needed
      let projectSkills = [];
      try {
        projectSkills = await storage.getAllProjectSkillsV2();
        console.log(`Fetched ${projectSkills.length} V2 project skills`);
      } catch (error) {
        console.warn(`Error fetching V2 project skills, falling back to legacy table: ${error.message}`);
        projectSkills = await storage.getAllProjectSkills();
        console.log(`Fetched ${projectSkills.length} legacy project skills`);
      }
      
      // Add debugging information
      console.log("Sample project skill:", projectSkills.length > 0 ? JSON.stringify(projectSkills[0]) : "No project skills found");

      // Build the hierarchy: clients -> projects -> resources -> skills
      console.log("Building hierarchy data...");
      const hierarchy = clients.map(client => {
        const clientProjects = projects.filter(project => project.clientId === client.id);
        console.log(`Client ${client.id} (${client.name}) has ${clientProjects.length} projects`);
        
        return {
          ...client,
          projects: clientProjects.map(project => {
            // Get project required skills
            const projectRequiredSkills = projectSkills.filter(ps => ps.projectId === project.id);
            console.log(`Project ${project.id} (${project.name}) has ${projectRequiredSkills.length} required skills`);
            
            // Get project resources
            const projectResources = resources.filter(resource => resource.projectId === project.id);
            console.log(`Project ${project.id} (${project.name}) has ${projectResources.length} resources`);
            
            return {
              ...project,
              // Add project skills with proper mapping for display
              skills: projectRequiredSkills.map(skill => ({
                ...skill,
                // Ensure these specific properties exist for the frontend
                skillName: skill.skillName || skill.name || "Unknown",
                skillCategory: skill.skillCategory || skill.category || "Uncategorized"
              })) || [],
              resources: projectResources.map(resource => {
                // Find the user for this resource
                const user = users.find(u => u.id === resource.userId);
                // Find user skills
                const userSkills = skills.filter(skill => skill.userId === resource.userId);
                
                return {
                  ...resource,
                  user: user || { id: resource.userId, username: "Unknown User" },
                  skills: userSkills || []
                };
              })
            };
          })
        };
      });

      console.log("Sending hierarchy response...");
      res.json(hierarchy);
    } catch (err) {
      const error = err as Error;
      console.error("Error fetching project hierarchy:", error);
      console.error("Stack trace:", error.stack);
      res.status(500).json({ message: "Error fetching project hierarchy", error: error.message });
    }
  });

  app.get("/api/admin/skill-hierarchy", ensureAdmin, async (req, res) => {
    try {
      // Get all categories, subcategories, skills, and users
      const categories = await storage.getAllSkillCategories();
      const subcategories = await storage.getAllSkillSubcategories();
      
      // Use getAllUserSkills (new schema) instead of getAllSkills (legacy)
      const userSkills = await storage.getAllUserSkills();
      const skills = userSkills.map(us => storage.userSkillToLegacySkill(us));
      console.log(`Fetched ${skills.length} user skills (converted from user_skills table for hierarchy)`);
      
      const users = await storage.getAllUsers();

      // Log some debugging information
      console.log(`Building skill hierarchy with ${skills.length} skills, ${categories.length} categories, and ${subcategories.length} subcategories`);
      
      // Sample checking of skills data
      if (skills.length > 0) {
        const sampleSkill = skills[0];
        console.log(`Sample skill data: ${JSON.stringify({
          id: sampleSkill.id,
          name: sampleSkill.name,
          categoryId: sampleSkill.categoryId,
          subcategoryId: sampleSkill.subcategoryId,
          category: sampleSkill.category,
          categoryName: sampleSkill.categoryName
        })}`);
      }
      
      // Build the hierarchy: categories -> subcategories -> skills -> users
      const hierarchy = categories.map(category => ({
        ...category,
        subcategories: subcategories
          .filter(sub => sub.categoryId === category.id)
          .map(subcategory => {
            // Get skills for this category and subcategory
            // Improved filtering to handle both direct and name-based matching
            const subSkills = skills.filter(skill => {
              // Match by ID first (preferred)
              if (skill.categoryId === category.id && skill.subcategoryId === subcategory.id) {
                return true;
              }
              
              // Fallback to matching by name if IDs aren't set
              if (!skill.categoryId && !skill.subcategoryId) {
                return (
                  (skill.categoryName === category.name || skill.category === category.name) && 
                  skill.subcategoryName === subcategory.name
                );
              }
              
              return false;
            });
            
            // Group skills by name to avoid duplicates
            const skillsMap = new Map();
            
            // Process each skill to prepare them with users
            subSkills.forEach(skill => {
              const user = users.find(u => u.id === skill.userId);
              const userWithLevel = user ? {
                ...user,
                skillLevel: skill.level
              } : null;
              
              const skillKey = skill.name;
              if (skillsMap.has(skillKey)) {
                // Add user to existing skill's users array
                if (userWithLevel) {
                  skillsMap.get(skillKey).users.push(userWithLevel);
                }
              } else {
                // Create new skill entry with users array
                skillsMap.set(skillKey, {
                  ...skill,
                  users: userWithLevel ? [userWithLevel] : []
                });
              }
            });
            
            return {
              ...subcategory,
              skills: Array.from(skillsMap.values())
            };
          })
      }));

      res.json(hierarchy);
    } catch (err) {
      const error = err as Error;
      console.error("Error fetching skill hierarchy:", error);
      res.status(500).json({ message: "Error fetching skill hierarchy", error: error.message });
    }
  });

  // Custom handler for user skills endpoint that supports the description field
  app.post("/api/user/skills", ensureAuth, async (req, res) => {
    try {
      console.log("Processing /api/user/skills request with Node.js handler");
      console.log("Request body:", JSON.stringify(req.body, null, 2));
      
      const userId = req.user!.id;
      
      // Extract skill template ID if present
      const skillTemplateId = parseInt(req.body.skillTemplateId || req.body.skill_template_id || '0');
      
      // Variables to store template details
      let templateName = '';
      let templateCategory = '';
      let templateSubcategory = '';
      let categoryId = null;
      let subcategoryId = null;
      
      // If skill template ID is provided, fetch template details
      if (skillTemplateId > 0) {
        try {
          const template = await storage.getSkillTemplate(skillTemplateId);
          
          if (template) {
            templateName = template.name;
            templateCategory = template.category;
            categoryId = template.categoryId;
            subcategoryId = template.subcategoryId;
            
            // Try to get subcategory name if subcategoryId is provided
            if (template.subcategoryId) {
              try {
                const subcategory = await storage.getSkillSubcategoryById(template.subcategoryId);
                if (subcategory) {
                  templateSubcategory = subcategory.name;
                }
              } catch (subcategoryErr) {
                console.error("Error getting subcategory details:", subcategoryErr);
              }
            }
          }
        } catch (err) {
          console.error("Error getting skill template details:", err);
        }
      }
      
      // Create user skill data with description field support
      const userSkillData: any = {
        user_id: userId,
        name: templateName || req.body.name || '',
        category: templateCategory || req.body.category || '',
        subcategory: templateSubcategory || req.body.subcategory || '',
        skill_template_id: skillTemplateId,
        level: req.body.level,
        description: req.body.description || null, // Support for description field
        certification: req.body.certification || null,
        credly_link: req.body.credlyLink || req.body.credly_link || null,
        notes: req.body.notes || null,
        category_id: categoryId || req.body.category_id || null,
        subcategory_id: subcategoryId || req.body.subcategory_id || null
      };
      
      console.log("Creating user skill with data:", userSkillData);
      
      // Create skill history entry
      const historyData = {
        user_id: userId,
        name: userSkillData.name,
        category: userSkillData.category,
        subcategory: userSkillData.subcategory || '',
        level: userSkillData.level,
        description: userSkillData.description || null,
        certification: userSkillData.certification || null,
        credly_link: userSkillData.credly_link || null,
        notes: userSkillData.notes || null,
        change_note: req.body.changeNote || req.body.change_note || 'Added skill',
        category_id: userSkillData.category_id,
        subcategory_id: userSkillData.subcategory_id,
        skill_template_id: skillTemplateId
      };
      
      // Check if skill needs approval
      const needsApproval = await storage.checkSkillNeedsApproval(userSkillData.category);
      
      if (needsApproval) {
        // Create pending skill update
        const pendingSkillDataV2: any = {
          user_id: userId,
          name: userSkillData.name,
          category: userSkillData.category,
          subcategory: userSkillData.subcategory || '',
          skill_template_id: skillTemplateId,
          level: userSkillData.level,
          description: userSkillData.description || null, // Support for description field
          certification: userSkillData.certification || null,
          credly_link: userSkillData.credly_link || null,
          notes: userSkillData.notes || null,
          status: "pending",
          submitted_at: new Date(),
          is_update: false,
          category_id: userSkillData.category_id,
          subcategory_id: userSkillData.subcategory_id
        };
        
        console.log("Creating pending skill update with data:", pendingSkillDataV2);
        
        try {
          const pendingSkillUpdate = await storage.createPendingSkillUpdateV2(pendingSkillDataV2);
          
          // Notify approvers
          const admins = await storage.getAllAdmins();
          
          if (admins && admins.length > 0) {
            for (const admin of admins) {
              await storage.createNotification({
                user_id: admin.id,
                type: "pending_approval",
                message: `New skill approval request from ${req.user!.email}: ${userSkillData.name} (${userSkillData.level})`,
                link: "/admin/pending-approvals",
                is_read: false,
                created_at: new Date()
              });
            }
          }
          
          // Get specific skill approvers if they exist
          try {
            const approvers = await storage.getSkillApproversForCategory(userSkillData.category);
            
            if (approvers && approvers.length > 0) {
              for (const approver of approvers) {
                // Don't create duplicate notifications for admins who are also approvers
                if (!admins.some(admin => admin.id === approver.userId)) {
                  await storage.createNotification({
                    user_id: approver.userId,
                    type: "pending_approval",
                    message: `New skill approval request from ${req.user!.email}: ${userSkillData.name} (${userSkillData.level})`,
                    link: "/approver/pending-approvals",
                    is_read: false,
                    created_at: new Date()
                  });
                }
              }
            }
          } catch (approverErr) {
            console.error("Error notifying skill approvers:", approverErr);
          }
          
          res.status(202).json({
            message: "Skill submitted for approval",
            pendingApproval: true,
            pendingId: pendingSkillUpdate.id
          });
        } catch (pendingErr) {
          console.error("Error creating pending skill update:", pendingErr);
          res.status(500).json({ message: "Failed to submit skill for approval" });
        }
      } else {
        // Create user skill directly as it doesn't need approval
        try {
          // First create skill history entry
          await storage.createSkillHistoryV2(historyData);
          
          // Then create the actual skill
          const userSkill = await storage.createUserSkill(userSkillData);
          
          res.status(201).json(userSkill);
        } catch (err) {
          console.error("Error creating user skill:", err);
          res.status(500).json({ message: "Failed to create skill", error: err });
        }
      }
    } catch (error) {
      console.error("Error processing user skill creation:", error);
      res.status(500).json({ message: "Internal server error", error });
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);
  return httpServer;
}