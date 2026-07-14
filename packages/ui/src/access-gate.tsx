"use client";

import { ReactNode } from "react";

import { useAccess } from "./access-provider";

type AccessGateProps = {
  area: "admin" | "leadership";
  children: ReactNode;
};

export function AccessGate({ area, children }: AccessGateProps) {
  const { canAdmin, canLeadership, currentUser } = useAccess();

  const allowed = area === "admin" ? canAdmin : canLeadership;

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <section className="rounded-[28px] border border-slate-200/70 bg-white p-8 shadow-ambient">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-outline">
        Access Restricted
      </p>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink">
        {area === "admin" ? "Admin access required" : "Leadership or admin access required"}
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
        The current demo user is <strong className="text-slate-900">{currentUser.name}</strong>.
        {area === "admin"
          ? " This section is only enabled for users with the admin designation."
          : " This section is only enabled for users with either leadership or admin designation."}
      </p>
      <p className="mt-3 text-sm leading-7 text-muted">
        Use the profile selector in the lower-left sidebar to switch to a user with the required
        privilege access and refresh this page state instantly.
      </p>
    </section>
  );
}
