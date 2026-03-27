param([string]$BASE = "http://localhost:3001")

$ts    = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$u     = "user_$ts"
$email = "$u@test.com"
$tmp   = $env:TEMP
$ok    = 0
$fail  = 0

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
    $path = "$script:tmp\vtest_body.json"
    [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
    return $path
}

# req METHOD URL [json] [auth]
function req([string]$method, [string]$url, [string]$json = "", [string]$auth = "") {
    $ca = @("-s", "-m", "10", "-o", "-", "-w", "`n__STATUS__%{http_code}", "-X", $method)
    if ($json) {
        $fp = tmpJson $json
        $ca += "-H", "Content-Type: application/json", "-d", "@$fp"
    }
    if ($auth) { $ca += "-H", "Authorization: Bearer $auth" }
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
Write-Host "====== TODOS-API ($BASE) ======" -ForegroundColor Cyan

# ---- AUTH ----
Write-Host ""; Write-Host "--- AUTH ---" -ForegroundColor Yellow

$res = req POST "$BASE/auth/register" "{`"username`":`"$u`",`"email`":`"$email`",`"password`":`"secret123`"}"
chk "POST /auth/register (200)" 200 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"$u`",`"email`":`"$email`",`"password`":`"secret123`"}"
chk "POST /auth/register duplicate (400)" 400 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"x$ts`",`"email`":`"x${ts}@test.com`",`"password`":`"abc`"}"
chk "POST /auth/register short pw (422)" 422 $res[0]

$res = req POST "$BASE/auth/register" "{`"username`":`"y$ts`",`"email`":`"not-an-email`",`"password`":`"secret123`"}"
chk "POST /auth/register bad email (422)" 422 $res[0]

$res = req POST "$BASE/auth/login" "{`"username`":`"$u`",`"password`":`"secret123`"}"
chk "POST /auth/login (200)" 200 $res[0]
$token = ($res[1] | ConvertFrom-Json).tokens.accessToken
Write-Host "     Token: $($token.Substring(0,35))..." -ForegroundColor DarkGray

$res = req POST "$BASE/auth/login" "{`"username`":`"$u`",`"password`":`"wrongpw`"}"
chk "POST /auth/login wrong pw (401)" 401 $res[0]

# ---- CATEGORIES ----
Write-Host ""; Write-Host "--- CATEGORIES ---" -ForegroundColor Yellow

$res = req GET "$BASE/categories"
chk "GET /categories public (200)" 200 $res[0]

$res = req POST "$BASE/categories" "{`"name`":`"Work`"}"
chk "POST /categories no auth (401)" 401 $res[0]

$res = req POST "$BASE/categories" "{`"name`":`"Work`"}" $token
chk "POST /categories Work (200)" 200 $res[0]
$catId = ($res[1] | ConvertFrom-Json).id
Write-Host "     catId=$catId" -ForegroundColor DarkGray

$res = req POST "$BASE/categories" "{`"name`":`"Personal`"}" $token
chk "POST /categories Personal (200)" 200 $res[0]
$cat2Id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/categories" "{`"name`":`"Health`"}" $token
chk "POST /categories Health (200)" 200 $res[0]

$res = req GET "$BASE/categories"
chk "GET /categories list (200)" 200 $res[0]
$catList = $res[1] | ConvertFrom-Json
Write-Host "     Total categories: $($catList.total)" -ForegroundColor DarkGray

$res = req GET "$BASE/categories/$catId"
chk "GET /categories/:id (200)" 200 $res[0]
Write-Host "     Name: $(($res[1] | ConvertFrom-Json).name)" -ForegroundColor DarkGray

$res = req GET "$BASE/categories/99999"
chk "GET /categories/99999 (404)" 404 $res[0]

$res = req PUT "$BASE/categories/$catId" "{`"name`":`"Work Updated`"}" $token
chk "PUT /categories/:id (200)" 200 $res[0]
Write-Host "     Updated: $(($res[1] | ConvertFrom-Json).name)" -ForegroundColor DarkGray

$res = req PUT "$BASE/categories/$catId" "{`"name`":`"hack`"}"
chk "PUT /categories no auth (401)" 401 $res[0]

$res = req DELETE "$BASE/categories/$cat2Id" "" $token
chk "DELETE /categories/:id (200)" 200 $res[0]

# ---- TODOS ----
Write-Host ""; Write-Host "--- TODOS ---" -ForegroundColor Yellow

$res = req GET "$BASE/todos"
chk "GET /todos no auth (401)" 401 $res[0]

$res = req GET "$BASE/todos" "" $token
chk "GET /todos (200)" 200 $res[0]
Write-Host "     Total todos: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req POST "$BASE/todos" "{`"title`":`"Buy milk`"}"
chk "POST /todos no auth (401)" 401 $res[0]

# category_id is a UUID string — must be quoted in JSON
$res = req POST "$BASE/todos" "{`"title`":`"Buy milk`",`"description`":`"From the store`",`"category_id`":`"$catId`"}" $token
chk "POST /todos Buy milk (200)" 200 $res[0]
$t1id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/todos" "{`"title`":`"Read a book`",`"description`":`"Finish the novel`"}" $token
chk "POST /todos Read a book (200)" 200 $res[0]
$t2id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/todos" "{`"title`":`"Morning run`",`"description`":`"5km in the park`"}" $token
chk "POST /todos Morning run (200)" 200 $res[0]
$t3id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/todos" "{`"title`":`"Write report`",`"category_id`":`"$catId`"}" $token
chk "POST /todos Write report (200)" 200 $res[0]
$t4id = ($res[1] | ConvertFrom-Json).id

$res = req POST "$BASE/todos" "{`"description`":`"no title here`"}" $token
chk "POST /todos missing title (422)" 422 $res[0]

$res = req GET "$BASE/todos" "" $token
chk "GET /todos all (200)" 200 $res[0]
Write-Host "     Total todos: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req GET "$BASE/todos/$t1id" "" $token
chk "GET /todos/:id (200)" 200 $res[0]
Write-Host "     Title: $(($res[1] | ConvertFrom-Json).title)" -ForegroundColor DarkGray

$res = req GET "$BASE/todos/99999" "" $token
chk "GET /todos/99999 (404)" 404 $res[0]

$res = req PUT "$BASE/todos/$t1id" "{`"title`":`"Buy oat milk`"}" $token
chk "PUT /todos/:id update title (200)" 200 $res[0]
Write-Host "     New title: $(($res[1] | ConvertFrom-Json).title)" -ForegroundColor DarkGray

$res = req PUT "$BASE/todos/$t2id" "{`"completed`":true}" $token
chk "PUT /todos/:id mark complete (200)" 200 $res[0]
Write-Host "     Completed: $(($res[1] | ConvertFrom-Json).completed)" -ForegroundColor DarkGray

$res = req PUT "$BASE/todos/$t4id" "{`"completed`":true}" $token
chk "PUT /todos/:id #4 complete (200)" 200 $res[0]

$res = req GET "${BASE}/todos?completed=true" "" $token
chk "GET /todos?completed=true (200)" 200 $res[0]
Write-Host "     Completed count: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req GET "${BASE}/todos?completed=false" "" $token
chk "GET /todos?completed=false (200)" 200 $res[0]
Write-Host "     Pending count: $(($res[1] | ConvertFrom-Json).total)" -ForegroundColor DarkGray

$res = req DELETE "$BASE/todos/$t3id" "" $token
chk "DELETE /todos/:id (200)" 200 $res[0]

$res = req GET "$BASE/todos/$t3id" "" $token
chk "GET /todos/:id after delete (404)" 404 $res[0]

$res = req DELETE "$BASE/todos/$t4id"
chk "DELETE /todos no auth (401)" 401 $res[0]

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
    Write-Host "====== TODOS-API: $ok/$($ok+$fail) PASS -- ALL GREEN ======" -ForegroundColor Green
} else {
    Write-Host "====== TODOS-API: $ok PASS / $fail FAIL ======" -ForegroundColor Red
}
