$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCandidates = @()
$installedNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($installedNode) { $nodeCandidates += $installedNode.Source }
$nodeCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$workshopNode = $null
foreach ($candidate in $nodeCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $version = (& $candidate --version).TrimStart('v')
        if ([version]$version -ge [version]'22.12.0') { $workshopNode = $candidate; break }
    }
}
if (-not $workshopNode) { throw 'Node.js 22.12+ is required. Install a current Node.js LTS and run again.' }
if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) { throw 'Dependencies are missing. Run npm ci in this folder with Node.js 22.12+.' }
Write-Host 'Texelpad: http://127.0.0.1:5179/' -ForegroundColor Cyan
Write-Host 'Keep this window open. Ctrl+C stops the local server.'
$env:PATH = (Split-Path -Parent $workshopNode) + ';' + $env:PATH
$env:NPM_CONFIG_USERCONFIG = Join-Path $PSScriptRoot '.npmrc'
& $workshopNode 'node_modules\vite\bin\vite.js' --host 127.0.0.1
exit $LASTEXITCODE
