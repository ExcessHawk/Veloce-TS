param([string]$BASE = "http://localhost:3002")

$ts     = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$u      = "chatuser_$ts"
$email  = "$u@test.com"
$u2     = "chatuser2_$ts"
$email2 = "$u2@test.com"
$tmp    = $env:TEMP
$ok     = 0
$fail   = 0

function chk([string]$label, [int]$expected, [int]$actual) {
    if ($actual -eq $expected) {
        Write-Host "  [PASS] $label (HTTP $actual)" -ForegroundColor Green
        $script:ok++
    } else {
        Write-Host "  [FAIL] $label -- expected $expected, got $actual" -ForegroundColor Red
        $script:fail++
    }
}

function tmpJson([string]$json) {
    $path = "$script:tmp\vtest_chat_body.json"
    [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
    return $path
}

# req METHOD URL [json] [auth] [extra_headers...]
function req([string]$method, [string]$url, [string]$json = "", [string]$auth = "", [string[]]$extraHeaders = @()) {
    $ca = @("-s", "-m", "10", "-o", "-", "-w", "`n__STATUS__%{http_code}", "-X", $method)
    if ($json) {
        $fp = tmpJson $json
        $ca += "-H", "Content-Type: application/json", "-d", "@$fp"
    }
    if ($auth) { $ca += "-H", "Authorization: Bearer $auth" }
    foreach ($h in $extraHeaders) { $ca += "-H", $h }
    $raw   = & curl.exe @ca $url 2>&1
    $lines = $raw -split "`n"
    $code  = 0; $bodyText = ""
    if ($lines[-1] -match "__STATUS__(\d+)") {
        $code     = [int]$Matches[1]
        $bodyText = ($lines[0..($lines.Count - 2)] -join "`n").Trim()
    }
    return @($code, $bodyText)
}

Write-Host ""
Write-Host "====== CHAT-API ($BASE) ======" -ForegroundColor Cyan

# ---- AUTH ----
Write-Host ""; Write-Host "--- AUTH ---" -ForegroundColor Yellow

$res = req POST "$BASE/auth/register" "{`"username`":`"$u`",`"email`":`"$email`",`"password`":`"secret123`"}"
chk "POST /auth/register user1 (200)" 200 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"$u`",`"email`":`"$email`",`"password`":`"secret123`"}"
chk "POST /auth/register duplicate (400)" 400 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"z$ts`",`"email`":`"z${ts}@test.com`",`"password`":`"short`"}"
chk "POST /auth/register short pw (422)" 422 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"w$ts`",`"email`":`"bad-email`",`"password`":`"secret123`"}"
chk "POST /auth/register bad email (422)" 422 $res[0]

$res = req POST "$BASE/auth/login" "{`"username`":`"$u`",`"password`":`"secret123`"}"
chk "POST /auth/login user1 (200)" 200 $res[0]
$token = ($res[1] | ConvertFrom-Json).tokens.accessToken
Write-Host "     Token1: $($token.Substring(0,35))..." -ForegroundColor DarkGray

$res = req POST "$BASE/auth/login" "{`"username`":`"$u`",`"password`":`"wrongpw`"}"
chk "POST /auth/login wrong pw (401)" 401 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"$u2`",`"email`":`"$email2`",`"password`":`"pass456`"}"
chk "POST /auth/register user2 (200)" 200 $res[0]

$res = req POST "$BASE/auth/login" "{`"username`":`"$u2`",`"password`":`"pass456`"}"
chk "POST /auth/login user2 (200)" 200 $res[0]
$token2 = ($res[1] | ConvertFrom-Json).tokens.accessToken
Write-Host "     Token2: $($token2.Substring(0,35))..." -ForegroundColor DarkGray

# ---- ROOMS ----
Write-Host ""; Write-Host "--- ROOMS ---" -ForegroundColor Yellow

$res = req GET "$BASE/rooms"
chk "GET /rooms no auth (401)" 401 $res[0]

$res = req GET "$BASE/rooms" "" $token
chk "GET /rooms (200)" 200 $res[0]
Write-Host "     Count: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req POST "$BASE/rooms" "{`"name`":`"General`"}"
chk "POST /rooms no auth (401)" 401 $res[0]

$res = req POST "$BASE/rooms" "{`"name`":`"General`",`"description`":`"Main chat room`"}" $token
chk "POST /rooms General (200)" 200 $res[0]
$room1Id = ($res[1] | ConvertFrom-Json).id
Write-Host "     room1Id=$room1Id" -ForegroundColor DarkGray

$res = req POST "$BASE/rooms" "{`"name`":`"Random`",`"description`":`"Off-topic`"}" $token
chk "POST /rooms Random (200)" 200 $res[0]
$room2Id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/rooms" "{`"name`":`"Tech Talk`"}" $token2
chk "POST /rooms Tech Talk by user2 (200)" 200 $res[0]
$room3Id = ($res[1] | ConvertFrom-Json).id

# Empty name fails min(1) validation
$res = req POST "$BASE/rooms" "{`"name`":`"`"}" $token
chk "POST /rooms empty name (422)" 422 $res[0]

$res = req GET "$BASE/rooms" "" $token
chk "GET /rooms list (200)" 200 $res[0]
Write-Host "     Total rooms: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req GET "$BASE/rooms/$room1Id" "" $token
chk "GET /rooms/:id (200)" 200 $res[0]
Write-Host "     Name: $(($res[1] | ConvertFrom-Json).name)" -ForegroundColor DarkGray

$res = req GET "$BASE/rooms/99999" "" $token
chk "GET /rooms/99999 (404)" 404 $res[0]

# Non-owner delete → 400 BadRequest (not 403)
$res = req DELETE "$BASE/rooms/$room2Id" "" $token2
chk "DELETE /rooms/:id non-owner (400)" 400 $res[0]

# Owner delete → 200
$res = req DELETE "$BASE/rooms/$room3Id" "" $token2
chk "DELETE /rooms/:id owner (200)" 200 $res[0]

# Verify deletion
$res = req GET "$BASE/rooms/$room3Id" "" $token
chk "GET /rooms/:id after delete (404)" 404 $res[0]

# ---- MESSAGES ----
Write-Host ""; Write-Host "--- MESSAGES ---" -ForegroundColor Yellow

$res = req GET "$BASE/rooms/$room1Id/messages"
chk "GET messages no auth (401)" 401 $res[0]

$res = req GET "$BASE/rooms/$room1Id/messages" "" $token
chk "GET messages (200)" 200 $res[0]
Write-Host "     Count: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req POST "$BASE/rooms/$room1Id/messages" "{`"content`":`"Hello everyone!`"}"
chk "POST messages no auth (401)" 401 $res[0]

$res = req POST "$BASE/rooms/$room1Id/messages" "{`"content`":`"Hello everyone!`"}" $token
chk "POST messages user1 (200)" 200 $res[0]
$msg1Id = ($res[1] | ConvertFrom-Json).id
Write-Host "     msg1Id=$msg1Id" -ForegroundColor DarkGray

$res = req POST "$BASE/rooms/$room1Id/messages" "{`"content`":`"Hey there!`"}" $token2
chk "POST messages user2 (200)" 200 $res[0]
$msg2Id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/rooms/$room1Id/messages" "{`"content`":`"Third message from user1`"}" $token
chk "POST messages #3 (200)" 200 $res[0]
$msg3Id = ($res[1] | ConvertFrom-Json).id

# Empty content fails min(1) validation
$res = req POST "$BASE/rooms/$room1Id/messages" "{`"content`":`"`"}" $token
chk "POST messages empty content (422)" 422 $res[0]

$res = req GET "$BASE/rooms/$room1Id/messages" "" $token
chk "GET messages after 3 posted (200)" 200 $res[0]
Write-Host "     Total messages: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

# Non-author delete → 400 BadRequest (not 403)
$res = req DELETE "$BASE/rooms/$room1Id/messages/$msg2Id" "" $token
chk "DELETE message non-author (400)" 400 $res[0]

# Author delete → 200
$res = req DELETE "$BASE/rooms/$room1Id/messages/$msg2Id" "" $token2
chk "DELETE message author (200)" 200 $res[0]

$res = req GET "$BASE/rooms/$room1Id/messages" "" $token
chk "GET messages after delete (200)" 200 $res[0]
Write-Host "     Messages remaining: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

# ---- WebSocket Endpoint ----
Write-Host ""; Write-Host "--- WebSocket Endpoint ---" -ForegroundColor Yellow

# Without Upgrade header → 426 always
$res = req GET "$BASE/ws/chat"
chk "GET /ws/chat (no Upgrade) → 426" 426 $res[0]

# With Upgrade header, no token → 401
$res = req GET "$BASE/ws/chat" "" "" @("Upgrade: websocket", "Connection: Upgrade")
chk "GET /ws/chat (no token) → 401" 401 $res[0]

# With Upgrade header, bad token → 401
$res = req GET "$BASE/ws/chat?token=invalid.jwt.token" "" "" @("Upgrade: websocket", "Connection: Upgrade")
chk "GET /ws/chat (bad token) → 401" 401 $res[0]

# ---- OpenAPI ----
Write-Host ""; Write-Host "--- OpenAPI / Docs ---" -ForegroundColor Yellow

$res = req GET "$BASE/openapi.json"
chk "GET /openapi.json (200)" 200 $res[0]
$paths = ($res[1] | ConvertFrom-Json).paths.PSObject.Properties.Name
Write-Host "     Paths: $($paths -join ', ')" -ForegroundColor DarkGray

$res = req GET "$BASE/docs"
chk "GET /docs (200)" 200 $res[0]
Write-Host "     Swagger HTML bytes: $($res[1].Length)" -ForegroundColor DarkGray

Write-Host ""
if ($fail -eq 0) {
    Write-Host "====== CHAT-API: $ok/$($ok+$fail) PASS -- ALL GREEN ======" -ForegroundColor Green
} else {
    Write-Host "====== CHAT-API: $ok PASS / $fail FAIL ======" -ForegroundColor Red
}
