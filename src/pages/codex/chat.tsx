import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Calendar, ShieldAlert, Monitor, Clock, RefreshCw, Search, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ChatSession {
  id: string;
  user_id: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
  users?: {
    name: string;
    email: string;
  } | null;
  chat_messages?: {
    count: number;
  }[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  is_blocked: boolean;
  created_at: string;
}

// ── Confirm Delete Modal ──────────────────────────────────────────────────────
function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-border/30 p-6 max-w-sm w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4.5 h-4.5 text-red-500" />
          </div>
          <h3 className="font-serif text-base font-bold text-foreground">Confirm Delete</h3>
        </div>
        <p className="text-sm text-foreground/60 leading-relaxed mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-border/50 text-sm text-foreground/70 hover:bg-[#fafaf8] transition-all font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-all shadow-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CodexChat() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmModal, setConfirmModal] = useState<{
    type: "session" | "all";
    sessionId?: string;
  } | null>(null);

  const queryClient = useQueryClient();

  // 1. Fetch Chat Sessions
  const { data: sessions = [], isLoading: loadingSessions, refetch: refetchSessions } = useQuery<ChatSession[]>({
    queryKey: ["codex-chat-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select(`
          id,
          user_id,
          user_agent,
          started_at,
          ended_at,
          users:user_id(name, email)
        `)
        .order("started_at", { ascending: false });

      if (error) throw error;
      return data as ChatSession[];
    },
  });

  // 2. Fetch messages for selected session
  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["codex-chat-messages", selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return [];
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, is_blocked, created_at")
        .eq("session_id", selectedSessionId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as ChatMessage[];
    },
    enabled: !!selectedSessionId,
  });

  // 3. Delete a single session (cascade deletes its messages via FK)
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from("chat_sessions")
        .delete()
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: (_data, sessionId) => {
      if (selectedSessionId === sessionId) setSelectedSessionId(null);
      queryClient.invalidateQueries({ queryKey: ["codex-chat-sessions"] });
      queryClient.removeQueries({ queryKey: ["codex-chat-messages", sessionId] });
    },
  });

  // 4. Delete ALL sessions
  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("chat_sessions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all rows
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedSessionId(null);
      queryClient.invalidateQueries({ queryKey: ["codex-chat-sessions"] });
      queryClient.removeQueries({ queryKey: ["codex-chat-messages"] });
    },
  });

  // Auto-select first session if none selected
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  const filteredSessions = sessions.filter((s) => {
    const name = s.users?.name?.toLowerCase() || "anonymous";
    const email = s.users?.email?.toLowerCase() || "";
    return name.includes(searchTerm.toLowerCase()) || email.includes(searchTerm.toLowerCase()) || s.id.includes(searchTerm);
  });

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  // ── Confirm handler ──
  const handleConfirm = () => {
    if (!confirmModal) return;
    if (confirmModal.type === "all") {
      deleteAllMutation.mutate();
    } else if (confirmModal.type === "session" && confirmModal.sessionId) {
      deleteSessionMutation.mutate(confirmModal.sessionId);
    }
    setConfirmModal(null);
  };

  const isDeleting = deleteSessionMutation.isPending || deleteAllMutation.isPending;

  return (
    <>
      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          message={
            confirmModal.type === "all"
              ? `This will permanently delete all ${sessions.length} chat session${sessions.length !== 1 ? "s" : ""} and their messages. This action cannot be undone.`
              : "This will permanently delete this chat session and all its messages. This action cannot be undone."
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      <div className="max-w-7xl mx-auto h-full w-full flex flex-col gap-6 text-foreground overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">AI Chat Analytics</h1>
            <p className="text-sm text-foreground/50">Analyze customer queries, bot response quality, and block actions.</p>
          </div>
          <div className="flex items-center gap-2">
            {sessions.length > 0 && (
              <button
                onClick={() => setConfirmModal({ type: "all" })}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200/60 rounded-xl text-xs text-red-600 transition-all font-medium disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All Logs
              </button>
            )}
            <button
              onClick={() => refetchSessions()}
              className="flex items-center gap-2 px-4 py-2 bg-primary/5 hover:bg-primary/10 border border-primary/10 rounded-xl text-xs text-primary transition-all font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Feed
            </button>
          </div>
        </div>

        {/* Grid Layout */}
        <div className="grid lg:grid-cols-[340px_1fr] gap-6 flex-1 min-h-0 overflow-hidden">

          {/* Sidebar: Session List */}
          <div className="bg-white border border-border/40 rounded-2xl p-4 flex flex-col h-full shadow-[0_2px_16px_rgb(0,0,0,0.01)] overflow-hidden">
            <div className="relative mb-4 shrink-0">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-foreground/30" />
              <input
                type="text"
                placeholder="Search user or session..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-border/50 rounded-xl text-xs focus:outline-none focus:border-primary/45 bg-[#fafaf8]"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
              {loadingSessions ? (
                <div className="text-center py-10 text-xs text-foreground/45">Loading chat feeds...</div>
              ) : filteredSessions.length === 0 ? (
                <div className="text-center py-10 text-xs text-foreground/45">No chat feeds found.</div>
              ) : (
                filteredSessions.map((session) => {
                  const isActive = session.id === selectedSessionId;
                  const formattedDate = new Date(session.started_at).toLocaleDateString("en-IN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div key={session.id} className="group relative">
                      <button
                        onClick={() => setSelectedSessionId(session.id)}
                        className={`w-full text-left p-3.5 pr-10 rounded-xl border transition-all flex flex-col gap-1.5 ${isActive
                            ? "bg-primary/5 border-primary/20 shadow-[0_1px_8px_rgba(0,0,0,0.02)]"
                            : "bg-transparent border-border/30 hover:bg-[#fafaf8] hover:border-border/60"
                          }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-serif text-sm font-semibold text-foreground leading-none">
                            {session.users?.name || "Anonymous User"}
                          </span>
                          <span className="text-[10px] font-mono text-foreground/30">
                            {session.id.slice(0, 8)}
                          </span>
                        </div>
                        {session.users?.email && (
                          <span className="text-[10px] text-foreground/45 truncate leading-none">
                            {session.users.email}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 text-[9px] text-foreground/35 mt-1 font-mono">
                          <Calendar className="w-3 h-3" />
                          {formattedDate}
                        </div>
                      </button>

                      {/* Per-session delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmModal({ type: "session", sessionId: session.id });
                        }}
                        disabled={isDeleting}
                        title="Delete this session"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 transition-all border border-red-100 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Chat Transcript Panel */}
          <div className="bg-white border border-border/40 rounded-2xl h-full flex flex-col overflow-hidden shadow-[0_2px_16px_rgb(0,0,0,0.01)]">
            {selectedSession ? (
              <>
                {/* Transcript Header */}
                <div className="border-b border-border/40 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#fafaf8] shrink-0">
                  <div>
                    <h3 className="font-serif text-base font-bold text-foreground leading-tight">
                      Transcript — {selectedSession.users?.name || "Anonymous"}
                    </h3>
                    <div className="flex items-center gap-4 mt-1.5 text-[10px] text-foreground/45 font-mono">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-foreground/30" />
                        Start: {new Date(selectedSession.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {selectedSession.user_agent && (
                        <span className="flex items-center gap-1 truncate max-w-[200px]" title={selectedSession.user_agent}>
                          <Monitor className="w-3.5 h-3.5 text-foreground/30" />
                          {selectedSession.user_agent.split(" ")[0]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete session from transcript header */}
                  <button
                    onClick={() => setConfirmModal({ type: "session", sessionId: selectedSession.id })}
                    disabled={isDeleting}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200/60 text-xs text-red-500 hover:text-red-700 font-medium transition-all disabled:opacity-40 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Session
                  </button>
                </div>

                {/* Message Feed */}
                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 bg-white min-h-0">
                  {loadingMessages ? (
                    <div className="text-center py-20 text-xs text-foreground/40">Loading messages...</div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-20 text-xs text-foreground/40">No messages logged in this session.</div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-[0_1px_4px_rgba(0,0,0,0.02)] ${msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-[#fafaf8] border border-border/40 text-foreground/80 rounded-tl-sm"
                            }`}
                        >
                          {msg.content}

                          {msg.is_blocked && (
                            <div className="mt-2.5 pt-2 border-t border-red-200/40 flex items-center gap-1.5 text-[10px] text-red-500 font-medium">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Blocked by Guardrails
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-foreground/25 self-end px-1 font-mono">
                          {new Date(msg.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-foreground/30">
                <MessageSquare className="w-8 h-8 mb-3 opacity-40 text-primary" />
                <p className="text-sm font-serif font-medium">Select a Chat Session</p>
                <p className="text-xs max-w-xs mt-1">Choose a conversation from the sidebar feed to view full analytical logs.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
