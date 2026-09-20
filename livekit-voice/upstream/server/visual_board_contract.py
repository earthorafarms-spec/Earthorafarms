# GENERATED FROM schemas/visual-board-v1.schema.json — DO NOT EDIT BY HAND.
# Regenerate: node scripts/vb-schema-emit.mjs --d2c <frontend_web2> --voice <server>
# The parity test fails if this drifts from the schema.

VB_CONTRACT = {
  "contract_version": 1,
  "schema_hash": "sha256:b5d6e0129cfd9707705189595bc471869cd9cbc1b2a55f1cb1d6ebb4fa36ded4",
  "object_kinds": [
    "arrow",
    "circle",
    "ellipse",
    "group",
    "image",
    "line",
    "math",
    "path",
    "point",
    "polygon",
    "polyline",
    "rect",
    "text"
  ],
  "action_types": [
    "circle",
    "clear",
    "focus",
    "hide",
    "point",
    "remove",
    "show",
    "trace",
    "underline",
    "update"
  ],
  "gesture_types": [
    "circle",
    "focus",
    "point",
    "trace",
    "underline"
  ],
  "trigger_types": [
    "after_response",
    "beat_enter",
    "on_silent",
    "sentence_start"
  ],
  "animations": [
    "appear",
    "draw",
    "fade",
    "move",
    "none"
  ],
  "styles": [
    "accent-a",
    "accent-b",
    "axis",
    "axis-label",
    "candidate",
    "caption",
    "grid",
    "ink",
    "interval-band",
    "muted",
    "muted-soft",
    "object",
    "object-label",
    "question",
    "success",
    "success-soft",
    "surface-strong",
    "warning",
    "warning-soft"
  ],
  "semantic_rule_ids": [
    "S1-unique-object-ids",
    "S10-image-host-allowlisted",
    "S11-math-is-latex-not-html",
    "S12-camera-references-resolve",
    "S13-camera-target-visible-at-application",
    "S14-generated-camera-mobile-safe",
    "S2-references-resolve",
    "S3-groups-acyclic",
    "S4-unique-cue-ids",
    "S5-sentence-index-exists",
    "S6-response-triggers-need-a-question",
    "S7-target-exists-at-application",
    "S8-no-answer-before-release",
    "S9-animation-object-compatible"
  ],
  "limits": {
    "max_objects": 280,
    "max_cues": 300,
    "max_actions_per_cue": 12,
    "max_points": 300,
    "max_group_children": 200,
    "max_label_chars": 160,
    "max_text_chars": 300,
    "max_math_chars": 300,
    "max_path_commands": 200,
    "max_anim_ms": 4000,
    "coordinate_abs_max": 100000,
    "max_camera_focus_ids": 24,
    "max_camera_context_ids": 24,
    "camera_min_window_permille": 550,
    "camera_padding_units": 48
  },
  "animation_compatibility": {
    "draw": [
      "line",
      "polyline",
      "path",
      "arrow",
      "rect",
      "circle",
      "ellipse",
      "polygon",
      "text",
      "math",
      "point"
    ],
    "none": [
      "*"
    ],
    "appear": [
      "*"
    ],
    "fade": [
      "*"
    ],
    "move": [
      "point",
      "text",
      "math",
      "image",
      "rect",
      "circle",
      "ellipse",
      "group"
    ]
  }
}
