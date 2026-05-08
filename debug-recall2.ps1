$data = Get-Content 'C:\Users\Administrator\.openclaw\workspace\memory\.dreams\short-term-recall.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$entries = $data.entries
$keys = $entries.PSObject.Properties.Name | Select-Object -First 10
Write-Host "Sample keys: $($keys -join ', ')"
Write-Host ""
Write-Host "Total entries: $($keys.Count)"
Write-Host ""
# Get first key and its value
$firstKey = $keys[0]
$firstEntry = $entries.$firstKey
Write-Host "First entry key: $firstKey"
$firstEntry | ConvertTo-Json -Depth 8
