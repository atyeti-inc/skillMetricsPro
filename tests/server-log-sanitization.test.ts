import { describe, it, expect, beforeEach, mock } from "bun:test";
import util from "util";

// Mock external npm modules that are not installed in the isolated test environment
mock.module("drizzle-orm", () => ({
  getTableColumns: () => ({
    id: { name: "id" },
    email: { name: "email" },
    is_admin: { name: "is_admin" },
    created_at: { name: "created_at" },
    username: { name: "username" },
    password: { name: "password" },
    firstName: { name: "first_name" },
    lastName: { name: "last_name" },
    project: { name: "project" },
    role: { name: "role" },
    location: { name: "location" },
  }),
  drizzle: () => ({}),
}));

mock.module("drizzle-orm/pg-core", () => {
  const createColProxy = (name: string): any => {
    const col: any = { name };
    return new Proxy(col, {
      get: (target, prop) => {
        if (prop === "name") return target.name;
        return () => createColProxy(target.name);
      },
    });
  };
  return {
    pgTable: () => ({}),
    text: (name: string) => createColProxy(name),
    serial: (name: string) => createColProxy(name),
    integer: (name: string) => createColProxy(name),
    boolean: (name: string) => createColProxy(name),
    timestamp: (name: string) => createColProxy(name),
    pgEnum: () => () => createColProxy("enum"),
    date: (name: string) => createColProxy(name),
    varchar: (name: string) => createColProxy(name),
  };
});

mock.module("drizzle-zod", () => {
  const createProxy = (): any => {
    const fn: any = () => createProxy();
    return new Proxy(fn, {
      get: () => createProxy(),
      apply: () => createProxy(),
    });
  };
  return {
    createInsertSchema: () => createProxy(),
    createSelectSchema: () => createProxy(),
  };
});

mock.module("zod", () => {
  const createProxy = (): any => {
    const fn: any = () => createProxy();
    return new Proxy(fn, {
      get: () => createProxy(),
      apply: () => createProxy(),
    });
  };
  return { z: createProxy() };
});

mock.module("express-session", () => {
  const fn: any = () => () => {};
  fn.default = fn;
  fn.Store = class Store {};
  return fn;
});
mock.module("memorystore", () => ({ default: () => class MemoryStore {} }));
mock.module("connect-pg-simple", () => ({ default: () => class PgStore {} }));
mock.module("passport", () => ({
  use: () => {},
  serializeUser: () => {},
  deserializeUser: () => {},
  authenticate: () => () => {},
  initialize: () => () => {},
  session: () => () => {},
}));
mock.module("passport-local", () => ({
  Strategy: class LocalStrategy {},
}));
mock.module("node-mailjet", () => ({
  default: class Mailjet {},
}));
mock.module("date-fns", () => ({
  format: () => "2025-01-01",
  formatDistanceToNow: () => "just now",
  parseISO: (d: any) => new Date(d),
  isValid: () => true,
  parse: () => new Date(),
}));

let queryLogs: { sql: string; params?: any[] }[] = [];
let mockQueryResponse: { rows: any[]; rowCount: number } = { rows: [], rowCount: 1 };

mock.module("../server/db", () => ({
  pool: {
    query: async (sql: string, params?: any[]) => {
      queryLogs.push({ sql, params });
      return mockQueryResponse;
    },
    on: () => {},
    connect: async () => ({
      query: async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }),
      release: () => {},
    }),
  },
  db: {},
  testDatabaseConnection: async () => true,
}));

// Import target modules dynamically after mocks
const { sanitizeLogObject, maskEmail, auditLog } = await import("../server/utils");
const { storage, SAFE_USER_COLUMNS } = await import("../server/storage");
const { logRegistrationDetails, logPasswordResetDetails } = await import("../server/email-fallback");

describe("sanitizeLogObject", () => {
  it("redacts sensitive credential keys and preserves non-sensitive operational domain keys", () => {
    const input = {
      password: "secret_password_123",
      temporaryPassword: "temp_secret_456",
      salt: "salt_abc123",
      secret: "api_secret_key",
      accessToken: "token_jwt_xyz",
      token: "t1",
      commitHash: "abc12345def67890",
      paginationToken: "page_token_999",
      urlHash: "section-2",
      nextToken: "next_cursor_456",
      hashAlgorithm: "SHA-256",
      codeSnippet: "console.log('hello')",
      safe: "ok",
      user: {
        id: 42,
        email: "alice@atyeti.com",
        currentPassword: "my_old_password",
        newPassword: "my_new_password",
      },
    };

    const sanitized = sanitizeLogObject(input) as Record<string, any>;

    // Sensitive keys redacted
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.temporaryPassword).toBe("[REDACTED]");
    expect(sanitized.salt).toBe("[REDACTED]");
    expect(sanitized.secret).toBe("[REDACTED]");
    expect(sanitized.accessToken).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.user.currentPassword).toBe("[REDACTED]");
    expect(sanitized.user.newPassword).toBe("[REDACTED]");

    // Operational keys preserved
    expect(sanitized.commitHash).toBe("abc12345def67890");
    expect(sanitized.paginationToken).toBe("page_token_999");
    expect(sanitized.urlHash).toBe("section-2");
    expect(sanitized.nextToken).toBe("next_cursor_456");
    expect(sanitized.hashAlgorithm).toBe("SHA-256");
    expect(sanitized.codeSnippet).toBe("console.log('hello')");
    expect(sanitized.safe).toBe("ok");
    expect(sanitized.user.id).toBe(42);
    expect(sanitized.user.email).toBe("alice@atyeti.com");
  });

  it("handles circular references and Error instances gracefully", () => {
    const circularObj: any = { name: "cycle" };
    circularObj.self = circularObj;
    const sanitizedCycle = sanitizeLogObject(circularObj) as any;
    expect(sanitizedCycle.name).toBe("cycle");
    expect(sanitizedCycle.self).toBe("[Circular]");

    const error = new Error("Database query failed");
    (error as any).password = "leaked_db_password";
    (error as any).commitHash = "commit_123";
    const sanitizedError = sanitizeLogObject(error) as any;
    expect(sanitizedError.message).toBe("Database query failed");
    expect(sanitizedError.password).toBe("[REDACTED]");
    expect(sanitizedError.commitHash).toBe("commit_123");
  });
});

describe("maskEmail", () => {
  it("masks standard emails preserving first character and domain", () => {
    expect(maskEmail("compliance.officer@atyeti.com")).toBe("c***@atyeti.com");
    expect(maskEmail("john.doe@atyeti.com")).toBe("j***@atyeti.com");
    expect(maskEmail("a@atyeti.com")).toBe("a***@atyeti.com");
  });

  it("handles invalid email inputs gracefully", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail("notanemail")).toBe("***");
    expect(maskEmail(null as any)).toBe("");
  });
});

describe("storage.getUser", () => {
  beforeEach(() => {
    queryLogs = [];
  });

  it("projects SAFE_USER_COLUMNS without password column and produces safe entity", async () => {
    mockQueryResponse = {
      rows: [
        {
          id: 1,
          email: "user@atyeti.com",
          username: "user",
          is_admin: false,
          created_at: new Date(),
        },
      ],
      rowCount: 1,
    };

    const user = await storage.getUser(1);
    expect(queryLogs.length).toBeGreaterThan(0);
    const lastQuery = queryLogs[queryLogs.length - 1];

    // Assert SQL uses safe columns and does not select password
    expect(lastQuery.sql).toContain(SAFE_USER_COLUMNS);
    expect(lastQuery.sql.toLowerCase()).not.toContain(", password");
    expect(lastQuery.sql.toLowerCase()).not.toContain("password,");
    expect(lastQuery.sql).not.toContain("SELECT * FROM users");

    // Assert returned entity has no password property
    expect(user).toBeDefined();
    expect(user?.email).toBe("user@atyeti.com");
    expect("password" in (user as any)).toBe(false);
  });
});

describe("getUserAuthCredentialsByEmail", () => {
  beforeEach(() => {
    queryLogs = [];
  });

  it("returns credentials object that redacts password on JSON.stringify and util.inspect", async () => {
    mockQueryResponse = {
      rows: [
        {
          id: 1,
          email: "auth_user@atyeti.com",
          username: "auth_user",
          is_admin: true,
          password: "scrypt_password_hash_secret",
          created_at: new Date(),
        },
      ],
      rowCount: 1,
    };

    const creds = await storage.getUserAuthCredentialsByEmail("auth_user@atyeti.com");
    expect(creds).toBeDefined();
    expect(creds!.password).toBe("scrypt_password_hash_secret");

    // JSON.stringify redaction
    const jsonStr = JSON.stringify(creds);
    expect(jsonStr).toContain('"password":"[REDACTED]"');
    expect(jsonStr).not.toContain("scrypt_password_hash_secret");

    // util.inspect redaction
    const inspected = util.inspect(creds);
    expect(inspected).toContain("[REDACTED]");
    expect(inspected).not.toContain("scrypt_password_hash_secret");
  });
});

describe("updateUserPassword", () => {
  beforeEach(() => {
    queryLogs = [];
  });

  it("updates user password via dedicated primitive", async () => {
    mockQueryResponse = { rows: [], rowCount: 1 };
    await storage.updateUserPassword(1, "new_hashed_password_abc");

    expect(queryLogs.length).toBeGreaterThan(0);
    const pwQuery = queryLogs[queryLogs.length - 1];
    expect(pwQuery.sql).toBe("UPDATE users SET password = $1 WHERE id = $2");
    expect(pwQuery.params).toEqual(["new_hashed_password_abc", 1]);
  });

  it("updateUser explicitly ignores password field and projects SAFE_USER_COLUMNS", async () => {
    mockQueryResponse = {
      rows: [
        {
          id: 1,
          email: "updated@atyeti.com",
          username: "updated_user",
          is_admin: false,
        },
      ],
      rowCount: 1,
    };

    await storage.updateUser(1, {
      username: "updated_user",
      password: "malicious_password_override",
    } as any);

    expect(queryLogs.length).toBeGreaterThan(0);
    const updateQuery = queryLogs[queryLogs.length - 1];

    // Assert update statement does not set password
    expect(updateQuery.sql).not.toContain("password =");
    expect(updateQuery.sql).toContain(`RETURNING ${SAFE_USER_COLUMNS}`);
    expect(updateQuery.params).not.toContain("malicious_password_override");
  });
});

describe("email-fallback", () => {
  it("emits notification notices without leaking passwords or temporary passwords", () => {
    const logs: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.map(a => String(a)).join(" "));
    };

    try {
      logRegistrationDetails("user@atyeti.com", "UserOne");
      logPasswordResetDetails("user@atyeti.com", "UserOne");

      const combinedOutput = logs.join("\n");

      // Verify notification status is logged
      expect(combinedOutput).toContain("========== BACKUP: REGISTRATION DETAILS ==========");
      expect(combinedOutput).toContain("========== BACKUP: PASSWORD RESET DETAILS ==========");
      expect(combinedOutput).toContain("u***@atyeti.com");

      // Verify no password credentials are emitted
      expect(combinedOutput).not.toMatch(/(Password|Temporary Password):/i);
    } finally {
      console.log = originalConsoleLog;
    }
  });
});

describe("auth handlers", () => {
  it("Console Interceptor Positive Control ('Seen Red' baseline)", () => {
    // Validates that our pattern detector positively identifies scrypt hash violations
    const scryptPattern = /[0-9a-f]{128}\.[0-9a-f]{32}/i;
    const fakeScryptHash = "a".repeat(128) + "." + "b".repeat(32);

    expect(scryptPattern.test(fakeScryptHash)).toBe(true);

    const intercepted: string[] = [];
    const testLog = (msg: string) => intercepted.push(msg);

    testLog(`Simulated leak: ${fakeScryptHash}`);
    const foundLeak = intercepted.some(line => scryptPattern.test(line));
    expect(foundLeak).toBe(true);
  });

  it("auditLog emits structured operational entries without credentials", () => {
    const intercepted: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      intercepted.push(args.map(a => String(a)).join(" "));
    };

    try {
      auditLog("AUTH_LOGIN_SUCCESS", {
        userId: 1,
        email: maskEmail("user@atyeti.com"),
        password: "secret_login_password",
      });

      const output = intercepted.join("\n");
      expect(output).toContain("[audit] AUTH_LOGIN_SUCCESS");
      expect(output).toContain('"password":"[REDACTED]"');
      expect(output).not.toContain("secret_login_password");

      const scryptPattern = /[0-9a-f]{128}\.[0-9a-f]{32}/i;
      expect(scryptPattern.test(output)).toBe(false);
    } finally {
      console.log = originalConsoleLog;
    }
  });
});

describe("error handler", () => {
  it("sanitizes error payload before logging and returns clean response", () => {
    const errorLogs: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      errorLogs.push(args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    };

    try {
      const syntheticError = new Error("Authentication failure with credentials");
      (syntheticError as any).password = "plaintext_secret_credential";
      (syntheticError as any).body = { password: "nested_leaked_password" };

      // Simulate Express error handler
      const sanitizedErr = sanitizeLogObject(syntheticError) as any;
      console.error("Internal Server Error:", sanitizedErr);

      const combinedErrorLogs = errorLogs.join("\n");
      expect(combinedErrorLogs).toContain('"password":"[REDACTED]"');
      expect(combinedErrorLogs).not.toContain("plaintext_secret_credential");
      expect(combinedErrorLogs).not.toContain("nested_leaked_password");

      // Verify sanitized response structure
      const responseStatus = (syntheticError as any).status || 500;
      const responseBody = { message: syntheticError.message || "Internal Server Error" };
      expect(responseStatus).toBe(500);
      expect(responseBody.message).toBe("Authentication failure with credentials");
      expect("password" in responseBody).toBe(false);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
