import { memo } from 'react';
import { motion } from 'framer-motion';
import { Star, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Review } from '@/types';

interface ReviewSectionProps {
  reviews: Review[];
  reviewName: string;
  reviewRating: number;
  reviewComment: string;
  onNameChange: (v: string) => void;
  onRatingChange: (v: number) => void;
  onCommentChange: (v: string) => void;
  onSubmit: () => void;
}

export const ReviewSection = memo(function ReviewSection({
  reviews,
  reviewName,
  reviewRating,
  reviewComment,
  onNameChange,
  onRatingChange,
  onCommentChange,
  onSubmit,
}: ReviewSectionProps) {
  return (
    <div className="border-t border-border/20 px-6 md:px-12 py-10 bg-secondary/10">
      <div className="max-w-4xl mx-auto">
        <h3 className="text-lg font-serif text-foreground mb-8">Customer Reviews</h3>
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="lg:w-80">
            <h4 className="text-sm font-medium text-foreground mb-5 flex items-center gap-2">
              <span className="w-5 h-px bg-primary/40" /> Write a Review
            </h4>
            <div className="bg-card rounded-2xl p-5 border border-border/30 space-y-4">
              <input
                type="text"
                placeholder="Your name"
                value={reviewName}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full h-11 px-4 text-sm bg-background border border-border/60 rounded-xl outline-none focus:border-primary/40 transition-colors"
              />
              <div>
                <span className="text-xs text-foreground/50 mb-2 block">Your Rating</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button key={r} type="button" onClick={() => onRatingChange(r)} className="p-0.5 hover:scale-110 transition-transform">
                      <Star className={`w-6 h-6 ${r <= reviewRating ? 'fill-accent text-accent' : 'text-border'}`} strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                placeholder="Share your thoughts..."
                value={reviewComment}
                onChange={(e) => onCommentChange(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 text-sm bg-background border border-border/60 rounded-xl outline-none focus:border-primary/40 transition-colors resize-none"
              />
              <Button className="w-full h-11 text-sm" onClick={onSubmit} disabled={!reviewName.trim() || !reviewComment.trim()}>
                <ThumbsUp className="w-4 h-4 mr-1.5" strokeWidth={1.5} /> Submit Review
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            {reviews.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Star className="w-6 h-6 text-border" strokeWidth={1} />
                </div>
                <p className="text-sm text-foreground/40 font-light">No reviews yet. Be the first to share your experience!</p>
              </div>
            ) : (
              [...reviews].reverse().map((r, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-card rounded-2xl p-5 border border-border/30"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{r.name}</span>
                          <span className="px-2 py-0.5 text-[10px] font-medium text-green-700 bg-green-50 rounded-full">Verified Purchase</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="flex gap-0.5">
                            {Array.from({ length: 5 }).map((_, si) => (
                              <Star key={si} className={`w-3 h-3 ${si < r.rating ? 'fill-accent text-accent' : 'text-border'}`} strokeWidth={1.5} />
                            ))}
                          </div>
                          <span className="text-xs text-foreground/30">{r.date}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/60 font-light leading-relaxed">{r.comment}</p>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
