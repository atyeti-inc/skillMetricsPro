/**
 * Email Fallback Service
 * 
 * This module provides fallback mechanisms when the main email service is unavailable.
 * It logs operational notifications without emitting credentials or plaintext passwords.
 */

import { maskEmail } from "./utils";

export function logRegistrationDetails(email: string, username: string): void {
  console.log(`
========== BACKUP: REGISTRATION DETAILS ==========
Email: ${maskEmail(email)}
Username: ${username}
Status: Registration notification queued (credential delivery via secure channel)
===============================================
  `);
}

export function logPasswordResetDetails(email: string, username: string): void {
  console.log(`
========== BACKUP: PASSWORD RESET DETAILS ==========
Email: ${maskEmail(email)}
Username: ${username}
Status: Password reset notification queued (credential delivery via secure channel)
===============================================
  `);
}
