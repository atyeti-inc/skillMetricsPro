import { 
  User, InsertUser, Skill, InsertSkill, 
  UserSkill, InsertUserSkill,
  SkillHistory, InsertSkillHistory, 
  SkillHistoryV2, InsertSkillHistoryV2,
  ProfileHistory, InsertProfileHistory,
  Endorsement, InsertEndorsement,
  EndorsementV2, InsertEndorsementV2,
  Notification, InsertNotification,
  SkillTemplate, InsertSkillTemplate,
  SkillTarget, InsertSkillTarget,
  PendingSkillUpdate, InsertPendingSkillUpdate,
  PendingSkillUpdateV2, InsertPendingSkillUpdateV2,
  Client, InsertClient,
  Project, InsertProject,
  ProjectResource, InsertProjectResource,
  ProjectSkill, InsertProjectSkill,
  ProjectSkillV2, InsertProjectSkillV2,
  ProjectResourceHistory, InsertProjectResourceHistory,
  SkillCategory, InsertSkillCategory,
  SkillSubcategory, InsertSkillSubcategory,
  SkillApprover, InsertSkillApprover,
  ReportSettings, InsertReportSettings,
  users
} from "@shared/schema";
import { getTableColumns } from "drizzle-orm";
import util from "util";
import session from "express-session";
import { Store } from "express-session";
import createMemoryStore from "memorystore";
import connectPg from "connect-pg-simple";
import { pool } from "./db"; // Import the pool from db.ts
import { sendSkillApprovedEmail, sendSkillRejectedEmail } from "./email"; // Import email functions

const MemoryStore = createMemoryStore(session);
const PostgresSessionStore = connectPg(session);

// Server-internal type that includes credentials for authentication verification only
export type UserWithCredentials = typeof users.$inferSelect & {
  isAdmin?: boolean;
};

// Derived safe user columns excluding credentials to prevent SQL leakage
export const SAFE_USER_COLUMNS = Object.values(getTableColumns(users))
  .map(col => col.name)
  .filter(name => name !== 'password')
  .join(', ');

export const SAFE_USER_COLUMNS_PREFIXED = Object.values(getTableColumns(users))
  .map(col => `u.${col.name}`)
  .filter(col => col !== 'u.password')
  .join(', ');

class SafeUserCredentials {
  [key: string]: any;

  constructor(data: any) {
    Object.assign(this, data);
  }

  toJSON() {
    const copy = { ...this };
    if ("password" in copy) {
      copy.password = "[REDACTED]";
    }
    return copy;
  }

  [util.inspect.custom]() {
    const copy = { ...this };
    if ("password" in copy) {
      copy.password = "[REDACTED]";
    }
    return copy;
  }
}

function attachCredentialRedaction(user: any): UserWithCredentials {
  if (!user) return user;
  return new SafeUserCredentials(user) as unknown as UserWithCredentials;
}

// Storage interface with all required CRUD operations
export interface IStorage {
  // Report Settings Methods
  getReportSettings(): Promise<ReportSettings[]>;
  getReportSettingById(id: number): Promise<ReportSettings | undefined>;
  getReportSettingsByClient(clientId: number): Promise<ReportSettings[]>;
  createReportSetting(data: InsertReportSettings): Promise<ReportSettings>;
  updateReportSetting(id: number, data: Partial<InsertReportSettings>): Promise<ReportSettings>;
  deleteReportSetting(id: number): Promise<boolean>;
  
  // Category and subcategory operations
  getSkillCategoryByName(name: string): Promise<SkillCategory | undefined>;
  getSkillSubcategoryByNameAndCategory(name: string, categoryId: number): Promise<SkillSubcategory | undefined>;
  getSkillTemplateByNameAndCategory(name: string, categoryId: number | null): Promise<SkillTemplate | undefined>;
  getAllAdmins(): Promise<User[]>;
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserAuthCredentialsByEmail(email: string): Promise<UserWithCredentials | undefined>;
  getUserAuthCredentialsById(id: number): Promise<UserWithCredentials | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  updateUserPassword(id: number, hashedPassword: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getUsersByClientId(clientId: number): Promise<User[]>;
  getUsersByProjectId(projectId: number): Promise<User[]>;
  deleteUser(id: number): Promise<void>;
  
  // Legacy Skill operations (for backward compatibility)
  getUserSkills(userId: number): Promise<Skill[]>;
  getSkill(id: number): Promise<Skill | undefined>;
  createSkill(skill: InsertSkill): Promise<Skill>;
  updateSkill(id: number, data: Partial<Skill>): Promise<Skill>;
  deleteSkill(id: number): Promise<void>;
  getAllSkills(): Promise<Skill[]>;
  searchSkills(query: string): Promise<Skill[]>;
  

  
  // New UserSkill operations (for updated schema)
  getUserSkillsByUser(userId: number): Promise<UserSkill[]>;
  getUserSkillById(id: number): Promise<UserSkill | undefined>;
  createUserSkill(userSkill: InsertUserSkill): Promise<UserSkill>;
  updateUserSkill(id: number, data: Partial<UserSkill>): Promise<UserSkill>;
  deleteUserSkill(id: number): Promise<void>;
  getAllUserSkills(): Promise<UserSkill[]>;
  
  // Skill category operations
  getAllSkillCategories(): Promise<SkillCategory[]>;
  getSkillCategory(id: number): Promise<SkillCategory | undefined>;
  createSkillCategory(category: InsertSkillCategory): Promise<SkillCategory>;
  updateSkillCategory(id: number, data: Partial<SkillCategory>): Promise<SkillCategory>;
  deleteSkillCategory(id: number): Promise<void>;
  
  // Skill subcategory operations
  getAllSkillSubcategories(): Promise<SkillSubcategory[]>;
  getSubcategoriesByCategory(categoryId: number): Promise<SkillSubcategory[]>;
  getSkillSubcategory(id: number): Promise<SkillSubcategory | undefined>;
  createSkillSubcategory(subcategory: InsertSkillSubcategory): Promise<SkillSubcategory>;
  updateSkillSubcategory(id: number, data: Partial<SkillSubcategory>): Promise<SkillSubcategory>;
  deleteSkillSubcategory(id: number): Promise<void>;
  
  // Skill approver operations
  getAllSkillApprovers(): Promise<SkillApprover[]>;
  getSkillApprover(id: number): Promise<SkillApprover | undefined>;
  getSkillApproversByUser(userId: number): Promise<SkillApprover[]>;
  getApproversForCategory(categoryId: number): Promise<SkillApprover[]>;
  getApproversForSubcategory(subcategoryId: number): Promise<SkillApprover[]>;
  createSkillApprover(approver: InsertSkillApprover): Promise<SkillApprover>;
  deleteSkillApprover(id: number): Promise<void>;
  canUserApproveSkill(userId: number, categoryId: number, subcategoryId?: number, skillTemplateId?: number): Promise<boolean>;
  
  // Skill history operations
  getSkillHistory(skillId: number): Promise<SkillHistory[]>;
  getUserSkillHistory(userId: number): Promise<SkillHistory[]>;
  getUserSkillHistoryFromAllSources(userId: number): Promise<SkillHistory[]>;
  getAllSkillHistories(): Promise<SkillHistory[]>;
  getAllSkillHistoriesFromAllSources(): Promise<SkillHistory[]>;
  createSkillHistory(history: InsertSkillHistory): Promise<SkillHistory>;
  
  // Profile history operations
  getUserProfileHistory(userId: number): Promise<ProfileHistory[]>;
  createProfileHistory(history: InsertProfileHistory): Promise<ProfileHistory>;
  
  // Endorsement operations
  getSkillEndorsements(skillId: number): Promise<Endorsement[]>;
  getUserEndorsements(userId: number): Promise<Endorsement[]>;
  getUserEndorsementsV2(userId: number): Promise<EndorsementV2[]>;
  createEndorsement(endorsement: InsertEndorsement): Promise<Endorsement>;
  createEndorsementV2(endorsement: InsertEndorsementV2): Promise<EndorsementV2>;
  deleteEndorsement(endorsementId: number): Promise<void>;
  deleteEndorsementV2(endorsementId: number): Promise<void>;
  
  // Notification operations
  getUserNotifications(userId: number, unreadOnly?: boolean): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(notificationId: number): Promise<void>;
  markAllNotificationsAsRead(userId: number): Promise<void>;
  
  // Skill Template operations
  getAllSkillTemplates(): Promise<SkillTemplate[]>;
  getSkillTemplate(id: number): Promise<SkillTemplate | undefined>;
  findSkillTemplate(name: string, categoryId: number): Promise<SkillTemplate | null>;
  createSkillTemplate(template: InsertSkillTemplate): Promise<SkillTemplate>;
  updateSkillTemplate(id: number, data: Partial<SkillTemplate>): Promise<SkillTemplate>;
  deleteSkillTemplate(id: number, forceCascade?: boolean): Promise<{ deletedUserSkills: number; deletedProjectSkills: number; deletedTemplate: boolean }>;
  
  // Skill Target operations
  getAllSkillTargets(): Promise<SkillTarget[]>;
  getSkillTarget(id: number): Promise<SkillTarget | undefined>;
  createSkillTarget(target: InsertSkillTarget): Promise<SkillTarget>;
  updateSkillTarget(id: number, data: Partial<SkillTarget>): Promise<SkillTarget>;
  deleteSkillTarget(id: number): Promise<void>;
  getSkillTargetSkills(targetId: number): Promise<number[]>;
  addSkillToTarget(targetId: number, skillId: number): Promise<void>;
  removeSkillFromTarget(targetId: number, skillId: number): Promise<void>;
  getSkillTargetUsers(targetId: number): Promise<number[]>;
  addUserToTarget(targetId: number, userId: number): Promise<void>;
  removeUserFromTarget(targetId: number, userId: number): Promise<void>;
  
  // Pending Skill Updates operations
  getPendingSkillUpdates(): Promise<PendingSkillUpdate[]>;
  getPendingSkillUpdatesByUser(userId: number): Promise<PendingSkillUpdate[]>;
  getPendingSkillUpdate(id: number): Promise<PendingSkillUpdate | undefined>;
  createPendingSkillUpdate(update: InsertPendingSkillUpdate): Promise<PendingSkillUpdate>;
  approvePendingSkillUpdate(id: number, reviewerId: number, notes?: string): Promise<Skill>;
  rejectPendingSkillUpdate(id: number, reviewerId: number, notes?: string): Promise<void>;
  
  // Pending Skill Updates V2 operations (working with user_skills)
  getPendingSkillUpdatesV2(): Promise<PendingSkillUpdateV2[]>;
  getPendingSkillUpdatesByUserV2(userId: number): Promise<PendingSkillUpdateV2[]>;
  getPendingSkillUpdateV2(id: number): Promise<PendingSkillUpdateV2 | undefined>;
  createPendingSkillUpdateV2(update: InsertPendingSkillUpdateV2): Promise<PendingSkillUpdateV2>;
  approvePendingSkillUpdateV2(id: number, reviewerId: number, notes?: string): Promise<UserSkill>;
  rejectPendingSkillUpdateV2(id: number, reviewerId: number, notes?: string): Promise<void>;
  
  // Client operations
  getAllClients(): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, data: Partial<Client>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  searchClients(query: string): Promise<Client[]>;
  
  // Project operations
  getAllProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<Project>): Promise<Project>;
  deleteProject(id: number): Promise<void>;
  getUserProjects(userId: number): Promise<Project[]>;
  getClientProjects(clientId: number): Promise<Project[]>;
  searchProjects(query: string): Promise<Project[]>;
  
  // Project Resources operations
  getProjectResources(projectId: number): Promise<ProjectResource[]>;
  getUserProjectResources(userId: number): Promise<ProjectResource[]>;
  getProjectResource(id: number): Promise<ProjectResource | undefined>;
  createProjectResource(resource: InsertProjectResource): Promise<ProjectResource>;
  updateProjectResource(id: number, data: Partial<ProjectResource>): Promise<ProjectResource>;
  deleteProjectResource(id: number): Promise<void>;
  // For Project Overview feature
  getAllProjectResources(): Promise<ProjectResource[]>;
  
  // Project Skills operations
  getProjectSkills(projectId: number): Promise<ProjectSkill[]>;
  getSkillProjects(skillId: number): Promise<ProjectSkill[]>;
  createProjectSkill(projectSkill: InsertProjectSkill): Promise<ProjectSkill>;
  deleteProjectSkill(id: number): Promise<void>;
  // For Project Overview feature
  getAllProjectSkills(): Promise<ProjectSkill[]>;
  getUserSkillProjects(userSkillId: number): Promise<ProjectSkill[]>;
  
  // Project Resource History operations
  getProjectResourceHistory(projectId: number): Promise<ProjectResourceHistory[]>;
  getUserProjectHistory(userId: number): Promise<ProjectResourceHistory[]>;
  createProjectResourceHistory(history: InsertProjectResourceHistory): Promise<ProjectResourceHistory>;
  

  
  // UserSkill operations
  getUserSkillsByUser(userId: number): Promise<UserSkill[]>;
  getUserSkillById(id: number): Promise<UserSkill | undefined>;
  createUserSkill(userSkill: InsertUserSkill): Promise<UserSkill>;
  updateUserSkill(id: number, data: Partial<UserSkill>): Promise<UserSkill>;
  deleteUserSkill(id: number): Promise<void>;
  getAllUserSkills(): Promise<UserSkill[]>;
  
  // Session store
  sessionStore: Store;
}

// PostgreSQL implementation
export class PostgresStorage implements IStorage {
  sessionStore: Store;

  constructor() {
    // Use the shared pool from db.ts
    this.sessionStore = new PostgresSessionStore({
      pool: pool as any, // Type conversion needed due to differences between pg Pool and neon Pool
      createTableIfMissing: true,
      tableName: 'session' // Explicitly name the session table
    });
  }

  /**
   * Helper function to convert snake_case properties to camelCase and standardize values
   * Example: { user_id: 1, first_name: "John" } becomes { userId: 1, firstName: "John" }
   */
  private snakeToCamel(obj: any): any {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(v => this.snakeToCamel(v));
    }
    
    return Object.keys(obj).reduce((accumulator, key) => {
      // Handle specific cases first
      let camelKey = key;
      
      // Special case for account_manager_id specifically
      if (key === 'account_manager_id') {
        camelKey = 'accountManagerId';
        console.log("🔍 Found account_manager_id, converted to accountManagerId");
      }
      // Special cases for other known fields
      else if (key === 'credly_link') {
        camelKey = 'credlyLink';
      } else if (key === 'certification_date') {
        camelKey = 'certificationDate';
      } else if (key === 'expiration_date') {
        camelKey = 'expirationDate';
      } else if (key === 'skill_id') {
        camelKey = 'skillId';
      } else if (key === 'user_id') {
        camelKey = 'userId'; 
      } else if (key === 'is_update') {
        camelKey = 'isUpdate';
      } else if (key === 'category_type') {
        camelKey = 'categoryType';
      } 
      // Project email fields
      else if (key === 'hr_coordinator_email') {
        camelKey = 'hrCoordinatorEmail';
        console.log("🔍 Found hr_coordinator_email, converted to hrCoordinatorEmail");
      } else if (key === 'finance_team_email') {
        camelKey = 'financeTeamEmail';
        console.log("🔍 Found finance_team_email, converted to financeTeamEmail");
      } else if (key === 'project_lead_email') {
        camelKey = 'projectLeadEmail';
      } else if (key === 'client_engagement_lead_email') {
        camelKey = 'clientEngagementLeadEmail';
      }
      // General snake_case to camelCase conversion
      else if (key.includes('_')) {
        // Handle compound snake_case (e.g., foo_bar_baz → fooBarBaz)
        camelKey = key.split('_').map((part, i) => {
          // First part remains as is, subsequent parts get capitalized
          return i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1);
        }).join('');
      }
      
      // Standard date fields that should be properly formatted
      const dateFields = [
        'createdAt', 'updatedAt', 'lastUpdated', 'targetDate', 'certificationDate',
        'startDate', 'endDate', 'dueDate', 'date', 'submittedAt', 'reviewedAt'
      ];
      
      let value = obj[key];
      
      // Specific handling for boolean fields from PostgreSQL
      if (key === 'is_admin' || key === 'is_update' || key.startsWith('is_')) {
        // PostgreSQL returns booleans as 't' or 'f' strings sometimes
        if (value === 't' || value === true || value === 'true') {
          value = true;
        } else if (value === 'f' || value === false || value === 'false') {
          value = false;
        }
        
        if (key === 'is_admin') {
          console.log(`Converting is_admin from ${obj[key]} to ${value}`);
        }
      }
      
      // Standardize date formats if the field is a known date field and contains a valid date
      if (dateFields.includes(camelKey) && value !== null && value !== undefined) {
        // Convert PostgreSQL timestamps to ISO strings
        if (value instanceof Date) {
          value = value.toISOString();
        } else if (typeof value === 'string') {
          try {
            // Attempt to convert string to standard ISO format
            const dateObj = new Date(value);
            if (!isNaN(dateObj.getTime())) {
              value = dateObj.toISOString();
            }
          } catch (e) {
            console.error(`Error standardizing date for field ${camelKey}:`, e);
          }
        }
      }
      
      accumulator[camelKey] = this.snakeToCamel(value);
      return accumulator;
    }, {} as any);
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    try {
      const result = await pool.query(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = $1`, [id]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting user:", error);
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const result = await pool.query(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE username = $1`, [username]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting user by username:", error);
      throw error;
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const result = await pool.query(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE email = $1`, [email]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting user by email:", error);
      throw error;
    }
  }

  async getUserAuthCredentialsByEmail(email: string): Promise<UserWithCredentials | undefined> {
    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (!result.rows[0]) return undefined;
      const user = this.snakeToCamel(result.rows[0]);
      return attachCredentialRedaction(user);
    } catch (error) {
      console.error("Error getting user auth credentials by email:", error);
      throw error;
    }
  }

  async getUserAuthCredentialsById(id: number): Promise<UserWithCredentials | undefined> {
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (!result.rows[0]) return undefined;
      const user = this.snakeToCamel(result.rows[0]);
      return attachCredentialRedaction(user);
    } catch (error) {
      console.error("Error getting user auth credentials by id:", error);
      throw error;
    }
  }

  async createUser(insertUser: InsertUser & { username?: string, password?: string, firstName?: string, lastName?: string, project?: string, role?: string, location?: string }): Promise<User> {
    try {
      const result = await pool.query(
        `INSERT INTO users (
          email, is_admin, username, password, first_name, last_name, project, role, location
         ) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING ${SAFE_USER_COLUMNS}`,
        [
          insertUser.email, 
          insertUser.is_admin || false,
          insertUser.username || insertUser.email.split('@')[0], // Use username if provided, otherwise derive from email
          insertUser.password || '', // Use empty string as default password
          insertUser.firstName || '',
          insertUser.lastName || '',
          insertUser.project || '',
          insertUser.role || '',
          insertUser.location || ''
        ]
      );
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    }
  }
  
  async updateUser(id: number, data: Partial<User>): Promise<User> {
    try {
      const { password: _, ...cleanData } = (data as any);
      const sets: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      // Build SET clause and parameters
      for (const [key, value] of Object.entries(cleanData)) {
        // Special case handling for isAdmin -> is_admin
        let columnName;
        if (key === 'isAdmin') {
          columnName = 'is_admin';
        } else {
          // Convert camelCase to snake_case for database column names
          columnName = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        }
        sets.push(`${columnName} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
      
      if (sets.length === 0) {
        return await this.getUser(id) as User;
      }
      
      params.push(id); // Add id as the last parameter
      
      const result = await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING ${SAFE_USER_COLUMNS}`,
        params
      );
      
      if (result.rows.length === 0) {
        throw new Error("User not found");
      }
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error updating user:", error);
      throw error;
    }
  }
  
  async updateUserPassword(id: number, hashedPassword: string): Promise<void> {
    try {
      const result = await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [hashedPassword, id]
      );
      
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }
    } catch (error) {
      console.error("Error updating user password:", error);
      throw error;
    }
  }
  
  async getAllUsers(): Promise<User[]> {
    try {
      const result = await pool.query(`SELECT ${SAFE_USER_COLUMNS} FROM users ORDER BY id`);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all users:", error);
      throw error;
    }
  }
  
  async getUsersByClientId(clientId: number): Promise<User[]> {
    try {
      // Find users associated with projects under the given client
      const result = await pool.query(`
        SELECT DISTINCT ${SAFE_USER_COLUMNS_PREFIXED} 
        FROM users u
        JOIN project_resources pr ON u.id = pr.user_id
        JOIN projects p ON pr.project_id = p.id
        WHERE p.client_id = $1
        ORDER BY u.email
      `, [clientId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting users by client ID:", error);
      throw error;
    }
  }
  
  async getUsersByProjectId(projectId: number): Promise<User[]> {
    try {
      // Find users who are resources on the given project
      const result = await pool.query(`
        SELECT DISTINCT ${SAFE_USER_COLUMNS_PREFIXED} 
        FROM users u
        JOIN project_resources pr ON u.id = pr.user_id
        WHERE pr.project_id = $1
        ORDER BY u.email
      `, [projectId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting users by project ID:", error);
      throw error;
    }
  }
  
  async deleteUser(id: number): Promise<void> {
    try {
      // Delete related records first to maintain referential integrity
      
      // 1. Delete user's skills and associated histories
      const userSkills = await this.getUserSkills(id);
      for (const skill of userSkills) {
        await this.deleteSkill(skill.id);
      }
      
      // 2. Remove user from skill targets
      const allTargets = await this.getAllSkillTargets();
      for (const target of allTargets) {
        const userIds = await this.getSkillTargetUsers(target.id);
        if (userIds.includes(id)) {
          await this.removeUserFromTarget(target.id, id);
        }
      }
      
      // 3. Delete profile histories
      await pool.query('DELETE FROM profile_histories WHERE user_id = $1', [id]);
      
      // 4. Delete skill histories
      await pool.query('DELETE FROM skill_histories WHERE user_id = $1', [id]);
      
      // 5. Delete notifications
      await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]);
      
      // 6. Delete endorsements given by this user
      await pool.query('DELETE FROM endorsements WHERE endorser_id = $1', [id]);
      
      // 7. Delete endorsements received by this user's skills (using user_skills)
      await pool.query(
        'DELETE FROM endorsements WHERE user_skill_id IN (SELECT id FROM user_skills WHERE user_id = $1)',
        [id]
      );
      
      // 8. Finally, delete the user
      const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
      
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      throw error;
    }
  }

  // Skill operations
  // Now uses the new schema by calling getUserSkillsByUser
  async getUserSkills(userId: number): Promise<Skill[]> {
    try {
      // Get user skills from the new schema and convert them to legacy Skill format for compatibility
      const userSkills = await this.getUserSkillsByUser(userId);
      
      // Transform UserSkill to Skill format 
      const skillsInOldFormat = userSkills.map(userSkill => {
        return {
          id: userSkill.id,
          userId: userSkill.userId,
          name: userSkill.skillName || '', // From the joined skill_templates.name
          category: userSkill.skillCategory || '', // From the joined skill_templates.category
          level: userSkill.level,
          lastUpdated: userSkill.lastUpdated,
          certification: userSkill.certification,
          credlyLink: userSkill.credlyLink,
          notes: userSkill.notes,
          endorsementCount: userSkill.endorsementCount,
          certificationDate: userSkill.certificationDate,
          expirationDate: userSkill.expirationDate,
          categoryId: null, // These fields won't be used in new schema
          subcategoryId: null,
          categoryName: userSkill.categoryName,
          categoryColor: userSkill.categoryColor,
          categoryIcon: userSkill.categoryIcon,
          subcategoryName: userSkill.subcategoryName,
          subcategoryColor: userSkill.subcategoryColor,
          subcategoryIcon: userSkill.subcategoryIcon,
        };
      });
      
      console.log(`Transformed ${skillsInOldFormat.length} user_skills to legacy format for user ${userId}`);
      
      // Log a few samples for debugging
      if (skillsInOldFormat.length > 0) {
        console.log("Sample transformed skill:", JSON.stringify(skillsInOldFormat[0]));
      }
      
      return skillsInOldFormat;
    } catch (error) {
      console.error("Error getting user skills:", error);
      throw error;
    }
  }
  
  // UserSkill operations (new schema)
  async getUserSkillsByUser(userId: number): Promise<UserSkill[]> {
    try {
      const result = await pool.query(`
        SELECT us.*, 
               st.name as skill_name, 
               st.category as skill_category,
               st.description as skill_description,
               sc.name as category_name, 
               sc.color as category_color, 
               sc.icon as category_icon,
               ssc.name as subcategory_name,
               ssc.color as subcategory_color,
               ssc.icon as subcategory_icon
        FROM user_skills us
        JOIN skill_templates st ON us.skill_template_id = st.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        LEFT JOIN skill_subcategories ssc ON st.subcategory_id = ssc.id
        WHERE us.user_id = $1 
        ORDER BY us.last_updated DESC
      `, [userId]);
      
      console.log(`Retrieved ${result.rows.length} user skills for user ${userId}`);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user skills:", error);
      throw error;
    }
  }
  
  // Convert UserSkill (new schema) to Skill (old schema) format for backward compatibility
  userSkillToLegacySkill(userSkill: any): Skill {
    // Extract all the direct properties that match the Skill type
    const legacySkill: Partial<Skill> = {
      id: userSkill.id,
      userId: userSkill.userId,
      name: userSkill.skillName || 'Unknown Skill',
      category: userSkill.skillCategory || 'Uncategorized',
      // Ensure categoryId and subcategoryId are correctly mapped from both snake_case and camelCase sources
      categoryId: userSkill.categoryId || userSkill.category_id || null,
      subcategoryId: userSkill.subcategoryId || userSkill.subcategory_id || null,
      level: userSkill.level,
      lastUpdated: userSkill.lastUpdated || userSkill.last_updated,
      certification: userSkill.certification || '',
      credlyLink: userSkill.credlyLink || userSkill.credly_link || '',
      notes: userSkill.notes || '',
      endorsementCount: userSkill.endorsementCount || userSkill.endorsement_count || 0,
      certificationDate: userSkill.certificationDate || userSkill.certification_date || null,
      expirationDate: userSkill.expirationDate || userSkill.expiration_date || null
    };
    
    // Add the extended properties as a separate step
    // This avoids TypeScript errors about unknown properties
    const result = legacySkill as any;
    
    // Add extended properties used by the UI
    result.categoryName = userSkill.categoryName || userSkill.category_name || userSkill.skillCategory || userSkill.skill_category || null;
    result.categoryColor = userSkill.categoryColor || userSkill.category_color || '#3B82F6';
    result.categoryIcon = userSkill.categoryIcon || userSkill.category_icon || 'code';
    result.subcategoryName = userSkill.subcategoryName || userSkill.subcategory_name || null;
    result.subcategoryColor = userSkill.subcategoryColor || userSkill.subcategory_color || '#3B82F6';
    result.subcategoryIcon = userSkill.subcategoryIcon || userSkill.subcategory_icon || 'code';
    
    // For debugging
    if (!result.categoryId && !result.subcategoryId) {
      console.log(`Warning: Converted user skill without category/subcategory IDs: ${result.name}`);
    }
    
    return result as Skill;
  }
  
  // Get user skills using new schema but return in old format for compatibility
  async getUserSkillsV2(userId: number): Promise<Skill[]> {
    try {
      // Get skills from new user_skills table
      const userSkills = await this.getUserSkillsByUser(userId);
      
      // Convert to legacy format
      const legacySkills = userSkills.map(us => this.userSkillToLegacySkill(us));
      
      console.log(`Converted ${legacySkills.length} user skills to legacy format for user ${userId}`);
      return legacySkills;
    } catch (error) {
      console.error("Error getting user skills with v2 schema:", error);
      
      // Fallback to legacy format if there's an error
      console.log("Falling back to legacy skill format");
      return this.getUserSkills(userId);
    }
  }
  
  async getUserSkillById(id: number): Promise<UserSkill | undefined> {
    try {
      const result = await pool.query(`
        SELECT us.*, 
               st.name as skill_name, 
               st.category as skill_category,
               st.description as skill_description,
               sc.name as category_name, 
               sc.color as category_color, 
               sc.icon as category_icon,
               ssc.name as subcategory_name,
               ssc.color as subcategory_color,
               ssc.icon as subcategory_icon
        FROM user_skills us
        JOIN skill_templates st ON us.skill_template_id = st.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        LEFT JOIN skill_subcategories ssc ON st.subcategory_id = ssc.id
        WHERE us.id = $1
      `, [id]);
      
      if (!result.rows[0]) return undefined;
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting user skill:", error);
      throw error;
    }
  }
  
  async createUserSkill(userSkill: InsertUserSkill): Promise<UserSkill> {
    try {
      let skillTemplateId = userSkill.skillTemplateId;
      
      // If we have a named skill but no template ID, check if it's a custom skill that needs a template
      if (!skillTemplateId && userSkill.name && userSkill.category) {
        console.log(`Checking for existing template for custom skill: ${userSkill.name} (${userSkill.category})`);
        
        // Try to find an existing template with this name/category
        const templateResult = await pool.query(
          'SELECT id FROM skill_templates WHERE name = $1 AND category = $2',
          [userSkill.name, userSkill.category]
        );
        
        if (templateResult.rows.length > 0) {
          // Use existing template
          skillTemplateId = templateResult.rows[0].id;
          console.log(`Found existing template ID ${skillTemplateId} for ${userSkill.name}`);
        } else {
          // Create a new template for this category
          console.log(`Creating new skill template for ${userSkill.name} in category ${userSkill.category}`);
          
          // Try to get the category_id based on the category name
          let categoryId = null;
          const categoryResult = await pool.query(
            'SELECT id FROM skill_categories WHERE name = $1',
            [userSkill.category]
          );
          
          if (categoryResult.rows.length > 0) {
            categoryId = categoryResult.rows[0].id;
            console.log(`Found categoryId ${categoryId} for category name "${userSkill.category}"`);
          } else {
            console.warn(`Could not find categoryId for category name "${userSkill.category}"`);
          }
          
          const newTemplateResult = await pool.query(
            `INSERT INTO skill_templates (name, category, category_id) 
             VALUES ($1, $2, $3) 
             RETURNING id`,
            [userSkill.name, userSkill.category, categoryId]
          );
          
          skillTemplateId = newTemplateResult.rows[0].id;
          console.log(`Created new template with ID ${skillTemplateId}`);
        }
      }
      
      if (!skillTemplateId) {
        throw new Error('A skill template ID is required to create a user skill');
      }
      
      const result = await pool.query(
        `INSERT INTO user_skills (
          user_id, skill_template_id, level, 
          certification, credly_link, notes, certification_date, expiration_date
         ) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [
          userSkill.userId, 
          skillTemplateId,
          userSkill.level, 
          userSkill.certification || '', 
          userSkill.credlyLink || '',
          userSkill.notes || '',
          userSkill.certificationDate || null,
          userSkill.expirationDate || null
        ]
      );
      
      // Get the full user skill with template information
      return await this.getUserSkillById(result.rows[0].id) as UserSkill;
    } catch (error) {
      console.error("Error creating user skill:", error);
      throw error;
    }
  }
  
  async updateUserSkill(id: number, data: Partial<UserSkill>): Promise<UserSkill> {
    try {
      // Build the SET clause dynamically based on provided data
      const allowedFields = ['level', 'certification', 'credly_link', 'notes', 'certification_date', 'expiration_date'];
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      for (const [key, value] of Object.entries(data)) {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        if (allowedFields.includes(snakeKey) && value !== undefined) {
          updates.push(`${snakeKey} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }
      
      // Add last_updated field
      updates.push(`last_updated = NOW()`);
      
      // Add the ID as the last parameter
      values.push(id);
      
      if (updates.length === 0) {
        // No valid updates, return the existing skill
        return await this.getUserSkillById(id) as UserSkill;
      }
      
      const query = `
        UPDATE user_skills 
        SET ${updates.join(', ')} 
        WHERE id = $${paramIndex} 
        RETURNING *
      `;
      
      const result = await pool.query(query, values);
      
      if (!result.rows[0]) {
        throw new Error(`User skill with ID ${id} not found`);
      }
      
      // Get the full user skill with template information
      return await this.getUserSkillById(id) as UserSkill;
    } catch (error) {
      console.error("Error updating user skill:", error);
      throw error;
    }
  }
  
  async deleteUserSkill(id: number): Promise<void> {
    try {
      console.log(`Deleting user skill ${id} - checking for related records first`);
      
      // First delete any pending skill updates referencing this user skill
      await pool.query('DELETE FROM pending_skill_updates WHERE user_skill_id = $1', [id]);
      console.log(`Deleted any pending skill updates for user skill ${id}`);
      
      // Delete any notifications referencing this user skill
      await pool.query('DELETE FROM notifications WHERE related_user_skill_id = $1', [id]);
      console.log(`Deleted any notifications for user skill ${id}`);
      
      // Remove any endorsements from the endorsements table
      await pool.query('DELETE FROM endorsements WHERE user_skill_id = $1', [id]);
      console.log(`Deleted endorsements for user skill ${id}`);
      
      // Delete skill histories from the skill_histories table
      await pool.query('DELETE FROM skill_histories WHERE user_skill_id = $1', [id]);
      console.log(`Deleted skill histories for user skill ${id}`);
      
      // Finally delete the skill
      await pool.query('DELETE FROM user_skills WHERE id = $1', [id]);
      console.log(`Successfully deleted user skill ${id}`);
    } catch (error) {
      console.error(`Error deleting user skill ${id}:`, error);
      throw error;
    }
  }
  
  async getAllUserSkills(): Promise<UserSkill[]> {
    try {
      const result = await pool.query(`
        SELECT us.*, 
               st.name as skill_name, 
               st.category as skill_category,
               st.description as skill_description,
               sc.name as category_name, 
               sc.color as category_color, 
               sc.icon as category_icon,
               ssc.name as subcategory_name,
               ssc.color as subcategory_color,
               ssc.icon as subcategory_icon
        FROM user_skills us
        JOIN skill_templates st ON us.skill_template_id = st.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        LEFT JOIN skill_subcategories ssc ON st.subcategory_id = ssc.id
        ORDER BY us.last_updated DESC
      `);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all user skills:", error);
      throw error;
    }
  }
  
  // Updated to use new schema (user_skills joined with skill_templates) and return in Skill format
  async getSkill(id: number): Promise<Skill | undefined> {
    try {
      // First check if we can find this skill in the user_skills table
      const userSkill = await this.getUserSkillById(id);
      
      if (userSkill) {
        // Convert from UserSkill to Skill format for API compatibility
        const transformedSkill = {
          id: userSkill.id,
          userId: userSkill.userId,
          name: userSkill.skillName || '', // From the joined skill_templates.name
          category: userSkill.skillCategory || '', // From the joined skill_templates.category
          level: userSkill.level,
          lastUpdated: userSkill.lastUpdated,
          certification: userSkill.certification,
          credlyLink: userSkill.credlyLink,
          notes: userSkill.notes,
          endorsementCount: userSkill.endorsementCount,
          certificationDate: userSkill.certificationDate,
          expirationDate: userSkill.expirationDate,
          categoryId: null, // These fields won't be used in new schema
          subcategoryId: null,
          categoryName: userSkill.categoryName || null,
          categoryColor: userSkill.categoryColor || null,
          categoryIcon: userSkill.categoryIcon || null,
          subcategoryName: userSkill.subcategoryName || null,
          subcategoryColor: userSkill.subcategoryColor || null,
          subcategoryIcon: userSkill.subcategoryIcon || null,
        };
        
        console.log(`Retrieved skill ${id} from user_skills:`, JSON.stringify(transformedSkill));
        
        return transformedSkill;
      }
      
      console.log(`Skill ${id} not found in user_skills table`);
      return undefined;
    } catch (error) {
      console.error("Error getting skill:", error);
      throw error;
    }
  }
  
  async createSkill(skill: InsertSkill): Promise<Skill> {
    try {
      console.log('Creating skill using new v2 structure:', skill.name);
      
      // Start a transaction
      await pool.query('BEGIN');
      
      try {
        // Step 1: Find or create a skill template
        let skillTemplateId;
        let categoryId = skill.categoryId;
        let categoryInfo = null;
        
        // If there's a category name but no ID, look up the category
        if (!categoryId && skill.category) {
          const categoryResult = await pool.query(
            `SELECT id, name as category_name, color as category_color, icon as category_icon 
             FROM skill_categories 
             WHERE LOWER(name) = LOWER($1)`, 
            [skill.category]
          );
          
          if (categoryResult.rows.length > 0) {
            categoryId = categoryResult.rows[0].id;
            categoryInfo = categoryResult.rows[0];
          }
        }
        
        // If we have a category ID, get its details
        if (categoryId && !categoryInfo) {
          const categoryResult = await pool.query(
            `SELECT name as category_name, color as category_color, icon as category_icon 
             FROM skill_categories 
             WHERE id = $1`, 
            [categoryId]
          );
          
          if (categoryResult.rows.length > 0) {
            categoryInfo = categoryResult.rows[0];
          }
        }
        
        // Check if a skill template with this name already exists
        const existingTemplate = await pool.query(
          'SELECT id FROM skill_templates WHERE name = $1 LIMIT 1',
          [skill.name]
        );
        
        if (existingTemplate.rows.length > 0) {
          skillTemplateId = existingTemplate.rows[0].id;
          console.log(`Using existing skill template: ${skill.name} (ID: ${skillTemplateId})`);
        } else {
          // Create a new skill template
          const templateResult = await pool.query(
            `INSERT INTO skill_templates (
              name, category, category_id, subcategory_id, description, is_recommended
            ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              skill.name,
              skill.category || 'Uncategorized',
              categoryId || null,
              skill.subcategoryId || null,
              '', // Default empty description
              false // Not automatically recommended
            ]
          );
          
          skillTemplateId = templateResult.rows[0].id;
          console.log(`Created new skill template: ${skill.name} (ID: ${skillTemplateId})`);
        }
        
        // Step 2: Create the user_skill record
        const userSkillResult = await pool.query(
          `INSERT INTO user_skills (
            user_id, skill_template_id, level, certification, credly_link, notes,
            certification_date, expiration_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            skill.userId,
            skillTemplateId,
            skill.level,
            skill.certification || '',
            skill.credlyLink || '',
            skill.notes || '',
            skill.certificationDate || null,
            skill.expirationDate || null
          ]
        );
        
        const userSkillId = userSkillResult.rows[0].id;
        
        // Step 3: Construct the skill response with all necessary fields
        const skillResult = await pool.query(`
          SELECT 
            us.id, us.user_id, us.level, us.certification, us.credly_link, us.notes, 
            us.certification_date, us.expiration_date, us.last_updated,
            st.name, st.category,
            sc.name as category_name, sc.color as category_color, sc.icon as category_icon,
            ss.name as subcategory_name, ss.color as subcategory_color, ss.icon as subcategory_icon
          FROM user_skills us
          JOIN skill_templates st ON us.skill_template_id = st.id
          LEFT JOIN skill_categories sc ON st.category_id = sc.id
          LEFT JOIN skill_subcategories ss ON st.subcategory_id = ss.id
          WHERE us.id = $1
        `, [userSkillId]);
        
        await pool.query('COMMIT');
        
        if (skillResult.rows.length === 0) {
          throw new Error(`Failed to retrieve created user skill with ID ${userSkillId}`);
        }
        
        // Transform to the legacy skill format
        const skillData = this.snakeToCamel(skillResult.rows[0]);
        
        // Convert property names to match legacy format
        return {
          id: skillData.id,
          userId: skillData.userId,
          name: skillData.name,
          category: skillData.category,
          level: skillData.level,
          certification: skillData.certification,
          credlyLink: skillData.credlyLink,
          notes: skillData.notes,
          certificationDate: skillData.certificationDate,
          expirationDate: skillData.expirationDate,
          lastUpdated: skillData.lastUpdated,
          categoryId: categoryId || null,
          subcategoryId: skill.subcategoryId || null,
          categoryName: skillData.categoryName || null,
          categoryColor: skillData.categoryColor || null,
          categoryIcon: skillData.categoryIcon || null,
          subcategoryName: skillData.subcategoryName || null,
          subcategoryColor: skillData.subcategoryColor || null,
          subcategoryIcon: skillData.subcategoryIcon || null
        };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error("Error creating skill:", error);
      throw error;
    }
  }
  
  // Updated to work with user_skills table instead of skills table
  async updateSkill(id: number, data: Partial<Skill>): Promise<Skill> {
    try {
      // Log the incoming data for debugging
      console.log("UpdateSkill input data:", JSON.stringify(data));

      // First check if we can find this skill in the user_skills table
      const userSkill = await this.getUserSkillById(id);
      
      if (!userSkill) {
        throw new Error(`User skill with ID ${id} not found`);
      }
      
      // Map the legacy Skill data to UserSkill format for updating
      const updateData: Partial<UserSkill> = {};
      
      // Only copy fields that exist in user_skills table
      if (data.level) updateData.level = data.level;
      if (data.certification !== undefined) updateData.certification = data.certification;
      if (data.credlyLink !== undefined) updateData.credlyLink = data.credlyLink;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.certificationDate !== undefined) updateData.certificationDate = data.certificationDate;
      if (data.expirationDate !== undefined) updateData.expirationDate = data.expirationDate;
      
      console.log("Updating user skill with data:", JSON.stringify(updateData));
      
      // Use the existing updateUserSkill method
      const updatedUserSkill = await this.updateUserSkill(id, updateData);
      
      // Convert back to Skill format for API compatibility
      const convertedSkill = {
        id: updatedUserSkill.id,
        userId: updatedUserSkill.userId,
        name: updatedUserSkill.skillName || '', // From the joined skill_templates.name
        category: updatedUserSkill.skillCategory || '', // From the joined skill_templates.category
        level: updatedUserSkill.level,
        lastUpdated: updatedUserSkill.lastUpdated,
        certification: updatedUserSkill.certification,
        credlyLink: updatedUserSkill.credlyLink,
        notes: updatedUserSkill.notes,
        endorsementCount: updatedUserSkill.endorsementCount,
        certificationDate: updatedUserSkill.certificationDate,
        expirationDate: updatedUserSkill.expirationDate,
        categoryId: null, // These fields won't be used in new schema
        subcategoryId: null,
        categoryName: updatedUserSkill.categoryName || null,
        categoryColor: updatedUserSkill.categoryColor || null,
        categoryIcon: updatedUserSkill.categoryIcon || null,
        subcategoryName: updatedUserSkill.subcategoryName || null,
        subcategoryColor: updatedUserSkill.subcategoryColor || null,
        subcategoryIcon: updatedUserSkill.subcategoryIcon || null,
      };
      
      console.log(`Updated skill ${id} successfully:`, JSON.stringify(convertedSkill));
      
      return convertedSkill;
    } catch (error) {
      console.error("Error updating skill:", error);
      throw error;
    }
  }
  
  // Updated to delete from user_skills only
  async deleteSkill(id: number): Promise<void> {
    try {
      // First check if the skill exists in user_skills
      const userSkill = await this.getUserSkillById(id);
      
      if (!userSkill) {
        throw new Error(`User skill with ID ${id} not found`);
      }
      
      console.log(`Deleting user skill ${id} from user_skills table`);
      
      // Use deleteUserSkill which handles deleting from v2 tables
      await this.deleteUserSkill(id);
      
      console.log(`Successfully deleted user skill ${id}`);
    } catch (error) {
      console.error("Error deleting skill:", error);
      throw error;
    }
  }
  
  // Get all skills using the new schema (user_skills + skill_templates)
  async getAllSkills(): Promise<Skill[]> {
    try {
      // Get all skills from the new user_skills table
      const userSkills = await this.getAllUserSkills();
      
      // Transform to old Skill format for API compatibility
      const allSkillsInOldFormat = userSkills.map(userSkill => {
        return {
          id: userSkill.id,
          userId: userSkill.userId,
          name: userSkill.skillName || '', // From the joined skill_templates.name
          category: userSkill.skillCategory || '', // From the joined skill_templates.category
          level: userSkill.level,
          lastUpdated: userSkill.lastUpdated,
          certification: userSkill.certification,
          credlyLink: userSkill.credlyLink,
          notes: userSkill.notes,
          endorsementCount: userSkill.endorsementCount,
          certificationDate: userSkill.certificationDate,
          expirationDate: userSkill.expirationDate,
          categoryId: null, // These will be derived from the skill template
          subcategoryId: null,
          categoryName: userSkill.categoryName,
          categoryColor: userSkill.categoryColor,
          categoryIcon: userSkill.categoryIcon,
          subcategoryName: userSkill.subcategoryName,
          subcategoryColor: userSkill.subcategoryColor,
          subcategoryIcon: userSkill.subcategoryIcon,
        };
      });
      
      console.log(`Returned ${allSkillsInOldFormat.length} skills from user_skills table for dashboard`);
      
      // Log a sample for debugging
      if (allSkillsInOldFormat.length > 0) {
        console.log("Sample skill from user_skills table:", JSON.stringify(allSkillsInOldFormat[0]));
      }
      
      return allSkillsInOldFormat;
    } catch (error) {
      console.error("Error getting all skills from new schema:", error);
      throw error;
    }
  }
  
  // Search skills using new schema
  async searchSkills(query: string): Promise<Skill[]> {
    try {
      // Search for skills by name, category, level, certification
      const searchQuery = `%${query.toLowerCase()}%`;
      const result = await pool.query(`
        SELECT us.*, 
               st.name as skill_name, 
               st.category as skill_category,
               st.description as skill_description,
               sc.name as category_name, 
               sc.color as category_color, 
               sc.icon as category_icon,
               ssc.name as subcategory_name,
               ssc.color as subcategory_color,
               ssc.icon as subcategory_icon
        FROM user_skills us
        JOIN skill_templates st ON us.skill_template_id = st.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        LEFT JOIN skill_subcategories ssc ON st.subcategory_id = ssc.id
        WHERE LOWER(st.name) LIKE $1 
          OR LOWER(st.category) LIKE $1 
          OR LOWER(us.level) LIKE $1 
          OR LOWER(us.certification) LIKE $1
          OR LOWER(us.notes) LIKE $1
          OR LOWER(sc.name) LIKE $1
          OR LOWER(ssc.name) LIKE $1
        ORDER BY us.last_updated DESC
      `, [searchQuery]);
      
      // Convert to legacy Skill format for API compatibility
      const userSkills = this.snakeToCamel(result.rows);
      
      // Transform to old Skill format for API compatibility
      const skillsInOldFormat = userSkills.map(userSkill => {
        return {
          id: userSkill.id,
          userId: userSkill.userId,
          name: userSkill.skillName || '', // From the joined skill_templates.name
          category: userSkill.skillCategory || '', // From the joined skill_templates.category
          level: userSkill.level,
          lastUpdated: userSkill.lastUpdated,
          certification: userSkill.certification,
          credlyLink: userSkill.credlyLink,
          notes: userSkill.notes,
          endorsementCount: userSkill.endorsementCount,
          certificationDate: userSkill.certificationDate,
          expirationDate: userSkill.expirationDate,
          categoryId: null, // These will be derived from the skill template
          subcategoryId: null,
          categoryName: userSkill.categoryName,
          categoryColor: userSkill.categoryColor,
          categoryIcon: userSkill.categoryIcon,
          subcategoryName: userSkill.subcategoryName,
          subcategoryColor: userSkill.subcategoryColor,
          subcategoryIcon: userSkill.subcategoryIcon,
        };
      });
      
      console.log(`Search found ${skillsInOldFormat.length} skills matching "${query}"`);
      return skillsInOldFormat;
    } catch (error) {
      console.error("Error searching skills:", error);
      throw error;
    }
  }

  // Skill history operations
  async getSkillHistory(skillId: number): Promise<SkillHistory[]> {
    try {
      const result = await pool.query(`
        SELECT sh.*, st.name as skill_name 
        FROM skill_histories sh
        JOIN user_skills us ON sh.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        WHERE sh.user_skill_id = $1 
        ORDER BY sh.created_at DESC
      `, [skillId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting skill history:", error);
      throw error;
    }
  }
  
  async getUserSkillHistory(userId: number): Promise<SkillHistory[]> {
    try {
      const result = await pool.query(`
        SELECT sh.*, st.name as skill_name 
        FROM skill_histories sh
        JOIN user_skills us ON sh.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        WHERE sh.user_id = $1 
        ORDER BY sh.created_at DESC
      `, [userId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user skill history:", error);
      throw error;
    }
  }
  
  // Function to get user skill histories 
  async getUserSkillHistoryFromAllSources(userId: number): Promise<SkillHistory[]> {
    try {
      console.log(`Getting skill histories for user ${userId} from skill_histories table`);
      
      // Get histories from the skill_histories table linked to user_skills via skill templates
      const result = await pool.query(`
        SELECT sh.*, st.name as skill_name 
        FROM skill_histories sh
        JOIN user_skills us ON sh.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        WHERE sh.user_id = $1 
        ORDER BY sh.created_at DESC
      `, [userId]);
      
      const count = result.rows.length;
      console.log(`Retrieved ${count} skill histories from skill_histories table for user ${userId}`);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error(`Error getting skill histories for user ${userId}:`, error);
      throw error;
    }
  }

  async getAllSkillHistories(): Promise<SkillHistory[]> {
    try {
      const result = await pool.query(`
        SELECT sh.*, st.name as skill_name, u.email as user_email 
        FROM skill_histories sh
        JOIN user_skills us ON sh.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        JOIN users u ON sh.user_id = u.id 
        ORDER BY sh.created_at DESC
      `);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all skill histories:", error);
      throw error;
    }
  }
  
  // Get all skill histories from skill_histories table
  async getAllSkillHistoriesFromAllSources(): Promise<SkillHistory[]> {
    try {
      console.log("Getting all skill histories from skill_histories table");
      
      // Get histories from the skill_histories table linked to user_skills via skill templates
      const result = await pool.query(`
        SELECT sh.*, st.name as skill_name, u.email as user_email 
        FROM skill_histories sh
        JOIN user_skills us ON sh.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        JOIN users u ON sh.user_id = u.id 
        ORDER BY sh.created_at DESC
      `);
      
      const count = result.rows.length;
      console.log(`Retrieved ${count} skill histories from skill_histories table`);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all skill histories:", error);
      throw error;
    }
  }
  
  // Updated to use only skill_histories table with user_skills
  async createSkillHistory(history: InsertSkillHistory): Promise<SkillHistory> {
    try {
      // Validate the user skill exists
      const userSkill = await this.getUserSkillById(history.skillId);
      
      if (!userSkill) {
        throw new Error(`User skill with ID ${history.skillId} not found`);
      }
      
      // Get the skill name for logging
      let skillName = 'Unknown skill';
      if (userSkill.skillTemplateId) {
        const template = await pool.query(
          'SELECT name FROM skill_templates WHERE id = $1',
          [userSkill.skillTemplateId]
        );
        if (template.rows.length > 0) {
          skillName = template.rows[0].name;
        }
      }
      
      console.log(`Creating history for ${skillName} (user skill ID: ${history.skillId}, user ID: ${history.userId})`);
      console.log(`Level change: ${history.previousLevel || 'none'} -> ${history.newLevel}`);
      
      // Get skill_id from skills table for the user if it exists
      const skillResult = await pool.query(
        'SELECT id FROM skills WHERE name = $1 AND user_id = $2 LIMIT 1',
        [skillName, history.userId]
      );
      
      const skillId = skillResult.rows.length > 0 ? skillResult.rows[0].id : null;
      
      // Insert into the skill_histories table
      const result = await pool.query(
        `INSERT INTO skill_histories (
          skill_id, user_id, user_skill_id, previous_level, new_level,
          change_note, change_by_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [
          skillId, 
          history.userId, 
          history.skillId, 
          history.previousLevel || null, 
          history.newLevel,
          history.changeNote || `Skill level changed from ${history.previousLevel || 'none'} to ${history.newLevel}`,
          history.userId // Change by the user themselves
        ]
      );
      
      // Add skill_name for downstream processing
      const historyRecord = result.rows[0];
      historyRecord.skill_name = skillName;
      
      return this.snakeToCamel(historyRecord);
    } catch (error) {
      console.error("Error creating skill history:", error);
      throw error;
    }
  }
  
  // Method for creating skill history using the existing skill_histories table
  async createSkillHistoryV2(history: {
    userSkillId: number;
    userId: number;
    previousLevel: string | null;
    newLevel: string;
    changeNote?: string;
    changeById?: number;
  }): Promise<any> {
    try {
      // Get the user skill information for context
      const userSkill = await this.getUserSkillById(history.userSkillId);
      
      if (!userSkill) {
        throw new Error(`User skill with ID ${history.userSkillId} not found`);
      }
      
      // Get the skill name for logging
      let skillName = 'Unknown skill';
      if (userSkill.skillTemplateId) {
        const template = await pool.query(
          'SELECT name FROM skill_templates WHERE id = $1',
          [userSkill.skillTemplateId]
        );
        if (template.rows.length > 0) {
          skillName = template.rows[0].name;
        }
      }
      
      console.log(`Creating history for ${skillName} (user skill ID: ${history.userSkillId}, user ID: ${history.userId})`);
      console.log(`Level change: ${history.previousLevel || 'none'} -> ${history.newLevel}`);
      
      // Get skill_id from skills table for the user if it exists
      const skillResult = await pool.query(
        'SELECT id FROM skills WHERE name = $1 AND user_id = $2 LIMIT 1',
        [skillName, history.userId]
      );
      
      const skillId = skillResult.rows.length > 0 ? skillResult.rows[0].id : null;
      
      // Insert history using the existing skill_histories table
      const result = await pool.query(
        `INSERT INTO skill_histories (
          skill_id, user_id, user_skill_id, previous_level, new_level,
          change_note, change_by_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [
          skillId, 
          history.userId, 
          history.userSkillId, 
          history.previousLevel, 
          history.newLevel,
          history.changeNote || `Skill level changed from ${history.previousLevel || 'none'} to ${history.newLevel}`,
          history.changeById || history.userId
        ]
      );
      
      // Add skill_name for downstream processing
      const historyRecord = result.rows[0];
      historyRecord.skill_name = skillName;
      
      return this.snakeToCamel(historyRecord);
    } catch (error) {
      console.error("Error creating skill history V2:", error);
      throw error;
    }
  }

  // Profile history operations
  async getUserProfileHistory(userId: number): Promise<ProfileHistory[]> {
    try {
      const result = await pool.query(
        'SELECT * FROM profile_histories WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user profile history:", error);
      throw error;
    }
  }
  
  async createProfileHistory(history: InsertProfileHistory): Promise<ProfileHistory> {
    try {
      const result = await pool.query(
        `INSERT INTO profile_histories (user_id, changed_field, previous_value, new_value) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [
          history.userId, 
          history.changedField, 
          history.previousValue || '', 
          history.newValue
        ]
      );
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating profile history:", error);
      throw error;
    }
  }
  
  // Endorsement operations - using endorsements table with user_skill_id column
  async getSkillEndorsements(skillId: number): Promise<Endorsement[]> {
    try {
      const result = await pool.query(`
        SELECT e.*, u.email as endorser_email 
        FROM endorsements e 
        JOIN users u ON e.endorser_id = u.id 
        WHERE user_skill_id = $1 
        ORDER BY created_at DESC
      `, [skillId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting skill endorsements:", error);
      throw error;
    }
  }
  
  // Updated to use the endorsements table with user_skills
  async getUserEndorsements(userId: number): Promise<Endorsement[]> {
    try {
      const result = await pool.query(`
        SELECT e.*, st.name as skill_name, u.email as endorser_email 
        FROM endorsements e 
        JOIN user_skills us ON e.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        JOIN users u ON e.endorser_id = u.id 
        WHERE e.endorsee_id = $1 
        ORDER BY e.created_at DESC
      `, [userId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user endorsements:", error);
      throw error;
    }
  }
  
  // V2 alias for getUserEndorsements - using the endorsements table
  async getUserEndorsementsV2(userId: number): Promise<EndorsementV2[]> {
    try {
      const result = await pool.query(`
        SELECT e.*, st.name as skill_name, u.email as endorser_email 
        FROM endorsements e 
        JOIN user_skills us ON e.user_skill_id = us.id 
        JOIN skill_templates st ON us.skill_template_id = st.id 
        JOIN users u ON e.endorser_id = u.id 
        WHERE e.endorsee_id = $1 
        ORDER BY e.created_at DESC
      `, [userId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user endorsements V2:", error);
      throw error;
    }
  }
  
  // Updated to use endorsements table with user_skills
  async createEndorsement(endorsement: InsertEndorsement): Promise<Endorsement> {
    try {
      // First check if the endorsement already exists in the endorsements table
      const existingEndorsement = await pool.query(
        'SELECT * FROM endorsements WHERE user_skill_id = $1 AND endorser_id = $2',
        [endorsement.skillId, endorsement.endorserId]
      );
      
      if (existingEndorsement.rows.length > 0) {
        // Update existing endorsement with new comment
        const result = await pool.query(
          `UPDATE endorsements SET comment = $1, created_at = CURRENT_TIMESTAMP 
           WHERE user_skill_id = $2 AND endorser_id = $3 
           RETURNING *`,
          [endorsement.comment || '', endorsement.skillId, endorsement.endorserId]
        );
        
        // Also increment the endorsement count on the user_skills table
        await pool.query(
          'UPDATE user_skills SET endorsement_count = COALESCE(endorsement_count, 0) + 1 WHERE id = $1',
          [endorsement.skillId]
        );
        
        return this.snakeToCamel(result.rows[0]);
      }
      
      // Create new endorsement in the endorsements table
      const result = await pool.query(
        `INSERT INTO endorsements (user_skill_id, endorser_id, endorsee_id, comment) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [
          endorsement.skillId, 
          endorsement.endorserId, 
          endorsement.endorseeId,
          endorsement.comment || ''
        ]
      );
      
      // Increment the endorsement count on the user_skills table
      await pool.query(
        'UPDATE user_skills SET endorsement_count = COALESCE(endorsement_count, 0) + 1 WHERE id = $1',
        [endorsement.skillId]
      );
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating endorsement:", error);
      throw error;
    }
  }
  
  // V2 alias for createEndorsement - using the endorsements table
  async createEndorsementV2(endorsement: InsertEndorsementV2): Promise<EndorsementV2> {
    try {
      // First check if the endorsement already exists in the endorsements table
      const existingEndorsement = await pool.query(
        'SELECT * FROM endorsements WHERE user_skill_id = $1 AND endorser_id = $2',
        [endorsement.userSkillId, endorsement.endorserId]
      );
      
      if (existingEndorsement.rows.length > 0) {
        // Update existing endorsement with new comment
        const result = await pool.query(
          `UPDATE endorsements SET comment = $1, created_at = CURRENT_TIMESTAMP 
           WHERE user_skill_id = $2 AND endorser_id = $3 
           RETURNING *`,
          [endorsement.comment || '', endorsement.userSkillId, endorsement.endorserId]
        );
        
        // Also increment the endorsement count on the user_skills table
        await pool.query(
          'UPDATE user_skills SET endorsement_count = COALESCE(endorsement_count, 0) + 1 WHERE id = $1',
          [endorsement.userSkillId]
        );
        
        return this.snakeToCamel(result.rows[0]);
      }
      
      // Create new endorsement in the endorsements table
      const result = await pool.query(
        `INSERT INTO endorsements (user_skill_id, endorser_id, endorsee_id, comment) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [
          endorsement.userSkillId, 
          endorsement.endorserId, 
          endorsement.endorseeId,
          endorsement.comment || ''
        ]
      );
      
      // Increment the endorsement count on the user_skills table
      await pool.query(
        'UPDATE user_skills SET endorsement_count = COALESCE(endorsement_count, 0) + 1 WHERE id = $1',
        [endorsement.userSkillId]
      );
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating endorsement V2:", error);
      throw error;
    }
  }
  
  // Updated to use endorsements table with user_skills
  async deleteEndorsement(endorsementId: number): Promise<void> {
    try {
      // First get the endorsement to know which skill to update
      const endorsement = await pool.query(
        'SELECT user_skill_id FROM endorsements WHERE id = $1',
        [endorsementId]
      );
      
      if (endorsement.rows.length === 0) {
        throw new Error("Endorsement not found");
      }
      
      const userSkillId = endorsement.rows[0].user_skill_id;
      
      // Delete the endorsement from the endorsements table
      await pool.query('DELETE FROM endorsements WHERE id = $1', [endorsementId]);
      
      // Decrement the endorsement count on the user_skills table
      await pool.query(
        'UPDATE user_skills SET endorsement_count = GREATEST(COALESCE(endorsement_count, 1) - 1, 0) WHERE id = $1',
        [userSkillId]
      );
    } catch (error) {
      console.error("Error deleting endorsement:", error);
      throw error;
    }
  }
  
  // V2 alias for deleteEndorsement - using the endorsements table
  async deleteEndorsementV2(endorsementId: number): Promise<void> {
    try {
      // First get the endorsement to know which skill to update
      const endorsement = await pool.query(
        'SELECT user_skill_id FROM endorsements WHERE id = $1',
        [endorsementId]
      );
      
      if (endorsement.rows.length === 0) {
        throw new Error("Endorsement not found");
      }
      
      const userSkillId = endorsement.rows[0].user_skill_id;
      
      // Delete the endorsement from the endorsements table
      await pool.query('DELETE FROM endorsements WHERE id = $1', [endorsementId]);
      
      // Decrement the endorsement count on the user_skills table
      await pool.query(
        'UPDATE user_skills SET endorsement_count = GREATEST(COALESCE(endorsement_count, 1) - 1, 0) WHERE id = $1',
        [userSkillId]
      );
    } catch (error) {
      console.error("Error deleting endorsement V2:", error);
      throw error;
    }
  }
  
  // Notification operations
  async getUserNotifications(userId: number, unreadOnly = false): Promise<Notification[]> {
    try {
      let query = 'SELECT * FROM notifications WHERE user_id = $1';
      const params = [userId];
      
      if (unreadOnly) {
        query += ' AND is_read = false';
      }
      
      query += ' ORDER BY created_at DESC';
      
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error("Error getting user notifications:", error);
      throw error;
    }
  }
  
  async createNotification(notification: InsertNotification | any): Promise<Notification> {
    try {
      // Support both camelCase and snake_case property names
      const userId = notification.userId || notification.user_id; 
      const content = notification.content || notification.message;
      const relatedSkillId = notification.relatedSkillId || notification.related_skill_id || null;
      const relatedUserSkillId = notification.relatedUserSkillId || notification.related_user_skill_id || null;
      const relatedUserId = notification.relatedUserId || notification.related_user_id || null;
      
      console.log("Creating notification with params:", {
        userId, 
        type: notification.type,
        content,
        relatedSkillId,
        relatedUserSkillId,
        relatedUserId
      });
      
      // First, determine what columns to include in the insert
      let columns = ['user_id', 'type', 'content'];
      let placeholders = ['$1', '$2', '$3'];
      let values = [userId, notification.type, content];
      let paramIndex = 4;
      
      // Only include related_skill_id if actually provided
      if (relatedSkillId !== null && relatedSkillId !== undefined) {
        columns.push('related_skill_id');
        placeholders.push(`$${paramIndex}`);
        values.push(relatedSkillId);
        paramIndex++;
      }
      
      // Only include related_user_skill_id if actually provided
      if (relatedUserSkillId !== null && relatedUserSkillId !== undefined) {
        columns.push('related_user_skill_id');
        placeholders.push(`$${paramIndex}`);
        values.push(relatedUserSkillId);
        paramIndex++;
      }
      
      // Only include related_user_id if actually provided
      if (relatedUserId !== null && relatedUserId !== undefined) {
        columns.push('related_user_id');
        placeholders.push(`$${paramIndex}`);
        values.push(relatedUserId);
        paramIndex++;
      }
      
      const query = `
        INSERT INTO notifications (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;
      
      console.log("Executing notification insert query:", query);
      console.log("With values:", values);
      
      const result = await pool.query(query, values);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating notification:", error);
      throw error;
    }
  }
  
  async markNotificationAsRead(notificationId: number): Promise<void> {
    try {
      const result = await pool.query(
        'UPDATE notifications SET is_read = true WHERE id = $1',
        [notificationId]
      );
      
      if (result.rowCount === 0) {
        throw new Error("Notification not found");
      }
    } catch (error) {
      console.error("Error marking notification as read:", error);
      throw error;
    }
  }
  
  async markAllNotificationsAsRead(userId: number): Promise<void> {
    try {
      await pool.query(
        'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
        [userId]
      );
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      throw error;
    }
  }
  
  // Skill Template operations
  async findSkillTemplate(name: string, categoryId: number): Promise<SkillTemplate | null> {
    try {
      console.log(`🔍 TRACE: Finding skill template with name "${name}" in category ${categoryId}`);
      
      const result = await pool.query(`
        SELECT * FROM skill_templates
        WHERE LOWER(name) = LOWER($1) AND category_id = $2
        LIMIT 1
      `, [name, categoryId]);
      
      if (result.rows.length === 0) {
        console.log(`⚠️ TRACE: No template found with name "${name}" in category ${categoryId}`);
        return null;
      }
      
      console.log(`✅ TRACE: Found template with ID ${result.rows[0].id}`);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error(`❌ TRACE: Error finding skill template:`, error);
      throw error;
    }
  }
  
  async getAllSkillTemplates(): Promise<SkillTemplate[]> {
    try {
      console.log("Getting all skill templates from database");
      
      // Separate query to check database directly for Oracle DBA
      const directCheck = await pool.query(`
        SELECT * FROM skill_templates 
        WHERE name = 'Oracle DBA'
      `);
      console.log(`Direct Oracle DBA check: ${directCheck.rows.length > 0 ? `Found with ID ${directCheck.rows[0].id}` : 'Not found'}`);
      
      // Updated SQL to be more explicit and add debugging
      const result = await pool.query(`
        SELECT * FROM skill_templates 
        ORDER BY name
      `);
      
      console.log(`Found ${result.rows.length} skill templates in database`);
      
      // Count templates with ID > 76 (higher IDs)
      const highIdTemplates = result.rows.filter(r => r.id > 76);
      console.log(`Templates with ID > 76: ${highIdTemplates.length}`);
      if (highIdTemplates.length > 0) {
        console.log(`Sample high ID template: ${JSON.stringify(highIdTemplates[0])}`);
      }
      
      // Show full ID range
      const ids = result.rows.map(r => r.id).sort((a, b) => a - b);
      console.log(`Full ID list: ${ids.join(', ')}`);
      console.log(`ID range: ${result.rows.length > 0 ? `${Math.min(...ids)} to ${Math.max(...ids)}` : 'none'}`);
      
      // Check if Oracle DBA exists in the rows
      const oracleDBA = result.rows.find(r => r.name === 'Oracle DBA');
      console.log(`Oracle DBA template found in database: ${oracleDBA ? `Yes, ID: ${oracleDBA.id}` : 'No'}`);
      
      // Log all database rows matching 'Database' category
      const databaseRows = result.rows.filter(r => r.category === 'Database' || r.category_id === 2);
      console.log(`Database category templates: ${databaseRows.length > 0 ? JSON.stringify(databaseRows) : 'None'}`);
      
      // Debug entire result
      console.log("Raw database results (first 2 and last 2):");
      if (result.rows.length > 0) {
        console.log("First:", JSON.stringify(result.rows.slice(0, 2)));
        console.log("Last:", JSON.stringify(result.rows.slice(-2)));
      }

      // Check for specific items by ID
      const idCheck = [1, 59, 111];
      for (const id of idCheck) {
        const item = result.rows.find(r => r.id === id);
        console.log(`Template with ID ${id} exists: ${item ? 'Yes' : 'No'}`);
      }
      
      // Check for cached query results
      const transformed = this.snakeToCamel(result.rows);
      console.log(`Transformed ${transformed.length} skill templates`);
      
      // Debug the transformed data
      if (transformed.length > 0) {
        console.log("First transformed:", JSON.stringify(transformed.slice(0, 1)));
        const transformedOracleDBA = transformed.find(t => t.name === 'Oracle DBA');
        console.log(`Oracle DBA in transformed data: ${transformedOracleDBA ? `Yes, ID: ${transformedOracleDBA.id}` : 'No'}`);
      }
      
      return transformed;
    } catch (error) {
      console.error("Error getting all skill templates:", error);
      throw error;
    }
  }
  
  async findSkillTemplate(name: string, categoryId: number): Promise<SkillTemplate | null> {
    try {
      console.log(`🔍 TRACE: Finding skill template with name "${name}" in category ${categoryId}`);
      
      const result = await pool.query(`
        SELECT * FROM skill_templates
        WHERE LOWER(name) = LOWER($1) AND category_id = $2
        LIMIT 1
      `, [name, categoryId]);
      
      if (result.rows.length === 0) {
        console.log(`⚠️ TRACE: No template found with name "${name}" in category ${categoryId}`);
        return null;
      }
      
      console.log(`✅ TRACE: Found template with ID ${result.rows[0].id}`);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error(`❌ TRACE: Error finding skill template:`, error);
      throw error;
    }
  }

  async getSkillTemplate(id: number): Promise<SkillTemplate | undefined> {
    try {
      const result = await pool.query('SELECT * FROM skill_templates WHERE id = $1', [id]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill template:", error);
      throw error;
    }
  }
  
  async getSkillTemplatesByCategory(category: string): Promise<SkillTemplate[]> {
    try {
      console.log(`Finding skill templates for category: "${category}"`);
      
      const result = await pool.query(
        'SELECT * FROM skill_templates WHERE category = $1 ORDER BY id LIMIT 10', 
        [category]
      );
      
      console.log(`Found ${result.rows.length} templates for category "${category}"`);
      
      if (result.rows.length === 0) {
        // If no exact category match, try a more flexible search
        console.log("No exact category match, trying partial match");
        const flexResult = await pool.query(
          "SELECT * FROM skill_templates WHERE category ILIKE $1 ORDER BY id LIMIT 10", 
          [`%${category}%`]
        );
        console.log(`Found ${flexResult.rows.length} templates with partial category match for "${category}"`);
        return this.snakeToCamel(flexResult.rows);
      }
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error(`Error getting skill templates by category "${category}":`, error);
      return []; // Return empty array rather than throwing to make this method more resilient
    }
  }
  
  async getSkillCategoryByName(name: string): Promise<SkillCategory | undefined> {
    try {
      console.log(`Looking up skill category by name: "${name}"`);
      
      const result = await pool.query(
        `SELECT * FROM skill_categories WHERE LOWER(name) = LOWER($1)`,
        [name]
      );
      
      if (result.rows.length === 0) {
        console.log(`No category found with name "${name}"`);
        return undefined;
      }
      
      console.log(`Found category: ${result.rows[0].name} (ID: ${result.rows[0].id})`);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill category by name:", error);
      return undefined; // Return undefined instead of throwing
    }
  }
  
  async getSkillSubcategoryByNameAndCategory(
    name: string, 
    categoryId: number
  ): Promise<SkillSubcategory | undefined> {
    try {
      console.log(`Looking up subcategory "${name}" in category ID ${categoryId}`);
      
      const result = await pool.query(
        `SELECT * FROM skill_subcategories 
         WHERE LOWER(name) = LOWER($1) AND category_id = $2`,
        [name, categoryId]
      );
      
      if (result.rows.length === 0) {
        console.log(`No subcategory found with name "${name}" in category ${categoryId}`);
        return undefined;
      }
      
      console.log(`Found subcategory: ${result.rows[0].name} (ID: ${result.rows[0].id})`);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill subcategory:", error);
      return undefined; // Return undefined instead of throwing
    }
  }
  
  async getSkillTemplateByNameAndCategory(
    name: string,
    categoryId: number | null
  ): Promise<SkillTemplate | undefined> {
    try {
      if (!categoryId) {
        console.log("Cannot look up skill template without categoryId");
        return undefined;
      }
      
      console.log(`Looking up skill template "${name}" in category ID ${categoryId}`);
      
      const result = await pool.query(
        `SELECT * FROM skill_templates 
         WHERE LOWER(name) = LOWER($1) AND category_id = $2`,
        [name, categoryId]
      );
      
      if (result.rows.length === 0) {
        console.log(`No skill template found with name "${name}" in category ${categoryId}`);
        return undefined;
      }
      
      console.log(`Found skill template: ${result.rows[0].name} (ID: ${result.rows[0].id})`);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill template by name and category:", error);
      return undefined; // Return undefined instead of throwing
    }
  }
  
  async getAllAdmins(): Promise<User[]> {
    try {
      const result = await pool.query(
        `SELECT ${SAFE_USER_COLUMNS} FROM users WHERE is_admin = true`
      );
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all admin users:", error);
      return []; // Return empty array instead of throwing
    }
  }
  
  async createSkillTemplate(template: InsertSkillTemplate): Promise<SkillTemplate> {
    console.log(`🔍 TRACE: createSkillTemplate called with data:`, JSON.stringify(template, null, 2));
    
    // Input validation
    if (!template) {
      console.error("❌ TRACE: No template data provided");
      throw new Error("No template data provided");
    }
    
    if (!template.name) {
      console.error("❌ TRACE: Template name is required");
      throw new Error("Template name is required");
    }
    
    // Safety check to ensure objects are properly passed
    if (typeof template !== 'object') {
      console.error(`❌ TRACE: Invalid template data type: ${typeof template}`);
      throw new Error(`Invalid template data type: ${typeof template}`);
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      console.log(`🔍 TRACE: Transaction begun`);
      
      // Ensure we have the necessary category information
      let categoryName = template.category;
      let categoryId = template.categoryId;

      console.log(`🔍 TRACE: Initial category data - Name: "${categoryName}", ID: ${categoryId}`);

      // If categoryId is provided but not category name, look up the category name
      if (categoryId && !categoryName) {
        console.log(`🔍 TRACE: Looking up category name for ID ${categoryId}`);
        const categoryResult = await client.query(
          'SELECT name FROM skill_categories WHERE id = $1',
          [categoryId]
        );
        
        if (categoryResult.rows.length > 0) {
          categoryName = categoryResult.rows[0].name;
          console.log(`✅ TRACE: Found category name "${categoryName}" for categoryId ${categoryId}`);
        } else {
          console.error(`❌ TRACE: Could not find category name for categoryId ${categoryId}`);
          throw new Error(`Invalid categoryId: ${categoryId} - category not found`);
        }
      }
      // If category name is provided but not categoryId, look up the categoryId
      else if (categoryName && !categoryId) {
        console.log(`🔍 TRACE: Looking up categoryId for name "${categoryName}"`);
        const categoryResult = await client.query(
          'SELECT id FROM skill_categories WHERE name = $1',
          [categoryName]
        );
        
        if (categoryResult.rows.length > 0) {
          categoryId = categoryResult.rows[0].id;
          console.log(`✅ TRACE: Found categoryId ${categoryId} for category name "${categoryName}"`);
        } else {
          console.error(`❌ TRACE: Could not find categoryId for category name "${categoryName}"`);
          throw new Error(`Invalid category name: ${categoryName} - category not found`);
        }
      }
      
      // Verify we have both categoryId and categoryName
      if (!categoryId || !categoryName) {
        console.error(`❌ TRACE: Missing required category information - ID: ${categoryId}, Name: ${categoryName}`);
        throw new Error(`Missing required category information. Need either category name or categoryId.`);
      }

      // Verify subcategoryId is valid if provided
      if (template.subcategoryId) {
        console.log(`🔍 TRACE: Verifying subcategoryId ${template.subcategoryId} for category ${categoryId}`);
        const subcategoryResult = await client.query(
          'SELECT id, name FROM skill_subcategories WHERE id = $1 AND category_id = $2',
          [template.subcategoryId, categoryId]
        );
        
        if (subcategoryResult.rows.length === 0) {
          console.error(`❌ TRACE: Invalid subcategoryId ${template.subcategoryId} for category ${categoryId}`);
          throw new Error(`Invalid subcategoryId: ${template.subcategoryId} - subcategory not found or doesn't belong to category ${categoryName}`);
        } else {
          console.log(`✅ TRACE: Verified subcategory: ${subcategoryResult.rows[0].name} (ID: ${template.subcategoryId})`);
        }
      }

      // Check if a template with the same name already exists in this category
      console.log(`🔍 TRACE: Checking if template "${template.name}" already exists in category ${categoryName} (ID: ${categoryId})`);
      const existingTemplateCheck = await client.query(
        'SELECT id FROM skill_templates WHERE name = $1 AND category_id = $2',
        [template.name, categoryId]
      );
      
      if (existingTemplateCheck.rows.length > 0) {
        console.log(`⚠️ TRACE: Template "${template.name}" already exists in category ${categoryName} with ID ${existingTemplateCheck.rows[0].id}`);
        
        const existingTemplate = await client.query(
          'SELECT * FROM skill_templates WHERE id = $1',
          [existingTemplateCheck.rows[0].id]
        );
        
        await client.query('COMMIT');
        console.log(`✅ TRACE: Returning existing template with ID ${existingTemplateCheck.rows[0].id}`);
        return this.snakeToCamel(existingTemplate.rows[0]);
      }

      // Log what's being used for the template creation
      console.log(`🔍 TRACE: Creating new skill template with: 
        name: ${template.name},
        category: ${categoryName},
        categoryId: ${categoryId},
        subcategoryId: ${template.subcategoryId || 'null'}`);

      // Use explicit column names to avoid any ordering issues
      const insertSQL = `INSERT INTO skill_templates (
           name, 
           category, 
           category_id, 
           subcategory_id, 
           description, 
           is_recommended, 
           target_level, 
           target_date
         ) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`;
         
      const insertParams = [
          template.name,
          categoryName,
          categoryId,
          template.subcategoryId || null,
          template.description || '',
          template.isRecommended || false,
          template.targetLevel || null,
          template.targetDate || null
      ];
      
      console.log(`🔍 TRACE: Executing SQL: ${insertSQL}`);
      console.log(`🔍 TRACE: Parameters: ${JSON.stringify(insertParams)}`);
      
      const result = await client.query(insertSQL, insertParams);
      
      if (result.rows.length === 0) {
        console.error(`❌ TRACE: Insert succeeded but no record returned`);
        await client.query('ROLLBACK');
        throw new Error('Failed to create skill template - no record returned');
      }
      
      await client.query('COMMIT');
      console.log(`✅ TRACE: Successfully created skill template with ID ${result.rows[0].id}`);
      console.log(`✅ TRACE: Complete template data:`, JSON.stringify(result.rows[0], null, 2));
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("❌ TRACE: Error creating skill template:", error);
      // Enhanced error logging to help diagnose the issue
      if (error instanceof Error) {
        console.error("❌ TRACE: Error details:", {
          message: error.message,
          stack: error.stack,
          template: JSON.stringify(template, null, 2)
        });
      }
      throw error;
    } finally {
      client.release();
      console.log(`🔍 TRACE: Database client released`);
    }
  }
  
  async updateSkillTemplate(id: number, data: Partial<SkillTemplate>): Promise<SkillTemplate> {
    try {
      const sets: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      // Build SET clause and parameters
      for (const [key, value] of Object.entries(data)) {
        if (key === 'id' || key === 'createdAt') continue; // Skip id and createdAt
        
        // Convert camelCase to snake_case for database column names
        const columnName = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${columnName} = $${paramIndex}`);
        params.push(value === null ? null : value);
        paramIndex++;
      }
      
      // Add updated_at timestamp
      sets.push(`updated_at = CURRENT_TIMESTAMP`);
      
      params.push(id); // Add id as the last parameter
      
      const result = await pool.query(
        `UPDATE skill_templates SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );
      
      if (result.rows.length === 0) {
        throw new Error("Skill template not found");
      }
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error updating skill template:", error);
      throw error;
    }
  }
  
  /**
   * Delete a skill template and all associated user skills
   * This is a cascading delete that removes:
   * 1. All user skills that reference this template
   * 2. All pending skill updates for those user skills
   * 3. All endorsements for those user skills
   * 4. All notifications related to those user skills
   * 5. All project skills that reference this template
   * 6. Finally, the skill template itself
   * 
   * This operation requires super admin privileges
   */
  async deleteSkillTemplate(id: number, forceCascade: boolean = false): Promise<{ deletedUserSkills: number; deletedProjectSkills: number; deletedTemplate: boolean }> {
    console.log(`Deleting skill template with ID ${id} (forceCascade=${forceCascade})`);
    
    try {
      // First check if the template exists
      const templateCheck = await pool.query(
        'SELECT id, name, category FROM skill_templates WHERE id = $1',
        [id]
      );
      
      if (templateCheck.rows.length === 0) {
        console.log(`Skill template with ID ${id} not found`);
        throw new Error(`Skill template with ID ${id} not found`);
      }
      
      const template = templateCheck.rows[0];
      console.log(`Found template: ${template.name} (${template.category})`);
      
      // Find all user skills to count them for the return value
      const userSkillsResult = await pool.query(
        'SELECT COUNT(*) as count FROM user_skills WHERE skill_template_id = $1',
        [id]
      );
      const userSkillCount = parseInt(userSkillsResult.rows[0].count);
      console.log(`Found ${userSkillCount} user skills referencing this template`);
      
      // Check project skills to see if there are any dependencies
      const projectSkillsResult = await pool.query(
        'SELECT COUNT(*) as count FROM project_skills WHERE skill_id = $1',
        [id]
      );
      const projectSkillCount = parseInt(projectSkillsResult.rows[0].count);
      console.log(`Found ${projectSkillCount} project skills referencing this template`);
      
      // If there are dependencies and forceCascade is false, return an error
      if ((userSkillCount > 0 || projectSkillCount > 0) && !forceCascade) {
        throw new Error(`Cannot delete skill template with ID ${id} because it has ${userSkillCount} user skills and ${projectSkillCount} project skills referencing it. Use forceCascade=true to delete anyway.`);
      }
      
      // Execute all deletions in a specific, safe order
      // Each step is executed separately to avoid transaction issues
      
      // 1. First remove notifications that reference user_skills with this template
      console.log("Step 1: Deleting notifications related to template's user skills");
      const notificationsResult = await pool.query(
        'DELETE FROM notifications WHERE related_user_skill_id IN (SELECT id FROM user_skills WHERE skill_template_id = $1) RETURNING id',
        [id]
      );
      console.log(`  Deleted ${notificationsResult.rowCount} notifications`);
      
      // 2. Remove endorsements for user_skills with this template
      console.log("Step 2: Deleting endorsements for user skills");
      const endorsementsResult = await pool.query(
        'DELETE FROM endorsements WHERE user_skill_id IN (SELECT id FROM user_skills WHERE skill_template_id = $1) RETURNING id',
        [id]
      );
      console.log(`  Deleted ${endorsementsResult.rowCount} endorsements`);
      
      // 3. Delete pending skill updates referencing this template
      // Via user_skill_id from skills with this template
      console.log("Step 3: Deleting pending skill updates (via user_skill_id)");
      const psuResult1 = await pool.query(
        'DELETE FROM pending_skill_updates WHERE user_skill_id IN (SELECT id FROM user_skills WHERE skill_template_id = $1) RETURNING id',
        [id]
      );
      console.log(`  Deleted ${psuResult1.rowCount} pending skill updates via user_skill_id`);
      
      // Via skill_template_id (v2 schema)
      console.log("Step 4: Deleting pending skill updates (via skill_template_id)");
      const psuResult2 = await pool.query(
        'DELETE FROM pending_skill_updates WHERE skill_template_id = $1 RETURNING id',
        [id]
      );
      console.log(`  Deleted ${psuResult2.rowCount} pending skill updates via skill_template_id`);
      
      // Via skill_id (legacy schema)
      console.log("Step 5: Deleting pending skill updates (via skill_id)");
      const psuResult3 = await pool.query(
        'DELETE FROM pending_skill_updates WHERE skill_id = $1 RETURNING id',
        [id]
      );
      console.log(`  Deleted ${psuResult3.rowCount} pending skill updates via skill_id`);
      
      // Try with pending_skill_updates_v2 table if it exists
      try {
        console.log("Step 6: Checking for and deleting from pending_skill_updates_v2");
        const psuV2Result = await pool.query(
          'DELETE FROM pending_skill_updates_v2 WHERE skill_template_id = $1 RETURNING id',
          [id]
        );
        console.log(`  Deleted ${psuV2Result.rowCount} pending skill updates from v2 table`);
      } catch (err) {
        // This is expected to fail if the table doesn't exist
        console.log("  Note: Could not delete from pending_skill_updates_v2, table may not exist");
      }
      
      // 4. Delete history entries for user skills with this template
      console.log("Step 7: Deleting skill histories for user skills with this template");
      const historyResult = await pool.query(
        'DELETE FROM skill_histories WHERE user_skill_id IN (SELECT id FROM user_skills WHERE skill_template_id = $1) RETURNING id',
        [id]
      );
      console.log(`  Deleted ${historyResult.rowCount} skill history entries`);
      
      // 5. Delete user skills referencing this template
      console.log("Step 8: Deleting user skills referencing this template");
      const userSkillsDeleteResult = await pool.query(
        'DELETE FROM user_skills WHERE skill_template_id = $1 RETURNING id',
        [id]
      );
      console.log(`  Deleted ${userSkillsDeleteResult.rowCount} user skills`);
      
      // 6. Delete project skills referencing this template
      console.log("Step 9: Deleting project skills referencing this template");
      const projectSkillsDeleteResult = await pool.query(
        'DELETE FROM project_skills WHERE skill_id = $1 RETURNING id',
        [id]
      );
      console.log(`  Deleted ${projectSkillsDeleteResult.rowCount} project skills`);
      
      // 7. Finally, delete the skill template
      console.log("Step 10: Deleting the skill template itself");
      const deleteResult = await pool.query(
        'DELETE FROM skill_templates WHERE id = $1 RETURNING id',
        [id]
      );
      
      if (deleteResult.rowCount === 0) {
        // This should never happen since we checked earlier
        console.error(`No rows deleted for skill template ${id}`);
        throw new Error(`Failed to delete skill template ${id}`);
      }
      
      console.log(`✓ Successfully deleted skill template ${id}`);
      
      return {
        deletedUserSkills: userSkillCount,
        deletedProjectSkills: projectSkillCount,
        deletedTemplate: true
      };
    } catch (error) {
      console.error(`Error deleting skill template ${id}:`, error);
      throw error;
    }
  }
  
  // Skill Target operations
  async getAllSkillTargets(): Promise<SkillTarget[]> {
    try {
      const result = await pool.query('SELECT * FROM skill_targets ORDER BY name');
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all skill targets:", error);
      throw error;
    }
  }
  
  async getSkillTarget(id: number): Promise<SkillTarget | undefined> {
    try {
      const result = await pool.query('SELECT * FROM skill_targets WHERE id = $1', [id]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill target:", error);
      throw error;
    }
  }
  
  async createSkillTarget(target: InsertSkillTarget): Promise<SkillTarget> {
    try {
      const result = await pool.query(
        `INSERT INTO skill_targets (name, description, target_level, target_date, target_number) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [
          target.name,
          target.description || '',
          target.targetLevel,
          target.targetDate || null,
          target.targetNumber || null
        ]
      );
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating skill target:", error);
      throw error;
    }
  }
  
  async updateSkillTarget(id: number, data: Partial<SkillTarget>): Promise<SkillTarget> {
    try {
      console.log(`Storage: Updating skill target ${id} with data:`, data);
      
      const sets: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      // Build SET clause and parameters
      for (const [key, value] of Object.entries(data)) {
        if (key === 'id' || key === 'createdAt') continue; // Skip id and createdAt
        
        // Convert camelCase to snake_case for database column names
        const columnName = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${columnName} = $${paramIndex}`);
        params.push(value === null ? null : value);
        console.log(`  - Setting ${columnName} = ${value === null ? 'NULL' : value} (param $${paramIndex})`);
        paramIndex++;
      }
      
      // Add updated_at timestamp
      sets.push(`updated_at = CURRENT_TIMESTAMP`);
      
      params.push(id); // Add id as the last parameter
      
      const result = await pool.query(
        `UPDATE skill_targets SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );
      
      if (result.rows.length === 0) {
        throw new Error("Skill target not found");
      }
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error updating skill target:", error);
      throw error;
    }
  }
  
  async deleteSkillTarget(id: number): Promise<void> {
    try {
      // Start a transaction
      await pool.query('BEGIN');
      
      try {
        // Log the skills associated with this target before deletion (for tracking migrations)
        const skillsToDelete = await this.getSkillTargetSkills(id);
        console.log(`Deleting skill target ${id} with ${skillsToDelete.length} associated skill references`);
        
        // If there are skills, log details about each one
        if (skillsToDelete.length > 0) {
          console.log(`Skills being removed from target ${id}: ${skillsToDelete.join(', ')}`);
          
          // Check which of these are user_skills
          const userSkillsCheck = await pool.query(
            `SELECT id FROM user_skills WHERE id = ANY($1)`,
            [skillsToDelete]
          );
          
          console.log(`Among ${skillsToDelete.length} skills, ${userSkillsCheck.rows.length} are user_skills`);
        }
        
        // Delete all associated skill-target and user-target mappings
        await pool.query('DELETE FROM skill_target_skills WHERE target_id = $1', [id]);
        await pool.query('DELETE FROM skill_target_users WHERE target_id = $1', [id]);
        
        // Then delete the target
        const result = await pool.query('DELETE FROM skill_targets WHERE id = $1', [id]);
        
        if (result.rowCount === 0) {
          throw new Error("Skill target not found");
        }
        
        await pool.query('COMMIT');
        console.log(`Successfully deleted skill target ${id}`);
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error("Error deleting skill target:", error);
      throw error;
    }
  }
  
  async getSkillTargetSkills(targetId: number): Promise<number[]> {
    try {
      // Maintain compatibility - continue querying the same table
      // When skills are fully migrated, this table would reference user_skills IDs
      const result = await pool.query(
        'SELECT skill_id FROM skill_target_skills WHERE target_id = $1',
        [targetId]
      );
      
      // Verify each skill ID exists in user_skills table and log warning for any that don't
      const skillIds = result.rows.map(row => row.skill_id);
      
      if (skillIds.length > 0) {
        // Log info for migration troubleshooting
        console.log(`Found ${skillIds.length} skills for target ${targetId}`);
        
        // Verify which of these IDs exist in user_skills
        const userSkillsCheck = await pool.query(
          `SELECT id FROM user_skills WHERE id = ANY($1)`,
          [skillIds]
        );
        
        if (userSkillsCheck.rows.length < skillIds.length) {
          console.warn(`Warning: Only ${userSkillsCheck.rows.length} out of ${skillIds.length} skill IDs exist in user_skills table`);
        }
      }
      
      return skillIds;
    } catch (error) {
      console.error("Error getting skill target skills:", error);
      throw error;
    }
  }
  
  async addSkillToTarget(targetId: number, skillId: number): Promise<void> {
    try {
      // First verify this is a valid user_skill ID
      const skillCheck = await pool.query(
        'SELECT id FROM user_skills WHERE id = $1',
        [skillId]
      );
      
      if (skillCheck.rows.length === 0) {
        throw new Error(`Cannot add skill to target: user_skill with ID ${skillId} does not exist`);
      }
      
      // Check if mapping already exists
      const existsCheck = await pool.query(
        'SELECT 1 FROM skill_target_skills WHERE target_id = $1 AND skill_id = $2',
        [targetId, skillId]
      );
      
      if (existsCheck.rows.length === 0) {
        await pool.query(
          'INSERT INTO skill_target_skills (target_id, skill_id) VALUES ($1, $2)',
          [targetId, skillId]
        );
        console.log(`Added user_skill ${skillId} to target ${targetId}`);
      }
    } catch (error) {
      console.error("Error adding skill to target:", error);
      throw error;
    }
  }
  
  async removeSkillFromTarget(targetId: number, skillId: number): Promise<void> {
    try {
      await pool.query(
        'DELETE FROM skill_target_skills WHERE target_id = $1 AND skill_id = $2',
        [targetId, skillId]
      );
      console.log(`Removed skill ${skillId} from target ${targetId}`);
    } catch (error) {
      console.error("Error removing skill from target:", error);
      throw error;
    }
  }
  
  async getSkillTargetUsers(targetId: number): Promise<number[]> {
    try {
      const result = await pool.query(
        'SELECT user_id FROM skill_target_users WHERE target_id = $1',
        [targetId]
      );
      return result.rows.map(row => row.user_id);
    } catch (error) {
      console.error("Error getting skill target users:", error);
      throw error;
    }
  }
  
  async addUserToTarget(targetId: number, userId: number): Promise<void> {
    try {
      // Check if mapping already exists
      const existsCheck = await pool.query(
        'SELECT 1 FROM skill_target_users WHERE target_id = $1 AND user_id = $2',
        [targetId, userId]
      );
      
      if (existsCheck.rows.length === 0) {
        await pool.query(
          'INSERT INTO skill_target_users (target_id, user_id) VALUES ($1, $2)',
          [targetId, userId]
        );
      }
    } catch (error) {
      console.error("Error adding user to target:", error);
      throw error;
    }
  }
  
  async removeUserFromTarget(targetId: number, userId: number): Promise<void> {
    try {
      await pool.query(
        'DELETE FROM skill_target_users WHERE target_id = $1 AND user_id = $2',
        [targetId, userId]
      );
    } catch (error) {
      console.error("Error removing user from target:", error);
      throw error;
    }
  }

  // Pending Skill Updates operations
  async getPendingSkillUpdates(): Promise<PendingSkillUpdate[]> {
    try {
      const result = await pool.query(
        `SELECT p.*, u.email as user_email, u.username as username
         FROM pending_skill_updates p
         JOIN users u ON p.user_id = u.id
         WHERE p.status = 'pending'
         ORDER BY p.submitted_at DESC`
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting pending skill updates:", error);
      throw error;
    }
  }

  async getPendingSkillUpdatesByUser(userId: number): Promise<PendingSkillUpdate[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM pending_skill_updates
         WHERE user_id = $1
         ORDER BY submitted_at DESC`,
        [userId]
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting pending skill updates by user:", error);
      throw error;
    }
  }

  async getPendingSkillUpdate(id: number): Promise<PendingSkillUpdate | undefined> {
    try {
      const result = await pool.query(
        `SELECT p.*, u.email as user_email, u.username as username
         FROM pending_skill_updates p
         JOIN users u ON p.user_id = u.id
         WHERE p.id = $1`,
        [id]
      );
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting pending skill update:", error);
      throw error;
    }
  }

  async createPendingSkillUpdate(update: InsertPendingSkillUpdate): Promise<PendingSkillUpdate> {
    try {
      // Log the incoming data to help with debugging
      console.log("Creating pending skill update with data:", update);
      
      // Create a standardized update object that handles both camelCase and snake_case
      const standardizedUpdate: Record<string, any> = {};
      
      // Create a map of fields for quick access to both versions
      const specialFields = {
        // Map camelCase to snake_case
        userId: 'user_id',
        skillId: 'skill_id',
        categoryId: 'category_id',
        subcategoryId: 'subcategory_id',
        isUpdate: 'is_update',
        credlyLink: 'credly_link',
        certificationDate: 'certification_date',
        expirationDate: 'expiration_date',
        submittedAt: 'submitted_at',
        reviewedAt: 'reviewed_at',
        reviewedBy: 'reviewed_by',
        reviewNotes: 'review_notes'
      };
      
      // Standardize the update object, prioritizing camelCase but falling back to snake_case
      for (const [camelKey, snakeKey] of Object.entries(specialFields)) {
        // First check if the camelCase key exists in the update
        if (camelKey in update) {
          standardizedUpdate[snakeKey] = update[camelKey as keyof typeof update];
        } 
        // Then check if the snake_case version exists (for backward compatibility)
        else if (snakeKey in update) {
          standardizedUpdate[snakeKey] = update[snakeKey as any];
        }
      }
      
      // Add the rest of the fields with normal camelToSnake conversion
      for (const key in update) {
        if (update.hasOwnProperty(key)) {
          // Skip already processed special fields
          if (Object.keys(specialFields).includes(key) || Object.values(specialFields).includes(key)) {
            continue;
          }
          
          // Convert the key to snake_case
          const snakeKey = this.camelToSnake(key);
          standardizedUpdate[snakeKey] = update[key as keyof typeof update];
        }
      }
      
      // Now build the SQL query using the standardized update
      const fields = Object.keys(standardizedUpdate)
        .filter(key => standardizedUpdate[key] !== undefined);
      
      const placeholders = fields.map((_, index) => `$${index + 1}`);
      const values = fields.map(key => {
        const value = standardizedUpdate[key];
        
        // Handle empty strings and null values consistently
        if (value === '') return null;
        if ((key === 'skill_id' || key === 'skillId') && !value) return null;
        
        return value;
      });
      
      // Ensure we have values to insert
      if (fields.length === 0) {
        throw new Error("No valid fields provided for pending skill update");
      }
      
      const query = `
        INSERT INTO pending_skill_updates (${fields.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;
      
      // Log the query for debugging
      console.log("Generated SQL query:", query);
      console.log("SQL parameters:", values);
      
      const result = await pool.query(query, values);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating pending skill update:", error);
      throw error;
    }
  }

  async approvePendingSkillUpdate(id: number, reviewerId: number, notes?: string): Promise<Skill> {
    try {
      // Start a transaction
      await pool.query('BEGIN');
      console.log(`Starting approval for pending skill update ID ${id} by reviewer ${reviewerId}`);

      // Get the pending update data
      const pendingResult = await pool.query(
        'SELECT * FROM pending_skill_updates WHERE id = $1',
        [id]
      );
      
      if (pendingResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        throw new Error('Pending skill update not found');
      }
      
      const rawPendingUpdate = pendingResult.rows[0];
      console.log(`Raw pending update data:`, JSON.stringify(rawPendingUpdate));
      
      // Sanitize data
      const sanitizedData = {...rawPendingUpdate};
      if (sanitizedData.subcategory_id === '' || sanitizedData.subcategory_id === undefined) {
        sanitizedData.subcategory_id = null;
      }
      if (sanitizedData.category_id === '' || sanitizedData.category_id === undefined) {
        sanitizedData.category_id = null;
      }
      
      // Convert to camelCase
      const pendingUpdate = this.snakeToCamel(sanitizedData) as PendingSkillUpdate;
      
      let skill: Skill;
      let previousLevel: string | null = null;
      
      if (pendingUpdate.isUpdate && pendingUpdate.skillId) {
        // This is an update to an existing skill
        console.log(`Processing update for existing skill ID ${pendingUpdate.skillId}`);
        
        // Get current skill details for history tracking
        const existingSkill = await this.getSkill(pendingUpdate.skillId);
        if (!existingSkill) {
          await pool.query('ROLLBACK');
          throw new Error('Skill to update not found');
        }
        
        previousLevel = existingSkill.level;
        
        // Check if this is a user_skill or legacy skill
        const userSkillCheck = await pool.query(
          'SELECT * FROM user_skills WHERE id = $1',
          [pendingUpdate.skillId]
        );
        
        if (userSkillCheck.rows.length > 0) {
          // Update existing user_skill
          console.log(`Updating existing user_skill record`);
          
          const updateResult = await pool.query(
            `UPDATE user_skills SET 
              level = $1, 
              certification = $2, 
              credly_link = $3, 
              notes = $4,
              certification_date = $5,
              expiration_date = $6,
              last_updated = CURRENT_TIMESTAMP
            WHERE id = $7 
            RETURNING *`,
            [
              pendingUpdate.level,
              pendingUpdate.certification || '',
              pendingUpdate.credlyLink || '',
              pendingUpdate.notes || '',
              pendingUpdate.certificationDate,
              pendingUpdate.expirationDate,
              pendingUpdate.skillId
            ]
          );
          
          if (updateResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            throw new Error('Failed to update user skill');
          }
          
          const updatedUserSkill = await this.getUserSkillById(pendingUpdate.skillId);
          if (!updatedUserSkill) {
            await pool.query('ROLLBACK');
            throw new Error('Could not retrieve updated user skill');
          }
          
          skill = this.userSkillToLegacySkill(updatedUserSkill);
        } else {
          // Migrate legacy skill to user_skills
          console.log(`Migrating legacy skill to user_skills table`);
          
          // Find or create matching skill template
          let skillTemplateId: number;
          const templateResult = await pool.query(
            'SELECT * FROM skill_templates WHERE name = $1 OR LOWER(name) = LOWER($1)',
            [pendingUpdate.name]
          );
          
          if (templateResult.rows.length > 0) {
            skillTemplateId = templateResult.rows[0].id;
          } else {
            const newTemplateResult = await pool.query(
              `INSERT INTO skill_templates (name, category, description, category_id, subcategory_id) 
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [
                pendingUpdate.name,
                pendingUpdate.category,
                '',
                pendingUpdate.categoryId,
                pendingUpdate.subcategoryId
              ]
            );
            skillTemplateId = newTemplateResult.rows[0].id;
          }
          
          // Create new user_skill record
          const userSkillResult = await pool.query(
            `INSERT INTO user_skills (
              user_id, skill_template_id, level, certification, credly_link, notes, 
              certification_date, expiration_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
              pendingUpdate.userId,
              skillTemplateId,
              pendingUpdate.level,
              pendingUpdate.certification || '',
              pendingUpdate.credlyLink || '',
              pendingUpdate.notes || '',
              pendingUpdate.certificationDate,
              pendingUpdate.expirationDate
            ]
          );
          
          // Mark legacy skill as migrated
          await pool.query(
            `UPDATE skills SET notes = CONCAT(COALESCE(notes, ''), ' [MIGRATED TO USER_SKILLS: ', $1, ']') 
             WHERE id = $2`,
            [userSkillResult.rows[0].id, pendingUpdate.skillId]
          );
          
          // Update pending update to reference new skill
          await pool.query(
            `UPDATE pending_skill_updates SET skill_id = $1 WHERE id = $2`,
            [userSkillResult.rows[0].id, id]
          );
          
          const fullUserSkill = await this.getUserSkillById(userSkillResult.rows[0].id);
          if (!fullUserSkill) {
            await pool.query('ROLLBACK');
            throw new Error('Could not retrieve migrated user skill');
          }
          
          skill = this.userSkillToLegacySkill(fullUserSkill);
          pendingUpdate.skillId = userSkillResult.rows[0].id;
        }
      } else {
        // This is a new skill
        console.log(`Creating new skill for user ${pendingUpdate.userId}`);
        
        // Find or create matching skill template
        let skillTemplateId: number;
        const templateResult = await pool.query(
          'SELECT * FROM skill_templates WHERE name = $1 OR LOWER(name) = LOWER($1)',
          [pendingUpdate.name]
        );
        
        if (templateResult.rows.length > 0) {
          skillTemplateId = templateResult.rows[0].id;
        } else {
          const newTemplateResult = await pool.query(
            `INSERT INTO skill_templates (name, category, description, category_id, subcategory_id) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [
              pendingUpdate.name,
              pendingUpdate.category,
              '',
              pendingUpdate.categoryId,
              pendingUpdate.subcategoryId
            ]
          );
          skillTemplateId = newTemplateResult.rows[0].id;
        }
        
        // Create new user_skill record
        const userSkillResult = await pool.query(
          `INSERT INTO user_skills (
            user_id, skill_template_id, level, certification, credly_link, notes, 
            certification_date, expiration_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            pendingUpdate.userId,
            skillTemplateId,
            pendingUpdate.level,
            pendingUpdate.certification || '',
            pendingUpdate.credlyLink || '',
            pendingUpdate.notes || '',
            pendingUpdate.certificationDate,
            pendingUpdate.expirationDate
          ]
        );
        
        // Update pending update reference
        await pool.query(
          `UPDATE pending_skill_updates SET skill_id = $1 WHERE id = $2`,
          [userSkillResult.rows[0].id, id]
        );
        
        const fullUserSkill = await this.getUserSkillById(userSkillResult.rows[0].id);
        if (!fullUserSkill) {
          await pool.query('ROLLBACK');
          throw new Error('Could not retrieve newly created user skill');
        }
        
        skill = this.userSkillToLegacySkill(fullUserSkill);
      }
      
      // Update pending update status
      await pool.query(
        `UPDATE pending_skill_updates SET 
          status = 'approved', 
          reviewed_by = $1,
          review_notes = $2,
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
        [reviewerId, notes || '', id]
      );
      
      // Add history entry
      await this.createSkillHistory({
        skillId: skill.id,
        userId: pendingUpdate.userId,
        previousLevel: previousLevel,
        newLevel: pendingUpdate.level,
        changeNote: `Approved by admin (ID: ${reviewerId})${notes ? ': ' + notes : ''}`
      });
      
      // Create notification
      await this.createNotification({
        userId: pendingUpdate.userId,
        type: 'achievement',
        content: `Your skill "${pendingUpdate.name}" has been approved!`,
        relatedSkillId: skill.id,
        relatedUserId: reviewerId
      });
      
      // Commit transaction
      await pool.query('COMMIT');
      
      return skill;
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error approving skill update:', error);
      throw error;
    }
  }

  async rejectPendingSkillUpdate(id: number, reviewerId: number, notes?: string): Promise<void> {
    try {
      // Start a transaction
      await pool.query('BEGIN');
      
      console.log(`Starting rejection for pending skill update ID ${id} by reviewer ${reviewerId}`);
      
      // Get the pending update to be rejected
      const pendingResult = await pool.query(
        'SELECT * FROM pending_skill_updates WHERE id = $1',
        [id]
      );
      
      if (pendingResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        throw new Error('Pending skill update not found');
      }
      
      // Get the pending update data
      const rawPendingUpdate = pendingResult.rows[0];
      console.log(`Raw pending update data for rejection:`, JSON.stringify(rawPendingUpdate));
      
      // Create a sanitized version of the raw data that handles empty strings properly
      const sanitizedData = {...rawPendingUpdate};
      
      // Handle numeric fields specifically
      if (sanitizedData.subcategory_id === '' || sanitizedData.subcategory_id === undefined) {
        sanitizedData.subcategory_id = null;
        console.log('Fixed empty subcategory_id to null for rejection');
      }
      
      if (sanitizedData.category_id === '' || sanitizedData.category_id === undefined) {
        sanitizedData.category_id = null;
        console.log('Fixed empty category_id to null for rejection');
      }
      
      console.log(`Sanitized pending update data for rejection:`, JSON.stringify(sanitizedData));
      
      // Now convert to camelCase
      const pendingUpdate = this.snakeToCamel(sanitizedData) as PendingSkillUpdate;
      console.log(`CamelCase pending update data for rejection:`, JSON.stringify(pendingUpdate));
      
      // Update the pending update status
      console.log(`Updating pending skill update status to rejected`);
      await pool.query(
        `UPDATE pending_skill_updates SET 
         status = 'rejected', 
         reviewed_at = CURRENT_TIMESTAMP, 
         reviewed_by = $1,
         review_notes = $2
         WHERE id = $3`,
        [reviewerId, notes || null, id]
      );
      
      // Create a notification for the user
      console.log(`Creating notification for rejected skill update for user ${pendingUpdate.userId}`);
      await this.createNotification({
        userId: pendingUpdate.userId,
        type: 'achievement', // Reusing achievement type for now
        content: `Your skill "${pendingUpdate.name}" was not approved. ${notes || 'No reason provided.'}`,
        relatedUserId: reviewerId
      });
      
      // Commit the transaction
      await pool.query('COMMIT');
      console.log(`Rejection transaction committed successfully`);
    } catch (error) {
      // Roll back the transaction on error
      await pool.query('ROLLBACK');
      console.error("Error rejecting pending skill update:", error);
      throw error;
    }
  }

  // Pending Skill Updates V2 operations
  async getPendingSkillUpdatesV2(): Promise<PendingSkillUpdateV2[]> {
    try {
      console.log("Getting all pending skill updates from pending_skill_updates table");
      const result = await pool.query(`
        SELECT p.*, 
               st.name as skill_name, 
               st.category as skill_category,
               u.username as user_username,
               u.email as user_email,
               r.username as reviewer_username
        FROM pending_skill_updates p
        LEFT JOIN skill_templates st ON p.skill_template_id = st.id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN users r ON p.reviewed_by = r.id
        WHERE p.status = 'pending'
        ORDER BY p.submitted_at DESC
      `);
      
      console.log(`Found ${result.rows.length} pending skill updates`);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting pending skill updates V2:", error);
      throw error;
    }
  }

  async getPendingSkillUpdatesByUserV2(userId: number): Promise<PendingSkillUpdateV2[]> {
    try {
      console.log(`Getting pending skill updates for user ${userId} from pending_skill_updates table`);
      const result = await pool.query(`
        SELECT p.*, 
               st.name as skill_name, 
               st.category as skill_category,
               u.username as user_username,
               u.email as user_email,
               r.username as reviewer_username
        FROM pending_skill_updates p
        LEFT JOIN skill_templates st ON p.skill_template_id = st.id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN users r ON p.reviewed_by = r.id
        WHERE p.user_id = $1 AND p.status = 'pending'
        ORDER BY p.submitted_at DESC
      `, [userId]);
      
      console.log(`Found ${result.rows.length} pending updates for user ${userId}`);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting pending skill updates V2 by user:", error);
      throw error;
    }
  }

  async getPendingSkillUpdateV2(id: number): Promise<PendingSkillUpdateV2 | undefined> {
    try {
      console.log(`Getting pending skill update with ID ${id} from pending_skill_updates table`);
      const result = await pool.query(`
        SELECT p.*, 
               st.name as skill_name, 
               st.category as skill_category,
               u.username as user_username,
               u.email as user_email,
               r.username as reviewer_username
        FROM pending_skill_updates p
        LEFT JOIN skill_templates st ON p.skill_template_id = st.id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN users r ON p.reviewed_by = r.id
        WHERE p.id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        console.log(`No pending skill update found with ID ${id}`);
        return undefined;
      }
      
      console.log(`Found pending skill update with ID ${id}`);
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting pending skill update V2:", error);
      throw error;
    }
  }

  async createPendingSkillUpdateV2(update: InsertPendingSkillUpdateV2): Promise<PendingSkillUpdateV2> {
    try {
      // Log the incoming data to help with debugging
      console.log("Creating pending skill update V2 with data:", update);
      
      // Convert camelCase to snake_case for database insertion
      const fields: string[] = [];
      const placeholders: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      // Explicitly handle all possible fields, including nested ones
      for (const [key, value] of Object.entries(update)) {
        let dbField = key;
        
        // Convert camelCase to snake_case
        if (key === 'userId') dbField = 'user_id';
        else if (key === 'userSkillId') dbField = 'user_skill_id';
        else if (key === 'skillTemplateId') dbField = 'skill_template_id';
        else if (key === 'credlyLink') dbField = 'credly_link';
        else if (key === 'certificationDate') dbField = 'certification_date';
        else if (key === 'expirationDate') dbField = 'expiration_date';
        else if (key === 'isUpdate') dbField = 'is_update';
        else if (key === 'reviewedAt') dbField = 'reviewed_at';
        else if (key === 'reviewedBy') dbField = 'reviewed_by';
        else if (key === 'reviewNotes') dbField = 'review_notes';
        
        // Skip null/undefined values except for explicit nulls
        if (value === undefined) continue;
        
        fields.push(dbField);
        placeholders.push(`$${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
      
      // Add the status field if not provided
      if (!fields.includes('status')) {
        fields.push('status');
        placeholders.push(`$${paramIndex}`);
        values.push('pending');
        paramIndex++;
      }
      
      // Add the submitted_at field if not provided
      if (!fields.includes('submitted_at')) {
        fields.push('submitted_at');
        placeholders.push(`CURRENT_TIMESTAMP`);
      }
      
      const query = `
        INSERT INTO pending_skill_updates (${fields.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;
      
      console.log("Executing insert query:", query);
      console.log("With values:", values);
      
      const result = await pool.query(query, values);
      const insertedData = result.rows[0];
      
      // Get the full pending update with all joined data
      return await this.getPendingSkillUpdateV2(insertedData.id) as PendingSkillUpdateV2;
    } catch (error) {
      console.error("Error creating pending skill update V2:", error);
      throw error;
    }
  }

  async approvePendingSkillUpdateV2(id: number, reviewerId: number, notes?: string): Promise<UserSkill> {
    try {
      // Start a transaction
      await pool.query('BEGIN');
      
      console.log(`Starting approval for pending skill update V2 ID ${id} by reviewer ${reviewerId}`);
      
      // First, get the raw pending update without joins to check if it's a custom skill with sentinel value
      const rawPendingResult = await pool.query(`
        SELECT * FROM pending_skill_updates WHERE id = $1
      `, [id]);
      
      if (rawPendingResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        throw new Error('Pending skill update not found');
      }
      
      // Check for custom skill with sentinel value (-1)
      const rawPendingUpdate = this.snakeToCamel(rawPendingResult.rows[0]) as PendingSkillUpdateV2;
      let pendingUpdate: PendingSkillUpdateV2;
      let isCustomSkill = false;
      
      if (rawPendingUpdate.skillTemplateId === -1) {
        console.log('Custom skill detected with sentinel template ID (-1)');
        isCustomSkill = true;
        
        // For custom skills, we need to get additional fields that might be stored elsewhere
        // Get original request data from the request/notes
        const originalResult = await pool.query(`
          SELECT * FROM pending_skill_updates 
          LEFT JOIN users u ON pending_skill_updates.user_id = u.id
          WHERE pending_skill_updates.id = $1
        `, [id]);
        
        if (originalResult.rows.length === 0) {
          await pool.query('ROLLBACK');
          throw new Error('Could not retrieve custom skill data');
        }
        
        pendingUpdate = this.snakeToCamel(originalResult.rows[0]) as PendingSkillUpdateV2;
      } else {
        // Normal skill (non-custom) - get the pending update with joins to templates and categories
        const pendingResult = await pool.query(`
          SELECT p.*, 
                 st.name as skill_name, 
                 st.category as skill_category,
                 sc.name as category_name,
                 sc.color as category_color,
                 sc.icon as category_icon, 
                 ss.name as subcategory_name,
                 ss.color as subcategory_color,
                 ss.icon as subcategory_icon
          FROM pending_skill_updates p
          JOIN skill_templates st ON p.skill_template_id = st.id
          LEFT JOIN skill_categories sc ON st.category_id = sc.id 
          LEFT JOIN skill_subcategories ss ON st.subcategory_id = ss.id
          WHERE p.id = $1
        `, [id]);
        
        if (pendingResult.rows.length === 0) {
          await pool.query('ROLLBACK');
          throw new Error('Pending skill update details not found');
        }
        
        pendingUpdate = this.snakeToCamel(pendingResult.rows[0]) as PendingSkillUpdateV2;
      }
      
      console.log(`Pending update data:`, JSON.stringify(pendingUpdate));
      
      let userSkill: UserSkill;
      
      // For custom skills, create a new skill template record
      if (isCustomSkill) {
        console.log('Creating new skill template for custom skill');
        
        // Get the custom skill data from notes or metadata
        // We need to extract the name, category, subcategory (if any)
        // Note: We should store these in a structured way in pendingUpdate.notes
        const skillName = pendingUpdate.notes ? pendingUpdate.notes.split(':')[0].trim() : "Custom Skill";
        
        // Extract category and subcategory info - this may come from different sources
        // Try to get from the pending update data or from any additional metadata
        const customSkillQuery = await pool.query(`
          SELECT 
            p.*,
            psu.meta_data
          FROM pending_skill_updates p
          LEFT JOIN pending_skill_update_metadata psu ON p.id = psu.pending_skill_update_id
          WHERE p.id = $1
        `, [id]);

        const customSkillData = customSkillQuery.rows[0] || {};
        let metaData = {};
        
        // Parse metadata if available
        if (customSkillData.meta_data) {
          try {
            metaData = JSON.parse(customSkillData.meta_data);
            console.log('Custom skill metadata:', metaData);
          } catch (err) {
            console.error('Failed to parse custom skill metadata:', err);
          }
        }
        
        // Get category and subcategory information, with fallbacks
        // These might come from:
        // 1. Metadata (preferred)
        // 2. Notes in a specific format
        // 3. Default values
        const category = (pendingUpdate.notes && pendingUpdate.notes.includes('Category:') ? 
          pendingUpdate.notes.split('Category:')[1].split('\n')[0].trim() : 'Other');
        
        // Extract subcategory name from notes if present, for finding subcategory ID
        const subcategoryName = (pendingUpdate.notes && pendingUpdate.notes.includes('Subcategory:') ? 
          pendingUpdate.notes.split('Subcategory:')[1].split('\n')[0].trim() : null);
        
        // Get or create the category ID
        let categoryId: number | null = null;
        if (category) {
          const categoryResult = await pool.query(
            'SELECT id FROM skill_categories WHERE name = $1',
            [category]
          );
          
          if (categoryResult.rows.length > 0) {
            categoryId = categoryResult.rows[0].id;
          } else {
            // Create a new category if it doesn't exist
            console.log(`Creating new skill category: ${category}`);
            const newCategoryResult = await pool.query(
              'INSERT INTO skill_categories (name, description, color, icon) VALUES ($1, $2, $3, $4) RETURNING id',
              [category, `Custom category for ${category}`, '#4B5563', 'square'] // Default color and icon
            );
            
            if (newCategoryResult.rows.length > 0) {
              categoryId = newCategoryResult.rows[0].id;
            }
          }
        }
        
        // Get or create the subcategory ID
        let subcategoryId: number | null = null;
        if (subcategoryName && categoryId) {
          const subcategoryResult = await pool.query(
            'SELECT id FROM skill_subcategories WHERE name = $1 AND category_id = $2',
            [subcategoryName, categoryId]
          );
          
          if (subcategoryResult.rows.length > 0) {
            subcategoryId = subcategoryResult.rows[0].id;
          } else if (subcategoryName) {
            // Create a new subcategory if it doesn't exist
            console.log(`Creating new skill subcategory: ${subcategoryName} under category ${category} (${categoryId})`);
            const newSubcategoryResult = await pool.query(
              'INSERT INTO skill_subcategories (name, description, category_id, color, icon) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [subcategoryName, `Custom subcategory for ${subcategoryName}`, categoryId, '#4B5563', 'square'] // Default color and icon
            );
            
            if (newSubcategoryResult.rows.length > 0) {
              subcategoryId = newSubcategoryResult.rows[0].id;
            }
          }
        }
        
        // Create a new skill template
        console.log(`Creating new skill template for ${skillName} in category ${category} (${categoryId}) and subcategory ${subcategoryName || 'None'} (${subcategoryId})`);
        const templateResult = await pool.query(`
          INSERT INTO skill_templates (
            name, 
            category, 
            description,
            category_id,
            subcategory_id,
            is_recommended,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id
        `, [
          skillName,
          category,
          `Custom skill created by approval of user request`,
          categoryId,
          subcategoryId,
          true // Mark as recommended
        ]);
        
        if (templateResult.rows.length === 0) {
          await pool.query('ROLLBACK');
          throw new Error('Failed to create new skill template for custom skill');
        }
        
        // Update the pending skill update with the new template ID
        const newTemplateId = templateResult.rows[0].id;
        console.log(`Created new skill template with ID ${newTemplateId}`);
        
        // Update the pending skill update to use the new template ID
        await pool.query(`
          UPDATE pending_skill_updates 
          SET skill_template_id = $1 
          WHERE id = $2
        `, [newTemplateId, id]);
        
        // Update our in-memory object to use the new template ID
        pendingUpdate.skillTemplateId = newTemplateId;
      }
      
      // Check if it's a new skill or an update
      if (pendingUpdate.isUpdate && pendingUpdate.userSkillId) {
        // It's an update to an existing skill
        console.log(`Updating existing user skill ID ${pendingUpdate.userSkillId}`);
        
        // Get current skill state for history recording
        const currentSkillResult = await pool.query(
          'SELECT * FROM user_skills WHERE id = $1',
          [pendingUpdate.userSkillId]
        );
        
        if (currentSkillResult.rows.length === 0) {
          await pool.query('ROLLBACK');
          throw new Error(`User skill with ID ${pendingUpdate.userSkillId} not found`);
        }
        
        const currentSkill = this.snakeToCamel(currentSkillResult.rows[0]);
        console.log(`Current skill data:`, JSON.stringify(currentSkill));
        
        // Create skill history entry
        await pool.query(`
          INSERT INTO skill_histories (
            user_skill_id, user_id, previous_level, new_level, change_note, change_by_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `, [
          pendingUpdate.userSkillId,
          pendingUpdate.userId,
          currentSkill.level,
          pendingUpdate.level,
          `Skill updated via approval process.${notes ? ` Note: ${notes}` : ''}`,
          reviewerId || pendingUpdate.userId  // Use reviewerId instead of approverId
        ]);
        
        // Update the user skill
        await pool.query(`
          UPDATE user_skills SET 
            level = $1, 
            certification = $2, 
            credly_link = $3, 
            notes = $4,
            certification_date = $5,
            expiration_date = $6,
            last_updated = CURRENT_TIMESTAMP
          WHERE id = $7
        `, [
          pendingUpdate.level,
          pendingUpdate.certification || '',
          pendingUpdate.credlyLink || '',
          pendingUpdate.notes || '',
          pendingUpdate.certificationDate || null,
          pendingUpdate.expirationDate || null,
          pendingUpdate.userSkillId
        ]);
        
        // Get the updated skill
        userSkill = await this.getUserSkillById(pendingUpdate.userSkillId) as UserSkill;
      } else {
        // It's a new skill
        console.log(`Creating new user skill from template ID ${pendingUpdate.skillTemplateId}`);
        
        // First, check if this user already has a skill with this template
        const existingSkillResult = await pool.query(
          'SELECT * FROM user_skills WHERE user_id = $1 AND skill_template_id = $2',
          [pendingUpdate.userId, pendingUpdate.skillTemplateId]
        );
        
        if (existingSkillResult.rows.length > 0) {
          // Skill already exists, so treat it as an update instead
          console.log(`Skill with template ID ${pendingUpdate.skillTemplateId} already exists for user ${pendingUpdate.userId}, updating instead`);
          
          const existingSkill = this.snakeToCamel(existingSkillResult.rows[0]);
          
          // Create skill history entry using existing skill_histories table
          await pool.query(`
            INSERT INTO skill_histories (
              skill_id, user_id, user_skill_id, previous_level, new_level, change_note,
              change_by_id, created_at
            ) VALUES (
              (SELECT id FROM skills WHERE name = $1 AND user_id = $2 LIMIT 1),
              $2, $3, $4, $5, $6, $7, NOW()
            )
          `, [
            pendingUpdate.name,
            pendingUpdate.userId,
            existingSkill.id,
            existingSkill.level,
            pendingUpdate.level,
            `Skill updated via approval process.${notes ? ` Note: ${notes}` : ''}`,
            reviewerId
          ]);
          
          // Update the existing skill
          await pool.query(`
            UPDATE user_skills SET 
              level = $1, 
              certification = $2, 
              credly_link = $3, 
              notes = $4,
              certification_date = $5,
              expiration_date = $6,
              last_updated = CURRENT_TIMESTAMP
            WHERE id = $7
          `, [
            pendingUpdate.level,
            pendingUpdate.certification || '',
            pendingUpdate.credlyLink || '',
            pendingUpdate.notes || '',
            pendingUpdate.certificationDate || null,
            pendingUpdate.expirationDate || null,
            existingSkill.id
          ]);
          
          // Get the updated skill
          userSkill = await this.getUserSkillById(existingSkill.id) as UserSkill;
          
        } else {
          // Create a new user skill - it doesn't exist yet
          userSkill = await this.createUserSkill({
            userId: pendingUpdate.userId,
            skillTemplateId: pendingUpdate.skillTemplateId,
            level: pendingUpdate.level,
            certification: pendingUpdate.certification || '',
            credlyLink: pendingUpdate.credlyLink || '',
            notes: pendingUpdate.notes || '',
            certificationDate: pendingUpdate.certificationDate || null,
            expirationDate: pendingUpdate.expirationDate || null
          });
          
          // Create a skill history entry for the new skill using the existing skill_histories table
          await pool.query(`
            INSERT INTO skill_histories (
              skill_id, user_id, user_skill_id, previous_level, new_level, change_note, 
              change_by_id, created_at
            ) VALUES (
              (SELECT id FROM skills WHERE name = $1 AND user_id = $2 LIMIT 1), 
              $2, $3, $4, $5, $6, $7, NOW()
            )
          `, [
            pendingUpdate.name,
            pendingUpdate.userId,
            userSkill.id,
            null,
            pendingUpdate.level,
            `Skill created via approval process.${notes ? ` Note: ${notes}` : ''}`,
            reviewerId
          ]);
        }
      }
      
      // Update the pending update status
      console.log(`Updating pending skill update status to approved`);
      await pool.query(`
        UPDATE pending_skill_updates SET 
         status = 'approved', 
         reviewed_at = CURRENT_TIMESTAMP, 
         reviewed_by = $1,
         review_notes = $2,
         user_skill_id = $3
         WHERE id = $4
      `, [
        reviewerId, 
        notes || null, 
        userSkill.id,
        id
      ]);
      
      // Create a notification for the user
      await this.createNotification({
        userId: pendingUpdate.userId,
        type: 'level_up',
        content: `Your ${pendingUpdate.isUpdate ? 'skill update' : 'new skill'} request for "${pendingUpdate.skillName}" was approved.${notes ? ` Note: ${notes}` : ''}`,
        relatedUserSkillId: userSkill.id // Using userSkillId instead of relatedSkillId
      });
      
      // Get user email and first name to send email notification
      const userData = await pool.query(`
        SELECT email, first_name FROM users WHERE id = $1
      `, [pendingUpdate.userId]);
      
      await pool.query('COMMIT');
      console.log(`Approval transaction committed successfully`);
      
      // Send email notification after transaction is complete
      if (userData.rows.length > 0) {
        const userEmail = userData.rows[0].email;
        const firstName = userData.rows[0].first_name || 'User';
        
        // Send approval email asynchronously (don't await)
        // Making sure skillName exists before sending
        const skillName = pendingUpdate.skillName || 'skill';
        sendSkillApprovedEmail(
          userEmail,
          firstName,
          skillName
        ).catch(error => {
          console.error('Failed to send skill approval email:', error);
        });
        
        console.log(`Triggered skill approval email to ${userEmail} for skill "${skillName}"`);
      }
      
      return userSkill;
    } catch (error) {
      // Roll back the transaction on error
      await pool.query('ROLLBACK');
      console.error('Error approving skill update V2:', error);
      throw error;
    }
  }

  async rejectPendingSkillUpdateV2(id: number, reviewerId: number, notes?: string): Promise<void> {
    try {
      // Start a transaction
      await pool.query('BEGIN');
      
      console.log(`Starting rejection for pending skill update V2 ID ${id} by reviewer ${reviewerId}`);
      
      // First, get the raw pending update without joins to check if it's a custom skill with sentinel value
      const rawPendingResult = await pool.query(`
        SELECT * FROM pending_skill_updates WHERE id = $1
      `, [id]);
      
      if (rawPendingResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        throw new Error('Pending skill update not found');
      }
      
      // Check for custom skill with sentinel value (-1)
      const rawPendingUpdate = this.snakeToCamel(rawPendingResult.rows[0]) as PendingSkillUpdateV2;
      let pendingUpdate: PendingSkillUpdateV2;
      let isCustomSkill = false;
      
      if (rawPendingUpdate.skillTemplateId === -1) {
        console.log('Custom skill with sentinel template ID (-1) being rejected');
        isCustomSkill = true;
        
        // For custom skills, we need to get additional fields that might be stored elsewhere
        const originalResult = await pool.query(`
          SELECT * FROM pending_skill_updates 
          LEFT JOIN users u ON pending_skill_updates.user_id = u.id
          WHERE pending_skill_updates.id = $1
        `, [id]);
        
        if (originalResult.rows.length === 0) {
          await pool.query('ROLLBACK');
          throw new Error('Could not retrieve custom skill data');
        }
        
        pendingUpdate = this.snakeToCamel(originalResult.rows[0]) as PendingSkillUpdateV2;
        
        // For custom skills, the name might be in the notes
        pendingUpdate.skillName = pendingUpdate.notes ? pendingUpdate.notes.split(':')[0].trim() : "Custom Skill";
        pendingUpdate.skillCategory = "Custom";
      } else {
        // Regular skill - get with template info
        const pendingResult = await pool.query(`
          SELECT p.*, 
                 st.name as skill_name, 
                 st.category as skill_category,
                 sc.name as category_name,
                 sc.color as category_color,
                 sc.icon as category_icon, 
                 ss.name as subcategory_name,
                 ss.color as subcategory_color,
                 ss.icon as subcategory_icon
          FROM pending_skill_updates p
          JOIN skill_templates st ON p.skill_template_id = st.id
          LEFT JOIN skill_categories sc ON st.category_id = sc.id 
          LEFT JOIN skill_subcategories ss ON st.subcategory_id = ss.id
          WHERE p.id = $1
        `, [id]);
        
        if (pendingResult.rows.length === 0) {
          await pool.query('ROLLBACK');
          throw new Error('Pending skill update V2 not found');
        }
        
        pendingUpdate = this.snakeToCamel(pendingResult.rows[0]) as PendingSkillUpdateV2;
      }
      
      console.log(`Pending update V2 data for rejection:`, JSON.stringify(pendingUpdate));
      
      // Update the pending update status
      console.log(`Updating pending skill update V2 status to rejected`);
      await pool.query(`
        UPDATE pending_skill_updates SET 
         status = 'rejected', 
         reviewed_at = CURRENT_TIMESTAMP, 
         reviewed_by = $1,
         review_notes = $2
         WHERE id = $3
      `, [reviewerId, notes || null, id]);
      
      // Create a notification for the user
      await this.createNotification({
        userId: pendingUpdate.userId,
        type: 'endorsement', // Use endorsement type for rejection too
        content: `Your ${pendingUpdate.isUpdate ? 'skill update' : 'new skill'} request for "${pendingUpdate.skillName}" was rejected.${notes ? ` Note: ${notes}` : ''}`
      });
      
      // Get user email and first name to send email notification
      const userData = await pool.query(`
        SELECT email, first_name FROM users WHERE id = $1
      `, [pendingUpdate.userId]);
      
      await pool.query('COMMIT');
      console.log(`Rejection transaction committed successfully`);
      
      // Send email notification after transaction is complete
      if (userData.rows.length > 0) {
        const userEmail = userData.rows[0].email;
        const firstName = userData.rows[0].first_name || 'User';
        
        // Send rejection email asynchronously (don't await)
        // Making sure skillName exists before sending
        const skillName = pendingUpdate.skillName || 'skill';
        sendSkillRejectedEmail(
          userEmail,
          firstName,
          skillName
        ).catch(error => {
          console.error('Failed to send skill rejection email:', error);
        });
        
        console.log(`Triggered skill rejection email to ${userEmail} for skill "${skillName}"`);
      }
    } catch (error) {
      // Roll back the transaction on error
      await pool.query('ROLLBACK');
      console.error("Error rejecting pending skill update V2:", error);
      throw error;
    }
  }

  // Client operations
  async getAllClients(): Promise<Client[]> {
    try {
      const result = await pool.query('SELECT * FROM clients ORDER BY name');
      return result.rows.map(row => this.snakeToCamel(row)) as Client[];
    } catch (error) {
      console.error("Error retrieving clients:", error);
      throw error;
    }
  }

  async getClient(id: number): Promise<Client | undefined> {
    try {
      const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return undefined;
      }
      return this.snakeToCamel(result.rows[0]) as Client;
    } catch (error) {
      console.error(`Error retrieving client ${id}:`, error);
      throw error;
    }
  }

  async createClient(client: InsertClient): Promise<Client> {
    try {
      console.log("Creating client with data:", JSON.stringify(client, null, 2));
      
      const result = await pool.query(
        `INSERT INTO clients (name, industry, contact_name, contact_email, contact_phone, website, logo_url, notes, account_manager_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [
          client.name,
          client.industry || null,
          client.contactName || null,
          client.contactEmail || null,
          client.contactPhone || null,
          client.website || null,
          client.logoUrl || null,
          client.notes || null,
          client.accountManagerId || null // Add the account manager ID
        ]
      );
      
      // Log the created client for debugging
      console.log("Created client:", JSON.stringify(result.rows[0], null, 2));
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating client:", error);
      throw error;
    }
  }

  async updateClient(id: number, data: Partial<Client>): Promise<Client> {
    try {
      const client = await this.getClient(id);
      if (!client) {
        throw new Error('Client not found');
      }

      const updateFields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          updateFields.push(`${this.camelToSnake(key)} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      if (updateFields.length === 0) {
        return client;
      }

      values.push(id);
      const query = `UPDATE clients SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
      const result = await pool.query(query, values);

      return this.snakeToCamel(result.rows[0]) as Client;
    } catch (error) {
      console.error(`Error updating client ${id}:`, error);
      throw error;
    }
  }

  async deleteClient(id: number): Promise<void> {
    try {
      // Check if client exists
      const client = await this.getClient(id);
      if (!client) {
        throw new Error('Client not found');
      }

      // Check if client has projects
      const projects = await this.getClientProjects(id);
      if (projects.length > 0) {
        throw new Error('Cannot delete client with associated projects');
      }

      await pool.query('DELETE FROM clients WHERE id = $1', [id]);
    } catch (error) {
      console.error(`Error deleting client ${id}:`, error);
      throw error;
    }
  }

  async searchClients(query: string): Promise<Client[]> {
    try {
      const searchQuery = `%${query}%`;
      const result = await pool.query(
        'SELECT * FROM clients WHERE name ILIKE $1 OR industry ILIKE $1 OR location ILIKE $1 ORDER BY name',
        [searchQuery]
      );
      return result.rows.map(row => this.snakeToCamel(row)) as Client[];
    } catch (error) {
      console.error(`Error searching clients with query '${query}':`, error);
      throw error;
    }
  }

  // Project operations
  async getAllProjects(): Promise<Project[]> {
    try {
      const result = await pool.query(`
        SELECT p.*, c.name as client_name, 
        u1.username as lead_name, 
        u2.username as delivery_lead_name
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u1 ON p.lead_id = u1.id
        LEFT JOIN users u2 ON p.delivery_lead_id = u2.id
        ORDER BY p.name
      `);
      return result.rows.map(row => this.snakeToCamel(row)) as Project[];
    } catch (error) {
      console.error("Error retrieving projects:", error);
      throw error;
    }
  }

  async getProject(id: number): Promise<Project | undefined> {
    try {
      // Explicitly list all fields to ensure nothing is missed
      const result = await pool.query(`
        SELECT 
          p.id, 
          p.name, 
          p.description, 
          p.client_id, 
          p.start_date, 
          p.end_date, 
          p.location, 
          p.confluence_link, 
          p.lead_id, 
          p.delivery_lead_id, 
          p.status, 
          p.created_at, 
          p.updated_at,
          p.project_lead_email, 
          p.client_engagement_lead_email,
          p.hr_coordinator_email, 
          p.finance_team_email,
          c.name as client_name, 
          u1.username as lead_name, 
          u2.username as delivery_lead_name
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u1 ON p.lead_id = u1.id
        LEFT JOIN users u2 ON p.delivery_lead_id = u2.id
        WHERE p.id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        return undefined;
      }
      
      // Log the raw result for debugging
      console.log(`Project data for ID ${id}:`, JSON.stringify(result.rows[0]));
      
      const transformedProject = this.snakeToCamel(result.rows[0]) as Project;
      
      // Log the transformed result to ensure HR/Finance emails are present
      console.log(`Transformed project data for ID ${id}:`, JSON.stringify({
        id: transformedProject.id,
        name: transformedProject.name,
        hrCoordinatorEmail: transformedProject.hrCoordinatorEmail,
        financeTeamEmail: transformedProject.financeTeamEmail
      }));
      
      return transformedProject;
    } catch (error) {
      console.error(`Error retrieving project ${id}:`, error);
      throw error;
    }
  }

  async createProject(project: InsertProject): Promise<Project> {
    try {
      // Start transaction
      await pool.query('BEGIN');
      
      const { 
        name, description, clientId, startDate, endDate, 
        location, confluenceLink, leadId, deliveryLeadId, status,
        projectLeadEmail, clientEngagementLeadEmail, 
        hrCoordinatorEmail, financeTeamEmail
      } = project;
      
      const result = await pool.query(
        `INSERT INTO projects (
          name, description, client_id, start_date, end_date, 
          location, confluence_link, lead_id, delivery_lead_id, status,
          project_lead_email, client_engagement_lead_email,
          hr_coordinator_email, finance_team_email
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [name, description, clientId, startDate, endDate, 
         location, confluenceLink, leadId, deliveryLeadId, status,
         projectLeadEmail, clientEngagementLeadEmail,
         hrCoordinatorEmail, financeTeamEmail]
      );
      
      const newProjectId = result.rows[0].id;
      
      // If project lead is specified, add them as a resource
      if (leadId) {
        try {
          await this.addLeadAsResource(newProjectId, leadId, 'Project Lead');
        } catch (err) {
          console.error("Error adding project lead as resource:", err);
          // Continue even if adding the lead as a resource fails
        }
      }
      
      // If delivery lead is specified, add them as a resource
      if (deliveryLeadId) {
        try {
          await this.addLeadAsResource(newProjectId, deliveryLeadId, 'Delivery Lead');
        } catch (err) {
          console.error("Error adding delivery lead as resource:", err);
          // Continue even if adding the delivery lead as a resource fails
        }
      }
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Fetch the complete project with joined data
      const createdProject = await this.getProject(newProjectId);
      
      // Send email notification to HR and Finance
      try {
        let clientName = null;
        let leadName = null;
        
        // Get client name if a client is associated
        if (clientId) {
          const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [clientId]);
          if (clientResult.rows.length > 0) {
            clientName = clientResult.rows[0].name;
          }
        }
        
        // Get lead name if a lead is assigned
        if (leadId) {
          const leadResult = await pool.query('SELECT username FROM users WHERE id = $1', [leadId]);
          if (leadResult.rows.length > 0) {
            leadName = leadResult.rows[0].username;
          }
        }
        
        // Import the email functionality
        const { sendProjectCreatedEmail } = await import('./email');
        
        // Send notification with project-specific email addresses if provided
        await sendProjectCreatedEmail(
          name,
          clientName,
          description,
          startDate,
          endDate,
          leadName,
          hrCoordinatorEmail || null,
          financeTeamEmail || null
        );
        
        console.log(`Email notification sent for new project: ${name}`);
      } catch (emailError) {
        // Log the error but don't fail the operation
        console.error("Error sending project creation email notification:", emailError);
      }
      
      return createdProject;
    } catch (error) {
      // Rollback transaction if error occurs
      await pool.query('ROLLBACK');
      console.error("Error creating project:", error);
      throw error;
    }
  }

  async updateProject(id: number, data: Partial<Project>, performedByUserId?: number): Promise<Project> {
    try {
      const project = await this.getProject(id);
      if (!project) {
        throw new Error('Project not found');
      }

      const updateFields = [];
      const values = [];
      let paramCount = 1;
      
      // Track changes for notification email
      const changedFields: { field: string, oldValue?: string | null, newValue?: string | null }[] = [];
      
      // Store original lead and client info for email notification
      let clientName: string | null = null;
      let leadName: string | null = null;
      
      // Get client name if needed
      if (project.clientId) {
        try {
          const client = await this.getClient(project.clientId);
          if (client) {
            clientName = client.name;
          }
        } catch (err) {
          console.warn("Could not fetch client name for email notification:", err);
        }
      }
      
      // Get lead name if needed
      if (project.leadId) {
        try {
          const lead = await this.getUser(project.leadId);
          if (lead) {
            leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.username;
          }
        } catch (err) {
          console.warn("Could not fetch lead name for email notification:", err);
        }
      }
      
      // Get performer name if available
      let performerName: string | null = null;
      if (performedByUserId) {
        try {
          const performer = await this.getUser(performedByUserId);
          if (performer) {
            performerName = `${performer.firstName || ''} ${performer.lastName || ''}`.trim() || performer.username;
          }
        } catch (err) {
          console.warn("Could not fetch performer name for email notification:", err);
        }
      }

      for (const [key, value] of Object.entries(data)) {
        // Skip joined fields that aren't in the table
        if (['clientName', 'leadName', 'deliveryLeadName'].includes(key)) {
          continue;
        }
        
        if (value !== undefined) {
          updateFields.push(`${this.camelToSnake(key)} = $${paramCount}`);
          values.push(value);
          paramCount++;
          
          // Track significant field changes for notification
          if (['name', 'status', 'description', 'clientId', 'leadId', 'startDate', 'endDate', 'location'].includes(key)) {
            let oldValueDisplay = (project as any)[key]?.toString() || null;
            let newValueDisplay = value?.toString() || null;
            
            // Format the fields for better readability
            if (key === 'clientId' && value !== null) {
              newValueDisplay = 'New client assignment';
              try {
                // Try to get the new client name
                const newClient = await this.getClient(value as number);
                if (newClient) {
                  newValueDisplay = newClient.name;
                }
              } catch (err) {
                console.warn("Could not fetch new client name for email notification:", err);
              }
              
              if (project.clientId) {
                oldValueDisplay = clientName || 'Unknown client';
              } else {
                oldValueDisplay = 'No client';
              }
            }
            
            if (key === 'leadId' && value !== null) {
              newValueDisplay = 'New project lead';
              try {
                // Try to get the new lead name
                const newLead = await this.getUser(value as number);
                if (newLead) {
                  newValueDisplay = `${newLead.firstName || ''} ${newLead.lastName || ''}`.trim() || newLead.username;
                }
              } catch (err) {
                console.warn("Could not fetch new lead name for email notification:", err);
              }
              
              if (project.leadId) {
                oldValueDisplay = leadName || 'Unknown lead';
              } else {
                oldValueDisplay = 'No lead assigned';
              }
            }
            
            // Format dates in a readable way
            if (['startDate', 'endDate'].includes(key)) {
              if (value) {
                try {
                  const date = new Date(value as string | number | Date);
                  newValueDisplay = date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  });
                } catch (err) {
                  console.warn(`Could not format new ${key} for email notification:`, err);
                }
              }
              
              if (project[key as keyof Project]) {
                try {
                  const date = new Date(project[key as keyof Project] as string | number | Date);
                  oldValueDisplay = date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  });
                } catch (err) {
                  console.warn(`Could not format old ${key} for email notification:`, err);
                }
              }
            }
            
            // Only add if there's actually a change
            if (oldValueDisplay !== newValueDisplay) {
              let fieldDisplay = key;
              // Make field names more readable
              switch (key) {
                case 'clientId': fieldDisplay = 'Client'; break;
                case 'leadId': fieldDisplay = 'Project Lead'; break;
                case 'startDate': fieldDisplay = 'Start Date'; break;
                case 'endDate': fieldDisplay = 'End Date'; break;
                case 'name': fieldDisplay = 'Project Name'; break;
                default: 
                  // Capitalize first letter of each word
                  fieldDisplay = key.replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase());
              }
              
              changedFields.push({
                field: fieldDisplay,
                oldValue: oldValueDisplay,
                newValue: newValueDisplay
              });
            }
          }
        }
      }

      if (updateFields.length === 0) {
        return project;
      }

      values.push(id);
      const query = `UPDATE projects SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
      const result = await pool.query(query, values);
      
      // Fetch the updated project with joined data
      const updatedProject = await this.getProject(id);
      
      // Send notification email if there are significant changes
      if (changedFields.length > 0) {
        try {
          const { sendProjectUpdatedEmail } = await import('./email');
          
          // Send notification with project-specific email addresses if provided
          await sendProjectUpdatedEmail(
            project.name,
            clientName,
            project.description,
            project.startDate,
            project.endDate,
            leadName,
            changedFields,
            project.hrCoordinatorEmail || null,
            project.financeTeamEmail || null,
            performerName
          );
          
          console.log(`Email notification sent for project update: ${project.name}`);
        } catch (emailError) {
          // Log the error but don't fail the operation
          console.error("Error sending project update email notification:", emailError);
        }
      }

      return updatedProject;
    } catch (error) {
      console.error(`Error updating project ${id}:`, error);
      throw error;
    }
  }

  async deleteProject(id: number): Promise<void> {
    try {
      // Check if project exists
      const project = await this.getProject(id);
      if (!project) {
        throw new Error('Project not found');
      }

      // Start transaction
      await pool.query('BEGIN');

      // Delete project resources first (cascading delete)
      await pool.query('DELETE FROM project_resources WHERE project_id = $1', [id]);
      
      // Ensure all project skills are deleted (using skill_template_id or skill_id)
      await pool.query('DELETE FROM project_skills WHERE project_id = $1', [id]);
      
      // Delete the project
      await pool.query('DELETE FROM projects WHERE id = $1', [id]);
      
      // Commit transaction
      await pool.query('COMMIT');
    } catch (error) {
      // Rollback in case of error
      await pool.query('ROLLBACK');
      console.error(`Error deleting project ${id}:`, error);
      throw error;
    }
  }

  async getUserProjects(userId: number): Promise<Project[]> {
    try {
      const result = await pool.query(`
        SELECT DISTINCT p.*, c.name as client_name, 
        u1.username as lead_name, 
        u2.username as delivery_lead_name
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u1 ON p.lead_id = u1.id
        LEFT JOIN users u2 ON p.delivery_lead_id = u2.id
        LEFT JOIN project_resources pr ON p.id = pr.project_id
        WHERE pr.user_id = $1 OR p.lead_id = $1 OR p.delivery_lead_id = $1
        ORDER BY p.name
      `, [userId]);
      return result.rows.map(row => this.snakeToCamel(row)) as Project[];
    } catch (error) {
      console.error(`Error retrieving projects for user ${userId}:`, error);
      throw error;
    }
  }

  async getClientProjects(clientId: number): Promise<Project[]> {
    try {
      const result = await pool.query(`
        SELECT p.*, c.name as client_name, 
        u1.username as lead_name, 
        u2.username as delivery_lead_name
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u1 ON p.lead_id = u1.id
        LEFT JOIN users u2 ON p.delivery_lead_id = u2.id
        WHERE p.client_id = $1
        ORDER BY p.name
      `, [clientId]);
      return result.rows.map(row => this.snakeToCamel(row)) as Project[];
    } catch (error) {
      console.error(`Error retrieving projects for client ${clientId}:`, error);
      throw error;
    }
  }

  async searchProjects(query: string): Promise<Project[]> {
    try {
      const searchQuery = `%${query}%`;
      const result = await pool.query(`
        SELECT p.*, c.name as client_name, 
        u1.username as lead_name, 
        u2.username as delivery_lead_name
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN users u1 ON p.lead_id = u1.id
        LEFT JOIN users u2 ON p.delivery_lead_id = u2.id
        WHERE p.name ILIKE $1 OR p.description ILIKE $1 OR p.location ILIKE $1 
        OR c.name ILIKE $1 OR u1.username ILIKE $1 OR u2.username ILIKE $1
        ORDER BY p.name
      `, [searchQuery]);
      return result.rows.map(row => this.snakeToCamel(row)) as Project[];
    } catch (error) {
      console.error(`Error searching projects with query '${query}':`, error);
      throw error;
    }
  }

  // Project Resources operations
  async getProjectResources(projectId: number): Promise<ProjectResource[]> {
    try {
      const result = await pool.query(`
        SELECT pr.*, u.username, u.email, u.first_name, u.last_name
        FROM project_resources pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.project_id = $1
        ORDER BY pr.role
      `, [projectId]);
      
      // Log raw database data for debugging
      if (result.rows.length > 0) {
        console.log("Raw project resources from DB:", JSON.stringify(result.rows[0], null, 2));
      }
      
      // Transform and return data with proper date handling
      const resources = result.rows.map(row => {
        // Ensure dates are properly formatted as strings
        if (row.start_date) {
          row.start_date = new Date(row.start_date).toISOString();
        }
        if (row.end_date) {
          row.end_date = new Date(row.end_date).toISOString();
        }
        return this.snakeToCamel(row);
      }) as ProjectResource[];
      
      if (resources.length > 0) {
        console.log("Processed resources with dates:", JSON.stringify(resources[0], null, 2));
      }
      
      return resources;
    } catch (error) {
      console.error(`Error retrieving resources for project ${projectId}:`, error);
      throw error;
    }
  }

  // getUserProjectResources implementation moved to line ~2867

  async getProjectResource(id: number): Promise<ProjectResource | undefined> {
    try {
      const result = await pool.query(`
        SELECT pr.*, u.username, u.email, u.first_name, u.last_name, p.name as project_name
        FROM project_resources pr
        JOIN users u ON pr.user_id = u.id
        JOIN projects p ON pr.project_id = p.id
        WHERE pr.id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        return undefined;
      }
      
      // Log the raw data from database for debugging
      console.log(`Raw project resource ${id} from DB:`, JSON.stringify(result.rows[0], null, 2));
      
      // Ensure dates are properly formatted
      const row = result.rows[0];
      if (row.start_date) {
        row.start_date = new Date(row.start_date).toISOString();
      }
      if (row.end_date) {
        row.end_date = new Date(row.end_date).toISOString();
      }
      
      const resource = this.snakeToCamel(row) as ProjectResource;
      console.log(`Processed resource ${id} with dates:`, JSON.stringify(resource, null, 2));
      
      return resource;
    } catch (error) {
      console.error(`Error retrieving project resource ${id}:`, error);
      throw error;
    }
  }

  async createProjectResource(resource: InsertProjectResource, performedByUserId?: number): Promise<ProjectResource> {
    try {
      const { projectId, userId, role, allocation, startDate, endDate, notes } = resource;
      
      // Debug log for incoming date values
      console.log("Creating resource with dates:", { 
        startDate: startDate ? new Date(startDate).toISOString() : null, 
        endDate: endDate ? new Date(endDate).toISOString() : null 
      });
      
      // Start transaction
      await pool.query('BEGIN');
      
      // Insert the resource
      const result = await pool.query(
        `INSERT INTO project_resources (
          project_id, user_id, role, allocation, start_date, end_date, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [projectId, userId, role, allocation, startDate, endDate, notes]
      );
      
      // Debug log for raw result
      console.log("Raw resource after insert:", JSON.stringify(result.rows[0], null, 2));
      
      // Add resource history record with the performed by user if available
      const historyPerformedById = performedByUserId || userId;
      
      await pool.query(
        `INSERT INTO project_resource_histories (
          project_id, user_id, action, new_role, new_allocation, performed_by_id, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [projectId, userId, 'added', role, allocation, historyPerformedById, notes]
      );
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Get the complete resource info with proper date formatting
      const newResource = await this.getProjectResource(result.rows[0].id);
      
      // Send email notification to HR and Finance about the resource addition
      try {
        // Import the email functionality
        const { sendResourceAddedEmail } = await import('./email');
        
        // Get project and user details for the notification
        const project = await this.getProject(projectId);
        const user = await this.getUser(userId);
        
        // Get the performer's name if available
        let performerName: string | null = null;
        if (performedByUserId && performedByUserId !== userId) {
          try {
            const performer = await this.getUser(performedByUserId);
            if (performer) {
              performerName = `${performer.firstName || ''} ${performer.lastName || ''}`.trim() || performer.username;
            }
          } catch (err) {
            console.warn("Could not fetch performer name for email notification:", err);
          }
        }
        
        if (project && user) {
          // Send the notification email with project-specific email addresses if provided
          await sendResourceAddedEmail(
            project.name,
            user.username,
            user.email,
            role || 'Team Member',
            startDate,
            endDate,
            allocation || 100,
            project.hrCoordinatorEmail || null,
            project.financeTeamEmail || null,
            performerName
          );
          
          console.log(`Email notification sent for resource addition: ${user.username} to ${project.name}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the transaction
        console.error("Error sending resource addition email notification:", emailError);
      }
      
      return newResource;
    } catch (error) {
      // Rollback in case of error
      await pool.query('ROLLBACK');
      console.error("Error creating project resource:", error);
      throw error;
    }
  }

  async updateProjectResource(id: number, data: Partial<ProjectResource>): Promise<ProjectResource> {
    try {
      const resource = await this.getProjectResource(id);
      if (!resource) {
        throw new Error('Project resource not found');
      }

      // Debug log incoming update data
      console.log(`Updating resource ${id} with data:`, JSON.stringify(data, null, 2));
      
      // Process date fields specifically for logging
      if (data.startDate) {
        console.log(`Start date before processing: ${typeof data.startDate}`, data.startDate);
        if (!(data.startDate instanceof Date) && typeof data.startDate === 'object') {
          console.log("Start date is an object but not a Date, needs conversion");
        }
      }
      
      if (data.endDate) {
        console.log(`End date before processing: ${typeof data.endDate}`, data.endDate);
        if (!(data.endDate instanceof Date) && typeof data.endDate === 'object') {
          console.log("End date is an object but not a Date, needs conversion");
        }
      }

      // Start transaction
      await pool.query('BEGIN');
      
      const updateFields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(data)) {
        // Skip joined fields that aren't in the table
        if (['username', 'email', 'firstName', 'lastName', 'projectName'].includes(key)) {
          continue;
        }
        
        if (value !== undefined) {
          updateFields.push(`${this.camelToSnake(key)} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      if (updateFields.length === 0) {
        await pool.query('ROLLBACK');
        return resource;
      }

      values.push(id);
      const query = `UPDATE project_resources SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
      console.log(`SQL Query: ${query}`);
      console.log(`Values: ${JSON.stringify(values)}`);
      
      const result = await pool.query(query, values);
      console.log(`Raw update result: ${JSON.stringify(result.rows[0], null, 2)}`);
      
      // Add history record if role or allocation changed
      if (data.role !== undefined && data.role !== resource.role) {
        await pool.query(
          `INSERT INTO project_resource_histories (
            project_id, user_id, action, previous_role, new_role, performed_by_id
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [resource.projectId, resource.userId, 'role_changed', resource.role, data.role, data.userId || resource.userId]
        );
      }
      
      if (data.allocation !== undefined && data.allocation !== resource.allocation) {
        await pool.query(
          `INSERT INTO project_resource_histories (
            project_id, user_id, action, previous_allocation, new_allocation, performed_by_id
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [resource.projectId, resource.userId, 'allocation_changed', resource.allocation, data.allocation, data.userId || resource.userId]
        );
      }
      
      // Commit transaction
      await pool.query('COMMIT');

      // Get the updated resource with proper date formatting
      const updatedResource = await this.getProjectResource(id);
      console.log(`Processed updated resource: ${JSON.stringify(updatedResource, null, 2)}`);
      
      return updatedResource;
    } catch (error) {
      // Rollback in case of error
      await pool.query('ROLLBACK');
      console.error(`Error updating project resource ${id}:`, error);
      throw error;
    }
  }

  async deleteProjectResource(id: number, performedByUserId?: number): Promise<void> {
    try {
      // Check if resource exists
      const resource = await this.getProjectResource(id);
      if (!resource) {
        throw new Error('Project resource not found');
      }

      // Get project details for email notification
      const project = await this.getProject(resource.projectId);
      const user = await this.getUser(resource.userId);
      
      // Get the performer's name if available
      let performerName: string | null = null;
      const historyPerformedById = performedByUserId || resource.userId;
      
      if (performedByUserId && performedByUserId !== resource.userId) {
        try {
          const performer = await this.getUser(performedByUserId);
          if (performer) {
            performerName = `${performer.firstName || ''} ${performer.lastName || ''}`.trim() || performer.username;
          }
        } catch (err) {
          console.warn("Could not fetch performer name for email notification:", err);
        }
      }
      
      // Start transaction
      await pool.query('BEGIN');
      
      // Add resource history record
      await pool.query(
        `INSERT INTO project_resource_histories (
          project_id, user_id, action, previous_role, previous_allocation, performed_by_id, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          resource.projectId, 
          resource.userId, 
          'removed', 
          resource.role, 
          resource.allocation, 
          historyPerformedById, 
          `Removed from project by ${performerName || 'system'}`
        ]
      );
      
      // Delete the resource
      await pool.query('DELETE FROM project_resources WHERE id = $1', [id]);
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Send email notification to HR and Finance about the resource removal
      try {
        if (project && user) {
          // Import the email functionality
          const { sendResourceRemovedEmail } = await import('./email');
          
          // Send the notification email with project-specific email addresses if provided
          await sendResourceRemovedEmail(
            project.name,
            user.username,
            user.email,
            resource.role || 'Team Member',
            project.hrCoordinatorEmail || null,
            project.financeTeamEmail || null,
            resource.allocation,
            performerName
          );
          
          console.log(`Email notification sent for resource removal: ${user.username} from ${project.name}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the transaction (already committed)
        console.error("Error sending resource removal email notification:", emailError);
      }
    } catch (error) {
      // Rollback in case of error
      await pool.query('ROLLBACK');
      console.error(`Error deleting project resource ${id}:`, error);
      throw error;
    }
  }

  // Project Skills operations - updated to use user_skills and templates instead of legacy skills table
  async getProjectSkills(projectId: number): Promise<ProjectSkill[]> {
    try {
      // Try query with skill_template_id column first (new structure)
      try {
        const result = await pool.query(`
          SELECT 
            ps.*, 
            st.name as skill_name, 
            st.category as skill_category, 
            us.level as skill_level
          FROM project_skills ps
          LEFT JOIN user_skills us ON ps.skill_id = us.id
          LEFT JOIN skill_templates st ON 
            CASE 
              WHEN ps.skill_template_id IS NOT NULL THEN ps.skill_template_id = st.id 
              WHEN us.skill_template_id IS NOT NULL THEN us.skill_template_id = st.id
              ELSE false
            END
          WHERE ps.project_id = $1
          ORDER BY st.category, st.name
        `, [projectId]);
        
        if (result.rows.length > 0) {
          console.log(`Found ${result.rows.length} skills for project ${projectId} using enhanced query`);
          return result.rows.map(row => this.snakeToCamel(row)) as ProjectSkill[];
        }
      } catch (e) {
        console.log(`Enhanced project skills query failed, falling back to original: ${e.message}`);
      }
      
      // Fall back to the original query if the enhanced one fails
      const fallbackResult = await pool.query(`
        SELECT ps.*, st.name as skill_name, st.category as skill_category, us.level as skill_level
        FROM project_skills ps
        JOIN user_skills us ON ps.skill_id = us.id
        JOIN skill_templates st ON us.skill_template_id = st.id
        WHERE ps.project_id = $1
        ORDER BY st.category, st.name
      `, [projectId]);
      
      console.log(`Found ${fallbackResult.rows.length} skills for project ${projectId} using fallback query`);
      return fallbackResult.rows.map(row => this.snakeToCamel(row)) as ProjectSkill[];
    } catch (error) {
      console.error(`Error retrieving skills for project ${projectId}:`, error);
      throw error;
    }
  }
  
  // V2 implementation adapted to use the existing project_skills table
  async getProjectSkillsV2(projectId: number): Promise<ProjectSkillV2[]> {
    try {
      console.log(`Using enhanced project_skills table with skill_template_id for project ${projectId}`);
      
      // Query the project_skills table using skill_template_id when available
      const result = await pool.query(`
        SELECT 
          ps.id, 
          ps.project_id, 
          COALESCE(ps.skill_template_id, st_from_user.id) as skill_template_id, 
          ps.required_level,
          ps.created_at,
          COALESCE(st_direct.name, st_from_user.name) as name, 
          COALESCE(st_direct.category, st_from_user.category) as category, 
          COALESCE(st_direct.description, st_from_user.description) as description
        FROM project_skills ps
        LEFT JOIN skill_templates st_direct ON ps.skill_template_id = st_direct.id
        LEFT JOIN user_skills us ON ps.skill_id = us.id
        LEFT JOIN skill_templates st_from_user ON us.skill_template_id = st_from_user.id
        WHERE ps.project_id = $1 AND (ps.skill_template_id IS NOT NULL OR us.skill_template_id IS NOT NULL)
        ORDER BY category, name
      `, [projectId]);
      
      console.log(`Found ${result.rows.length} skills in enhanced project_skills table for project ${projectId}`);
      
      // If we don't have any results, try a direct skill templates query as fallback
      if (result.rows.length === 0) {
        console.log("No project skills found. Using direct query to skill_templates as fallback.");
        try {
          // Get any skill templates associated with this project directly
          const directTemplateResult = await pool.query(`
            SELECT 
              st.id as skill_template_id,
              $1 as project_id,
              'beginner' as required_level,
              NOW() as created_at,
              st.name,
              st.category,
              st.description
            FROM skill_templates st
            WHERE st.id IN (
              SELECT COALESCE(skill_template_id, 
                            (SELECT skill_template_id FROM user_skills WHERE id = skill_id))
              FROM project_skills 
              WHERE project_id = $1
            )
            ORDER BY st.category, st.name
          `, [projectId]);
          
          console.log(`Found ${directTemplateResult.rows.length} skills via direct template query for project ${projectId}`);
          
          // Apply property mapping to direct template queries
          return directTemplateResult.rows.map(row => {
            const camelCaseRow = this.snakeToCamel(row);
            return {
              ...camelCaseRow,
              // Map from standard names to what frontend might expect
              skillName: camelCaseRow.name,
              skillCategory: camelCaseRow.category,
              // Ensure required fields are present
              id: camelCaseRow.id || camelCaseRow.skillTemplateId, // Use template ID as fallback
              projectId: camelCaseRow.projectId,
              skillTemplateId: camelCaseRow.skillTemplateId,
              requiredLevel: camelCaseRow.requiredLevel,
              createdAt: camelCaseRow.createdAt
            };
          }) as ProjectSkillV2[];
        } catch (e) {
          console.log(`Error in direct template query: ${e.message}`);
        }
      }
      
      // Process the rows to ensure they match the expected structure
      const processedRows = result.rows.map(row => {
        // Convert snake_case to camelCase and map to expected frontend property names
        const camelCaseRow = this.snakeToCamel(row);
        
        // Add common property names that the frontend might expect
        return {
          ...camelCaseRow,
          // Map from standard names to what frontend might expect
          skillName: camelCaseRow.name,
          skillCategory: camelCaseRow.category,
          // Ensure required fields are present
          id: camelCaseRow.id,
          projectId: camelCaseRow.projectId,
          skillTemplateId: camelCaseRow.skillTemplateId,
          requiredLevel: camelCaseRow.requiredLevel,
          createdAt: camelCaseRow.createdAt
        };
      });
      
      return processedRows as ProjectSkillV2[];
    } catch (error) {
      console.error(`Error retrieving skills V2 for project ${projectId}:`, error);
      throw error;
    }
  }

  async getSkillProjects(skillId: number): Promise<ProjectSkill[]> {
    try {
      const result = await pool.query(`
        SELECT ps.*, p.name as project_name, p.status as project_status
        FROM project_skills ps
        JOIN projects p ON ps.project_id = p.id
        WHERE ps.skill_id = $1
        ORDER BY p.name
      `, [skillId]);
      return result.rows.map(row => this.snakeToCamel(row)) as ProjectSkill[];
    } catch (error) {
      console.error(`Error retrieving projects for skill ${skillId}:`, error);
      throw error;
    }
  }
  
  // V2 implementation adapted to use the existing project_skills table
  // Get projects requiring a specific skill template
  async getProjectsBySkillTemplate(skillTemplateId: number): Promise<ProjectSkillV2[]> {
    try {
      console.log(`Looking for projects using skill template ID ${skillTemplateId}`);
      
      // Get all projects that require this skill template
      // In project_skills table, the skill_id column is used to store the skill_template_id
      const result = await pool.query(`
        SELECT 
          ps.id, 
          ps.project_id, 
          ps.skill_id as skill_template_id, 
          ps.required_level,
          ps.created_at,
          p.name as project_name, 
          p.status as project_status, 
          st.name as skill_name, 
          st.category as skill_category
        FROM project_skills ps
        JOIN projects p ON ps.project_id = p.id
        JOIN skill_templates st ON ps.skill_id = st.id
        WHERE ps.skill_id = $1
        ORDER BY p.name
      `, [skillTemplateId]);
      
      console.log(`Found ${result.rows.length} projects requiring skill template ${skillTemplateId}`);
      return result.rows.map(row => this.snakeToCamel(row)) as ProjectSkillV2[];
    } catch (error) {
      console.error(`Error retrieving projects for skill template ${skillTemplateId}:`, error);
      throw error;
    }
  }
  
  // Project Skills for a specific user skill
  async getUserSkillProjects(userSkillId: number): Promise<ProjectSkill[]> {
    try {
      // First, check if the skill exists in the user_skills table
      const skillCheck = await pool.query(
        'SELECT id, skill_template_id FROM user_skills WHERE id = $1',
        [userSkillId]
      );
      
      if (skillCheck.rows.length === 0) {
        console.warn(`No user skill found with ID ${userSkillId}`);
        return [];
      }
      
      // Get projects associated with this user skill
      const result = await pool.query(`
        SELECT 
          ps.*,
          p.name as project_name,
          c.name as client_name,
          st.name as skill_name,
          st.category as skill_category,
          sc.name as category,
          sc.color as category_color
        FROM project_skills ps
        JOIN projects p ON ps.project_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN user_skills us ON ps.skill_id = us.id
        LEFT JOIN skill_templates st ON us.skill_template_id = st.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        WHERE ps.skill_id = $1
        ORDER BY p.name
      `, [userSkillId]);
      
      console.log(`Found ${result.rows.length} projects for user skill ${userSkillId}`);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error(`Error retrieving projects for user skill ${userSkillId}:`, error);
      throw error;
    }
  }

  // This implementation is now merged with the more comprehensive version at line ~4387
  // which includes required_level and a transaction for data consistency

  // This implementation has been merged with the more comprehensive version at line ~4377
  // which includes row count checking to verify deletion

  // Project Resource History operations
  async getProjectResourceHistory(projectId: number): Promise<ProjectResourceHistory[]> {
    try {
      const result = await pool.query(`
        SELECT prh.*, u.username, u.email, p.name as project_name, 
        performer.username as performed_by_username
        FROM project_resource_histories prh
        JOIN users u ON prh.user_id = u.id
        JOIN projects p ON prh.project_id = p.id
        LEFT JOIN users performer ON prh.performed_by_id = performer.id
        WHERE prh.project_id = $1
        ORDER BY prh.date DESC
      `, [projectId]);
      return result.rows.map(row => this.snakeToCamel(row)) as ProjectResourceHistory[];
    } catch (error) {
      console.error(`Error retrieving resource history for project ${projectId}:`, error);
      throw error;
    }
  }

  async getUserProjectHistory(userId: number): Promise<ProjectResourceHistory[]> {
    try {
      const result = await pool.query(`
        SELECT prh.*, p.name as project_name, 
        performer.username as performed_by_username
        FROM project_resource_histories prh
        JOIN projects p ON prh.project_id = p.id
        LEFT JOIN users performer ON prh.performed_by_id = performer.id
        WHERE prh.user_id = $1
        ORDER BY prh.date DESC
      `, [userId]);
      return result.rows.map(row => this.snakeToCamel(row)) as ProjectResourceHistory[];
    } catch (error) {
      console.error(`Error retrieving project history for user ${userId}:`, error);
      throw error;
    }
  }

  async createProjectResourceHistory(history: InsertProjectResourceHistory): Promise<ProjectResourceHistory> {
    try {
      const { 
        projectId, userId, action, previousRole, newRole, 
        previousAllocation, newAllocation, performedById, note 
      } = history;
      
      const result = await pool.query(
        `INSERT INTO project_resource_histories (
          project_id, user_id, action, previous_role, new_role, 
          previous_allocation, new_allocation, performed_by_id, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [projectId, userId, action, previousRole, newRole, 
         previousAllocation, newAllocation, performedById, note]
      );
      
      // Get the full history info with joins
      const fullResult = await pool.query(`
        SELECT prh.*, u.username, u.email, p.name as project_name, 
        performer.username as performed_by_username
        FROM project_resource_histories prh
        JOIN users u ON prh.user_id = u.id
        JOIN projects p ON prh.project_id = p.id
        LEFT JOIN users performer ON prh.performed_by_id = performer.id
        WHERE prh.id = $1
      `, [result.rows[0].id]);
      
      return this.snakeToCamel(fullResult.rows[0]) as ProjectResourceHistory;
    } catch (error) {
      console.error("Error creating project resource history:", error);
      throw error;
    }
  }
  
  // Helper method to convert camelCase to snake_case for SQL queries
  /**
   * Converts a camelCase string to snake_case
   * Examples: 
   *  - "userId" becomes "user_id"
   *  - "credlyLink" becomes "credly_link"
   */
  private camelToSnake(str: string): string {
    // Handle specific cases immediately to avoid regex issues
    if (str === 'accountManagerId') {
      console.log("🔍 Special handling: accountManagerId -> account_manager_id");
      return 'account_manager_id';
    }
    
    // General case for handling camelCase to snake_case conversion
    let replaced = str;
    
    // Main conversion rule: insert underscore before capital letters and convert to lowercase
    replaced = replaced.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    
    // Handle ID suffix specifically (after the main conversion)
    if (replaced.endsWith('_i_d')) {
      replaced = replaced.replace(/_i_d$/, '_id');
    }
    
    // Debug output to track all conversions
    if (str !== replaced) {
      console.log(`🔍 camelToSnake: ${str} -> ${replaced}`);
    }
    return replaced;
  }

  async updateClient(id: number, data: Partial<Client>): Promise<Client> {
    try {
      console.log("Updating client with data:", JSON.stringify(data, null, 2));
      
      // Validate we have valid data structure with allowed fields
      if (!data || typeof data !== 'object') {
        throw new Error("Invalid client data");
      }
      
      // Only allow fields that exist in clients table
      // Based on database schema: id, name, industry, contact_name, contact_email, contact_phone, website, logo_url, notes, created_at, updated_at, account_manager_id
      const allowedFields = [
        'name', 'industry', 'contactName', 'contactEmail', 'contactPhone',
        'website', 'logoUrl', 'notes', 'accountManagerId'
      ];
      
      // Filter out non-allowed fields
      const filteredData: Partial<Client> = {};
      for (const key in data) {
        if (data.hasOwnProperty(key) && allowedFields.includes(key)) {
          filteredData[key as keyof Client] = data[key as keyof typeof data];
        } else if (data.hasOwnProperty(key) && key !== 'id') {
          console.warn(`Skipping non-existent field in client update: ${key}`);
        }
      }
      
      // Proceed with the update using filtered data
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramCount = 1;

      // Build update statement
      for (const key in filteredData) {
        if (filteredData.hasOwnProperty(key) && key !== 'id') {
          const snakeCaseKey = this.camelToSnake(key);
          console.log(`Converting key ${key} to ${snakeCaseKey}`);
          updateFields.push(`${snakeCaseKey} = $${paramCount}`);
          params.push(filteredData[key as keyof typeof filteredData]);
          paramCount++;
        }
      }

      // If we don't have any valid fields to update, just return the current client
      if (updateFields.length === 0) {
        console.log("No valid fields to update for client");
        return await this.getClient(id) as Client;
      }

      params.push(id);
      const updateQuery = `UPDATE clients SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      console.log("Executing update query:", updateQuery);
      console.log("With parameters:", params);
      
      const result = await pool.query(updateQuery, params);

      if (result.rowCount === 0) {
        throw new Error("Client not found");
      }

      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error updating client:", error);
      throw error;
    }
  }

  async deleteClient(id: number): Promise<void> {
    try {
      // Check if client has associated projects before deleting
      const projectsResult = await pool.query('SELECT id FROM projects WHERE client_id = $1', [id]);
      
      if (projectsResult.rows.length > 0) {
        throw new Error("Cannot delete client with associated projects");
      }
      
      const result = await pool.query('DELETE FROM clients WHERE id = $1', [id]);
      
      if (result.rowCount === 0) {
        throw new Error("Client not found");
      }
    } catch (error) {
      console.error("Error deleting client:", error);
      throw error;
    }
  }

  async searchClients(query: string): Promise<Client[]> {
    try {
      const searchTerm = `%${query}%`;
      const result = await pool.query(
        `SELECT * FROM clients 
         WHERE name ILIKE $1 
         OR industry ILIKE $1 
         OR contact_name ILIKE $1 
         ORDER BY name`,
        [searchTerm]
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error searching clients:", error);
      throw error;
    }
  }

  // Project operations
  async getAllProjects(): Promise<Project[]> {
    try {
      const result = await pool.query(`
        SELECT p.*, c.name as client_name 
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        ORDER BY p.start_date DESC
      `);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all projects:", error);
      throw error;
    }
  }

  async getProject(id: number): Promise<Project | undefined> {
    try {
      const result = await pool.query(`
        SELECT p.*, c.name as client_name 
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE p.id = $1
      `, [id]);
      
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting project:", error);
      throw error;
    }
  }

  async createProject(project: InsertProject): Promise<Project> {
    try {
      // Start transaction
      await pool.query('BEGIN');
      
      const result = await pool.query(
        `INSERT INTO projects (
          name, description, client_id, start_date, end_date, status, 
          location, confluence_link, lead_id, delivery_lead_id
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
        RETURNING *`,
        [
          project.name,
          project.description || '',
          project.clientId,
          project.startDate || null,
          project.endDate || null,
          project.status || 'active',
          project.location || '',
          project.confluenceLink || '',
          project.leadId || null,
          project.deliveryLeadId || null
        ]
      );
      
      const projectId = result.rows[0].id;
      
      // Auto-add project lead as a resource if specified
      if (project.leadId) {
        try {
          await this.addLeadAsResource(projectId, project.leadId, 'Project Lead');
        } catch (err) {
          console.error("Error adding project lead as resource:", err);
          // Continue with project creation even if adding lead fails
        }
      }
      
      // Auto-add delivery lead as a resource if specified
      if (project.deliveryLeadId) {
        try {
          await this.addLeadAsResource(projectId, project.deliveryLeadId, 'Delivery Lead');
        } catch (err) {
          console.error("Error adding delivery lead as resource:", err);
          // Continue with project creation even if adding delivery lead fails
        }
      }
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Get the project with client name
      return await this.getProject(projectId) as Project;
    } catch (error) {
      // Rollback in case of error
      await pool.query('ROLLBACK');
      console.error("Error creating project:", error);
      throw error;
    }
  }
  
  // Helper method to add a lead (project or delivery) as a resource
  // Add a project lead or delivery lead as a resource automatically
  private async addLeadAsResource(projectId: number, userId: number, role: string): Promise<void> {
    // Check if the user is already a resource on this project
    const existing = await pool.query(
      'SELECT * FROM project_resources WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    
    if (existing.rows.length === 0) {
      // Add the lead as a resource with 100% allocation by default
      await pool.query(
        `INSERT INTO project_resources (
          project_id, user_id, role, allocation, start_date, end_date
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [projectId, userId, role, 100, null, null]
      );
      
      // Add to project resource history
      await pool.query(
        `INSERT INTO project_resource_histories (
          project_id, user_id, action, new_role, new_allocation, performed_by_id, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [projectId, userId, 'added', role, 100, userId, `Added automatically as ${role}`]
      );
      
      // Send email notification to HR and Finance about the resource addition
      try {
        // Get project and user details for the notification
        const project = await this.getProject(projectId);
        const user = await this.getUser(userId);
        
        if (project && user) {
          // Import the email functionality
          const { sendResourceAddedEmail } = await import('./email');
          
          // Send the notification email with project-specific email addresses if provided
          await sendResourceAddedEmail(
            project.name,
            user.username,
            user.email,
            role || "Team Member",
            null, // No specific start date
            null, // No specific end date
            100,  // Default 100% allocation
            project.hrCoordinatorEmail || null,
            project.financeTeamEmail || null,
            "System (Automatic Assignment)" // Indicate this was an automatic action
          );
          
          console.log(`Email notification sent: ${role} (${user.username}) added to project ${project.name}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the operation
        console.error("Error sending lead addition email notification:", emailError);
      }
      
      console.log(`Leader added as resource: ${role} (userId: ${userId}) to project ${projectId}`);
    } else {
      console.log(`User ${userId} is already a resource on project ${projectId}, not adding as ${role}`);
    }
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project> {
    try {
      // Start transaction
      await pool.query('BEGIN');
      
      // Get the existing project to check for lead changes
      const existingProject = await this.getProject(id);
      if (!existingProject) {
        throw new Error("Project not found");
      }
      
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramCount = 1;

      // Build update statement
      for (const key in data) {
        if (data.hasOwnProperty(key) && key !== 'id' && key !== 'clientName') {
          updateFields.push(`${this.camelToSnake(key)} = $${paramCount}`);
          params.push(data[key as keyof typeof data]);
          paramCount++;
        }
      }

      if (updateFields.length === 0) {
        await pool.query('ROLLBACK');
        return existingProject;
      }

      params.push(id);
      const result = await pool.query(
        `UPDATE projects SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        params
      );

      if (result.rowCount === 0) {
        await pool.query('ROLLBACK');
        throw new Error("Project not found");
      }
      
      // Handle project lead changes
      if (data.leadId && data.leadId !== existingProject.leadId) {
        try {
          await this.addLeadAsResource(id, data.leadId, 'Project Lead');
        } catch (err) {
          console.error("Error adding new project lead as resource:", err);
          // Continue even if adding the lead as a resource fails
        }
      }
      
      // Handle delivery lead changes
      if (data.deliveryLeadId && data.deliveryLeadId !== existingProject.deliveryLeadId) {
        try {
          await this.addLeadAsResource(id, data.deliveryLeadId, 'Delivery Lead');
        } catch (err) {
          console.error("Error adding new delivery lead as resource:", err);
          // Continue even if adding the delivery lead as a resource fails
        }
      }
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Get the updated project with joined data
      const updatedProject = await this.getProject(id) as Project;
      
      // Send email notification to HR and Finance about the project update
      try {
        // Determine which fields were changed with before/after values
        const changedFields: {field: string, oldValue?: string | null, newValue?: string | null}[] = [];
        for (const key in data) {
          if (data.hasOwnProperty(key) && key !== 'id' && key !== 'clientName') {
            const fieldName = this.camelToSnake(key).replace(/_/g, ' ');
            // Get old and new values
            const oldValue = existingProject[key as keyof typeof existingProject] as string | null;
            const newValue = data[key as keyof typeof data] as string | null;
            
            changedFields.push({
              field: fieldName,
              oldValue: oldValue !== undefined ? String(oldValue) : null,
              newValue: newValue !== undefined ? String(newValue) : null
            });
          }
        }
        
        if (changedFields.length > 0) {
          let clientName = null;
          let leadName = null;
          
          // Get client name if a client is associated
          if (updatedProject.clientId) {
            const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [updatedProject.clientId]);
            if (clientResult.rows.length > 0) {
              clientName = clientResult.rows[0].name;
            }
          }
          
          // Get lead name if a lead is assigned
          if (updatedProject.leadId) {
            const leadResult = await pool.query('SELECT username FROM users WHERE id = $1', [updatedProject.leadId]);
            if (leadResult.rows.length > 0) {
              leadName = leadResult.rows[0].username;
            }
          }
          
          // Import the email functionality
          const { sendProjectUpdatedEmail } = await import('./email');
          
          // Send notification with project-specific email addresses if available
          await sendProjectUpdatedEmail(
            updatedProject.name,
            clientName,
            updatedProject.description,
            updatedProject.startDate,
            updatedProject.endDate,
            leadName,
            changedFields,
            updatedProject.hrCoordinatorEmail || null,
            updatedProject.financeTeamEmail || null,
            "System (Admin User)" // For now, we'll use a generic identifier until we track the user who made the change
          );
          
          console.log(`Email notification sent for updated project: ${updatedProject.name}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the operation
        console.error("Error sending project update email notification:", emailError);
      }
      
      return updatedProject;
    } catch (error) {
      // Rollback in case of error
      await pool.query('ROLLBACK');
      console.error("Error updating project:", error);
      throw error;
    }
  }

  async deleteProject(id: number): Promise<void> {
    try {
      // Start a transaction to ensure all related records are deleted
      await pool.query('BEGIN');
      
      try {
        // Delete project resources history first
        await pool.query('DELETE FROM project_resource_histories WHERE project_id = $1', [id]);
        
        // Delete project resources
        await pool.query('DELETE FROM project_resources WHERE project_id = $1', [id]);
        
        // Delete project skills
        await pool.query('DELETE FROM project_skills WHERE project_id = $1', [id]);
        
        // Finally delete the project
        const result = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
        
        if (result.rowCount === 0) {
          throw new Error("Project not found");
        }
        
        // Commit the transaction
        await pool.query('COMMIT');
      } catch (error) {
        // Rollback the transaction if any query fails
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error("Error deleting project:", error);
      throw error;
    }
  }

  async getUserProjects(userId: number): Promise<Project[]> {
    try {
      const result = await pool.query(`
        SELECT p.*, c.name as client_name 
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE p.id IN (
          SELECT project_id FROM project_resources WHERE user_id = $1
        )
        ORDER BY p.start_date DESC
      `, [userId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user projects:", error);
      throw error;
    }
  }

  async getClientProjects(clientId: number): Promise<Project[]> {
    try {
      const result = await pool.query(`
        SELECT p.*, c.name as client_name 
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE p.client_id = $1
        ORDER BY p.start_date DESC
      `, [clientId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting client projects:", error);
      throw error;
    }
  }

  async searchProjects(query: string): Promise<Project[]> {
    try {
      const searchTerm = `%${query}%`;
      const result = await pool.query(`
        SELECT p.*, c.name as client_name 
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE p.name ILIKE $1 
        OR p.description ILIKE $1 
        OR c.name ILIKE $1
        OR p.location ILIKE $1
        OR p.status ILIKE $1
        ORDER BY p.start_date DESC
      `, [searchTerm]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error searching projects:", error);
      throw error;
    }
  }

  // Project Resources operations
  async getProjectResources(projectId: number): Promise<ProjectResource[]> {
    try {
      const result = await pool.query(`
        SELECT pr.*, u.username, u.email, u.first_name, u.last_name
        FROM project_resources pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.project_id = $1
        ORDER BY pr.start_date DESC
      `, [projectId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting project resources:", error);
      throw error;
    }
  }
  
  // Implementation for Project Overview feature
  async getAllProjectResources(): Promise<ProjectResource[]> {
    try {
      const result = await pool.query(`
        SELECT pr.*, 
               u.username, u.email, u.first_name, u.last_name,
               p.name as project_name,
               c.name as client_name
        FROM project_resources pr
        LEFT JOIN users u ON pr.user_id = u.id
        LEFT JOIN projects p ON pr.project_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        ORDER BY pr.id
      `);
      
      // Process resources to include user skills
      const resources = this.snakeToCamel(result.rows);
      
      // For each resource, get the user's skills
      for (const resource of resources) {
        try {
          const userSkills = await this.getUserSkills(resource.userId);
          resource.skills = userSkills;
        } catch (error) {
          console.error(`Error fetching skills for user ${resource.userId}:`, error);
          resource.skills = [];
        }
      }
      
      return resources;
    } catch (error) {
      console.error("Error getting all project resources:", error);
      throw error;
    }
  }

  async getUserProjectResources(userId: number): Promise<ProjectResource[]> {
    try {
      const result = await pool.query(`
        SELECT pr.*, p.name as project_name
        FROM project_resources pr
        JOIN projects p ON pr.project_id = p.id
        WHERE pr.user_id = $1
        ORDER BY pr.start_date DESC
      `, [userId]);
      
      // Ensure dates are properly formatted for each resource
      return result.rows.map(row => {
        const processed = { ...row };
        // Format dates as ISO strings if they exist
        if (processed.start_date) {
          processed.start_date = new Date(processed.start_date).toISOString();
        }
        if (processed.end_date) {
          processed.end_date = new Date(processed.end_date).toISOString();
        }
        return this.snakeToCamel(processed);
      }) as ProjectResource[];
    } catch (error) {
      console.error("Error getting user project resources:", error);
      throw error;
    }
  }

  async getProjectResource(id: number): Promise<ProjectResource | undefined> {
    try {
      const result = await pool.query(`
        SELECT pr.*, u.username, u.email, u.first_name, u.last_name
        FROM project_resources pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.id = $1
      `, [id]);
      
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting project resource:", error);
      throw error;
    }
  }

  async createProjectResource(resource: InsertProjectResource): Promise<ProjectResource> {
    try {
      const result = await pool.query(
        `INSERT INTO project_resources (
          project_id, user_id, role, allocation, start_date, end_date, notes
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING *`,
        [
          resource.projectId,
          resource.userId,
          resource.role || '',
          resource.allocation || 100,
          resource.startDate || new Date(),
          resource.endDate || null,
          resource.notes || ''
        ]
      );
      
      // Add to project resource history
      await this.createProjectResourceHistory({
        projectId: resource.projectId,
        userId: resource.userId,
        action: 'added',
        newRole: resource.role || '',
        newAllocation: resource.allocation || 100,
        performedById: resource.userId, // Using the same user ID as performed_by for now
        note: resource.notes
      });
      
      // Send email notification to HR and Finance about the resource addition
      try {
        // Get project and user details for the notification
        const project = await this.getProject(resource.projectId);
        const user = await this.getUser(resource.userId);
        
        if (project && user) {
          // Import the email functionality
          const { sendResourceAddedEmail } = await import('./email');
          
          // Send the notification email with project-specific recipients if configured
          await sendResourceAddedEmail(
            project.name,
            user.username,
            user.email,
            resource.role || "Team Member",
            resource.startDate,
            resource.endDate,
            resource.allocation || 100,
            project.hrCoordinatorEmail || null,
            project.financeTeamEmail || null,
            resource.performedById ? `Added by User ID: ${resource.performedById}` : null
          );
          
          console.log(`Email notification sent: ${resource.role || "Team Member"} (${user.username}) added to project ${project.name}`);
        }
      } catch (emailError) {
        // Log the error but don't fail the operation
        console.error("Error sending resource addition email notification:", emailError);
      }
      
      // Get the resource with user details
      return await this.getProjectResource(result.rows[0].id) as ProjectResource;
    } catch (error) {
      console.error("Error creating project resource:", error);
      throw error;
    }
  }

  async updateProjectResource(id: number, data: Partial<ProjectResource>): Promise<ProjectResource> {
    try {
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramCount = 1;

      // Build update statement
      for (const key in data) {
        if (data.hasOwnProperty(key) && key !== 'id' && key !== 'username' && 
            key !== 'email' && key !== 'firstName' && key !== 'lastName') {
          updateFields.push(`${this.camelToSnake(key)} = $${paramCount}`);
          params.push(data[key as keyof typeof data]);
          paramCount++;
        }
      }

      if (updateFields.length === 0) {
        return await this.getProjectResource(id) as ProjectResource;
      }

      params.push(id);
      const result = await pool.query(
        `UPDATE project_resources SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        params
      );

      if (result.rowCount === 0) {
        throw new Error("Project resource not found");
      }

      // Get the updated resource with user details
      return await this.getProjectResource(id) as ProjectResource;
    } catch (error) {
      console.error("Error updating project resource:", error);
      throw error;
    }
  }

  async deleteProjectResource(id: number): Promise<void> {
    try {
      // Get the resource details before deletion for history and notification
      const resourceResult = await pool.query(
        `SELECT pr.*, p.name as project_name, p.hr_coordinator_email, p.finance_team_email,
         u.username, u.email
         FROM project_resources pr
         JOIN projects p ON pr.project_id = p.id
         JOIN users u ON pr.user_id = u.id
         WHERE pr.id = $1`,
        [id]
      );
      
      if (resourceResult.rowCount === 0) {
        throw new Error("Project resource not found");
      }
      
      const resource = this.snakeToCamel(resourceResult.rows[0]);
      
      // Delete the resource
      const result = await pool.query('DELETE FROM project_resources WHERE id = $1', [id]);
      
      if (result.rowCount === 0) {
        throw new Error("Project resource not found");
      }
      
      // Add to project resource history
      await this.createProjectResourceHistory({
        projectId: resource.projectId,
        userId: resource.userId,
        action: 'removed',
        previousRole: resource.role,
        previousAllocation: resource.allocation,
        performedById: resource.userId, // Using the same user ID as performed_by for now
        note: `Resource removed from project ${resource.projectName}`
      });
      
      // Send email notification to HR and Finance about the resource removal
      try {
        // Import the email functionality
        const { sendResourceRemovedEmail } = await import('./email');
        
        // Send the notification email with project-specific recipients if configured
        await sendResourceRemovedEmail(
          resource.projectName,
          resource.username,
          resource.email,
          resource.role || "Team Member",
          resource.hrCoordinatorEmail || null,
          resource.financeTeamEmail || null,
          resource.allocation,
          resource.performedById ? `Removed by User ID: ${resource.performedById}` : null
        );
        
        console.log(`Email notification sent: ${resource.role || "Team Member"} (${resource.username}) removed from project ${resource.projectName}`);
      } catch (emailError) {
        // Log the error but don't fail the operation
        console.error("Error sending resource removal email notification:", emailError);
      }
    } catch (error) {
      console.error("Error deleting project resource:", error);
      throw error;
    }
  }

  // This commented section was removed - duplicate getProjectSkills implementation
  // Implementation now consolidated to use the version with more detailed SQL joins at line ~3355

  async getSkillProjects(skillId: number): Promise<ProjectSkill[]> {
    try {
      const result = await pool.query(`
        SELECT ps.*, p.name as project_name, p.status, p.start_date, p.end_date
        FROM project_skills ps
        JOIN projects p ON ps.project_id = p.id
        WHERE ps.skill_id = $1
        ORDER BY p.start_date DESC
      `, [skillId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting skill projects:", error);
      throw error;
    }
  }

  // Implementation for Project Overview feature - updated to use user_skills and templates
  async getAllProjectSkills(): Promise<ProjectSkill[]> {
    try {
      // Try query with skill_template_id column first
      try {
        const result = await pool.query(`
          SELECT ps.*,
                 st.name as skill_name,
                 st.category as skill_category,
                 p.name as project_name,
                 c.name as client_name,
                 sc.name as category,
                 sc.color as category_color
          FROM project_skills ps
          LEFT JOIN user_skills us ON ps.skill_id = us.id
          LEFT JOIN skill_templates st ON 
              CASE 
                WHEN ps.skill_template_id IS NOT NULL THEN ps.skill_template_id = st.id 
                WHEN us.skill_template_id IS NOT NULL THEN us.skill_template_id = st.id
                ELSE false
              END
          LEFT JOIN projects p ON ps.project_id = p.id
          LEFT JOIN clients c ON p.client_id = c.id
          LEFT JOIN skill_categories sc ON st.category_id = sc.id
          ORDER BY ps.id
        `);
        
        if (result.rows.length > 0) {
          console.log(`Retrieved ${result.rows.length} project skills with enhanced query`);
          return this.snakeToCamel(result.rows);
        }
      } catch (e) {
        console.log(`Enhanced project skills query failed, falling back to original: ${e.message}`);
      }
      
      // Fall back to the original query if needed
      const fallbackResult = await pool.query(`
        SELECT ps.*,
               st.name as skill_name,
               st.category as skill_category,
               p.name as project_name,
               c.name as client_name,
               sc.name as category,
               sc.color as category_color
        FROM project_skills ps
        LEFT JOIN user_skills us ON ps.skill_id = us.id
        LEFT JOIN skill_templates st ON us.skill_template_id = st.id
        LEFT JOIN projects p ON ps.project_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        ORDER BY ps.id
      `);
      
      console.log(`Retrieved ${fallbackResult.rows.length} project skills with fallback query`);
      return this.snakeToCamel(fallbackResult.rows);
    } catch (error) {
      console.error("Error getting all project skills:", error);
      throw error;
    }
  }
  
  // Former V2 implementation, now consolidated
  async getAllProjectSkillsV2(): Promise<ProjectSkillV2[]> {
    try {
      // Updated query to join directly to skill_templates using skill_template_id
      // This handles both new entries with skillTemplateId directly and legacy entries with userSkillId
      const result = await pool.query(`
        SELECT ps.*,
               st.name as skill_name,
               st.category as skill_category,
               p.name as project_name,
               c.name as client_name,
               sc.name as category,
               sc.color as category_color
        FROM project_skills ps
        -- Direct join to skill_templates via skill_template_id
        LEFT JOIN skill_templates st ON ps.skill_template_id = st.id
        LEFT JOIN projects p ON ps.project_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN skill_categories sc ON st.category_id = sc.id
        ORDER BY ps.id
      `);
      
      console.log(`Retrieved ${result.rows.length} project skills directly from skill_templates`);
      
      // Process rows to ensure property names match what the frontend expects
      const processedRows = result.rows.map(row => {
        const camelCaseRow = this.snakeToCamel(row);
        
        // Add consistent naming properties to ensure frontend can find the values
        return {
          ...camelCaseRow,
          // Ensure these specific property names are present as the frontend expects them
          skillName: camelCaseRow.skillName || 'Unknown',
          skillCategory: camelCaseRow.skillCategory || 'Uncategorized'
        };
      });
      
      // Debug log the first item if available
      if (processedRows.length > 0) {
        console.log(`Sample processed project skill: ${JSON.stringify(processedRows[0])}`);
      }
      
      return processedRows;
    } catch (error) {
      console.error("Error getting all project skills V2:", error);
      throw error;
    }
  }
  
  async createProjectSkill(projectSkill: InsertProjectSkill): Promise<ProjectSkill> {
    try {
      // Verify this is a valid user_skill from the user_skills table
      const skillCheck = await pool.query(
        'SELECT id, skill_template_id FROM user_skills WHERE id = $1',
        [projectSkill.skillId]
      );
      
      if (skillCheck.rows.length === 0) {
        throw new Error(`Cannot associate skill with project: user_skill with ID ${projectSkill.skillId} does not exist`);
      }
      
      const userSkill = skillCheck.rows[0];
      const skillTemplateId = userSkill.skill_template_id;
      
      if (!skillTemplateId) {
        throw new Error(`User skill ID ${projectSkill.skillId} does not have an associated skill template`);
      }
      
      // Check if this skill is already associated with the project
      const existingResult = await pool.query(
        'SELECT id FROM project_skills WHERE project_id = $1 AND skill_id = $2',
        [projectSkill.projectId, projectSkill.skillId]
      );
      
      if (existingResult.rows.length > 0) {
        throw new Error("This skill is already associated with the project");
      }
      
      // Start a transaction
      await pool.query('BEGIN');
      
      try {
        // Store both skill_id and skill_template_id
        const result = await pool.query(
          `INSERT INTO project_skills (project_id, skill_id, skill_template_id, required_level, importance) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING *`,
          [
            projectSkill.projectId,
            projectSkill.skillId,
            skillTemplateId,
            projectSkill.requiredLevel || 'beginner',
            projectSkill.importance || 'medium'
          ]
        );
        
        // Return the result with skill details using user_skills and templates
        const fullResult = await pool.query(`
          SELECT 
            ps.*, 
            st.name as skill_name, 
            st.category, 
            us.level,
            ps.skill_template_id
          FROM project_skills ps
          JOIN user_skills us ON ps.skill_id = us.id
          JOIN skill_templates st ON us.skill_template_id = st.id
          WHERE ps.id = $1
        `, [result.rows[0].id]);
        
        if (fullResult.rows.length === 0) {
          throw new Error('Failed to retrieve created project skill');
        }
        
        await pool.query('COMMIT');
        
        console.log(`Successfully associated user_skill ${projectSkill.skillId} (template: ${skillTemplateId}) with project ${projectSkill.projectId}`);
        return this.snakeToCamel(fullResult.rows[0]);
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error("Error creating project skill:", error);
      throw error;
    }
  }
  
  // V2 implementation for creating project skill using the existing project_skills table and skill_templates
  async createProjectSkillV2(projectSkill: InsertProjectSkillV2): Promise<ProjectSkillV2> {
    try {
      console.log(`Creating project skill V2 with skillTemplateId=${projectSkill.skillTemplateId}, projectId=${projectSkill.projectId}`);
      
      // Verify this is a valid skill template
      const templateCheck = await pool.query(
        'SELECT id, name, category FROM skill_templates WHERE id = $1',
        [projectSkill.skillTemplateId]
      );
      
      if (templateCheck.rows.length === 0) {
        throw new Error(`Cannot associate skill with project: skill template with ID ${projectSkill.skillTemplateId} does not exist`);
      }
      
      const template = templateCheck.rows[0];
      console.log(`Found template: ${template.name} (${template.category})`);
      
      // Check if this template is already associated with the project
      const existingResult = await pool.query(
        'SELECT id FROM project_skills WHERE project_id = $1 AND skill_template_id = $2',
        [projectSkill.projectId, projectSkill.skillTemplateId]
      );
      
      if (existingResult.rows.length > 0) {
        throw new Error(`This skill template (${template.name}) is already associated with the project`);
      }
      
      // Start a transaction
      await pool.query('BEGIN');
      
      try {
        // ONLY use skill_template_id, explicitly set skill_id to NULL
        const result = await pool.query(
          `INSERT INTO project_skills (project_id, skill_id, skill_template_id, required_level, importance) 
           VALUES ($1, NULL, $2, $3, $4) 
           RETURNING *`,
          [
            projectSkill.projectId,
            projectSkill.skillTemplateId,
            projectSkill.requiredLevel || 'beginner',
            projectSkill.importance || 'medium'
          ]
        );
        
        if (!result.rows[0]) {
          throw new Error('Failed to insert project skill');
        }
        
        // Immediately verify successful insertion with project skill ID
        console.log(`Successfully created project skill with ID: ${result.rows[0].id}`);
        
        // Return the result with skill details directly from skill_templates
        const fullResult = await pool.query(`
          SELECT 
            ps.id, 
            ps.project_id, 
            ps.skill_template_id, 
            ps.required_level,
            ps.importance,
            ps.created_at,
            st.name, 
            st.category, 
            st.description,
            p.name as project_name
          FROM project_skills ps
          JOIN skill_templates st ON ps.skill_template_id = st.id
          JOIN projects p ON ps.project_id = p.id
          WHERE ps.id = $1
        `, [result.rows[0].id]);
        
        if (fullResult.rows.length === 0) {
          throw new Error('Failed to retrieve created project skill');
        }
        
        await pool.query('COMMIT');
        console.log(`Transaction committed successfully for project skill ID: ${result.rows[0].id}`);
        
        // Convert and map properties for consistency in the response
        const row = this.snakeToCamel(fullResult.rows[0]);
        
        // Return the enhanced ProjectSkill with additional properties 
        return {
          ...row,
          skillName: row.name,
          skillCategory: row.category
        } as ProjectSkillV2;
      } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Error in transaction, rolled back:", error);
        throw error;
      }
    } catch (error) {
      console.error("Error creating project skill V2:", error);
      throw error;
    }
  }

  async deleteProjectSkill(id: number): Promise<void> {
    try {
      const result = await pool.query('DELETE FROM project_skills WHERE id = $1', [id]);
      
      if (result.rowCount === 0) {
        throw new Error("Project skill not found");
      }
    } catch (error) {
      console.error("Error deleting project skill:", error);
      throw error;
    }
  }
  
  // V2 implementation adapted to use the existing project_skills table
  async deleteProjectSkillV2(id: number): Promise<void> {
    try {
      // We now use the existing project_skills table
      const result = await pool.query('DELETE FROM project_skills WHERE id = $1', [id]);
      
      if (result.rowCount === 0) {
        throw new Error("Project skill V2 not found");
      }
    } catch (error) {
      console.error("Error deleting project skill V2:", error);
      throw error;
    }
  }

  // Project Resource History operations
  async getProjectResourceHistory(projectId: number): Promise<ProjectResourceHistory[]> {
    try {
      const result = await pool.query(`
        SELECT prh.*, 
               u.username, u.email, u.first_name, u.last_name,
               pu.username as performed_by_username, pu.email as performed_by_email
        FROM project_resource_histories prh
        JOIN users u ON prh.user_id = u.id
        JOIN users pu ON prh.performed_by_id = pu.id
        WHERE prh.project_id = $1
        ORDER BY prh.date DESC
      `, [projectId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting project resource history:", error);
      throw error;
    }
  }

  async getUserProjectHistory(userId: number): Promise<ProjectResourceHistory[]> {
    try {
      const result = await pool.query(`
        SELECT prh.*, 
               p.name as project_name, 
               pu.username as performed_by_username, pu.email as performed_by_email
        FROM project_resource_histories prh
        JOIN projects p ON prh.project_id = p.id
        JOIN users pu ON prh.performed_by_id = pu.id
        WHERE prh.user_id = $1
        ORDER BY prh.date DESC
      `, [userId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user project history:", error);
      throw error;
    }
  }

  async createProjectResourceHistory(history: InsertProjectResourceHistory): Promise<ProjectResourceHistory> {
    try {
      const result = await pool.query(
        `INSERT INTO project_resource_histories (
          project_id, user_id, action, previous_role, previous_allocation,
          new_role, new_allocation, performed_by_id, note
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        RETURNING *`,
        [
          history.projectId,
          history.userId,
          history.action,
          history.previousRole || null,
          history.previousAllocation || null,
          history.newRole || null, 
          history.newAllocation || null,
          history.performedById,
          history.note || ''
        ]
      );
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating project resource history:", error);
      throw error;
    }
  }

  // Skill Category methods
  async getAllSkillCategories(): Promise<SkillCategory[]> {
    try {
      // Use a query that avoids mentioning category_type in the SQL query text
      // and select exact columns to avoid any issues
      const result = await pool.query(`
        SELECT 
          id, 
          name, 
          description, 
          tab_order, 
          visibility, 
          color, 
          icon, 
          created_at, 
          updated_at
        FROM skill_categories 
        ORDER BY tab_order, name
      `);

      // Hardcode category type based on name for now (fallback)
      const technicalCategories = [
        'Programming', 'Database', 'Cloud', 'DevOps', 'API', 
        'Mobile Development', 'Security', 'Data Science', 'AI', 'UI'
      ];
      
      // Map the categories and add the categoryType field based on name
      const categoriesWithType = result.rows.map(row => {
        const isTechnical = technicalCategories.includes(row.name);
        return {
          ...row,
          category_type: isTechnical ? 'technical' : 'functional'
        };
      });
      
      console.log("Category types:", categoriesWithType.map(row => `${row.name}: ${row.category_type}`));
      return this.snakeToCamel(categoriesWithType);
    } catch (error) {
      console.error("Error getting all skill categories:", error);
      throw error;
    }
  }
  
  async getSkillCategory(id: number): Promise<SkillCategory | undefined> {
    try {
      const result = await pool.query(
        'SELECT * FROM skill_categories WHERE id = $1',
        [id]
      );
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill category:", error);
      throw error;
    }
  }
  
  async getSkillCategoriesByName(name: string): Promise<SkillCategory[]> {
    try {
      const result = await pool.query(
        'SELECT * FROM skill_categories WHERE name = $1',
        [name]
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting skill categories by name:", error);
      throw error;
    }
  }
  
  async createSkillCategory(category: InsertSkillCategory): Promise<SkillCategory> {
    try {
      const { name, description, tabOrder, visibility, color, icon } = category;
      
      const result = await pool.query(
        `INSERT INTO skill_categories (
          name, description, tab_order, visibility, color, icon, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *`,
        [
          name,
          description || null,
          tabOrder || 0,
          visibility || 'visible',
          color || '#3B82F6',
          icon || 'code'
        ]
      );
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating skill category:", error);
      throw error;
    }
  }
  
  async updateSkillCategory(id: number, data: Partial<SkillCategory>): Promise<SkillCategory> {
    try {
      const sets: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      // Create a modified copy of the data without categoryType field
      const validData = { ...data };
      if ('categoryType' in validData) {
        console.log("Warning: categoryType field was provided but is not supported in the database schema");
        delete validData.categoryType;
      }
      
      // Build SET clause and parameters
      for (const [key, value] of Object.entries(validData)) {
        // Convert camelCase to snake_case for database column names
        const columnName = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${columnName} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
      
      // Always update the updated_at timestamp
      sets.push(`updated_at = NOW()`);
      
      if (sets.length === 1) { // Only has updated_at
        return await this.getSkillCategory(id) as SkillCategory;
      }
      
      params.push(id); // Add id as the last parameter
      
      const result = await pool.query(
        `UPDATE skill_categories SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );
      
      if (result.rows.length === 0) {
        throw new Error("Skill category not found");
      }
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error updating skill category:", error);
      throw error;
    }
  }
  
  async deleteSkillCategory(id: number): Promise<void> {
    try {
      // First update any skill_templates using this category to set categoryId to null
      await pool.query(
        'UPDATE skill_templates SET category_id = NULL WHERE category_id = $1',
        [id]
      );
      
      // Delete any subcategories for this category
      await pool.query(
        'DELETE FROM skill_subcategories WHERE category_id = $1',
        [id]
      );
      
      // Delete any approvers for this category
      await pool.query(
        'DELETE FROM skill_approvers WHERE category_id = $1',
        [id]
      );
      
      // Delete the category
      const result = await pool.query(
        'DELETE FROM skill_categories WHERE id = $1',
        [id]
      );
      
      if (result.rowCount === 0) {
        throw new Error("Skill category not found");
      }
    } catch (error) {
      console.error("Error deleting skill category:", error);
      throw error;
    }
  }
  
  // Skill Subcategory methods
  async getAllSkillSubcategories(): Promise<SkillSubcategory[]> {
    try {
      const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM skill_subcategories s
        JOIN skill_categories c ON s.category_id = c.id
        ORDER BY c.tab_order, c.name, s.name
      `);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all skill subcategories:", error);
      throw error;
    }
  }
  
  async getSubcategoriesByCategory(categoryId: number): Promise<SkillSubcategory[]> {
    try {
      const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM skill_subcategories s
        JOIN skill_categories c ON s.category_id = c.id
        WHERE s.category_id = $1
        ORDER BY s.name
      `, [categoryId]);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error(`Error getting subcategories for category ${categoryId}:`, error);
      throw error;
    }
  }
  
  async getSkillSubcategory(id: number): Promise<SkillSubcategory | undefined> {
    try {
      const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM skill_subcategories s
        JOIN skill_categories c ON s.category_id = c.id
        WHERE s.id = $1
      `, [id]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill subcategory:", error);
      throw error;
    }
  }
  
  // Alias for consistent naming across the codebase
  async getSkillSubcategoryById(id: number): Promise<SkillSubcategory | undefined> {
    return this.getSkillSubcategory(id);
  }
  
  async createSkillSubcategory(subcategory: InsertSkillSubcategory): Promise<SkillSubcategory> {
    try {
      const { name, description, categoryId, color, icon } = subcategory;
      
      const result = await pool.query(
        `INSERT INTO skill_subcategories (
          name, description, category_id, color, icon, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) 
        RETURNING *`,
        [
          name,
          description || null,
          categoryId,
          color || '#3B82F6',
          icon || 'code'
        ]
      );
      
      // Fetch the category name to include in the response
      const category = await this.getSkillCategory(categoryId);
      
      return {
        ...this.snakeToCamel(result.rows[0]),
        categoryName: category?.name || ''
      };
    } catch (error) {
      console.error("Error creating skill subcategory:", error);
      throw error;
    }
  }
  
  async updateSkillSubcategory(id: number, data: Partial<SkillSubcategory>): Promise<SkillSubcategory> {
    try {
      const sets: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      // Build SET clause and parameters
      for (const [key, value] of Object.entries(data)) {
        // Skip categoryName as it's not a database column
        if (key === 'categoryName') continue;
        
        // Convert camelCase to snake_case for database column names
        const columnName = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${columnName} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
      
      // Always update the updated_at timestamp
      sets.push(`updated_at = NOW()`);
      
      if (sets.length === 1) { // Only has updated_at
        return await this.getSkillSubcategory(id) as SkillSubcategory;
      }
      
      params.push(id); // Add id as the last parameter
      
      const result = await pool.query(
        `UPDATE skill_subcategories SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );
      
      if (result.rows.length === 0) {
        throw new Error("Skill subcategory not found");
      }
      
      // Fetch the category name to include in the response
      const subcategory = this.snakeToCamel(result.rows[0]);
      const category = await this.getSkillCategory(subcategory.categoryId);
      
      return {
        ...subcategory,
        categoryName: category?.name || ''
      };
    } catch (error) {
      console.error("Error updating skill subcategory:", error);
      throw error;
    }
  }
  
  async deleteSkillSubcategory(id: number): Promise<void> {
    try {
      // Delete any approvers for this subcategory
      await pool.query(
        'DELETE FROM skill_approvers WHERE subcategory_id = $1',
        [id]
      );
      
      // Delete the subcategory
      const result = await pool.query(
        'DELETE FROM skill_subcategories WHERE id = $1',
        [id]
      );
      
      if (result.rowCount === 0) {
        throw new Error("Skill subcategory not found");
      }
    } catch (error) {
      console.error("Error deleting skill subcategory:", error);
      throw error;
    }
  }
  
  // Skill Approver methods
  async getAllSkillApprovers(): Promise<SkillApprover[]> {
    try {
      const result = await pool.query(
        'SELECT * FROM skill_approvers'
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting all skill approvers:", error);
      throw error;
    }
  }
  
  async getSkillApprover(id: number): Promise<SkillApprover | undefined> {
    try {
      const result = await pool.query(
        'SELECT * FROM skill_approvers WHERE id = $1',
        [id]
      );
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting skill approver:", error);
      throw error;
    }
  }
  
  async getSkillApproversByUser(userId: number): Promise<SkillApprover[]> {
    try {
      const result = await pool.query(
        'SELECT * FROM skill_approvers WHERE user_id = $1',
        [userId]
      );
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting user's skill approvers:", error);
      throw error;
    }
  }
  
  async getApproversForCategory(categoryId: number): Promise<SkillApprover[]> {
    try {
      const result = await pool.query(`
        SELECT sa.*, u.email, u.username, u.display_name
        FROM skill_approvers sa
        JOIN users u ON sa.user_id = u.id
        WHERE (sa.category_id = $1 AND sa.subcategory_id IS NULL) 
           OR sa.can_approve_all = true
      `, [categoryId]);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting approvers for category:", error);
      throw error;
    }
  }
  
  async getApproversForSubcategory(subcategoryId: number): Promise<SkillApprover[]> {
    try {
      // First get the category ID for this subcategory
      const subcatResult = await pool.query(
        'SELECT category_id FROM skill_subcategories WHERE id = $1',
        [subcategoryId]
      );
      
      if (subcatResult.rows.length === 0) {
        throw new Error(`Subcategory with ID ${subcategoryId} not found`);
      }
      
      const categoryId = subcatResult.rows[0].category_id;
      
      // Get approvers for this subcategory, plus any from the parent category, plus global approvers
      const result = await pool.query(`
        SELECT sa.*, u.email, u.username, u.display_name
        FROM skill_approvers sa
        JOIN users u ON sa.user_id = u.id
        WHERE sa.subcategory_id = $1
           OR (sa.category_id = $2 AND sa.subcategory_id IS NULL)
           OR sa.can_approve_all = true
        ORDER BY sa.can_approve_all DESC, sa.subcategory_id DESC, sa.category_id DESC
      `, [subcategoryId, categoryId]);
      
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error(`Error getting approvers for subcategory ${subcategoryId}:`, error);
      throw error;
    }
  }
  
  async createSkillApprover(approver: InsertSkillApprover): Promise<SkillApprover> {
    try {
      const { userId, categoryId, subcategoryId, skillTemplateId, canApproveAll } = approver;
      
      // Check for existing approvers based on what we're trying to create
      let existingResult;
      
      if (canApproveAll) {
        // Check if the user already has global approval rights
        existingResult = await pool.query(
          'SELECT * FROM skill_approvers WHERE user_id = $1 AND can_approve_all = true',
          [userId]
        );
        if (existingResult.rows.length > 0) {
          return this.snakeToCamel(existingResult.rows[0]);
        }
      } else if (skillTemplateId) {
        // Check if the user is already an approver for this specific skill template
        existingResult = await pool.query(
          'SELECT * FROM skill_approvers WHERE user_id = $1 AND skill_template_id = $2',
          [userId, skillTemplateId]
        );
        if (existingResult.rows.length > 0) {
          return this.snakeToCamel(existingResult.rows[0]);
        }
      } else if (subcategoryId) {
        // Check if the user is already an approver for this subcategory
        existingResult = await pool.query(
          'SELECT * FROM skill_approvers WHERE user_id = $1 AND subcategory_id = $2',
          [userId, subcategoryId]
        );
        if (existingResult.rows.length > 0) {
          return this.snakeToCamel(existingResult.rows[0]);
        }
      } else if (categoryId) {
        // Check if the user is already an approver for this category (no subcategory)
        existingResult = await pool.query(
          'SELECT * FROM skill_approvers WHERE user_id = $1 AND category_id = $2 AND subcategory_id IS NULL',
          [userId, categoryId]
        );
        if (existingResult.rows.length > 0) {
          return this.snakeToCamel(existingResult.rows[0]);
        }
      }
      
      // Create the new approver
      const result = await pool.query(
        `INSERT INTO skill_approvers (
          user_id, category_id, subcategory_id, skill_template_id, can_approve_all, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [
          userId,
          categoryId || null,
          subcategoryId || null,
          skillTemplateId || null,
          canApproveAll || false
        ]
      );
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating skill approver:", error);
      throw error;
    }
  }
  
  async deleteSkillApprover(id: number): Promise<void> {
    try {
      const result = await pool.query(
        'DELETE FROM skill_approvers WHERE id = $1',
        [id]
      );
      
      if (result.rowCount === 0) {
        throw new Error("Skill approver not found");
      }
    } catch (error) {
      console.error("Error deleting skill approver:", error);
      throw error;
    }
  }
  
  async isUserApprover(userId: number): Promise<boolean> {
    try {
      // Check if user is super admin first
      const userResult = await pool.query(
        'SELECT email, is_admin FROM users WHERE id = $1',
        [userId]
      );
      
      // If user is not found, they can't approve
      if (userResult.rows.length === 0) {
        console.log(`User ${userId} not found, can't be approver`);
        return false;
      }
      
      // Super admin can approve everything
      if (userResult.rows[0].email === "admin@atyeti.com") {
        console.log(`User ${userId} is super admin, can approve all skills`);
        return true;
      }
      
      // If the user is an admin, they can approve
      if (userResult.rows[0].is_admin) {
        console.log(`User ${userId} is an admin, can approve skills`);
        return true;
      }
      
      // Check if they have any approver assignments in the skill_approvers table
      const approverQuery = `
        SELECT COUNT(*) FROM skill_approvers 
        WHERE user_id = $1
      `;
      const approverResult = await pool.query(approverQuery, [userId]);
      
      const hasApproverRole = parseInt(approverResult.rows[0].count) > 0;
      console.log(`User ${userId} approver status: ${hasApproverRole ? 'is approver' : 'not approver'}`);
      
      return hasApproverRole;
    } catch (error) {
      console.error(`Error checking if user ${userId} is an approver:`, error);
      return false;
    }
  }
  
  async canUserApproveSkill(userId: number, categoryId: number, subcategoryId?: number, skillTemplateId?: number): Promise<boolean> {
    try {
      // Check if user is super admin
      const userResult = await pool.query(
        'SELECT email, is_admin FROM users WHERE id = $1',
        [userId]
      );
      
      // If user is not found, they can't approve
      if (userResult.rows.length === 0) {
        console.log(`User ${userId} not found, can't approve`);
        return false;
      }
      
      // Super admin can approve everything
      if (userResult.rows[0].email === "admin@atyeti.com") {
        console.log(`User ${userId} is super admin, can approve all skills`);
        return true;
      }
      
      // Enhancing the debug logs
      console.log(`Checking if user ${userId} can approve - Category: ${categoryId}, Subcategory: ${subcategoryId || 'none'}, Skill Template: ${skillTemplateId || 'none'}`);
      
      // For testing - Check all the approver assignments
      const allAssignmentsQuery = `SELECT * FROM skill_approvers WHERE user_id = $1`;
      const allAssignments = await pool.query(allAssignmentsQuery, [userId]);
      console.log(`User ${userId} has ${allAssignments.rows.length} approver assignments:`, JSON.stringify(allAssignments.rows));
      
      // Now check specific permission
      // We'll check each level with precise matching
      
      // 1. Check if they have skill-specific permission
      if (skillTemplateId) {
        const skillSpecificQuery = `
          SELECT * FROM skill_approvers 
          WHERE user_id = $1 AND skill_template_id = $2
        `;
        const skillSpecificResult = await pool.query(skillSpecificQuery, [userId, skillTemplateId]);
        
        if (skillSpecificResult.rows.length > 0) {
          console.log(`User ${userId} has skill-specific permission for skill template ${skillTemplateId}`);
          return true;
        }
      }
      
      // 2. Check if they have subcategory permission that applies to this skill
      if (subcategoryId) {
        const subcategoryQuery = `
          SELECT * FROM skill_approvers 
          WHERE user_id = $1 AND subcategory_id = $2
        `;
        const subcategoryResult = await pool.query(subcategoryQuery, [userId, subcategoryId]);
        
        if (subcategoryResult.rows.length > 0) {
          console.log(`User ${userId} has subcategory permission for subcategory ${subcategoryId}`);
          return true;
        }
      }
      
      // 3. Check if they have category permission
      if (categoryId) {
        const categoryQuery = `
          SELECT * FROM skill_approvers 
          WHERE user_id = $1 AND category_id = $2 AND subcategory_id IS NULL AND skill_template_id IS NULL
        `;
        const categoryResult = await pool.query(categoryQuery, [userId, categoryId]);
        
        if (categoryResult.rows.length > 0) {
          console.log(`User ${userId} has category-wide permission for category ${categoryId}`);
          return true;
        }
      }
      
      // 4. Finally, check if they have global approval rights (can_approve_all)
      const globalQuery = `
        SELECT * FROM skill_approvers 
        WHERE user_id = $1 AND can_approve_all = true
      `;
      const globalResult = await pool.query(globalQuery, [userId]);
      
      if (globalResult.rows.length > 0) {
        console.log(`User ${userId} has global approval permission`);
        return true;
      }
      
      console.log(`User ${userId} does not have permission to approve this skill`);
      return false;
    } catch (error) {
      console.error("Error checking if user can approve skill:", error);
      return false;
    }
  }
  
  // This is a duplicate implementation - using the one above
  
  // Report Settings operations
  async getReportSettings(): Promise<ReportSettings[]> {
    try {
      const result = await pool.query(`
        SELECT rs.*, c.name as client_name 
        FROM report_settings rs
        LEFT JOIN clients c ON rs.client_id = c.id
        ORDER BY rs.name
      `);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting report settings:", error);
      throw error;
    }
  }

  async getReportSettingById(id: number): Promise<ReportSettings | undefined> {
    try {
      const result = await pool.query(`
        SELECT rs.*, c.name as client_name 
        FROM report_settings rs
        LEFT JOIN clients c ON rs.client_id = c.id
        WHERE rs.id = $1
      `, [id]);
      if (!result.rows[0]) return undefined;
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error getting report setting by ID:", error);
      throw error;
    }
  }

  async getReportSettingsByClient(clientId: number): Promise<ReportSettings[]> {
    try {
      const result = await pool.query(`
        SELECT rs.*, c.name as client_name 
        FROM report_settings rs
        LEFT JOIN clients c ON rs.client_id = c.id
        WHERE rs.client_id = $1
        ORDER BY rs.name
      `, [clientId]);
      return this.snakeToCamel(result.rows);
    } catch (error) {
      console.error("Error getting report settings by client:", error);
      throw error;
    }
  }

  async createReportSetting(data: InsertReportSettings): Promise<ReportSettings> {
    try {
      // Calculate next scheduled time based on frequency
      let nextScheduledAt = new Date();
      
      if (data.frequency === 'weekly') {
        // Set to next occurrence of the specified day of week
        const dayOfWeek = data.dayOfWeek || 1; // Default to Monday (1)
        const currentDay = nextScheduledAt.getDay() || 7; // Convert Sunday (0) to 7 for easier calculation
        const daysToAdd = (dayOfWeek - currentDay + 7) % 7 || 7; // Add 7 if result is 0
        nextScheduledAt.setDate(nextScheduledAt.getDate() + daysToAdd);
      } else if (data.frequency === 'biweekly') {
        // Set to next occurrence of the specified day of week, then add another week
        const dayOfWeek = data.dayOfWeek || 1; // Default to Monday (1)
        const currentDay = nextScheduledAt.getDay() || 7; // Convert Sunday (0) to 7 for easier calculation
        const daysToAdd = (dayOfWeek - currentDay + 7) % 7 || 7; // Add 7 if result is 0
        nextScheduledAt.setDate(nextScheduledAt.getDate() + daysToAdd + 7); // Add another week
      } else if (data.frequency === 'monthly') {
        // Set to the specified day of the month
        const dayOfMonth = data.dayOfMonth || 1; // Default to 1st day of month
        nextScheduledAt.setDate(dayOfMonth);
        // If the day has already passed this month, move to next month
        if (nextScheduledAt.getDate() < new Date().getDate()) {
          nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1);
        }
      }
      
      // Set time to 9:00 AM
      nextScheduledAt.setHours(9, 0, 0, 0);
      
      const result = await pool.query(`
        INSERT INTO report_settings (
          name, frequency, day_of_week, day_of_month, recipients, 
          client_id, is_active, next_scheduled_at, base_url, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        data.name,
        data.frequency,
        data.dayOfWeek || 1, // Default to Monday
        data.dayOfMonth || null,
        // Handle both old (recipients) and new (recipientEmail) column names for backward compatibility
        data.recipientEmail || data.recipients || process.env.SALES_TEAM_EMAIL,
        data.clientId || null,
        // Handle both old (isActive) and new (active) column names for backward compatibility
        data.active !== undefined ? data.active : (data.isActive !== undefined ? data.isActive : true),
        nextScheduledAt,
        data.baseUrl || null,
        data.description || null
      ]);
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error creating report setting:", error);
      throw error;
    }
  }

  async updateReportSetting(id: number, data: Partial<InsertReportSettings>): Promise<ReportSettings> {
    try {
      // Get existing report to calculate next scheduled time if frequency is changed
      const existing = await this.getReportSettingById(id);
      if (!existing) {
        throw new Error(`Report setting with ID ${id} not found`);
      }
      
      let nextScheduledAt = existing.nextScheduledAt ? new Date(existing.nextScheduledAt) : new Date();
      const frequencyChanged = data.frequency !== undefined && data.frequency !== existing.frequency;
      const dayChanged = (data.dayOfWeek !== undefined && data.dayOfWeek !== existing.dayOfWeek) ||
                         (data.dayOfMonth !== undefined && data.dayOfMonth !== existing.dayOfMonth);
      
      // Recalculate next scheduled time if frequency or day changed
      if (frequencyChanged || dayChanged) {
        nextScheduledAt = new Date(); // Reset to current date
        
        const frequency = data.frequency || existing.frequency;
        
        if (frequency === 'weekly') {
          // Set to next occurrence of the specified day of week
          const dayOfWeek = data.dayOfWeek !== undefined ? data.dayOfWeek : (existing.dayOfWeek || 1);
          const currentDay = nextScheduledAt.getDay() || 7; // Convert Sunday (0) to 7
          const daysToAdd = (dayOfWeek - currentDay + 7) % 7 || 7; // Add 7 if result is 0
          nextScheduledAt.setDate(nextScheduledAt.getDate() + daysToAdd);
        } else if (frequency === 'biweekly') {
          // Set to next occurrence of the specified day of week, then add another week
          const dayOfWeek = data.dayOfWeek !== undefined ? data.dayOfWeek : (existing.dayOfWeek || 1);
          const currentDay = nextScheduledAt.getDay() || 7; // Convert Sunday (0) to 7
          const daysToAdd = (dayOfWeek - currentDay + 7) % 7 || 7; // Add 7 if result is 0
          nextScheduledAt.setDate(nextScheduledAt.getDate() + daysToAdd + 7); // Add another week
        } else if (frequency === 'monthly') {
          // Set to the specified day of the month
          const dayOfMonth = data.dayOfMonth !== undefined ? data.dayOfMonth : (existing.dayOfMonth || 1);
          nextScheduledAt.setDate(dayOfMonth);
          // If the day has already passed this month, move to next month
          if (nextScheduledAt.getDate() < new Date().getDate()) {
            nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1);
          }
        }
        
        // Set time to 9:00 AM
        nextScheduledAt.setHours(9, 0, 0, 0);
      }
      
      // Build SQL query dynamically based on provided fields
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;
      
      if (data.name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        values.push(data.name);
      }
      
      if (data.frequency !== undefined) {
        updates.push(`frequency = $${paramCount++}`);
        values.push(data.frequency);
      }
      
      if (data.dayOfWeek !== undefined) {
        updates.push(`day_of_week = $${paramCount++}`);
        values.push(data.dayOfWeek);
      }
      
      if (data.dayOfMonth !== undefined) {
        updates.push(`day_of_month = $${paramCount++}`);
        values.push(data.dayOfMonth);
      }
      
      // Handle recipientEmail field (updated column name)
      if (data.recipientEmail !== undefined) {
        updates.push(`recipient_email = $${paramCount++}`);
        values.push(data.recipientEmail);
      } else if (data.recipients !== undefined) {
        updates.push(`recipient_email = $${paramCount++}`);
        values.push(data.recipients);
      }
      
      if (data.clientId !== undefined) {
        updates.push(`client_id = $${paramCount++}`);
        values.push(data.clientId);
      }
      
      // Handle active field (updated column name)
      if (data.active !== undefined) {
        updates.push(`active = $${paramCount++}`);
        values.push(data.active);
      } else if (data.isActive !== undefined) {
        updates.push(`active = $${paramCount++}`);
        values.push(data.isActive);
      }
      
      // Handle baseUrl field
      if (data.baseUrl !== undefined) {
        updates.push(`base_url = $${paramCount++}`);
        values.push(data.baseUrl);
      }
      
      // Handle description field
      if (data.description !== undefined) {
        updates.push(`description = $${paramCount++}`);
        values.push(data.description);
      }
      
      // Always update next_scheduled_at if frequency or day changed
      if (frequencyChanged || dayChanged) {
        updates.push(`next_scheduled_at = $${paramCount++}`);
        values.push(nextScheduledAt);
      }
      
      // Always update updated_at timestamp
      updates.push(`updated_at = $${paramCount++}`);
      values.push(new Date());
      
      // Add the ID as the last parameter
      values.push(id);
      
      const result = await pool.query(`
        UPDATE report_settings
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `, values);
      
      if (!result.rows[0]) {
        throw new Error(`Report setting with ID ${id} not found`);
      }
      
      return this.snakeToCamel(result.rows[0]);
    } catch (error) {
      console.error("Error updating report setting:", error);
      throw error;
    }
  }

  async deleteReportSetting(id: number): Promise<boolean> {
    try {
      const result = await pool.query(`
        DELETE FROM report_settings
        WHERE id = $1
        RETURNING id
      `, [id]);
      
      return result.rowCount > 0;
    } catch (error) {
      console.error("Error deleting report setting:", error);
      throw error;
    }
  }
}

export const storage = new PostgresStorage();