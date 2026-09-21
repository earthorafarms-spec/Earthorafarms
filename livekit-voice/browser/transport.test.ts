// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
const fake=vi.hoisted(()=>({room:null as any}));
vi.mock('livekit-client',()=>({
  ParticipantKind:{AGENT:4},Track:{Kind:{Audio:'audio'}},
  RoomEvent:{TrackSubscribed:'track',TrackUnsubscribed:'untrack',DataReceived:'data',Disconnected:'disconnected',Reconnecting:'reconnecting',Reconnected:'reconnected',ParticipantConnected:'participant'},
  Room:class {
    callbacks=new Map<string,Function>();remoteParticipants=new Map();
    localParticipant={audioLevel:0,setMicrophoneEnabled:vi.fn(async()=>{}),publishData:vi.fn(async()=>{})};
    disconnect=vi.fn(async()=>{});connect=vi.fn(async()=>{});startAudio=vi.fn(async()=>{});
    constructor(){fake.room=this;}on(name:string,fn:Function){this.callbacks.set(name,fn);}
  },
}));
import {connect} from './transport';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('site-guide')?{destinations:[{id:'contact',path:'/contact',anchor:null,label:'Contact'}]}:{url:'wss://test.invalid',token:'test',conversationId:'test'}})));
}
describe('LiveKit browser controls',()=>{
  it('mutes only the microphone and republishes state on agent arrival and reconnect',async()=>{
    setup();const onState=vi.fn(),onEvent=vi.fn();const connection=await connect({baseUrl:'',channelKey:'public',onEvent,onState});
    await connection.setMuted(true);
    expect(fake.room.localParticipant.setMicrophoneEnabled.mock.calls).toEqual([[true],[false]]);
    expect(onState).toHaveBeenLastCalledWith({muted:true});expect(fake.room.disconnect).not.toHaveBeenCalled();
    fake.room.callbacks.get('participant')({kind:4,identity:'agent'});fake.room.callbacks.get('reconnected')();
    const calls=fake.room.localParticipant.publishData.mock.calls;
    expect(calls).toHaveLength(3);
    for(const [bytes,options] of calls){expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({type:'client_voice_state',muted:true});expect(options.reliable).toBe(true);}
    await connection.setMuted(false);expect(fake.room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    await connection.disconnect();expect(fake.room.disconnect).toHaveBeenCalledTimes(1);
  });
  it('ignores non-agent navigation packets and acknowledges trusted committed destinations',async()=>{
    setup();const onNavigate=vi.fn(async()=>({ok:true}));const connection=await connect({baseUrl:'',channelKey:'public',onEvent:vi.fn(),onNavigate});
    const packet=new TextEncoder().encode(JSON.stringify({type:'navigate_site',action_id:'test-1',destination_id:'contact',path:'/contact',anchor:null}));
    fake.room.callbacks.get('data')(packet,{kind:0,identity:'visitor'},null,'earthora.voice');
    expect(onNavigate).not.toHaveBeenCalled();
    fake.room.callbacks.get('data')(packet,{kind:4,identity:'agent'},null,'earthora.voice');
    await vi.waitFor(()=>expect(onNavigate).toHaveBeenCalledOnce());
    await vi.waitFor(()=>expect(fake.room.localParticipant.publishData).toHaveBeenCalledOnce());
    const [bytes,options]=fake.room.localParticipant.publishData.mock.calls[0];
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({type:'client_action_result',action_id:'test-1',destination_id:'contact',ok:true});
    expect(options.destinationIdentities).toEqual(['agent']);expect(fake.room.disconnect).not.toHaveBeenCalled();
    await connection.disconnect();
  });
});
