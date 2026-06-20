$token = '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'
$headers = @{
    'Authorization' = "token $token"
    'Accept' = 'application/vnd.github.v3+json'
    'User-Agent' = 'PowerShell-Agent'
}
try {
    $user = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -Method Get
    Write-Output "Authenticated as: $($user.login)"
    try {
        $repo = Invoke-RestMethod -Uri 'https://api.github.com/repos/yohan114/Fuel-System' -Headers $headers -Method Get
        Write-Output "Repository yohan114/Fuel-System already exists."
    } catch {
        Write-Output "Repository yohan114/Fuel-System does not exist yet (Error: $_)."
    }
} catch {
    Write-Output "Authentication failed: $_"
}
