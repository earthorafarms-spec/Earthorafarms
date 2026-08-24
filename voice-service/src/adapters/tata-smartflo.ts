// Phase 5 seam — explicitly OUT OF SCOPE for this build.
//
// Do not implement this until real Tata Smartflo account credentials and
// official API/media-streaming documentation are available (see
// earthora-voice-agent-build-pack/05-IMPLEMENTATION-AND-QA.md, "Phase 5").
// Guessing at an unpublished telephony API contract is exactly the kind of
// mistake that silently breaks in production — this file exists only so the
// eventual telephony adapter has an obvious place to go, matching the
// browser/Google adapters' shape (audio in, text out via the same
// conversation controller).

export class TataSmartfloAdapter {
  constructor() {
    throw new Error(
      'TataSmartfloAdapter is not implemented. Phase 5 telephony integration requires official ' +
        'Tata Smartflo credentials and API documentation, which are not yet available.'
    );
  }
}
