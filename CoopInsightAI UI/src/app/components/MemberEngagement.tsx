import { useEffect, useState } from "react";
import { api } from "../services/api";

/**
 * Member engagement for one cooperative: how often each member turns up, and
 * how regularly they pay in. Two measures and the score made from them.
 * Training is not scored separately; a training is an activity and is already
 * counted in attendance.
 */

interface Entry {
  memberId: string;
  memberName: string;
  activityFrequency: number;
  contributionConsistency: number;
  overallScore: number;
  band: "high" | "moderate" | "at_risk";
}

const BAND: Record<Entry["band"], { label: string; badge: string }> = {
  high: { label: "Engaged", badge: "bg-green-100 text-green-800" },
  moderate: { label: "Moderate", badge: "bg-amber-100 text-amber-800" },
  at_risk: { label: "Drifting away", badge: "bg-red-100 text-red-700" },
};

function Bar({ value, colour }: { value: number; colour: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 rounded-full bg-gray-200">
        <div className={`h-2 rounded-full ${colour}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="tabular-nums text-gray-700">{Math.round(value)}</span>
    </div>
  );
}

export function MemberEngagement({ cooperativeId }: { cooperativeId?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    setShowAll(false);
    api
      .get<{ data: { engagement?: Entry[]; note?: string | null; reachable?: boolean } }>(
        `/ai/member-engagement${cooperativeId ? `?cooperativeId=${cooperativeId}` : ""}`
      )
      .then((res) => {
        setEntries(res.data?.engagement ?? []);
        setNote(
          res.data?.reachable === false
            ? "The analysis service is not running, so engagement cannot be worked out right now."
            : res.data?.note ?? null
        );
      })
      .catch((err: any) => {
        setEntries([]);
        setNote(err?.message ?? "Member engagement could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [cooperativeId]);

  if (loading) return <p className="text-sm text-gray-500">Working out member engagement…</p>;

  const count = (band: Entry["band"]) => entries.filter((e) => e.band === band).length;
  // Lowest first: the members to speak to are the point of the list.
  const ordered = [...entries].sort((a, b) => a.overallScore - b.overallScore);
  const shown = showAll ? ordered : ordered.slice(0, 10);

  return (
    <div className="space-y-4">
      {note && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
      {entries.length === 0 && !note && <p className="text-sm text-gray-500">No members to score yet.</p>}
      {entries.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {(["high", "moderate", "at_risk"] as const).map((band) => (
              <div key={band} className="rounded-lg border border-gray-200 p-3">
                <p className="text-2xl font-bold tabular-nums text-gray-900">{count(band)}</p>
                <p className="text-xs text-gray-600">{BAND[band].label}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Attendance at activities</th>
                  <th className="px-4 py-2.5 font-medium">Regularity of contributions</th>
                  <th className="px-4 py-2.5 font-medium">Engagement</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.memberId} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{e.memberName}</td>
                    <td className="px-4 py-2.5"><Bar value={e.activityFrequency} colour="bg-[#2D6A4F]" /></td>
                    <td className="px-4 py-2.5"><Bar value={e.contributionConsistency} colour="bg-blue-600" /></td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND[e.band].badge}`}>
                        {Math.round(e.overallScore)} · {BAND[e.band].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ordered.length > 10 && (
            <button onClick={() => setShowAll(!showAll)} className="text-sm font-medium text-[#2D6A4F] hover:underline">
              {showAll ? "Show the ten lowest only" : `Show all ${ordered.length} members`}
            </button>
          )}
          <p className="text-xs text-gray-500">
            Each measure is 0-100, set against the most active member of the same cooperative. The engagement score is the
            average of the two. Lowest first, because those are the members to speak to.
          </p>
        </>
      )}
    </div>
  );
}
