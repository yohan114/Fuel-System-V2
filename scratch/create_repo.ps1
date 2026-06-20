$token = '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'
$headers = @{
    'Authorization' = "token $token"
    'Accept' = 'application/vnd.github.v3+json'
    'User-Agent' = 'PowerShell-Agent'
}
$body = @{
    name = 'Fuel-System-V2'
    private = $true
    description = 'Fuel System V2'
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Headers $headers -Method Post -Body $body -ContentType 'application/json'
    Write-Output "Successfully created repository: $($result.html_url)"
    Write-Output "Clone URL: $($result.clone_url)"
} catch {
    Write-Output "Failed to create repository: $_"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Output "Response: $responseBody"
    }
}
