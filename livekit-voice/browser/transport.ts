/** UniExl's LiveKit room/audio transport behind Earthora's existing widget. */
import { Room, RoomEvent, Track, ParticipantKind } from 'livekit-client';
import { createNavigationHandler, type Destination, type ActionResult } from './navigation';

type Options = { baseUrl:string; channelKey:string; conversationId?:string; onEvent:(event:any)=>void; onLevel?:(level:number)=>void; onState?:(state:{muted:boolean})=>void; onNavigate?:(destination:Destination,signal:AbortSignal)=>Promise<ActionResult>; signal?:AbortSignal };
export async function connect(options:Options) {
  const room = new Room({ adaptiveStream:false, dynacast:true, audioCaptureDefaults:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
  let closed = false;
  let muted = false;
  let agentIdentity:string|undefined;
  const lifetime = new AbortController();
  const publish = async (event:object, destinationIdentity?:string) => {
    if (closed) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(event)),{reliable:true,topic:'earthora.voice',...(destinationIdentity ? {destinationIdentities:[destinationIdentity]} : {})});
  };
  const microphoneState = () => {
    options.onState?.({muted});
    options.onEvent({type:'microphone_state',muted});
  };
  const navigation = createNavigationHandler({
    loadGuide:async()=>{
      const timeout = new AbortController();
      const abort=()=>timeout.abort(); lifetime.signal.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,4000);
      try {
        const response=await fetch(options.baseUrl+'/api/platform/voice/site-guide',{signal:timeout.signal});
        if (!response.ok) throw new Error('guide_unavailable');
        const data=await response.json();
        if (!Array.isArray(data.destinations) || data.destinations.length > 200) throw new Error('invalid_guide');
        return data.destinations as Destination[];
      } finally {clearTimeout(timer);lifetime.signal.removeEventListener('abort',abort);}
    },
    navigate:(destination,signal)=>options.onNavigate?.(destination,signal) ?? Promise.resolve({ok:false,reason:'unsupported_page'}),
    sendResult:result=>publish(result,agentIdentity),
  });
  const elements = new Set<HTMLMediaElement>();
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    lifetime.abort(); navigation.close();
    clearInterval(meter);
    elements.forEach(e=>{ e.pause(); e.remove(); }); elements.clear();
    await room.disconnect(true);
  };
  const meter = setInterval(()=>{
    let level=room.localParticipant.audioLevel || 0;
    room.remoteParticipants.forEach(p=>{level=Math.max(level,p.audioLevel || 0);});
    options.onLevel?.(level);
  },60);
  options.signal?.addEventListener('abort',()=>void cleanup(),{once:true});
  room.on(RoomEvent.TrackSubscribed,(track)=>{
    if (track.kind !== Track.Kind.Audio || closed) return;
    const audio=track.attach(); audio.style.display='none'; document.body.appendChild(audio); elements.add(audio);
    audio.play().catch(()=>options.onEvent({type:'playback_blocked'}));
  });
  room.on(RoomEvent.TrackUnsubscribed,(track)=>track.detach().forEach(e=>{elements.delete(e);e.remove();}));
  room.on(RoomEvent.DataReceived,(data,participant,_kind,topic)=>{
    if (topic !== 'earthora.voice' || closed || data.byteLength > 32768 || participant?.kind !== ParticipantKind.AGENT) return;
    try {
      const event=JSON.parse(new TextDecoder().decode(data));
      if (!event || typeof event !== 'object') return;
      if (event.type === 'navigate_site') {
        agentIdentity=participant.identity;
        void navigation.handle(event).catch(()=>{/* disconnect can race an acknowledgement */});
      } else if (event.type === 'cancel_navigation' && typeof event.action_id === 'string') {
        navigation.cancel(event.action_id);
      } else if (event.type === 'request_voice_state') {
        void publish({type:'client_voice_state',muted},participant.identity).catch(()=>{});
      } else options.onEvent(event);
    } catch { /* malformed packet ignored */ }
  });
  room.on(RoomEvent.Disconnected,()=>{
    if (!closed) { options.onEvent({type:'disconnected'}); void cleanup(); }
  });
  room.on(RoomEvent.Reconnecting,()=>options.onEvent({type:'reconnecting'}));
  room.on(RoomEvent.ParticipantConnected,participant=>{
    if (participant.kind === ParticipantKind.AGENT) void publish({type:'client_voice_state',muted},participant.identity).catch(()=>{});
  });
  room.on(RoomEvent.Reconnected,()=>{
    options.onEvent({type:'connected'}); microphoneState();
    void publish({type:'client_voice_state',muted}).catch(()=>options.onEvent({type:'voice_state_unconfirmed'}));
  });
  try {
    // Start audio in the user's gesture before waiting for admission/network.
    await room.startAudio();
    const response=await fetch(options.baseUrl+'/api/platform/voice/livekit/session',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:options.signal,
      body:JSON.stringify({channelKey:options.channelKey,conversationId:options.conversationId,language:'auto'}),
    });
    const session=await response.json();
    if (!response.ok) throw new Error(session.error || (response.status===429?'The voice lines are busy. Try again shortly.':'Could not start voice. Please try again.'));
    if (closed || options.signal?.aborted) throw new DOMException('Cancelled','AbortError');
    await room.connect(session.url,session.token);
    if (closed || options.signal?.aborted) { await room.disconnect(true); throw new DOMException('Cancelled','AbortError'); }
    await room.localParticipant.setMicrophoneEnabled(true);
    if (closed || options.signal?.aborted) { await room.disconnect(true); throw new DOMException('Cancelled','AbortError'); }
    options.onEvent({type:'connected',conversationId:session.conversationId});
    microphoneState();
    return {
      disconnect:cleanup, resumeAudio:()=>room.startAudio(), roomName:session.room_name,
      async setMuted(next:boolean) {
        if (closed) return;
        await room.localParticipant.setMicrophoneEnabled(!next);
        if (closed) return;
        muted=next; microphoneState();
        try { await publish({type:'client_voice_state',muted}); }
        catch { options.onEvent({type:'voice_state_unconfirmed'}); }
      },
    };
  } catch (error) { await cleanup(); throw error; }
}
(window as any).EarthoraVoice={connect};
