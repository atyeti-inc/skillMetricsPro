import { 
  getPasswordResetEmailContent,
  getResourceAddedEmailContent,
  getResourceRemovedEmailContent,
  getProjectCreatedEmailContent,
  getProjectUpdatedEmailContent,
  getWeeklyResourceReportEmailContent,
  getSkillApprovedEmailContent,
  getSkillRejectedEmailContent
} from './email-templates';
import Mailjet from 'node-mailjet';
import { formatDate } from '../client/src/lib/date-utils';
import { pool } from './db';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Email addresses for HR, Finance, and Sales teams
const HR_COORDINATOR_EMAIL = process.env.HR_COORDINATOR_EMAIL || 'hr@skillsplatform.com';
const FINANCE_EXECUTIVE_EMAIL = process.env.FINANCE_EXECUTIVE_EMAIL || 'finance@skillsplatform.com';
const SALES_TEAM_EMAIL = process.env.SALES_TEAM_EMAIL || 'sales@skillsplatform.com';

// Base URL for application links (adjust as needed for production)
const APP_BASE_URL = process.env.APP_BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;

// Initialize Mailjet client
const mailjet = new Mailjet({
  apiKey: process.env.MAILJET_API_KEY || 'your-api-key',
  apiSecret: process.env.MAILJET_SECRET_KEY || 'your-secret-key'
});

// Verify email configuration on startup
if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
  console.warn('Missing Mailjet configuration. Email functionality will be limited.');
} else {
  console.log('Mailjet configuration found. Email service is ready.');
}

/**
 * Generates and sends the weekly project resource report
 * @param reportSettingId Optional report setting ID to use custom configuration
 * @param clientId Optional client ID to filter resources
 */
export async function generateAndSendWeeklyReport(reportSettingId?: number): Promise<boolean> {
  try {
    console.log("Generating weekly project resource report...");
    
    // Get current date/time
    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(now.getDate() - 7);
    
    // Format dates for display
    const formattedReportDate = formatDate(now);
    const formattedStartDate = formatDate(oneWeekAgo);
    const formattedEndDate = formatDate(now);
    const reportPeriod = `${formattedStartDate} to ${formattedEndDate}`;
    
    // Get the report settings if an ID was provided
    let recipient = SALES_TEAM_EMAIL;
    let clientFilter: number | null = null;
    let baseUrl = APP_BASE_URL;
    let reportName = "Weekly Project Resource Report";
    
    if (reportSettingId) {
      try {
        const result = await pool.query(
          'SELECT * FROM report_settings WHERE id = $1',
          [reportSettingId]
        );
        
        if (result.rows.length > 0) {
          const reportSetting = result.rows[0];
          // Note: Using current column names until migration is applied
          recipient = reportSetting.recipients || reportSetting.recipient_email || SALES_TEAM_EMAIL;
          clientFilter = reportSetting.client_id; // This can be null (all clients)
          reportName = reportSetting.name || reportName;
          
          // Use custom baseUrl if provided
          if (reportSetting.base_url) {
            baseUrl = reportSetting.base_url.trim();
            // Ensure baseUrl has proper format with protocol
            if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
              baseUrl = 'https://' + baseUrl;
            }
          }
          
          console.log(`Using custom report settings (ID: ${reportSettingId}):`, {
            reportName,
            recipient,
            clientFilter: clientFilter ? `Client ID: ${clientFilter}` : 'All Clients',
            baseUrl
          });
        }
      } catch (err) {
        console.error(`Error fetching report settings (ID: ${reportSettingId}):`, err);
        // Continue with default settings
      }
    }
    
    // Add client filter to query if specified
    let resourcesQuery = `
      SELECT 
        pr.id, 
        pr.project_id AS "projectId", 
        p.name AS "projectName",
        pr.user_id AS "userId", 
        u.username,
        u.email AS "userEmail",
        pr.role,
        pr.allocation,
        pr.start_date AS "startDate",
        pr.end_date AS "endDate",
        pr.created_at AS "addedAt"
      FROM 
        project_resources pr
      JOIN 
        projects p ON pr.project_id = p.id
      JOIN 
        users u ON pr.user_id = u.id
      WHERE 
        pr.created_at >= $1
    `;
    
    const queryParams = [oneWeekAgo.toISOString()];
    
    // Add client filter if specified
    if (clientFilter !== null) {
      resourcesQuery += ` AND p.client_id = $2`;
      queryParams.push(clientFilter.toString());
    }
    
    resourcesQuery += ` ORDER BY pr.created_at DESC`;
    
    const resourcesResult = await pool.query(resourcesQuery, queryParams);
    const resourcesAdded = resourcesResult.rows.map(row => ({
      ...row,
      startDate: row.startDate ? formatDate(row.startDate) : null,
      endDate: row.endDate ? formatDate(row.endDate) : null,
      addedAt: formatDate(row.addedAt)
    }));
    
    // Fetch skills for each resource (user)
    const resourceSkills: Record<number, Array<{
      id: number;
      name: string;
      level: string;
      category: string;
      subcategory?: string;
      certification?: string;
    }>> = {};
    
    for (const resource of resourcesAdded) {
      try {
        // Query to get the top skills (limited to 5) for each user
        const skillsQuery = `
          SELECT us.*, 
                st.name, 
                st.category, 
                sc.name as category_name, 
                sc.color as category_color, 
                sc.icon as category_icon,
                sub.name as subcategory_name
          FROM user_skills us
          JOIN skill_templates st ON us.skill_template_id = st.id
          LEFT JOIN skill_categories sc ON st.category_id = sc.id
          LEFT JOIN skill_subcategories sub ON st.subcategory_id = sub.id
          WHERE us.user_id = $1 
          ORDER BY us.level DESC, us.last_updated DESC
          LIMIT 5
        `;
        const skillsResult = await pool.query(skillsQuery, [resource.userId]);
        
        // Store the skills in the resourceSkills object, indexed by userId
        resourceSkills[resource.userId] = skillsResult.rows.map(skill => ({
          id: skill.id,
          name: skill.name,
          level: skill.level,
          category: skill.category_name || skill.category,
          subcategory: skill.subcategory_name,
          certification: skill.certification
        }));
      } catch (err) {
        console.error(`Error fetching skills for user ${resource.userId}:`, err);
        resourceSkills[resource.userId] = [];
      }
    }
    
    // Generate links to projects and users with custom or default baseUrl
    const projectLinks = resourcesAdded.map(resource => ({
      projectId: resource.projectId,
      projectLink: `${baseUrl}/projects/${resource.projectId}`
    }));
    
    const userLinks = resourcesAdded.map(resource => ({
      userId: resource.userId,
      userLink: `${baseUrl}/users/${resource.userId}`
    }));
    
    // Generate email content
    const { text, html, subject } = getWeeklyResourceReportEmailContent(
      formattedReportDate,
      reportPeriod,
      resourcesAdded,
      projectLinks,
      userLinks,
      resourceSkills
    );
    
    // Skip sending email if Mailjet is not configured
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging weekly report details instead...');
      console.log(`${reportName} for ${reportPeriod}`);
      console.log(`Resources added in the last week: ${resourcesAdded.length}`);
      console.log(`Would have sent email to: ${recipient}`);
      return true;
    }
    
    // Skip sending if no resources were found
    if (resourcesAdded.length === 0) {
      console.log('No resources added during this period. Skipping email.');
      return true;
    }
    
    // Send the report via email
    try {
      await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: recipient,
                  Name: "Resource Report Recipient"
                }
              ],
              Subject: subject,
              TextPart: text,
              HTMLPart: html
            }
          ]
        });
      
      console.log(`${reportName} sent to ${recipient}`);
      console.log(`Report period: ${reportPeriod}, Resources included: ${resourcesAdded.length}`);
      
      // Update last sent timestamp for this report setting
      if (reportSettingId) {
        try {
          await pool.query(
            'UPDATE report_settings SET last_sent_at = $1, updated_at = $1 WHERE id = $2',
            [now.toISOString(), reportSettingId]
          );
        } catch (err) {
          console.error(`Error updating last_sent_at for report setting ${reportSettingId}:`, err);
        }
      }
      
      return true;
    } catch (sendError: any) {
      console.error('Error sending weekly report email:', sendError?.message || sendError);
      console.log(`Fallback - Weekly Project Resource Report for ${reportPeriod}`);
      console.log(`Resources added in the last week: ${resourcesAdded.length}`);
      return false;
    }
  } catch (error: any) {
    console.error('Error in weekly report generation:', error?.message || error);
    return false;
  }
}

/**
 * Force-generate and send a weekly report immediately (for testing or manual triggers)
 */
export async function sendImmediateWeeklyReport(reportSettingId?: number): Promise<boolean> {
  console.log("Manually triggering weekly project resource report...");
  return await generateAndSendWeeklyReport(reportSettingId);
}

// Schedule the report system for all active report settings
export function scheduleWeeklyReport() {
  console.log("Setting up project resource report scheduler...");
  
  // Calculate the next run time (default: next Monday at 9:00 AM)
  const now = new Date();
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((7 - now.getDay() + 1) % 7 || 7)); // Get next Monday
  nextMonday.setHours(9, 0, 0, 0); // Set to 9:00 AM
  
  // If the calculated time is in the past (meaning we're checking on Monday after 9 AM),
  // add 7 days to get next Monday
  if (nextMonday <= now) {
    nextMonday.setDate(nextMonday.getDate() + 7);
  }
  
  const timeUntilNextRun = nextMonday.getTime() - now.getTime();
  
  console.log(`Next weekly report scheduled for: ${nextMonday.toLocaleString()}`);
  
  // Check for customized report settings
  checkAndScheduleCustomReports();
  
  // Schedule the default report
  setTimeout(() => {
    generateAndSendWeeklyReport();
    
    // Then schedule to run every 7 days
    setInterval(generateAndSendWeeklyReport, 7 * 24 * 60 * 60 * 1000);
  }, timeUntilNextRun);
}

// Check for custom report settings and schedule them
async function checkAndScheduleCustomReports() {
  try {
    // Get all active report settings
    // Using active field (migration has been applied)
    const result = await pool.query(
      'SELECT * FROM report_settings WHERE active = true'
    );
    
    const reportSettings = result.rows;
    console.log(`Found ${reportSettings.length} active report settings to schedule`);
    
    // Schedule each report according to its frequency
    for (const report of reportSettings) {
      try {
        scheduleCustomReport(report);
      } catch (err) {
        console.error(`Error scheduling report ${report.id} (${report.name}):`, err);
      }
    }
  } catch (err) {
    console.error('Error checking for custom report settings:', err);
  }
}

// Schedule a specific report based on its settings
function scheduleCustomReport(report: any) {
  const { id, name, frequency, day_of_week, day_of_month } = report;
  const now = new Date();
  let nextRunDate = new Date(now);
  
  try {
    // Calculate the next run time based on frequency
    if (frequency === 'daily') {
      // Daily: Run at 9:00 AM every day
      nextRunDate.setDate(now.getDate() + (nextRunDate.getHours() >= 9 ? 1 : 0));
      nextRunDate.setHours(9, 0, 0, 0);
    } else if (frequency === 'weekly') {
      // Weekly: Run on specified day of week (0=Sunday, 1=Monday, ...) at 9:00 AM
      const dayOfWeek = day_of_week !== null ? day_of_week : 1; // Default to Monday
      const daysUntilNextRun = (7 + dayOfWeek - now.getDay()) % 7;
      nextRunDate.setDate(now.getDate() + (daysUntilNextRun === 0 && now.getHours() >= 9 ? 7 : daysUntilNextRun));
      nextRunDate.setHours(9, 0, 0, 0);
    } else if (frequency === 'monthly') {
      // Monthly: Run on specified day of month at 9:00 AM
      const dayOfMonth = day_of_month !== null ? day_of_month : 1; // Default to 1st day
      
      // Set to the requested day of the current month
      nextRunDate.setDate(dayOfMonth);
      nextRunDate.setHours(9, 0, 0, 0);
      
      // If that day has already passed this month, move to next month
      if (nextRunDate <= now) {
        nextRunDate.setMonth(nextRunDate.getMonth() + 1);
      }
    }
    
    const timeUntilNextRun = nextRunDate.getTime() - now.getTime();
    
    console.log(`Scheduled custom report ${id} (${name}): ${frequency}, next run at ${nextRunDate.toLocaleString()}`);
    
    // Update next_scheduled_at in the database
    pool.query(
      'UPDATE report_settings SET next_scheduled_at = $1, updated_at = NOW() WHERE id = $2',
      [nextRunDate.toISOString(), id]
    ).catch(err => {
      console.error(`Error updating next_scheduled_at for report ${id}:`, err);
    });
    
    // Schedule the report execution
    setTimeout(() => {
      console.log(`Executing scheduled report ${id} (${name})`);
      generateAndSendWeeklyReport(id)
        .then(success => {
          if (success) {
            console.log(`Successfully sent report ${id} (${name})`);
          } else {
            console.error(`Failed to send report ${id} (${name})`);
          }
          
          // Reschedule the report for its next run
          scheduleCustomReport(report);
        })
        .catch(err => {
          console.error(`Error sending report ${id} (${name}):`, err);
          // Reschedule anyway
          scheduleCustomReport(report);
        });
    }, timeUntilNextRun);
    
  } catch (err) {
    console.error(`Error in scheduling custom report ${id} (${name}):`, err);
  }
}

/**
 * Sends registration email using Mailjet
 * Includes a fallback mechanism if email sending fails
 */
export async function sendRegistrationEmail(
  to: string,
  username: string,
  password: string
): Promise<void> {
  try {
    // Import fallback mechanism
    const { logRegistrationDetails } = await import('./email-fallback');
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4f46e5;">Welcome to Employee Skill Metrics!</h2>
        <p>Hello ${username},</p>
        <p>Your account has been created successfully.</p>
        <p>Please use the following credentials to log in:</p>
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Email:</strong> ${to}</p>
          <p style="margin: 5px 0;"><strong>Password:</strong> ${password}</p>
        </div>
        <p style="color: #ef4444;"><strong>Important:</strong> Please change your password after logging in.</p>
        <p>Best regards,<br>The Employee Skill Metrics Team</p>
      </div>
    `;

    const text = `
      Hello ${username},

      Your account has been created successfully. 
      Please use the following credentials to log in:

      Email: ${to}
      Password: ${password}

      Please change your password after logging in.

      Best regards,
      The Employee Skill Metrics Team
    `;

    try {
      const data = await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: to,
                  Name: username
                }
              ],
              Subject: "Your Employee Skill Metrics Account",
              TextPart: text,
              HTMLPart: html
            }
          ]
        });

      console.log(`Registration email sent successfully to ${to}`);
      return;
    } catch (sendError: any) {
      console.error('Error sending registration email:', sendError?.message || sendError);
      logRegistrationDetails(to, username);
      throw new Error('Failed to send registration email');
    }
  } catch (error: any) {
    console.error('Error in registration email flow:', error?.message || error);
    throw new Error('Failed to send registration email');
  }
}

/**
 * Sends password reset email using Mailjet
 * Includes a fallback mechanism if email sending fails
 */
export async function sendPasswordResetEmail(
  to: string,
  username: string,
  temporaryPassword: string
): Promise<void> {
  try {
    // Import fallback mechanism
    const { logPasswordResetDetails } = await import('./email-fallback');
    
    const { text, html, subject } = getPasswordResetEmailContent(username, temporaryPassword);

    try {
      const data = await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: to,
                  Name: username
                }
              ],
              Subject: subject || "Your Password Has Been Reset",
              TextPart: text,
              HTMLPart: html
            }
          ]
        });

      console.log(`Password reset email sent successfully to ${to}`);
      return;
    } catch (sendError: any) {
      console.error('Error sending password reset email:', sendError?.message || sendError);
      logPasswordResetDetails(to, username);
      throw new Error('Failed to send password reset email');
    }
  } catch (error: any) {
    console.error('Error in password reset flow:', error?.message || error);
    throw new Error('Failed to send password reset email');
  }
}

/**
 * Sends resource addition notification to HR and Finance
 */
export async function sendResourceAddedEmail(
  projectName: string,
  username: string,
  userEmail: string,
  role: string,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
  allocation: number,
  hrEmail: string | null = null,
  financeEmail: string | null = null,
  performedBy: string | null = null
): Promise<boolean> {
  try {
    // Format dates for display
    const formattedStartDate = startDate ? formatDate(startDate) : null;
    const formattedEndDate = endDate ? formatDate(endDate) : null;
    
    const { text, html, subject } = getResourceAddedEmailContent(
      projectName,
      username,
      userEmail,
      role,
      formattedStartDate,
      formattedEndDate,
      allocation,
      performedBy || undefined
    );
    
    // Use project-specific emails if provided, otherwise fall back to defaults
    const hrRecipientEmail = hrEmail || HR_COORDINATOR_EMAIL;
    const financeRecipientEmail = financeEmail || FINANCE_EXECUTIVE_EMAIL;
    
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging resource addition details instead...');
      console.log(`Resource Added: ${username} (${role}) to ${projectName}`);
      console.log(`Timeline: ${formattedStartDate || 'N/A'} to ${formattedEndDate || 'ongoing'}`);
      console.log(`Would have sent email to: ${hrRecipientEmail}, ${financeRecipientEmail}`);
      return true;
    }

    try {
      await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: hrRecipientEmail,
                  Name: "HR Coordinator"
                },
                {
                  Email: financeRecipientEmail,
                  Name: "Finance Executive"
                }
              ],
              Subject: subject,
              TextPart: text,
              HTMLPart: html
            }
          ]
        });

      console.log(`Resource addition email sent to HR (${hrRecipientEmail}) and Finance (${financeRecipientEmail})`);
      return true;
    } catch (sendError: any) {
      console.error('Error sending resource addition email:', sendError?.message || sendError);
      console.log(`Fallback - Resource Added: ${username} (${role}) to ${projectName}`);
      console.log(`Timeline: ${formattedStartDate || 'N/A'} to ${formattedEndDate || 'ongoing'}`);
      return false;
    }
  } catch (error: any) {
    console.error('Error in resource addition email flow:', error?.message || error);
    return false;
  }
}

/**
 * Sends resource removal notification to HR and Finance
 */
export async function sendResourceRemovedEmail(
  projectName: string,
  username: string,
  userEmail: string,
  role: string,
  hrEmail: string | null = null,
  financeEmail: string | null = null,
  allocation: number | null = null,
  performedBy: string | null = null
): Promise<boolean> {
  try {
    const { text, html, subject } = getResourceRemovedEmailContent(
      projectName,
      username,
      userEmail,
      role,
      allocation,
      performedBy || undefined
    );
    
    // Use project-specific emails if provided, otherwise fall back to defaults
    const hrRecipientEmail = hrEmail || HR_COORDINATOR_EMAIL;
    const financeRecipientEmail = financeEmail || FINANCE_EXECUTIVE_EMAIL;
    
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging resource removal details instead...');
      console.log(`Resource Removed: ${username} (${role}) from ${projectName}`);
      console.log(`Allocation: ${allocation || 'N/A'}%`);
      console.log(`Would have sent email to: ${hrRecipientEmail}, ${financeRecipientEmail}`);
      return true;
    }

    try {
      await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: hrRecipientEmail,
                  Name: "HR Coordinator"
                },
                {
                  Email: financeRecipientEmail,
                  Name: "Finance Executive"
                }
              ],
              Subject: subject,
              TextPart: text,
              HTMLPart: html
            }
          ]
        });

      console.log(`Resource removal email sent to HR (${hrRecipientEmail}) and Finance (${financeRecipientEmail})`);
      return true;
    } catch (sendError: any) {
      console.error('Error sending resource removal email:', sendError?.message || sendError);
      console.log(`Fallback - Resource Removed: ${username} (${role}) from ${projectName}`);
      console.log(`Allocation: ${allocation || 'N/A'}%`);
      return false;
    }
  } catch (error: any) {
    console.error('Error in resource removal email flow:', error?.message || error);
    return false;
  }
}

/**
 * Sends project creation notification to HR and Finance
 */
export async function sendProjectCreatedEmail(
  projectName: string,
  clientName: string | null | undefined,
  description: string | null | undefined,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
  leadName: string | null | undefined,
  hrEmail: string | null = null,
  financeEmail: string | null = null
): Promise<boolean> {
  try {
    // Format dates for display
    const formattedStartDate = startDate ? formatDate(startDate) : null;
    const formattedEndDate = endDate ? formatDate(endDate) : null;
    
    const { text, html, subject } = getProjectCreatedEmailContent(
      projectName,
      clientName,
      description,
      formattedStartDate,
      formattedEndDate,
      leadName
    );
    
    // Use project-specific emails if provided, otherwise fall back to defaults
    const hrRecipientEmail = hrEmail || HR_COORDINATOR_EMAIL;
    const financeRecipientEmail = financeEmail || FINANCE_EXECUTIVE_EMAIL;
    
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging project creation details instead...');
      console.log(`Project Created: ${projectName} (Client: ${clientName || 'Not specified'})`);
      console.log(`Would have sent email to: ${hrRecipientEmail}, ${financeRecipientEmail}`);
      return true;
    }

    try {
      await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: hrRecipientEmail,
                  Name: "HR Coordinator"
                },
                {
                  Email: financeRecipientEmail,
                  Name: "Finance Executive"
                }
              ],
              Subject: subject,
              TextPart: text,
              HTMLPart: html
            }
          ]
        });

      console.log(`Project creation email sent to HR (${hrRecipientEmail}) and Finance (${financeRecipientEmail})`);
      return true;
    } catch (sendError: any) {
      console.error('Error sending project creation email:', sendError?.message || sendError);
      console.log(`Fallback - Project Created: ${projectName}`);
      return false;
    }
  } catch (error: any) {
    console.error('Error in project creation email flow:', error?.message || error);
    return false;
  }
}

/**
 * Sends project update notification to HR and Finance
 */
export async function sendProjectUpdatedEmail(
  projectName: string,
  clientName: string | null | undefined,
  description: string | null | undefined,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
  leadName: string | null | undefined,
  changedFields: { field: string, oldValue?: string | null, newValue?: string | null }[],
  hrEmail: string | null = null,
  financeEmail: string | null = null,
  performedBy: string | null = null
): Promise<boolean> {
  try {
    // Format dates for display
    const formattedStartDate = startDate ? formatDate(startDate) : null;
    const formattedEndDate = endDate ? formatDate(endDate) : null;
    
    const { text, html, subject } = getProjectUpdatedEmailContent(
      projectName,
      clientName,
      description,
      formattedStartDate,
      formattedEndDate,
      leadName,
      changedFields,
      performedBy || undefined
    );
    
    // Use project-specific emails if provided, otherwise fall back to defaults
    const hrRecipientEmail = hrEmail || HR_COORDINATOR_EMAIL;
    const financeRecipientEmail = financeEmail || FINANCE_EXECUTIVE_EMAIL;
    
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging project update details instead...');
      
      const changedFieldsText = changedFields.map(f => 
        `${f.field}: ${f.oldValue || '(not set)'} → ${f.newValue || '(not set)'}`
      ).join(', ');
      
      console.log(`Project Updated: ${projectName}`);
      console.log(`Fields changed: ${changedFieldsText}`);
      console.log(`Would have sent email to: ${hrRecipientEmail}, ${financeRecipientEmail}`);
      return true;
    }

    try {
      await mailjet
        .post('send', { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: "vinayak.chobe@atyeti.com",
                Name: "Employee Skill Metrics"
              },
              To: [
                {
                  Email: hrRecipientEmail,
                  Name: "HR Coordinator"
                },
                {
                  Email: financeRecipientEmail,
                  Name: "Finance Executive"
                }
              ],
              Subject: subject,
              TextPart: text,
              HTMLPart: html
            }
          ]
        });

      console.log(`Project update email sent to HR (${hrRecipientEmail}) and Finance (${financeRecipientEmail})`);
      return true;
    } catch (sendError: any) {
      console.error('Error sending project update email:', sendError?.message || sendError);
      console.log(`Fallback - Project Updated: ${projectName}`);
      return false;
    }
  } catch (error: any) {
    console.error('Error in project update email flow:', error?.message || error);
    return false;
  }
}

/**
 * Sends a skill approval notification email to the user
 */
export async function sendSkillApprovedEmail(
  to: string,
  firstName: string,
  skillName: string
): Promise<boolean> {
  try {
    const { text, html, subject } = getSkillApprovedEmailContent(
      firstName,
      skillName
    );

    // Skip sending email if Mailjet is not configured
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging skill approval details instead...');
      console.log(`Skill Approval Notification for: ${to}`);
      console.log(`Skill: ${skillName} has been approved for user: ${firstName}`);
      return true;
    }

    await mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: "vinayak.chobe@atyeti.com",
              Name: "Atyeti Skills Platform"
            },
            To: [
              {
                Email: to,
                Name: firstName
              }
            ],
            Subject: subject,
            TextPart: text,
            HTMLPart: html
          }
        ]
      });

    console.log(`Skill approval email sent to: ${to} for skill: ${skillName}`);
    return true;
  } catch (error: any) {
    console.error('Error sending skill approval email:', error?.message || error);
    console.log(`Fallback - Skill Approval for ${firstName}: Skill ${skillName} has been approved`);
    return false;
  }
}

/**
 * Sends a skill rejection notification email to the user
 */
export async function sendSkillRejectedEmail(
  to: string,
  firstName: string,
  skillName: string
): Promise<boolean> {
  try {
    const { text, html, subject } = getSkillRejectedEmailContent(
      firstName,
      skillName
    );

    // Skip sending email if Mailjet is not configured
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      console.log('Mailjet not configured. Logging skill rejection details instead...');
      console.log(`Skill Rejection Notification for: ${to}`);
      console.log(`Skill: ${skillName} has been rejected for user: ${firstName}`);
      return true;
    }

    await mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: "vinayak.chobe@atyeti.com",
              Name: "Atyeti Skills Platform"
            },
            To: [
              {
                Email: to,
                Name: firstName
              }
            ],
            Subject: subject,
            TextPart: text,
            HTMLPart: html
          }
        ]
      });

    console.log(`Skill rejection email sent to: ${to} for skill: ${skillName}`);
    return true;
  } catch (error: any) {
    console.error('Error sending skill rejection email:', error?.message || error);
    console.log(`Fallback - Skill Rejection for ${firstName}: Skill ${skillName} has been rejected`);
    return false;
  }
}