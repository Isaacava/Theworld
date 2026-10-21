"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Flag, RefreshCw, ShieldCheck, X } from "lucide-react";

type ReportStatus = "open" | "reviewed" | "dismissed" | "all";
type ModerationReport = {
  id: string;
  targetType: "post" | "reply";
  targetId: string;
  reporterUsername: string;
  targetAuthorUsername: string;
  targetBody: string;
  placeName: string;
  reason: string;
  details: string;
  status: Exclude<ReportStatus, "all">;
  createdAt: string;
  moderatedAt: string | null;
  moderatorUsername: string | null;
};
const reasonLabels: Record<string, string> = {
  spam: "Spam or repetitive promotion",
  harassment: "Harassment or hateful content",
  misinformation: "Misleading or false information",
  unsafe: "Unsafe or threatening content",
  privacy: "Personal information or privacy concern",
  other: "Something else",
};
function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function ModerationPage() {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeReportId, setActiveReportId] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/moderation/reports?status=${status}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The moderation queue is unavailable.");
        setReports(Array.isArray(payload.reports) ? payload.reports as ModerationReport[] : []);
        setOpenCount(typeof payload.openCount === "number" ? payload.openCount : 0);
        setTotalCount(typeof payload.totalCount === "number" ? payload.totalCount : 0);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setReports([]);
          setError(reason instanceof Error ? reason.message : "The moderation queue is unavailable.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, refreshVersion]);

  async function updateReport(reportId: string, nextStatus: "reviewed" | "dismissed") {
    if (activeReportId) return;
    setActiveReportId(reportId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/moderation/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "This report could not be updated.");
        return;
      }
      setNotice(nextStatus === "reviewed" ? "Report marked as reviewed." : "Report dismissed.");
      setRefreshVersion((value) => value + 1);
    } catch {
      setError("The moderation service couldn't be reached. Please try again.");
    } finally {
      setActiveReportId("");
    }
  }

  return (
    <main className="moderation-page">
      <nav className="profile-page-nav" aria-label="Main navigation">
        <Link className="profile-page-brand" href="/">
          <span className="profile-page-brand-mark">W</span>
          <span><strong>THE WORLD</strong><small>Moderation workspace</small></span>
        </Link>
        <Link className="profile-back-link" href="/"><ArrowLeft size={15} /> Back to explore</Link>
      </nav>

      <div className="moderation-content">
        <header className="moderation-heading">
          <div>
            <span className="profile-overline">COMMUNITY SAFETY</span>
            <h1>Report review</h1>
            <p>Review reports carefully. Marking a report reviewed or dismissed does not automatically remove the reported content.</p>
          </div>
          <button className="moderation-refresh" type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading}>
            <RefreshCw size={14} /> Refresh queue
          </button>
        </header>

        <section className="moderation-summary" aria-label="Report totals">
          <div><span>Open reports</span><strong>{openCount}</strong></div>
          <div><span>Reports stored</span><strong>{totalCount}</strong></div>
          <div><span>Current view</span><strong>{status === "all" ? "All" : status[0].toUpperCase() + status.slice(1)}</strong></div>
        </section>

        <div className="moderation-toolbar">
          <label htmlFor="moderation-status">Show reports</label>
          <select id="moderation-status" value={status} onChange={(event) => setStatus(event.target.value as ReportStatus)}>
            <option value="open">Needs review</option>
            <option value="reviewed">Reviewed</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All reports</option>
          </select>
        </div>
        {notice && <div className="moderation-notice" role="status"><Check size={15} /> {notice}</div>}
        {error && <div className="moderation-error" role="alert"><CircleAlert size={15} /> {error}</div>}

        {loading ? (
          <div className="moderation-empty" role="status"><span className="profile-loading-mark" /><strong>Loading reports</strong><p>Checking the moderation queue.</p></div>
        ) : reports.length === 0 ? (
          <div className="moderation-empty">
            <ShieldCheck size={25} />
            <strong>{status === "open" ? "No reports waiting for review" : "No reports in this view"}</strong>
            <p>{status === "open" ? "New community reports will appear here." : "Choose another filter to see reports in a different state."}</p>
          </div>
        ) : (
          <div className="moderation-list">
            {reports.map((report) => (
              <article className="moderation-report-card" key={report.id}>
                <div className="moderation-report-top">
                  <span className={`moderation-status status-${report.status}`}>{report.status}</span>
                  <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
                </div>
                <div className="moderation-report-reason">
                  <span className="moderation-report-icon"><Flag size={16} /></span>
                  <div><span>{report.targetType === "post" ? "Post report" : "Reply report"}</span><h2>{reasonLabels[report.reason] || "Other concern"}</h2></div>
                </div>
                <blockquote className="moderation-target-content">{report.targetBody || "No content snapshot available."}</blockquote>
                <div className="moderation-report-metadata">
                  <span>Reported by <strong>@{report.reporterUsername}</strong></span>
                  <span>Author <strong>@{report.targetAuthorUsername}</strong></span>
                  {report.placeName && <span>Place <strong>{report.placeName}</strong></span>}
                </div>
                {report.details && <div className="moderation-report-details"><strong>Additional context</strong><p>{report.details}</p></div>}
                {report.status === "open" ? (
                  <div className="moderation-actions">
                    <button type="button" className="moderation-action review" onClick={() => void updateReport(report.id, "reviewed")} disabled={Boolean(activeReportId)}>
                      {activeReportId === report.id ? <span className="mini-spinner" /> : <Check size={14} />} Mark reviewed
                    </button>
                    <button type="button" className="moderation-action dismiss" onClick={() => void updateReport(report.id, "dismissed")} disabled={Boolean(activeReportId)}>
                      <X size={14} /> Dismiss
                    </button>
                  </div>
                ) : (
                  <p className="moderation-reviewed-note">
                    {report.status === "reviewed" ? "Reviewed" : "Dismissed"}
                    {report.moderatorUsername ? ` by @${report.moderatorUsername}` : ""}
                    {report.moderatedAt ? ` · ${formatDate(report.moderatedAt)}` : ""}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
