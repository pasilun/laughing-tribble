// The old connector's tool names inside messages that come from lib/plan/assist/, in the words of the new connector.
// Specific names first; the last rule catches any other old name.
const CALLS: Array<[RegExp, string]> = [
  [/\bplan_upload_link\b/g, 'source (action "upload_link")'],
  [/\bplan_scan_calibrate\b/g, 'source (action "calibrate")'],
  [/\bplan_scan_dimension\b/g, 'source (action "calibrate")'],
  [/\bplan_trace\b/g, 'scan (action "trace")'],
  [/\bplan_scan_(?:openings|snap_walls|elevation)\b/g, 'scan'],
  [/\bplan_scan_view\b/g, 'view (view "source")'],
  [/\bplan_audit\b/g, 'check (scope "audit")'],
  [/\bplan_review\b/g, 'check (scope "review")'],
  [/\bplan_finish\b/g, 'check (scope "finish")'],
  [/\bplan_check\b/g, 'check (scope "permit")'],
  [/\bplan_fix\b/g, 'edit'],
  [/\bplan_edit\b/g, 'edit'],
  [/\bplan_get\b/g, 'get'],
  [/\bplan_[a-z_]+\b/g, 'ett av verktygen'],
]
export function modernWords(text: string): string {
  return CALLS.reduce((t, [re, to]) => t.replace(re, to), text)
}
