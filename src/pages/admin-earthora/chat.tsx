import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Calendar, ShieldAlert, Monitor, Clock, RefreshCw, Search, Trash2 } from "lucide-react";
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
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  is_blocked: boolean;
  created_at: string;
}

export default function AdminChat() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // 1. Fetch Chat Sessions
  const { data: sessions = [], isLoading: loadingSessions, refetch: refetchSessions } = useQuery<ChatSession[]>({
    queryKey: ["admin-chat-sessions"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("chat_sessions") as any)
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
    queryKey: ["admin-chat-messages", selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("chat_messages") as any)
        .select("id, role, content, is_blocked, created_at")
        .eq("session_id", selectedSessionId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as ChatMessage[];
    },
    enabled: !!selectedSessionId,
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

  // 3. Delete Single Session
  const handleDeleteSession = async (id: string) => {
    if (!confirm("Are you sure you want to delete this chat session?")) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("chat_sessions") as any).delete().eq("id", id);
      if (error) throw error;
      setSelectedSessionId(null);
      refetchSessions();
    } catch (err) {
      alert("Failed to delete session: " + (err as Error).message);
    }
  };

  // 4. Clear All Logs
  const handleClearAllLogs = async () => {
    if (!confirm("WARNING: This will permanently delete ALL chat sessions and messages. Continue?")) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("chat_sessions") as any).delete().neq("id", "00000000-0000-0000-0000-000000000000"); // deletes all
      if (error) throw error;
      setSelectedSessionId(null);
      refetchSessions();
    } catch (err) {
      alert("Failed to clear logs: " + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-foreground">AI Chat Logs</h1>
          <p className="text-xs md:text-sm text-foreground/50">Analyze customer queries, bot response quality, and blocked actions.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearAllLogs}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200/50 rounded-xl text-xs text-red-600 transition-all font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All Logs
          </button>
          <button
            onClick={() => refetchSessions()}
            className="flex items-center gap-2 px-4 py-2 bg-[#1b4332]/5 hover:bg-[#1b4332]/10 border border-[#1b4332]/10 rounded-xl text-xs text-[#1b4332] transition-all font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Feed
          </button>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid lg:grid-cols-[340px_1fr] gap-6">

        {/* Sidebar: Session List */}
        <div className="bg-white border border-neutral-200/50 rounded-2xl p-4 flex flex-col h-[600px] shadow-sm">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-foreground/30" />
            <input
              type="text"
              placeholder="Search user or session..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-neutral-200/50 rounded-xl text-xs focus:outline-none focus:border-[#1b4332]/30 bg-[#fafaf8]"
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
                  <button
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-1.5 ${
                      isActive
                        ? "bg-[#1b4332]/5 border-[#1b4332]/20 shadow-sm"
                        : "bg-transparent border-neutral-200/40 hover:bg-[#fafaf8] hover:border-neutral-200/60"
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
                );
              })
            )}
          </div>
        </div>

        {/* Chat Transcript Panel */}
        <div className="bg-white border border-neutral-200/50 rounded-2xl h-[600px] flex flex-col overflow-hidden shadow-sm">
          {selectedSession ? (
            <>
              {/* Transcript Header */}
              <div className="border-b border-neutral-200/50 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#fafaf8]">
                <div>
                  <h3 className="font-serif text-base font-bold text-foreground leading-tight">
                    Transcript - {selectedSession.users?.name || "Anonymous"}
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
                        className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-[#1b4332] text-white rounded-tr-sm"
                            : "bg-[#fafaf8] border border-neutral-200/50 text-neutral-800 rounded-tl-sm"
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
                      <span className="text-[10px] text-neutral-500/30 self-end px-1 font-mono">
                        {new Date(msg.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-foreground/30">
              <MessageSquare className="w-8 h-8 mb-3 opacity-40 text-[#1b4332]" />
              <p className="text-sm font-serif font-medium">Select a Chat Session</p>
              <p className="text-xs max-w-xs mt-1">Choose a conversation from the sidebar feed to view full analytical logs.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
