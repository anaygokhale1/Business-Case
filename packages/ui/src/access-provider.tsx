"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

import { DemoUser, demoUsers } from "@ssa/project-context/access-model";

type AccessContextValue = {
  currentUser: DemoUser;
  setCurrentUserId: (id: string) => void;
  isInternal: boolean;
  canAdmin: boolean;
  canLeadership: boolean;
  adminEmails: string[];
  leadershipEmails: string[];
  pendingExternalUsers: Array<{ email: string; name: string }>;
  addAdminEmail: (email: string, name?: string) => Promise<boolean>;
  removeAdminEmail: (email: string) => Promise<boolean>;
  addLeadershipEmail: (email: string, name?: string) => Promise<boolean>;
  removeLeadershipEmail: (email: string) => Promise<boolean>;
  approveExternalUser: (email: string) => Promise<boolean>;
  rejectExternalUser: (email: string) => Promise<boolean>;
};

const AccessContext = createContext<AccessContextValue | null>(null);

const FALLBACK_USER = demoUsers[0];

type PrivilegePayload = {
  adminEmails: string[];
  leadershipEmails: string[];
  pendingExternalUsers?: Array<{ email: string; name: string }>;
};

export function AccessProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<DemoUser>(FALLBACK_USER);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [leadershipEmails, setLeadershipEmails] = useState<string[]>([]);
  const [pendingExternalUsers, setPendingExternalUsers] = useState<Array<{ email: string; name: string }>>([]);

  const applyPrivilegePayload = (payload: PrivilegePayload) => {
    setAdminEmails(payload.adminEmails.map((item) => item.toLowerCase()));
    setLeadershipEmails(payload.leadershipEmails.map((item) => item.toLowerCase()));
    setPendingExternalUsers(payload.pendingExternalUsers ?? []);
  };

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/auth/current-user", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const user = (await response.json()) as DemoUser;
        if (cancelled) {
          return;
        }

        setCurrentUser(user);
        if (user.isAdmin) {
          const privilegesResponse = await fetch("/api/admin/users", { cache: "no-store" });
          if (privilegesResponse.ok) {
            const privileges = (await privilegesResponse.json()) as PrivilegePayload;
            applyPrivilegePayload(privileges);
            return;
          }
        }

        setAdminEmails(user.isAdmin ? [user.email.toLowerCase()] : []);
        setLeadershipEmails(user.isLeadership ? [user.email.toLowerCase()] : []);
      } catch {
        // The server layout redirects unauthenticated users; keep the fallback
        // only to avoid crashing while that redirect is in flight.
      }
    }

    loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => {
    const emailLower = currentUser.email.toLowerCase();
    const canAdmin = currentUser.isAdmin || adminEmails.includes(emailLower);
    const canLeadership = canAdmin || currentUser.isLeadership || leadershipEmails.includes(emailLower);

    return {
      currentUser,
      setCurrentUserId: () => {},
      isInternal: currentUser.isInternal,
      canAdmin,
      canLeadership,
      adminEmails,
      leadershipEmails,
      pendingExternalUsers,
      addAdminEmail: async (email: string, name?: string) => {
        const lower = email.toLowerCase();
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: lower, isAdmin: true, ...(name ? { name } : {}) }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as PrivilegePayload;
        applyPrivilegePayload(payload);
        return true;
      },
      removeAdminEmail: async (email: string) => {
        const lower = email.toLowerCase();
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: lower, isAdmin: false }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as PrivilegePayload;
        applyPrivilegePayload(payload);
        return true;
      },
      addLeadershipEmail: async (email: string, name?: string) => {
        const lower = email.toLowerCase();
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: lower, isLeadership: true, ...(name ? { name } : {}) }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as PrivilegePayload;
        applyPrivilegePayload(payload);
        return true;
      },
      removeLeadershipEmail: async (email: string) => {
        const lower = email.toLowerCase();
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: lower, isLeadership: false }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as PrivilegePayload;
        applyPrivilegePayload(payload);
        return true;
      },
      approveExternalUser: async (email: string) => {
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.toLowerCase(), status: "ACTIVE" }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as PrivilegePayload;
        applyPrivilegePayload(payload);
        return true;
      },
      rejectExternalUser: async (email: string) => {
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.toLowerCase(), status: "DISABLED" }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as PrivilegePayload;
        applyPrivilegePayload(payload);
        return true;
      },
    };
  }, [adminEmails, currentUser, leadershipEmails, pendingExternalUsers]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error("useAccess must be used within AccessProvider.");
  }
  return context;
}
