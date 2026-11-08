import { pgTable, text, serial, integer, boolean, timestamp, pgEnum, date, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Approval status enum
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);

// Users schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  is_admin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Optional fields with defaults
  username: text("username").default(''),
  password: text("password").default(''),
  firstName: text("first_name").default(''),
  lastName: text("last_name").default(''),
  project: text("project").default(''),
  role: text("role").default(''),
  location: text("location").default(''),
});

export const insertUserSchema = createInsertSchema(users)
  .pick({
    email: true,
  })
  .extend({
    is_admin: z.boolean().default(false).optional(),
    password: z.string().optional(), // Password is generated on server
  });

// Registration schema only needs email, and must be an @atyeti.com domain
export const registerSchema = z.object({
  email: z.string()
    .email("Valid email is required")
    .refine(email => email.endsWith('@atyeti.com'), {
      message: "Only @atyeti.com email addresses are allowed"
    }),
});

export const loginUserSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});

// Skill level enum
export const skillLevelEnum = pgEnum("skill_level", ["beginner", "intermediate", "expert"]);

// Tab visibility enum
export const tabVisibilityEnum = pgEnum("tab_visibility", ["visible", "hidden"]);

// Category type enum (technical or functional)
export const categoryTypeEnum = pgEnum("category_type", ["technical", "functional"]);

// Skill Categories schema (for organizing skills into categories with tabs)
export const skillCategories = pgTable("skill_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  tabOrder: integer("tab_order").default(0),
  visibility: tabVisibilityEnum("visibility").default("visible"),
  color: text("color").default("#3B82F6"), // Default blue color
  icon: text("icon").default("code"),
  categoryType: categoryTypeEnum("category_type").default("technical"), // Technical or Functional
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Skill Subcategories schema (for organizing skills into subcategories within categories)
export const skillSubcategories = pgTable("skill_subcategories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  categoryId: integer("category_id").notNull().references(() => skillCategories.id),
  color: text("color").default("#3B82F6"), // Default blue color
  icon: text("icon").default("code"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSkillCategorySchema = createInsertSchema(skillCategories).pick({
  name: true,
  description: true,
  tabOrder: true,
  visibility: true,
  color: true,
  icon: true,
  categoryType: true,
});

export const insertSkillSubcategorySchema = createInsertSchema(skillSubcategories).pick({
  name: true,
  description: true,
  categoryId: true,
  color: true,
  icon: true,
});

// Skill Approvers schema (admin users with approval rights for specific categories)
export const skillApprovers = pgTable("skill_approvers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  categoryId: integer("category_id").references(() => skillCategories.id),
  subcategoryId: integer("subcategory_id").references(() => skillSubcategories.id),
  skillTemplateId: integer("skill_template_id").references(() => skillTemplates.id),
  canApproveAll: boolean("can_approve_all").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSkillApproverSchema = createInsertSchema(skillApprovers).pick({
  userId: true,
  categoryId: true,
  subcategoryId: true,
  skillTemplateId: true,
  canApproveAll: true,
});

export type SkillCategory = typeof skillCategories.$inferSelect;
export type InsertSkillCategory = z.infer<typeof insertSkillCategorySchema>;

export type SkillSubcategory = typeof skillSubcategories.$inferSelect;
export type InsertSkillSubcategory = z.infer<typeof insertSkillSubcategorySchema>;

export type SkillApprover = typeof skillApprovers.$inferSelect;
export type InsertSkillApprover = z.infer<typeof insertSkillApproverSchema>;

// User Skills schema (maps users to skill templates)
export const userSkills = pgTable("user_skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  skillTemplateId: integer("skill_template_id").notNull().references(() => skillTemplates.id),
  level: skillLevelEnum("level").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  certification: text("certification"),
  credlyLink: text("credly_link"),
  notes: text("notes"),
  endorsementCount: integer("endorsement_count").default(0),
  certificationDate: timestamp("certification_date"),
  expirationDate: timestamp("expiration_date"),
});

// For backward compatibility during migration
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(), // Keep this for backward compatibility
  categoryId: integer("category_id").references(() => skillCategories.id), // New reference to categories table
  subcategoryId: integer("subcategory_id").references(() => skillSubcategories.id), // Reference to subcategories table
  level: skillLevelEnum("level").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  certification: text("certification"),
  credlyLink: text("credly_link"),
  notes: text("notes"),
  endorsementCount: integer("endorsement_count").default(0),
  certificationDate: timestamp("certification_date"),
  expirationDate: timestamp("expiration_date"),
});

export const insertSkillSchema = createInsertSchema(skills).pick({
  userId: true,
  name: true,
  category: true,
  categoryId: true, // Field for referencing the category
  subcategoryId: true, // Field for referencing the subcategory
  level: true,
  certification: true,
  credlyLink: true,
  notes: true,
  certificationDate: true,
  expirationDate: true,
});

export const insertUserSkillSchema = createInsertSchema(userSkills).pick({
  userId: true,
  skillTemplateId: true,
  level: true,
  certification: true,
  credlyLink: true,
  notes: true,
  certificationDate: true,
  expirationDate: true,
});

// Skill history schema
export const skillHistories = pgTable("skill_histories", {
  id: serial("id").primaryKey(),
  skillId: integer("skill_id").notNull(),
  userId: integer("user_id").notNull(),
  previousLevel: skillLevelEnum("previous_level"),
  newLevel: skillLevelEnum("new_level").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  changeNote: text("change_note"),
  // Additional fields for user_skills references
  userSkillId: integer("user_skill_id").references(() => userSkills.id, { onDelete: 'cascade' }),
  changeById: integer("change_by_id").references(() => users.id, { onDelete: 'set null' }),
  approvalId: integer("approval_id").references(() => pendingSkillUpdates.id, { onDelete: 'set null' }),
});

// Alias for compatibility - points to the same table
export const skillHistoriesV2 = skillHistories;

export const insertSkillHistorySchema = createInsertSchema(skillHistories).pick({
  skillId: true,
  userId: true,
  previousLevel: true,
  newLevel: true,
  changeNote: true,
});

export const insertSkillHistoryV2Schema = createInsertSchema(skillHistoriesV2)
  .omit({ id: true, createdAt: true })
  .extend({
    skillId: z.number().optional(), // For backward compatibility, maps to userSkillId
    changeById: z.number().optional(), // User who made the change
    approvalId: z.number().optional(), // Reference to approval record
  })
  .transform(data => {
    // Handle compatibility with the legacy schema by mapping skillId to userSkillId
    const result: any = { ...data };
    if (data.skillId !== undefined && data.userSkillId === undefined) {
      result.userSkillId = data.skillId;
    }
    return result;
  });

// Profile history schema
export const profileHistories = pgTable("profile_histories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  changedField: text("changed_field").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProfileHistorySchema = createInsertSchema(profileHistories).pick({
  userId: true,
  changedField: true,
  previousValue: true,
  newValue: true,
});

// Notification type enum
export const notificationTypeEnum = pgEnum("notification_type", ["endorsement", "level_up", "achievement"]);

// Notifications schema
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: notificationTypeEnum("type").notNull(),
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false),
  relatedSkillId: integer("related_skill_id"),
  relatedUserSkillId: integer("related_user_skill_id").references(() => userSkills.id, { onDelete: 'cascade' }),
  relatedUserId: integer("related_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications).pick({
  userId: true,
  type: true,
  content: true,
  relatedSkillId: true,
  relatedUserSkillId: true, // References user_skills table
  relatedUserId: true,
});

// Endorsements schema
export const endorsements = pgTable("endorsements", {
  id: serial("id").primaryKey(),
  skillId: integer("skill_id").notNull(),
  endorserId: integer("endorser_id").notNull(),
  endorseeId: integer("endorsee_id").notNull(), 
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Additional fields for user_skills references
  userSkillId: integer("user_skill_id").references(() => userSkills.id, { onDelete: 'cascade' }),
  userId: integer("user_id"), // The user who owns the skill (same as endorseeId)
  level: varchar("level", { length: 20 }),
  updatedAt: timestamp("updated_at"),
});

// Alias for compatibility - points to the same table
export const endorsementsV2 = endorsements;

export const insertEndorsementSchema = createInsertSchema(endorsements).pick({
  skillId: true,
  endorserId: true,
  endorseeId: true,
  comment: true,
});

export const insertEndorsementV2Schema = createInsertSchema(endorsementsV2)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    skillId: z.number().optional(), // For backward compatibility, maps to userSkillId
    level: z.string().min(1, "Skill level is required"), // Add the level field
    endorseeId: z.number().optional(), // For backward compatibility, maps to userId
  })
  .transform(data => {
    // Handle compatibility with the legacy schema by mapping skillId to userSkillId
    const result: any = { ...data };
    if (data.skillId !== undefined && data.userSkillId === undefined) {
      result.userSkillId = data.skillId;
    }
    // Map endorseeId to userId if needed
    if (data.endorseeId !== undefined && data.userId === undefined) {
      result.userId = data.endorseeId;
    }
    return result;
  });

// Export types
export type User = Omit<typeof users.$inferSelect, "password"> & {
  // Additional runtime properties that might be added during processing
  isAdmin?: boolean;
};
export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;

export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;

export type UserSkill = typeof userSkills.$inferSelect & {
  name?: string; // Added to support approval flow
  skillName?: string;
  skillCategory?: string;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
  subcategoryName?: string;
  subcategoryColor?: string;
  subcategoryIcon?: string;
};
export type InsertUserSkill = z.infer<typeof insertUserSkillSchema>;

export type SkillHistory = typeof skillHistories.$inferSelect;
export type InsertSkillHistory = z.infer<typeof insertSkillHistorySchema>;

export type SkillHistoryV2 = typeof skillHistoriesV2.$inferSelect;
export type InsertSkillHistoryV2 = z.infer<typeof insertSkillHistoryV2Schema>;

export type ProfileHistory = typeof profileHistories.$inferSelect;
export type InsertProfileHistory = z.infer<typeof insertProfileHistorySchema>;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export type Endorsement = typeof endorsements.$inferSelect;
export type InsertEndorsement = z.infer<typeof insertEndorsementSchema>;

export type EndorsementV2 = typeof endorsementsV2.$inferSelect;
export type InsertEndorsementV2 = z.infer<typeof insertEndorsementV2Schema>;

// Skill Templates schema
export const skillTemplates = pgTable("skill_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // Keep for backward compatibility
  categoryId: integer("category_id").references(() => skillCategories.id), // Reference to categories table
  subcategoryId: integer("subcategory_id").references(() => skillSubcategories.id), // Reference to subcategories table
  description: text("description"),
  isRecommended: boolean("is_recommended").default(false),
  targetLevel: skillLevelEnum("target_level"),
  targetDate: date("target_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSkillTemplateSchema = createInsertSchema(skillTemplates).pick({
  name: true,
  category: true,
  categoryId: true,
  subcategoryId: true,
  description: true,
  isRecommended: true,
  targetLevel: true,
  targetDate: true,
});

// Skill Targets schema
export const skillTargets = pgTable("skill_targets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Required in database but optional in UI
  description: text("description"),
  targetLevel: skillLevelEnum("target_level").notNull(),
  targetDate: date("target_date"),
  targetNumber: integer("target_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const skillTargetSkills = pgTable("skill_target_skills", {
  id: serial("id").primaryKey(),
  targetId: integer("target_id").notNull(),
  skillId: integer("skill_id").notNull(),
});

export const skillTargetUsers = pgTable("skill_target_users", {
  id: serial("id").primaryKey(),
  targetId: integer("target_id").notNull(),
  userId: integer("user_id").notNull(),
});

export const insertSkillTargetSchema = createInsertSchema(skillTargets).pick({
  name: true,
  description: true,
  targetLevel: true,
  targetDate: true,
  targetNumber: true,
});

export type SkillTemplate = typeof skillTemplates.$inferSelect;
export type InsertSkillTemplate = z.infer<typeof insertSkillTemplateSchema>;

export type SkillTarget = typeof skillTargets.$inferSelect;
export type InsertSkillTarget = z.infer<typeof insertSkillTargetSchema>;

// Pending Skill Updates schema
export const pendingSkillUpdates = pgTable("pending_skill_updates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  skillId: integer("skill_id"), // Null for new skills
  name: text("name").notNull(),
  category: text("category").notNull(), // Keep for backward compatibility
  categoryId: integer("category_id").references(() => skillCategories.id), // Reference to categories table
  subcategoryId: integer("subcategory_id").references(() => skillSubcategories.id), // Reference to subcategories table
  level: skillLevelEnum("level").notNull(),
  certification: text("certification"),
  credlyLink: text("credly_link"),
  notes: text("notes"),
  certificationDate: timestamp("certification_date"),
  expirationDate: timestamp("expiration_date"),
  status: approvalStatusEnum("status").default("pending").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by"),
  reviewNotes: text("review_notes"),
  isUpdate: boolean("is_update").default(false).notNull(), // true for updates, false for new skills
  // Additional fields for user_skills references
  userSkillId: integer("user_skill_id").references(() => userSkills.id), // Null for new skills
  skillTemplateId: integer("skill_template_id").references(() => skillTemplates.id),
});

// Alias for compatibility - points to the same table
export const pendingSkillUpdatesV2 = pendingSkillUpdates;

// Create the base schema
const baseInsertPendingSkillUpdateSchema = createInsertSchema(pendingSkillUpdates).pick({
  userId: true,
  skillId: true,
  name: true,
  category: true,
  categoryId: true,
  subcategoryId: true,
  level: true,
  certification: true,
  credlyLink: true,
  notes: true,
  certificationDate: true,
  expirationDate: true,
  isUpdate: true,
});

// Create an extended schema that accepts both camelCase and snake_case versions
export const insertPendingSkillUpdateSchema = baseInsertPendingSkillUpdateSchema
  .extend({
    // Add snake_case aliases for compatibility
    skill_id: z.number().optional(),
    user_id: z.number().optional(),
    category_id: z.number().optional(),
    subcategory_id: z.number().optional(),
    is_update: z.boolean().optional(),
    credly_link: z.string().optional(),
    certification_date: z.date().optional(),
    expiration_date: z.date().optional(),
  })
  // Make new schema fields optional for backward compatibility
  .partial({
    categoryId: true,
    subcategoryId: true,
  }).transform((data) => {
    // Make sure camelCase values are prioritized, but fall back to snake_case
    const result = { ...data };
    
    // Handle converting snake_case to camelCase for special fields
    if (data.skill_id !== undefined && data.skillId === undefined) {
      result.skillId = data.skill_id;
    }
    
    if (data.user_id !== undefined && data.userId === undefined) {
      result.userId = data.user_id;
    }
    
    if (data.category_id !== undefined && data.categoryId === undefined) {
      result.categoryId = data.category_id;
    }
    
    if (data.subcategory_id !== undefined && data.subcategoryId === undefined) {
      result.subcategoryId = data.subcategory_id;
    }
    
    if (data.is_update !== undefined && data.isUpdate === undefined) {
      result.isUpdate = data.is_update;
    }
    
    if (data.credly_link !== undefined && data.credlyLink === undefined) {
      result.credlyLink = data.credly_link;
    }
    
    if (data.certification_date !== undefined && data.certificationDate === undefined) {
      result.certificationDate = data.certification_date;
    }
    
    if (data.expiration_date !== undefined && data.expirationDate === undefined) {
      result.expirationDate = data.expiration_date;
    }
    
    // Remove snake_case duplicates that we've copied to camelCase
    delete result.skill_id;
    delete result.user_id;
    delete result.category_id;
    delete result.subcategory_id;
    delete result.is_update;
    delete result.credly_link;
    delete result.certification_date;
    delete result.expiration_date;
    
    return result;
});

// Create the V2 base schema for pendingSkillUpdatesV2
const baseInsertPendingSkillUpdateV2Schema = createInsertSchema(pendingSkillUpdatesV2).pick({
  userId: true,
  userSkillId: true,
  skillTemplateId: true,
  level: true,
  certification: true,
  credlyLink: true,
  notes: true,
  certificationDate: true,
  expirationDate: true,
  isUpdate: true,
});

// Create an extended schema that accepts both camelCase and snake_case versions
export const insertPendingSkillUpdateV2Schema = baseInsertPendingSkillUpdateV2Schema
  .extend({
    // Add snake_case aliases for compatibility
    user_id: z.number().optional(),
    user_skill_id: z.number().optional(),
    skill_template_id: z.number().optional(),
    is_update: z.boolean().optional(),
    credly_link: z.string().optional(),
    certification_date: z.date().optional(),
    expiration_date: z.date().optional(),
    // Add custom skill fields
    category: z.string().optional(),
    // Use subcategoryId instead of subcategory string field
    name: z.string().optional(), // For custom skills
  })
  .transform((data) => {
    // Make sure camelCase values are prioritized, but fall back to snake_case
    const result = { ...data };
    
    // Handle converting snake_case to camelCase for special fields
    if (data.user_id !== undefined && data.userId === undefined) {
      result.userId = data.user_id;
    }
    
    if (data.user_skill_id !== undefined && data.userSkillId === undefined) {
      result.userSkillId = data.user_skill_id;
    }
    
    if (data.skill_template_id !== undefined && data.skillTemplateId === undefined) {
      result.skillTemplateId = data.skill_template_id;
    }
    
    if (data.is_update !== undefined && data.isUpdate === undefined) {
      result.isUpdate = data.is_update;
    }
    
    if (data.credly_link !== undefined && data.credlyLink === undefined) {
      result.credlyLink = data.credly_link;
    }
    
    if (data.certification_date !== undefined && data.certificationDate === undefined) {
      result.certificationDate = data.certification_date;
    }
    
    if (data.expiration_date !== undefined && data.expirationDate === undefined) {
      result.expirationDate = data.expiration_date;
    }
    
    // Remove snake_case duplicates that we've copied to camelCase
    delete result.user_id;
    delete result.user_skill_id;
    delete result.skill_template_id;
    delete result.is_update;
    delete result.credly_link;
    delete result.certification_date;
    delete result.expiration_date;
    
    return result;
  });

export type PendingSkillUpdate = typeof pendingSkillUpdates.$inferSelect;
export type InsertPendingSkillUpdate = z.infer<typeof insertPendingSkillUpdateSchema>;

export type PendingSkillUpdateV2 = typeof pendingSkillUpdatesV2.$inferSelect & {
  skillName?: string;
  skillCategory?: string;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
  subcategoryName?: string;
  subcategoryColor?: string;
  subcategoryIcon?: string;
  userUsername?: string;
  userEmail?: string;
  reviewerUsername?: string;
};
export type InsertPendingSkillUpdateV2 = z.infer<typeof insertPendingSkillUpdateV2Schema>;

// Client schema
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry"),
  accountManagerId: integer("account_manager_id").references(() => users.id),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  logoUrl: text("logo_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const insertClientSchema = createInsertSchema(clients).pick({
  name: true,
  industry: true,
  accountManagerId: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  website: true,
  logoUrl: true,
  notes: true
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

// Project schema
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  clientId: integer("client_id").references(() => clients.id),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  location: text("location"),
  confluenceLink: text("confluence_link"),
  leadId: integer("lead_id").references(() => users.id),
  deliveryLeadId: integer("delivery_lead_id").references(() => users.id),
  projectLeadEmail: text("project_lead_email"),
  clientEngagementLeadEmail: text("client_engagement_lead_email"),
  hrCoordinatorEmail: text("hr_coordinator_email"),
  financeTeamEmail: text("finance_team_email"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const insertProjectSchema = createInsertSchema(projects)
  .pick({
    name: true,
    description: true,
    clientId: true,
    startDate: true,
    endDate: true,
    location: true,
    confluenceLink: true,
    leadId: true,
    deliveryLeadId: true,
    projectLeadEmail: true,
    clientEngagementLeadEmail: true,
    hrCoordinatorEmail: true,
    financeTeamEmail: true,
    status: true
  })
  .extend({
    // Allow string dates that will be converted to Date objects on the server
    startDate: z.union([z.string(), z.date(), z.null()]).optional(),
    endDate: z.union([z.string(), z.date(), z.null()]).optional(),
    // Email validation
    projectLeadEmail: z.string().email("Invalid project lead email").optional(),
    clientEngagementLeadEmail: z.string().email("Invalid client engagement lead email").optional(),
    hrCoordinatorEmail: z.string().email("Invalid HR coordinator email").optional(),
    financeTeamEmail: z.string().email("Invalid finance team email").optional(),
  });

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

// Project Resources (Users assigned to Projects)
export const projectResources = pgTable("project_resources", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  userId: integer("user_id").notNull().references(() => users.id),
  email: text("email"), // Email for the resource (may be different from user email)
  role: text("role"),
  allocation: integer("allocation").default(100), // Percentage of time allocated
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const insertProjectResourceSchema = createInsertSchema(projectResources)
  .pick({
    projectId: true,
    userId: true,
    role: true,
    allocation: true,
    startDate: true,
    endDate: true,
    notes: true
  })
  .extend({
    // Allow string dates that will be converted to Date objects on the server
    startDate: z.union([z.string(), z.date(), z.null()]).optional(),
    endDate: z.union([z.string(), z.date(), z.null()]).optional(),
    // Email is now optional - will be fetched from user profile
    email: z.string().email("Invalid email address").optional(),
  });

export type ProjectResource = typeof projectResources.$inferSelect;
export type InsertProjectResource = z.infer<typeof insertProjectResourceSchema>;

// Project Skills (Skills required/used in Projects) - Legacy version
export const projectSkills = pgTable("project_skills", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  skillId: integer("skill_id").notNull(), // References user_skills.id
  skillTemplateId: integer("skill_template_id"), // Added for new structure - allows direct reference to templates
  requiredLevel: skillLevelEnum("required_level").default("beginner"), // beginner, intermediate, expert
  importance: varchar("importance", { length: 10 }).default("medium"), // low, medium, high
  createdAt: timestamp("created_at").defaultNow()
});

// Note: We're no longer using project_skills_v2 table.
// The project_skills table has been enhanced with skill_template_id column instead.

export const insertProjectSkillSchema = createInsertSchema(projectSkills).pick({
  projectId: true,
  skillId: true,
  skillTemplateId: true, // Added for direct template reference
  requiredLevel: true,
  importance: true
}).extend({
  // Allow either skillId or skillTemplateId to be specified
  skillId: z.number().optional(),
  skillTemplateId: z.number().optional()
}).refine(
  data => data.skillId !== undefined || data.skillTemplateId !== undefined,
  { message: "Either skillId or skillTemplateId must be provided" }
);

// Define ProjectSkillV2 schema using the enhanced projectSkills table with skill_template_id
export const insertProjectSkillV2Schema = createInsertSchema(projectSkills).pick({
  projectId: true,
  skillTemplateId: true,
  requiredLevel: true,
  importance: true
}).extend({
  // Only skill_template_id is required for V2 operations
  skillTemplateId: z.number()
});

export type ProjectSkill = typeof projectSkills.$inferSelect;
export type InsertProjectSkill = z.infer<typeof insertProjectSkillSchema>;

// ProjectSkillV2 type now uses the enhanced projectSkills table
export type ProjectSkillV2 = typeof projectSkills.$inferSelect & {
  skillName?: string;
  skillCategory?: string;
};
export type InsertProjectSkillV2 = z.infer<typeof insertProjectSkillV2Schema>;

// Project Resource History (tracking changes in project assignments)
export const projectResourceHistories = pgTable("project_resource_histories", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  userId: integer("user_id").notNull().references(() => users.id),
  action: text("action").notNull(), // added, removed, role_changed, allocation_changed
  previousRole: text("previous_role"),
  newRole: text("new_role"),
  previousAllocation: integer("previous_allocation"),
  newAllocation: integer("new_allocation"),
  date: timestamp("date").defaultNow(),
  performedById: integer("performed_by_id").references(() => users.id),
  note: text("note")
});

export const insertProjectResourceHistorySchema = createInsertSchema(projectResourceHistories).pick({
  projectId: true,
  userId: true,
  action: true,
  previousRole: true,
  newRole: true,
  previousAllocation: true,
  newAllocation: true,
  date: true,
  performedById: true,
  note: true
});

export type ProjectResourceHistory = typeof projectResourceHistories.$inferSelect;
export type InsertProjectResourceHistory = z.infer<typeof insertProjectResourceHistorySchema>;

// Report Settings Schema
export const reportSettings = pgTable('report_settings', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  frequency: text('frequency', { enum: ['daily', 'weekly', 'monthly'] }).notNull().default('weekly'),
  dayOfWeek: integer('day_of_week').default(1), // 0 = Sunday, 1 = Monday
  dayOfMonth: integer('day_of_month'), // For monthly reports, 1-31
  recipientEmail: text('recipient_email').notNull(), // Primary recipient
  baseUrl: text('base_url'), // Custom hostname for links in emails
  description: text('description'), // Optional description
  clientId: integer('client_id').references(() => clients.id), // NULL means all clients
  active: boolean('active').notNull().default(true),
  lastSentAt: timestamp('last_sent_at'),
  nextScheduledAt: timestamp('next_scheduled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
});

// Define the insert and select types for report settings
export const insertReportSettingsSchema = createInsertSchema(reportSettings).pick({
  name: true,
  frequency: true,
  dayOfWeek: true,
  dayOfMonth: true,
  recipientEmail: true,
  baseUrl: true,
  description: true,
  clientId: true,
  active: true,
});

export type ReportSettings = typeof reportSettings.$inferSelect;
export type InsertReportSettings = z.infer<typeof insertReportSettingsSchema>;
