# setup_db.ps1 — buat user + database Zenith di PostgreSQL lokal, lalu arahkan .env ke sana.
# Jalankan di jendela PowerShell biasa (bukan lewat Claude):
#   powershell -ExecutionPolicy Bypass -File D:\zenith_saas_local\setup_db.ps1
# Aman dijalankan ulang (idempotent). Password postgres hanya dipakai di proses ini, tidak ditulis ke disk.

$ErrorActionPreference = 'Stop'
$psql    = 'D:\postgresql\bin\psql.exe'
$envFile = 'D:\zenith_saas\.env'
$dbName  = 'zenith'
$dbUser  = 'zenith_user'

# 1. Minta password superuser (tersembunyi)
$sec = Read-Host 'Password user "postgres"' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

function Psql([string]$db, [string]$sql) {
    $out = & $psql -h localhost -U postgres -d $db -v ON_ERROR_STOP=1 -tA -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql gagal: $out" }
    return ($out | Out-String).Trim()
}

try {
    # 2. Password acak untuk zenith_user (alfanumerik saja -> aman di URL tanpa encoding)
    $chars = (48..57) + (65..90) + (97..122)
    $appPw = -join ($chars | Get-Random -Count 28 | ForEach-Object { [char]$_ })

    Psql 'postgres' 'SELECT 1' | Out-Null
    Write-Host 'Login superuser OK.'

    # 3. User (buat bila belum ada, selalu set password baru)
    if ((Psql 'postgres' "SELECT 1 FROM pg_roles WHERE rolname='$dbUser'") -ne '1') {
        Psql 'postgres' "CREATE USER $dbUser WITH PASSWORD '$appPw'" | Out-Null
        Write-Host "User $dbUser dibuat."
    } else {
        Psql 'postgres' "ALTER USER $dbUser WITH PASSWORD '$appPw'" | Out-Null
        Write-Host "User $dbUser sudah ada; password diperbarui."
    }

    # 4. Database
    if ((Psql 'postgres' "SELECT 1 FROM pg_database WHERE datname='$dbName'") -ne '1') {
        Psql 'postgres' "CREATE DATABASE $dbName OWNER $dbUser" | Out-Null
        Write-Host "Database $dbName dibuat."
    } else {
        Write-Host "Database $dbName sudah ada."
    }

    # 5. Perbarui .env: komentari DATABASE_URL lama (Railway), tambahkan yang baru. Tanpa BOM.
    $newUrl = "DATABASE_URL=postgresql://${dbUser}:${appPw}@localhost:5432/${dbName}"
    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path $envFile) { [IO.File]::ReadAllLines($envFile) | ForEach-Object { $lines.Add($_) } }
    $out = [System.Collections.Generic.List[string]]::new()
    $replaced = $false
    foreach ($l in $lines) {
        if ($l -match '^DATABASE_URL=') {
            if ($l -notmatch '@localhost[:/]') { $out.Add('# OLD_RAILWAY_' + $l) }
            if (-not $replaced) { $out.Add($newUrl); $replaced = $true }
        } else { $out.Add($l) }
    }
    if (-not $replaced) { $out.Add($newUrl) }
    [IO.File]::WriteAllLines($envFile, $out, (New-Object Text.UTF8Encoding($false)))
    Write-Host ".env diperbarui (DATABASE_URL lama dikomentari sebagai OLD_RAILWAY_DATABASE_URL)."

    # 6. Uji login sebagai zenith_user
    $env:PGPASSWORD = $appPw
    $who = & $psql -h localhost -U $dbUser -d $dbName -tA -c "SELECT current_user || ' @ ' || current_database()" 2>&1
    Write-Host "Uji koneksi zenith_user: $who"
    Write-Host 'SELESAI. Kembali ke Claude dan bilang "DB siap".'
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
