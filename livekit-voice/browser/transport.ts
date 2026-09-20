/** UniExl's LiveKit room/audio transport behind Earthora's existing widget. */
import { Room, RoomEvent, Track } from 'livekit-client';

type Options = { baseUrl:string; channelKey:string; conversationId?:string; onEvent:(event:any)=>void; onLevel?:(level:number)=>void; signal?:AbortSignal };
async function connect(options:Options) {
  const room = new Room({ adaptiveStream:false, dynacast:true, audioCaptureDefaults:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
  let closed = false;
  const elements = new Set<HTMLMediaElement>();
  const cleanup = async () => {
    if (closed) return;
    closed = true;
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
  room.on(RoomEvent.DataReceived,(data,_participant,_kind,topic)=>{
    if (topic !== 'earthora.voice' || closed) return;
    try { options.onEvent(JSON.parse(new TextDecoder().decode(data))); } catch { /* malformed packet ignored */ }
  });
  room.on(RoomEvent.Disconnected,()=>{
    if (!closed) { options.onEvent({type:'disconnected'}); void cleanup(); }
  });
  room.on(RoomEvent.Reconnecting,()=>options.onEvent({type:'reconnecting'}));
  room.on(RoomEvent.Reconnected,()=>options.onEvent({type:'connected'}));
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
    return { disconnect:cleanup, resumeAudio:()=>room.startAudio(), roomName:session.room_name };
  } catch (error) { await cleanup(); throw error; }
}
(window as any).EarthoraVoice={connect};
