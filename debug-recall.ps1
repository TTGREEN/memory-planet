$data = Get-Content 'C:\Users\Administrator\.openclaw\workspace\memory\.dreams\short-term-recall.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$entries = $data.PSObject.Properties['entries'].Value
Write-Host "Total entries: $($entries.Count)"
Write-Host ""
Write-Host "First 2 entries (full JSON):"
$entries | Select-Object -First 2 | ConvertTo-Json -Depth 10
Write-Host ""
Write-Host "Keys of first entry:"
$entries[0].PSObject.Properties.Name
