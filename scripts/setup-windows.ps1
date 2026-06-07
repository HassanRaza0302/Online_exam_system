#Requires -RunAsAdministrator
<#
  Enables TCP/IP for SQL Server Express and runs project setup.
  Right-click PowerShell -> Run as administrator, then:
    Set-ExecutionPolicy Bypass -Scope Process -Force
    & "E:\Online_exam_system\scripts\setup-windows.ps1"
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendRoot = Join-Path $ProjectRoot "backend"

Write-Host "=== Online Exam System — Windows setup ===" -ForegroundColor Cyan

function Get-SqlInstanceId {
    $key = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
    if (-not (Test-Path $key)) {
        throw "No SQL Server instances found in registry."
    }

    $props = Get-ItemProperty $key
    $names = $props.PSObject.Properties |
        Where-Object { $_.Name -notmatch "^PS" } |
        Select-Object -ExpandProperty Name

    if ($names -contains "SQLEXPRESS") {
        return @{
            Alias = "SQLEXPRESS"
            Internal = (Get-ItemProperty $key).SQLEXPRESS
        }
    }

    if ($names.Count -eq 1) {
        return @{
            Alias = $names[0]
            Internal = (Get-ItemProperty $key).($names[0])
        }
    }

    throw "Multiple SQL instances found ($($names -join ', ')). Expected SQLEXPRESS."
}

function Enable-SqlTcp {
    param(
        [string]$InternalName,
        [int]$Port = 14333
    )

    $tcpRoot = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$InternalName\MSSQLServer\SuperSocketNetLib\Tcp"
    if (-not (Test-Path $tcpRoot)) {
        throw "TCP registry path not found: $tcpRoot"
    }

    Write-Host "Enabling TCP/IP for $InternalName on port $Port..."
    Set-ItemProperty -Path $tcpRoot -Name "Enabled" -Value 1

    $ipAll = Join-Path $tcpRoot "IPAll"
    Set-ItemProperty -Path $ipAll -Name "TcpDynamicPorts" -Value ""
    Set-ItemProperty -Path $ipAll -Name "TcpPort" -Value ([string]$Port)

    foreach ($ipKey in Get-ChildItem $tcpRoot | Where-Object { $_.PSChildName -like "IP*" -and $_.PSChildName -ne "IPAll" }) {
        Set-ItemProperty -Path $ipKey.PSPath -Name "Enabled" -Value 1
        Set-ItemProperty -Path $ipKey.PSPath -Name "TcpDynamicPorts" -Value ""
        Set-ItemProperty -Path $ipKey.PSPath -Name "TcpPort" -Value ([string]$Port) -ErrorAction SilentlyContinue
    }

    return $Port
}

function Restart-SqlInstance {
    param([string]$Alias)

    $serviceName = if ($Alias -eq "MSSQLSERVER") { "MSSQLSERVER" } else { "MSSQL`$$Alias" }
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service) {
        throw "SQL Server service not found: $serviceName"
    }

    if ($service.Status -ne "Running") {
        Write-Host "Starting $serviceName..."
        Start-Service $serviceName
    } else {
        Write-Host "Restarting $serviceName..."
        Restart-Service $serviceName -Force
    }

    Start-Sleep -Seconds 4
}

function Update-EnvFile {
    param(
        [int]$Port,
        [string]$Alias
    )

    $envPath = Join-Path $BackendRoot ".env"
    $content = @"
# Server
PORT=3011
SESSION_SECRET=dev_secret_change_me

# SQL Server Express (Windows Authentication)
DB_SERVER=localhost
DB_PORT=$Port
DB_USE_WINDOWS_AUTH=true
DB_DATABASE=OnlineExamSystem

DB_CONNECTION_TIMEOUT=8000
"@

    Set-Content -Path $envPath -Value $content -Encoding UTF8
    Write-Host "Updated $envPath"
}

$instance = Get-SqlInstanceId
Write-Host "Found SQL instance: $($instance.Alias) ($($instance.Internal))"

$port = Enable-SqlTcp -InternalName $instance.Internal -Port 14333
Restart-SqlInstance -Alias $instance.Alias
Update-EnvFile -Port $port -Alias $instance.Alias

Write-Host "`nInstalling npm packages..."
Set-Location $BackendRoot
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Set-Location $ProjectRoot

Write-Host "`nTesting database connection..."
npm run db:test
if ($LASTEXITCODE -ne 0) { throw "db:test failed — check SQL Server service and .env" }

Write-Host "`nApplying database schema..."
npm run db:apply
if ($LASTEXITCODE -ne 0) { throw "db:apply failed" }

Write-Host "`n=== Setup complete ===" -ForegroundColor Green
Write-Host "Start the app with: npm start"
Write-Host "Admin login: admin@exam.com / admin123"
