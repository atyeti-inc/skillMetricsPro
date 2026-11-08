/**
 * Utility functions for the server
 */

const ALLOWLIST_KEYS = new Set([
  "commithash",
  "urlhash",
  "paginationtoken",
  "nexttoken",
  "hashalgorithm",
  "codesnippet",
]);

const SENSITIVE_KEY_REGEX = /^(?:password|temporaryPassword|tempPassword|currentPassword|newPassword|passwd|secret|cookie|authorization|proxyAuthorization|passwordHash|accessToken|refreshToken|authToken|bearerToken|sessionToken|salt|token)$/i;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (ALLOWLIST_KEYS.has(normalized)) {
    return false;
  }
  const stripped = key.replace(/[-_]/g, "");
  return SENSITIVE_KEY_REGEX.test(key) || SENSITIVE_KEY_REGEX.test(stripped);
}

/**
 * Recursively sanitizes objects and arrays by redacting credentials and sensitive keys.
 * Preserves safe operational keys such as commitHash, paginationToken, etc.
 */
export function sanitizeLogObject(data: unknown, seen = new WeakSet()): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (seen.has(data)) {
    return "[Circular]";
  }
  seen.add(data);

  if (data instanceof Date || data instanceof RegExp) {
    return data;
  }

  if (data instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
    for (const key of Object.keys(data)) {
      if (!(key in errorObj)) {
        if (isSensitiveKey(key)) {
          errorObj[key] = "[REDACTED]";
        } else {
          errorObj[key] = sanitizeLogObject((data as any)[key], seen);
        }
      }
    }
    return errorObj;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogObject(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeLogObject(value, seen);
    }
  }
  return result;
}

/**
 * Masks an email address for privacy in log files (e.g., c***@atyeti.com)
 */
export function maskEmail(email: string): string {
  if (!email || typeof email !== "string") return "";
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  const firstChar = email.charAt(0);
  const domain = email.slice(atIndex);
  return `${firstChar}***${domain}`;
}

/**
 * Log a message with timestamp
 */
export function log(message: string, source = "server") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Structured audit logging for security and operational events
 */
export function auditLog(event: string, metadata: Record<string, unknown> = {}): void {
  const sanitizedMeta = sanitizeLogObject(metadata);
  log(`${event} ${JSON.stringify(sanitizedMeta)}`, "audit");
}
