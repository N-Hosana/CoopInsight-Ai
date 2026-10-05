/**
 * Activities as a calendar file (.ics, RFC 5545) that Google Calendar, Outlook
 * and phone calendars all import. This is what "Export" means on the activity
 * pages; written reports live on the Reports page.
 */

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD or an ISO timestamp
  startTime?: string | null; // HH:MM[:SS]
  endTime?: string | null;
  location?: string | null;
  description?: string | null;
  status?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Text values escape commas, semicolons, backslashes and newlines. */
const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded, as the format requires. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
};

const ymd = (date: string) => date.slice(0, 10).replace(/-/g, "");
const hms = (time: string) => time.replace(/:/g, "").padEnd(6, "0").slice(0, 6);

function nextDay(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function buildIcs(events: CalendarEvent[], calendarName = "CoopInsight activities"): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CoopInsight AI//Activities//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(calendarName)}`,
    // Rwanda keeps one time zone all year, UTC+2 with no daylight saving.
    "X-WR-TIMEZONE:Africa/Kigali",
  ];
  for (const e of events) {
    if (!e.date) continue;
    lines.push("BEGIN:VEVENT", `UID:${e.id}@coopinsight`, `DTSTAMP:${stamp}`);
    if (e.startTime) {
      lines.push(`DTSTART;TZID=Africa/Kigali:${ymd(e.date)}T${hms(e.startTime)}`);
      lines.push(`DTEND;TZID=Africa/Kigali:${ymd(e.date)}T${hms(e.endTime || e.startTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    if (e.status === "cancelled") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(events: CalendarEvent[], filename: string, calendarName?: string) {
  const blob = new Blob([buildIcs(events, calendarName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
