"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Building2, Check, ExternalLink, MessageSquareWarning, RefreshCw, ShieldCheck, X } from "lucide-react";

type PendingBusiness = {
  id: string; osmPlaceKey: string; name: string; category: string; address: string; status: string;
  claimedBy: string; proofUrl: string; verificationNote: string; createdAt: string;
};
type DisputedReview = {
  id: string; businessId: string; businessName: string; rating: number; body: string;
  authorUsername: string; disputeReason: string; disputedAt: string;
};

export default function BusinessModerationPage() {
  const [businesses, setBusinesses] = useState<PendingBusiness[]>([]);
  const [reviews, setReviews] = useState<DisputedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/moderation/businesses", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The verification queue is unavailable.");
      setBusinesses(Array.isArray(payload.businesses) ? payload.businesses : []);
      setReviews(Array.isArray(payload.disputedReviews) ? payload.disputedReviews : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The verification queue is unavailable.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: string, target: "business" | "review") {
    const key = `${target}:${id}`;
    if ((action === "reject_business" || action === "remove_review") && (notes[key] || "").trim().length < 8) {
      setError("Add a moderation reason of at least 8 characters before rejecting or removing content.");
      return;
    }
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/moderation/businesses", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, note: notes[key] || "" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The decision could not be saved.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be saved.");
    } finally { setBusy(""); }
  }

  return (
    <main className="moderation-page business-moderation-page">
      <nav className="profile-page-nav" aria-label="Moderation navigation">
        <Link className="profile-page-brand" href="/"><span className="profile-page-brand-mark">W</span><span><strong>THE WORLD</strong><small>Business trust & safety</small></span></Link>
        <div className="moderation-page-actions">
          <Link className="outline-button" href="/moderation">Content reports</Link>
          <button className="outline-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
        </div>
      </nav>
      <div className="moderation-page-content">
        <span className="eyebrow">TRUST & SAFETY</span>
        <h1>Business verification</h1>
        <p className="moderation-intro">Review listing evidence before granting a verified badge. Disputed reviews are hidden from public ratings until a moderator restores or removes them.</p>
        {error && <div className="moderation-alert" role="alert">{error}</div>}
        <div className="moderation-queue-summary">
          <div><Building2 size={18} /><strong>{businesses.length}</strong><span>Listings awaiting verification</span></div>
          <div><MessageSquareWarning size={18} /><strong>{reviews.length}</strong><span>Disputed reviews</span></div>
        </div>
        <section className="business-moderation-section">
          <div className="moderation-section-heading"><div><h2>Business listing requests</h2><p>Check the public proof link and claimant details before approving.</p></div></div>
          {loading ? <p className="moderation-muted">Loading verification queue…</p> : businesses.length === 0 ? <div className="moderation-empty-state"><ShieldCheck size={20} /><strong>No pending business listings</strong><p>New requests will appear here.</p></div> : businesses.map((item) => (
            <article className="business-moderation-card" key={item.id}>
              <div className="business-moderation-card-title"><span className="business-directory-icon"><Building2 size={18} /></span><div><h3>{item.name}</h3><p>{item.category} · requested by @{item.claimedBy}</p></div></div>
              <p className="business-moderation-address">{item.address}</p>
              {item.verificationNote && <p className="business-moderation-note">{item.verificationNote}</p>}
              <a className="business-proof-link" href={item.proofUrl} target="_blank" rel="noreferrer noopener">Open submitted proof <ExternalLink size={13} /></a>
              <label className="business-moderation-note-input"><span>Decision note</span><textarea rows={2} value={notes[`business:${item.id}`] || ""} onChange={(e) => setNotes((old) => ({ ...old, [`business:${item.id}`]: e.target.value }))} placeholder="Optional for approval; required for rejection." /></label>
              <div className="business-moderation-actions">
                <button type="button" className="primary-action" disabled={Boolean(busy)} onClick={() => void act(item.id, "verify_business", "business")}>{busy === `business:${item.id}` ? "Saving…" : <><BadgeCheck size={15} /> Verify business</>}</button>
                <button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => void act(item.id, "reject_business", "business")}><X size={15} /> Reject</button>
              </div>
            </article>
          ))}
        </section>
        <section className="business-moderation-section">
          <div className="moderation-section-heading"><div><h2>Disputed reviews</h2><p>Disputes are a request for review, not proof that a review is fake.</p></div></div>
          {loading ? <p className="moderation-muted">Loading disputed reviews…</p> : reviews.length === 0 ? <div className="moderation-empty-state"><ShieldCheck size={20} /><strong>No disputed reviews</strong><p>Disputes will appear here for review.</p></div> : reviews.map((item) => (
            <article className="business-moderation-card" key={item.id}>
              <div className="business-moderation-card-title"><span className="business-directory-icon"><MessageSquareWarning size={18} /></span><div><h3>{item.businessName}</h3><p>{item.rating}/5 · review by @{item.authorUsername}</p></div></div>
              <blockquote>{item.body}</blockquote>
              <p className="business-dispute-reason"><strong>Owner's dispute:</strong> {item.disputeReason}</p>
              <label className="business-moderation-note-input"><span>Decision note</span><textarea rows={2} value={notes[`review:${item.id}`] || ""} onChange={(e) => setNotes((old) => ({ ...old, [`review:${item.id}`]: e.target.value }))} placeholder="Optional for restoring; required for removal." /></label>
              <div className="business-moderation-actions">
                <button type="button" className="primary-action" disabled={Boolean(busy)} onClick={() => void act(item.id, "publish_review", "review")}><Check size={15} /> Restore review</button>
                <button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => void act(item.id, "remove_review", "review")}><X size={15} /> Remove review</button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
