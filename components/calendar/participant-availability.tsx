"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "@/components/icons";
import { useAuthStore } from "@/stores/auth-store";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { BusyPeriod, Principal } from "@/lib/jmap/types";
import { jmapErrorType } from "@/lib/jmap/jmap-error";
import { loadPrincipalDirectory } from "@/lib/jmap/principal-directory";
import { checkAvailabilityAccess, knownAvailabilityAccess, revokeAvailabilityAccess } from "@/lib/jmap/free-busy";
import { cn } from "@/lib/utils";

interface Attendee {
  name: string;
  email: string;
}

/**
 * `unknown`: the address is not a user in a complete directory listing.
 * `error`: the lookup failed or was rate-limited, so nothing is known.
 */
export type AvailabilityStatus = "free" | "busy" | "tentative" | "unknown" | "error" | "checking";

interface ParticipantAvailabilityProps {
  attendees: Attendee[];
  /** The event window; null while the form has no valid dates. */
  start: Date | null;
  end: Date | null;
}

/**
 * The status of one attendee for the window, given their busy periods:
 * any confirmed/unavailable overlap wins over a tentative one.
 */
export function availabilityFor(periods: BusyPeriod[], start: Date, end: Date): Exclude<AvailabilityStatus, "unknown" | "error" | "checking"> {
  let status: "free" | "busy" | "tentative" = "free";
  for (const p of periods) {
    const pStart = new Date(p.utcStart).getTime();
    const pEnd = new Date(p.utcEnd).getTime();
    if (pStart < end.getTime() && pEnd > start.getTime()) {
      if (p.busyStatus === "tentative") {
        if (status === "free") status = "tentative";
      } else {
        return "busy";
      }
    }
  }
  return status;
}

/**
 * The status of every address for the window, or null when the server won't
 * answer free/busy for this user: it refused the directory listing or a
 * lookup with `forbidden`.
 */
async function lookUpStatuses(
  client: IJMAPClient,
  emails: string[],
  start: Date,
  end: Date,
): Promise<Record<string, AvailabilityStatus> | null> {
  const directory = await loadPrincipalDirectory(client);
  if (directory.status === "restricted") return null;
  const byEmail = new Map<string, Principal>();
  for (const p of directory.principals) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
  }
  let refused = false;
  const results = await Promise.all(
    emails.map(async (email): Promise<[string, AvailabilityStatus]> => {
      const principal = byEmail.get(email);
      // Only a complete listing shows that an address is not a user here.
      if (!principal) return [email, directory.status === "ok" ? "unknown" : "error"];
      try {
        const periods = await client.getPrincipalAvailability!(principal.id, start, end);
        return [email, availabilityFor(periods, start, end)];
      } catch (err) {
        if (jmapErrorType(err) === "forbidden") refused = true;
        return [email, "error"];
      }
    }),
  );
  return refused ? null : Object.fromEntries(results);
}

/**
 * Free/busy of the invited attendees for the event window
 * (Principal/getAvailability). Only attendees that are principals on this
 * server can be checked; external addresses show as unknown. Nothing is shown
 * when the server won't answer free/busy for this user.
 */
export function ParticipantAvailability({ attendees, start, end }: ParticipantAvailabilityProps) {
  const t = useTranslations("calendar.participants.availability");
  const client = useAuthStore((s) => s.client);
  const supported = !!client?.supportsAvailability?.() && !!client.getPrincipalAvailability;
  const [statuses, setStatuses] = useState<Record<string, AvailabilityStatus>>({});
  const [access, setAccess] = useState<{ client: IJMAPClient; allowed: boolean } | null>(null);
  const requestSeq = useRef(0);

  const emails = useMemo(
    () => Array.from(new Set(attendees.map((a) => a.email.trim().toLowerCase()).filter(Boolean))),
    [attendees],
  );
  const emailsKey = emails.join(",");
  const startMs = start?.getTime() ?? null;
  const endMs = end?.getTime() ?? null;
  const windowValid = startMs !== null && endMs !== null && endMs > startMs;
  const wanted = !!client && supported && emails.length > 0 && windowValid;
  // Undefined until the server has said whether it answers free/busy for
  // this user; the block stays hidden until then, so a server that refuses
  // never flashes a list of attendees being checked.
  const allowed = !client ? undefined : access?.client === client ? access.allowed : knownAvailabilityAccess(client);

  useEffect(() => {
    if (!wanted || allowed !== undefined) return;
    let cancelled = false;
    void checkAvailabilityAccess(client!).then((ok) => {
      if (!cancelled) setAccess({ client: client!, allowed: ok });
    });
    return () => { cancelled = true; };
  }, [client, wanted, allowed]);

  useEffect(() => {
    if (!wanted || allowed !== true) {
      setStatuses({});
      return;
    }
    const seq = ++requestSeq.current;
    setStatuses(Object.fromEntries(emails.map((e) => [e, "checking" as const])));
    // Debounce: typing a time or adding several people must not fire a
    // query per keystroke.
    const timer = setTimeout(async () => {
      const windowStart = new Date(startMs!);
      const windowEnd = new Date(endMs!);
      const results = await lookUpStatuses(client!, emails, windowStart, windowEnd);
      if (seq !== requestSeq.current) return;
      if (results === null) {
        revokeAvailabilityAccess(client!);
        setAccess({ client: client!, allowed: false });
        return;
      }
      setStatuses(results);
    }, 400);
    return () => clearTimeout(timer);
    // emailsKey stands in for the emails array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, wanted, allowed, emailsKey, startMs, endMs]);

  if (!wanted || allowed !== true) return null;

  return (
    <ul className="mt-1.5 space-y-0.5" aria-label={t("title")} data-testid="participant-availability">
      {attendees.map((a) => {
        const status = statuses[a.email.trim().toLowerCase()] ?? "checking";
        return (
          <li key={a.email} className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                status === "free" && "bg-emerald-500",
                status === "busy" && "bg-red-500",
                status === "tentative" && "bg-amber-500",
                (status === "unknown" || status === "error" || status === "checking") && "bg-muted-foreground/40",
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate text-foreground/90">{a.name || a.email}</span>
            <span className="ms-auto flex shrink-0 items-center gap-1 text-muted-foreground">
              {status === "checking" && <Loader2 className="h-3 w-3 animate-spin" />}
              {t(status)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
