import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, Check, X, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const initialAdminReviews = [
  { id: 1, product: "Moringa Capsules", customer: "Arjun K.", avatar: "AK", rating: 5, comment: "Noticed a difference in my energy levels within a week. The quality is unmatched.", status: "Approved", date: "2 days ago" },
  { id: 2, product: "Moringa Powder", customer: "Neha G.", avatar: "NG", rating: 4, comment: "Great for smoothies. Much finer texture than other brands I've tried.", status: "Approved", date: "5 days ago" },
  { id: 3, product: "Amla Powder", customer: "Deepak R.", avatar: "DR", rating: 5, comment: "My hair has never been healthier. Truly premium amla powder.", status: "Pending", date: "1 hour ago" },
  { id: 4, product: "Moringa Tablets", customer: "Kavita M.", avatar: "KM", rating: 3, comment: "Good product but the tablets are a bit large to swallow comfortably.", status: "Pending", date: "3 hours ago" },
];

export default function AdminReviews() {
  const [reviews, setReviews] = useState(initialAdminReviews);
  const [reviewFilter, setReviewFilter] = useState("All");
  const { toast } = useToast();

  const handleApproveReview = (id: number) => {
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, status: "Approved" } : r)));
    toast({ title: "Review approved", description: "The review is now visible on the product page." });
  };

  const handleRejectReview = (id: number) => {
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, status: "Rejected" } : r)));
    toast({ title: "Review rejected", description: "The review has been hidden." });
  };

  const filteredReviews = useMemo(() => {
    if (reviewFilter === "All") return reviews;
    return reviews.filter((r) => r.status === reviewFilter);
  }, [reviews, reviewFilter]);

  return (
    <motion.div
      key="reviews"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl text-amber-700">
            <AlertCircle className="w-4 h-4" strokeWidth={1.5} />
            <span className="text-xs font-semibold">{reviews.filter((r) => r.status === "Pending").length} review{reviews.filter((r) => r.status === "Pending").length !== 1 ? "s" : ""} pending</span>
          </div>
          <span className="text-foreground/15">|</span>
          <span className="text-xs text-foreground/45 font-medium">{reviews.length} reviews total</span>
        </div>
        <div className="flex gap-1.5 bg-white border border-border/40 p-1 rounded-xl">
          {["All", "Pending", "Approved", "Rejected"].map((f) => (
            <button
              key={f}
              onClick={() => setReviewFilter(f)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                reviewFilter === f
                  ? "bg-primary text-white shadow-sm"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <AnimatePresence mode="popLayout">
          {filteredReviews.map((review) => (
            <motion.div
              key={review.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="group bg-white rounded-2xl border border-border/40 p-6 hover:border-primary/20 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/8 flex items-center justify-center text-sm font-bold text-primary shrink-0 border border-primary/10">
                  {review.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-1.5">
                    <span className="text-sm font-semibold text-foreground">{review.customer}</span>
                    <span className="text-[11px] text-foreground/40 font-medium">{review.date}</span>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                      review.status === "Approved" ? "bg-green-50 text-green-700 border-green-200" :
                      review.status === "Rejected" ? "bg-red-50 text-red-600 border-red-200" :
                      "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>{review.status}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < review.rating ? "fill-accent text-accent" : "text-border"}`} strokeWidth={1.5} />
                      ))}
                    </div>
                    <span className="text-[11px] text-foreground/30">on</span>
                    <span className="text-xs text-primary font-bold">{review.product}</span>
                  </div>
                  <p className="text-sm text-foreground/70 leading-relaxed font-light">"{review.comment}"</p>
                </div>
                {review.status === "Pending" && (
                  <div className="flex gap-2 shrink-0 mt-0.5">
                    <button
                      onClick={() => handleApproveReview(review.id)}
                      className="p-2 rounded-xl bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-all hover:shadow-sm"
                      title="Approve"
                    >
                      <Check className="w-4 h-4 animate-pulse" strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => handleRejectReview(review.id)}
                      className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all hover:shadow-sm"
                      title="Reject"
                    >
                      <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
