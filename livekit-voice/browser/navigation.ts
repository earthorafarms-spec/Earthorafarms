/** Only canonical public destinations can be driven by a voice session. */
export type Destination = { id:string; path:string; anchor:string|null; label:string };
export type NavigationAction = { action_id:string; destination_id:string; path:string; anchor?:string|null; label?:string };
export type ActionResult = { ok:boolean; reason?:string };
const PUBLIC_PATHS = new Set(['/', '/our-story', '/health-benefits', '/contact', '/faq', '/shipping-policy', '/privacy-policy', '/terms-of-use', '/cart']);

export function isPublicPath(path:unknown):path is string {
  return typeof path === 'string' && (PUBLIC_PATHS.has(path) || /^\/product\/[a-zA-Z0-9_-]{1,120}$/.test(path));
}

export function validateNavigation(action:NavigationAction, guide:Destination[]):Destination|undefined {
  if (!action || typeof action.action_id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(action.action_id) || !isPublicPath(action.path)) return;
  const anchor = action.anchor ?? null;
  if (anchor !== null && (typeof anchor !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(anchor))) return;
  return guide.find(d => d.id === action.destination_id && d.path === action.path && (d.anchor ?? null) === anchor);
}

export function createNavigationHandler(options:{
  loadGuide:()=>Promise<Destination[]>;
  navigate:(destination:Destination, signal:AbortSignal)=>Promise<ActionResult>;
  sendResult:(result:ActionResult & {type:'client_action_result';action_id:string;destination_id:string})=>Promise<void>;
}) {
  const seen = new Map<string,{ fingerprint:string; result:Promise<ActionResult>; controller:AbortController }>();
  let current:AbortController|undefined;
  let closed = false;
  let guidePromise:Promise<Destination[]>|undefined;
  return {
    close() { closed = true; current?.abort(); },
    cancel(actionId:string) { seen.get(actionId)?.controller.abort(); },
    async handle(action:NavigationAction) {
      if (closed || !action || typeof action.action_id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(action.action_id) || typeof action.destination_id !== 'string' || action.destination_id.length > 160) return;
      const fingerprint = JSON.stringify([action.destination_id,action.path,action.anchor ?? null]);
      const previous = seen.get(action.action_id);
      let result:ActionResult;
      if (previous) {
        result = previous.fingerprint === fingerprint ? await previous.result : {ok:false,reason:'action_conflict'};
      } else if (seen.size >= 100) {
        result = {ok:false,reason:'action_limit'};
      } else {
        const controller = new AbortController();
        // Register synchronously before awaiting the manifest, so retransmits
        // cannot move/focus the page twice.
        const promise = (async ():Promise<ActionResult> => {
          const deadline=Date.now()+8500;
          let guide:Destination[];
          let guideTimer:ReturnType<typeof setTimeout>|undefined;
          try {
            guide = await Promise.race([
              guidePromise ??= options.loadGuide(),
              new Promise<never>((_resolve,reject)=>{guideTimer=setTimeout(()=>reject(new Error('guide_timeout')),4000);}),
            ]);
          }
          catch { guidePromise = undefined; return {ok:false,reason:'guide_unavailable'}; }
          finally { clearTimeout(guideTimer); }
          if (closed) return {ok:false,reason:'call_ended'};
          if (controller.signal.aborted) return {ok:false,reason:'navigation_cancelled'};
          // A suspended tab can resume after both network and worker deadlines.
          // Never move the page before scheduling an already-expired timer.
          if (Date.now() >= deadline) return {ok:false,reason:'navigation_timeout'};
          const destination = validateNavigation(action,guide);
          if (!destination) return {ok:false,reason:'invalid_destination'};
          current?.abort();
          current = controller;
          let timer:ReturnType<typeof setTimeout>|undefined;
          try {
            return await Promise.race([
              options.navigate(destination,controller.signal),
              new Promise<ActionResult>(resolve=>{
                timer=setTimeout(()=>{controller.abort();resolve({ok:false,reason:'navigation_timeout'});},Math.max(0,deadline-Date.now()));
              }),
            ]);
          } catch { return {ok:false,reason:controller.signal.aborted?'navigation_cancelled':'navigation_failed'}; }
          finally { clearTimeout(timer); if (current === controller) current = undefined; }
        })();
        seen.set(action.action_id,{fingerprint,result:promise,controller});
        result = await promise;
      }
      if (!closed) await options.sendResult({type:'client_action_result',action_id:action.action_id,destination_id:action.destination_id,...result});
    },
  };
}
