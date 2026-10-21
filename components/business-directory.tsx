"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BadgeCheck, Building2, CalendarClock, Check, Clock3, ExternalLink,
  MapPin, MessageCircle, RefreshCw, Send, ShieldCheck, Star, Store, X,
} from "lucide-react";

export type BusinessTagOption = { businessId: string; name: string };

type Place = { id: string; name: string; displayName: string; coordinates: [number, number] };
type User = { id: string; username: string; displayName: string } | null;
type BusinessItem = {
  id: string; osmPlaceKey: string; name: string; category: string; address: string;
  coordinates: [number, number]; status: "nearby" | "pending" | "verified"; isVerified: boolean;
  businessId: string | null; isOwner?: boolean; isListed?: boolean; website?: string;
  phone?: string; openingHours?: string; description?: string;
};
type Review = { id: string; rating: number; body: string; author: { username: string; displayName: string }; createdAt: string; verificationStatus: "verified" | "unverified"; bookingId: string | null };
type Question = { id: string; body: string; author: { username: string; displayName: string }; createdAt: string; answer: string | null; answeredAt: string | null };
type Booking = { id: string; message?: string; requestedFor: string; status: string; customer?: { username: string; displayName: string }; createdAt?: string };
type ListingRequest = { id: string; name: string; status: string };

type Props = {
  place: Place;
  sessionUser: User;
  authConfigured: boolean | null;
  onSignIn: () => void;
  onBusinessesChange: (items: BusinessTagOption[]) => void;
};

function timeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

function Stars({ rating }: { rating: number }) {
  return <span className="business-stars" aria-label={`${rating.toFixed(1)} out of 5 stars`}>{[1,2,3,4,5].map((value) => <Star key={value} size={13} fill={value <= Math.round(rating) ? "currentColor" : "none"} />)}</span>;
}

export default function BusinessDirectory({ place, sessionUser, authConfigured, onSignIn, onBusinessesChange }: Props) {
  const [nearby, setNearby] = useState<BusinessItem[]>([]);
  const [businesses, setBusinesses] = useState<BusinessItem[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<"overview" | "reviews" | "questions" | "booking" | "requests">("overview");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [averageRating, setAverageRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionBody, setQuestionBody] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [bookingDate, setBookingDate] = useState("");
  const [bookingMessage, setBookingMessage] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [claimTarget, setClaimTarget] = useState<BusinessItem | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/businesses?placeKey=${encodeURIComponent(place.id)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The nearby business list couldn't be loaded.");
      const nearbyItems = Array.isArray(payload.nearby) ? payload.nearby as BusinessItem[] : [];
      const listedItems = Array.isArray(payload.businesses) ? (payload.businesses as BusinessItem[]).map((item) => ({
        ...item, status: item.status === "verified" ? "verified" as const : "pending" as const,
        isVerified: item.isVerified === true, businessId: item.id,
      })) : [];
      const all = new Map<string, BusinessItem>();
      for (const item of [...listedItems, ...nearbyItems]) {
        const previous = all.get(item.osmPlaceKey);
        all.set(item.osmPlaceKey, {
          ...previous,
          ...item,
          // Prefer the URL submitted and checked during listing verification.
          website: previous?.website ?? item.website,
          isListed: item.isVerified || item.status === "verified",
        });
      }
      const sorted = [...all.values()].sort((a,b) => Number(b.isVerified) - Number(a.isVerified) || a.name.localeCompare(b.name));
      setNearby(sorted);
      setBusinesses(listedItems.filter((item) => item.isVerified));
      setSourceUnavailable(payload.sourceUnavailable === true);
      onBusinessesChange(sorted.filter((item) => item.isVerified && item.businessId).map((item) => ({ businessId: item.businessId as string, name: item.name })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The nearby business list couldn't be loaded.");
      setNearby([]);
      setBusinesses([]);
      onBusinessesChange([]);
    } finally { setLoading(false); }
  }, [place.id, onBusinessesChange]);

  useEffect(() => { void loadDirectory(); setSelectedId(null); setSection("overview"); }, [loadDirectory]);

  const selected = useMemo(() => nearby.find((item) => item.businessId === selectedId) ?? null, [nearby, selectedId]);

  const loadBusinessDetails = useCallback(async (business: BusinessItem) => {
    if (!business.businessId || !business.isVerified) {
      setReviews([]); setQuestions([]); setBookings([]);
      return;
    }
    const id = business.businessId;
    const [reviewResult, questionResult] = await Promise.all([
      fetch(`/api/businesses/${encodeURIComponent(id)}/reviews`, { cache: "no-store" }),
      fetch(`/api/businesses/${encodeURIComponent(id)}/questions`, { cache: "no-store" }),
    ]);
    const reviewPayload = await reviewResult.json().catch(() => ({}));
    const questionPayload = await questionResult.json().catch(() => ({}));
    if (reviewResult.ok) {
      setReviews(Array.isArray(reviewPayload.reviews) ? reviewPayload.reviews : []);
      setAverageRating(typeof reviewPayload.averageRating === "number" ? reviewPayload.averageRating : 0);
      setReviewCount(typeof reviewPayload.reviewCount === "number" ? reviewPayload.reviewCount : 0);
    } else setFormError(typeof reviewPayload.error === "string" ? reviewPayload.error : "Reviews are unavailable.");
    if (questionResult.ok) setQuestions(Array.isArray(questionPayload.questions) ? questionPayload.questions : []);
    else setFormError(typeof questionPayload.error === "string" ? questionPayload.error : "Business questions are unavailable.");
    if (sessionUser) {
      const bookingResult = await fetch(`/api/businesses/${encodeURIComponent(id)}/bookings`, { cache: "no-store" });
      const bookingPayload = await bookingResult.json().catch(() => ({}));
      setBookings(Array.isArray(bookingPayload.bookings) ? bookingPayload.bookings : []);
    } else setBookings([]);
  }, [sessionUser]);

  useEffect(() => {
    if (!selected) return;
    setFormError("");
    void loadBusinessDetails(selected);
  }, [selected, loadBusinessDetails]);

  async function submitJson(path: string, method: string, body: Record<string, unknown>) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request couldn't be completed.");
    return payload;
  }

  async function requestListing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claimTarget) return;
    if (!sessionUser) { onSignIn(); return; }
    setBusy("claim"); setFormError(""); setNotice("");
    try {
      const result = await submitJson("/api/businesses", "POST", {
        action: "claim", placeKey: place.id, osmPlaceKey: claimTarget.osmPlaceKey,
        proofUrl, verificationNote,
      });
      setNotice(typeof result.message === "string" ? result.message : "Listing request submitted.");
      setClaimTarget(null); setProofUrl(""); setVerificationNote("");
      await loadDirectory();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Listing request failed."); }
    finally { setBusy(""); }
  }

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.businessId) return;
    if (!sessionUser) { onSignIn(); return; }
    setBusy("review"); setFormError(""); setNotice("");
    try {
      const completed = bookings.find((booking) => booking.status === "completed");
      const result = await submitJson(`/api/businesses/${selected.businessId}/reviews`, "POST", {
        rating, body: reviewBody, ...(completed ? { bookingId: completed.id } : {}),
      });
      setReviewBody(""); setRating(5);
      setNotice(typeof result.message === "string" ? result.message : "Review submitted.");
      await loadBusinessDetails(selected);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Review submission failed."); }
    finally { setBusy(""); }
  }

  async function askBusiness(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.businessId) return;
    if (!sessionUser) { onSignIn(); return; }
    setBusy("question"); setFormError(""); setNotice("");
    try {
      await submitJson(`/api/businesses/${selected.businessId}/questions`, "POST", { body: questionBody });
      setQuestionBody(""); setNotice("Your question has been sent to the business.");
      await loadBusinessDetails(selected);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Question submission failed."); }
    finally { setBusy(""); }
  }

  async function answerBusinessQuestion(event: React.FormEvent<HTMLFormElement>, question: Question) {
    event.preventDefault();
    if (!selected?.businessId) return;
    const answer = answerDrafts[question.id] || "";
    setBusy(`answer:${question.id}`); setFormError(""); setNotice("");
    try {
      await submitJson(`/api/businesses/${selected.businessId}/questions/${question.id}`, "PATCH", { answer });
      setAnswerDrafts((old) => ({ ...old, [question.id]: "" }));
      setNotice("Your answer is now visible.");
      await loadBusinessDetails(selected);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Answer submission failed."); }
    finally { setBusy(""); }
  }

  async function requestBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.businessId) return;
    if (!sessionUser) { onSignIn(); return; }
    setBusy("booking"); setFormError(""); setNotice("");
    try {
      const result = await submitJson(`/api/businesses/${selected.businessId}/bookings`, "POST", { requestedFor: new Date(bookingDate).toISOString(), message: bookingMessage });
      setBookingDate(""); setBookingMessage("");
      setNotice(typeof result.message === "string" ? result.message : "Booking request sent.");
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Booking request failed."); }
    finally { setBusy(""); }
  }

  async function updateBooking(booking: Booking, status: string) {
    if (!selected?.businessId) return;
    setBusy(`booking:${booking.id}`); setFormError(""); setNotice("");
    try {
      const result = await submitJson(`/api/businesses/${selected.businessId}/bookings`, "PATCH", { bookingId: booking.id, status });
      setNotice(typeof result.message === "string" ? result.message : "Booking updated.");
      await loadBusinessDetails(selected);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Booking update failed."); }
    finally { setBusy(""); }
  }

  async function disputeReview(event: React.FormEvent<HTMLFormElement>, review: Review) {
    event.preventDefault();
    if (!selected?.businessId) return;
    setBusy(`dispute:${review.id}`); setFormError(""); setNotice("");
    try {
      const result = await submitJson(`/api/businesses/${selected.businessId}/reviews/${review.id}/dispute`, "POST", { reason: disputeReason });
      setNotice(typeof result.message === "string" ? result.message : "Dispute sent for review.");
      setDisputeTarget(null); setDisputeReason("");
      await loadBusinessDetails(selected);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "The dispute could not be submitted."); }
    finally { setBusy(""); }
  }

  if (selected) {
    return (
      <section className="business-directory" aria-label={`Business details for ${selected.name}`}>
        <button className="business-back-button" type="button" onClick={() => { setSelectedId(null); setSection("overview"); setFormError(""); setNotice(""); }}>
          <ArrowLeft size={15} /> All nearby businesses
        </button>
        <div className="business-detail-hero">
          <span className="business-directory-icon large"><Building2 size={23} /></span>
          <div className="business-detail-title"><h3>{selected.name}</h3><p>{selected.category}</p>
            {selected.isVerified ? <span className="business-verified-badge"><BadgeCheck size={13} /> Verified business</span> : selected.status === "pending" ? <span className="business-pending-badge"><Clock3 size={12} /> Verification pending</span> : <span className="business-unverified-badge">OpenStreetMap listing · not verified</span>}
          </div>
        </div>
        {selected.address && <p className="business-detail-address"><MapPin size={14} /> {selected.address}</p>}
        {selected.description && <p className="business-public-description">{selected.description}</p>}
        <div className="business-contact-details">
          {selected.openingHours && <p><Clock3 size={13} /><span><strong>Hours</strong>{selected.openingHours}</span></p>}
          {selected.phone && <p><MessageCircle size={13} /><span><strong>Phone</strong><a href={`tel:${selected.phone.replace(/[^+\d]/g, "")}`}>{selected.phone}</a></span></p>}
          {selected.website && <p><ExternalLink size={13} /><span><strong>Website</strong><a href={selected.website} target="_blank" rel="noreferrer noopener">Open official website</a></span></p>}
        </div>
        {selected.isVerified ? (
          <>
            <div className="business-rating-summary">{reviewCount ? <><Stars rating={averageRating} /><strong>{averageRating.toFixed(1)}</strong><span>{reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span></> : <span>No reviews yet</span>}</div>
            <div className="business-detail-tabs" role="tablist" aria-label="Business actions">
              {(["overview", "reviews", "questions", "booking", ...(selected.isOwner ? ["requests" as const] : [])] as Array<typeof section>).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={section === tab} className={section === tab ? "active" : ""} onClick={() => { setSection(tab); setFormError(""); setNotice(""); }}>
                  {tab === "overview" ? "About" : tab === "requests" ? "Requests" : tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            {formError && <p className="business-form-error" role="alert">{formError}</p>}
            {notice && <p className="business-form-notice" role="status">{notice}</p>}
            {section === "overview" && (
              <div className="business-overview-panel">
                <p>This listing has been reviewed by THE WORLD. You can ask the business a question, request a booking, or share an honest experience.</p>
                <div className="business-quick-actions">
                  <button type="button" className="primary-action" onClick={() => setSection("booking")}><CalendarClock size={15} /> Request booking</button>
                  <button type="button" className="secondary-action" onClick={() => setSection("questions")}><MessageCircle size={15} /> Ask a question</button>
                </div>
                <p className="business-trust-note"><ShieldCheck size={13} /> Reviews are not described as booking-verified unless tied to a booking that the business marked completed.</p>
              </div>
            )}
            {section === "reviews" && (
              <div className="business-subsection">
                {!selected.isOwner ? <form className="business-form" onSubmit={submitReview}>
                  <h4>Share your experience</h4>
                  <label>Rating<select value={rating} onChange={(e) => setRating(Number(e.target.value))}><option value={5}>5 · Excellent</option><option value={4}>4 · Good</option><option value={3}>3 · Average</option><option value={2}>2 · Poor</option><option value={1}>1 · Very poor</option></select></label>
                  <label>Your review<textarea rows={3} value={reviewBody} onChange={(e) => setReviewBody(e.target.value.slice(0,1000))} maxLength={1000} minLength={5} placeholder="Describe what you experienced…" required /></label>
                  <div className="business-form-bottom"><span>{reviewBody.length}/1000 · Be honest and specific.</span><button type="submit" disabled={busy==="review" || reviewBody.trim().length<5}>{busy==="review" ? "Posting…" : "Post review"}</button></div>
                </form> : <div className="business-empty-state"><ShieldCheck size={18}/><strong>You manage this business</strong><p>Owners cannot review their own listing.</p></div>}
                {reviews.length === 0 ? <div className="business-empty-state"><Star size={19} /><strong>No public reviews yet</strong><p>Be the first to share a helpful, honest experience.</p></div> : reviews.map((review) => (
                  <article className="business-review" key={review.id}>
                    <div className="business-review-top"><span className="business-review-avatar">{review.author.displayName.slice(0,1).toUpperCase()}</span><div><strong>{review.author.displayName}</strong><small>@{review.author.username} · {timeLabel(review.createdAt)}</small></div><Stars rating={review.rating} /></div>
                    <div className="business-review-badges">{review.verificationStatus === "verified" ? <span className="business-verified-badge"><BadgeCheck size={12} /> Completed booking verified</span> : <span className="business-unverified-badge">Experience not booking-verified</span>}</div>
                    <p>{review.body}</p>
                    {selected.isOwner && (disputeTarget === review.id ? (
                      <form className="business-dispute-form" onSubmit={(event) => void disputeReview(event, review)}>
                        <label>Why do you dispute this review?<textarea rows={2} minLength={10} maxLength={500} value={disputeReason} onChange={(e) => setDisputeReason(e.target.value.slice(0,500))} placeholder="Explain the specific concern…" required /></label>
                        <div><button type="submit" disabled={busy===`dispute:${review.id}` || disputeReason.trim().length<10}>Submit dispute</button><button type="button" className="business-text-button" onClick={() => { setDisputeTarget(null); setDisputeReason(""); }}>Cancel</button></div>
                        <small>Submitting a dispute temporarily hides the review while a moderator checks it; it does not automatically prove the review is fake.</small>
                      </form>
                    ) : <button className="business-text-button" type="button" onClick={() => setDisputeTarget(review.id)}>Dispute review</button>)}
                  </article>
                ))}
              </div>
            )}
            {section === "questions" && (
              <div className="business-subsection">
                <form className="business-form" onSubmit={askBusiness}>
                  <h4>Ask the business</h4><label>Your question<textarea rows={2} minLength={2} maxLength={500} value={questionBody} onChange={(e) => setQuestionBody(e.target.value.slice(0,500))} placeholder="Ask about availability, services or details…" required /></label>
                  <div className="business-form-bottom"><span>{questionBody.length}/500</span><button type="submit" disabled={busy==="question" || questionBody.trim().length<2}>{busy==="question" ? "Sending…" : "Send question"}</button></div>
                </form>
                {questions.length===0 ? <div className="business-empty-state"><MessageCircle size={19}/><strong>No questions yet</strong><p>Ask the first question about this business.</p></div> : questions.map((question)=>(
                  <article className="business-question" key={question.id}><div className="business-question-meta"><strong>{question.author.displayName}</strong><small>{timeLabel(question.createdAt)}</small></div><p>{question.body}</p>
                    {question.answer && <div className="business-owner-answer"><strong><BadgeCheck size={12}/> Business answer</strong><p>{question.answer}</p></div>}
                    {selected.isOwner && !question.answer && <form className="business-answer-form" onSubmit={(event)=>void answerBusinessQuestion(event,question)}><textarea rows={2} value={answerDrafts[question.id]||""} onChange={(e)=>setAnswerDrafts((old)=>({...old,[question.id]:e.target.value.slice(0,1000)}))} placeholder="Reply as the verified business…" required/><button type="submit" disabled={busy===`answer:${question.id}`}>{busy===`answer:${question.id}`?"Sending…":"Answer"}</button></form>}
                  </article>
                ))}
              </div>
            )}
            {section === "booking" && (
              <div className="business-subsection">
                <div className="business-trust-note"><Clock3 size={14}/><span>This sends a request, not a confirmed booking. Wait for the business to accept it.</span></div>
                {!selected.isOwner && (
                  <form className="business-form" onSubmit={requestBooking}>
                    <h4>Request a booking</h4>
                    <label>Preferred date and time<input type="datetime-local" value={bookingDate} min={new Date(Date.now()+5*60_000).toISOString().slice(0,16)} onChange={(e)=>setBookingDate(e.target.value)} required/></label>
                    <label>What do you need?<textarea rows={3} value={bookingMessage} onChange={(e)=>setBookingMessage(e.target.value.slice(0,500))} maxLength={500} placeholder="Share party size, service or other details…" required/></label>
                    <div className="business-form-bottom"><span>{bookingMessage.length}/500</span><button type="submit" disabled={busy==="booking" || !bookingDate || bookingMessage.trim().length<2}>{busy==="booking"?"Sending…":"Send request"}</button></div>
                  </form>
                )}
                {selected.isOwner ? (
                  <div className="business-empty-state"><CalendarClock size={18}/><strong>Manage booking requests</strong><p>Open the Requests tab to accept, decline or complete customer requests.</p><button type="button" className="secondary-action" onClick={() => setSection("requests")}>View requests</button></div>
                ) : bookings.length === 0 ? (
                  <div className="business-empty-state"><CalendarClock size={18}/><strong>No booking requests yet</strong><p>Requests you send to this business will appear here with their current status.</p></div>
                ) : (
                  <div className="business-booking-list"><h4>Your requests</h4>{bookings.map((booking)=>(
                    <article key={booking.id} className="business-booking-card">
                      <strong>{booking.requestedFor ? new Date(booking.requestedFor).toLocaleString() : "Requested booking"}</strong>
                      <p>{booking.message}</p>
                      <span className={`business-booking-status status-${booking.status}`}>{booking.status}</span>
                      {booking.status === "completed" && <small>A completed booking can be linked to your review.</small>}
                    </article>
                  ))}</div>
                )}
              </div>
            )}
            {section === "requests" && (
              <div className="business-subsection">
                <h4>Booking requests</h4>
                {bookings.length===0 ? <div className="business-empty-state"><CalendarClock size={18}/><strong>No booking requests</strong><p>New customer requests appear here.</p></div> : bookings.map((booking)=>(
                  <article className="business-booking-card" key={booking.id}><div className="business-booking-heading"><strong>{booking.customer?.displayName || "Customer"}</strong><span className={`business-booking-status status-${booking.status}`}>{booking.status}</span></div><p>{booking.message}</p><small>{new Date(booking.requestedFor).toLocaleString()}</small>
                    {booking.status==="requested"&&<div><button type="button" onClick={()=>void updateBooking(booking,"accepted")} disabled={Boolean(busy)}>Accept</button><button type="button" onClick={()=>void updateBooking(booking,"declined")} disabled={Boolean(busy)}>Decline</button></div>}
                    {booking.status==="accepted"&&<button type="button" onClick={()=>void updateBooking(booking,"completed")} disabled={Boolean(busy)}>Mark completed</button>}
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="business-verification-info"><ShieldCheck size={18}/><div><strong>{selected.status === "pending" ? "Listing awaiting verification" : "This business is not yet verified"}</strong><p>{selected.status === "pending" ? "A listing request is already being reviewed. Reviews, business Q&amp;A and booking requests remain disabled until a moderator approves it." : "It can be found on the map, but reviews, business Q&amp;A and booking requests stay disabled until THE WORLD verifies the listing."}</p><p>Only list a business you own or are authorised to represent.</p>{selected.status !== "pending" && <button type="button" className="primary-action" onClick={() => { if (!sessionUser) { onSignIn(); return; } setClaimTarget(selected); setFormError(""); }}>Request verification</button>}</div></div>
        )}
        {claimTarget?.osmPlaceKey === selected.osmPlaceKey && (
          <form className="business-form business-claim-form" onSubmit={(event)=>void requestListing(event)}>
            <h4>Request a verified listing</h4><p>A moderator will check the evidence before giving the business a verified badge.</p>
            <label>Official website or public proof link<input type="url" value={proofUrl} onChange={(e)=>setProofUrl(e.target.value)} placeholder="https://your-business.example" required/></label>
            <label>Additional context<textarea rows={2} value={verificationNote} onChange={(e)=>setVerificationNote(e.target.value.slice(0,800))} maxLength={800} placeholder="Describe your role or how ownership can be confirmed."/></label>
            <div className="business-form-bottom"><span>Manual review required</span><button type="submit" disabled={busy==="claim"}>{busy==="claim"?"Submitting…":"Submit for review"}</button><button className="business-text-button" type="button" onClick={()=>setClaimTarget(null)}>Cancel</button></div>
          </form>
        )}
      </section>
    );
  }

  return (
    <section className="business-directory" aria-label={`Businesses around ${place.name}`}>
      <div className="business-directory-heading">
        <div><span className="eyebrow">LOCAL DIRECTORY</span><h3>Businesses around here</h3><p>Shops and local services mapped near {place.name}.</p></div>
        <button className="business-refresh" type="button" onClick={()=>void loadDirectory()} aria-label="Refresh nearby businesses" disabled={loading}><RefreshCw size={15}/></button>
      </div>
      <div className="business-directory-trust"><ShieldCheck size={14}/><span>Only manually verified businesses can receive reviews, answer business questions, or accept booking requests.</span></div>
      {error && <div className="business-directory-error" role="alert"><span>{error}</span><button type="button" onClick={()=>void loadDirectory()}>Retry</button></div>}
      {loading ? <div className="business-directory-loading"><span className="mini-spinner"/><span>Finding nearby shops and services…</span></div> : nearby.length===0 ? <div className="business-empty-state"><Store size={21}/><strong>{sourceUnavailable ? "Nearby directory is temporarily unavailable" : "No mapped businesses found nearby"}</strong><p>{sourceUnavailable ? "The map business service couldn't respond. Try again shortly." : "No named shops or services were returned around this point yet. Try a nearby street or landmark."}</p><button className="secondary-action" type="button" onClick={()=>void loadDirectory()}>Try again</button></div> : (
        <div className="business-directory-list">
          {nearby.map((business)=>(
            <article className="business-listing-row" key={business.osmPlaceKey}>
              <span className="business-directory-icon"><Building2 size={18}/></span>
              <button type="button" className="business-listing-main" onClick={()=>{setSelectedId(business.businessId);setSection("overview");setFormError("");setNotice("");}}>
                <strong>{business.name}</strong><small>{business.category}</small>{business.address&&<small className="business-address-line">{business.address}</small>}
                {business.openingHours && <small className="business-hours-line">Hours: {business.openingHours}</small>}
                {business.isVerified ? <span className="business-verified-badge"><BadgeCheck size={12}/> Verified by THE WORLD</span> : business.status==="pending" ? <span className="business-pending-badge"><Clock3 size={11}/> Verification pending</span> : <span className="business-unverified-badge">Map listing · not yet verified</span>}
              </button>
              {business.isVerified && business.businessId ? <button className="business-open-button" type="button" onClick={()=>{setSelectedId(business.businessId);setSection("overview");setFormError("");setNotice("");}}>Open <ExternalLink size={13}/></button>
                : business.status==="pending" ? <span className="business-waiting-text">In review</span>
                : <button className="business-claim-button" type="button" onClick={()=>{if(!sessionUser){onSignIn();return;}setClaimTarget(business);setProofUrl("");setVerificationNote("");setFormError("");}}>List business</button>}
              {claimTarget?.osmPlaceKey===business.osmPlaceKey && (
                <form className="business-claim-inline" onSubmit={(event)=>void requestListing(event)}>
                  <strong>Request a verified listing for {business.name}</strong>
                  <label>Official website or public proof link<input type="url" value={proofUrl} onChange={(e)=>setProofUrl(e.target.value)} placeholder="https://your-business.example" required/></label>
                  <label>Additional context<textarea rows={2} value={verificationNote} onChange={(e)=>setVerificationNote(e.target.value.slice(0,800))} maxLength={800} placeholder="How can the team verify your connection to this business?"/></label>
                  {formError&&<p className="business-form-error" role="alert">{formError}</p>}
                  <div className="business-form-bottom"><span>Checked by a moderator before listing approval</span><button type="submit" disabled={busy==="claim"}>{busy==="claim"?"Sending…":"Request verification"}</button><button className="business-text-button" type="button" onClick={()=>setClaimTarget(null)}>Cancel</button></div>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
      {notice&&<p className="business-form-notice" role="status">{notice}</p>}
      {formError&&!claimTarget&&<p className="business-form-error" role="alert">{formError}</p>}
      <div className="business-directory-footer"><MapPin size={13}/><span>Directory data from OpenStreetMap. Map listings are not proof of business ownership or endorsement.</span></div>
    </section>
  );
}
