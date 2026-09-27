import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { apiRequest } from "@/lib/query-client";

export interface AdminEventInfo {
  id: string;
  name: string;
  year: number;
  status: string;
  deleted?: boolean;
  createdAt?: string;
}

interface AdminEventContextType {
  adminEventId: string | null;
  adminEventName: string;
  adminEventYear: number | null;
  adminEventStatus: string;
  allEvents: AdminEventInfo[];
  auditEvents: AdminEventInfo[];
  isLoadingEvents: boolean;
  setAdminEvent: (event: AdminEventInfo) => void;
  refreshEvents: () => Promise<void>;
}

const AdminEventContext = createContext<AdminEventContextType>({
  adminEventId: null,
  adminEventName: "",
  adminEventYear: null,
  adminEventStatus: "",
  allEvents: [],
  auditEvents: [],
  isLoadingEvents: true,
  setAdminEvent: () => {},
  refreshEvents: async () => {},
});

export function AdminEventProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [adminEventId, setAdminEventId] = useState<string | null>(null);
  const [adminEventName, setAdminEventName] = useState<string>("");
  const [adminEventYear, setAdminEventYear] = useState<number | null>(null);
  const [adminEventStatus, setAdminEventStatus] = useState<string>("");
  const [allEvents, setAllEvents] = useState<AdminEventInfo[]>([]);
  const [auditEvents, setAuditEvents] = useState<AdminEventInfo[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      const [eventsResponse, auditEventsResponse] = await Promise.all([
        apiRequest("/api/admin/events"),
        apiRequest("/api/admin/audit-events"),
      ]);
      const data: AdminEventInfo[] = await eventsResponse.json();
      const auditData: AdminEventInfo[] = await auditEventsResponse.json();
      setAllEvents(data);
      setAuditEvents(auditData);

      if (adminEventId === null) {
        // Do not select an event implicitly. Admins must explicitly choose the
        // event they want to manage so mutations can never target an
        // unintended event.
      } else {
        const current = data.find((e) => e.id === adminEventId);
        if (current) {
          setAdminEventName(current.name);
          setAdminEventYear(current.year);
          setAdminEventStatus(current.status);
        } else {
          // Never leave a deleted or otherwise stale event ID active. Select a
          // valid event from the refreshed server list so event-owned screens
          // cannot keep reading or writing against an obsolete context.
          setAdminEventId(null);
          setAdminEventName("");
          setAdminEventYear(null);
          setAdminEventStatus("");
        }
      }
    } catch {
      // non-admin users won't be able to fetch this — fail silently
    } finally {
      setIsLoadingEvents(false);
    }
  }, [adminEventId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const setAdminEvent = useCallback((event: AdminEventInfo) => {
    setAdminEventId(event.id);
    setAdminEventName(event.name);
    setAdminEventYear(event.year);
    setAdminEventStatus(event.status);
  }, []);

  return (
    <AdminEventContext.Provider
      value={{
        adminEventId,
        adminEventName,
        adminEventYear,
        adminEventStatus,
        allEvents,
        auditEvents,
        isLoadingEvents,
        setAdminEvent,
        refreshEvents: fetchEvents,
      }}
    >
      {children}
    </AdminEventContext.Provider>
  );
}

export function useAdminEvent(): AdminEventContextType {
  return useContext(AdminEventContext);
}

export function useAdminEventId(): string | null {
  return useContext(AdminEventContext).adminEventId;
}
