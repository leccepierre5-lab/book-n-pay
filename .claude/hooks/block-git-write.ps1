$ErrorActionPreference = "Stop"
$raw = [Console]::In.ReadToEnd()
try { $data = $raw | ConvertFrom-Json } catch { exit 0 }

if ($data.tool_name -ne "Bash") { exit 0 }
$cmd = $data.tool_input.command
if (-not $cmd) { exit 0 }

$patterns = @(
  '\bgit\s+push\b',
  '\bgh\s+pr\s+create\b',
  '\bgh\s+pr\s+merge\b'
)

foreach ($p in $patterns) {
  if ($cmd -match $p) {
    $out = @{
      hookSpecificOutput = @{
        hookEventName            = "PreToolUse"
        permissionDecision       = "deny"
        permissionDecisionReason = "bnp-next : push/PR interdits a Claude (commit local autorise). Pierre execute ces operations lui-meme."
      }
    } | ConvertTo-Json -Compress
    Write-Output $out
    exit 0
  }
}
exit 0
